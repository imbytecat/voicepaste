export type ActivationMode = "toggle" | "hold";

export type OverlayPosition = "bottom" | "left" | "right";

export interface AppSettings {
  apiKey: string;
  shortcut: string;
  activationMode: ActivationMode;
  microphoneId: string;
  hotwords: string[];
  hotwordsEnabled: boolean;
  onboardingCompleted: boolean;
  launchAtStartup: boolean;
  openSettingsOnStartup: boolean;
  overlayPosition: OverlayPosition;
}

export interface AsrEvent {
  kind: "partial" | "final" | "completed" | "copied" | "empty" | "error";
  sessionId: string;
  text?: string;
  message?: string;
}

export interface ShortcutEvent {
  state: "pressed" | "released";
  activationMode: ActivationMode;
  microphoneId: string;
}

export interface SaveSettingsResult {
  credentialStorage: "keyring" | "removed";
}

export interface SystemDiagnostics {
  shortcutStatus: string;
  inputReady: boolean;
  inputStatus: string;
  appVersion: string;
  logDir: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  activationMode: "toggle",
  apiKey: "",
  hotwords: [],
  hotwordsEnabled: true,
  launchAtStartup: false,
  openSettingsOnStartup: true,
  microphoneId: "",
  onboardingCompleted: false,
  overlayPosition: "bottom",
  shortcut: "CommandOrControl+Shift+Space",
};
