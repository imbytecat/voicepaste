mod asr;
mod paste;
mod settings;

use std::sync::{Arc, Mutex, RwLock};

use asr::AudioCommand;
use paste::PasteOutcome;
use serde_json::json;
use settings::{AppSettings, DEFAULT_SHORTCUT};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, State, WindowEvent,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tokio::sync::mpsc;

struct AppState {
    settings: RwLock<AppSettings>,
    session: Arc<Mutex<Option<mpsc::Sender<AudioCommand>>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            settings: RwLock::new(AppSettings::default()),
            session: Arc::new(Mutex::new(None)),
        }
    }
}

#[tauri::command]
fn load_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    state
        .settings
        .read()
        .map(|settings| settings.clone())
        .map_err(|_| "设置状态已损坏，请重启应用".to_owned())
}

#[tauri::command]
fn save_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    mut settings: AppSettings,
) -> Result<(), String> {
    settings.api_key = settings.api_key.trim().to_owned();
    settings.resource_id = settings.resource_id.trim().to_owned();
    settings.shortcut = settings.shortcut.trim().to_owned();
    settings.hotwords = settings
        .hotwords
        .into_iter()
        .map(|word| word.trim().to_owned())
        .filter(|word| !word.is_empty())
        .collect();
    if settings.resource_id.is_empty() {
        return Err("Resource ID 不能为空".to_owned());
    }
    if settings.shortcut.is_empty() {
        return Err("全局快捷键不能为空".to_owned());
    }

    let old_settings = state
        .settings
        .read()
        .map_err(|_| "设置状态已损坏，请重启应用".to_owned())?
        .clone();
    replace_shortcut(&app, &settings.shortcut, &old_settings.shortcut)?;
    if let Err(error) = settings::save(&app, &settings) {
        let _ = replace_shortcut(&app, &old_settings.shortcut, &settings.shortcut);
        return Err(error);
    }
    *state
        .settings
        .write()
        .map_err(|_| "设置状态已损坏，请重启应用".to_owned())? = settings;
    Ok(())
}

#[tauri::command]
async fn start_recognition(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let settings = state
        .settings
        .read()
        .map_err(|_| "设置状态已损坏，请重启应用".to_owned())?
        .clone();
    if settings.api_key.is_empty() {
        return Err("请先在设置中填写豆包 API Key".to_owned());
    }

    let (sender, receiver) = mpsc::channel(64);
    {
        let mut session = state
            .session
            .lock()
            .map_err(|_| "听写状态已损坏，请重启应用".to_owned())?;
        if session.is_some() {
            return Err("已有听写正在进行".to_owned());
        }
        *session = Some(sender);
    }

    let session_slot = Arc::clone(&state.session);
    tauri::async_runtime::spawn(async move {
        match asr::run(settings, receiver, app.clone()).await {
            Ok(text) => match paste::paste(&app, text).await {
                Ok(PasteOutcome::Pasted) => {
                    let _ = app.emit_to(
                        "overlay",
                        "asr-event",
                        json!({ "kind": "completed", "message": "已输入" }),
                    );
                }
                Ok(PasteOutcome::Copied(error)) => {
                    let hint = if cfg!(target_os = "macos") {
                        "已复制到剪贴板；请在系统设置中授予 VoicePaste“辅助功能”权限"
                    } else if cfg!(target_os = "linux") {
                        "已复制到剪贴板；当前桌面未允许模拟粘贴，请授权远程输入或改用 X11"
                    } else {
                        "已复制到剪贴板；目标程序权限高于 VoicePaste，无法自动粘贴"
                    };
                    let _ = app.emit_to(
                        "overlay",
                        "asr-event",
                        json!({ "kind": "copied", "message": hint, "detail": error }),
                    );
                }
                Err(error) => {
                    let _ = app.emit_to(
                        "overlay",
                        "asr-event",
                        json!({ "kind": "error", "message": error }),
                    );
                }
            },
            Err(error) => {
                let _ = app.emit_to(
                    "overlay",
                    "asr-event",
                    json!({ "kind": "error", "message": error }),
                );
            }
        }
        if let Ok(mut session) = session_slot.lock() {
            *session = None;
        }
    });
    Ok(())
}

#[tauri::command]
async fn send_audio(
    request: tauri::ipc::Request<'_>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(pcm) = request.body() else {
        return Err("音频数据格式无效".to_owned());
    };
    let sender = state
        .session
        .lock()
        .map_err(|_| "听写状态已损坏，请重启应用".to_owned())?
        .clone()
        .ok_or_else(|| "当前没有进行中的听写".to_owned())?;
    sender
        .send(AudioCommand::Data(pcm.clone()))
        .await
        .map_err(|_| "语音连接已关闭".to_owned())
}

#[tauri::command]
async fn finish_recognition(state: State<'_, AppState>) -> Result<(), String> {
    let sender = state
        .session
        .lock()
        .map_err(|_| "听写状态已损坏，请重启应用".to_owned())?
        .clone()
        .ok_or_else(|| "当前没有进行中的听写".to_owned())?;
    sender
        .send(AudioCommand::Finish)
        .await
        .map_err(|_| "语音连接已关闭".to_owned())
}

#[tauri::command]
fn hide_overlay(app: AppHandle) -> Result<(), String> {
    app.get_webview_window("overlay")
        .ok_or_else(|| "找不到悬浮窗".to_owned())?
        .hide()
        .map_err(|error| format!("隐藏悬浮窗失败：{error}"))
}

fn replace_shortcut(app: &AppHandle, shortcut: &str, fallback: &str) -> Result<(), String> {
    let parsed: Shortcut = shortcut
        .parse()
        .map_err(|error| format!("快捷键格式无效：{error}"))?;
    app.global_shortcut()
        .unregister_all()
        .map_err(|error| format!("释放旧快捷键失败：{error}"))?;
    if let Err(error) = app.global_shortcut().register(parsed) {
        if let Ok(old_shortcut) = fallback.parse::<Shortcut>() {
            let _ = app.global_shortcut().register(old_shortcut);
        }
        return Err(format!("快捷键已被其他软件占用或系统不支持：{error}"));
    }
    Ok(())
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

fn setup_app(app: &mut tauri::App) -> Result<(), String> {
    let mut loaded_settings = settings::load(app.handle())?;
    if replace_shortcut(app.handle(), &loaded_settings.shortcut, DEFAULT_SHORTCUT).is_err() {
        loaded_settings.shortcut = DEFAULT_SHORTCUT.to_owned();
        replace_shortcut(app.handle(), DEFAULT_SHORTCUT, DEFAULT_SHORTCUT)?;
        settings::save(app.handle(), &loaded_settings)?;
    }
    *app.state::<AppState>()
        .settings
        .write()
        .map_err(|_| "设置状态已损坏，请重启应用".to_owned())? = loaded_settings;

    let open_settings = MenuItem::with_id(app, "settings", "打开设置", true, None::<&str>)
        .map_err(|error| format!("创建托盘菜单失败：{error}"))?;
    let quit = MenuItem::with_id(app, "quit", "退出 VoicePaste", true, None::<&str>)
        .map_err(|error| format!("创建托盘菜单失败：{error}"))?;
    let menu = Menu::with_items(app, &[&open_settings, &quit])
        .map_err(|error| format!("创建托盘菜单失败：{error}"))?;
    let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("VoicePaste")
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "settings" => show_settings(app),
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)
        .map_err(|error| format!("创建系统托盘失败：{error}"))?;

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
        .manage(AppState::default())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    match show_overlay(app) {
                        Ok(()) => {
                            let _ = app.emit_to("overlay", "shortcut-pressed", ());
                        }
                        Err(error) => {
                            let _ = app.emit_to(
                                "overlay",
                                "asr-event",
                                json!({ "kind": "error", "message": error }),
                            );
                        }
                    }
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
            hide_overlay
        ])
        .run(tauri::generate_context!())
        .expect("VoicePaste 启动失败");
}
