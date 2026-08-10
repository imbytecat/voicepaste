use std::{collections::HashSet, fmt::Write as _, time::Duration};

use reqwest::{
    Client,
    multipart::{Form, Part},
    redirect::Policy,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const ENDPOINT: &str = "https://openspeech.bytedance.com/api/proxy/invoke/";
const VERSION: &str = "2022-08-30";
const TABLE_NAME: &str = "VoicePasteManagedV1";
pub const DEFAULT_TABLE_LIMIT: usize = 5000;
const DEFAULT_WORD_BYTES_LIMIT: usize = 30;
const DEFAULT_WORD_CHARS_LIMIT: usize = 10;
const SAVE_POLL_ATTEMPTS: usize = 30;
const SAVE_POLL_INTERVAL: Duration = Duration::from_millis(500);

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Binding {
    pub table_id: String,
    pub revision: String,
    pub limit: usize,
}

#[derive(Clone, Debug)]
pub struct Snapshot {
    pub binding: Option<Binding>,
    pub words: Vec<String>,
    pub limit: usize,
}

pub enum SyncOutcome {
    Saved(Snapshot),
    Conflict(Snapshot),
}

#[derive(Clone, Debug)]
struct Limits {
    table: usize,
    word_bytes: usize,
    word_chars: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            table: DEFAULT_TABLE_LIMIT,
            word_bytes: DEFAULT_WORD_BYTES_LIMIT,
            word_chars: DEFAULT_WORD_CHARS_LIMIT,
        }
    }
}

struct RemoteTable {
    id: String,
    revision: String,
    words: Vec<String>,
}

struct CloudState {
    app_id: Option<Value>,
    limits: Limits,
    table: Option<RemoteTable>,
}

pub fn normalize(words: Vec<String>) -> Result<Vec<String>, String> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for word in words {
        let word = word.trim();
        if word.is_empty() {
            continue;
        }
        if word.chars().any(char::is_whitespace) {
            return Err(format!("常用词“{word}”不能包含空格"));
        }
        if word.contains('|') {
            return Err(format!("常用词“{word}”不能包含 |"));
        }
        if seen.insert(word.to_lowercase()) {
            normalized.push(word.to_owned());
        }
    }
    Ok(normalized)
}

pub async fn inspect(api_key: &str) -> Result<Snapshot, String> {
    snapshot(load(api_key).await?)
}

pub async fn sync(
    api_key: &str,
    saved_words: &[String],
    desired_words: &[String],
    expected_binding: Option<&Binding>,
    force: bool,
) -> Result<SyncOutcome, String> {
    let client = client()?;
    let state = load_with_client(&client, api_key).await?;
    validate(desired_words, &state.limits)?;

    if !force
        && conflicts(
            state.table.as_ref().map(|table| table.words.as_slice()),
            saved_words,
            desired_words,
            expected_binding.is_some(),
        )
    {
        return Ok(SyncOutcome::Conflict(snapshot(state)?));
    }

    if desired_words.is_empty() {
        if let Some(table) = state.table {
            delete_table(&client, api_key, state.app_id.as_ref(), &table.id).await?;
            return Ok(SyncOutcome::Saved(snapshot(
                wait_for_words(&client, api_key, desired_words).await?,
            )?));
        }
        return Ok(SyncOutcome::Saved(Snapshot {
            binding: None,
            words: Vec::new(),
            limit: state.limits.table,
        }));
    }

    if state
        .table
        .as_ref()
        .is_some_and(|table| table.words == desired_words)
    {
        return Ok(SyncOutcome::Saved(snapshot(state)?));
    }

    match state.table {
        Some(table) => {
            update_table(
                &client,
                api_key,
                state.app_id.as_ref(),
                &table.id,
                desired_words,
            )
            .await?;
        }
        None => {
            create_table(&client, api_key, state.app_id.as_ref(), desired_words).await?;
        }
    }

    let saved = wait_for_words(&client, api_key, desired_words).await?;
    Ok(SyncOutcome::Saved(snapshot(saved)?))
}

fn client() -> Result<Client, String> {
    Client::builder()
        .redirect(Policy::limited(3))
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("创建豆包常用词连接失败：{error}"))
}

async fn load(api_key: &str) -> Result<CloudState, String> {
    let client = client()?;
    load_with_client(&client, api_key).await
}
async fn wait_for_words(
    client: &Client,
    api_key: &str,
    expected_words: &[String],
) -> Result<CloudState, String> {
    let mut last_error = None;
    for attempt in 0..SAVE_POLL_ATTEMPTS {
        match load_with_client(client, api_key).await {
            Ok(state)
                if state.table.as_ref().map(|table| table.words.as_slice())
                    == (!expected_words.is_empty()).then_some(expected_words) =>
            {
                return Ok(state);
            }
            Ok(_) => {}
            Err(error) => last_error = Some(error),
        }
        if attempt + 1 < SAVE_POLL_ATTEMPTS {
            tokio::time::sleep(SAVE_POLL_INTERVAL).await;
        }
    }
    Err(last_error.unwrap_or_else(|| "豆包已接受常用词更新，但云端词表尚未就绪，请重试".to_owned()))
}

async fn load_with_client(client: &Client, api_key: &str) -> Result<CloudState, String> {
    let list_body = json!({
        "Action": "ListBoostingTable",
        "Version": VERSION,
        "PageNumber": 1,
        "PageSize": 500,
        "PreviewSize": DEFAULT_TABLE_LIMIT,
    });
    let limits_body = json!({
        "Action": "ListBoostingTableLimits",
        "Version": VERSION,
    });
    let (list, limits) = tokio::try_join!(
        request_json(client, api_key, "ListBoostingTable", list_body),
        request_json(client, api_key, "ListBoostingTableLimits", limits_body),
    )?;
    let app_id = list.pointer("/Result/AppID").cloned();
    let limits = parse_limits(&limits);
    let summary = list
        .pointer("/Result/BoostingTables")
        .and_then(Value::as_array)
        .and_then(|tables| {
            tables.iter().find(|table| {
                string_field(table, "BoostingTableName").as_deref() == Some(TABLE_NAME)
            })
        });
    let Some(summary) = summary else {
        return Ok(CloudState {
            app_id,
            limits,
            table: None,
        });
    };
    Ok(CloudState {
        app_id,
        limits,
        table: Some(RemoteTable {
            id: required_string(summary, "BoostingTableID", "云端常用词表缺少 ID")?,
            revision: string_field(summary, "UpdateTime").unwrap_or_default(),
            words: summary
                .get("Preview")
                .and_then(Value::as_array)
                .map(|words| {
                    words
                        .iter()
                        .filter_map(Value::as_str)
                        .filter_map(parse_word)
                        .collect()
                })
                .unwrap_or_default(),
        }),
    })
}

async fn create_table(
    client: &Client,
    api_key: &str,
    app_id: Option<&Value>,
    words: &[String],
) -> Result<(), String> {
    let mut form = Form::new()
        .text("Action", "CreateBoostingTable")
        .text("Version", VERSION)
        .text("BoostingTableName", TABLE_NAME)
        .part("File", word_file(words)?);
    if let Some(app_id) = app_id {
        form = form.text("AppID", scalar(app_id));
    }
    request_multipart(client, api_key, "CreateBoostingTable", form).await?;
    Ok(())
}

async fn update_table(
    client: &Client,
    api_key: &str,
    app_id: Option<&Value>,
    table_id: &str,
    words: &[String],
) -> Result<(), String> {
    let mut form = Form::new()
        .text("Action", "UpdateBoostingTable")
        .text("Version", VERSION)
        .text("BoostingTableID", table_id.to_owned())
        .part("File", word_file(words)?);
    if let Some(app_id) = app_id {
        form = form.text("AppID", scalar(app_id));
    }
    request_multipart(client, api_key, "UpdateBoostingTable", form).await?;
    Ok(())
}

async fn delete_table(
    client: &Client,
    api_key: &str,
    app_id: Option<&Value>,
    table_id: &str,
) -> Result<(), String> {
    let mut body = base_body("DeleteBoostingTable", app_id);
    body["BoostingTableID"] = table_id.into();
    request_json(client, api_key, "DeleteBoostingTable", body).await?;
    Ok(())
}

fn word_file(words: &[String]) -> Result<Part, String> {
    Part::bytes(encode_file(words).into_bytes())
        .file_name("voicepaste-hotwords.txt")
        .mime_str("text/plain; charset=utf-8")
        .map_err(|error| format!("创建常用词文件失败：{error}"))
}

fn encode_file(words: &[String]) -> String {
    let mut file = String::new();
    for (index, word) in words.iter().enumerate() {
        if index > 0 {
            file.push('\n');
        }
        write!(file, "{word}|10").expect("writing to a String cannot fail");
    }
    file
}

fn base_body(action: &str, app_id: Option<&Value>) -> Value {
    let mut body = json!({"Action": action, "Version": VERSION});
    if let Some(app_id) = app_id {
        body["AppID"] = app_id.clone();
    }
    body
}

async fn request_json(
    client: &Client,
    api_key: &str,
    action: &str,
    body: Value,
) -> Result<Value, String> {
    let response = client
        .post(format!("{ENDPOINT}?Action={action}"))
        .header("X-Api-Key", api_key)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("请求豆包常用词服务失败：{error}"))?;
    parse_response(action, response).await
}

async fn request_multipart(
    client: &Client,
    api_key: &str,
    action: &str,
    form: Form,
) -> Result<Value, String> {
    let response = client
        .post(format!("{ENDPOINT}?Action={action}"))
        .header("X-Api-Key", api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|error| format!("请求豆包常用词服务失败：{error}"))?;
    parse_response(action, response).await
}

async fn parse_response(action: &str, response: reqwest::Response) -> Result<Value, String> {
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("读取豆包常用词响应失败：{error}"))?;
    let value: Value = serde_json::from_str(&text).map_err(|error| {
        format!("豆包常用词服务返回了无效响应（{action}，HTTP {status}）：{error}")
    })?;
    if !status.is_success() || value.pointer("/ResponseMetadata/Error").is_some() {
        let code = value
            .pointer("/ResponseMetadata/Error/Code")
            .and_then(Value::as_str)
            .unwrap_or("UnknownError");
        let message = value
            .pointer("/ResponseMetadata/Error/Message")
            .and_then(Value::as_str)
            .unwrap_or("未知错误");
        return Err(format!("豆包常用词服务失败：{message}（{code}）"));
    }
    Ok(value)
}

fn snapshot(state: CloudState) -> Result<Snapshot, String> {
    let binding = state.table.as_ref().map(|table| Binding {
        table_id: table.id.clone(),
        revision: table.revision.clone(),
        limit: state.limits.table,
    });
    Ok(Snapshot {
        words: state.table.map(|table| table.words).unwrap_or_default(),
        binding,
        limit: state.limits.table,
    })
}

fn validate(words: &[String], limits: &Limits) -> Result<(), String> {
    if words.len() > limits.table {
        return Err(format!(
            "常用词数量不能超过 {} 条，当前为 {} 条",
            limits.table,
            words.len()
        ));
    }
    for word in words {
        let chars = word.chars().count();
        let bytes = word.len();
        if chars > limits.word_chars || bytes > limits.word_bytes {
            return Err(format!(
                "常用词“{word}”过长：最多 {} 个字符且不超过 {} 字节",
                limits.word_chars, limits.word_bytes
            ));
        }
    }
    Ok(())
}

fn conflicts(
    remote_words: Option<&[String]>,
    saved_words: &[String],
    desired_words: &[String],
    expected_table: bool,
) -> bool {
    match remote_words {
        Some(remote) => remote != saved_words && remote != desired_words,
        None => expected_table && !saved_words.is_empty() && !desired_words.is_empty(),
    }
}

fn parse_limits(value: &Value) -> Limits {
    let result = value.get("Result").unwrap_or(value);
    Limits {
        table: usize_field(result, "SingleTableSizeLimit").unwrap_or(DEFAULT_TABLE_LIMIT),
        word_bytes: usize_field(result, "SingleWordSizeLimitBytes")
            .or_else(|| usize_field(result, "SingleWordSizeLimit"))
            .unwrap_or(DEFAULT_WORD_BYTES_LIMIT),
        word_chars: usize_field(result, "SingleWordSizeLimitCN")
            .unwrap_or(DEFAULT_WORD_CHARS_LIMIT),
    }
}

#[cfg(test)]
fn parse_file(file: &str) -> Vec<String> {
    file.lines().filter_map(parse_word).collect()
}

fn parse_word(line: &str) -> Option<String> {
    let word = line.split_once('|').map_or(line, |(word, _)| word).trim();
    (!word.is_empty()).then(|| word.to_owned())
}

fn string_field(value: &Value, field: &str) -> Option<String> {
    value.get(field).and_then(|value| match value {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    })
}

fn required_string(value: &Value, field: &str, error: &str) -> Result<String, String> {
    string_field(value, field).ok_or_else(|| error.to_owned())
}

fn usize_field(value: &Value, field: &str) -> Option<usize> {
    value
        .get(field)
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
}

fn scalar(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        _ => value.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_cloud_words_without_inline_total_limit() {
        let words = (0..150).map(|index| format!("词{index}")).collect();
        assert_eq!(normalize(words).unwrap().len(), 150);
        assert_eq!(
            normalize(vec![
                " VoicePaste ".into(),
                "voicepaste".into(),
                "豆包".into()
            ])
            .unwrap(),
            ["VoicePaste", "豆包"]
        );
    }

    #[test]
    fn rejects_cloud_format_control_characters() {
        assert!(normalize(vec!["Visual Studio".into()]).is_err());
        assert!(normalize(vec!["VoicePaste|10".into()]).is_err());
    }

    #[test]
    fn parses_weighted_cloud_file() {
        assert_eq!(
            parse_file("VoicePaste|4\nTauri\n\nTanStack|1"),
            ["VoicePaste", "Tauri", "TanStack"]
        );
    }

    #[test]
    fn writes_cloud_words_with_default_weight() {
        assert_eq!(
            encode_file(&["VoicePaste".to_owned(), "Tauri".to_owned()]),
            "VoicePaste|10\nTauri|10"
        );
    }

    #[test]
    fn detects_only_real_remote_conflicts() {
        let saved = vec!["VoicePaste".to_owned()];
        let desired = vec!["VoicePaste".to_owned(), "Tauri".to_owned()];
        let remote = vec!["TanStack".to_owned()];
        assert!(conflicts(Some(&remote), &saved, &desired, true));
        assert!(!conflicts(Some(&desired), &saved, &desired, true));
        assert!(!conflicts(None, &saved, &desired, false));
        assert!(conflicts(None, &saved, &desired, true));
    }

    #[test]
    fn parses_live_limit_shape() {
        let limits = parse_limits(&json!({
            "Result": {
                "SingleTableSizeLimit": 5000,
                "SingleWordSizeLimitBytes": 30,
                "SingleWordSizeLimitCN": 10
            }
        }));
        assert_eq!(limits.table, 5000);
        assert_eq!(limits.word_bytes, 30);
        assert_eq!(limits.word_chars, 10);
    }
}
