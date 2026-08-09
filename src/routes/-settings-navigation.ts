import type { SettingsSectionId } from "../components/Settings";

export const SETTINGS_PATHS = {
  general: "/settings/general",
  shortcut: "/settings/voice-input",
  recognition: "/settings/recognition",
  diagnostics: "/settings/diagnostics",
  about: "/settings/about",
} as const satisfies Record<SettingsSectionId, string>;

const PATH_SECTIONS: Record<string, SettingsSectionId> = Object.fromEntries(
  Object.entries(SETTINGS_PATHS).map(([section, path]) => [path, section]),
) as Record<string, SettingsSectionId>;

export function settingsSectionFromPath(pathname: string): SettingsSectionId {
  return PATH_SECTIONS[pathname] ?? "general";
}
