mod asr;
mod audio;
mod hotwords;
mod paste;
mod settings;
mod shortcut;

use std::{
    fs,
    sync::{
        Arc, Mutex, RwLock,
        atomic::{AtomicBool, Ordering},
    },
};

use asr::{AsrOutcome, AudioCommand, ServiceIssue};
use hotwords::{Binding as HotwordBinding, SyncOutcome};
use paste::{InputStatus, PasteOutcome};
use serde::Serialize;
use serde_json::json;
use settings::{ActivationMode, AppSettings, CredentialStorage, OverlayPosition};
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
    settings: RwLock<AppSettings>,
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
            settings: RwLock::new(AppSettings::default()),
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
    hotword_status: HotwordSyncStatus,
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
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TestDoubaoResult {
    hotword_count: usize,
    hotword_limit: usize,
}

/// Status backed by a fresh cloud snapshot: the cloud is the truth.
fn hotword_status(settings: &AppSettings, snapshot: &hotwords::Snapshot) -> HotwordSyncStatus {
    HotwordSyncStatus {
        state: if !settings.hotwords_enabled {
            "disabled"
        } else if settings.hotwords.is_empty() && snapshot.words.is_empty() {
            "empty"
        } else if snapshot.words == settings.hotwords {
            "synced"
        } else {
            "pending"
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
    settings: &AppSettings,
    binding: Option<&HotwordBinding>,
) -> HotwordSyncStatus {
    HotwordSyncStatus {
        state: if !settings.hotwords_enabled {
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
        settings: &AppSettings,
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
        }
    }

    fn conflict(snapshot: hotwords::Snapshot) -> Self {
        Self {
            kind: "conflict",
            credential_storage: None,
            hotword_status: None,
            hotword_action: None,
            hotword_limit: snapshot.limit,
            cloud_hotwords: snapshot.words,
        }
    }
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
fn set_settings_dirty(
    window: WebviewWindow,
    state: State<'_, AppState>,
    dirty: bool,
) -> Result<(), String> {
    require_window(&window, "settings")?;
    state.settings_dirty.store(dirty, Ordering::Release);
    Ok(())
}

#[tauri::command]
fn load_settings(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<LoadSettingsResult, String> {
    require_window(&window, "settings")?;
    let settings = state
        .settings
        .read()
        .map_err(|_| "设置状态已损坏，请重启应用".to_owned())?
        .clone();
    let binding = state
        .hotword_binding
        .read()
        .map_err(|_| "常用词状态已损坏，请重启应用".to_owned())?
        .clone();
    let notice = state
        .startup_notice
        .lock()
        .map_err(|_| "设置提示状态已损坏，请重启应用".to_owned())?
        .take();
    Ok(LoadSettingsResult {
        hotword_status: unverified_hotword_status(&settings, binding.as_ref()),
        settings,
        notice,
    })
}

#[tauri::command]
async fn save_settings(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    mut settings: AppSettings,
    force_hotword_overwrite: bool,
) -> Result<SaveSettingsResult, String> {
    require_window(&window, "settings")?;
    settings.api_key = settings.api_key.trim().to_owned();
    settings.shortcut = settings.shortcut.trim().to_owned();
    settings.microphone_id = settings.microphone_id.trim().to_owned();
    settings.hotwords = hotwords::normalize(settings.hotwords)?;
    if settings.shortcut.is_empty() {
        return Err("全局快捷键不能为空".to_owned());
    }
    if settings.api_key.is_empty() && !settings.hotwords.is_empty() {
        return Err("请先填写豆包 API Key，或清空常用词后再保存".to_owned());
    }

    let old_settings = state
        .settings
        .read()
        .map_err(|_| "设置状态已损坏，请重启应用".to_owned())?
        .clone();
    let old_binding = state
        .hotword_binding
        .read()
        .map_err(|_| "常用词状态已损坏，请重启应用".to_owned())?
        .clone();
    let key_changed = settings.api_key != old_settings.api_key;

    // Always reconcile against the cloud: local state is never trusted as proof
    // of what the remote table holds.
    let (cloud, hotword_action) = if settings.api_key.is_empty() {
        if key_changed && !old_settings.api_key.is_empty() && old_binding.is_some() {
            match hotwords::sync(
                &old_settings.api_key,
                &old_settings.hotwords,
                &[],
                old_binding.as_ref(),
                true,
            )
            .await?
            {
                SyncOutcome::Saved { snapshot, action } => (snapshot, action.label()),
                SyncOutcome::Conflict(_) => unreachable!("forced cloud deletion cannot conflict"),
            }
        } else {
            (hotwords::Snapshot::default(), "none")
        }
    } else {
        let expected_binding = if key_changed {
            None
        } else {
            old_binding.as_ref()
        };
        match hotwords::sync(
            &settings.api_key,
            &old_settings.hotwords,
            &settings.hotwords,
            expected_binding,
            force_hotword_overwrite,
        )
        .await?
        {
            SyncOutcome::Saved { snapshot, action } => (snapshot, action.label()),
            SyncOutcome::Conflict(snapshot) => {
                return Ok(SaveSettingsResult::conflict(snapshot));
            }
        }
    };

    state
        .shortcut_manager
        .replace(&app, &settings.shortcut, Some(&old_settings.shortcut))
        .await?;
    if let Err(error) = apply_autostart(&app, settings.launch_at_startup) {
        let _ = state
            .shortcut_manager
            .replace(&app, &old_settings.shortcut, Some(&settings.shortcut))
            .await;
        return Err(error);
    }

    let new_binding = cloud.binding.clone();
    let save_app = app.clone();
    let settings_to_save = settings.clone();
    let binding_to_save = new_binding.clone();
    // Linux keyring uses its own async runtime, so it must not run on a Tokio worker.
    let credential_storage = match offload_blocking_result(move || {
        settings::save(&save_app, &settings_to_save, binding_to_save.as_ref())
    })
    .await
    {
        Ok(storage) => storage,
        Err(error) => {
            let _ = state
                .shortcut_manager
                .replace(&app, &old_settings.shortcut, Some(&settings.shortcut))
                .await;
            let _ = apply_autostart(&app, old_settings.launch_at_startup);
            return Err(error);
        }
    };
    let should_initialize_input = !settings.api_key.is_empty();
    {
        let mut saved_settings = state
            .settings
            .write()
            .map_err(|_| "设置状态已损坏，请重启应用".to_owned())?;
        let mut saved_binding = state
            .hotword_binding
            .write()
            .map_err(|_| "常用词状态已损坏，请重启应用".to_owned())?;
        *saved_settings = settings.clone();
        *saved_binding = new_binding.clone();
    }
    state.settings_dirty.store(false, Ordering::Release);
    if should_initialize_input {
        initialize_input_session(Arc::clone(&state.input_session));
    }
    set_shortcut_status(&app, "全局快捷键已启用");
    set_tray_status(&state, tray_ready_text(&settings));
    Ok(SaveSettingsResult::saved(
        credential_storage,
        &settings,
        cloud,
        hotword_action,
    ))
}

/// Re-reads the cloud tables and makes local state tell the truth again.
#[tauri::command]
async fn refresh_hotwords(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<HotwordSnapshotResult, String> {
    require_window(&window, "settings")?;
    let settings = state
        .settings
        .read()
        .map_err(|_| "设置状态已损坏，请重启应用".to_owned())?
        .clone();
    let binding = state
        .hotword_binding
        .read()
        .map_err(|_| "常用词状态已损坏，请重启应用".to_owned())?
        .clone();
    if settings.api_key.is_empty() {
        return Ok(HotwordSnapshotResult {
            hotword_status: unverified_hotword_status(&settings, binding.as_ref()),
            cloud_hotwords: Vec::new(),
        });
    }

    let snapshot = hotwords::inspect(&settings.api_key).await?;
    let new_binding = snapshot.binding.clone();
    if new_binding.as_ref().map(|binding| &binding.table_id)
        != binding.as_ref().map(|binding| &binding.table_id)
    {
        let save_app = app.clone();
        let settings_to_save = settings.clone();
        let binding_to_save = new_binding.clone();
        // Linux keyring uses its own async runtime, so it must not run on a Tokio worker.
        offload_blocking_result(move || {
            settings::save(&save_app, &settings_to_save, binding_to_save.as_ref())
        })
        .await?;
    }
    *state
        .hotword_binding
        .write()
        .map_err(|_| "常用词状态已损坏，请重启应用".to_owned())? = new_binding;
    Ok(HotwordSnapshotResult {
        hotword_status: hotword_status(&settings, &snapshot),
        cloud_hotwords: snapshot.words,
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
    if session_id.is_empty() || session_id.len() > 64 {
        return Err("听写会话标识无效".to_owned());
    }
    let settings = state
        .settings
        .read()
        .map_err(|_| "设置状态已损坏，请重启应用".to_owned())?
        .clone();
    if settings.api_key.is_empty() {
        return Err("请先在设置中填写豆包 API Key".to_owned());
    }
    let hotword_table_id = if settings.hotwords_enabled && !settings.hotwords.is_empty() {
        Some(
            state
                .hotword_binding
                .read()
                .map_err(|_| "常用词状态已损坏，请重启应用".to_owned())?
                .as_ref()
                .map(|binding| binding.table_id.clone())
                .ok_or_else(|| "常用词尚未同步，请先在设置中保存".to_owned())?,
        )
    } else {
        None
    };

    let (audio, receiver) = mpsc::channel(32);
    let (cancel, cancelled) = watch::channel(false);
    {
        let mut session = state
            .session
            .lock()
            .map_err(|_| "听写状态已损坏，请重启应用".to_owned())?;
        if session.is_some() {
            return Err("已有听写正在进行".to_owned());
        }
        *session = Some(RecognitionSession {
            id: session_id.clone(),
            audio,
            cancel,
        });
    }
    set_tray_status(&state, "正在听写");

    let session_slot = Arc::clone(&state.session);
    let input_session = Arc::clone(&state.input_session);
    tauri::async_runtime::spawn(async move {
        let result = asr::run(
            settings,
            hotword_table_id,
            receiver,
            cancelled,
            app.clone(),
            session_id.clone(),
        )
        .await;
        if !is_current_session(&session_slot, &session_id) {
            return;
        }
        match result {
            Ok(AsrOutcome::Cancelled) => {}
            Ok(AsrOutcome::Text(text)) if text.trim().is_empty() => {
                emit_asr_event(
                    &app,
                    &session_id,
                    json!({ "kind": "empty", "message": "没有听到可输入的内容" }),
                );
            }
            Ok(AsrOutcome::Text(text)) => {
                match paste::paste(&app, Arc::clone(&input_session), text).await {
                    Ok(PasteOutcome::Pasted) => emit_asr_event(
                        &app,
                        &session_id,
                        json!({ "kind": "completed", "message": "已输入" }),
                    ),
                    Ok(PasteOutcome::Copied(error)) => {
                        let _ = show_overlay(&app);
                        let hint = "已复制到剪贴板；自动粘贴暂不可用，请在设置中重试系统授权";
                        emit_asr_event(
                            &app,
                            &session_id,
                            json!({ "kind": "copied", "message": hint, "detail": error }),
                        );
                    }
                    Err(error) => {
                        let _ = show_overlay(&app);
                        emit_asr_event(
                            &app,
                            &session_id,
                            json!({ "kind": "error", "message": error }),
                        );
                    }
                }
            }
            Err(error) => emit_asr_event(
                &app,
                &session_id,
                json!({ "kind": "error", "message": error }),
            ),
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
        ("overlay", Some(_)) | ("settings", None) => {}
        _ => return Err("当前窗口无权执行此音频操作".to_owned()),
    }
    let capture_kind = if session_id.is_some() {
        AudioCaptureKind::Recognition
    } else {
        AudioCaptureKind::Test
    };

    let on_audio: Option<Arc<audio::AudioSink>> = if let Some(session_id) = session_id {
        let sender = current_audio_sender(&state, &session_id)?;
        Some(Arc::new(move |pcm| {
            sender
                .try_send(AudioCommand::Data(pcm))
                .map_err(|error| match error {
                    mpsc::error::TrySendError::Full(_) => {
                        "音频传输跟不上录音速度，请检查系统负载后重试".to_owned()
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
        if active.as_ref().map(|capture| capture.id.as_str()) == Some(capture_id.as_str()) {
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
    require_window(&window, "overlay")?;
    current_audio_sender(&state, &session_id)?
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
    require_window(&window, "overlay")?;
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
async fn test_doubao(
    window: WebviewWindow,
    api_key: String,
) -> Result<TestDoubaoResult, ServiceIssue> {
    require_window(&window, "settings").map_err(ServiceIssue::unknown)?;
    let api_key = api_key.trim().to_owned();
    asr::test_connection(api_key.clone()).await?;
    let snapshot = hotwords::inspect(&api_key)
        .await
        .map_err(ServiceIssue::hotwords_unavailable)?;
    Ok(TestDoubaoResult {
        hotword_count: snapshot.words.len(),
        hotword_limit: snapshot.limit,
    })
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
) -> Result<mpsc::Sender<AudioCommand>, String> {
    let session = state
        .session
        .lock()
        .map_err(|_| "听写状态已损坏，请重启应用".to_owned())?;
    let session = session
        .as_ref()
        .filter(|session| session.id == session_id)
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

fn emit_asr_event(app: &AppHandle, session_id: &str, mut payload: serde_json::Value) {
    payload["sessionId"] = session_id.into();
    let _ = app.emit_to("overlay", "asr-event", payload);
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
    let should_initialize_input = !loaded.settings.api_key.is_empty();
    if should_initialize_input {
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
    let mut tray = TrayIconBuilder::new()
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
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    #[cfg(target_os = "macos")]
    {
        tray = tray.icon_as_template(true);
    }
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
                let _ = close_window.hide();
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
        .plugin(tauri_plugin_store::Builder::default().build())
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
            set_settings_dirty,
            save_settings,
            refresh_hotwords,
            start_recognition,
            list_microphones,
            start_audio_capture,
            stop_audio_capture,
            finish_recognition,
            cancel_recognition,
            hide_overlay,
            overlay_ready,
            test_doubao,
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
        AudioCaptureKind, AudioCommand, RecognitionSession, can_replace_audio_capture,
        offload_blocking_result, require_saved_settings, settings::AppSettings,
        should_show_settings_on_launch, signal_cancel,
    };
    use std::sync::Mutex;
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
    fn startup_window_setting_controls_completed_onboarding() {
        let mut settings = AppSettings::default();
        assert!(should_show_settings_on_launch(&settings));

        settings.onboarding_completed = true;
        assert!(should_show_settings_on_launch(&settings));

        settings.open_settings_on_startup = false;
        assert!(!should_show_settings_on_launch(&settings));
    }

    #[test]
    fn update_install_requires_saved_settings() {
        assert!(require_saved_settings(false).is_ok());
        assert_eq!(
            require_saved_settings(true).unwrap_err(),
            "请先保存当前设置，再安装更新"
        );
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
            audio,
            cancel,
        }));

        assert!(signal_cancel(&session, Some("session")).unwrap());
        assert!(*cancelled.borrow());
        assert!(session.lock().unwrap().is_some());
    }
}
