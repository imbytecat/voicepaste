mod asr;
mod audio;
mod doubao_account;
mod doubao_ime_transport;
mod hotwords;
mod llm;
mod paste;
mod settings;
mod shortcut;

use std::{
    fs,
    sync::{
        Arc, Mutex, RwLock,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
};

use asr::{AsrOutcome, AudioCommand, ServiceIssue};
use hotwords::{Binding as HotwordBinding, SyncOutcome};
use paste::{InputStatus, PasteOutcome};
use serde::Serialize;
use serde_json::json;
use settings::{
    ActivationMode, AppSettings, CredentialStorage, OverlayPosition, RecognitionProvider,
    RecognitionSettings, VolcengineSettings,
};
use shortcut::ShortcutManager;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewWindow, WindowEvent,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_clipboard_manager::ClipboardExt as _;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_global_shortcut::ShortcutState;
use tauri_plugin_updater::UpdaterExt as _;
use tokio::sync::{mpsc, watch};

const API_KEY_CONSOLE_URL: &str = "https://console.volcengine.com/speech/new/setting/apikeys";
const HOMEPAGE_URL: &str = "https://github.com/imbytecat/voicepaste";
const HELP_URL: &str = "https://github.com/imbytecat/voicepaste/issues";
const PRIVACY_URL: &str = "https://github.com/imbytecat/voicepaste/blob/main/PRIVACY.md";
const SPEECH_CONSOLE_URL: &str = "https://console.volcengine.com/speech/";
const SERVICE_DOCS_URL: &str = "https://www.volcengine.com/docs/6561/1354869";
const TRAY_STATUS_ID: &str = "status";
const TRAY_OPEN_ID: &str = "settings";
const TRAY_UPDATE_ID: &str = "update";
const TRAY_QUIT_ID: &str = "quit";
#[cfg(target_os = "linux")]
fn constrain_linux_overlay(window: &WebviewWindow) -> Result<(), String> {
    use gtk::prelude::WidgetExt;

    window
        .with_webview(|webview| webview.inner().set_size_request(420, 64))
        .map_err(|error| format!("设置 Linux 悬浮窗 WebView 尺寸失败：{error}"))?;
    window
        .set_size(tauri::LogicalSize::new(420.0, 64.0))
        .map_err(|error| format!("设置 Linux 悬浮窗尺寸失败：{error}"))
}

struct RecognitionSession {
    id: String,
    window_label: &'static str,
    audio: mpsc::Sender<AudioCommand>,
    cancel: watch::Sender<bool>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum AudioCaptureKind {
    Test,
    Recognition,
}

fn can_replace_audio_capture(active: AudioCaptureKind, requested: AudioCaptureKind) -> bool {
    !(active == AudioCaptureKind::Recognition && requested == AudioCaptureKind::Test)
}

struct ActiveAudioCapture {
    id: String,
    kind: AudioCaptureKind,
    window_label: String,
    _capture: audio::AudioCapture,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShortcutEventPayload {
    state: &'static str,
    activation_mode: ActivationMode,
    microphone_id: String,
}

struct AppState {
    provider_revision: AtomicU64,
    hotword_review: Mutex<Option<HotwordReview>>,
    settings: RwLock<AppSettings>,
    account: Arc<doubao_account::AccountManager>,
    recognition_gate: tokio::sync::Mutex<()>,
    hotword_binding: RwLock<Option<HotwordBinding>>,
    session: Arc<Mutex<Option<RecognitionSession>>>,
    shortcut_manager: Arc<ShortcutManager>,
    shortcut_status: RwLock<String>,
    startup_notice: Mutex<Option<String>>,
    overlay_ready: AtomicBool,
    pending_shortcut: Mutex<Option<ShortcutEventPayload>>,
    shortcut_down: AtomicBool,
    audio_capture: Mutex<Option<ActiveAudioCapture>>,
    input_session: Arc<paste::InputSession>,
    settings_dirty: AtomicBool,
    tray_status: Mutex<Option<MenuItem<tauri::Wry>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            provider_revision: AtomicU64::new(1),
            hotword_review: Mutex::new(None),
            settings: RwLock::new(AppSettings::default()),
            account: Arc::new(doubao_account::AccountManager::new()),
            recognition_gate: tokio::sync::Mutex::new(()),
            hotword_binding: RwLock::new(None),
            session: Arc::new(Mutex::new(None)),
            shortcut_manager: Arc::new(ShortcutManager::default()),
            shortcut_status: RwLock::new("正在注册快捷键…".to_owned()),
            startup_notice: Mutex::new(None),
            overlay_ready: AtomicBool::new(false),
            pending_shortcut: Mutex::new(None),
            shortcut_down: AtomicBool::new(false),
            audio_capture: Mutex::new(None),
            input_session: Arc::new(paste::InputSession::default()),
            settings_dirty: AtomicBool::new(false),
            tray_status: Mutex::new(None),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadSettingsResult {
    settings: AppSettings,
    notice: Option<String>,
    hotword_status: Option<HotwordSyncStatus>,
    account: Option<doubao_account::AccountStatus>,
    provider_revision: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HotwordSyncStatus {
    state: &'static str,
    count: usize,
    cloud_count: usize,
    limit: usize,
    table_id: Option<String>,
    foreign_tables: Vec<hotwords::ForeignTable>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HotwordSnapshotResult {
    hotword_status: HotwordSyncStatus,
    cloud_hotwords: Vec<String>,
    confirmed_hotwords: Vec<String>,
    hotword_draft: Option<Vec<String>>,
    review_token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveSettingsResult {
    kind: &'static str,
    credential_storage: Option<CredentialStorage>,
    hotword_status: Option<HotwordSyncStatus>,
    hotword_action: Option<&'static str>,
    cloud_hotwords: Vec<String>,
    hotword_limit: usize,
    review_token: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TestRecognitionResult {
    provider: RecognitionProvider,
    provider_revision: u64,
    account_revision: u64,
    hotword_status: Option<HotwordSyncStatus>,
    warning: Option<String>,
}

/// Status backed by a fresh cloud snapshot: the cloud is the truth.
fn hotword_status(
    settings: &VolcengineSettings,
    snapshot: &hotwords::Snapshot,
) -> HotwordSyncStatus {
    HotwordSyncStatus {
        state: if settings.hotword_pending.is_some() {
            "confirming"
        } else if snapshot.words != settings.hotwords {
            "pending"
        } else if !settings.hotwords_enabled {
            "disabled"
        } else if settings.hotwords.is_empty() {
            "empty"
        } else {
            "synced"
        },
        count: settings.hotwords.len(),
        cloud_count: snapshot.words.len(),
        limit: snapshot.limit,
        table_id: snapshot
            .binding
            .as_ref()
            .map(|binding| binding.table_id.clone()),
        foreign_tables: snapshot.foreign_tables.clone(),
    }
}

/// Status from the local store alone; the cloud has not been contacted yet.
fn unverified_hotword_status(
    settings: &VolcengineSettings,
    binding: Option<&HotwordBinding>,
) -> HotwordSyncStatus {
    HotwordSyncStatus {
        state: if settings.hotword_pending.is_some() {
            "confirming"
        } else if !settings.hotwords_enabled {
            "disabled"
        } else if settings.hotwords.is_empty() && binding.is_none() {
            "empty"
        } else if binding.is_some() {
            "unknown"
        } else {
            "pending"
        },
        count: settings.hotwords.len(),
        cloud_count: 0,
        limit: binding.map_or(hotwords::DEFAULT_TABLE_LIMIT, |binding| binding.limit),
        table_id: binding.map(|binding| binding.table_id.clone()),
        foreign_tables: Vec::new(),
    }
}

impl SaveSettingsResult {
    fn saved(
        credential_storage: CredentialStorage,
        settings: &VolcengineSettings,
        snapshot: hotwords::Snapshot,
        action: &'static str,
    ) -> Self {
        Self {
            kind: "saved",
            credential_storage: Some(credential_storage),
            hotword_status: Some(hotword_status(settings, &snapshot)),
            hotword_action: Some(action),
            hotword_limit: snapshot.limit,
            cloud_hotwords: snapshot.words,
            review_token: None,
        }
    }

    fn conflict(snapshot: hotwords::Snapshot, review_token: String) -> Self {
        Self {
            kind: "conflict",
            credential_storage: None,
            hotword_status: None,
            hotword_action: None,
            hotword_limit: snapshot.limit,
            cloud_hotwords: snapshot.words,
            review_token: Some(review_token),
        }
    }
}

struct HotwordReview {
    token: String,
    provider_revision: u64,
    api_key: String,
    snapshot: hotwords::Snapshot,
}

fn require_provider(
    state: &AppState,
    provider: RecognitionProvider,
    revision: u64,
) -> Result<(), String> {
    let active = state
        .settings
        .read()
        .map_err(|_| "设置状态已损坏，请重启应用")?
        .recognition
        .provider;
    if active != provider || state.provider_revision.load(Ordering::Acquire) != revision {
        return Err("当前渠道或配置已改变，请重新加载后再试".to_owned());
    }
    Ok(())
}

fn remember_hotword_review(
    state: &AppState,
    api_key: &str,
    snapshot: &hotwords::Snapshot,
) -> Result<String, String> {
    let token = uuid::Uuid::new_v4().to_string();
    *state
        .hotword_review
        .lock()
        .map_err(|_| "常用词审阅状态已损坏")? = Some(HotwordReview {
        token: token.clone(),
        provider_revision: state.provider_revision.load(Ordering::Acquire),
        api_key: api_key.to_owned(),
        snapshot: snapshot.clone(),
    });
    Ok(token)
}

fn prepare_ordinary_save(next: &mut AppSettings, previous: &AppSettings) -> Result<(), String> {
    if next.recognition.provider != previous.recognition.provider {
        return Err("请使用切换渠道操作，更改设置不能切换渠道".to_owned());
    }
    match next.recognition.provider {
        RecognitionProvider::Volcengine => {
            next.recognition.doubao_ime = previous.recognition.doubao_ime.clone();
            let profile = &mut next.recognition.volcengine;
            let old = &previous.recognition.volcengine;
            profile.api_key = profile.api_key.trim().to_owned();
            if profile.api_key != old.api_key && old.hotword_pending.is_some() {
                return Err("常用词提交结果待确认，请先检查云端，再更换 API Key".to_owned());
            }
            // Confirmed words, drafts and recovery records have dedicated commands.
            profile.hotwords = old.hotwords.clone();
            profile.hotword_draft = old.hotword_draft.clone();
            profile.hotword_pending = old.hotword_pending.clone();
        }
        RecognitionProvider::DoubaoIme => {
            next.recognition.volcengine = previous.recognition.volcengine.clone();
            if next.recognition.doubao_ime.smart_organize && next.recognition.doubao_ime.llm.enabled
            {
                return Err("豆包智能整理与自定义 LLM 后处理只能启用一个".to_owned());
            }
        }
    }
    next.shortcut = next.shortcut.trim().to_owned();
    next.microphone_id = next.microphone_id.trim().to_owned();
    let llm = next.recognition.llm_mut();
    llm.base_url = llm.base_url.trim().to_owned();
    llm.api_key = llm.api_key.trim().to_owned();
    llm.model = llm.model.trim().to_owned();
    llm.prompt = llm.prompt.trim().to_owned();
    llm.extra_parameters = llm.extra_parameters.trim().to_owned();
    llm::validate(llm)?;
    if next.shortcut.is_empty() {
        return Err("全局快捷键不能为空".to_owned());
    }
    Ok(())
}

async fn persist_active_settings(
    app: &AppHandle,
    state: &AppState,
    settings: AppSettings,
    binding: Option<HotwordBinding>,
) -> Result<CredentialStorage, String> {
    let previous = state.settings.read().map_err(|_| "设置状态已损坏")?.clone();
    let save_app = app.clone();
    let to_save = settings.clone();
    let binding_to_save = binding.clone();
    let storage = offload_blocking_result(move || {
        settings::save(&save_app, &to_save, &previous, binding_to_save.as_ref())
    })
    .await?;
    *state.settings.write().map_err(|_| "设置状态已损坏")? = settings;
    *state
        .hotword_binding
        .write()
        .map_err(|_| "常用词状态已损坏")? = binding;
    Ok(storage)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemDiagnostics {
    shortcut_status: String,
    input_ready: bool,
    input_status: String,
    app_version: String,
    log_dir: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInfo {
    version: String,
}

fn require_window(window: &WebviewWindow, expected: &str) -> Result<(), String> {
    if window.label() == expected {
        Ok(())
    } else {
        Err("当前窗口无权执行此操作".to_owned())
    }
}

fn require_recognition_idle(state: &AppState) -> Result<(), String> {
    if state
        .session
        .lock()
        .map_err(|_| "听写状态已损坏，请重启应用".to_owned())?
        .is_some()
    {
        return Err("请先完成或取消当前听写，再更改识别设置或账号".to_owned());
    }
    Ok(())
}

fn applied_hotword_table(
    recognition: &RecognitionSettings,
    binding: Option<&HotwordBinding>,
) -> Result<Option<String>, String> {
    let profile = &recognition.volcengine;
    if recognition.provider != RecognitionProvider::Volcengine || !profile.hotwords_enabled {
        return Ok(None);
    }
    if profile.hotword_pending.is_some() {
        return Err("常用词提交结果待确认，请先检查云端，或明确关闭听写时使用常用词".to_owned());
    }
    if profile.hotwords.is_empty() {
        return Ok(None);
    }
    binding
        .map(|binding| Some(binding.table_id.clone()))
        .ok_or_else(|| "常用词尚未确认，请先进入词库检查并应用".to_owned())
}

async fn recognition_config(
    app: &AppHandle,
    state: &AppState,
    recognition: &RecognitionSettings,
    hotword_table_id: Option<String>,
) -> Result<asr::SessionConfig, ServiceIssue> {
    match recognition.provider {
        RecognitionProvider::Volcengine => {
            if recognition.volcengine.api_key.trim().is_empty() {
                return Err(ServiceIssue::new(
                    "unauthorized",
                    "请在设置中填写火山引擎 API Key",
                    "当前选择了火山引擎，但尚未配置该服务的凭据",
                ));
            }
            Ok(asr::SessionConfig::Volcengine {
                api_key: recognition.volcengine.api_key.trim().to_owned(),
                hotword_table_id,
            })
        }
        RecognitionProvider::DoubaoIme => Ok(asr::SessionConfig::DoubaoIme {
            account_token: state.account.resolve_token(app).await?,
        }),
    }
}

fn require_saved_settings(settings_dirty: bool) -> Result<(), String> {
    if settings_dirty {
        Err("请先保存当前设置，再安装更新".to_owned())
    } else {
        Ok(())
    }
}

async fn offload_blocking_result<T, F>(task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("后台任务失败：{error}"))?
}

fn initialize_input_session(input_session: Arc<paste::InputSession>) {
    tauri::async_runtime::spawn_blocking(move || {
        let _ = input_session.initialize();
    });
}

fn tray_ready_text(settings: &AppSettings) -> String {
    format!("就绪 · {}", settings.shortcut)
}

fn set_tray_status(state: &AppState, text: impl AsRef<str>) {
    if let Ok(item) = state.tray_status.lock()
        && let Some(item) = item.as_ref()
    {
        let _ = item.set_text(text);
    }
}

fn apply_autostart(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    let current = manager
        .is_enabled()
        .map_err(|error| format!("读取开机启动状态失败：{error}"))?;
    if current == enabled {
        return Ok(());
    }
    if enabled {
        manager
            .enable()
            .map_err(|error| format!("开启开机启动失败：{error}"))
    } else {
        manager
            .disable()
            .map_err(|error| format!("关闭开机启动失败：{error}"))
    }
}

#[tauri::command]
async fn close_settings(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    require_window(&window, "settings")?;
    let _gate = state
        .recognition_gate
        .try_lock()
        .map_err(|_| "正在处理设置或词库，请稍后再关闭")?;
    if state.settings_dirty.load(Ordering::Acquire) {
        return Err("请先保存或放弃未保存的更改".to_owned());
    }
    if let Some(session) = state
        .session
        .lock()
        .map_err(|_| "听写状态已损坏")?
        .as_ref()
        .filter(|session| session.window_label == "settings")
    {
        let _ = session.cancel.send(true);
    }
    drop(take_window_capture(&state, "settings"));
    let _ = app.emit_to(
        "settings",
        "microphone-interrupted",
        "设置窗口已关闭，试说和麦克风测试已停止",
    );
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
fn set_settings_dirty(
    window: WebviewWindow,
    state: State<'_, AppState>,
    dirty: bool,
) -> Result<(), String> {
    require_window(&window, "settings")?;
    state.settings_dirty.store(dirty, Ordering::Release);
    Ok(())
}

async fn settings_result(app: &AppHandle, state: &AppState) -> Result<LoadSettingsResult, String> {
    let settings = state.settings.read().map_err(|_| "设置状态已损坏")?.clone();
    let binding = state
        .hotword_binding
        .read()
        .map_err(|_| "常用词状态已损坏")?
        .clone();
    let notice = state
        .startup_notice
        .lock()
        .map_err(|_| "设置提示状态已损坏")?
        .take();
    let (hotword_status, account) = match settings.recognition.provider {
        RecognitionProvider::Volcengine => (
            Some(unverified_hotword_status(
                &settings.recognition.volcengine,
                binding.as_ref(),
            )),
            None,
        ),
        RecognitionProvider::DoubaoIme => (None, Some(state.account.status(app).await)),
    };
    Ok(LoadSettingsResult {
        settings,
        notice,
        hotword_status,
        account,
        provider_revision: state.provider_revision.load(Ordering::Acquire),
    })
}

#[tauri::command]
async fn load_settings(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<LoadSettingsResult, String> {
    require_window(&window, "settings")?;
    let _gate = state.recognition_gate.lock().await;
    settings_result(&app, &state).await
}

#[tauri::command]
async fn select_recognition_provider(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    provider: RecognitionProvider,
) -> Result<LoadSettingsResult, String> {
    require_window(&window, "settings")?;
    let _gate = state
        .recognition_gate
        .try_lock()
        .map_err(|_| "当前渠道操作进行中，请完成后再切换")?;
    require_recognition_idle(&state)?;
    if state.settings_dirty.load(Ordering::Acquire) {
        return Err("请先保存或放弃未保存的设置和词库草稿，再切换渠道".to_owned());
    }
    let old = state.settings.read().map_err(|_| "设置状态已损坏")?.clone();
    if old.recognition.provider == provider {
        return settings_result(&app, &state).await;
    }
    if old.recognition.provider == RecognitionProvider::DoubaoIme {
        state.account.deactivate(&app).await?;
    }
    let save_app = app.clone();
    let mut loaded =
        offload_blocking_result(move || settings::select_provider(&save_app, provider)).await?;
    loaded.settings.launch_at_startup = old.launch_at_startup;
    *state.settings.write().map_err(|_| "设置状态已损坏")? = loaded.settings;
    *state
        .hotword_binding
        .write()
        .map_err(|_| "常用词状态已损坏")? = loaded.hotword_binding;
    *state
        .startup_notice
        .lock()
        .map_err(|_| "设置提示状态已损坏")? = loaded.notice;
    *state
        .hotword_review
        .lock()
        .map_err(|_| "常用词审阅状态已损坏")? = None;
    state.provider_revision.fetch_add(1, Ordering::AcqRel);
    settings_result(&app, &state).await
}

#[tauri::command]
async fn save_settings(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    mut settings: AppSettings,
    provider_revision: u64,
) -> Result<SaveSettingsResult, String> {
    require_window(&window, "settings")?;
    let _gate = state.recognition_gate.lock().await;
    require_provider(&state, settings.recognition.provider, provider_revision)?;
    require_recognition_idle(&state)?;
    let old = state.settings.read().map_err(|_| "设置状态已损坏")?.clone();
    prepare_ordinary_save(&mut settings, &old)?;
    let key_changed = settings.recognition.provider == RecognitionProvider::Volcengine
        && settings.recognition.volcengine.api_key != old.recognition.volcengine.api_key;
    let binding = if key_changed {
        // A new key is a new target. Keep old words only as a local draft, never as its confirmed data.
        let profile = &mut settings.recognition.volcengine;
        if profile.hotword_draft.is_none() && !profile.hotwords.is_empty() {
            profile.hotword_draft = Some(profile.hotwords.clone());
        }
        profile.hotwords.clear();
        None
    } else {
        state
            .hotword_binding
            .read()
            .map_err(|_| "常用词状态已损坏")?
            .clone()
    };
    state
        .shortcut_manager
        .replace(&app, &settings.shortcut, Some(&old.shortcut))
        .await?;
    if let Err(error) = apply_autostart(&app, settings.launch_at_startup) {
        let _ = state
            .shortcut_manager
            .replace(&app, &old.shortcut, Some(&settings.shortcut))
            .await;
        return Err(error);
    }
    let credential_storage =
        match persist_active_settings(&app, &state, settings.clone(), binding.clone()).await {
            Ok(storage) => storage,
            Err(error) => {
                let _ = state
                    .shortcut_manager
                    .replace(&app, &old.shortcut, Some(&settings.shortcut))
                    .await;
                let _ = apply_autostart(&app, old.launch_at_startup);
                return Err(error);
            }
        };
    if key_changed {
        *state
            .hotword_review
            .lock()
            .map_err(|_| "常用词审阅状态已损坏")? = None;
        // Key changes invalidate queued requests even though the provider name did not change.
        state.provider_revision.fetch_add(1, Ordering::AcqRel);
    }
    state.settings_dirty.store(false, Ordering::Release);
    if settings.onboarding_completed {
        initialize_input_session(Arc::clone(&state.input_session));
    }
    set_shortcut_status(&app, "全局快捷键已启用");
    set_tray_status(&state, tray_ready_text(&settings));
    Ok(SaveSettingsResult {
        kind: "saved",
        credential_storage: Some(credential_storage),
        hotword_status: (settings.recognition.provider == RecognitionProvider::Volcengine)
            .then(|| unverified_hotword_status(&settings.recognition.volcengine, binding.as_ref())),
        hotword_action: Some("none"),
        cloud_hotwords: Vec::new(),
        hotword_limit: binding
            .as_ref()
            .map_or(hotwords::DEFAULT_TABLE_LIMIT, |binding| binding.limit),
        review_token: None,
    })
}

#[tauri::command]
async fn export_volcengine_hotwords(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    words: Vec<String>,
    provider_revision: u64,
) -> Result<bool, String> {
    require_window(&window, "settings")?;
    {
        let _gate = state.recognition_gate.lock().await;
        require_provider(&state, RecognitionProvider::Volcengine, provider_revision)?;
    }
    let words = hotwords::normalize(words)?;
    let dialog = app
        .dialog()
        .file()
        .add_filter("UTF-8 文本", &["txt"])
        .set_file_name("voicepaste-volcengine-hotwords.txt");
    let selected = offload_blocking_result(move || Ok(dialog.blocking_save_file())).await?;
    let Some(selected) = selected else {
        return Ok(false);
    };
    let _gate = state.recognition_gate.lock().await;
    require_provider(&state, RecognitionProvider::Volcengine, provider_revision)?;
    let path = selected
        .into_path()
        .map_err(|error| format!("无法写入所选文件：{error}"))?;
    offload_blocking_result(move || {
        fs::write(path, words.join("\n")).map_err(|error| format!("导出常用词失败：{error}"))
    })
    .await?;
    Ok(true)
}

#[tauri::command]
async fn save_volcengine_hotword_draft(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    words: Vec<String>,
    provider_revision: u64,
) -> Result<(), String> {
    require_window(&window, "settings")?;
    let _gate = state.recognition_gate.lock().await;
    require_provider(&state, RecognitionProvider::Volcengine, provider_revision)?;
    let mut settings = state.settings.read().map_err(|_| "设置状态已损坏")?.clone();
    settings.recognition.volcengine.hotword_draft = Some(hotwords::normalize(words)?);
    let binding = state
        .hotword_binding
        .read()
        .map_err(|_| "常用词状态已损坏")?
        .clone();
    persist_active_settings(&app, &state, settings, binding).await?;
    Ok(())
}

fn confirm_hotword_snapshot(
    profile: &mut VolcengineSettings,
    snapshot: &hotwords::Snapshot,
) -> bool {
    let Some(pending) = profile.hotword_pending.as_ref() else {
        return false;
    };
    if pending != &snapshot.words {
        return false;
    }
    if profile.hotword_draft.as_ref() == Some(pending) {
        profile.hotword_draft = None;
    }
    profile.hotwords = snapshot.words.clone();
    profile.hotword_pending = None;
    true
}

#[tauri::command]
async fn apply_volcengine_hotwords(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    words: Vec<String>,
    force_overwrite: bool,
    review_token: Option<String>,
    provider_revision: u64,
) -> Result<SaveSettingsResult, String> {
    require_window(&window, "settings")?;
    let _gate = state.recognition_gate.lock().await;
    require_provider(&state, RecognitionProvider::Volcengine, provider_revision)?;
    require_recognition_idle(&state)?;
    let words = hotwords::normalize(words)?;
    let mut settings = state.settings.read().map_err(|_| "设置状态已损坏")?.clone();
    let binding = state
        .hotword_binding
        .read()
        .map_err(|_| "常用词状态已损坏")?
        .clone();
    let profile = &settings.recognition.volcengine;
    if profile.api_key.is_empty() {
        return Err("请先保存当前火山引擎 API Key".to_owned());
    }
    let reviewed = if force_overwrite {
        let review = state
            .hotword_review
            .lock()
            .map_err(|_| "常用词审阅状态已损坏")?;
        let review = review
            .as_ref()
            .filter(|review| {
                review_token.as_deref() == Some(review.token.as_str())
                    && review.provider_revision == provider_revision
                    && review.api_key == profile.api_key
            })
            .ok_or("请先重新检查并审阅当前云端词表，再确认覆盖")?;
        Some(review.snapshot.clone())
    } else {
        None
    };
    if profile.hotword_pending.is_some() && reviewed.is_none() {
        return Err("上次提交结果待确认，请先检查云端；不要重复提交".to_owned());
    }
    let previous_pending = profile.hotword_pending.clone();
    // Persist both the draft and write-ahead record before even inspecting the remote.
    settings.recognition.volcengine.hotword_draft = Some(words.clone());
    settings.recognition.volcengine.hotword_pending = Some(words.clone());
    persist_active_settings(&app, &state, settings.clone(), binding.clone()).await?;
    *state
        .hotword_review
        .lock()
        .map_err(|_| "常用词审阅状态已损坏")? = None;
    let profile = &settings.recognition.volcengine;
    let outcome = hotwords::sync(
        &profile.api_key,
        &profile.hotwords,
        &words,
        binding.as_ref(),
        reviewed.as_ref(),
    )
    .await
    .map_err(|error| format!("常用词提交结果待确认，草稿已保留。请检查云端后再操作：{error}"))?;
    require_provider(&state, RecognitionProvider::Volcengine, provider_revision)?;
    match outcome {
        SyncOutcome::Rejected(error) => {
            settings.recognition.volcengine.hotword_pending = previous_pending;
            persist_active_settings(&app, &state, settings, binding).await?;
            Err(format!("常用词未提交，草稿已保留：{error}"))
        }
        SyncOutcome::Conflict(snapshot) => {
            settings.recognition.volcengine.hotword_pending = previous_pending;
            persist_active_settings(&app, &state, settings.clone(), binding).await?;
            let token = remember_hotword_review(
                &state,
                &settings.recognition.volcengine.api_key,
                &snapshot,
            )?;
            Ok(SaveSettingsResult::conflict(snapshot, token))
        }
        SyncOutcome::Saved { snapshot, action } => {
            confirm_hotword_snapshot(&mut settings.recognition.volcengine, &snapshot);
            let storage =
                persist_active_settings(&app, &state, settings.clone(), snapshot.binding.clone())
                    .await
                    .map_err(|error| {
                        format!(
                            "云端已确认，但本机确认信息保存失败；请检查云端，勿重复创建：{error}"
                        )
                    })?;
            *state
                .hotword_review
                .lock()
                .map_err(|_| "常用词审阅状态已损坏")? = None;
            Ok(SaveSettingsResult::saved(
                storage,
                &settings.recognition.volcengine,
                snapshot,
                action.label(),
            ))
        }
    }
}

#[tauri::command]
async fn refresh_hotwords(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    provider_revision: u64,
) -> Result<HotwordSnapshotResult, String> {
    require_window(&window, "settings")?;
    let _gate = state.recognition_gate.lock().await;
    require_provider(&state, RecognitionProvider::Volcengine, provider_revision)?;
    require_recognition_idle(&state)?;
    let mut settings = state.settings.read().map_err(|_| "设置状态已损坏")?.clone();
    if settings.recognition.volcengine.api_key.is_empty() {
        return Err("请先保存当前火山引擎 API Key".to_owned());
    }
    let snapshot = hotwords::inspect(&settings.recognition.volcengine.api_key).await?;
    require_provider(&state, RecognitionProvider::Volcengine, provider_revision)?;
    let confirmed_pending =
        confirm_hotword_snapshot(&mut settings.recognition.volcengine, &snapshot);
    // A read may recover a write, but never turn unrelated cloud words into applied local words.
    if confirmed_pending
        || (settings.recognition.volcengine.hotword_pending.is_none()
            && settings.recognition.volcengine.hotwords == snapshot.words)
    {
        persist_active_settings(&app, &state, settings.clone(), snapshot.binding.clone()).await?;
    }
    let review_token =
        remember_hotword_review(&state, &settings.recognition.volcengine.api_key, &snapshot)?;
    Ok(HotwordSnapshotResult {
        hotword_status: hotword_status(&settings.recognition.volcengine, &snapshot),
        cloud_hotwords: snapshot.words,
        confirmed_hotwords: settings.recognition.volcengine.hotwords,
        hotword_draft: settings.recognition.volcengine.hotword_draft,
        review_token,
    })
}

#[tauri::command]
async fn start_recognition(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    require_window(&window, "overlay")?;
    start_recognition_session(app, &state, session_id, None).await
}

#[tauri::command]
async fn start_recognition_preview(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    recognition: RecognitionSettings,
    provider_revision: u64,
) -> Result<(), String> {
    require_window(&window, "settings")?;
    start_recognition_session(
        app,
        &state,
        session_id,
        Some((recognition, provider_revision)),
    )
    .await
}

async fn start_recognition_session(
    app: AppHandle,
    state: &AppState,
    session_id: String,
    preview: Option<(RecognitionSettings, u64)>,
) -> Result<(), String> {
    let _gate = state.recognition_gate.lock().await;
    require_recognition_idle(state)?;
    if session_id.is_empty() || session_id.len() > 64 {
        return Err("听写会话标识无效".to_owned());
    }
    let settings = state
        .settings
        .read()
        .map_err(|_| "设置状态已损坏，请重启应用".to_owned())?
        .clone();
    let is_preview = preview.is_some();
    let window_label = if is_preview { "settings" } else { "overlay" };
    if let Some((recognition, revision)) = preview {
        require_provider(state, recognition.provider, revision)?;
        if recognition.provider == RecognitionProvider::Volcengine
            && recognition.volcengine.api_key.trim() != settings.recognition.volcengine.api_key
        {
            return Err(
                "试说使用已保存的渠道和词库，请先保存 API Key；未保存的 Key 可使用测试连接"
                    .to_owned(),
            );
        }
    }
    let provider_revision = state.provider_revision.load(Ordering::Acquire);
    let provider = settings.recognition.provider;
    let hotword_table_id = applied_hotword_table(
        &settings.recognition,
        state
            .hotword_binding
            .read()
            .map_err(|_| "常用词状态已损坏")?
            .as_ref(),
    )?;
    let api_config = match settings.recognition.provider {
        RecognitionProvider::Volcengine => Some(
            recognition_config(&app, state, &settings.recognition, hotword_table_id)
                .await
                .map_err(|issue| issue.message())?,
        ),
        RecognitionProvider::DoubaoIme => {
            let status = state.account.status(&app).await;
            if !matches!(
                status.state,
                doubao_account::AccountState::Guest | doubao_account::AccountState::SignedIn
            ) {
                return Err(status
                    .message
                    .unwrap_or_else(|| "请先完成账号登录或重新校验账号状态".to_owned()));
            }
            None
        }
    };
    let account = Arc::clone(&state.account);
    let (audio, receiver) = mpsc::channel(32);
    let (cancel, cancelled) = watch::channel(false);
    *state
        .session
        .lock()
        .map_err(|_| "听写状态已损坏，请重启应用".to_owned())? = Some(RecognitionSession {
        id: session_id.clone(),
        window_label,
        audio,
        cancel,
    });
    set_tray_status(
        state,
        if is_preview {
            "正在试说"
        } else {
            "正在听写"
        },
    );
    let session_slot = Arc::clone(&state.session);
    let input_session = Arc::clone(&state.input_session);
    let llm_settings = settings.recognition.llm().clone();
    let smart_organize = provider == RecognitionProvider::DoubaoIme
        && settings.recognition.doubao_ime.smart_organize;
    let mut processing_cancelled = cancelled.clone();
    tauri::async_runtime::spawn(async move {
        let active =
            || require_provider(&app.state::<AppState>(), provider, provider_revision).is_ok();
        if !active() {
            clear_current_session(&session_slot, &session_id);
            return;
        }
        let emit = |payload| emit_asr_event(&app, window_label, &session_id, payload);
        // Capture can buffer speech while the selected account is validated.
        // Authentication must succeed before any buffered audio is uploaded.
        let config = match api_config {
            Some(config) => Ok(config),
            None => account
                .resolve_token(&app)
                .await
                .map(|account_token| asr::SessionConfig::DoubaoIme { account_token }),
        };
        if !active() {
            clear_current_session(&session_slot, &session_id);
            return;
        }
        let using_account = matches!(
            &config,
            Ok(asr::SessionConfig::DoubaoIme {
                account_token: Some(_)
            })
        );
        let organize_token = if smart_organize {
            match &config {
                Ok(asr::SessionConfig::DoubaoIme { account_token }) => account_token.clone(),
                _ => None,
            }
        } else {
            None
        };
        let result = match config {
            Ok(config) => {
                asr::run(config, receiver, cancelled, |text| {
                    emit(json!({ "kind": "partial", "text": text }));
                })
                .await
            }
            Err(issue) => Err(issue),
        };
        if let Some(capture) = take_window_capture(&app.state::<AppState>(), window_label) {
            let _ = tauri::async_runtime::spawn_blocking(move || drop(capture)).await;
        }
        if !is_current_session(&session_slot, &session_id) || !active() {
            return;
        }
        match result {
            Ok(AsrOutcome::Cancelled) => {}
            Ok(AsrOutcome::Text(text)) if text.trim().is_empty() => {
                emit(json!({ "kind": "empty", "message": "没有听到可输入的内容" }));
            }
            Ok(AsrOutcome::Text(text)) if is_preview => {
                emit(json!({ "kind": "final", "text": &text }));
                emit(
                    json!({ "kind": "completed", "text": text, "message": "试说完成，未粘贴到其他应用" }),
                );
            }
            Ok(AsrOutcome::Text(text)) => {
                emit(json!({ "kind": "final", "text": &text }));
                let (text, completed_message) = if smart_organize {
                    emit(json!({ "kind": "processing", "message": "正在使用豆包输入法智能整理…" }));
                    let result = if let Some(token) = organize_token.as_deref() {
                        tokio::select! {
                            biased;
                            _ = processing_cancelled.changed() => {
                                clear_current_session(&session_slot, &session_id);
                                return;
                            }
                            result = asr::organize_doubao(token, &text) => result,
                        }
                    } else {
                        Err("智能整理需要已登录的豆包账号".to_owned())
                    };
                    match result {
                        Ok(processed) => (processed, "豆包智能整理完成，已输入"),
                        Err(_) => (text, "豆包智能整理失败，已输入原始识别结果"),
                    }
                } else if llm_settings.enabled {
                    emit(
                        json!({ "kind": "processing", "message": "正在处理识别文本，输入会比平时稍慢…" }),
                    );
                    match llm::postprocess(&llm_settings, &text, |processed| {
                        emit(json!({ "kind": "processing", "text": processed }));
                    })
                    .await
                    {
                        Ok(processed) => (processed, "文本处理完成，已输入"),
                        Err(_) => (text, "文本处理失败，已输入原始识别结果"),
                    }
                } else {
                    (text, "已输入")
                };
                if !active()
                    || !is_current_session(&session_slot, &session_id)
                    || *processing_cancelled.borrow()
                {
                    clear_current_session(&session_slot, &session_id);
                    return;
                }
                match paste::paste(&app, input_session, text).await {
                    Ok(PasteOutcome::Pasted) => {
                        emit(json!({ "kind": "completed", "message": completed_message }))
                    }
                    Ok(PasteOutcome::Copied(error)) => {
                        let _ = show_overlay(&app);
                        emit(
                            json!({ "kind": "copied", "message": "已复制到剪贴板；自动粘贴暂不可用，请在设置中重试系统授权", "detail": error }),
                        );
                    }
                    Err(error) => {
                        let _ = show_overlay(&app);
                        emit(json!({ "kind": "error", "message": error }));
                    }
                }
            }
            Err(issue) => {
                if using_account && issue.kind == "loginRequired" {
                    account.mark_expired(&app).await;
                }
                emit(
                    json!({ "kind": "error", "message": issue.message(), "detail": issue.detail }),
                );
            }
        }
        clear_current_session(&session_slot, &session_id);
        let state = app.state::<AppState>();
        if let Ok(settings) = state.settings.read() {
            set_tray_status(&state, tray_ready_text(&settings));
        }
    });
    Ok(())
}

#[tauri::command]
fn list_microphones(window: WebviewWindow) -> Result<Vec<audio::MicrophoneDevice>, String> {
    require_window(&window, "settings")?;
    audio::microphones()
}

#[tauri::command]
fn start_audio_capture(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    capture_id: String,
    device_id: String,
    session_id: Option<String>,
) -> Result<(), String> {
    match (window.label(), session_id.as_deref()) {
        ("overlay" | "settings", Some(_)) | ("settings", None) => {}
        _ => return Err("当前窗口无权执行此音频操作".to_owned()),
    }
    let capture_kind = if session_id.is_some() {
        AudioCaptureKind::Recognition
    } else {
        AudioCaptureKind::Test
    };

    let on_audio: Option<Arc<audio::AudioSink>> = if let Some(session_id) = session_id {
        let sender = current_audio_sender(&state, &session_id, window.label())?;
        Some(Arc::new(move |pcm| {
            sender
                .try_send(AudioCommand::Data(pcm))
                .map_err(|error| match error {
                    mpsc::error::TrySendError::Full(_) => {
                        "识别连接或音频传输未能跟上录音，请检查网络和系统负载后重试".to_owned()
                    }
                    mpsc::error::TrySendError::Closed(_) => "语音连接已关闭".to_owned(),
                })
        }))
    } else {
        None
    };
    let window_label = window.label().to_owned();
    let level_app = app.clone();
    let level_window = window_label.clone();
    let on_level = Arc::new(move |level| {
        let _ = level_app.emit_to(&level_window, "microphone-level", level);
    });
    let error_app = app.clone();
    let error_window = window_label.clone();
    let on_error = Arc::new(move |error| {
        let _ = error_app.emit_to(&error_window, "microphone-error", error);
    });
    let mut active = state
        .audio_capture
        .lock()
        .map_err(|_| "麦克风状态已损坏，请重启应用".to_owned())?;
    if let Some(current) = active.as_ref()
        && !can_replace_audio_capture(current.kind, capture_kind)
    {
        return Err("正在进行语音输入，请结束后再测试麦克风".to_owned());
    }
    if let Some(previous) = active.take() {
        let previous_window = previous.window_label.clone();
        drop(previous);
        let _ = app.emit_to(
            &previous_window,
            "microphone-interrupted",
            "麦克风测试已自动停止：另一项语音操作正在使用麦克风",
        );
    }
    let capture = audio::AudioCapture::start(&device_id, on_audio, on_level, on_error)?;
    *active = Some(ActiveAudioCapture {
        id: capture_id,
        kind: capture_kind,
        window_label,
        _capture: capture,
    });
    Ok(())
}

#[tauri::command]
fn stop_audio_capture(
    window: WebviewWindow,
    state: State<'_, AppState>,
    capture_id: String,
) -> Result<(), String> {
    if !matches!(window.label(), "overlay" | "settings") {
        return Err("当前窗口无权执行此音频操作".to_owned());
    }
    let capture = {
        let mut active = state
            .audio_capture
            .lock()
            .map_err(|_| "麦克风状态已损坏，请重启应用".to_owned())?;
        if active.as_ref().is_some_and(|capture| {
            capture.id == capture_id && capture.window_label == window.label()
        }) {
            active.take()
        } else {
            None
        }
    };
    drop(capture);
    Ok(())
}

#[tauri::command]
async fn finish_recognition(
    window: WebviewWindow,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let sender = current_audio_sender(&state, &session_id, window.label())?;
    sender
        .send(AudioCommand::Finish)
        .await
        .map_err(|_| "语音连接已关闭".to_owned())
}

#[tauri::command]
fn cancel_recognition(
    window: WebviewWindow,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    if !matches!(window.label(), "overlay" | "settings") {
        return Err("当前窗口无权取消听写".to_owned());
    }
    {
        let session = state
            .session
            .lock()
            .map_err(|_| "听写状态已损坏，请重启应用".to_owned())?;
        if session.as_ref().is_some_and(|session| {
            session.id == session_id && session.window_label != window.label()
        }) {
            return Err("当前窗口无权取消此听写会话".to_owned());
        }
    }
    signal_cancel(&state.session, Some(&session_id))?;
    Ok(())
}

#[tauri::command]
fn hide_overlay(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    require_window(&window, "overlay")?;
    app.get_webview_window("overlay")
        .ok_or_else(|| "找不到悬浮窗".to_owned())?
        .hide()
        .map_err(|error| format!("隐藏悬浮窗失败：{error}"))
}

#[tauri::command]
fn overlay_ready(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    require_window(&window, "overlay")?;
    state.overlay_ready.store(true, Ordering::Release);
    if let Some(event) = state
        .pending_shortcut
        .lock()
        .map_err(|_| "悬浮窗事件状态已损坏，请重启应用".to_owned())?
        .take()
    {
        let _ = app.emit_to("overlay", "shortcut-event", event);
    }
    Ok(())
}

#[tauri::command]
async fn test_recognition(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    recognition: RecognitionSettings,
    provider_revision: u64,
) -> Result<TestRecognitionResult, ServiceIssue> {
    require_window(&window, "settings").map_err(ServiceIssue::unknown)?;
    let _gate = state.recognition_gate.lock().await;
    require_provider(&state, recognition.provider, provider_revision)
        .map_err(ServiceIssue::unknown)?;
    require_recognition_idle(&state).map_err(ServiceIssue::unknown)?;
    let config = recognition_config(&app, &state, &recognition, None).await?;
    let using_account = matches!(
        &config,
        asr::SessionConfig::DoubaoIme {
            account_token: Some(_)
        }
    );
    if let Err(issue) = asr::test_connection(config).await {
        if using_account && issue.kind == "loginRequired" {
            state.account.mark_expired(&app).await;
        }
        return Err(issue);
    }
    require_provider(&state, recognition.provider, provider_revision)
        .map_err(ServiceIssue::unknown)?;
    Ok(TestRecognitionResult {
        provider: recognition.provider,
        provider_revision,
        account_revision: if recognition.provider == RecognitionProvider::DoubaoIme {
            state.account.status(&app).await.revision
        } else {
            0
        },
        hotword_status: None,
        warning: None,
    })
}

#[tauri::command]
async fn get_doubao_account(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    provider_revision: u64,
) -> Result<doubao_account::AccountStatus, String> {
    require_window(&window, "settings")?;
    let _gate = state.recognition_gate.lock().await;
    require_provider(&state, RecognitionProvider::DoubaoIme, provider_revision)?;
    Ok(state.account.status(&app).await)
}

#[tauri::command]
async fn recheck_doubao_account(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    provider_revision: u64,
) -> Result<doubao_account::AccountStatus, String> {
    require_window(&window, "settings")?;
    let _gate = state.recognition_gate.lock().await;
    require_provider(&state, RecognitionProvider::DoubaoIme, provider_revision)?;
    require_recognition_idle(&state)?;
    state
        .account
        .resolve_token(&app)
        .await
        .map_err(|issue| issue.detail)?;
    Ok(state.account.status(&app).await)
}

#[tauri::command]
async fn translate_doubao_text(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    text: String,
    to_english: bool,
    provider_revision: u64,
) -> Result<String, String> {
    require_window(&window, "settings")?;
    let _gate = state.recognition_gate.lock().await;
    require_provider(&state, RecognitionProvider::DoubaoIme, provider_revision)?;
    require_recognition_idle(&state)?;
    if text.trim().is_empty() || text.len() > 32000 {
        return Err("请输入待翻译文本，且不超过 32000 UTF-8 字节".to_owned());
    }
    let token = state
        .account
        .resolve_token(&app)
        .await
        .map_err(|issue| issue.detail)?
        .ok_or("翻译需要登录豆包账号")?;
    let result = asr::translate_doubao(&token, &text, to_english).await?;
    require_provider(&state, RecognitionProvider::DoubaoIme, provider_revision)?;
    Ok(result)
}

#[tauri::command]
async fn login_doubao(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    provider_revision: u64,
) -> Result<doubao_account::AccountStatus, String> {
    require_window(&window, "settings")?;
    let _gate = state.recognition_gate.lock().await;
    require_provider(&state, RecognitionProvider::DoubaoIme, provider_revision)?;
    require_recognition_idle(&state)?;
    state.account.login(&app).await
}

#[tauri::command]
async fn cancel_doubao_login(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    provider_revision: u64,
) -> Result<doubao_account::AccountStatus, String> {
    require_window(&window, "settings")?;
    let _gate = state.recognition_gate.lock().await;
    require_provider(&state, RecognitionProvider::DoubaoIme, provider_revision)?;
    require_recognition_idle(&state)?;
    state.account.cancel(&app).await
}

#[tauri::command]
async fn logout_doubao(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    provider_revision: u64,
) -> Result<doubao_account::AccountStatus, String> {
    require_window(&window, "settings")?;
    let _gate = state.recognition_gate.lock().await;
    require_provider(&state, RecognitionProvider::DoubaoIme, provider_revision)?;
    require_recognition_idle(&state)?;
    state.account.logout(&app).await
}
#[tauri::command]
async fn list_llm_models(
    window: WebviewWindow,
    state: State<'_, AppState>,
    provider_revision: u64,
    base_url: String,
    api_key: String,
) -> Result<Vec<String>, String> {
    require_window(&window, "settings")?;
    let _gate = state.recognition_gate.lock().await;
    let provider = state
        .settings
        .read()
        .map_err(|_| "设置状态已损坏")?
        .recognition
        .provider;
    require_provider(&state, provider, provider_revision)?;
    let models = llm::list_models(&base_url, &api_key).await?;
    require_provider(&state, provider, provider_revision)?;
    Ok(models)
}

#[tauri::command]
fn system_diagnostics(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SystemDiagnostics, String> {
    require_window(&window, "settings")?;
    let (input_ready, input_status) = match state.input_session.status()? {
        InputStatus::Uninitialized => (false, "尚未检查".to_owned()),
        InputStatus::Ready => (true, "可用".to_owned()),
        InputStatus::Unavailable(error) => (false, format!("暂不可用：{error}")),
    };
    Ok(SystemDiagnostics {
        shortcut_status: state
            .shortcut_status
            .read()
            .map_err(|_| "快捷键诊断状态已损坏，请重启应用".to_owned())?
            .clone(),
        input_ready,
        input_status,
        app_version: app.package_info().version.to_string(),
        log_dir: app
            .path()
            .app_log_dir()
            .map_err(|error| format!("读取日志目录失败：{error}"))?
            .display()
            .to_string(),
    })
}

#[tauri::command]
async fn retry_input_access(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<(), String> {
    require_window(&window, "settings")?;
    let input_session = Arc::clone(&state.input_session);
    offload_blocking_result(move || input_session.retry()).await
}

#[tauri::command]
fn open_api_key_console(window: WebviewWindow) -> Result<(), String> {
    require_window(&window, "settings")?;
    open::that(API_KEY_CONSOLE_URL).map_err(|error| format!("打开火山引擎控制台失败：{error}"))
}

#[tauri::command]
fn open_product_link(window: WebviewWindow, target: String) -> Result<(), String> {
    require_window(&window, "settings")?;
    let (url, label) = match target.as_str() {
        "homepage" => (HOMEPAGE_URL, "项目主页"),
        "help" => (HELP_URL, "帮助与反馈"),
        "privacy" => (PRIVACY_URL, "隐私说明"),
        "speechConsole" => (SPEECH_CONSOLE_URL, "语音控制台"),
        "apiKeyConsole" => (API_KEY_CONSOLE_URL, "API Key 管理"),
        "serviceDocs" => (SERVICE_DOCS_URL, "接入文档"),
        _ => return Err("未知链接".to_owned()),
    };
    open::that(url).map_err(|error| format!("打开{label}失败：{error}"))
}

#[tauri::command]
async fn check_for_update(
    window: WebviewWindow,
    app: AppHandle,
) -> Result<Option<UpdateInfo>, String> {
    require_window(&window, "settings")?;
    let update = app
        .updater()
        .map_err(|error| format!("初始化更新检查失败：{error}"))?
        .check()
        .await
        .map_err(|error| format!("检查更新失败：{error}"))?;
    Ok(update.map(|update| UpdateInfo {
        version: update.version,
    }))
}

#[tauri::command]
async fn install_update(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    require_window(&window, "settings")?;
    require_saved_settings(state.settings_dirty.load(Ordering::Acquire))?;
    let update = app
        .updater()
        .map_err(|error| format!("初始化更新安装失败：{error}"))?
        .check()
        .await
        .map_err(|error| format!("检查更新失败：{error}"))?
        .ok_or_else(|| "当前已是最新版本".to_owned())?;
    let confirmed = app
        .dialog()
        .message(format!(
            "发现 VoicePaste {}，立即下载并安装？应用将在完成后重启。",
            update.version
        ))
        .title("安装 VoicePaste 更新")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "安装更新".to_owned(),
            "稍后".to_owned(),
        ))
        .blocking_show();
    if !confirmed {
        return Ok(false);
    }
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| format!("安装更新失败：{error}"))?;
    #[cfg(target_os = "windows")]
    return Ok(true);
    #[cfg(not(target_os = "windows"))]
    app.restart();
}

#[tauri::command]
fn open_log_dir(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    require_window(&window, "settings")?;
    let path = app
        .path()
        .app_log_dir()
        .map_err(|error| format!("读取日志目录失败：{error}"))?;
    fs::create_dir_all(&path).map_err(|error| format!("创建日志目录失败：{error}"))?;
    open::that(path).map_err(|error| format!("打开日志目录失败：{error}"))
}

#[tauri::command]
fn copy_diagnostics(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    require_window(&window, "settings")?;
    let diagnostics = system_diagnostics(window, app.clone(), state)?;
    let text = format!(
        "VoicePaste {}\n快捷键：{}\n自动粘贴：{}\n系统：{} {}",
        diagnostics.app_version,
        diagnostics.shortcut_status,
        diagnostics.input_status,
        std::env::consts::OS,
        std::env::consts::ARCH,
    );
    app.clipboard()
        .write_text(text)
        .map_err(|error| format!("复制诊断信息失败：{error}"))
}

fn current_audio_sender(
    state: &State<'_, AppState>,
    session_id: &str,
    window_label: &str,
) -> Result<mpsc::Sender<AudioCommand>, String> {
    let session = state
        .session
        .lock()
        .map_err(|_| "听写状态已损坏，请重启应用".to_owned())?;
    let session = session
        .as_ref()
        .filter(|session| session.id == session_id && session.window_label == window_label)
        .ok_or_else(|| "当前听写会话已结束".to_owned())?;
    Ok(session.audio.clone())
}

fn signal_cancel(
    session_slot: &Mutex<Option<RecognitionSession>>,
    session_id: Option<&str>,
) -> Result<bool, String> {
    let session = session_slot
        .lock()
        .map_err(|_| "听写状态已损坏，请重启应用".to_owned())?;
    let Some(session) = session
        .as_ref()
        .filter(|session| session_id.is_none_or(|id| session.id == id))
    else {
        return Ok(false);
    };
    Ok(session.cancel.send(true).is_ok())
}

fn is_current_session(session_slot: &Mutex<Option<RecognitionSession>>, session_id: &str) -> bool {
    session_slot
        .lock()
        .map(|session| session.as_ref().map(|session| session.id.as_str()) == Some(session_id))
        .unwrap_or(false)
}

fn clear_current_session(session_slot: &Mutex<Option<RecognitionSession>>, session_id: &str) {
    if let Ok(mut session) = session_slot.lock()
        && session.as_ref().map(|session| session.id.as_str()) == Some(session_id)
    {
        *session = None;
    }
}

fn emit_asr_event(
    app: &AppHandle,
    window_label: &str,
    session_id: &str,
    mut payload: serde_json::Value,
) {
    payload["sessionId"] = session_id.into();
    let _ = app.emit_to(window_label, "asr-event", payload);
}

fn take_window_capture(state: &AppState, window_label: &str) -> Option<ActiveAudioCapture> {
    let mut capture = state.audio_capture.lock().ok()?;
    if capture
        .as_ref()
        .is_some_and(|capture| capture.window_label == window_label)
    {
        capture.take()
    } else {
        None
    }
}

pub(crate) fn set_shortcut_status(app: &AppHandle, status: &str) {
    if let Ok(mut current) = app.state::<AppState>().shortcut_status.write() {
        status.clone_into(&mut current);
    }
}

pub(crate) fn handle_shortcut_event(app: &AppHandle, pressed: bool) {
    let state = app.state::<AppState>();
    if pressed {
        if state.shortcut_down.swap(true, Ordering::AcqRel) {
            return;
        }
    } else if !state.shortcut_down.swap(false, Ordering::AcqRel) {
        return;
    }

    let settings = match state.settings.read() {
        Ok(settings) => settings.clone(),
        Err(_) => return,
    };
    if !pressed && matches!(settings.activation_mode, ActivationMode::Toggle) {
        return;
    }
    let event = ShortcutEventPayload {
        state: if pressed { "pressed" } else { "released" },
        activation_mode: settings.activation_mode,
        microphone_id: settings.microphone_id,
    };

    if pressed && let Err(error) = show_overlay(app) {
        let _ = app.emit_to(
            "overlay",
            "asr-event",
            json!({ "kind": "error", "sessionId": "", "message": error }),
        );
        return;
    }
    if !state.overlay_ready.load(Ordering::Acquire) {
        if let Ok(mut pending) = state.pending_shortcut.lock() {
            if pressed {
                *pending = Some(event);
            } else {
                *pending = None;
            }
        }
        return;
    }
    let _ = app.emit_to("overlay", "shortcut-event", event);
}

fn show_overlay(app: &AppHandle) -> Result<(), String> {
    let overlay = app
        .get_webview_window("overlay")
        .ok_or_else(|| "找不到悬浮窗".to_owned())?;
    let cursor = overlay
        .cursor_position()
        .map_err(|error| format!("读取鼠标位置失败：{error}"))?;
    let monitor = overlay
        .monitor_from_point(cursor.x, cursor.y)
        .map_err(|error| format!("读取当前显示器失败：{error}"))?
        .or_else(|| overlay.primary_monitor().ok().flatten())
        .ok_or_else(|| "找不到可用显示器".to_owned())?;
    let window_size = overlay
        .outer_size()
        .map_err(|error| format!("读取悬浮窗尺寸失败：{error}"))?;
    let work_area = monitor.work_area();
    let scale = monitor.scale_factor();
    let edge_inset = (24.0 * scale).round() as u32;
    let bottom_inset = (88.0 * scale).round() as u32;
    let centered_x =
        work_area.position.x + (work_area.size.width.saturating_sub(window_size.width) / 2) as i32;
    let centered_y = work_area.position.y
        + (work_area.size.height.saturating_sub(window_size.height) / 2) as i32;
    let position = app
        .state::<AppState>()
        .settings
        .read()
        .map(|settings| settings.overlay_position)
        .unwrap_or_default();
    let (x, y) = match position {
        OverlayPosition::Bottom => (
            centered_x,
            work_area.position.y
                + work_area
                    .size
                    .height
                    .saturating_sub(window_size.height)
                    .saturating_sub(bottom_inset) as i32,
        ),
        OverlayPosition::Left => (work_area.position.x + edge_inset as i32, centered_y),
        OverlayPosition::Right => (
            work_area.position.x
                + work_area
                    .size
                    .width
                    .saturating_sub(window_size.width)
                    .saturating_sub(edge_inset) as i32,
            centered_y,
        ),
    };
    overlay
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|error| format!("定位悬浮窗失败：{error}"))?;
    overlay
        .show()
        .map_err(|error| format!("显示悬浮窗失败：{error}"))
}

fn should_show_settings_on_launch(settings: &AppSettings) -> bool {
    !settings.onboarding_completed || settings.open_settings_on_startup
}

fn show_settings_on_launch(app: &AppHandle) {
    let should_show = app
        .state::<AppState>()
        .settings
        .read()
        .map(|settings| should_show_settings_on_launch(&settings))
        .unwrap_or(true);
    if should_show {
        show_settings(app);
    }
}

fn show_settings(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn request_quit(app: &AppHandle) {
    let state = app.state::<AppState>();
    if !state.settings_dirty.load(Ordering::Acquire) {
        app.exit(0);
        return;
    }
    let quit_app = app.clone();
    app.dialog()
        .message("当前设置尚未保存，仍要退出 VoicePaste 吗？")
        .title("退出 VoicePaste")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "退出".to_owned(),
            "继续编辑".to_owned(),
        ))
        .show(move |confirmed| {
            if confirmed {
                quit_app.exit(0);
            } else {
                show_settings(&quit_app);
            }
        });
}

fn setup_app(app: &mut tauri::App) -> Result<(), String> {
    let mut loaded = settings::load(app.handle())?;
    loaded.settings.launch_at_startup = app.autolaunch().is_enabled().unwrap_or(false);
    let app_state = app.state::<AppState>();
    *app_state
        .settings
        .write()
        .map_err(|_| "设置状态已损坏，请重启应用".to_owned())? = loaded.settings.clone();
    *app_state
        .hotword_binding
        .write()
        .map_err(|_| "常用词状态已损坏，请重启应用".to_owned())? = loaded.hotword_binding.clone();
    *app_state
        .startup_notice
        .lock()
        .map_err(|_| "设置提示状态已损坏，请重启应用".to_owned())? = loaded.notice;
    if loaded.settings.onboarding_completed {
        initialize_input_session(Arc::clone(&app_state.input_session));
    }
    Arc::clone(&app_state.shortcut_manager)
        .register_initial(app.handle().clone(), loaded.settings.shortcut.clone());

    let status = MenuItem::with_id(
        app,
        TRAY_STATUS_ID,
        tray_ready_text(&loaded.settings),
        false,
        None::<&str>,
    )
    .map_err(|error| format!("创建托盘状态失败：{error}"))?;
    let open_settings = MenuItem::with_id(app, TRAY_OPEN_ID, "打开 VoicePaste", true, None::<&str>)
        .map_err(|error| format!("创建托盘菜单失败：{error}"))?;
    let update = MenuItem::with_id(app, TRAY_UPDATE_ID, "检查更新…", true, None::<&str>)
        .map_err(|error| format!("创建托盘菜单失败：{error}"))?;
    let separator =
        PredefinedMenuItem::separator(app).map_err(|error| format!("创建托盘菜单失败：{error}"))?;
    let quit = MenuItem::with_id(app, TRAY_QUIT_ID, "退出 VoicePaste", true, None::<&str>)
        .map_err(|error| format!("创建托盘菜单失败：{error}"))?;
    let menu = Menu::with_items(app, &[&status, &open_settings, &update, &separator, &quit])
        .map_err(|error| format!("创建托盘菜单失败：{error}"))?;
    *app_state
        .tray_status
        .lock()
        .map_err(|_| "托盘状态已损坏，请重启应用".to_owned())? = Some(status);
    let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))
        .map_err(|error| format!("加载托盘图标失败：{error}"))?;
    if let Some(window) = app.get_webview_window("settings") {
        window
            .set_icon(tray_icon.clone())
            .map_err(|error| format!("设置窗口图标失败：{error}"))?;
    }
    let tray = TrayIconBuilder::new()
        .icon(tray_icon)
        .menu(&menu)
        .tooltip("VoicePaste")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            TRAY_OPEN_ID => show_settings(app),
            TRAY_UPDATE_ID => {
                show_settings(app);
                let _ = app.emit_to("settings", "settings-section", "about");
            }
            TRAY_QUIT_ID => request_quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_settings(tray.app_handle());
            }
        });
    #[cfg(target_os = "macos")]
    let tray = tray.icon_as_template(true);
    tray.build(app)
        .map_err(|error| format!("创建系统托盘失败：{error}"))?;

    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);

    if let Some(window) = app.get_webview_window("settings") {
        if should_show_settings_on_launch(&loaded.settings) {
            show_settings(app.handle());
        } else {
            let _ = window.hide();
        }
        let close_window = window.clone();
        window.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = close_window.emit("settings-close-requested", ());
            }
        });
    }
    #[cfg(target_os = "linux")]
    if let Some(window) = app.get_webview_window("overlay") {
        constrain_linux_overlay(&window)?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_settings_on_launch(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("voicepaste".to_owned()),
                    }),
                ])
                .max_file_size(1_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(3))
                .build(),
        )
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .manage(AppState::default())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    handle_shortcut_event(app, event.state() == ShortcutState::Pressed);
                })
                .build(),
        )
        .setup(|app| Ok(setup_app(app).map_err(std::io::Error::other)?))
        .invoke_handler(tauri::generate_handler![
            load_settings,
            select_recognition_provider,
            close_settings,
            set_settings_dirty,
            save_settings,
            save_volcengine_hotword_draft,
            apply_volcengine_hotwords,
            refresh_hotwords,
            start_recognition,
            start_recognition_preview,
            list_microphones,
            export_volcengine_hotwords,
            start_audio_capture,
            stop_audio_capture,
            finish_recognition,
            cancel_recognition,
            hide_overlay,
            overlay_ready,
            test_recognition,
            get_doubao_account,
            recheck_doubao_account,
            login_doubao,
            cancel_doubao_login,
            logout_doubao,
            translate_doubao_text,
            list_llm_models,
            system_diagnostics,
            retry_input_access,
            open_api_key_console,
            open_product_link,
            check_for_update,
            install_update,
            open_log_dir,
            copy_diagnostics,
        ])
        .run(tauri::generate_context!())
        .expect("VoicePaste 启动失败");
}

#[cfg(test)]
mod tests {
    use super::{
        AppState, AudioCaptureKind, AudioCommand, RecognitionSession, can_replace_audio_capture,
        confirm_hotword_snapshot, hotword_status,
        hotwords::Snapshot,
        offload_blocking_result, prepare_ordinary_save, require_provider, require_saved_settings,
        settings::{AppSettings, RecognitionProvider, VolcengineSettings},
        should_show_settings_on_launch, signal_cancel,
    };
    use std::sync::Mutex;
    use std::sync::atomic::Ordering;
    use tokio::sync::{mpsc, watch};
    #[test]
    fn recognition_preempts_tests_but_tests_do_not_preempt_recognition() {
        assert!(can_replace_audio_capture(
            AudioCaptureKind::Test,
            AudioCaptureKind::Recognition
        ));
        assert!(!can_replace_audio_capture(
            AudioCaptureKind::Recognition,
            AudioCaptureKind::Test
        ));
    }

    #[test]
    fn recognition_uses_only_confirmed_words_and_blocks_uncertain_submissions() {
        let mut recognition = super::RecognitionSettings {
            provider: RecognitionProvider::Volcengine,
            volcengine: super::VolcengineSettings {
                hotwords_enabled: true,
                hotword_draft: Some(vec!["not-applied".to_owned()]),
                ..Default::default()
            },
            ..Default::default()
        };
        let binding = super::HotwordBinding {
            table_id: "confirmed-table".to_owned(),
            limit: 5000,
        };
        assert_eq!(
            super::applied_hotword_table(&recognition, Some(&binding)).unwrap(),
            None
        );
        recognition.volcengine.hotwords = vec!["confirmed".to_owned()];
        assert_eq!(
            super::applied_hotword_table(&recognition, Some(&binding))
                .unwrap()
                .as_deref(),
            Some("confirmed-table")
        );
        assert!(super::applied_hotword_table(&recognition, None).is_err());
        recognition.volcengine.hotword_pending = Some(Vec::new());
        assert!(super::applied_hotword_table(&recognition, Some(&binding)).is_err());
        recognition.volcengine.hotwords_enabled = false;
        assert_eq!(
            super::applied_hotword_table(&recognition, Some(&binding)).unwrap(),
            None
        );
        recognition.provider = RecognitionProvider::DoubaoIme;
        recognition.volcengine.hotwords_enabled = true;
        assert_eq!(
            super::applied_hotword_table(&recognition, Some(&binding)).unwrap(),
            None
        );
    }

    #[test]
    fn startup_window_setting_controls_completed_onboarding() {
        let mut settings = AppSettings::default();
        assert!(should_show_settings_on_launch(&settings));

        settings.onboarding_completed = true;
        assert!(should_show_settings_on_launch(&settings));

        settings.open_settings_on_startup = false;
        assert!(!should_show_settings_on_launch(&settings));
    }

    #[test]
    fn disabled_hotwords_still_surface_remote_drift() {
        let settings = VolcengineSettings::default();
        let snapshot = Snapshot {
            words: vec!["VoicePaste".to_owned()],
            ..Snapshot::default()
        };

        assert_eq!(hotword_status(&settings, &snapshot).state, "pending");
    }

    #[test]
    fn ordinary_saves_preserve_confirmed_words_pending_writes_and_inactive_profile() {
        let mut previous = AppSettings::default();
        previous.recognition.provider = RecognitionProvider::Volcengine;
        previous.recognition.volcengine.hotwords = vec!["confirmed".to_owned()];
        previous.recognition.volcengine.hotword_pending = Some(vec!["submitted".to_owned()]);
        previous.recognition.volcengine.hotword_draft = Some(vec!["draft".to_owned()]);
        previous.recognition.doubao_ime.llm.model = "private-model".to_owned();
        let mut next = previous.clone();
        next.recognition.volcengine.hotwords.clear();
        next.recognition.volcengine.hotword_draft = None;
        next.recognition.volcengine.hotword_pending = None;
        next.recognition.doubao_ime.llm.model.clear();
        prepare_ordinary_save(&mut next, &previous).unwrap();
        assert_eq!(next.recognition, previous.recognition);
        next.recognition.volcengine.api_key = "new-target".to_owned();
        assert!(prepare_ordinary_save(&mut next, &previous).is_err());
        next.recognition.provider = RecognitionProvider::DoubaoIme;
        assert!(prepare_ordinary_save(&mut next, &previous).is_err());
    }

    #[test]
    fn refresh_recovers_submitted_words_but_preserves_newer_local_draft() {
        let mut profile = VolcengineSettings {
            hotwords: vec!["old".to_owned()],
            hotword_pending: Some(vec!["submitted".to_owned()]),
            hotword_draft: Some(vec!["newer".to_owned()]),
            ..VolcengineSettings::default()
        };
        let mut snapshot = Snapshot {
            words: vec!["old".to_owned()],
            ..Snapshot::default()
        };
        assert!(!confirm_hotword_snapshot(&mut profile, &snapshot));
        assert_eq!(hotword_status(&profile, &snapshot).state, "confirming");
        snapshot.words = vec!["submitted".to_owned()];
        assert!(confirm_hotword_snapshot(&mut profile, &snapshot));
        assert_eq!(profile.hotwords, ["submitted"]);
        assert_eq!(profile.hotword_draft, Some(vec!["newer".to_owned()]));
        assert!(profile.hotword_pending.is_none());
        profile.hotword_pending = Some(Vec::new());
        profile.hotword_draft = Some(Vec::new());
        snapshot.words.clear();
        assert!(confirm_hotword_snapshot(&mut profile, &snapshot));
        assert!(profile.hotwords.is_empty());
        assert!(profile.hotword_draft.is_none());
    }

    #[test]
    fn inactive_and_stale_service_commands_are_rejected_before_work() {
        let state = AppState::default();
        assert!(require_provider(&state, RecognitionProvider::DoubaoIme, 1).is_ok());
        assert!(require_provider(&state, RecognitionProvider::Volcengine, 1).is_err());
        state.provider_revision.store(2, Ordering::Release);
        assert!(require_provider(&state, RecognitionProvider::DoubaoIme, 1).is_err());
        assert!(require_provider(&state, RecognitionProvider::DoubaoIme, 2).is_ok());
    }

    #[test]
    fn update_install_requires_saved_settings() {
        assert!(require_saved_settings(false).is_ok());
        assert!(require_saved_settings(true).is_err());
    }

    #[test]
    fn blocking_operations_can_create_their_own_runtime() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let result = runtime.block_on(offload_blocking_result(|| {
            let nested = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|error| error.to_string())?;
            Ok(nested.block_on(async { 42 }))
        }));

        assert_eq!(result.unwrap(), 42);
    }

    #[test]
    fn cancelling_keeps_session_until_worker_cleanup() {
        let (audio, _) = mpsc::channel::<AudioCommand>(1);
        let (cancel, cancelled) = watch::channel(false);
        let session = Mutex::new(Some(RecognitionSession {
            id: "session".to_owned(),
            window_label: "overlay",
            audio,
            cancel,
        }));

        assert!(signal_cancel(&session, Some("session")).unwrap());
        assert!(*cancelled.borrow());
        assert!(session.lock().unwrap().is_some());
    }
}
