use std::{
    sync::{Arc, Mutex, TryLockError},
    thread,
    time::Duration,
};

use enigo::{
    Direction::{Click, Press, Release},
    Enigo, Key, Keyboard, Settings,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

pub enum PasteOutcome {
    Pasted,
    Copied(String),
}

pub enum InputStatus {
    Uninitialized,
    Pending,
    Ready,
    Unavailable(String),
}

#[derive(Default)]
pub struct InputSession {
    enigo: Mutex<Option<Result<Enigo, String>>>,
}

impl InputSession {
    pub fn initialize(&self) -> Result<(), String> {
        let mut session = self
            .enigo
            .lock()
            .map_err(|_| "远程输入会话已损坏，请重启 VoicePaste".to_owned())?;
        match session.get_or_insert_with(create_enigo) {
            Ok(_) => Ok(()),
            Err(error) => Err(error.clone()),
        }
    }

    pub fn retry(&self) -> Result<(), String> {
        let mut session = self
            .enigo
            .lock()
            .map_err(|_| "远程输入会话已损坏，请重启 VoicePaste".to_owned())?;
        let result = create_enigo();
        let status = result.as_ref().map(|_| ()).map_err(Clone::clone);
        *session = Some(result);
        status
    }

    /// Never blocks: initialize/retry hold the lock while a portal prompt waits for the user.
    pub fn status(&self) -> Result<InputStatus, String> {
        let session = match self.enigo.try_lock() {
            Ok(session) => session,
            Err(TryLockError::WouldBlock) => return Ok(InputStatus::Pending),
            Err(TryLockError::Poisoned(_)) => {
                return Err("远程输入会话已损坏，请重启 VoicePaste".to_owned());
            }
        };
        Ok(match session.as_ref() {
            None => InputStatus::Uninitialized,
            Some(Ok(_)) => InputStatus::Ready,
            Some(Err(error)) => InputStatus::Unavailable(error.clone()),
        })
    }

    fn simulate_paste(&self) -> Result<(), String> {
        let mut session = self
            .enigo
            .lock()
            .map_err(|_| "远程输入会话已损坏，请重启 VoicePaste".to_owned())?;
        let simulated = match session.get_or_insert_with(create_enigo) {
            Ok(enigo) => simulate_paste(enigo),
            Err(error) => return Err(error.clone()),
        };
        if simulated.is_err() {
            // A stopped libei session keeps failing; the next paste or retry rebuilds it.
            *session = None;
        }
        simulated
    }
}

pub async fn paste(
    app: &AppHandle,
    input_session: Arc<InputSession>,
    text: String,
) -> Result<PasteOutcome, String> {
    let previous_text = app.clipboard().read_text().ok();
    app.clipboard()
        .write_text(&text)
        .map_err(|error| format!("写入剪贴板失败：{error}"))?;
    if is_wayland_session() {
        app.get_webview_window("overlay")
            .ok_or_else(|| "找不到悬浮窗".to_owned())?
            .hide()
            .map_err(|error| format!("隐藏悬浮窗失败：{error}"))?;
        tokio::time::sleep(Duration::from_millis(120)).await;
    } else {
        tokio::time::sleep(Duration::from_millis(60)).await;
    }
    match tauri::async_runtime::spawn_blocking(move || input_session.simulate_paste())
        .await
        .map_err(|error| format!("自动粘贴任务失败：{error}"))?
    {
        Ok(()) => {
            if let Some(previous_text) = previous_text {
                let app = app.clone();
                let inserted_text = text.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(Duration::from_millis(450)).await;
                    let clipboard = app.clipboard();
                    if matches!(clipboard.read_text(), Ok(current) if current == inserted_text) {
                        let _ = clipboard.write_text(previous_text);
                    }
                });
            }
            Ok(PasteOutcome::Pasted)
        }
        Err(error) => Ok(PasteOutcome::Copied(error)),
    }
}

pub(crate) fn is_wayland_session() -> bool {
    cfg!(target_os = "linux")
        && wayland_session(
            std::env::var_os("XDG_SESSION_TYPE").as_deref(),
            std::env::var_os("WAYLAND_DISPLAY").as_deref(),
        )
}

fn wayland_session(
    session_type: Option<&std::ffi::OsStr>,
    wayland_display: Option<&std::ffi::OsStr>,
) -> bool {
    match session_type.and_then(std::ffi::OsStr::to_str) {
        Some("x11") => false,
        Some("wayland") => true,
        _ => wayland_display.is_some_and(|display| !display.is_empty()),
    }
}

fn simulate_paste(enigo: &mut Enigo) -> Result<(), String> {
    let modifier = if cfg!(target_os = "macos") {
        Key::Meta
    } else {
        Key::Control
    };

    enigo
        .key(modifier, Press)
        .map_err(|error| format!("按下粘贴修饰键失败：{error}"))?;
    thread::sleep(Duration::from_millis(20));
    let click_result = enigo.key(Key::Unicode('v'), Click);
    thread::sleep(Duration::from_millis(20));
    let release_result = enigo.key(modifier, Release);

    click_result.map_err(|error| format!("触发粘贴键失败：{error}"))?;
    release_result.map_err(|error| format!("释放粘贴修饰键失败：{error}"))?;
    Ok(())
}

#[cfg(not(target_os = "linux"))]
fn create_enigo() -> Result<Enigo, String> {
    Enigo::new(&Settings::default()).map_err(|error| format!("连接系统输入服务失败：{error}"))
}

#[cfg(target_os = "linux")]
fn create_enigo() -> Result<Enigo, String> {
    const DISABLED_DISPLAY: &str = "voicepaste-disabled-display";

    let mut portal_error = None;
    if is_wayland_session() {
        let portal_settings = Settings {
            x11_display: Some(DISABLED_DISPLAY.to_owned()),
            wayland_display: Some(DISABLED_DISPLAY.to_owned()),
            ..Settings::default()
        };
        // The vendored libei backend unwraps every portal step, so only this attempt can panic.
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            Enigo::new(&portal_settings)
        })) {
            Ok(Ok(enigo)) => return Ok(enigo),
            Ok(Err(error)) => portal_error = Some(format!("连接远程桌面门户失败：{error}")),
            Err(payload) => {
                let message = payload
                    .downcast_ref::<String>()
                    .map(String::as_str)
                    .or_else(|| payload.downcast_ref::<&str>().copied())
                    .unwrap_or("");
                portal_error = Some(if message.contains("Cancelled") {
                    "自动粘贴授权被拒绝，请在设置中重试".to_owned()
                } else {
                    "系统未提供远程桌面门户，无法自动粘贴".to_owned()
                });
            }
        }

        let wayland_settings = Settings {
            x11_display: Some(DISABLED_DISPLAY.to_owned()),
            libei_enabled: false,
            ..Settings::default()
        };
        if let Ok(enigo) = Enigo::new(&wayland_settings) {
            return Ok(enigo);
        }
    }

    let x11_settings = Settings {
        wayland_display: Some(DISABLED_DISPLAY.to_owned()),
        libei_enabled: false,
        ..Settings::default()
    };
    Enigo::new(&x11_settings)
        .map_err(|error| portal_error.unwrap_or_else(|| format!("连接系统输入服务失败：{error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_x11_session_never_uses_a_wayland_portal() {
        use std::ffi::OsStr;

        assert!(!wayland_session(Some(OsStr::new("x11")), None));
        assert!(!wayland_session(
            Some(OsStr::new("x11")),
            Some(OsStr::new("wayland-0"))
        ));
        assert!(wayland_session(Some(OsStr::new("wayland")), None));
        assert!(wayland_session(None, Some(OsStr::new("wayland-0"))));
        assert!(!wayland_session(None, Some(OsStr::new(""))));
        assert!(!wayland_session(None, None));
    }

    #[test]
    fn input_status_reflects_cached_initialization() {
        let session = InputSession::default();
        assert!(matches!(
            session.status().unwrap(),
            InputStatus::Uninitialized
        ));

        *session.enigo.lock().unwrap() = Some(Err("授权失败".to_owned()));
        assert!(matches!(
            session.status().unwrap(),
            InputStatus::Unavailable(error) if error == "授权失败"
        ));

        let _held = session.enigo.lock().unwrap();
        assert!(matches!(session.status().unwrap(), InputStatus::Pending));
    }
}
