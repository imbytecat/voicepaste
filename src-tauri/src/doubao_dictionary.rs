use crate::doubao_ime_transport::request;
use serde::Serialize;
use serde_json::Value;

const LIMIT: usize = 16 * 1024 * 1024;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Word {
    pub text: String,
    pub input: String,
    pub frequency: u64,
}
#[derive(Serialize)]
pub struct Snapshot {
    pub version: String,
    pub words: Vec<Word>,
}
fn u16_at(bytes: &[u8], at: usize) -> Result<usize, String> {
    let b = bytes
        .get(at..at.checked_add(2).ok_or("词库偏移溢出")?)
        .ok_or("词库数据截断")?;
    Ok(u16::from_le_bytes([b[0], b[1]]) as usize)
}
fn u32_at(bytes: &[u8], at: usize) -> Result<usize, String> {
    let b = bytes
        .get(at..at.checked_add(4).ok_or("词库偏移溢出")?)
        .ok_or("词库数据截断")?;
    Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize)
}
fn field<'a>(bytes: &'a [u8], pos: &mut usize) -> Result<&'a [u8], String> {
    let len = u16_at(bytes, *pos)?;
    *pos += 2;
    let end = pos.checked_add(len).ok_or("词库字段溢出")?;
    let result = bytes.get(*pos..end).ok_or("词库字段越界")?;
    *pos = end;
    Ok(result)
}
fn decode(bytes: &[u8]) -> Result<Vec<Word>, String> {
    if bytes.len() < 48 || bytes.len() > LIMIT {
        return Err("词库文件大小无效".to_owned());
    }
    let mut h = [0usize; 12];
    for (i, v) in h.iter_mut().enumerate() {
        *v = u32_at(bytes, i * 4)?;
    }
    let [
        magic,
        format,
        header,
        total,
        count,
        node_offset,
        node_bytes,
        data_count,
        data_offset,
        data_bytes,
        ext,
        ext_bytes,
    ] = h;
    if magic != 0x2f0c
        || format != 20260710
        || header != 48
        || total != bytes.len()
        || !(2..=LIMIT / 10).contains(&count)
        || node_offset != 48
        || node_bytes != count * 10
        || data_offset != node_offset + node_bytes
        || ext != data_offset + data_bytes
        || ext.checked_add(ext_bytes) != Some(total)
        || ext_bytes < 51
    {
        return Err("个人词库格式或区间无效".to_owned());
    }
    let extension = bytes.get(ext..).ok_or("词库扩展区越界")?;
    let width = u16_at(extension, 5)?;
    if u16_at(extension, 0)? + 2 != ext_bytes
        || extension[2] < 7
        || extension[3] != 4
        || extension[4] < 4
        || width < 14
    {
        return Err("个人词库属性布局不受支持".to_owned());
    }
    let mut checked = bytes.to_vec();
    checked[ext + 11..ext + 15].fill(0);
    checked[ext + 19..ext + 51].fill(b'0');
    let digest = openssl::hash::hash(openssl::hash::MessageDigest::md5(), &checked)
        .map_err(|_| "词库摘要计算失败")?;
    let expected = digest
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    if expected.as_bytes() != &bytes[ext + 19..ext + 51] {
        return Err("个人词库校验失败".to_owned());
    }
    let mut words = Vec::new();
    let mut lists = 0;
    for index in 0..count - 1 {
        let node = node_offset + index * 10;
        let next = node + 10;
        let start = u32_at(bytes, node + 2)?;
        let end = u32_at(bytes, next + 2)?;
        let offset = u32_at(bytes, node + 6)?;
        let next_offset = u32_at(bytes, next + 6)?;
        if start > end || end > count || offset > next_offset || next_offset > data_bytes {
            return Err("个人词库节点越界".to_owned());
        }
        for child in start..end.saturating_sub(1) {
            if u16_at(bytes, node_offset + child * 10)?
                >= u16_at(bytes, node_offset + (child + 1) * 10)?
            {
                return Err("个人词库节点排序无效".to_owned());
            }
        }
        if offset == next_offset {
            continue;
        }
        lists += 1;
        let list = bytes
            .get(data_offset + offset..data_offset + next_offset)
            .ok_or("词库记录越界")?;
        let items = u32_at(list, 0)?;
        let mut pos = 4;
        if items > 40000 {
            return Err("个人词库记录超限".to_owned());
        }
        for _ in 0..items {
            let len = u16_at(list, pos)?;
            pos += 2;
            let stop = pos.checked_add(len).ok_or("词库记录溢出")?;
            let record = list.get(pos..stop).ok_or("个人词库记录截断")?;
            pos = stop;
            let mut p = 0;
            let utf16 = field(record, &mut p)?;
            if utf16.is_empty() || utf16.len() % 2 != 0 {
                return Err("词库文本编码无效".to_owned());
            }
            let units = utf16
                .as_chunks::<2>()
                .0
                .iter()
                .map(|b| u16::from_le_bytes([b[0], b[1]]))
                .collect::<Vec<_>>();
            let text = String::from_utf16(&units).map_err(|_| "个人词库文本无效")?;
            let input = std::str::from_utf8(field(record, &mut p)?)
                .map_err(|_| "词库拼音编码无效")?
                .to_owned();
            let flags = *record.get(p).ok_or("个人词库属性缺失")?;
            p += 1;
            let attrs = field(record, &mut p)?;
            if input.is_empty()
                || flags & 3 == 0
                || attrs.len() != (flags & 3).count_ones() as usize * width
                || p != record.len()
            {
                return Err("个人词库属性无效".to_owned());
            }
            let frequency = attrs
                .chunks_exact(width)
                .try_fold(0u64, |sum, a| u32_at(a, 0).map(|n| sum + n as u64))?;
            words.push(Word {
                text,
                input,
                frequency,
            });
            if words.len() > 40000 {
                return Err("个人词库记录超限".to_owned());
            }
        }
        if pos != list.len() {
            return Err("个人词库记录尾部无效".to_owned());
        }
    }
    if lists != data_count {
        return Err("个人词库记录数不匹配".to_owned());
    }
    Ok(words)
}
async fn api(token: &str, did: &str, iid: &str, path: &str) -> Result<Value, String> {
    let raw = request(token, did, iid, path, None, &[]).await?;
    let value: Value = serde_json::from_slice(&raw).map_err(|_| "个人词库响应无效")?;
    if value["code"] != 0 {
        return Err("个人词库服务拒绝读取".to_owned());
    }
    Ok(value["data"].clone())
}
pub async fn snapshot(token: &str, did: &str, iid: &str) -> Result<Snapshot, String> {
    let before =
        api(token, did, iid, "/api/v2/sync/version?sync_type=2").await?["last_version_seq"]
            .as_u64()
            .ok_or("个人词库版本无效")?;
    let pull = api(
        token,
        did,
        iid,
        "/api/v2/sync/pull?sync_type=2&start_version_seq=0",
    )
    .await?;
    if !matches!(pull["data_type"].as_str(), Some("full" | "")) {
        return Err("个人词库下载类型不受支持".to_owned());
    }
    let address = pull["url"].as_str().ok_or("个人词库下载地址缺失")?;
    let words = if address.is_empty() {
        Vec::new()
    } else {
        let url = reqwest::Url::parse(address).map_err(|_| "词库下载地址无效")?;
        if url.scheme() != "https"
            || !url
                .host_str()
                .is_some_and(|h| h.ends_with(".doubaocdn.com"))
            || !url.username().is_empty()
            || url.password().is_some()
            || url.port().is_some_and(|p| p != 443)
        {
            return Err("词库下载地址不可信".to_owned());
        }
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|_| "词库连接失败")?;
        let mut response = client
            .get(url)
            .header("Accept-Encoding", "identity")
            .send()
            .await
            .map_err(|_| "词库下载失败")?;
        if !response.status().is_success() {
            return Err("词库下载被拒绝".to_owned());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| "词库下载中断")? {
            if bytes.len().saturating_add(chunk.len()) > LIMIT {
                return Err("词库下载超限".to_owned());
            }
            bytes.extend_from_slice(&chunk);
        }
        decode(&bytes)?
    };
    if api(token, did, iid, "/api/v2/sync/version?sync_type=2").await?["last_version_seq"].as_u64()
        != Some(before)
    {
        return Err("个人词库读取期间变化，请刷新".to_owned());
    }
    Ok(Snapshot {
        version: before.to_string(),
        words,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn malformed_dictionary_cannot_become_an_empty_success() {
        assert!(decode(&[]).is_err());
        assert!(decode(&[0; 48]).is_err());
        let mut data = vec![0u8; 119];
        for (i, n) in [0x2f0c_u32, 20260710, 48, 119, 2, 48, 20, 0, 68, 0, 68, 51]
            .iter()
            .enumerate()
        {
            data[i * 4..i * 4 + 4].copy_from_slice(&n.to_le_bytes());
        }
        data[68..70].copy_from_slice(&49u16.to_le_bytes());
        data[70] = 7;
        data[71] = 4;
        data[72] = 4;
        data[73..75].copy_from_slice(&14u16.to_le_bytes());
        data[87..119].fill(b'0');
        assert!(decode(&data).is_err());
        let digest = openssl::hash::hash(openssl::hash::MessageDigest::md5(), &data).unwrap();
        let hex = digest
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        data[87..119].copy_from_slice(hex.as_bytes());
        assert_eq!(decode(&data).unwrap().len(), 0);
        data[54] = 1;
        assert!(decode(&data).is_err());
    }
}
