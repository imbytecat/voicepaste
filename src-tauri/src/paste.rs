use std::{thread, time::Duration};

use enigo::{
    Direction::{Click, Press, Release},
    Enigo, Key, Keyboard, Settings,
};
use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;

pub enum PasteOutcome {
    Pasted,
    Copied(String),
}

pub async fn paste(app: &AppHandle, text: String) -> Result<PasteOutcome, String> {
    app.clipboard()
        .write_text(text)
        .map_err(|error| format!("写入剪贴板失败：{error}"))?;
    tokio::time::sleep(Duration::from_millis(60)).await;
    match tauri::async_runtime::spawn_blocking(simulate_paste)
        .await
        .map_err(|error| format!("自动粘贴任务失败：{error}"))?
    {
        Ok(()) => Ok(PasteOutcome::Pasted),
        Err(error) => Ok(PasteOutcome::Copied(error)),
    }
}

fn simulate_paste() -> Result<(), String> {
    let mut enigo = create_enigo()?;
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

    let mut portal_settings = Settings::default();
    portal_settings.x11_display = Some(DISABLED_DISPLAY.to_owned());
    portal_settings.wayland_display = Some(DISABLED_DISPLAY.to_owned());
    if let Ok(enigo) = Enigo::new(&portal_settings) {
        return Ok(enigo);
    }

    if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        let mut wayland_settings = Settings::default();
        wayland_settings.x11_display = Some(DISABLED_DISPLAY.to_owned());
        if let Ok(enigo) = Enigo::new(&wayland_settings) {
            return Ok(enigo);
        }
    }

    let mut x11_settings = Settings::default();
    x11_settings.wayland_display = Some(DISABLED_DISPLAY.to_owned());
    Enigo::new(&x11_settings).map_err(|error| format!("连接 Linux 输入服务失败：{error}"))
}
