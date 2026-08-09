use std::io::{Read, Write};

use flate2::{Compression, read::GzDecoder, write::GzEncoder};
use futures_util::{Sink, SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tokio::{
    sync::{mpsc, watch},
    time::Duration,
};
use tokio_tungstenite::{
    connect_async_with_config,
    tungstenite::{
        Error as WebSocketError, Message,
        client::IntoClientRequest,
        http::{HeaderName, HeaderValue, Request as HttpRequest},
        protocol::WebSocketConfig,
    },
};
use uuid::Uuid;

use crate::settings::AppSettings;

const DOUBAO_ENDPOINT: &str = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async";
const DOUBAO_RESOURCE_ID: &str = "volc.seedasr.sauc.duration";
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
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const WRITE_TIMEOUT: Duration = Duration::from_secs(10);
const FINAL_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_AUDIO_BYTES: usize = 64 * 1024;
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_DECOMPRESSED_BYTES: usize = 4 * 1024 * 1024;

pub enum AudioCommand {
    Data(Vec<u8>),
    Finish,
}

pub enum AsrOutcome {
    Text(String),
    Cancelled,
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

enum ResponseProgress {
    Continue,
    Final(String),
}

fn install_crypto_provider() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}

fn socket_config() -> WebSocketConfig {
    WebSocketConfig::default()
        .read_buffer_size(32 * 1024)
        .write_buffer_size(32 * 1024)
        .max_write_buffer_size(256 * 1024)
        .max_message_size(Some(MAX_RESPONSE_BYTES))
        .max_frame_size(Some(MAX_RESPONSE_BYTES))
}

fn build_connection_request(api_key: &str, connection_id: &str) -> Result<HttpRequest<()>, String> {
    let mut request = DOUBAO_ENDPOINT
        .into_client_request()
        .map_err(|error| format!("创建豆包连接请求失败：{error}"))?;
    for (name, value) in [
        ("x-api-key", api_key),
        ("x-api-resource-id", DOUBAO_RESOURCE_ID),
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
    mut cancelled: watch::Receiver<bool>,
    app: AppHandle,
    session_id: String,
) -> Result<AsrOutcome, String> {
    install_crypto_provider();
    let connection_id = Uuid::new_v4().to_string();
    let request = build_connection_request(&settings.api_key, &connection_id)?;
    let connect = tokio::time::timeout(
        CONNECT_TIMEOUT,
        connect_async_with_config(request, Some(socket_config()), false),
    );
    tokio::pin!(connect);
    let (socket, response) = tokio::select! {
        result = &mut connect => result
            .map_err(|_| "连接豆包语音超时".to_owned())?
            .map_err(|error| format!("连接豆包语音失败：{error}"))?,
        changed = cancelled.changed() => {
            let _ = changed;
            return Ok(AsrOutcome::Cancelled);
        }
    };
    if let Some(log_id) = response
        .headers()
        .get("x-tt-logid")
        .and_then(|value| value.to_str().ok())
    {
        eprintln!("豆包语音连接 logid: {log_id}");
    }
    let (mut writer, mut reader) = socket.split();
    send_message(
        &mut writer,
        Message::Binary(encode_full_request(&settings, &connection_id)?.into()),
        "发送豆包初始化请求",
    )
    .await?;

    loop {
        tokio::select! {
            changed = cancelled.changed() => {
                let _ = changed;
                return Ok(AsrOutcome::Cancelled);
            }
            command = commands.recv() => {
                match command {
                    Some(AudioCommand::Data(pcm)) => {
                        send_message(
                            &mut writer,
                            Message::Binary(encode_audio_frame(&pcm, false)?.into()),
                            "发送语音数据",
                        ).await?;
                    }
                    Some(AudioCommand::Finish) | None => {
                        send_message(
                            &mut writer,
                            Message::Binary(encode_audio_frame(&[], true)?.into()),
                            "结束语音流",
                        ).await?;
                        break;
                    }
                }
            }
            incoming = reader.next() => {
                match incoming {
                    Some(Ok(Message::Binary(data))) => {
                        if let ResponseProgress::Final(text) = process_response(&app, &session_id, &data)? {
                            return Ok(AsrOutcome::Text(text));
                        }
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        send_message(&mut writer, Message::Pong(payload), "回应豆包心跳").await?;
                    }
                    Some(Ok(Message::Close(_))) | None => return Err("豆包语音连接提前关闭".to_owned()),
                    Some(Err(error)) => return Err(format!("读取豆包语音结果失败：{error}")),
                    _ => {}
                }
            }
        }
    }

    let final_result = tokio::time::timeout(FINAL_TIMEOUT, async {
        loop {
            tokio::select! {
                changed = cancelled.changed() => {
                    let _ = changed;
                    return Ok(AsrOutcome::Cancelled);
                }
                incoming = reader.next() => match incoming {
                    Some(Ok(Message::Binary(data))) => {
                        if let ResponseProgress::Final(text) = process_response(&app, &session_id, &data)? {
                            return Ok(AsrOutcome::Text(text));
                        }
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        send_message(&mut writer, Message::Pong(payload), "回应豆包心跳").await?;
                    }
                    Some(Ok(Message::Close(_))) | None => return Err("豆包未返回最终修正结果".to_owned()),
                    Some(Err(error)) => return Err(format!("读取豆包最终结果失败：{error}")),
                    _ => {}
                }
            }
        }
    })
    .await
    .map_err(|_| "等待豆包最终修正结果超时".to_owned())??;
    Ok(final_result)
}

pub async fn test_connection(api_key: String) -> Result<(), String> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("请先填写豆包 API Key".to_owned());
    }
    install_crypto_provider();
    let connection_id = Uuid::new_v4().to_string();
    let request = build_connection_request(api_key, &connection_id)?;
    let (socket, _) = tokio::time::timeout(
        CONNECT_TIMEOUT,
        connect_async_with_config(request, Some(socket_config()), false),
    )
    .await
    .map_err(|_| "连接豆包语音超时".to_owned())?
    .map_err(|error| format!("连接豆包语音失败：{error}"))?;
    let (mut writer, mut reader) = socket.split();
    let settings = AppSettings {
        api_key: api_key.to_owned(),
        ..AppSettings::default()
    };
    send_message(
        &mut writer,
        Message::Binary(encode_full_request(&settings, &connection_id)?.into()),
        "发送豆包初始化请求",
    )
    .await?;
    send_message(
        &mut writer,
        Message::Binary(encode_audio_frame(&[], true)?.into()),
        "发送豆包测试请求",
    )
    .await?;

    tokio::time::timeout(CONNECT_TIMEOUT, async {
        while let Some(message) = reader.next().await {
            match message.map_err(|error| format!("读取豆包测试结果失败：{error}"))? {
                Message::Binary(data) => {
                    let response = parse_response(&data)?;
                    if response.code != 0 {
                        return Err(if response.error.is_empty() {
                            format!("豆包语音返回错误码 {}", response.code)
                        } else {
                            format!("豆包语音错误：{}", response.error)
                        });
                    }
                    return Ok(());
                }
                Message::Close(_) => return Err("豆包语音连接提前关闭".to_owned()),
                _ => {}
            }
        }
        Err("豆包语音连接提前关闭".to_owned())
    })
    .await
    .map_err(|_| "豆包连接成功，但测试响应超时".to_owned())?
}

async fn send_message<S>(writer: &mut S, message: Message, action: &str) -> Result<(), String>
where
    S: Sink<Message, Error = WebSocketError> + Unpin,
{
    tokio::time::timeout(WRITE_TIMEOUT, writer.send(message))
        .await
        .map_err(|_| format!("{action}超时"))?
        .map_err(|error| format!("{action}失败：{error}"))
}

fn process_response(
    app: &AppHandle,
    session_id: &str,
    data: &[u8],
) -> Result<ResponseProgress, String> {
    let response = parse_response(data)?;
    if response.code != 0 {
        return Err(if response.error.is_empty() {
            format!("豆包语音返回错误码 {}", response.code)
        } else {
            format!("豆包语音错误：{}", response.error)
        });
    }

    if response.is_last {
        if !response.text.is_empty() {
            app.emit_to(
                "overlay",
                "asr-event",
                json!({ "kind": "final", "sessionId": session_id, "text": response.text }),
            )
            .map_err(|error| format!("发送最终识别结果失败：{error}"))?;
        }
        return Ok(ResponseProgress::Final(response.text));
    }
    if !response.text.is_empty() {
        app.emit_to(
            "overlay",
            "asr-event",
            json!({ "kind": "partial", "sessionId": session_id, "text": response.text }),
        )
        .map_err(|error| format!("发送实时识别结果失败：{error}"))?;
    }
    Ok(ResponseProgress::Continue)
}

fn encode_full_request(settings: &AppSettings, connection_id: &str) -> Result<Vec<u8>, String> {
    let use_hotwords = settings.hotwords_enabled && !settings.hotwords.is_empty();
    let corpus = if use_hotwords {
        Some(Corpus {
            context: serde_json::to_string(&json!({
                "hotwords": settings.hotwords.iter().map(|word| json!({ "word": word })).collect::<Vec<_>>()
            }))
            .map_err(|error| format!("编码热词失败：{error}"))?,
        })
    } else {
        None
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
            enable_ddc: !use_hotwords,
            show_utterances: false,
            result_type: "full",
            enable_nonstream: !use_hotwords,
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
    if pcm.len() > MAX_AUDIO_BYTES {
        return Err(format!(
            "单个音频分片超过 {} KiB 限制",
            MAX_AUDIO_BYTES / 1024
        ));
    }
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
    let payload_len = u32::try_from(compressed.len()).map_err(|_| "豆包请求过大".to_owned())?;
    let mut message = Vec::with_capacity(8 + compressed.len());
    message.extend_from_slice(&[
        0x11,
        (message_type << 4) | flags,
        (serialization << 4) | COMPRESSION_GZIP,
        0,
    ]);
    message.extend_from_slice(&payload_len.to_be_bytes());
    message.extend_from_slice(&compressed);
    Ok(message)
}

fn parse_response(message: &[u8]) -> Result<ServerResponse, String> {
    if message.len() > MAX_RESPONSE_BYTES {
        return Err("豆包响应超过大小限制".to_owned());
    }
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
            if payload_size > MAX_RESPONSE_BYTES {
                return Err("豆包响应内容超过大小限制".to_owned());
            }
            let body = payload
                .get(4..4 + payload_size)
                .ok_or_else(|| "豆包响应内容不完整".to_owned())?;
            if body.is_empty() {
                return Ok(response);
            }
            let body = decode_body(body, compression)?;
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
            if payload_size > MAX_RESPONSE_BYTES {
                return Err("豆包错误内容超过大小限制".to_owned());
            }
            let body = payload
                .get(8..8 + payload_size)
                .ok_or_else(|| "豆包错误响应内容不完整".to_owned())?;
            response.error = String::from_utf8_lossy(&decode_body(body, compression)?).into_owned();
        }
        _ => {}
    }
    Ok(response)
}

fn decode_body(body: &[u8], compression: u8) -> Result<Vec<u8>, String> {
    match compression {
        COMPRESSION_GZIP => gunzip(body),
        COMPRESSION_NONE => Ok(body.to_vec()),
        _ => Err(format!("不支持的豆包压缩格式：{compression}")),
    }
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
    let decoder = GzDecoder::new(data);
    let mut decoded = Vec::new();
    decoder
        .take((MAX_DECOMPRESSED_BYTES + 1) as u64)
        .read_to_end(&mut decoded)
        .map_err(|error| format!("解压豆包响应失败：{error}"))?;
    if decoded.len() > MAX_DECOMPRESSED_BYTES {
        return Err("豆包解压响应超过大小限制".to_owned());
    }
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
    fn new_console_auth_uses_fixed_resource_id() {
        let request = build_connection_request("new-api-key", "request-id").expect("build request");
        assert_eq!(request.headers()["x-api-key"], "new-api-key");
        assert_eq!(request.headers()["x-api-resource-id"], DOUBAO_RESOURCE_ID);
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
        assert_eq!(payload["request"]["enable_nonstream"], true);
        assert_eq!(payload["request"]["show_utterances"], false);
        assert_eq!(payload["request"]["enable_ddc"], true);
    }

    #[test]
    fn hotword_request_avoids_second_pass_overwrite() {
        let settings = AppSettings {
            hotwords: vec!["VoicePaste".to_owned()],
            ..AppSettings::default()
        };
        let frame = encode_full_request(&settings, "request-id").expect("encode request");
        let payload: serde_json::Value =
            serde_json::from_slice(&gunzip(&frame[8..]).expect("decompress request"))
                .expect("parse request");
        assert_eq!(payload["request"]["enable_nonstream"], false);
        assert_eq!(payload["request"]["enable_ddc"], false);
    }

    #[test]
    fn disabled_hotwords_are_preserved_but_not_sent() {
        let settings = AppSettings {
            hotwords: vec!["VoicePaste".to_owned()],
            hotwords_enabled: false,
            ..AppSettings::default()
        };
        let frame = encode_full_request(&settings, "request-id").expect("encode request");
        let payload: serde_json::Value =
            serde_json::from_slice(&gunzip(&frame[8..]).expect("decompress request"))
                .expect("parse request");
        assert!(payload["request"].get("corpus").is_none());
        assert_eq!(payload["request"]["enable_nonstream"], true);
        assert_eq!(payload["request"]["enable_ddc"], true);
    }
    #[test]
    fn parses_empty_final_response_as_final() {
        let payload = gzip(b"{}").expect("gzip response");
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
        assert!(response.text.is_empty());
    }

    #[test]
    fn rejects_oversized_audio_and_response() {
        assert!(encode_audio_frame(&vec![0; MAX_AUDIO_BYTES + 1], false).is_err());
        assert!(parse_response(&vec![0; MAX_RESPONSE_BYTES + 1]).is_err());
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
}
