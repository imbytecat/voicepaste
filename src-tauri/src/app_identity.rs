//! VoicePaste has one identity: `identifier` in `tauri.conf.json`. Tauri applies
//! it to the macOS bundle, the app data directories and single-instance; this
//! module covers the Linux pieces Tauri leaves out, deriving everything from
//! that same identifier and the package info so nothing is spelled twice.
//!
//! Unsandboxed apps have no portal app ID: xdg-desktop-portal infers one from
//! the systemd unit, and launchers produce units such as
//! `app-/path/to/VoicePaste.AppImage@….service`, or `app-VoicePaste@…` from
//! the deb/rpm `VoicePaste.desktop` (Tauri names it after the product name,
//! tauri-apps/tauri#11300). Neither is a valid ID, so GlobalShortcuts refuses
//! with "An app id is required". The portal Registry (xdg-desktop-portal 1.19+)
//! accepts our identifier only when `<identifier>.desktop` exists, so keep a
//! hidden entry under that name, then register before any other portal call.

use std::path::{Path, PathBuf};

use tauri::AppHandle;
use tauri_plugin_log::log;

/// Claims the app identifier on the shared portal connection. Idempotent and
/// best effort: portals without a Registry keep their inferred ID.
pub async fn register_with_portals(app: &AppHandle) {
    static REGISTERED: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
    REGISTERED
        .get_or_init(|| async {
            let identifier = app.config().identifier.as_str();
            if let Err(error) = write_desktop_entry(app, identifier) {
                log::warn!("write {identifier}.desktop failed: {error}");
            }
            let registered = match ashpd::AppID::try_from(identifier) {
                Ok(app_id) => ashpd::register_host_app(app_id)
                    .await
                    .map_err(|error| error.to_string()),
                Err(error) => Err(error.to_string()),
            };
            if let Err(error) = registered {
                log::warn!("register portal app id {identifier} failed: {error}");
            }
        })
        .await;
}

fn write_desktop_entry(app: &AppHandle, identifier: &str) -> Result<(), String> {
    let data_home = std::env::var_os("XDG_DATA_HOME")
        .filter(|dir| !dir.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| Path::new(&home).join(".local/share")))
        .ok_or("HOME is not set")?;
    let dir = data_home.join("applications");
    let path = dir.join(format!("{identifier}.desktop"));
    // AppImages run from a temporary mount; launch through the image itself.
    let exec = match std::env::var_os("APPIMAGE") {
        Some(appimage) => PathBuf::from(appimage),
        None => std::env::current_exe().map_err(|error| error.to_string())?,
    };
    let package = app.package_info();
    let entry = desktop_entry(&package.name, package.crate_name, &exec.to_string_lossy());
    if std::fs::read_to_string(&path).is_ok_and(|current| current == entry) {
        return Ok(());
    }
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    std::fs::write(&path, entry).map_err(|error| error.to_string())
}

/// Hidden (`NoDisplay`): the packages already ship a visible menu entry, and
/// the icon theme name is the binary name the bundles install icons under.
fn desktop_entry(name: &str, icon: &str, exec: &str) -> String {
    // Desktop Entry spec: quoted-argument escapes (\" \` \$ \\) are written
    // through the string-value escape (\\ for each backslash), and % doubles.
    let mut quoted = String::with_capacity(exec.len() + 2);
    quoted.push('"');
    for character in exec.chars() {
        match character {
            '"' | '`' | '$' => quoted.push_str("\\\\"),
            '\\' => quoted.push_str("\\\\\\"),
            '%' => quoted.push('%'),
            _ => {}
        }
        quoted.push(character);
    }
    quoted.push('"');
    format!(
        "[Desktop Entry]\nType=Application\nName={name}\nExec={quoted}\nIcon={icon}\nNoDisplay=true\nTerminal=false\n"
    )
}

#[cfg(test)]
mod tests {
    use super::desktop_entry;

    #[test]
    fn quotes_exec_path_through_both_escape_layers() {
        let entry = desktop_entry(
            "VoicePaste",
            "voicepaste",
            "/home/a b/$x`y\"z\\100%.AppImage",
        );
        let expected = r#"Exec="/home/a b/\\$x\\`y\\"z\\\\100%%.AppImage""#;
        assert!(entry.contains(&format!("{expected}\n")), "{entry}");
        assert!(entry.contains("NoDisplay=true\n"));
    }
}
