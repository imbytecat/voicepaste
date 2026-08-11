export const SETTINGS_PATHS = {
  shortcut: "/settings/voice-input",
  recognition: "/settings/recognition",
  processing: "/settings/processing",
  general: "/settings/general",
  diagnostics: "/settings/diagnostics",
  about: "/settings/about",
} as const;

export type SettingsSectionId = keyof typeof SETTINGS_PATHS;

const PATH_SECTIONS: Record<string, SettingsSectionId> = Object.fromEntries(
  Object.entries(SETTINGS_PATHS).map(([section, path]) => [path, section])
) as Record<string, SettingsSectionId>;

export function settingsSectionFromPath(pathname: string): SettingsSectionId {
  return PATH_SECTIONS[pathname] ?? "shortcut";
}
