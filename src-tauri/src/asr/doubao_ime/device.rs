use std::{
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::sync::Mutex;
use uuid::Uuid;

use super::super::ServiceIssue;
use crate::settings::{read_secret, write_secret};

const SECRET_ACCOUNT: &str = "doubao-ime-device";
const REGISTER_URL: &str = "https://log.snssdk.com/service/2/device_register/";
pub(super) const USER_AGENT: &str = "com.bytedance.android.doubaoime/100406010 (Linux; U; Android 16; en_US; Pixel 7 Pro; Build/BP2A.250605.031.A2; Cronet/TTNetVersion:94cf429a 2025-11-17 QuicVersion:1f89f732 2025-05-08)";
const MAX_HTTP_BODY: usize = 2 * 1024 * 1024;
const MAX_SECRET_BYTES: usize = 16 * 1024;

struct DeviceCache {
    identity: Option<DeviceIdentity>,
    registered: Option<Arc<str>>,
    needs_save: bool,
}

static CACHED: Mutex<DeviceCache> = Mutex::const_new(DeviceCache {
    identity: None,
    registered: None,
    needs_save: false,
});

#[derive(Deserialize, Serialize)]
struct DeviceIdentity {
    cdid: String,
    openudid: String,
    clientudid: String,
    device_id: Option<String>,
    install_id: Option<String>,
}

/// The task owns the lock until persistence finishes, even when recognition is
/// cancelled. Never leave a registered device uncommitted then register another.
pub(super) async fn device_id() -> Result<Arc<str>, ServiceIssue> {
    tokio::spawn(async {
        let mut cached = CACHED.lock().await;
        let DeviceCache {
            identity,
            registered,
            needs_save,
        } = &mut *cached;
        if let Some(value) = registered.as_ref() {
            return Ok(Arc::clone(value));
        }
        if identity.is_none() {
            let stored = tokio::task::spawn_blocking(|| read_secret(SECRET_ACCOUNT))
                .await
                .map_err(|_| storage_issue())?
                .map_err(|_| storage_issue())?;
            *identity = Some(match stored {
                Some(value) => {
                    if value.len() > MAX_SECRET_BYTES {
                        return Err(storage_issue());
                    }
                    let identity: DeviceIdentity =
                        serde_json::from_str(&value).map_err(|_| storage_issue())?;
                    validate_identity(&identity)?;
                    identity
                }
                None => {
                    *needs_save = true;
                    DeviceIdentity {
                        cdid: Uuid::new_v4().to_string(),
                        openudid: Uuid::new_v4().simple().to_string()[..16].to_owned(),
                        clientudid: Uuid::new_v4().to_string(),
                        device_id: None,
                        install_id: None,
                    }
                }
            });
        }
        let identity = identity.as_mut().ok_or_else(storage_issue)?;
        // Persist generated IDs before registration. A failed post-registration
        // write retains the returned identity in memory for the next explicit try.
        if *needs_save {
            store(identity).await?;
            *needs_save = false;
        }
        if identity.device_id.is_none() {
            register(identity).await?;
            *needs_save = true;
            store(identity).await?;
            *needs_save = false;
        }
        let device_id = identity.device_id.as_deref().ok_or_else(storage_issue)?;
        let value = Arc::<str>::from(device_id);
        *registered = Some(Arc::clone(&value));
        Ok(value)
    })
    .await
    .map_err(|_| ServiceIssue::unknown("豆包输入法设备初始化任务中断"))?
}

pub(super) async fn organize(token: &str, text: &str) -> Result<String, String> {
    let did = device_id().await.map_err(|issue| issue.detail)?;
    let iid = {
        let cached = CACHED.lock().await;
        cached
            .identity
            .as_ref()
            .and_then(|identity| identity.install_id.clone())
            .ok_or("豆包设备身份尚未注册")?
    };
    crate::doubao_ime_transport::organize(token, &did, &iid, text).await
}

pub(super) async fn translate(token: &str, text: &str, to_english: bool) -> Result<String, String> {
    let did = device_id().await.map_err(|issue| issue.detail)?;
    let iid = CACHED
        .lock()
        .await
        .identity
        .as_ref()
        .and_then(|identity| identity.install_id.clone())
        .ok_or("豆包设备身份尚未注册")?;
    crate::doubao_ime_transport::translate(token, &did, &iid, text, to_english).await
}

pub(crate) async fn sync_identity() -> Result<(String, String), String> {
    let did = device_id().await.map_err(|issue| issue.detail)?;
    let iid = CACHED
        .lock()
        .await
        .identity
        .as_ref()
        .and_then(|i| i.install_id.clone())
        .ok_or("豆包设备尚未注册")?;
    Ok((did.to_string(), iid))
}

fn storage_issue() -> ServiceIssue {
    ServiceIssue::credential_storage("无法安全读取或保存豆包输入法设备身份；没有使用明文替代存储")
}

fn validate_identity(identity: &DeviceIdentity) -> Result<(), ServiceIssue> {
    if Uuid::parse_str(&identity.cdid).is_err()
        || Uuid::parse_str(&identity.clientudid).is_err()
        || identity.openudid.len() != 16
        || !identity
            .openudid
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
        || identity
            .device_id
            .as_deref()
            .is_some_and(|value| !valid_server_id(value))
        || identity
            .install_id
            .as_deref()
            .is_some_and(|value| !valid_server_id(value))
        || identity.device_id.is_some() != identity.install_id.is_some()
    {
        return Err(storage_issue());
    }
    Ok(())
}

fn valid_server_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 32
        && value.bytes().all(|byte| byte.is_ascii_digit())
        && value.bytes().any(|byte| byte != b'0')
}

async fn store(identity: &DeviceIdentity) -> Result<(), ServiceIssue> {
    let secret = serde_json::to_string(identity).map_err(|_| storage_issue())?;
    tokio::task::spawn_blocking(move || write_secret(SECRET_ACCOUNT, Some(&secret)))
        .await
        .map_err(|_| storage_issue())?
        .map_err(|_| storage_issue())
}

pub(super) fn timestamp_ms() -> Result<u64, ServiceIssue> {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| ServiceIssue::unknown("系统时间早于 Unix 纪元，请校准时钟"))?;
    u64::try_from(elapsed.as_millis()).map_err(|_| ServiceIssue::unknown("系统时间超出支持范围"))
}

fn registration_url(cdid: &str) -> Result<Url, ServiceIssue> {
    let mut url =
        Url::parse(REGISTER_URL).map_err(|_| ServiceIssue::unknown("设备服务地址无效"))?;
    url.query_pairs_mut()
        .extend_pairs([
            ("device_platform", "android"),
            ("os", "android"),
            ("ssmix", "a"),
            ("channel", "official"),
            ("aid", "401734"),
            ("app_name", "oime"),
            ("version_code", "100406010"),
            ("version_name", "1.4.6"),
            ("cdid", cdid),
        ])
        .append_pair("_rticket", &timestamp_ms()?.to_string());
    Ok(url)
}

async fn register(identity: &mut DeviceIdentity) -> Result<(), ServiceIssue> {
    let client = Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| ServiceIssue::network("无法创建豆包输入法 HTTPS 客户端"))?;
    let mut url = registration_url(&identity.cdid)?;
    url.query_pairs_mut().extend_pairs([
        ("manifest_version_code", "100406010"),
        ("update_version_code", "100406010"),
        ("resolution", "1080*2400"),
        ("dpi", "420"),
        ("device_type", "Pixel 7 Pro"),
        ("device_brand", "google"),
        ("language", "zh"),
        ("os_api", "34"),
        ("os_version", "16"),
        ("ac", "wifi"),
    ]);
    // Protocol device template only: no host identifiers or browser state are read.
    let header = json!({
            "device_id": 0, "install_id": 0, "aid": 401734, "app_name": "oime",
            "version_code": 100406010, "version_name": "1.4.6",
            "manifest_version_code": 100406010, "update_version_code": 100406010,
            "channel": "official", "package": "com.bytedance.android.doubaoime",
            "device_platform": "android", "os": "android", "os_api": "34", "os_version": "16",
            "device_type": "Pixel 7 Pro", "device_brand": "google", "device_model": "Pixel 7 Pro",
            "resolution": "1080*2400", "dpi": "420", "language": "zh", "timezone": 8,
            "access": "wifi", "rom": "UP1A.231005.007", "rom_version": "UP1A.231005.007",
            "openudid": identity.openudid, "clientudid": identity.clientudid, "cdid": identity.cdid,
            "region": "CN", "tz_name": "Asia/Shanghai", "tz_offset": 28800,
            "sim_region": "cn", "carrier_region": "cn", "cpu_abi": "arm64-v8a",
            "build_serial": "unknown", "not_request_sender": 0,
            "sig_hash": "", "google_aid": "", "mc": "", "serial_number": ""
    });
    let body = json!({
        "magic_tag": "ss_app_log", "_gen_time": timestamp_ms()?, "header": header
    });
    let response = client
        .post(url)
        .json(&body)
        .send()
        .await
        .map_err(|_| ServiceIssue::network("注册豆包输入法设备失败"))?;
    let value = bounded_json(response).await?;
    let read_id = |name: &str| -> Result<String, ServiceIssue> {
        let id = match &value[name] {
            Value::String(value) => value.clone(),
            Value::Number(value) => value
                .as_u64()
                .map(|value| value.to_string())
                .unwrap_or_default(),
            _ => String::new(),
        };
        if !valid_server_id(&id) {
            return Err(ServiceIssue::unknown("豆包输入法注册没有返回有效设备身份"));
        }
        Ok(id)
    };
    let device_id = read_id("device_id")?;
    let install_id = read_id("install_id")?;
    identity.device_id = Some(device_id);
    identity.install_id = Some(install_id);
    Ok(())
}

async fn bounded_json(mut response: reqwest::Response) -> Result<Value, ServiceIssue> {
    if !response.status().is_success() {
        return Err(super::http_issue(response.status().as_u16(), false));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_HTTP_BODY as u64)
    {
        return Err(ServiceIssue::unknown("豆包输入法设备响应超过大小限制"));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| ServiceIssue::network("读取豆包输入法设备配置中断"))?
    {
        if chunk.len() > MAX_HTTP_BODY - body.len() {
            return Err(ServiceIssue::unknown("豆包输入法设备响应超过大小限制"));
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body)
        .map_err(|_| ServiceIssue::unknown("豆包输入法设备响应不是有效 JSON"))
}
