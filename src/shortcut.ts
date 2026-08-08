import {
  formatForDisplay,
  parseHotkey,
  useHotkeyRecorder as useTanStackHotkeyRecorder,
  type Hotkey,
} from "@tanstack/react-hotkeys";

const PORTABLE_PRIMARY_MODIFIER = "Mod";
const TAURI_PRIMARY_MODIFIER = "CommandOrControl";

export function formatShortcut(shortcut: string): string {
  return formatForDisplay(shortcut);
}

export function formatShortcutLabel(shortcut: string): string {
  return formatForDisplay(shortcut, { useSymbols: false });
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
      if (!hotkey || parseHotkey(hotkey).modifiers.length === 0) {
        onInvalid("全局快捷键必须包含至少一个修饰键");
        return;
      }
      onRecord(toTauriShortcut(hotkey));
    },
  });
}

function toTauriShortcut(hotkey: Hotkey): string {
  return hotkey
    .split("+")
    .map((part) => (part === PORTABLE_PRIMARY_MODIFIER ? TAURI_PRIMARY_MODIFIER : part))
    .join("+");
}
