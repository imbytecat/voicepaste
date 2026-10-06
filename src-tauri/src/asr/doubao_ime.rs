pub(crate) mod device;
mod protocol;

pub(super) async fn organize(token: &str, text: &str) -> Result<String, String> {
    device::organize(token, text).await
}

pub(super) async fn translate(token: &str, text: &str, to_english: bool) -> Result<String, String> {
    device::translate(token, text, to_english).await
}

use std::{fmt::Write, time::Duration};

use futures_util::{Sink, SinkExt, StreamExt};
use opus::{Application, Channels, Encoder};
use prost::Message as ProstMessage;
use serde_json::json;
use tokio::sync::mpsc;
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async_with_config,
    tungstenite::{
        Error as WebSocketError, Message, client::IntoClientRequest, http::HeaderValue,
        protocol::WebSocketConfig,
    },
};
use uuid::Uuid;

use super::{AsrOutcome, AudioCommand, ServiceIssue};
use protocol::{MAX_MESSAGE_BYTES, Request, Response, Transcript};

const ENDPOINT: &str = "wss://frontier-audio-ime-ws.doubao.com/ocean/api/v1/ws";
// Public application routing identifier from the 1.4.6 client, not a user credential.
const APPLICATION_KEY: &str = "OrnqKvSSrs";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_AUDIO_CHUNK: usize = 64 * 1024;
const SAMPLES_PER_FRAME: usize = 320;
const PCM_FRAME_BYTES: usize = SAMPLES_PER_FRAME * 2;
const MAX_OPUS_PACKET: usize = 1275;
type Socket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

pub(super) async fn run(
    account_token: Option<String>,
    mut commands: mpsc::Receiver<AudioCommand>,
    on_partial: &mut (impl FnMut(&str) + Send),
) -> Result<AsrOutcome, ServiceIssue> {
    let has_account = account_token.is_some();
    let (socket, request_id) = open(account_token.as_deref()).await?;
    let (mut writer, mut reader) = socket.split();
    let mut audio = AudioFrames::new(&request_id)?;
    let mut transcript = Transcript::default();
    let mut finishing = false;
    let mut deadline = tokio::time::Instant::now() + RESPONSE_TIMEOUT;
    loop {
        tokio::select! {
            _ = tokio::time::sleep_until(deadline) => {
                return Err(ServiceIssue::network(if finishing {
                    "等待豆包输入法最终结果超时；没有使用临时结果"
                } else {
                    "豆包输入法长时间未返回响应"
                }));
            }
            command = commands.recv(), if !finishing => {
                match command {
                    Some(AudioCommand::Data(pcm)) => {
                        audio.push(&pcm, &mut writer, has_account).await?;
                    }
                    Some(AudioCommand::Finish) => {
                        audio.finish(&mut writer, has_account).await?;
                        send(&mut writer, control_message("FinishSession", &request_id, APPLICATION_KEY), has_account).await?;
                        finishing = true;
                        deadline = tokio::time::Instant::now() + RESPONSE_TIMEOUT;
                    }
                    None => return Err(ServiceIssue::unknown("录音数据流未正常结束")),
                }
            }
            incoming = reader.next() => {
                match incoming {
                    Some(Ok(Message::Binary(data))) => {
                        let response = Response::parse(&data, &request_id, has_account)?;
                        if let Some(text) = transcript.apply(&response)? {
                            on_partial(&text);
                        }
                        if response.event == "SessionFinished" {
                            if !finishing {
                                return Err(ServiceIssue::unknown("豆包输入法在音频发送完成前结束了会话"));
                            }
                            return transcript.finish().map(AsrOutcome::Text);
                        }
                        if matches!(response.event.as_str(), "TaskStarted" | "SessionStarted") {
                            return Err(ServiceIssue::unknown("豆包输入法重复启动了语音会话"));
                        }
                        if !finishing {
                            deadline = tokio::time::Instant::now() + RESPONSE_TIMEOUT;
                        }
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        send(&mut writer, Message::Pong(payload), has_account).await?;
                        if !finishing {
                            deadline = tokio::time::Instant::now() + RESPONSE_TIMEOUT;
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        return Err(ServiceIssue::network("豆包输入法在确认最终结果前关闭了连接"));
                    }
                    Some(Err(error)) => return Err(socket_issue(&error, has_account)),
                    Some(Ok(Message::Text(_))) => {
                        return Err(ServiceIssue::unknown("豆包输入法返回了非二进制响应"));
                    }
                    _ => {}
                }
            }
        }
    }
}

pub(super) async fn test_connection(account_token: Option<String>) -> Result<(), ServiceIssue> {
    let (sender, receiver) = mpsc::channel(1);
    sender
        .try_send(AudioCommand::Finish)
        .map_err(|_| ServiceIssue::unknown("无法创建语音连接测试"))?;
    // Initial acknowledgements can precede a backend failure. Require the
    // service to finish this no-audio session before reporting it as verified.
    run(account_token, receiver, &mut |_| {}).await.map(|_| ())
}

async fn open(account_token: Option<&str>) -> Result<(Socket, String), ServiceIssue> {
    let account_header = account_token
        .map(|token| {
            if token.trim().is_empty() || token.len() > 16 * 1024 {
                return Err(ServiceIssue::login_required("已选择的账号凭据无效"));
            }
            let mut header = HeaderValue::from_str(token)
                .map_err(|_| ServiceIssue::login_required("已选择的账号凭据格式无效"))?;
            header.set_sensitive(true);
            Ok(header)
        })
        .transpose()?;
    let has_account = account_header.is_some();
    let device_id = device::device_id().await?;
    let mut url = reqwest::Url::parse(ENDPOINT)
        .map_err(|_| ServiceIssue::unknown("豆包输入法服务地址无效"))?;
    url.query_pairs_mut()
        .extend_pairs([("aid", "401734"), ("device_id", device_id.as_ref())]);
    let mut request = url
        .as_str()
        .into_client_request()
        .map_err(|_| ServiceIssue::unknown("无法创建豆包输入法连接请求"))?;
    for (name, value) in [
        ("user-agent", device::USER_AGENT),
        ("proto-version", "v2"),
        ("sdk-version", "2"),
        ("x-custom-keepalive", "true"),
    ] {
        request
            .headers_mut()
            .insert(name, HeaderValue::from_static(value));
    }
    if let Some(header) = account_header {
        request.headers_mut().insert("x-tt-token", header);
    }
    let config = WebSocketConfig::default()
        .read_buffer_size(32 * 1024)
        .write_buffer_size(32 * 1024)
        .max_write_buffer_size(256 * 1024)
        .max_message_size(Some(MAX_MESSAGE_BYTES))
        .max_frame_size(Some(MAX_MESSAGE_BYTES));
    let (mut socket, _) = tokio::time::timeout(
        CONNECT_TIMEOUT,
        connect_async_with_config(request, Some(config), false),
    )
    .await
    .map_err(|_| ServiceIssue::network("连接豆包输入法语音超时"))?
    .map_err(|error| socket_issue(&error, has_account))?;
    let request_id = Uuid::new_v4().to_string();
    send(
        &mut socket,
        control_message("StartTask", &request_id, APPLICATION_KEY),
        has_account,
    )
    .await?;
    expect_event(&mut socket, &request_id, "TaskStarted", has_account).await?;
    let mut session = Request::control("StartSession", &request_id, APPLICATION_KEY);
    session.payload = json!({
        "audio_info": { "channel": 1, "format": "speech_opus", "sample_rate": 16000 },
        "enable_punctuation": true,
        "enable_speech_rejection": false,
        "extra": {
            "app_name": "com.android.chrome", "cell_compress_rate": 8,
            "did": device_id.as_ref(),
            "enable_asr_threepass": true, "enable_asr_twopass": true, "input_mode": "tool"
        }
    })
    .to_string();
    send(
        &mut socket,
        Message::Binary(session.encode_to_vec().into()),
        has_account,
    )
    .await?;
    expect_event(&mut socket, &request_id, "SessionStarted", has_account).await?;
    Ok((socket, request_id))
}

fn control_message(method: &str, request_id: &str, app_key: &str) -> Message {
    Message::Binary(
        Request::control(method, request_id, app_key)
            .encode_to_vec()
            .into(),
    )
}

async fn expect_event(
    socket: &mut Socket,
    request_id: &str,
    event: &str,
    has_account: bool,
) -> Result<(), ServiceIssue> {
    tokio::time::timeout(CONNECT_TIMEOUT, async {
        while let Some(message) = socket.next().await {
            match message.map_err(|error| socket_issue(&error, has_account))? {
                Message::Binary(data) => {
                    let response = Response::parse(&data, request_id, has_account)?;
                    if response.event == event {
                        return Ok(());
                    }
                    if !response.event.is_empty() || !response.result_json.is_empty() {
                        return Err(ServiceIssue::unknown("豆包输入法语音初始化事件顺序无效"));
                    }
                }
                Message::Ping(payload) => send(socket, Message::Pong(payload), has_account).await?,
                Message::Close(_) => break,
                Message::Text(_) => {
                    return Err(ServiceIssue::unknown("豆包输入法初始化返回了非二进制响应"));
                }
                _ => {}
            }
        }
        Err(ServiceIssue::network(
            "豆包输入法在语音初始化完成前关闭了连接",
        ))
    })
    .await
    .map_err(|_| ServiceIssue::network("等待豆包输入法语音初始化响应超时"))?
}

async fn send<S>(writer: &mut S, message: Message, has_account: bool) -> Result<(), ServiceIssue>
where
    S: Sink<Message, Error = WebSocketError> + Unpin,
{
    tokio::time::timeout(CONNECT_TIMEOUT, writer.send(message))
        .await
        .map_err(|_| ServiceIssue::network("向豆包输入法发送语音请求超时"))?
        .map_err(|error| socket_issue(&error, has_account))
}

fn socket_issue(error: &WebSocketError, has_account: bool) -> ServiceIssue {
    match error {
        WebSocketError::Http(response) => http_issue(response.status().as_u16(), has_account),
        _ => ServiceIssue::network("豆包输入法 WebSocket 连接中断；没有使用不完整结果"),
    }
}

fn http_issue(status: u16, has_account: bool) -> ServiceIssue {
    let detail = format!("HTTP {status}");
    match status {
        401 if has_account => ServiceIssue::login_required(detail),
        401 | 403 => ServiceIssue::new("unauthorized", "豆包输入法拒绝了设备或服务凭据", detail),
        429 => ServiceIssue::new("rateLimited", "豆包输入法请求过于频繁，请稍后重试", detail),
        500..=599 => ServiceIssue::new("server", "豆包输入法服务暂时不可用", detail),
        _ => ServiceIssue::unknown(detail),
    }
}

struct AudioFrames {
    encoder: Encoder,
    pending: [u8; PCM_FRAME_BYTES],
    used: usize,
    samples: [i16; SAMPLES_PER_FRAME],
    request: Request,
    next_timestamp: u64,
    next_sequence: u64,
}

impl AudioFrames {
    fn new(request_id: &str) -> Result<Self, ServiceIssue> {
        let encoder = Encoder::new(16_000, Channels::Mono, Application::Audio)
            .map_err(|_| ServiceIssue::unknown("无法初始化 Opus 语音编码器"))?;
        let mut request = Request::control("TaskRequest", request_id, "");
        request.audio_data = Vec::with_capacity(MAX_OPUS_PACKET);
        request.payload = String::with_capacity(64);
        Ok(Self {
            encoder,
            pending: [0; PCM_FRAME_BYTES],
            used: 0,
            samples: [0; SAMPLES_PER_FRAME],
            request,
            next_timestamp: device::timestamp_ms()?,
            next_sequence: 1,
        })
    }

    async fn push<S>(
        &mut self,
        mut pcm: &[u8],
        writer: &mut S,
        has_account: bool,
    ) -> Result<(), ServiceIssue>
    where
        S: Sink<Message, Error = WebSocketError> + Unpin,
    {
        if pcm.len() > MAX_AUDIO_CHUNK {
            return Err(ServiceIssue::unknown("单个录音分片超过 64 KiB 限制"));
        }
        while !pcm.is_empty() {
            let count = pcm.len().min(PCM_FRAME_BYTES - self.used);
            self.pending[self.used..self.used + count].copy_from_slice(&pcm[..count]);
            self.used += count;
            pcm = &pcm[count..];
            if self.used == PCM_FRAME_BYTES {
                self.encode(writer, has_account).await?;
                self.used = 0;
            }
        }
        Ok(())
    }

    async fn finish<S>(&mut self, writer: &mut S, has_account: bool) -> Result<(), ServiceIssue>
    where
        S: Sink<Message, Error = WebSocketError> + Unpin,
    {
        if !self.used.is_multiple_of(2) {
            return Err(ServiceIssue::unknown(
                "录音以不完整的 16 位采样结束；没有截断尾部",
            ));
        }
        if self.used != 0 {
            self.pending[self.used..].fill(0);
            self.encode(writer, has_account).await?;
            self.used = 0;
        }
        if self.next_sequence > 1 {
            // Flush Opus lookahead. FinishSession ends the stream; field 9 is a sequence, not a LAST flag.
            self.pending.fill(0);
            self.encode(writer, has_account).await?;
        }
        Ok(())
    }

    async fn encode<S>(&mut self, writer: &mut S, has_account: bool) -> Result<(), ServiceIssue>
    where
        S: Sink<Message, Error = WebSocketError> + Unpin,
    {
        for (sample, bytes) in self.samples.iter_mut().zip(self.pending.as_chunks::<2>().0) {
            *sample = i16::from_le_bytes(*bytes);
        }
        self.request.audio_data.resize(MAX_OPUS_PACKET, 0);
        let length = self
            .encoder
            .encode(&self.samples, &mut self.request.audio_data)
            .map_err(|_| ServiceIssue::unknown("Opus 语音编码失败"))?;
        self.request.audio_data.truncate(length);
        self.request.sequence_id = self.next_sequence;
        self.request.payload.clear();
        write!(
            &mut self.request.payload,
            "{{\"extra\":{{}},\"timestamp_ms\":{}}}",
            self.next_timestamp
        )
        .map_err(|_| ServiceIssue::unknown("无法编码语音帧时间戳"))?;
        send(
            writer,
            Message::Binary(self.request.encode_to_vec().into()),
            has_account,
        )
        .await?;
        self.next_timestamp = self
            .next_timestamp
            .checked_add(20)
            .ok_or_else(|| ServiceIssue::unknown("语音帧时间戳超出范围"))?;
        self.next_sequence = self
            .next_sequence
            .checked_add(1)
            .ok_or_else(|| ServiceIssue::unknown("语音帧序号超出范围"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn packets(chunks: &[&[u8]]) -> Result<Vec<Request>, ServiceIssue> {
        let mut messages = Vec::new();
        {
            let mut writer = Box::pin(futures_util::sink::unfold(
                &mut messages,
                |messages, message| async move {
                    messages.push(message);
                    Ok::<_, WebSocketError>(messages)
                },
            ));
            let mut audio = AudioFrames::new("packet-test")?;
            for chunk in chunks {
                audio.push(chunk, &mut writer, false).await?;
            }
            audio.finish(&mut writer, false).await?;
        }
        messages
            .into_iter()
            .map(|message| match message {
                Message::Binary(data) => {
                    Request::decode(data).map_err(|_| ServiceIssue::unknown("invalid test frame"))
                }
                _ => Err(ServiceIssue::unknown("unexpected test frame")),
            })
            .collect()
    }

    #[test]
    fn opus_preserves_pcm_across_odd_chunk_boundaries_and_flushes_tail() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap();
        runtime.block_on(async {
            let pcm: Vec<u8> = (0..777_i16)
                .flat_map(|sample| ((sample % 100) * 200).to_le_bytes())
                .collect();
            let whole = packets(&[&pcm]).await.unwrap();
            let split = packets(&[&pcm[..1], &pcm[1..639], &pcm[639..641], &pcm[641..]])
                .await
                .unwrap();
            let data = |packets: Vec<Request>| {
                packets
                    .into_iter()
                    .map(|packet| (packet.sequence_id, packet.audio_data))
                    .collect::<Vec<_>>()
            };
            assert_eq!(data(whole), data(split));
            let frames = packets(&[&pcm]).await.unwrap();
            assert_eq!(
                frames
                    .iter()
                    .map(|frame| frame.sequence_id)
                    .collect::<Vec<_>>(),
                [1, 2, 3, 4]
            );
            assert!(packets(&[&pcm[..pcm.len() - 1]]).await.is_err());
            assert!(packets(&[]).await.unwrap().is_empty());
        });
    }
}
