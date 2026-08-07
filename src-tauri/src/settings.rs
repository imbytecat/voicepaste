use keyring::v1::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

pub const DEFAULT_SHORTCUT: &str = "CommandOrControl+Shift+Space";
pub const DEFAULT_RESOURCE_ID: &str = "volc.seedasr.sauc.duration";
const STORE_PATH: &str = "settings.json";
const STORE_KEY: &str = "voicepaste";
const KEYRING_SERVICE: &str = "com.imbytecat.voicepaste";
const KEYRING_ACCOUNT: &str = "doubao-api-key";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    pub api_key: String,
    pub resource_id: String,
    pub shortcut: String,
    pub hotwords: Vec<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            resource_id: DEFAULT_RESOURCE_ID.to_owned(),
            shortcut: DEFAULT_SHORTCUT.to_owned(),
            hotwords: Vec::new(),
        }
    }
}

#[derive(Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
struct PersistedSettings {
    resource_id: String,
    shortcut: String,
    hotwords: Vec<String>,
    api_key_fallback: Option<String>,
}

pub fn load(app: &AppHandle) -> Result<AppSettings, String> {
    let store = app
        .store(STORE_PATH)
        .map_err(|error| format!("打开设置存储失败：{error}"))?;
    let persisted: PersistedSettings = store
        .get(STORE_KEY)
        .map(serde_json::from_value)
        .transpose()
        .map_err(|error| format!("解析设置失败：{error}"))?
        .unwrap_or_default();
    let api_key = match Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT) {
        Ok(entry) => match entry.get_password() {
            Ok(key) => key,
            Err(KeyringError::NoEntry) => persisted.api_key_fallback.unwrap_or_default(),
            Err(_) => persisted.api_key_fallback.unwrap_or_default(),
        },
        Err(_) => persisted.api_key_fallback.unwrap_or_default(),
    };

    Ok(AppSettings {
        api_key,
        resource_id: if persisted.resource_id.is_empty() {
            DEFAULT_RESOURCE_ID.to_owned()
        } else {
            persisted.resource_id
        },
        shortcut: if persisted.shortcut.is_empty() {
            DEFAULT_SHORTCUT.to_owned()
        } else {
            persisted.shortcut
        },
        hotwords: persisted.hotwords,
    })
}

pub fn save(app: &AppHandle, settings: &AppSettings) -> Result<bool, String> {
    let mut persisted = PersistedSettings {
        resource_id: settings.resource_id.clone(),
        shortcut: settings.shortcut.clone(),
        hotwords: settings.hotwords.clone(),
        api_key_fallback: None,
    };
    let stored_securely = match Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT) {
        Ok(entry) if settings.api_key.is_empty() => match entry.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => true,
            Err(_) => false,
        },
        Ok(entry) => entry.set_password(&settings.api_key).is_ok(),
        Err(_) => false,
    };
    if !stored_securely && !settings.api_key.is_empty() {
        persisted.api_key_fallback = Some(settings.api_key.clone());
    }

    let store = app
        .store(STORE_PATH)
        .map_err(|error| format!("打开设置存储失败：{error}"))?;
    store.set(
        STORE_KEY,
        serde_json::to_value(persisted).map_err(|error| format!("编码设置失败：{error}"))?,
    );
    store
        .save()
        .map_err(|error| format!("保存设置失败：{error}"))?;
    Ok(stored_securely)
}
