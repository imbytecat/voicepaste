use std::sync::{Arc, Mutex};

use tauri::AppHandle;
use tauri::async_runtime::JoinHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

#[derive(Default)]
pub struct ShortcutManager {
    backend_task: Mutex<Option<JoinHandle<()>>>,
}

fn uses_portal() -> bool {
    cfg!(target_os = "linux") && std::env::var_os("WAYLAND_DISPLAY").is_some()
}

impl ShortcutManager {
    pub async fn replace(
        &self,
        app: &AppHandle,
        shortcut: &str,
        previous: Option<&str>,
    ) -> Result<(), String> {
        if uses_portal() {
            #[cfg(target_os = "linux")]
            {
                let task = register_portal(app.clone(), shortcut).await?;
                let old_task = self
                    .backend_task
                    .lock()
                    .map_err(|_| "快捷键状态已损坏，请重启应用".to_owned())?
                    .replace(task);
                if let Some(old_task) = old_task {
                    old_task.abort();
                }
                let _ = app.global_shortcut().unregister_all();
                return Ok(());
            }
        }

        let parsed: Shortcut = shortcut
            .parse()
            .map_err(|error| format!("快捷键格式无效：{error}"))?;
        if previous == Some(shortcut) && app.global_shortcut().is_registered(parsed) {
            return Ok(());
        }
        app.global_shortcut()
            .register(parsed)
            .map_err(|error| format!("快捷键已被其他软件占用或系统不支持：{error}"))?;
        if let Some(previous) = previous.filter(|previous| *previous != shortcut) {
            if let Ok(previous) = previous.parse::<Shortcut>() {
                let _ = app.global_shortcut().unregister(previous);
            }
        }
        if let Some(old_task) = self
            .backend_task
            .lock()
            .map_err(|_| "快捷键状态已损坏，请重启应用".to_owned())?
            .take()
        {
            old_task.abort();
        }
        Ok(())
    }

    pub fn register_initial(self: Arc<Self>, app: AppHandle, shortcut: String) {
        tauri::async_runtime::spawn(async move {
            match self.replace(&app, &shortcut, None).await {
                Ok(()) => crate::set_shortcut_status(&app, "全局快捷键已启用"),
                Err(error) => crate::set_shortcut_status(
                    &app,
                    &format!("保存的快捷键不可用，设置未被改写：{error}"),
                ),
            }
        });
    }
}

#[cfg(target_os = "linux")]
async fn register_portal(app: AppHandle, shortcut: &str) -> Result<JoinHandle<()>, String> {
    use ashpd::desktop::global_shortcuts::{GlobalShortcuts, NewShortcut};
    use futures_util::StreamExt;
    let preferred_trigger = to_xdg_shortcut(shortcut)?;
    let shortcut_id = portal_shortcut_id(shortcut);
    let global_shortcuts = GlobalShortcuts::new()
        .await
        .map_err(|error| format!("连接系统快捷键服务失败：{error}"))?;
    if global_shortcuts.version() == 0 {
        return Err("当前系统不支持全局快捷键".to_owned());
    }
    let session = global_shortcuts
        .create_session(Default::default())
        .await
        .map_err(|error| format!("创建全局快捷键会话失败：{error}"))?;
    let request = global_shortcuts
        .bind_shortcuts(
            &session,
            &[NewShortcut::new(&shortcut_id, "开始或完成 VoicePaste 听写")
                .preferred_trigger(preferred_trigger.as_str())],
            None,
            Default::default(),
        )
        .await
        .map_err(|error| format!("申请全局快捷键失败：{error}"))?;
    let response = request
        .response()
        .map_err(|error| format!("全局快捷键授权失败：{error}"))?;
    let bound = response
        .shortcuts()
        .iter()
        .find(|shortcut| shortcut.id() == shortcut_id)
        .ok_or_else(|| "未获得全局快捷键授权".to_owned())?;
    if bound.trigger_description().is_empty() {
        if global_shortcuts.version() < 2 {
            return Err("请在系统设置中为 VoicePaste 配置全局快捷键".to_owned());
        }
        global_shortcuts
            .configure_shortcuts(&session, None, Default::default())
            .await
            .map_err(|error| format!("打开系统快捷键设置失败：{error}"))?;
        let request = global_shortcuts
            .list_shortcuts(&session, Default::default())
            .await
            .map_err(|error| format!("读取全局快捷键失败：{error}"))?;
        let response = request
            .response()
            .map_err(|error| format!("读取全局快捷键结果失败：{error}"))?;
        let configured = response
            .shortcuts()
            .iter()
            .find(|shortcut| shortcut.id() == shortcut_id)
            .ok_or_else(|| "全局快捷键配置已取消".to_owned())?;
        if configured.trigger_description().is_empty() {
            return Err("全局快捷键配置已取消".to_owned());
        }
    }
    let mut activated = global_shortcuts
        .receive_activated()
        .await
        .map_err(|error| format!("监听全局快捷键按下失败：{error}"))?;
    let mut deactivated = global_shortcuts
        .receive_deactivated()
        .await
        .map_err(|error| format!("监听全局快捷键释放失败：{error}"))?;

    Ok(tauri::async_runtime::spawn(async move {
        let _session = session;
        loop {
            tokio::select! {
                Some(event) = activated.next() => {
                    if event.shortcut_id() == shortcut_id {
                        crate::handle_shortcut_event(&app, true);
                    }
                }
                Some(event) = deactivated.next() => {
                    if event.shortcut_id() == shortcut_id {
                        crate::handle_shortcut_event(&app, false);
                    }
                }
                else => break,
            }
        }
    }))
}

#[cfg(target_os = "linux")]
fn portal_shortcut_id(shortcut: &str) -> String {
    format!(
        "voicepaste-dictation-{}",
        shortcut.to_ascii_lowercase().replace('+', "-")
    )
}

#[cfg(target_os = "linux")]
fn to_xdg_shortcut(shortcut: &str) -> Result<String, String> {
    let mut modifiers = Vec::new();
    let mut key = None;
    for part in shortcut.split('+') {
        match part {
            "CommandOrControl" | "Control" => modifiers.push("CTRL"),
            "Alt" => modifiers.push("ALT"),
            "Shift" => modifiers.push("SHIFT"),
            "Command" | "Super" | "Meta" => modifiers.push("LOGO"),
            value if key.is_none() => key = Some(xdg_key_name(value)),
            _ => return Err("快捷键只能包含一个普通按键".to_owned()),
        }
    }
    let key = key.ok_or_else(|| "快捷键缺少普通按键".to_owned())?;
    modifiers.push(&key);
    Ok(modifiers.join("+"))
}

#[cfg(target_os = "linux")]
fn xdg_key_name(key: &str) -> String {
    match key {
        "Space" => "space".to_owned(),
        "Enter" => "Return".to_owned(),
        "Escape" => "Escape".to_owned(),
        "Backspace" => "BackSpace".to_owned(),
        "ArrowUp" => "Up".to_owned(),
        "ArrowDown" => "Down".to_owned(),
        "ArrowLeft" => "Left".to_owned(),
        "ArrowRight" => "Right".to_owned(),
        value if value.len() == 1 => value.to_ascii_lowercase(),
        value => value.to_owned(),
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    #[test]
    fn converts_tauri_shortcut_to_xdg_syntax() {
        assert_eq!(
            to_xdg_shortcut("CommandOrControl+Shift+Space").unwrap(),
            "CTRL+SHIFT+space"
        );
        assert_eq!(to_xdg_shortcut("Super+Alt+K").unwrap(), "LOGO+ALT+k");
        assert_ne!(
            portal_shortcut_id("Control+Shift+Space"),
            portal_shortcut_id("Control+Alt+0")
        );
    }
}
