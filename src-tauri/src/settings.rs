use crate::hotwords::Binding;

use keyring::v1::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

pub const DEFAULT_SHORTCUT: &str = "CommandOrControl+Shift+Space";
const STORE_PATH: &str = "settings.json";
const STORE_KEY: &str = "voicepaste";
const KEYRING_SERVICE: &str = "com.imbytecat.voicepaste";
const KEYRING_ACCOUNT: &str = "doubao-api-key";

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
            open_settings_on_startup: true,
            overlay_position: OverlayPosition::default(),
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
struct PersistedSettings {
    shortcut: String,
    activation_mode: ActivationMode,
    microphone_id: String,
    hotwords: Vec<String>,
    hotwords_enabled: bool,
    hotword_binding: Option<Binding>,
    onboarding_completed: bool,
    open_settings_on_startup: bool,
    overlay_position: OverlayPosition,
}

impl Default for PersistedSettings {
    fn default() -> Self {
        Self {
            shortcut: DEFAULT_SHORTCUT.to_owned(),
            activation_mode: ActivationMode::default(),
            microphone_id: String::new(),
            hotwords: Vec::new(),
            hotwords_enabled: true,
            hotword_binding: None,
            onboarding_completed: false,
            open_settings_on_startup: true,
            overlay_position: OverlayPosition::default(),
        }
    }
}

pub struct LoadedSettings {
    pub settings: AppSettings,
    pub hotword_binding: Option<Binding>,
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
    let persisted: PersistedSettings = store
        .get(STORE_KEY)
        .map(serde_json::from_value)
        .transpose()
        .map_err(|error| format!("解析设置失败：{error}"))?
        .unwrap_or_default();

    let mut notice = None;
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).ok();
    let api_key = match entry.as_ref().map(Entry::get_password) {
        Some(Ok(key)) => key,
        Some(Err(KeyringError::NoEntry)) | None => String::new(),
        Some(Err(error)) => {
            notice = Some(format!("系统钥匙串暂时不可用：{error}"));
            String::new()
        }
    };

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
            hotwords_enabled: persisted.hotwords_enabled,
            onboarding_completed: persisted.onboarding_completed,
            launch_at_startup: false,
            open_settings_on_startup: persisted.open_settings_on_startup,
            overlay_position: persisted.overlay_position,
        },
        hotword_binding: persisted.hotword_binding,
        notice,
    })
}

pub fn save(
    app: &AppHandle,
    settings: &AppSettings,
    hotword_binding: Option<&Binding>,
) -> Result<CredentialStorage, String> {
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
            hotwords_enabled: settings.hotwords_enabled,
            onboarding_completed: settings.onboarding_completed,
            open_settings_on_startup: settings.open_settings_on_startup,
            overlay_position: settings.overlay_position,
            hotword_binding: hotword_binding.cloned(),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persisted_defaults_match_product_defaults() {
        let persisted = PersistedSettings::default();
        assert_eq!(persisted.shortcut, DEFAULT_SHORTCUT);
        assert!(persisted.hotwords_enabled);
        assert!(persisted.open_settings_on_startup);
        assert!(persisted.hotword_binding.is_none());
    }

    #[test]
    fn cloud_binding_round_trips_with_settings() {
        let persisted = PersistedSettings {
            hotwords: vec!["VoicePaste".to_owned()],
            hotword_binding: Some(Binding {
                table_id: "table-id".to_owned(),
                limit: 5000,
            }),
            ..PersistedSettings::default()
        };
        let encoded = serde_json::to_value(&persisted).unwrap();
        let decoded: PersistedSettings = serde_json::from_value(encoded).unwrap();
        assert_eq!(decoded.hotwords, ["VoicePaste"]);
        assert_eq!(decoded.hotword_binding, persisted.hotword_binding);
    }
}
