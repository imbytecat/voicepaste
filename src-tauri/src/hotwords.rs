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
#[serde(deny_unknown_fields, rename_all = "camelCase")]
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

/// What `sync` has to do to make the cloud hold the merged words.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Plan {
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
    validate(&normalized, &Limits::default())?;
    Ok(normalized)
}

/// Three-way merge of word lists. `base` is what this device last saw in the
/// cloud, `local` what the user wants now, `remote` what the cloud holds now.
/// Keeps the user's list and order, drops words the cloud removed since
/// `base`, then appends words the cloud added. Words are a set, so both
/// sides' edits always combine; nothing needs a person to choose.
///
/// Idempotent: merging an already merged result with the same `base` and
/// `local` yields it unchanged, so a write whose outcome is unknown can simply
/// be synced again.
pub fn merge(base: &[String], local: &[String], remote: &[String]) -> Vec<String> {
    let key = |word: &String| word.to_lowercase();
    let base: HashSet<String> = base.iter().map(key).collect();
    let remote_keys: HashSet<String> = remote.iter().map(key).collect();
    let mut seen = HashSet::new();
    local
        .iter()
        .filter(|word| {
            let word = key(word);
            remote_keys.contains(&word) || !base.contains(&word)
        })
        .chain(remote.iter().filter(|word| !base.contains(&key(word))))
        .filter(|word| seen.insert(key(word)))
        .cloned()
        .collect()
}

/// Merges `local` into the cloud table and writes the result when it differs.
/// Returns the cloud state after the write. Any error leaves nothing to undo:
/// `merge` is idempotent, so the caller simply syncs again later.
pub async fn sync(
    api_key: &str,
    base: &[String],
    local: &[String],
    binding: Option<&Binding>,
) -> Result<Snapshot, String> {
    let client = client()?;
    let state = load_with_client(
        &client,
        api_key,
        binding.map(|binding| binding.table_id.as_str()),
    )
    .await?;
    let remote_words = state.table.as_ref().map(|table| table.words.as_slice());
    let merged = merge(base, local, remote_words.unwrap_or_default());
    validate(&merged, &state.limits)?;
    let decision = plan(remote_words, &merged);
    log::info!(
        "hotwords: sync plan={decision:?} table={} base={} local={} remote={} merged={}",
        state.table.as_ref().map_or("-", |table| table.id.as_str()),
        base.len(),
        local.len(),
        remote_words.map_or(0, <[String]>::len),
        merged.len(),
    );

    let table_id = state.table.as_ref().map(|table| table.id.clone());
    match (decision, table_id.as_deref()) {
        (Plan::Delete, Some(id)) => {
            delete_table(&client, api_key, state.app_id.as_ref(), id).await?;
        }
        (Plan::Update, Some(id)) => {
            update_table(&client, api_key, state.app_id.as_ref(), id, &merged).await?;
        }
        (Plan::Create, _) => {
            create_table(&client, api_key, state.app_id.as_ref(), &merged).await?;
        }
        _ => return Ok(snapshot(state)),
    }

    // ponytail: no compare-and-swap in the Volcengine API; a write racing
    // another device in this window wins outright until that device syncs.
    let state = wait_for_words(&client, api_key, &merged, table_id.as_deref()).await?;
    Ok(snapshot(state))
}

/// Pure decision: which write makes the cloud hold `merged`.
fn plan(remote_words: Option<&[String]>, merged: &[String]) -> Plan {
    match remote_words {
        Some(_) if merged.is_empty() => Plan::Delete,
        Some(remote) if remote == merged => Plan::Unchanged,
        Some(_) => Plan::Update,
        None if merged.is_empty() => Plan::Unchanged,
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
        .ok_or("云端常用词列表缺失或格式无效，未修改任何词表")?;
    if tables.len() >= 500 {
        return Err("云端词表列表可能不完整，无法安全确定受管理词表".to_owned());
    }
    let managed = managed_table_index(tables, table_id)?;
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
                words: complete_preview(summary)?,
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

fn managed_table_index(tables: &[Value], binding: Option<&str>) -> Result<Option<usize>, String> {
    if let Some(index) = binding.and_then(|id| {
        tables
            .iter()
            .position(|table| string_field(table, "BoostingTableID").as_deref() == Some(id))
    }) {
        if string_field(&tables[index], "BoostingTableName").as_deref() != Some(TABLE_NAME) {
            return Err("绑定词表已不属于 VoicePaste，未修改云端数据".to_owned());
        }
        return Ok(Some(index));
    }
    let mut candidates = tables.iter().enumerate().filter(|(_, table)| {
        string_field(table, "BoostingTableName").as_deref() == Some(TABLE_NAME)
    });
    let selected = candidates.next().map(|(index, _)| index);
    if candidates.next().is_some() {
        return Err("找到多张 VoicePaste 词表，无法安全确定归属；未修改云端数据".to_owned());
    }
    Ok(selected)
}

fn complete_preview(summary: &Value) -> Result<Vec<String>, String> {
    let count = usize_field(summary, "WordCount").ok_or("云端常用词表缺少有效词数")?;
    let preview = summary
        .get("Preview")
        .and_then(Value::as_array)
        .ok_or("云端常用词快照缺失，无法安全读取或覆盖")?;
    let words: Vec<String> = preview
        .iter()
        .map(|word| {
            word.as_str()
                .and_then(parse_word)
                .ok_or("云端常用词快照包含无效条目".to_owned())
        })
        .collect::<Result<_, _>>()?;
    if count != words.len() {
        return Err("云端常用词快照不完整，未修改任何词条".to_owned());
    }
    Ok(words)
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

async fn parse_response(action: &str, mut response: reqwest::Response) -> Result<Value, String> {
    const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
    let status = response.status();
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("读取火山常用词响应失败：{error}"))?
    {
        if chunk.len() > MAX_RESPONSE_BYTES - bytes.len() {
            return Err("火山常用词响应过大，未继续处理".to_owned());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|error| {
        log::error!("hotwords: {action} returned invalid JSON (HTTP {status}): {error}");
        format!("火山常用词服务返回了无效响应（{action}，HTTP {status}）：{error}")
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

    #[test]
    fn refuses_ambiguous_or_foreign_managed_tables_and_partial_snapshots() {
        let first = json!({"BoostingTableID": "one", "BoostingTableName": TABLE_NAME,
            "WordCount": 2, "Preview": ["first|10"]});
        let second = json!({"BoostingTableID": "two", "BoostingTableName": TABLE_NAME});
        assert!(managed_table_index(&[first.clone(), second.clone()], None).is_err());
        assert_eq!(
            managed_table_index(&[first.clone(), second], Some("one")).unwrap(),
            Some(0)
        );
        assert!(
            managed_table_index(
                &[json!({"BoostingTableID": "one", "BoostingTableName": "OtherApp"})],
                Some("one")
            )
            .is_err()
        );
        assert!(complete_preview(&first).is_err());
        assert!(complete_preview(&json!({"WordCount": 1, "Preview": [42]})).is_err());
        assert_eq!(
            complete_preview(&json!({"WordCount": 1, "Preview": ["word|10"]})).unwrap(),
            ["word"]
        );
    }

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
    fn normalizes_and_deduplicates_cloud_words() {
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
    fn rejects_invalid_format_and_word_count_character_and_byte_overflow() {
        assert!(normalize(vec!["Visual Studio".into()]).is_err());
        assert!(normalize(vec!["VoicePaste|10".into()]).is_err());
        assert!(normalize(vec!["abcdefghijk".into()]).is_err());
        assert!(normalize(vec!["\u{10400}".repeat(8)]).is_err());
        assert!(
            normalize(
                (0..=DEFAULT_TABLE_LIMIT)
                    .map(|index| format!("词{index}"))
                    .collect()
            )
            .is_err()
        );
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
    fn merges_both_sides_without_asking() {
        let merge_words = |base: &[&str], local: &[&str], remote: &[&str]| {
            merge(&words(base), &words(local), &words(remote))
        };
        type Case<'a> = (
            &'a str,
            &'a [&'a str],
            &'a [&'a str],
            &'a [&'a str],
            &'a [&'a str],
        );
        // (case, base, local, remote, expected)
        let cases: [Case; 8] = [
            ("local add", &["a"], &["a", "b"], &["a"], &["a", "b"]),
            ("local remove", &["a", "b"], &["a"], &["a", "b"], &["a"]),
            ("remote add kept", &["a"], &["a"], &["a", "c"], &["a", "c"]),
            (
                "remote remove honoured",
                &["a", "b"],
                &["a", "b"],
                &["a"],
                &["a"],
            ),
            (
                "both edit at once",
                &["a", "b"],
                &["a", "x"],
                &["b", "y"],
                &["x", "y"],
            ),
            (
                "new device adopts the cloud",
                &[],
                &[],
                &["a", "b"],
                &["a", "b"],
            ),
            (
                "vanished table keeps local adds",
                &["a"],
                &["a", "b"],
                &[],
                &["b"],
            ),
            (
                "case-insensitive keys keep local spelling",
                &["a"],
                &["A", "B"],
                &["a"],
                &["A", "B"],
            ),
        ];
        for (name, base, local, remote, expected) in cases {
            assert_eq!(merge_words(base, local, remote), words(expected), "{name}");
        }
    }

    #[test]
    fn merge_is_idempotent_for_retries() {
        let (base, local) = (words(&["a", "b"]), words(&["a", "x"]));
        let once = merge(&base, &local, &words(&["b", "y"]));
        assert_eq!(merge(&base, &local, &once), once);
    }

    #[test]
    fn plans_the_write_for_the_merged_words() {
        let some = words(&["a"]);
        let other = words(&["b"]);
        assert_eq!(plan(None, &some), Plan::Create);
        assert_eq!(plan(None, &[]), Plan::Unchanged);
        assert_eq!(plan(Some(&some), &some), Plan::Unchanged);
        assert_eq!(plan(Some(&some), &other), Plan::Update);
        assert_eq!(plan(Some(&some), &[]), Plan::Delete);
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
