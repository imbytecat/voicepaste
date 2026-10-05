use std::io::{Read, Write};

use flate2::{Compression, read::GzDecoder, write::GzEncoder};
use futures_util::{Sink, SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::{sync::mpsc, time::Duration};
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

use super::{AsrOutcome, AudioCommand, IssueLink, ServiceIssue};

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

fn link(label: &'static str, target: &'static str) -> IssueLink {
    IssueLink { label, target }
}

fn handshake_detail(
    response: &tokio_tungstenite::tungstenite::http::Response<Option<Vec<u8>>>,
) -> String {
    // Never display response bodies or echoed headers containing credentials.
    format!("HTTP {}", response.status().as_u16())
}

/// Turns a WebSocket handshake or transport failure into actionable guidance.
pub fn connect_issue(error: &WebSocketError) -> ServiceIssue {
    let WebSocketError::Http(response) = error else {
        return ServiceIssue::new(
            "network",
            "无法连接火山引擎语音服务",
            "WebSocket 网络连接失败",
        )
        .with_guidance(
            vec![
                "确认这台电脑可以访问 openspeech.bytedance.com",
                "如果使用代理或公司网络，允许 VoicePaste 的 WebSocket 连接",
                "网络恢复后回到这里重新测试",
            ],
            Vec::new(),
        );
    };
    let detail = handshake_detail(response);
    match response.status().as_u16() {
        403 => ServiceIssue::new(
            "notActivated",
            "账号还没有开通「语音识别大模型 · 流式」，或这个 API Key 没有该服务权限",
            detail,
        )
        .with_guidance(
            vec![
                "在火山引擎语音控制台开通「语音识别大模型」的流式语音识别服务",
                "在 API Key 详情里确认这个 Key 已勾选该服务",
                "刚开通的服务可能需要一两分钟生效，之后回到这里重新测试",
            ],
            vec![
                link("打开语音控制台", "speechConsole"),
                link("检查 API Key 权限", "apiKeyConsole"),
                link("查看接入文档", "serviceDocs"),
            ],
        ),
        401 => ServiceIssue::new("unauthorized", "API Key 无效或已停用", detail).with_guidance(
            vec![
                "确认 API Key 完整复制，没有多余空格或换行",
                "在控制台确认这个 Key 仍然是启用状态",
                "必要时重新生成一个 API Key 再填回来",
            ],
            vec![link("打开 API Key 管理", "apiKeyConsole")],
        ),
        429 => ServiceIssue::new("rateLimited", "豆包语音的并发或配额已用满", detail)
            .with_guidance(
                vec![
                    "等当前请求结束后重试",
                    "在控制台查看并调整该服务的并发与配额",
                ],
                vec![link("打开语音控制台", "speechConsole")],
            ),
        status if status >= 500 => ServiceIssue::new("server", "豆包语音服务暂时不可用", detail)
            .with_guidance(
                vec![
                    "这是服务端故障，稍后重试即可",
                    "持续失败可带下面的技术详情联系火山引擎支持",
                ],
                Vec::new(),
            ),
        _ => ServiceIssue::new("unknown", "豆包语音拒绝了这次连接", detail).with_guidance(
            vec!["带上下面的技术详情检查控制台配置或联系火山引擎支持"],
            vec![link("打开语音控制台", "speechConsole")],
        ),
    }
}

/// Turns an in-band v3 error code into guidance. Codes come from the official
/// 大模型流式语音识别 API error table.
fn api_issue(code: u32) -> ServiceIssue {
    let detail = format!("错误码 {code}");
    match code {
        45_000_001 => ServiceIssue::new("unknown", "豆包语音认为请求参数无效", detail),
        45_000_002 => ServiceIssue::new("unknown", "没有采集到语音，请靠近麦克风后重试", detail),
        45_000_081 => ServiceIssue::new("network", "语音数据上传中断，请重试", detail),
        45_000_151 => ServiceIssue::new("unknown", "音频格式不被支持", detail),
        55_000_031 => ServiceIssue::new("server", "豆包语音服务器繁忙，请稍后重试", detail),
        code if (55_000_000..=55_999_999).contains(&code) => {
            ServiceIssue::new("server", "豆包语音服务内部错误，请稍后重试", detail)
        }
        _ => ServiceIssue::unknown(detail),
    }
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
    boosting_table_id: String,
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
        let mut header =
            HeaderValue::from_str(value).map_err(|_| "火山引擎请求头格式无效".to_owned())?;
        header.set_sensitive(name == "x-api-key");
        request
            .headers_mut()
            .insert(HeaderName::from_static(name), header);
    }
    Ok(request)
}

pub(super) async fn run(
    api_key: String,
    hotword_table_id: Option<String>,
    mut commands: mpsc::Receiver<AudioCommand>,
    on_partial: &mut (impl FnMut(&str) + Send),
) -> Result<AsrOutcome, ServiceIssue> {
    let connection_id = Uuid::new_v4().to_string();
    let request = connection_request(&api_key, &connection_id)?;
    let (socket, _) = tokio::time::timeout(
        CONNECT_TIMEOUT,
        connect_async_with_config(request, Some(socket_config()), false),
    )
    .await
    .map_err(|_| ServiceIssue::network("连接火山引擎语音超时"))?
    .map_err(|error| connect_issue(&error))?;
    let (mut writer, mut reader) = socket.split();
    send_message(
        &mut writer,
        Message::Binary(
            encode_full_request(&connection_id, hotword_table_id.as_deref())
                .map_err(ServiceIssue::unknown)?
                .into(),
        ),
        "发送火山引擎初始化请求",
    )
    .await?;

    let mut finishing = false;
    let mut deadline = tokio::time::Instant::now() + FINAL_TIMEOUT;
    loop {
        tokio::select! {
            _ = tokio::time::sleep_until(deadline) => {
                return Err(ServiceIssue::network(if finishing {
                    "等待火山引擎最终结果超时"
                } else {
                    "火山引擎长时间未返回响应"
                }));
            }
            command = commands.recv(), if !finishing => {
                match command {
                    Some(AudioCommand::Data(pcm)) => {
                        send_message(
                            &mut writer,
                            Message::Binary(encode_audio_frame(&pcm, false)
                                .map_err(ServiceIssue::unknown)?.into()),
                            "发送语音数据",
                        ).await?;
                    }
                    Some(AudioCommand::Finish) => {
                        send_message(
                            &mut writer,
                            Message::Binary(encode_audio_frame(&[], true)
                                .map_err(ServiceIssue::unknown)?.into()),
                            "结束语音流",
                        ).await?;
                        finishing = true;
                        deadline = tokio::time::Instant::now() + FINAL_TIMEOUT;
                    }
                    None => return Err(ServiceIssue::unknown("录音数据流未正常结束")),
                }
            }
            incoming = reader.next() => {
                match incoming {
                    Some(Ok(Message::Binary(data))) => {
                        let response = parse_response(&data).map_err(ServiceIssue::unknown)?;
                        if response.code != 0 {
                            return Err(api_issue(response.code));
                        }
                        if response.is_last {
                            if !finishing {
                                return Err(ServiceIssue::unknown("语音服务在录音结束前关闭了识别任务"));
                            }
                            return Ok(AsrOutcome::Text(response.text));
                        }
                        if !response.text.is_empty() {
                            on_partial(&response.text);
                        }
                        if !finishing {
                            deadline = tokio::time::Instant::now() + FINAL_TIMEOUT;
                        }
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        send_message(&mut writer, Message::Pong(payload), "回应语音心跳").await?;
                        if !finishing {
                            deadline = tokio::time::Instant::now() + FINAL_TIMEOUT;
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        return Err(ServiceIssue::network("火山引擎连接在最终结果前关闭"));
                    }
                    Some(Err(error)) => return Err(connect_issue(&error)),
                    Some(Ok(Message::Text(_))) => {
                        return Err(ServiceIssue::unknown("火山引擎返回了非二进制响应"));
                    }
                    _ => {}
                }
            }
        }
    }
}

fn connection_request(api_key: &str, connection_id: &str) -> Result<HttpRequest<()>, ServiceIssue> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err(ServiceIssue::new(
            "unauthorized",
            "请先填写火山引擎 API Key",
            "本机未填写 API Key",
        ));
    }
    build_connection_request(api_key, connection_id).map_err(ServiceIssue::unknown)
}

pub(super) async fn test_connection(
    api_key: String,
    hotword_table_id: Option<String>,
) -> Result<(), ServiceIssue> {
    let connection_id = Uuid::new_v4().to_string();
    let request = connection_request(&api_key, &connection_id)?;
    let (socket, _) = tokio::time::timeout(
        CONNECT_TIMEOUT,
        connect_async_with_config(request, Some(socket_config()), false),
    )
    .await
    .map_err(|_| ServiceIssue::network("连接火山引擎语音超时"))?
    .map_err(|error| connect_issue(&error))?;
    let (mut writer, mut reader) = socket.split();
    for frame in [
        encode_full_request(&connection_id, hotword_table_id.as_deref()),
        encode_audio_frame(&[], true),
    ] {
        send_message(
            &mut writer,
            Message::Binary(frame.map_err(ServiceIssue::unknown)?.into()),
            "发送火山引擎测试请求",
        )
        .await?;
    }

    tokio::time::timeout(CONNECT_TIMEOUT, async {
        while let Some(message) = reader.next().await {
            match message.map_err(|error| connect_issue(&error))? {
                Message::Binary(data) => {
                    let response = parse_response(&data).map_err(ServiceIssue::unknown)?;
                    if response.code != 0 {
                        return Err(api_issue(response.code));
                    }
                    return Ok(());
                }
                Message::Ping(payload) => {
                    send_message(&mut writer, Message::Pong(payload), "回应测试心跳").await?;
                }
                Message::Close(_) => break,
                Message::Text(_) => {
                    return Err(ServiceIssue::unknown("火山引擎返回了非二进制响应"));
                }
                _ => {}
            }
        }
        Err(ServiceIssue::network("火山引擎在测试结果前关闭了连接"))
    })
    .await
    .map_err(|_| ServiceIssue::network("等待火山引擎测试结果超时"))?
}

async fn send_message<S>(writer: &mut S, message: Message, action: &str) -> Result<(), ServiceIssue>
where
    S: Sink<Message, Error = WebSocketError> + Unpin,
{
    tokio::time::timeout(WRITE_TIMEOUT, writer.send(message))
        .await
        .map_err(|_| ServiceIssue::network(format!("{action}超时")))?
        .map_err(|error| connect_issue(&error))
}

fn encode_full_request(
    connection_id: &str,
    hotword_table_id: Option<&str>,
) -> Result<Vec<u8>, String> {
    let use_hotwords = hotword_table_id.is_some();
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
            corpus: hotword_table_id.map(|table_id| Corpus {
                boosting_table_id: table_id.to_owned(),
            }),
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
    if message[0] >> 4 != 1 {
        return Err("火山引擎响应协议版本无效".to_owned());
    }
    let header_size = usize::from(message[0] & 0x0f) * 4;
    if header_size < 4 || header_size > message.len() {
        return Err("豆包响应头长度无效".to_owned());
    }

    let message_type = message[1] >> 4;
    let flags = message[1] & 0x0f;
    let compression = message[2] & 0x0f;
    if flags & 0x08 != 0 || !matches!(compression, COMPRESSION_NONE | COMPRESSION_GZIP) {
        return Err("火山引擎响应标记或压缩格式无效".to_owned());
    }
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
        is_last: flags & 0x02 != 0,
        text: String::new(),
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
            if payload.len() != 4 + payload_size {
                return Err("火山引擎响应长度与实际内容不符".to_owned());
            }
            let body = payload
                .get(4..4 + payload_size)
                .ok_or_else(|| "豆包响应内容不完整".to_owned())?;
            if body.is_empty() {
                return Ok(response);
            }
            let body = decode_body(body, compression)?;
            let decoded: ResponsePayload = serde_json::from_slice(&body)
                .map_err(|_| "火山引擎识别 JSON 结构无效".to_owned())?;
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
            if payload.len() != 8 + payload_size || response.code == 0 {
                return Err("火山引擎错误响应无效".to_owned());
            }
        }
        _ => return Err("火山引擎返回了未知消息类型".to_owned()),
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

    #[test]
    fn malformed_messages_cannot_pass_connection_test() {
        assert!(parse_response(&[0x11, 0x82, 0, 0, 0, 0, 0, 0]).is_err());
        assert!(parse_response(&[0x11, 0x92, 0, 0, 0, 0, 0, 2, b'{']).is_err());
        assert!(parse_response(&[0x11, 0x92, 0, 0, 0, 0, 0, 0, 1]).is_err());
        let compressed = gzip(&vec![b' '; MAX_DECOMPRESSED_BYTES + 1]).unwrap();
        assert!(gunzip(&compressed).is_err());
    }
}
