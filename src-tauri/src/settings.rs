use crate::hotwords::Binding;

use keyring::v1::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

pub const DEFAULT_SHORTCUT: &str = "CommandOrControl+Shift+Space";
pub const DEFAULT_LLM_PREFERENCE: &str = "保持自然口语，不要过度书面化。";
const STORE_PATH: &str = "settings.json";
const STORE_KEY: &str = "voicepaste";
const KEYRING_SERVICE: &str = "com.imbytecat.voicepaste";
const DOUBAO_KEYRING_ACCOUNT: &str = "doubao-api-key";
const LLM_KEYRING_ACCOUNT: &str = "llm-api-key";

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
pub struct LlmSettings {
    pub enabled: bool,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub prompt: String,
}

impl Default for LlmSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            base_url: String::new(),
            api_key: String::new(),
            model: String::new(),
            prompt: DEFAULT_LLM_PREFERENCE.to_owned(),
        }
    }
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
    pub llm: LlmSettings,
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
            llm: LlmSettings::default(),
        }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
struct PersistedLlmSettings {
    enabled: bool,
    base_url: String,
    model: String,
    prompt: String,
}

impl Default for PersistedLlmSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            base_url: String::new(),
            model: String::new(),
            prompt: DEFAULT_LLM_PREFERENCE.to_owned(),
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
    llm: PersistedLlmSettings,
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
            llm: PersistedLlmSettings::default(),
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
fn load_credential(account: &str, label: &str, notices: &mut Vec<String>) -> String {
    let entry = match Entry::new(KEYRING_SERVICE, account) {
        Ok(entry) => entry,
        Err(error) => {
            notices.push(format!("系统钥匙串暂时不可用，无法读取{label}：{error}"));
            return String::new();
        }
    };
    match entry.get_password() {
        Ok(key) => key,
        Err(KeyringError::NoEntry) => String::new(),
        Err(error) => {
            notices.push(format!("系统钥匙串暂时不可用，无法读取{label}：{error}"));
            String::new()
        }
    }
}

fn save_credential(account: &str, label: &str, value: &str) -> Result<CredentialStorage, String> {
    let entry = Entry::new(KEYRING_SERVICE, account)
        .map_err(|error| format!("系统钥匙串不可用，{label}未保存：{error}"))?;
    if value.is_empty() {
        return match entry.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(CredentialStorage::Removed),
            Err(error) => Err(format!("删除系统钥匙串中的{label}失败：{error}")),
        };
    }
    entry
        .set_password(value)
        .map_err(|error| format!("写入系统钥匙串失败，{label}未保存：{error}"))?;
    Ok(CredentialStorage::Keyring)
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

    let mut notices = Vec::new();
    let api_key = load_credential(DOUBAO_KEYRING_ACCOUNT, "豆包 API Key", &mut notices);
    let llm_api_key = load_credential(LLM_KEYRING_ACCOUNT, "LLM API Key", &mut notices);

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
            llm: LlmSettings {
                enabled: persisted.llm.enabled,
                base_url: persisted.llm.base_url,
                api_key: llm_api_key,
                model: persisted.llm.model,
                prompt: persisted.llm.prompt,
            },
        },
        hotword_binding: persisted.hotword_binding,
        notice: (!notices.is_empty()).then(|| notices.join("；")),
    })
}

pub fn save(
    app: &AppHandle,
    settings: &AppSettings,
    hotword_binding: Option<&Binding>,
) -> Result<CredentialStorage, String> {
    let credential_storage =
        save_credential(DOUBAO_KEYRING_ACCOUNT, "豆包 API Key", &settings.api_key)?;
    save_credential(LLM_KEYRING_ACCOUNT, "LLM API Key", &settings.llm.api_key)?;

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
            llm: PersistedLlmSettings {
                enabled: settings.llm.enabled,
                base_url: settings.llm.base_url.clone(),
                model: settings.llm.model.clone(),
                prompt: settings.llm.prompt.clone(),
            },
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
        assert!(!persisted.llm.enabled);
        assert_eq!(persisted.llm.prompt, DEFAULT_LLM_PREFERENCE);
    }

    #[test]
    fn llm_settings_round_trip_without_api_key() {
        let persisted = PersistedSettings {
            llm: PersistedLlmSettings {
                enabled: true,
                base_url: "http://localhost:11434/v1".to_owned(),
                model: "local-model".to_owned(),
                prompt: "修正文稿".to_owned(),
            },
            ..PersistedSettings::default()
        };
        let encoded = serde_json::to_value(&persisted).unwrap();
        assert!(encoded.pointer("/llm/apiKey").is_none());
        let decoded: PersistedSettings = serde_json::from_value(encoded).unwrap();
        assert!(decoded.llm.enabled);
        assert_eq!(decoded.llm.model, "local-model");
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
