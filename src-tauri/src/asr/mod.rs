mod doubao_ime;
mod volcengine;

use std::{fmt, future::Future};

use serde::Serialize;
use tokio::sync::{mpsc, watch};

pub enum SessionConfig {
    Volcengine {
        api_key: String,
        hotword_table_id: Option<String>,
    },
    DoubaoIme {
        account_token: Option<String>,
    },
}

pub enum AudioCommand {
    /// Little-endian signed 16-bit PCM, 16 kHz, mono.
    Data(Vec<u8>),
    Finish,
}

#[derive(Debug, PartialEq, Eq)]
pub enum AsrOutcome {
    Text(String),
    Cancelled,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceIssue {
    pub kind: &'static str,
    pub title: String,
    pub detail: String,
    pub steps: Vec<&'static str>,
    pub links: Vec<IssueLink>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueLink {
    pub label: &'static str,
    pub target: &'static str,
}

impl ServiceIssue {
    pub fn new(kind: &'static str, title: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            kind,
            title: title.into(),
            detail: detail.into(),
            steps: Vec::new(),
            links: Vec::new(),
        }
    }

    fn with_guidance(mut self, steps: Vec<&'static str>, links: Vec<IssueLink>) -> Self {
        self.steps = steps;
        self.links = links;
        self
    }

    pub fn unknown(detail: impl Into<String>) -> Self {
        Self::new("unknown", "语音服务返回了未预期的结果", detail)
    }

    pub fn network(detail: impl Into<String>) -> Self {
        Self::new("network", "无法连接语音服务", detail).with_guidance(
            vec![
                "检查网络和代理是否允许 VoicePaste 的 HTTPS / WebSocket 连接",
                "网络恢复后重新测试",
            ],
            Vec::new(),
        )
    }

    pub fn login_required(detail: impl Into<String>) -> Self {
        Self::new("loginRequired", "豆包账号需要重新登录", detail).with_guidance(
            vec!["重新登录豆包账号，或明确退出账号后使用访客识别"],
            Vec::new(),
        )
    }

    pub fn credential_storage(detail: impl Into<String>) -> Self {
        Self::new("credentialStorage", "无法访问系统凭据存储", detail).with_guidance(
            vec![
                "解锁或启用系统钥匙串 / 凭据管理器后重试",
                "不会把凭据改存为明文",
            ],
            Vec::new(),
        )
    }

    pub fn message(&self) -> String {
        self.title.clone()
    }
}

impl fmt::Display for ServiceIssue {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.title)
    }
}

impl std::error::Error for ServiceIssue {}

/// Cancellation drops the whole network future, including pending reads/writes.
/// Device initialization already in flight finishes its durable keyring commit.
pub async fn run(
    config: SessionConfig,
    commands: mpsc::Receiver<AudioCommand>,
    cancelled: watch::Receiver<bool>,
    mut on_partial: impl FnMut(&str) + Send,
) -> Result<AsrOutcome, ServiceIssue> {
    cancellable(cancelled, async move {
        match config {
            SessionConfig::Volcengine {
                api_key,
                hotword_table_id,
            } => volcengine::run(api_key, hotword_table_id, commands, &mut on_partial).await,
            SessionConfig::DoubaoIme { account_token } => {
                doubao_ime::run(account_token, commands, &mut on_partial).await
            }
        }
    })
    .await
}

async fn cancellable(
    mut cancelled: watch::Receiver<bool>,
    operation: impl Future<Output = Result<AsrOutcome, ServiceIssue>>,
) -> Result<AsrOutcome, ServiceIssue> {
    if *cancelled.borrow() {
        return Ok(AsrOutcome::Cancelled);
    }
    tokio::pin!(operation);
    loop {
        tokio::select! {
            biased;
            changed = cancelled.changed() => {
                if changed.is_err() || *cancelled.borrow_and_update() {
                    return Ok(AsrOutcome::Cancelled);
                }
            }
            result = &mut operation => return result,
        }
    }
}

/// Opens a real service session without capturing or uploading microphone audio.
pub async fn test_connection(config: SessionConfig) -> Result<(), ServiceIssue> {
    match config {
        SessionConfig::Volcengine {
            api_key,
            hotword_table_id,
        } => volcengine::test_connection(api_key, hotword_table_id).await,
        SessionConfig::DoubaoIme { account_token } => {
            doubao_ime::test_connection(account_token).await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn already_cancelled_never_starts_provider() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        runtime.block_on(async {
            let (_sender, cancelled) = watch::channel(true);
            let result = cancellable(cancelled, async {
                panic!("cancelled recognition must not start a network request");
            })
            .await
            .unwrap();
            assert_eq!(result, AsrOutcome::Cancelled);
        });
    }
}
