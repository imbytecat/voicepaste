use std::io::{Read, Write};

use flate2::{Compression, read::GzDecoder, write::GzEncoder};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tokio::{sync::mpsc, time::Duration};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{
        Message,
        client::IntoClientRequest,
        http::{HeaderName, HeaderValue, Request as HttpRequest},
    },
};
use uuid::Uuid;

use crate::settings::AppSettings;

const DOUBAO_ENDPOINT: &str = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async";
const MSG_FULL_CLIENT_REQUEST: u8 = 0x1;
const MSG_AUDIO_ONLY_REQUEST: u8 = 0x2;
const MSG_FULL_SERVER_RESPONSE: u8 = 0x9;
const MSG_SERVER_ERROR: u8 = 0xf;
const FLAG_NO_SEQUENCE: u8 = 0x0;
const FLAG_LAST_NO_SEQUENCE: u8 = 0x2;
const SERIALIZATION_NONE: u8 = 0x0;
const SERIALIZATION_JSON: u8 = 0x1;
const COMPRESSION_NONE: u8 = 0x0;
const COMPRESSION_GZIP: u8 = 0x1;

pub enum AudioCommand {
    Data(Vec<u8>),
    Finish,
}

#[derive(Serialize)]
struct FullClientRequest {
    user: UserMeta,
    audio: AudioMeta,
    request: RequestMeta,
}

#[derive(Serialize)]
struct UserMeta {
    uid: String,
}

#[derive(Serialize)]
struct AudioMeta {
    format: &'static str,
    codec: &'static str,
    rate: u32,
    bits: u8,
    channel: u8,
}

#[derive(Serialize)]
struct RequestMeta {
    model_name: &'static str,
    enable_itn: bool,
    enable_punc: bool,
    enable_ddc: bool,
    show_utterances: bool,
    result_type: &'static str,
    enable_nonstream: bool,
    end_window_size: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    corpus: Option<Corpus>,
}

#[derive(Serialize)]
struct Corpus {
    context: String,
}

#[derive(Deserialize)]
struct ResponsePayload {
    #[serde(default)]
    result: ResponseResult,
}

#[derive(Default, Deserialize)]
struct ResponseResult {
    #[serde(default)]
    text: String,
}

struct ServerResponse {
    code: u32,
    is_last: bool,
    text: String,
    error: String,
}

fn install_crypto_provider() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}

fn build_connection_request(
    settings: &AppSettings,
    connection_id: &str,
) -> Result<HttpRequest<()>, String> {
    let mut request = DOUBAO_ENDPOINT
        .into_client_request()
        .map_err(|error| format!("创建豆包连接请求失败：{error}"))?;
    for (name, value) in [
        ("x-api-key", settings.api_key.as_str()),
        ("x-api-resource-id", settings.resource_id.as_str()),
        ("x-api-connect-id", connection_id),
    ] {
        request.headers_mut().insert(
            HeaderName::from_static(name),
            HeaderValue::from_str(value).map_err(|error| format!("豆包请求头无效：{error}"))?,
        );
    }
    Ok(request)
}

pub async fn run(
    settings: AppSettings,
    mut commands: mpsc::Receiver<AudioCommand>,
    app: AppHandle,
) -> Result<String, String> {
    install_crypto_provider();
    let connection_id = Uuid::new_v4().to_string();
    let request = build_connection_request(&settings, &connection_id)?;

    let (socket, response) = tokio::time::timeout(Duration::from_secs(10), connect_async(request))
        .await
        .map_err(|_| "连接豆包语音超时".to_owned())?
        .map_err(|error| format!("连接豆包语音失败：{error}"))?;
    if let Some(log_id) = response
        .headers()
        .get("x-tt-logid")
        .and_then(|value| value.to_str().ok())
    {
        eprintln!("豆包语音连接 logid: {log_id}");
    }
    let (mut writer, mut reader) = socket.split();
    writer
        .send(Message::Binary(
            encode_full_request(&settings, &connection_id)?.into(),
        ))
        .await
        .map_err(|error| format!("发送豆包初始化请求失败：{error}"))?;

    loop {
        tokio::select! {
            command = commands.recv() => {
                match command {
                    Some(AudioCommand::Data(pcm)) => {
                        writer
                            .send(Message::Binary(encode_audio_frame(&pcm, false)?.into()))
                            .await
                            .map_err(|error| format!("发送语音数据失败：{error}"))?;
                    }
                    Some(AudioCommand::Finish) | None => {
                        writer
                            .send(Message::Binary(encode_audio_frame(&[], true)?.into()))
                            .await
                            .map_err(|error| format!("结束语音流失败：{error}"))?;
                        break;
                    }
                }
            }
            incoming = reader.next() => {
                match incoming {
                    Some(Ok(Message::Binary(data))) => {
                        if let Some(final_text) = process_response(&app, &data)? {
                            return Ok(final_text);
                        }
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        writer.send(Message::Pong(payload)).await.map_err(|error| format!("回应豆包心跳失败：{error}"))?;
                    }
                    Some(Ok(Message::Close(_))) | None => return Err("豆包语音连接提前关闭".to_owned()),
                    Some(Err(error)) => return Err(format!("读取豆包语音结果失败：{error}")),
                    _ => {}
                }
            }
        }
    }

    tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            match reader.next().await {
                Some(Ok(Message::Binary(data))) => {
                    if let Some(final_text) = process_response(&app, &data)? {
                        return Ok(final_text);
                    }
                }
                Some(Ok(Message::Ping(payload))) => {
                    writer
                        .send(Message::Pong(payload))
                        .await
                        .map_err(|error| format!("回应豆包心跳失败：{error}"))?;
                }
                Some(Ok(Message::Close(_))) | None => {
                    return Err("豆包未返回最终修正结果".to_owned());
                }
                Some(Err(error)) => return Err(format!("读取豆包最终结果失败：{error}")),
                _ => {}
            }
        }
    })
    .await
    .map_err(|_| "等待豆包最终修正结果超时".to_owned())?
}

fn process_response(app: &AppHandle, data: &[u8]) -> Result<Option<String>, String> {
    let response = parse_response(data)?;
    if response.code != 0 {
        return Err(if response.error.is_empty() {
            format!("豆包语音返回错误码 {}", response.code)
        } else {
            format!("豆包语音错误：{}", response.error)
        });
    }
    if response.text.is_empty() {
        return Ok(None);
    }

    if response.is_last {
        app.emit_to(
            "overlay",
            "asr-event",
            json!({ "kind": "final", "text": response.text }),
        )
        .map_err(|error| format!("发送最终识别结果失败：{error}"))?;
        Ok(Some(response.text))
    } else {
        app.emit_to(
            "overlay",
            "asr-event",
            json!({ "kind": "partial", "text": response.text }),
        )
        .map_err(|error| format!("发送实时识别结果失败：{error}"))?;
        Ok(None)
    }
}

fn encode_full_request(settings: &AppSettings, connection_id: &str) -> Result<Vec<u8>, String> {
    let corpus = if settings.hotwords.is_empty() {
        None
    } else {
        Some(Corpus {
            context: serde_json::to_string(&json!({
                "hotwords": settings.hotwords.iter().map(|word| json!({ "word": word })).collect::<Vec<_>>()
            }))
            .map_err(|error| format!("编码热词失败：{error}"))?,
        })
    };
    let request = FullClientRequest {
        user: UserMeta {
            uid: connection_id.to_owned(),
        },
        audio: AudioMeta {
            format: "pcm",
            codec: "raw",
            rate: 16_000,
            bits: 16,
            channel: 1,
        },
        request: RequestMeta {
            model_name: "bigmodel",
            enable_itn: true,
            enable_punc: true,
            enable_ddc: true,
            show_utterances: true,
            result_type: "full",
            enable_nonstream: true,
            end_window_size: 800,
            corpus,
        },
    };
    let json =
        serde_json::to_vec(&request).map_err(|error| format!("编码豆包初始化参数失败：{error}"))?;
    encode_payload(
        MSG_FULL_CLIENT_REQUEST,
        FLAG_NO_SEQUENCE,
        SERIALIZATION_JSON,
        &json,
    )
}

fn encode_audio_frame(pcm: &[u8], last: bool) -> Result<Vec<u8>, String> {
    encode_payload(
        MSG_AUDIO_ONLY_REQUEST,
        if last {
            FLAG_LAST_NO_SEQUENCE
        } else {
            FLAG_NO_SEQUENCE
        },
        SERIALIZATION_NONE,
        pcm,
    )
}

fn encode_payload(
    message_type: u8,
    flags: u8,
    serialization: u8,
    payload: &[u8],
) -> Result<Vec<u8>, String> {
    let compressed = gzip(payload)?;
    let mut message = Vec::with_capacity(8 + compressed.len());
    message.extend_from_slice(&[
        0x11,
        (message_type << 4) | flags,
        (serialization << 4) | COMPRESSION_GZIP,
        0,
    ]);
    message.extend_from_slice(&(compressed.len() as u32).to_be_bytes());
    message.extend_from_slice(&compressed);
    Ok(message)
}

fn parse_response(message: &[u8]) -> Result<ServerResponse, String> {
    if message.len() < 4 {
        return Err("豆包响应过短".to_owned());
    }
    let header_size = usize::from(message[0] & 0x0f) * 4;
    if header_size < 4 || header_size > message.len() {
        return Err("豆包响应头长度无效".to_owned());
    }

    let message_type = message[1] >> 4;
    let flags = message[1] & 0x0f;
    let compression = message[2] & 0x0f;
    let mut payload = &message[header_size..];
    if flags & 0x01 != 0 {
        payload = payload
            .get(4..)
            .ok_or_else(|| "豆包响应缺少序列号".to_owned())?;
    }
    if flags & 0x04 != 0 {
        payload = payload
            .get(4..)
            .ok_or_else(|| "豆包响应缺少事件编号".to_owned())?;
    }

    let mut response = ServerResponse {
        code: 0,
        is_last: flags == 0x2 || flags == 0x3,
        text: String::new(),
        error: String::new(),
    };
    match message_type {
        MSG_FULL_SERVER_RESPONSE => {
            let size_bytes = payload
                .get(..4)
                .ok_or_else(|| "豆包响应缺少内容长度".to_owned())?;
            let payload_size =
                u32::from_be_bytes(size_bytes.try_into().map_err(|_| "豆包响应长度格式错误")?)
                    as usize;
            let body = payload
                .get(4..4 + payload_size)
                .ok_or_else(|| "豆包响应内容不完整".to_owned())?;
            if body.is_empty() {
                return Ok(response);
            }
            let body = if compression == COMPRESSION_GZIP {
                gunzip(body)?
            } else if compression == COMPRESSION_NONE {
                body.to_vec()
            } else {
                return Err(format!("不支持的豆包压缩格式：{compression}"));
            };
            let decoded: ResponsePayload = serde_json::from_slice(&body)
                .map_err(|error| format!("解析豆包识别结果失败：{error}"))?;
            response.text = decoded.result.text;
        }
        MSG_SERVER_ERROR => {
            let code_bytes = payload
                .get(..4)
                .ok_or_else(|| "豆包错误响应缺少错误码".to_owned())?;
            let size_bytes = payload
                .get(4..8)
                .ok_or_else(|| "豆包错误响应缺少内容长度".to_owned())?;
            response.code =
                u32::from_be_bytes(code_bytes.try_into().map_err(|_| "豆包错误码格式错误")?);
            let payload_size =
                u32::from_be_bytes(size_bytes.try_into().map_err(|_| "豆包错误长度格式错误")?)
                    as usize;
            let body = payload
                .get(8..8 + payload_size)
                .ok_or_else(|| "豆包错误响应内容不完整".to_owned())?;
            let body = if compression == COMPRESSION_GZIP {
                gunzip(body)?
            } else {
                body.to_vec()
            };
            response.error = String::from_utf8_lossy(&body).into_owned();
        }
        _ => {}
    }
    Ok(response)
}

fn gzip(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(data)
        .map_err(|error| format!("压缩豆包请求失败：{error}"))?;
    encoder
        .finish()
        .map_err(|error| format!("完成豆包请求压缩失败：{error}"))
}

fn gunzip(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoder = GzDecoder::new(data);
    let mut decoded = Vec::new();
    decoder
        .read_to_end(&mut decoded)
        .map_err(|error| format!("解压豆包响应失败：{error}"))?;
    Ok(decoded)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn final_audio_frame_sets_last_flag() {
        let frame = encode_audio_frame(&[], true).expect("encode final audio frame");
        assert_eq!(frame[1] & 0x0f, FLAG_LAST_NO_SEQUENCE);
    }

    #[test]
    fn new_console_auth_uses_only_api_key() {
        let mut settings = AppSettings::default();
        settings.api_key = "new-api-key".to_owned();
        let request = build_connection_request(&settings, "request-id").expect("build request");

        assert_eq!(request.headers()["x-api-key"], "new-api-key");
        assert!(!request.headers().contains_key("x-api-app-key"));
        assert!(!request.headers().contains_key("x-api-access-key"));
    }

    #[test]
    fn full_request_uses_documented_model_name() {
        let frame =
            encode_full_request(&AppSettings::default(), "request-id").expect("encode request");
        let payload: serde_json::Value =
            serde_json::from_slice(&gunzip(&frame[8..]).expect("decompress request"))
                .expect("parse request");

        assert_eq!(payload["request"]["model_name"], "bigmodel");
    }

    #[test]
    fn parses_success_response_without_result() {
        let payload = gzip(b"{}").expect("gzip response");
        let mut message = vec![0x11, MSG_FULL_SERVER_RESPONSE << 4, COMPRESSION_GZIP, 0];
        message.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        message.extend_from_slice(&payload);

        let response = parse_response(&message).expect("parse response");
        assert!(response.text.is_empty());
    }

    #[test]
    fn parses_gzipped_final_response() {
        let payload =
            gzip(r#"{"result":{"text":"你好，世界。"}}"#.as_bytes()).expect("gzip response");
        let mut message = vec![
            0x11,
            (MSG_FULL_SERVER_RESPONSE << 4) | FLAG_LAST_NO_SEQUENCE,
            COMPRESSION_GZIP,
            0,
        ];
        message.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        message.extend_from_slice(&payload);

        let response = parse_response(&message).expect("parse response");
        assert!(response.is_last);
        assert_eq!(response.text, "你好，世界。");
    }

    #[tokio::test]
    #[ignore = "requires DOUBAO_API_KEY and live network"]
    async fn live_api_key_accepts_audio_session() {
        let mut settings = AppSettings::default();
        settings.api_key = std::env::var("DOUBAO_API_KEY").expect("DOUBAO_API_KEY");
        install_crypto_provider();
        let connection_id = Uuid::new_v4().to_string();
        let request =
            build_connection_request(&settings, &connection_id).expect("build connection request");
        let (mut socket, handshake) = connect_async(request).await.expect("connect Doubao");
        let log_id = handshake
            .headers()
            .get("x-tt-logid")
            .and_then(|value| value.to_str().ok())
            .expect("X-Tt-Logid");

        socket
            .send(Message::Binary(
                encode_full_request(&settings, &connection_id)
                    .expect("encode full request")
                    .into(),
            ))
            .await
            .expect("send full request");

        let mut pcm = Vec::with_capacity(6_400);
        for index in 0..3_200 {
            let sample =
                ((index as f32 * 440.0 * std::f32::consts::TAU / 16_000.0).sin() * 4_000.0) as i16;
            pcm.extend_from_slice(&sample.to_le_bytes());
        }
        for _ in 0..5 {
            socket
                .send(Message::Binary(
                    encode_audio_frame(&pcm, false)
                        .expect("encode audio")
                        .into(),
                ))
                .await
                .expect("send audio");
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        socket
            .send(Message::Binary(
                encode_audio_frame(&[], true)
                    .expect("encode final audio")
                    .into(),
            ))
            .await
            .expect("finish audio");

        tokio::time::timeout(Duration::from_secs(30), async {
            loop {
                let message = socket
                    .next()
                    .await
                    .expect("Doubao closed before final response")
                    .expect("read Doubao response");
                if let Message::Binary(data) = message {
                    let response = parse_response(&data).expect("parse Doubao response");
                    assert_eq!(response.code, 0, "{}", response.error);
                    if response.is_last {
                        break;
                    }
                }
            }
        })
        .await
        .expect("wait for final response");
        println!("live Doubao session passed; logid={log_id}");
    }
}
