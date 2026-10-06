use crate::doubao_ime_transport::request;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use prost::Message;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    io::{Read, Write},
    time::{SystemTime, UNIX_EPOCH},
};

const LIMIT: usize = 2 * 1024 * 1024;
#[derive(Clone, PartialEq, Message, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Phrase {
    #[prost(string, tag = "1")]
    pub id: String,
    #[prost(string, tag = "2")]
    pub input: String,
    #[prost(string, tag = "3")]
    pub text: String,
    #[prost(string, tag = "4")]
    pub nine_key_input: String,
    #[prost(bool, tag = "6")]
    pub flag6: bool,
    #[prost(bool, tag = "7")]
    pub flag7: bool,
    #[prost(uint64, tag = "8")]
    pub modified: u64,
}
#[derive(Clone, PartialEq, Message)]
struct Operation {
    #[prost(uint32, tag = "1")]
    kind: u32,
    #[prost(string, tag = "2")]
    id: String,
    #[prost(message, optional, tag = "3")]
    record: Option<Phrase>,
    #[prost(uint64, tag = "4")]
    sequence: u64,
    #[prost(uint64, tag = "5")]
    modified: u64,
}
#[derive(Clone, PartialEq, Message)]
struct Package {
    #[prost(uint32, tag = "1")]
    format: u32,
    #[prost(uint64, tag = "2")]
    base: u64,
    #[prost(uint32, tag = "3")]
    mode: u32,
    #[prost(message, repeated, tag = "4")]
    operations: Vec<Operation>,
    #[prost(uint64, tag = "5")]
    version: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub version: String,
    pub phrases: Vec<Phrase>,
}

async fn api(
    token: &str,
    did: &str,
    iid: &str,
    path: &str,
    payload: Option<&[u8]>,
    headers: &[(&str, String)],
) -> Result<Value, String> {
    let raw = request(token, did, iid, path, payload, headers).await?;
    let value: Value = serde_json::from_slice(&raw).map_err(|_| "常用语响应格式错误")?;
    if value["code"] != 0 {
        let message = value["msg"]
            .as_str()
            .or_else(|| value["message"].as_str())
            .unwrap_or("");
        let reason = if message.contains("Content-Type") {
            "Content-Type 不符合协议"
        } else if message.contains("Content-MD5") {
            "上传摘要不符合协议"
        } else if message.contains("X-Ss-Req-Ticket") {
            "请求时间头缺失"
        } else if message.contains("X-Sync-Type") {
            "同步类型头无效"
        } else {
            "请求参数被拒绝"
        };
        return Err(format!(
            "常用语{}失败：{}（业务码 {}）",
            path.split('?').next().unwrap_or(path),
            reason,
            value["code"].as_i64().unwrap_or(-1)
        ));
    }
    value
        .get("data")
        .filter(|v| v.is_object())
        .cloned()
        .ok_or("常用语响应缺少数据".to_owned())
}
async fn version(token: &str, did: &str, iid: &str) -> Result<u64, String> {
    api(
        token,
        did,
        iid,
        "/api/v2/sync/version?sync_type=1",
        None,
        &[],
    )
    .await?["last_version_seq"]
        .as_u64()
        .ok_or("常用语版本无效".to_owned())
}
fn decode_snapshot(raw: &[u8], expected: u64) -> Result<Vec<Phrase>, String> {
    let mut decoded = Vec::new();
    let bytes = if raw.starts_with(&[0x1f, 0x8b]) {
        flate2::read::GzDecoder::new(raw)
            .take((LIMIT + 1) as u64)
            .read_to_end(&mut decoded)
            .map_err(|_| "常用语文件解压失败")?;
        if decoded.len() > LIMIT {
            return Err("常用语文件超限".to_owned());
        }
        decoded.as_slice()
    } else {
        raw
    };
    let package = Package::decode(bytes).map_err(|_| "常用语文件格式错误")?;
    if package.format != 7
        || package.mode != 1
        || package.version != expected
        || package.operations.len() > 10000
    {
        return Err("常用语格式或版本不匹配".to_owned());
    }
    let mut ids = std::collections::HashSet::new();
    package
        .operations
        .into_iter()
        .map(|op| {
            let record = op.record.ok_or("常用语记录缺失")?;
            if op.kind != 1
                || op.id != record.id
                || record.id.is_empty()
                || !ids.insert(record.id.clone())
                || record.text.is_empty()
            {
                return Err("常用语记录身份无效".to_owned());
            }
            Ok(record)
        })
        .collect()
}
pub async fn snapshot(token: &str, did: &str, iid: &str) -> Result<Snapshot, String> {
    let before = version(token, did, iid).await?;
    let pull = api(
        token,
        did,
        iid,
        "/api/v2/sync/pull?sync_type=1&start_version_seq=0",
        None,
        &[],
    )
    .await?;
    if pull["data_type"] != "full" {
        return Err("不支持的常用语下载类型".to_owned());
    }
    let url = pull["url"].as_str().ok_or("常用语下载地址缺失")?;
    let phrases = if url.is_empty() {
        Vec::new()
    } else {
        let url = reqwest::Url::parse(url).map_err(|_| "常用语下载地址无效")?;
        if url.scheme() != "https"
            || !url
                .host_str()
                .is_some_and(|h| h.ends_with(".doubaocdn.com"))
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("常用语下载主机不可信".to_owned());
        }
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|_| "无法创建下载连接")?;
        let mut response = client
            .get(url)
            .header("Accept-Encoding", "identity")
            .send()
            .await
            .map_err(|_| "常用语下载失败")?;
        if !response.status().is_success() {
            return Err("常用语下载被拒绝".to_owned());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| "常用语下载中断")? {
            if bytes.len().saturating_add(chunk.len()) > LIMIT {
                return Err("常用语文件超限".to_owned());
            }
            bytes.extend_from_slice(&chunk);
        }
        decode_snapshot(&bytes, before)?
    };
    if version(token, did, iid).await? != before {
        return Err("云端常用语正在变化，请重新读取".to_owned());
    }
    Ok(Snapshot {
        version: before.to_string(),
        phrases,
    })
}
/// Mutates only the selected record; never replaces a full remote collection.
pub async fn apply(
    token: &str,
    did: &str,
    iid: &str,
    expected: &str,
    id: Option<&str>,
    text: Option<&str>,
) -> Result<Snapshot, String> {
    if text.is_some_and(|s| {
        s.trim().is_empty() || s.encode_utf16().count() > 50 || s.chars().any(char::is_control)
    }) {
        return Err("常用语须为 1–50 个 UTF-16 单元且不能含控制字符".to_owned());
    }
    let before = snapshot(token, did, iid).await?;
    if before.version != expected {
        return Err("云端常用语已变化，请重新读取后确认".to_owned());
    }
    let previous = if let Some(id) = id {
        Some(
            before
                .phrases
                .iter()
                .find(|p| p.id == id)
                .ok_or("常用语已被删除，请刷新")?,
        )
    } else {
        None
    };
    if previous.is_none() && text.is_none() {
        return Err("删除操作缺少记录".to_owned());
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "系统时钟无效")?
        .as_millis() as u64;
    let modified = now.max(previous.map_or(0, |p| p.modified.saturating_add(1)));
    let rid = previous
        .map(|p| p.id.clone())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let record = text.map(|text| {
        let mut p = previous.cloned().unwrap_or_default();
        p.id = rid.clone();
        p.text = text.trim().to_owned();
        p.modified = modified;
        p
    });
    let expected_record = record.clone();
    let sequence = tokio::task::spawn_blocking(|| {
        let current = crate::settings::read_secret("doubao-ime-phrase-sequence")?;
        let next = current
            .as_deref()
            .unwrap_or("0")
            .parse::<u64>()
            .map_err(|_| "常用语本机序列损坏".to_owned())?
            .checked_add(1)
            .ok_or("常用语本机序列已耗尽")?;
        crate::settings::write_secret("doubao-ime-phrase-sequence", Some(&next.to_string()))?;
        Ok::<u64, String>(next)
    })
    .await
    .map_err(|_| "常用语本机序列保存中断")??;
    let base = expected.parse().map_err(|_| "常用语版本无效")?;
    let package = Package {
        format: 7,
        base,
        mode: 2,
        operations: vec![Operation {
            kind: if record.is_some() { 1 } else { 2 },
            id: rid.clone(),
            record,
            sequence,
            modified,
        }],
        version: 0,
    };
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    encoder
        .write_all(&package.encode_to_vec())
        .map_err(|_| "常用语编码失败")?;
    let payload = encoder.finish().map_err(|_| "常用语压缩失败")?;
    let digest = openssl::hash::hash(openssl::hash::MessageDigest::md5(), &payload)
        .map_err(|_| "常用语摘要失败")?;
    let staged = api(
        token,
        did,
        iid,
        "/api/v2/stream/sync/upload",
        Some(&payload),
        &[
            ("Content-Type", "application/octet-stream".to_owned()),
            ("Content-Encoding", "gzip".to_owned()),
            ("X-Sync-Type", "1".to_owned()),
            ("Content-MD5", STANDARD.encode(digest)),
        ],
    )
    .await?;
    let object = staged["object_key"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or("常用语上传未返回对象")?;
    if version(token, did, iid).await? != base {
        return Err("上传期间云端变化，未提交；请刷新".to_owned());
    }
    let push = serde_json::to_vec(
        &json!({"sync_type":1,"start_version_seq":base,"object_key":object,"data":[]}),
    )
    .map_err(|_| "常用语提交编码失败")?;
    api(
        token,
        did,
        iid,
        "/api/v2/sync/push",
        Some(&push),
        &[("X-Ss-Req-Ticket", now.to_string())],
    )
    .await
    .map_err(|_| "常用语提交结果待确认，请刷新，不要重复提交".to_owned())?;
    let after = snapshot(token, did, iid)
        .await
        .map_err(|_| "常用语已提交但回读失败，请刷新确认".to_owned())?;
    if after.phrases.iter().find(|p| p.id == rid) != expected_record.as_ref() {
        return Err("常用语回读与提交不一致，请刷新确认".to_owned());
    }
    for old in before.phrases.iter().filter(|p| p.id != rid) {
        if !after.phrases.contains(old) {
            return Err("其他常用语同时发生变化，请刷新审阅".to_owned());
        }
    }
    Ok(after)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_snapshot_rejects_stale_duplicate_and_mismatched_records() {
        let phrase = Phrase {
            id: "owned-id".to_owned(),
            text: "项目术语".to_owned(),
            modified: 123,
            ..Phrase::default()
        };
        let operation = Operation {
            kind: 1,
            id: phrase.id.clone(),
            record: Some(phrase.clone()),
            ..Operation::default()
        };
        let mut package = Package {
            format: 7,
            mode: 1,
            version: 42,
            operations: vec![operation.clone()],
            ..Package::default()
        };
        assert_eq!(
            decode_snapshot(&package.encode_to_vec(), 42).unwrap(),
            vec![phrase]
        );
        assert!(decode_snapshot(&package.encode_to_vec(), 41).is_err());
        package.operations.push(operation);
        assert!(decode_snapshot(&package.encode_to_vec(), 42).is_err());
        package.operations.pop();
        package.operations[0].id = "different-id".to_owned();
        assert!(decode_snapshot(&package.encode_to_vec(), 42).is_err());
        assert!(decode_snapshot(&[0x1f, 0x8b, 0], 42).is_err());
    }
}
