import {
  formatForDisplay,
  parseHotkey,
  useHotkeyRecorder as useTanStackHotkeyRecorder,
} from "@tanstack/react-hotkeys";
import type { Hotkey } from "@tanstack/react-hotkeys";

const PORTABLE_PRIMARY_MODIFIER = "Mod";
const TAURI_PRIMARY_MODIFIER = "CommandOrControl";
const PORTABLE_SINGLE_KEY_PATTERN = /^F(?:1[3-9]|20)$/;
const PORTABLE_SINGLE_KEY_ERROR =
  "无修饰单键仅支持 F13–F20；其他按键请搭配修饰键";

export function formatShortcut(shortcut: string): string {
  return formatForDisplay(shortcut);
}

export function formatShortcutLabel(shortcut: string): string {
  return formatForDisplay(shortcut, { useSymbols: false });
}
export function shortcutValidationError(shortcut: string): string | null {
  if (!shortcut) return "全局快捷键不能为空";
  const parsed = parseHotkey(shortcut);
  if (
    parsed.modifiers.length > 0 ||
    PORTABLE_SINGLE_KEY_PATTERN.test(parsed.key)
  )
    return null;
  return PORTABLE_SINGLE_KEY_ERROR;
}

export function useShortcutRecorder({
  onRecord,
  onInvalid,
}: {
  onRecord: (shortcut: string) => void;
  onInvalid: (message: string) => void;
}) {
  return useTanStackHotkeyRecorder({
    onRecord: (hotkey) => {
      if (!hotkey) {
        onInvalid("全局快捷键不能为空");
        return;
      }
      const error = shortcutValidationError(hotkey);
      if (error) {
        onInvalid(error);
        return;
      }
      onRecord(toTauriShortcut(hotkey));
    },
  });
}

function toTauriShortcut(hotkey: Hotkey): string {
  return hotkey
    .split("+")
    .map((part) =>
      part === PORTABLE_PRIMARY_MODIFIER ? TAURI_PRIMARY_MODIFIER : part
    )
    .join("+");
}
