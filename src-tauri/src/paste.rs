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
    let previous_text = app.clipboard().read_text().ok();
    app.clipboard()
        .write_text(&text)
        .map_err(|error| format!("写入剪贴板失败：{error}"))?;
    tokio::time::sleep(Duration::from_millis(60)).await;
    match tauri::async_runtime::spawn_blocking(simulate_paste)
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

    let portal_settings = Settings {
        x11_display: Some(DISABLED_DISPLAY.to_owned()),
        wayland_display: Some(DISABLED_DISPLAY.to_owned()),
        ..Settings::default()
    };
    if let Ok(enigo) = Enigo::new(&portal_settings) {
        return Ok(enigo);
    }

    if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        let wayland_settings = Settings {
            x11_display: Some(DISABLED_DISPLAY.to_owned()),
            ..Settings::default()
        };
        if let Ok(enigo) = Enigo::new(&wayland_settings) {
            return Ok(enigo);
        }
    }

    let x11_settings = Settings {
        wayland_display: Some(DISABLED_DISPLAY.to_owned()),
        ..Settings::default()
    };
    Enigo::new(&x11_settings).map_err(|error| format!("连接 Linux 输入服务失败：{error}"))
}
