use std::collections::HashSet;

use keyring::v1::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

pub const DEFAULT_SHORTCUT: &str = "CommandOrControl+Shift+Space";
const STORE_PATH: &str = "settings.json";
const STORE_KEY: &str = "voicepaste";
const KEYRING_SERVICE: &str = "com.imbytecat.voicepaste";
const KEYRING_ACCOUNT: &str = "doubao-api-key";
const MAX_HOTWORD_CHARS: usize = 100;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ActivationMode {
    #[default]
    Toggle,
    Hold,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OverlayPosition {
    #[default]
    Bottom,
    Left,
    Right,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    pub api_key: String,
    pub shortcut: String,
    pub activation_mode: ActivationMode,
    pub microphone_id: String,
    pub hotwords: Vec<String>,
    pub hotwords_enabled: bool,
    pub onboarding_completed: bool,
    pub launch_at_startup: bool,
    pub open_settings_on_startup: bool,
    pub overlay_position: OverlayPosition,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            shortcut: DEFAULT_SHORTCUT.to_owned(),
            activation_mode: ActivationMode::default(),
            microphone_id: String::new(),
            hotwords: Vec::new(),
            hotwords_enabled: true,
            onboarding_completed: false,
            launch_at_startup: false,
            open_settings_on_startup: false,
            overlay_position: OverlayPosition::default(),
        }
    }
}

#[derive(Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
struct PersistedSettings {
    shortcut: String,
    activation_mode: ActivationMode,
    microphone_id: String,
    hotwords: Vec<String>,
    hotwords_enabled: Option<bool>,
    onboarding_completed: bool,
    open_settings_on_startup: bool,
    overlay_position: OverlayPosition,
    #[serde(skip_serializing)]
    api_key_fallback: Option<String>,
}

pub struct LoadedSettings {
    pub settings: AppSettings,
    pub notice: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CredentialStorage {
    Keyring,
    Removed,
}

pub fn load(app: &AppHandle) -> Result<LoadedSettings, String> {
    let store = app
        .store(STORE_PATH)
        .map_err(|error| format!("打开设置存储失败：{error}"))?;
    let mut persisted: PersistedSettings = store
        .get(STORE_KEY)
        .map(serde_json::from_value)
        .transpose()
        .map_err(|error| format!("解析设置失败：{error}"))?
        .unwrap_or_default();

    let mut notice = None;
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).ok();
    let mut api_key = match entry.as_ref().map(Entry::get_password) {
        Some(Ok(key)) => key,
        Some(Err(KeyringError::NoEntry)) | None => String::new(),
        Some(Err(error)) => {
            notice = Some(format!("系统钥匙串暂时不可用：{error}"));
            String::new()
        }
    };

    if let Some(legacy_key) = persisted
        .api_key_fallback
        .take()
        .filter(|key| !key.is_empty())
    {
        if let Some(entry) = entry {
            match entry.set_password(&legacy_key) {
                Ok(()) => {
                    api_key = legacy_key;
                    notice = Some("旧版明文 API Key 已迁移到系统钥匙串".to_owned());
                }
                Err(error) => {
                    notice = Some(format!(
                        "旧版明文 API Key 已从本地清除，请重新填写：{error}"
                    ));
                }
            }
        } else {
            notice = Some("旧版明文 API Key 已从本地清除，请重新填写".to_owned());
        }
        persist(app, &persisted)?;
    }

    Ok(LoadedSettings {
        settings: AppSettings {
            api_key,
            shortcut: if persisted.shortcut.is_empty() {
                DEFAULT_SHORTCUT.to_owned()
            } else {
                persisted.shortcut
            },
            activation_mode: persisted.activation_mode,
            microphone_id: persisted.microphone_id,
            hotwords: persisted.hotwords,
            hotwords_enabled: persisted.hotwords_enabled.unwrap_or(true),
            onboarding_completed: persisted.onboarding_completed,
            launch_at_startup: false,
            open_settings_on_startup: persisted.open_settings_on_startup,
            overlay_position: persisted.overlay_position,
        },
        notice,
    })
}

pub fn save(app: &AppHandle, settings: &AppSettings) -> Result<CredentialStorage, String> {
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|error| format!("系统钥匙串不可用，API Key 未保存：{error}"))?;
    let credential_storage = if settings.api_key.is_empty() {
        match entry.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => CredentialStorage::Removed,
            Err(error) => return Err(format!("删除系统钥匙串中的 API Key 失败：{error}")),
        }
    } else {
        entry
            .set_password(&settings.api_key)
            .map_err(|error| format!("写入系统钥匙串失败，API Key 未保存：{error}"))?;
        CredentialStorage::Keyring
    };

    persist(
        app,
        &PersistedSettings {
            shortcut: settings.shortcut.clone(),
            activation_mode: settings.activation_mode,
            microphone_id: settings.microphone_id.clone(),
            hotwords: settings.hotwords.clone(),
            hotwords_enabled: Some(settings.hotwords_enabled),
            onboarding_completed: settings.onboarding_completed,
            open_settings_on_startup: settings.open_settings_on_startup,
            overlay_position: settings.overlay_position,
            api_key_fallback: None,
        },
    )?;
    Ok(credential_storage)
}

fn persist(app: &AppHandle, settings: &PersistedSettings) -> Result<(), String> {
    let store = app
        .store(STORE_PATH)
        .map_err(|error| format!("打开设置存储失败：{error}"))?;
    store.set(
        STORE_KEY,
        serde_json::to_value(settings).map_err(|error| format!("编码设置失败：{error}"))?,
    );
    store
        .save()
        .map_err(|error| format!("保存设置失败：{error}"))
}

pub fn sanitize_hotwords(hotwords: Vec<String>) -> Result<Vec<String>, String> {
    let mut seen = HashSet::new();
    let mut total_chars = 0;
    let mut normalized = Vec::new();
    for word in hotwords {
        let word = word.trim();
        if word.is_empty() || !seen.insert(word.to_lowercase()) {
            continue;
        }
        total_chars += word.chars().count();
        if total_chars > MAX_HOTWORD_CHARS {
            return Err("热词总长度不能超过 100 个字符（按接口 token 上限保守限制）".to_owned());
        }
        normalized.push(word.to_owned());
    }
    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hotwords_are_trimmed_deduplicated_and_bounded() {
        assert_eq!(
            sanitize_hotwords(vec![
                " VoicePaste ".into(),
                "voicepaste".into(),
                "豆包".into()
            ])
            .unwrap(),
            ["VoicePaste", "豆包"]
        );
        assert!(sanitize_hotwords(vec!["字".repeat(101)]).is_err());
    }

    #[test]
    fn older_settings_receive_safe_product_defaults() {
        let persisted: PersistedSettings = serde_json::from_value(serde_json::json!({
            "shortcut": "Control+Space",
            "hotwords": ["VoicePaste"]
        }))
        .unwrap();

        assert!(!persisted.onboarding_completed);
        assert!(!persisted.open_settings_on_startup);
        assert!(matches!(
            persisted.overlay_position,
            OverlayPosition::Bottom
        ));

        let settings: AppSettings = serde_json::from_value(serde_json::json!({
            "shortcut": "Control+Space",
            "hotwords": ["VoicePaste"]
        }))
        .unwrap();
        assert!(settings.hotwords_enabled);
    }
}
