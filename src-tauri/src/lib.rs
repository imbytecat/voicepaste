mod asr;
mod paste;
mod settings;
mod shortcut;

use std::sync::{
    Arc, Mutex, RwLock,
    atomic::{AtomicBool, Ordering},
};

use asr::{AsrOutcome, AudioCommand};
use paste::PasteOutcome;
use serde::Serialize;
use serde_json::json;
use settings::{ActivationMode, AppSettings, CredentialStorage};
use shortcut::PortalTask;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewWindow, WindowEvent,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_global_shortcut::ShortcutState;
use tokio::sync::{mpsc, watch};

const API_KEY_CONSOLE_URL: &str = "https://console.volcengine.com/speech/new/setting/apikeys";
const MAX_AUDIO_BYTES: usize = 64 * 1024;

struct RecognitionSession {
    id: String,
    audio: mpsc::Sender<AudioCommand>,
    cancel: watch::Sender<bool>,
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
    session: Arc<Mutex<Option<RecognitionSession>>>,
    portal_task: Arc<PortalTask>,
    shortcut_status: RwLock<String>,
    startup_notice: Mutex<Option<String>>,
    overlay_ready: AtomicBool,
    pending_shortcut: Mutex<Option<ShortcutEventPayload>>,
    shortcut_down: AtomicBool,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            settings: RwLock::new(AppSettings::default()),
            session: Arc::new(Mutex::new(None)),
            portal_task: Arc::new(Mutex::new(None)),
            shortcut_status: RwLock::new("正在注册快捷键…".to_owned()),
            startup_notice: Mutex::new(None),
            overlay_ready: AtomicBool::new(false),
            pending_shortcut: Mutex::new(None),
            shortcut_down: AtomicBool::new(false),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadSettingsResult {
    settings: AppSettings,
    notice: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveSettingsResult {
    credential_storage: CredentialStorage,
    shortcut_backend: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlatformDiagnostics {
    platform: &'static str,
    display_server: &'static str,
    shortcut_backend: &'static str,
    shortcut_status: String,
    accessibility: &'static str,
}

fn require_window(window: &WebviewWindow, expected: &str) -> Result<(), String> {
    if window.label() == expected {
        Ok(())
    } else {
        Err("当前窗口无权执行此操作".to_owned())
    }
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
    let notice = state
        .startup_notice
        .lock()
        .map_err(|_| "设置提示状态已损坏，请重启应用".to_owned())?
        .take();
    Ok(LoadSettingsResult { settings, notice })
}

#[tauri::command]
async fn save_settings(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    mut settings: AppSettings,
) -> Result<SaveSettingsResult, String> {
    require_window(&window, "settings")?;
    settings.api_key = settings.api_key.trim().to_owned();
    settings.shortcut = settings.shortcut.trim().to_owned();
    settings.microphone_id = settings.microphone_id.trim().to_owned();
    settings.hotwords = settings::sanitize_hotwords(settings.hotwords)?;
    if settings.shortcut.is_empty() {
        return Err("全局快捷键不能为空".to_owned());
    }

    let old_settings = state
        .settings
        .read()
        .map_err(|_| "设置状态已损坏，请重启应用".to_owned())?
        .clone();
    shortcut::replace(
        &app,
        &state.portal_task,
        &settings.shortcut,
        Some(&old_settings.shortcut),
    )
    .await?;
    let credential_storage = match settings::save(&app, &settings) {
        Ok(storage) => storage,
        Err(error) => {
            let _ = shortcut::replace(
                &app,
                &state.portal_task,
                &old_settings.shortcut,
                Some(&settings.shortcut),
            )
            .await;
            return Err(error);
        }
    };
    *state
        .settings
        .write()
        .map_err(|_| "设置状态已损坏，请重启应用".to_owned())? = settings;
    set_shortcut_status(
        &app,
        if shortcut::uses_portal() {
            "Wayland 桌面门户快捷键已启用"
        } else {
            "系统全局快捷键已启用"
        },
    );
    Ok(SaveSettingsResult {
        credential_storage,
        shortcut_backend: shortcut::backend_name(),
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

    let session_slot = Arc::clone(&state.session);
    tauri::async_runtime::spawn(async move {
        let result = asr::run(
            settings,
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
            Ok(AsrOutcome::Text(text)) => match paste::paste(&app, text).await {
                Ok(PasteOutcome::Pasted) => emit_asr_event(
                    &app,
                    &session_id,
                    json!({ "kind": "completed", "message": "已输入" }),
                ),
                Ok(PasteOutcome::Copied(error)) => {
                    let hint = if cfg!(target_os = "macos") {
                        "已复制到剪贴板；请在系统设置中授予 VoicePaste“辅助功能”权限"
                    } else if cfg!(target_os = "linux") {
                        "已复制到剪贴板；当前桌面未允许模拟粘贴，请授权远程输入或改用 X11"
                    } else {
                        "已复制到剪贴板；目标程序权限高于 VoicePaste，无法自动粘贴"
                    };
                    emit_asr_event(
                        &app,
                        &session_id,
                        json!({ "kind": "copied", "message": hint, "detail": error }),
                    );
                }
                Err(error) => emit_asr_event(
                    &app,
                    &session_id,
                    json!({ "kind": "error", "message": error }),
                ),
            },
            Err(error) => emit_asr_event(
                &app,
                &session_id,
                json!({ "kind": "error", "message": error }),
            ),
        }
        clear_current_session(&session_slot, &session_id);
    });
    Ok(())
}

#[tauri::command]
async fn send_audio(
    window: WebviewWindow,
    request: tauri::ipc::Request<'_>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    require_window(&window, "overlay")?;
    let tauri::ipc::InvokeBody::Raw(pcm) = request.body() else {
        return Err("音频数据格式无效".to_owned());
    };
    let session_id = request
        .headers()
        .get("x-voicepaste-session")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "音频请求缺少听写会话标识".to_owned())?;
    if pcm.len() > MAX_AUDIO_BYTES {
        return Err(format!(
            "单个音频分片超过 {} KiB 限制",
            MAX_AUDIO_BYTES / 1024
        ));
    }
    let sender = current_audio_sender(&state, session_id)?;
    sender
        .send(AudioCommand::Data(pcm.clone()))
        .await
        .map_err(|_| "语音连接已关闭".to_owned())
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
    let mut session = state
        .session
        .lock()
        .map_err(|_| "听写状态已损坏，请重启应用".to_owned())?;
    if session.as_ref().map(|session| session.id.as_str()) != Some(session_id.as_str()) {
        return Ok(());
    }
    if let Some(session) = session.take() {
        let _ = session.cancel.send(true);
    }
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
async fn test_doubao(window: WebviewWindow, api_key: String) -> Result<(), String> {
    require_window(&window, "settings")?;
    asr::test_connection(api_key).await
}

#[tauri::command]
fn platform_diagnostics(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<PlatformDiagnostics, String> {
    require_window(&window, "settings")?;
    Ok(PlatformDiagnostics {
        platform: std::env::consts::OS,
        display_server: display_server(),
        shortcut_backend: shortcut::backend_name(),
        shortcut_status: state
            .shortcut_status
            .read()
            .map_err(|_| "快捷键诊断状态已损坏，请重启应用".to_owned())?
            .clone(),
        accessibility: accessibility_status(),
    })
}

#[tauri::command]
fn request_accessibility(window: WebviewWindow) -> Result<bool, String> {
    require_window(&window, "settings")?;
    #[cfg(target_os = "macos")]
    {
        Ok(macos_accessibility_client::accessibility::application_is_trusted_with_prompt())
    }
    #[cfg(not(target_os = "macos"))]
    Err("当前平台不需要 macOS 辅助功能权限".to_owned())
}

#[tauri::command]
fn open_api_key_console(window: WebviewWindow) -> Result<(), String> {
    require_window(&window, "settings")?;
    open::that(API_KEY_CONSOLE_URL).map_err(|error| format!("打开火山引擎控制台失败：{error}"))
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
    let monitor_size = monitor.size();
    let monitor_position = monitor.position();
    let x = monitor_position.x + (monitor_size.width.saturating_sub(window_size.width) / 2) as i32;
    let y = monitor_position.y + (f64::from(monitor_size.height) * 0.72) as i32
        - (window_size.height / 2) as i32;
    overlay
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|error| format!("定位悬浮窗失败：{error}"))?;
    overlay
        .show()
        .map_err(|error| format!("显示悬浮窗失败：{error}"))
}

fn show_settings(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn display_server() -> &'static str {
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WAYLAND_DISPLAY").is_some() {
            return "Wayland";
        }
        if std::env::var_os("DISPLAY").is_some() {
            return "X11";
        }
        "未知"
    }
    #[cfg(target_os = "macos")]
    {
        "Quartz"
    }
    #[cfg(target_os = "windows")]
    {
        "Windows"
    }
}

fn accessibility_status() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        if macos_accessibility_client::accessibility::application_is_trusted() {
            "granted"
        } else {
            "denied"
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        "unsupported"
    }
}

fn setup_app(app: &mut tauri::App) -> Result<(), String> {
    let loaded = settings::load(app.handle())?;
    let app_state = app.state::<AppState>();
    *app_state
        .settings
        .write()
        .map_err(|_| "设置状态已损坏，请重启应用".to_owned())? = loaded.settings.clone();
    *app_state
        .startup_notice
        .lock()
        .map_err(|_| "设置提示状态已损坏，请重启应用".to_owned())? = loaded.notice;
    shortcut::register_initial(
        app.handle().clone(),
        Arc::clone(&app_state.portal_task),
        loaded.settings.shortcut,
    );

    let open_settings = MenuItem::with_id(app, "settings", "打开设置", true, None::<&str>)
        .map_err(|error| format!("创建托盘菜单失败：{error}"))?;
    let quit = MenuItem::with_id(app, "quit", "退出 VoicePaste", true, None::<&str>)
        .map_err(|error| format!("创建托盘菜单失败：{error}"))?;
    let menu = Menu::with_items(app, &[&open_settings, &quit])
        .map_err(|error| format!("创建托盘菜单失败：{error}"))?;
    let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("VoicePaste")
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_menu_event(|app, event| match event.id.as_ref() {
            "settings" => show_settings(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if !cfg!(target_os = "macos")
                && matches!(
                    event,
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    }
                )
            {
                show_settings(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)
        .map_err(|error| format!("创建系统托盘失败：{error}"))?;

    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);

    if let Some(window) = app.get_webview_window("settings") {
        let close_window = window.clone();
        window.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = close_window.hide();
            }
        });
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_settings(app)
        }))
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
            save_settings,
            start_recognition,
            send_audio,
            finish_recognition,
            cancel_recognition,
            hide_overlay,
            overlay_ready,
            test_doubao,
            platform_diagnostics,
            request_accessibility,
            open_api_key_console
        ])
        .run(tauri::generate_context!())
        .expect("VoicePaste 启动失败");
}
