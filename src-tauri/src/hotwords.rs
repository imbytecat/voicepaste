use std::{collections::HashSet, fmt::Write as _, time::Duration};

use reqwest::{
    Client, RequestBuilder,
    multipart::{Form, Part},
    redirect::Policy,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
// The `log` crate is re-exported by tauri-plugin-log, which owns the logger setup.
use tauri_plugin_log::log;

const ENDPOINT: &str = "https://openspeech.bytedance.com/api/proxy/invoke/";
const VERSION: &str = "2022-08-30";
const TABLE_NAME: &str = "VoicePasteManagedV1";
pub const DEFAULT_TABLE_LIMIT: usize = 5000;
const DEFAULT_WORD_BYTES_LIMIT: usize = 30;
const DEFAULT_WORD_CHARS_LIMIT: usize = 10;
const SAVE_POLL_ATTEMPTS: usize = 30;
const SAVE_POLL_INTERVAL: Duration = Duration::from_millis(500);

/// The cloud table VoicePaste manages, as persisted in the local store.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Binding {
    pub table_id: String,
    pub limit: usize,
}

/// A boosting table in the account that VoicePaste does not manage.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignTable {
    pub name: String,
    pub word_count: usize,
}

/// The cloud truth for one account: our table plus everything else we found.
#[derive(Clone, Debug)]
pub struct Snapshot {
    pub binding: Option<Binding>,
    pub words: Vec<String>,
    pub limit: usize,
    pub foreign_tables: Vec<ForeignTable>,
}

impl Default for Snapshot {
    fn default() -> Self {
        Self {
            binding: None,
            words: Vec::new(),
            limit: DEFAULT_TABLE_LIMIT,
            foreign_tables: Vec::new(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SyncAction {
    Created,
    Updated,
    Deleted,
    Unchanged,
}

impl SyncAction {
    pub fn label(self) -> &'static str {
        match self {
            Self::Created => "created",
            Self::Updated => "updated",
            Self::Deleted => "deleted",
            Self::Unchanged => "unchanged",
        }
    }
}

pub enum SyncOutcome {
    Saved {
        snapshot: Snapshot,
        action: SyncAction,
    },
    Conflict(Snapshot),
}

/// What `sync` has to do to make the cloud match the desired words.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Plan {
    Conflict,
    Create,
    Update,
    Delete,
    Unchanged,
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
    words: Vec<String>,
}

struct CloudState {
    app_id: Option<Value>,
    limits: Limits,
    table: Option<RemoteTable>,
    foreign_tables: Vec<ForeignTable>,
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
    let client = client()?;
    let state = load_with_client(&client, api_key, None).await?;
    log::info!(
        "hotwords: inspect table={} cloud_words={} foreign_tables={}",
        state.table.as_ref().map_or("-", |table| table.id.as_str()),
        state.table.as_ref().map_or(0, |table| table.words.len()),
        state.foreign_tables.len(),
    );
    Ok(snapshot(state))
}

pub async fn sync(
    api_key: &str,
    saved_words: &[String],
    desired_words: &[String],
    binding: Option<&Binding>,
    force: bool,
) -> Result<SyncOutcome, String> {
    let client = client()?;
    let state = load_with_client(
        &client,
        api_key,
        binding.map(|binding| binding.table_id.as_str()),
    )
    .await?;
    validate(desired_words, &state.limits)?;

    let remote_words = state.table.as_ref().map(|table| table.words.as_slice());
    let decision = plan(
        remote_words,
        saved_words,
        desired_words,
        binding.is_some(),
        force,
    );
    log::info!(
        "hotwords: sync plan={decision:?} table={} saved={} desired={} remote={} force={force}",
        state.table.as_ref().map_or("-", |table| table.id.as_str()),
        saved_words.len(),
        desired_words.len(),
        remote_words.map_or(0, <[String]>::len),
    );

    if decision == Plan::Conflict {
        log::warn!(
            "hotwords: sync conflict, cloud table {} holds {} words that match neither saved ({}) nor desired ({})",
            state.table.as_ref().map_or("-", |table| table.id.as_str()),
            remote_words.map_or(0, <[String]>::len),
            saved_words.len(),
            desired_words.len(),
        );
        return Ok(SyncOutcome::Conflict(snapshot(state)));
    }

    let table_id = state.table.as_ref().map(|table| table.id.clone());
    let action = match (decision, table_id.as_deref()) {
        (Plan::Delete, Some(id)) => {
            delete_table(&client, api_key, state.app_id.as_ref(), id).await?;
            SyncAction::Deleted
        }
        (Plan::Update, Some(id)) => {
            update_table(&client, api_key, state.app_id.as_ref(), id, desired_words).await?;
            SyncAction::Updated
        }
        (Plan::Create, _) => {
            create_table(&client, api_key, state.app_id.as_ref(), desired_words).await?;
            SyncAction::Created
        }
        _ => {
            log::info!("hotwords: sync action=unchanged");
            return Ok(SyncOutcome::Saved {
                snapshot: snapshot(state),
                action: SyncAction::Unchanged,
            });
        }
    };

    let state = wait_for_words(&client, api_key, desired_words, table_id.as_deref()).await?;
    log::info!(
        "hotwords: sync action={} table={} cloud_words={}",
        action.label(),
        state.table.as_ref().map_or("-", |table| table.id.as_str()),
        state.table.as_ref().map_or(0, |table| table.words.len()),
    );
    Ok(SyncOutcome::Saved {
        snapshot: snapshot(state),
        action,
    })
}

/// Pure decision: what the cloud state, the last saved words and the desired
/// words imply. Kept free of I/O so it can be exhaustively tested.
fn plan(
    remote_words: Option<&[String]>,
    saved_words: &[String],
    desired_words: &[String],
    had_binding: bool,
    force: bool,
) -> Plan {
    let conflict = match remote_words {
        // Somebody else rewrote the table behind our back.
        Some(remote) => remote != saved_words && remote != desired_words,
        // We had a table, it is gone, and both sides still hold words.
        None => had_binding && !saved_words.is_empty() && !desired_words.is_empty(),
    };
    if conflict && !force {
        return Plan::Conflict;
    }
    match remote_words {
        Some(_) if desired_words.is_empty() => Plan::Delete,
        Some(remote) if remote == desired_words => Plan::Unchanged,
        Some(_) => Plan::Update,
        None if desired_words.is_empty() => Plan::Unchanged,
        None => Plan::Create,
    }
}

fn client() -> Result<Client, String> {
    Client::builder()
        .redirect(Policy::limited(3))
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("创建豆包常用词连接失败：{error}"))
}

async fn wait_for_words(
    client: &Client,
    api_key: &str,
    expected_words: &[String],
    table_id: Option<&str>,
) -> Result<CloudState, String> {
    let mut last_error = None;
    for attempt in 0..SAVE_POLL_ATTEMPTS {
        match load_with_client(client, api_key, table_id).await {
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
    log::warn!("hotwords: cloud table did not settle after {SAVE_POLL_ATTEMPTS} polls");
    Err(last_error.unwrap_or_else(|| "豆包已接受常用词更新，但云端词表尚未就绪，请重试".to_owned()))
}

async fn load_with_client(
    client: &Client,
    api_key: &str,
    table_id: Option<&str>,
) -> Result<CloudState, String> {
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
    let tables = list
        .pointer("/Result/BoostingTables")
        .and_then(Value::as_array)
        .map_or(&[][..], Vec::as_slice);

    // Prefer the table we are bound to; fall back to the name we create under.
    let managed = table_id
        .and_then(|table_id| {
            tables.iter().position(|table| {
                string_field(table, "BoostingTableID").as_deref() == Some(table_id)
            })
        })
        .or_else(|| {
            tables.iter().position(|table| {
                string_field(table, "BoostingTableName").as_deref() == Some(TABLE_NAME)
            })
        });
    let foreign_tables: Vec<ForeignTable> = tables
        .iter()
        .enumerate()
        .filter(|(index, _)| Some(*index) != managed)
        .map(|(_, table)| ForeignTable {
            name: string_field(table, "BoostingTableName").unwrap_or_default(),
            word_count: usize_field(table, "WordCount").unwrap_or_default(),
        })
        .collect();
    if !foreign_tables.is_empty() {
        log::info!(
            "hotwords: {} unmanaged table(s) in account: {}",
            foreign_tables.len(),
            foreign_tables
                .iter()
                .map(|table| table.name.as_str())
                .collect::<Vec<_>>()
                .join(", "),
        );
    }

    let table = managed
        .map(|index| {
            let summary = &tables[index];
            Ok::<_, String>(RemoteTable {
                id: required_string(summary, "BoostingTableID", "云端常用词表缺少 ID")?,
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
            })
        })
        .transpose()?;
    Ok(CloudState {
        app_id,
        limits,
        table,
        foreign_tables,
    })
}

async fn create_table(
    client: &Client,
    api_key: &str,
    app_id: Option<&Value>,
    words: &[String],
) -> Result<(), String> {
    let form = create_form(app_id, words)?;
    request_multipart(client, api_key, "CreateBoostingTable", form).await?;
    Ok(())
}

fn create_form(app_id: Option<&Value>, words: &[String]) -> Result<Form, String> {
    let form = Form::new()
        .text("Action", "CreateBoostingTable")
        .text("Version", VERSION);
    let form = match app_id {
        Some(app_id) => form.text("AppID", scalar(app_id)),
        None => form,
    };
    Ok(form
        .text("BoostingTableName", TABLE_NAME)
        .part("File", word_file(words)?))
}

async fn update_table(
    client: &Client,
    api_key: &str,
    app_id: Option<&Value>,
    table_id: &str,
    words: &[String],
) -> Result<(), String> {
    let form = update_form(app_id, table_id, words)?;
    request_multipart(client, api_key, "UpdateBoostingTable", form).await?;
    Ok(())
}

fn update_form(app_id: Option<&Value>, table_id: &str, words: &[String]) -> Result<Form, String> {
    let form = Form::new()
        .text("Action", "UpdateBoostingTable")
        .text("Version", VERSION);
    let form = match app_id {
        Some(app_id) => form.text("AppID", scalar(app_id)),
        None => form,
    };
    Ok(form
        .text("BoostingTableID", table_id.to_owned())
        .part("File", word_file(words)?))
}

async fn delete_table(
    client: &Client,
    api_key: &str,
    app_id: Option<&Value>,
    table_id: &str,
) -> Result<(), String> {
    request_json(
        client,
        api_key,
        "DeleteBoostingTable",
        delete_body(app_id, table_id),
    )
    .await?;
    Ok(())
}

fn delete_body(app_id: Option<&Value>, table_id: &str) -> Value {
    let mut body = json!({
        "Action": "DeleteBoostingTable",
        "Version": VERSION,
        "BoostingTableID": table_id,
    });
    if let Some(app_id) = app_id {
        body["AppID"] = app_id.clone();
    }
    body
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

async fn request_json(
    client: &Client,
    api_key: &str,
    action: &str,
    body: Value,
) -> Result<Value, String> {
    send(action, request(client, api_key, action).json(&body)).await
}

async fn request_multipart(
    client: &Client,
    api_key: &str,
    action: &str,
    form: Form,
) -> Result<Value, String> {
    send(action, request(client, api_key, action).multipart(form)).await
}

fn request(client: &Client, api_key: &str, action: &str) -> RequestBuilder {
    client
        .post(format!("{ENDPOINT}?Action={action}"))
        .header("X-Api-Key", api_key)
}

async fn send(action: &str, request: RequestBuilder) -> Result<Value, String> {
    let response = request.send().await.map_err(|error| {
        log::error!("hotwords: {action} transport failure: {error}");
        format!("请求豆包常用词服务失败：{error}")
    })?;
    parse_response(action, response).await
}

async fn parse_response(action: &str, response: reqwest::Response) -> Result<Value, String> {
    let status = response.status();
    let text = response.text().await.map_err(|error| {
        log::error!("hotwords: {action} response unreadable: {error}");
        format!("读取豆包常用词响应失败：{error}")
    })?;
    let value: Value = serde_json::from_str(&text).map_err(|error| {
        log::error!("hotwords: {action} returned invalid JSON (HTTP {status}): {error}");
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
        log::error!("hotwords: {action} failed (HTTP {status}, {code})");
        return Err(match status.as_u16() {
            401 | 403 => format!(
                "这个 API Key 没有热词管理权限（HTTP {}，{code}）。请在火山引擎语音控制台开通自学习平台（热词）能力，或改用不含常用词的配置：{message}",
                status.as_u16()
            ),
            429 => format!("热词管理接口调用过于频繁，请稍后重试（{code}）：{message}"),
            _ => format!("豆包常用词服务失败：{message}（{code}）"),
        });
    }
    Ok(value)
}

fn snapshot(state: CloudState) -> Snapshot {
    let binding = state.table.as_ref().map(|table| Binding {
        table_id: table.id.clone(),
        limit: state.limits.table,
    });
    Snapshot {
        words: state.table.map(|table| table.words).unwrap_or_default(),
        binding,
        limit: state.limits.table,
        foreign_tables: state.foreign_tables,
    }
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

    fn words(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    fn multipart_text(form: Form) -> String {
        use futures_util::StreamExt as _;

        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                let stream = form.into_stream();
                futures_util::pin_mut!(stream);
                let mut body = Vec::new();
                while let Some(chunk) = stream.next().await {
                    body.extend_from_slice(&chunk.unwrap());
                }
                String::from_utf8(body).unwrap()
            })
    }

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
    fn handles_optional_app_id_in_hotword_mutations() {
        let app_id = json!("12345");
        let words = words(&["VoicePaste"]);

        for form in [
            create_form(Some(&app_id), &words).unwrap(),
            update_form(Some(&app_id), "table-id", &words).unwrap(),
        ] {
            assert!(multipart_text(form).contains("name=\"AppID\"\r\n\r\n12345\r\n"));
        }
        assert_eq!(
            delete_body(Some(&app_id), "table-id")["AppID"],
            json!("12345")
        );

        for form in [
            create_form(None, &words).unwrap(),
            update_form(None, "table-id", &words).unwrap(),
        ] {
            assert!(!multipart_text(form).contains("name=\"AppID\""));
        }
        assert!(delete_body(None, "table-id").get("AppID").is_none());
    }

    #[test]
    fn plans_every_sync_decision() {
        let saved = words(&["VoicePaste"]);
        let desired = words(&["VoicePaste", "Tauri"]);
        let stranger = words(&["TanStack"]);
        let empty: Vec<String> = Vec::new();
        let (saved, desired) = (saved.as_slice(), desired.as_slice());
        let (stranger, empty) = (stranger.as_slice(), empty.as_slice());

        // (case, remote, saved, desired, had_binding, force, expected)
        let cases = [
            (
                "remote drifted from both sides",
                Some(stranger),
                saved,
                desired,
                true,
                false,
                Plan::Conflict,
            ),
            (
                "bound table vanished while both sides hold words",
                None,
                saved,
                desired,
                true,
                false,
                Plan::Conflict,
            ),
            (
                "force overrides a drifted table",
                Some(stranger),
                saved,
                desired,
                true,
                true,
                Plan::Update,
            ),
            (
                "force overrides a vanished table",
                None,
                saved,
                desired,
                true,
                true,
                Plan::Create,
            ),
            (
                "first upload without a table",
                None,
                empty,
                desired,
                false,
                false,
                Plan::Create,
            ),
            (
                "remote still matches what we saved",
                Some(saved),
                saved,
                desired,
                true,
                false,
                Plan::Update,
            ),
            (
                "clearing words drops the table",
                Some(saved),
                saved,
                empty,
                true,
                false,
                Plan::Delete,
            ),
            (
                "remote already holds the desired words",
                Some(desired),
                saved,
                desired,
                true,
                false,
                Plan::Unchanged,
            ),
            (
                "nothing local, nothing remote",
                None,
                empty,
                empty,
                false,
                false,
                Plan::Unchanged,
            ),
        ];

        for (name, remote, saved, desired, had_binding, force, expected) in cases {
            assert_eq!(
                plan(remote, saved, desired, had_binding, force),
                expected,
                "{name}"
            );
        }
    }

    #[test]
    fn reads_bindings_persisted_before_revision_was_dropped() {
        let binding: Binding =
            serde_json::from_value(json!({"tableId": "table-id", "revision": "2024", "limit": 42}))
                .unwrap();
        assert_eq!(binding.table_id, "table-id");
        assert_eq!(binding.limit, 42);
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
