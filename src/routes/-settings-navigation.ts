import type { SettingsSectionId } from "../components/Settings";

export const SETTINGS_PATHS = {
  about: "/settings/about",
  diagnostics: "/settings/diagnostics",
  general: "/settings/general",
  recognition: "/settings/recognition",
  shortcut: "/settings/voice-input",
} as const satisfies Record<SettingsSectionId, string>;

const PATH_SECTIONS: Record<string, SettingsSectionId> = Object.fromEntries(
  Object.entries(SETTINGS_PATHS).map(([section, path]) => [path, section])
) as Record<string, SettingsSectionId>;

export function settingsSectionFromPath(pathname: string): SettingsSectionId {
  return PATH_SECTIONS[pathname] ?? "general";
}
