export type ActivationMode = "toggle" | "hold";

export type AppSettings = {
  apiKey: string;
  shortcut: string;
  activationMode: ActivationMode;
  microphoneId: string;
  hotwords: string[];
};

export type AsrEvent = {
  kind: "partial" | "final" | "completed" | "copied" | "empty" | "error";
  sessionId: string;
  text?: string;
  message?: string;
};

export type ShortcutEvent = {
  state: "pressed" | "released";
  activationMode: ActivationMode;
  microphoneId: string;
};

export type SaveSettingsResult = {
  credentialStorage: "keyring" | "removed";
  shortcutBackend: "native" | "portal";
};

export type PlatformDiagnostics = {
  platform: string;
  displayServer: string;
  shortcutBackend: string;
  shortcutStatus: string;
  accessibility: "granted" | "denied" | "unsupported";
};

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: "",
  shortcut: "CommandOrControl+Shift+Space",
  activationMode: "toggle",
  microphoneId: "",
  hotwords: [],
};
