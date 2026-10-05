use crate::hotwords::Binding;

use keyring::v1::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{fs, io::Write, path::Path};
use tauri::{AppHandle, Manager};

pub const DEFAULT_SHORTCUT: &str = "CommandOrControl+Shift+Space";
pub const DEFAULT_LLM_PREFERENCE: &str =
    "保持说话者原意、人称和自然口语，只做必要润色，不要过度书面化。";
const STORE_PATH: &str = "settings.json";
const STORE_KEY: &str = "voicepaste";
const SCHEMA_VERSION: u64 = 3;
const KEYRING_SERVICE: &str = "com.imbytecat.voicepaste";
const VOLCENGINE_KEYRING_ACCOUNT: &str = "volcengine-api-key";

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ActivationMode {
    Toggle,
    #[default]
    Hold,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OverlayPosition {
    #[default]
    Bottom,
    Left,
    Right,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RecognitionProvider {
    Volcengine,
    #[default]
    DoubaoIme,
}

impl RecognitionProvider {
    fn profile(self) -> &'static str {
        match self {
            Self::Volcengine => "volcengine",
            Self::DoubaoIme => "doubaoIme",
        }
    }

    fn llm_credential(self) -> &'static str {
        match self {
            Self::Volcengine => "volcengine-llm-api-key",
            Self::DoubaoIme => "doubao-ime-llm-api-key",
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct VolcengineSettings {
    pub api_key: String,
    pub hotwords: Vec<String>,
    pub hotwords_enabled: bool,
    pub hotword_draft: Option<Vec<String>>,
    pub llm: LlmSettings,
    // Internal recovery record, never accepted from a frontend settings save.
    #[serde(skip)]
    pub hotword_pending: Option<Vec<String>>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DoubaoImeSettings {
    pub llm: LlmSettings,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct RecognitionSettings {
    pub provider: RecognitionProvider,
    pub volcengine: VolcengineSettings,
    pub doubao_ime: DoubaoImeSettings,
}

impl RecognitionSettings {
    pub fn llm(&self) -> &LlmSettings {
        match self.provider {
            RecognitionProvider::Volcengine => &self.volcengine.llm,
            RecognitionProvider::DoubaoIme => &self.doubao_ime.llm,
        }
    }

    pub fn llm_mut(&mut self) -> &mut LlmSettings {
        match self.provider {
            RecognitionProvider::Volcengine => &mut self.volcengine.llm,
            RecognitionProvider::DoubaoIme => &mut self.doubao_ime.llm,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct LlmSettings {
    pub enabled: bool,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub prompt: String,
    pub streaming: bool,
    pub extra_parameters: String,
}

impl Default for LlmSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            base_url: String::new(),
            api_key: String::new(),
            model: String::new(),
            prompt: DEFAULT_LLM_PREFERENCE.to_owned(),
            streaming: true,
            extra_parameters: String::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    pub recognition: RecognitionSettings,
    pub shortcut: String,
    pub activation_mode: ActivationMode,
    pub microphone_id: String,
    pub onboarding_completed: bool,
    pub launch_at_startup: bool,
    pub open_settings_on_startup: bool,
    pub overlay_position: OverlayPosition,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            recognition: RecognitionSettings::default(),
            shortcut: DEFAULT_SHORTCUT.to_owned(),
            activation_mode: ActivationMode::default(),
            microphone_id: String::new(),
            onboarding_completed: false,
            launch_at_startup: false,
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

/// Blocking: callers on an async path must use spawn_blocking.
pub fn read_secret(account: &str) -> Result<Option<String>, String> {
    let entry = Entry::new(KEYRING_SERVICE, account)
        .map_err(|error| format!("系统凭据库不可用：{error}"))?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!("读取系统凭据库失败：{error}")),
    }
}

/// None explicitly removes this credential; there is no plaintext fallback.
pub fn write_secret(account: &str, value: Option<&str>) -> Result<(), String> {
    let entry = Entry::new(KEYRING_SERVICE, account)
        .map_err(|error| format!("系统凭据库不可用：{error}"))?;
    match value {
        Some(value) => entry
            .set_password(value)
            .map_err(|error| format!("写入系统凭据库失败：{error}")),
        None => match entry.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(error) => Err(format!("删除系统凭据失败：{error}")),
        },
    }
}

fn validate_document(mut value: Value) -> Result<Value, String> {
    let object = value.as_object().ok_or("设置文件必须是一个对象")?;
    if object.get("version").and_then(Value::as_u64) != Some(SCHEMA_VERSION) {
        return Err("此设置格式不受支持；仅接受当前版本，原文件未修改，请重新配置".to_owned());
    }
    strip_document_secrets(&mut value);
    Ok(value)
}

fn strip_document_secrets(value: &mut Value) {
    // Only credential-store values can populate the provider credential fields.
    for pointer in [
        "/recognition/volcengine",
        "/recognition/volcengine/llm",
        "/recognition/doubaoIme/llm",
    ] {
        if let Some(object) = value.pointer_mut(pointer).and_then(Value::as_object_mut) {
            object.remove("apiKey");
        }
    }
}

fn decode_document(value: &Value) -> Result<(AppSettings, Option<Binding>), String> {
    let provider: RecognitionProvider = serde_json::from_value(
        value
            .pointer("/recognition/provider")
            .cloned()
            .unwrap_or(json!("doubaoIme")),
    )
    .map_err(|error| format!("识别渠道无效：{error}"))?;
    let mut active = value.clone();
    if active.get("recognition").is_none() {
        active["recognition"] = json!({});
    }
    let inactive = match provider {
        RecognitionProvider::Volcengine => "doubaoIme",
        RecognitionProvider::DoubaoIme => "volcengine",
    };
    active["recognition"]
        .as_object_mut()
        .ok_or("识别设置必须是对象")?
        .remove(inactive);
    let binding = if provider == RecognitionProvider::Volcengine {
        value
            .pointer("/recognition/volcengine/hotwordBinding")
            .filter(|value| !value.is_null())
            .cloned()
            .map(serde_json::from_value)
            .transpose()
            .map_err(|error| format!("解析常用词绑定失败：{error}"))?
    } else {
        None
    };
    let mut settings: AppSettings =
        serde_json::from_value(active).map_err(|error| format!("解析当前渠道设置失败：{error}"))?;
    if provider == RecognitionProvider::Volcengine {
        settings.recognition.volcengine.hotword_pending = value
            .pointer("/recognition/volcengine/hotwordPending")
            .filter(|value| !value.is_null())
            .cloned()
            .map(serde_json::from_value)
            .transpose()
            .map_err(|error| format!("解析常用词未决提交失败：{error}"))?;
    }
    settings.recognition.volcengine.api_key.clear();
    settings.recognition.llm_mut().api_key.clear();
    if settings.shortcut.is_empty() {
        settings.shortcut = DEFAULT_SHORTCUT.to_owned();
    }
    Ok((settings, binding))
}

fn encode_document(
    settings: &AppSettings,
    binding: Option<&Binding>,
    previous: &Value,
) -> Result<Value, String> {
    let mut value =
        serde_json::to_value(settings).map_err(|error| format!("编码设置失败：{error}"))?;
    value["version"] = json!(SCHEMA_VERSION);
    value.as_object_mut().unwrap().remove("launchAtStartup");
    let provider = settings.recognition.provider;
    let inactive = match provider {
        RecognitionProvider::Volcengine => "doubaoIme",
        RecognitionProvider::DoubaoIme => "volcengine",
    };
    if let Some(raw) = previous.pointer(&format!("/recognition/{inactive}")) {
        value["recognition"][inactive] = raw.clone();
    }
    let profile = &mut value["recognition"][provider.profile()];
    if provider == RecognitionProvider::Volcengine {
        profile["hotwordBinding"] = json!(binding);
        profile["hotwordPending"] = json!(settings.recognition.volcengine.hotword_pending);
    }
    strip_document_secrets(&mut value);
    Ok(value)
}

fn read_store(app: &AppHandle) -> Result<Value, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join(STORE_PATH);
    match fs::read(path) {
        Ok(bytes) => {
            let value: Value =
                serde_json::from_slice(&bytes).map_err(|error| format!("读取设置失败：{error}"))?;
            if !value.is_object() {
                return Err("设置存储必须是对象".to_owned());
            }
            Ok(value)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(error) => Err(format!("读取设置失败：{error}")),
    }
}

fn document(store: &Value) -> Result<Value, String> {
    match store.get(STORE_KEY) {
        Some(value) => validate_document(value.clone()),
        None if store.as_object().is_some_and(|object| object.is_empty()) => {
            let mut value =
                serde_json::to_value(AppSettings::default()).map_err(|error| error.to_string())?;
            value["version"] = json!(SCHEMA_VERSION);
            validate_document(value)
        }
        None => Err("设置存储结构不受支持，原文件未修改".to_owned()),
    }
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("设置路径无效")?;
    fs::create_dir_all(parent).map_err(|error| format!("创建设置目录失败：{error}"))?;
    let temporary = path.with_extension("json.pending");
    let result = (|| {
        let mut options = fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        Ok::<_, std::io::Error>(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(|error| format!("保存设置失败，原设置未替换：{error}"))
}

fn persist_document(app: &AppHandle, mut store: Value, value: Value) -> Result<(), String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join(STORE_PATH);
    store[STORE_KEY] = value;
    let bytes =
        serde_json::to_vec_pretty(&store).map_err(|error| format!("编码设置失败：{error}"))?;
    atomic_write(&path, &bytes)
}

fn load_document(value: &Value) -> Result<LoadedSettings, String> {
    let (mut settings, binding) = decode_document(value)?;
    let provider = settings.recognition.provider;
    let mut notices = Vec::new();
    let accounts = std::iter::once(provider.llm_credential())
        .chain((provider == RecognitionProvider::Volcengine).then_some(VOLCENGINE_KEYRING_ACCOUNT));
    for account in accounts {
        match read_secret(account) {
            Ok(key) if account == VOLCENGINE_KEYRING_ACCOUNT => {
                settings.recognition.volcengine.api_key = key.unwrap_or_default();
            }
            Ok(key) => settings.recognition.llm_mut().api_key = key.unwrap_or_default(),
            Err(error) => notices.push(format!("当前渠道凭据暂不可用，已保留原凭据：{error}")),
        }
    }
    Ok(LoadedSettings {
        settings,
        hotword_binding: binding,
        notice: (!notices.is_empty()).then(|| notices.join("；")),
    })
}

fn migrate_legacy_document(value: &Value) -> Result<Option<Value>, String> {
    let Some(object) = value.as_object() else {
        return Ok(None);
    };
    if object.contains_key("version") || object.contains_key("recognition") {
        return Ok(None);
    }
    // Public 1.5.0 persisted these fields without a schema version.
    if !object.contains_key("onboardingCompleted") || !object.contains_key("llm") {
        return Ok(None);
    }
    let mut migrated = value.clone();
    let root = migrated.as_object_mut().unwrap();
    let mut profile = serde_json::Map::new();
    for key in ["hotwords", "hotwordsEnabled", "hotwordBinding", "llm"] {
        if let Some(value) = root.remove(key) {
            profile.insert(key.to_owned(), value);
        }
    }
    root.remove("apiKey");
    root.insert("version".to_owned(), json!(SCHEMA_VERSION));
    root.insert(
        "recognition".to_owned(),
        json!({"provider": "volcengine", "volcengine": profile}),
    );
    let migrated = validate_document(migrated)?;
    decode_document(&migrated)?;
    Ok(Some(migrated))
}

pub fn load(app: &AppHandle) -> Result<LoadedSettings, String> {
    let store = read_store(app)?;
    let value = if let Some(migrated) = store
        .get(STORE_KEY)
        .map(migrate_legacy_document)
        .transpose()?
        .flatten()
    {
        let directory = app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?;
        let original = fs::read(directory.join(STORE_PATH))
            .map_err(|error| format!("备份旧设置失败：{error}"))?;
        let backup = directory.join("settings.pre-v3.json");
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&backup) {
            Ok(mut file) => {
                file.write_all(&original)
                    .and_then(|()| file.sync_all())
                    .map_err(|error| format!("备份旧设置失败：{error}"))?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                if fs::read(&backup).map_err(|error| error.to_string())? != original {
                    return Err("旧设置备份与当前文件不同；未覆盖任何设置".to_owned());
                }
            }
            Err(error) => return Err(format!("备份旧设置失败：{error}")),
        }
        // Copy before committing the document. A failed credential write leaves
        // the old document and credentials intact, so the next launch can retry.
        for (old, new) in [
            ("doubao-api-key", VOLCENGINE_KEYRING_ACCOUNT),
            (
                "llm-api-key",
                RecognitionProvider::Volcengine.llm_credential(),
            ),
        ] {
            if read_secret(new)?.is_none()
                && let Some(secret) = read_secret(old)?
            {
                write_secret(new, Some(&secret))?;
            }
        }
        persist_document(app, store, migrated.clone())?;
        migrated
    } else {
        document(&store)?
    };
    load_document(&value)
}

pub fn select_provider(
    app: &AppHandle,
    provider: RecognitionProvider,
) -> Result<LoadedSettings, String> {
    let store = read_store(app)?;
    let mut value = document(&store)?;
    value["recognition"]["provider"] = json!(provider);
    let loaded = load_document(&value)?;
    persist_document(app, store, value)?;
    Ok(loaded)
}

pub fn save(
    app: &AppHandle,
    settings: &AppSettings,
    previous: &AppSettings,
    hotword_binding: Option<&Binding>,
) -> Result<CredentialStorage, String> {
    if settings.recognition.provider != previous.recognition.provider {
        return Err("请使用切换渠道操作，更改设置不能切换渠道".to_owned());
    }
    let store = read_store(app)?;
    let raw = document(&store)?;
    let (stored, _) = decode_document(&raw)?;
    if stored.recognition.provider != settings.recognition.provider {
        return Err("当前渠道已改变，请重新加载设置".to_owned());
    }
    let provider = settings.recognition.provider;
    let mut changes = vec![(
        provider.llm_credential(),
        settings.recognition.llm().api_key.as_str(),
        previous.recognition.llm().api_key.as_str(),
    )];
    if provider == RecognitionProvider::Volcengine {
        changes.push((
            VOLCENGINE_KEYRING_ACCOUNT,
            settings.recognition.volcengine.api_key.as_str(),
            previous.recognition.volcengine.api_key.as_str(),
        ));
    }
    let updates = credential_updates(changes, read_secret)?;
    for (index, (account, next, _)) in updates.iter().enumerate() {
        if let Err(error) = write_secret(account, (!next.is_empty()).then_some(*next)) {
            return Err(format!("{error}{}", restore_credentials(&updates[..index])));
        }
    }
    let result = encode_document(settings, hotword_binding, &raw)
        .and_then(|value| persist_document(app, store, value));
    if let Err(error) = result {
        return Err(format!("{error}{}", restore_credentials(&updates)));
    }
    let secret = match provider {
        RecognitionProvider::Volcengine => &settings.recognition.volcengine.api_key,
        RecognitionProvider::DoubaoIme => &settings.recognition.llm().api_key,
    };
    Ok(if secret.is_empty() {
        CredentialStorage::Removed
    } else {
        CredentialStorage::Keyring
    })
}

type CredentialUpdate<'a> = (&'a str, &'a str, Option<String>);

fn credential_updates<'a>(
    changes: impl IntoIterator<Item = (&'a str, &'a str, &'a str)>,
    mut read: impl FnMut(&str) -> Result<Option<String>, String>,
) -> Result<Vec<CredentialUpdate<'a>>, String> {
    let mut updates = Vec::new();
    for (account, next, previous) in changes {
        if next != previous {
            // Empty UI placeholders are not removals. Read every changed credential before
            // any write, so an unavailable vault cannot erase the real rollback value.
            updates.push((account, next, read(account)?));
        }
    }
    Ok(updates)
}

fn restore_credentials(changes: &[CredentialUpdate<'_>]) -> &'static str {
    let mut failed = false;
    for (account, _, old) in changes.iter().rev() {
        if write_secret(account, old.as_deref()).is_err() {
            failed = true;
        }
    }
    if failed {
        "；恢复原凭据失败，请重新填写受影响的 API Key"
    } else {
        ""
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_settings_failure_preserves_previous_document() {
        let directory =
            std::env::temp_dir().join(format!("voicepaste-settings-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("settings.json");
        atomic_write(&path, br#"{"old":true}"#).unwrap();
        let temporary = path.with_extension("json.pending");
        fs::create_dir(&temporary).unwrap();
        assert!(atomic_write(&path, br#"{"new":true}"#).is_err());
        assert_eq!(fs::read(&path).unwrap(), br#"{"old":true}"#);
        fs::remove_dir(&temporary).unwrap();
        atomic_write(&path, br#"{"new":true}"#).unwrap();
        assert_eq!(fs::read(&path).unwrap(), br#"{"new":true}"#);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn unreadable_credentials_are_preserved_and_explicit_removal_keeps_real_rollback() {
        let unchanged = credential_updates([("active-key", "", "")], |_| {
            panic!("unchanged empty placeholders must not access or remove a saved secret")
        })
        .unwrap();
        assert!(unchanged.is_empty());
        assert!(
            credential_updates([("active-key", "replacement", "")], |_| {
                Err("vault unavailable".to_owned())
            })
            .is_err()
        );
        let removal = credential_updates([("active-key", "", "visible-secret")], |_| {
            Ok(Some("actual-vault-secret".to_owned()))
        })
        .unwrap();
        assert_eq!(
            removal,
            [("active-key", "", Some("actual-vault-secret".to_owned()))]
        );
    }

    #[test]
    fn inactive_invalid_profile_survives_active_save_without_validation() {
        let raw = validate_document(
            json!({"version": 3, "recognition": {"provider": "doubaoIme",
            "volcengine": {"hotwords": 42, "llm": "future-schema", "hotwordBinding": false}}}),
        )
        .unwrap();
        let (mut settings, binding) = decode_document(&raw).unwrap();
        settings.shortcut = "Alt+Space".to_owned();
        let saved = encode_document(&settings, binding.as_ref(), &raw).unwrap();
        assert_eq!(
            saved["recognition"]["volcengine"],
            raw["recognition"]["volcengine"]
        );
        let mut switched = saved;
        switched["recognition"]["provider"] = json!("volcengine");
        assert!(decode_document(&switched).is_err());
    }

    #[test]
    fn pending_submission_and_newer_draft_are_independently_persisted_without_secrets() {
        let raw =
            validate_document(json!({"version": 3, "recognition": {"provider": "volcengine"}}))
                .unwrap();
        let (mut settings, _) = decode_document(&raw).unwrap();
        settings.recognition.volcengine.api_key = "secret".to_owned();
        settings.recognition.llm_mut().api_key = "llm-secret".to_owned();
        settings.recognition.volcengine.hotword_pending = Some(vec!["submitted".to_owned()]);
        settings.recognition.volcengine.hotword_draft = Some(vec!["newer".to_owned()]);
        let saved = encode_document(&settings, None, &raw).unwrap();
        assert!(saved.pointer("/recognition/volcengine/apiKey").is_none());
        assert!(
            saved
                .pointer("/recognition/volcengine/llm/apiKey")
                .is_none()
        );
        let (restored, _) = decode_document(&saved).unwrap();
        assert_eq!(
            restored.recognition.volcengine.hotword_pending,
            Some(vec!["submitted".to_owned()])
        );
        assert_eq!(
            restored.recognition.volcengine.hotword_draft,
            Some(vec!["newer".to_owned()])
        );
    }

    #[test]
    fn public_settings_migrate_to_volcengine_without_losing_user_data() {
        let legacy = json!({
            "shortcut": "F13", "activationMode": "toggle", "microphoneId": "mic-id",
            "onboardingCompleted": true, "openSettingsOnStartup": false,
            "overlayPosition": "left", "hotwords": ["项目词"], "hotwordsEnabled": true,
            "hotwordBinding": {"tableId": "owned-table", "limit": 5000},
            "llm": {"enabled": true, "baseUrl": "https://example.com/v1",
                "model": "chosen-model", "prompt": "保留术语", "apiKey": "discard-plaintext"}
        });
        let migrated = migrate_legacy_document(&legacy).unwrap().unwrap();
        let (settings, binding) = decode_document(&migrated).unwrap();
        assert_eq!(
            settings.recognition.provider,
            RecognitionProvider::Volcengine
        );
        assert_eq!(settings.shortcut, "F13");
        assert_eq!(settings.activation_mode, ActivationMode::Toggle);
        assert_eq!(settings.microphone_id, "mic-id");
        assert!(settings.onboarding_completed);
        assert!(!settings.open_settings_on_startup);
        assert_eq!(settings.overlay_position, OverlayPosition::Left);
        assert_eq!(settings.recognition.volcengine.hotwords, ["项目词"]);
        assert!(settings.recognition.volcengine.hotwords_enabled);
        assert_eq!(binding.unwrap().table_id, "owned-table");
        assert_eq!(settings.recognition.llm().model, "chosen-model");
        assert_eq!(settings.recognition.llm().prompt, "保留术语");
        assert!(settings.recognition.llm().api_key.is_empty());
        assert!(migrate_legacy_document(&migrated).unwrap().is_none());
        assert!(migrate_legacy_document(&json!({})).unwrap().is_none());
    }

    #[test]
    fn unsupported_schema_is_rejected_without_resetting_data() {
        for value in [
            json!({}),
            json!({"version": 1}),
            json!({"version": 2}),
            json!({"version": 99}),
            json!({"version": "3"}),
            json!([]),
        ] {
            assert!(validate_document(value).is_err());
        }
    }
}
