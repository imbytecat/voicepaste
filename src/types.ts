export type ActivationMode = "toggle" | "hold";

export type OverlayPosition = "bottom" | "left" | "right";
export interface LlmSettings {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  streaming: boolean;
  extraParameters: string;
}

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
  llm: LlmSettings;
}

export interface AsrEvent {
  kind:
    | "partial"
    | "final"
    | "processing"
    | "completed"
    | "copied"
    | "empty"
    | "error";
  sessionId: string;
  text?: string;
  message?: string;
}

export interface ShortcutEvent {
  state: "pressed" | "released";
  activationMode: ActivationMode;
  microphoneId: string;
}

export type HotwordSyncState =
  | "empty"
  | "synced"
  | "pending"
  | "disabled"
  | "unknown";

export interface ForeignHotwordTable {
  name: string;
  wordCount: number;
}

export interface HotwordSyncStatus {
  state: HotwordSyncState;
  count: number;
  cloudCount: number;
  limit: number;
  tableId: string | null;
  foreignTables: ForeignHotwordTable[];
}

export type HotwordAction =
  | "created"
  | "updated"
  | "deleted"
  | "unchanged"
  | "none";

export interface HotwordSnapshotResult {
  hotwordStatus: HotwordSyncStatus;
  cloudHotwords: string[];
}

export type SaveSettingsResult =
  | {
      kind: "saved";
      credentialStorage: "keyring" | "removed";
      hotwordStatus: HotwordSyncStatus;
      hotwordAction: HotwordAction;
      cloudHotwords: string[];
      hotwordLimit: number;
    }
  | {
      kind: "conflict";
      credentialStorage: null;
      hotwordStatus: null;
      hotwordAction: null;
      cloudHotwords: string[];
      hotwordLimit: number;
    };

export interface TestDoubaoResult {
  hotwordCount: number;
  hotwordLimit: number;
}

export type ServiceIssueKind =
  | "notActivated"
  | "unauthorized"
  | "rateLimited"
  | "network"
  | "server"
  | "unknown";

export interface ServiceIssueLink {
  label: string;
  target: "speechConsole" | "apiKeyConsole" | "serviceDocs";
}

export interface ServiceIssue {
  kind: ServiceIssueKind;
  title: string;
  detail: string;
  steps: string[];
  links: ServiceIssueLink[];
}

export interface SystemDiagnostics {
  shortcutStatus: string;
  inputReady: boolean;
  inputStatus: string;
  appVersion: string;
  logDir: string;
}

export interface UpdateInfo {
  version: string;
}

export const DEFAULT_LLM_PREFERENCE =
  "保持说话者原意、人称和自然口语，只做必要润色，不要过度书面化。";

export const DEFAULT_SETTINGS: AppSettings = {
  activationMode: "hold",
  apiKey: "",
  hotwords: [],
  hotwordsEnabled: true,
  llm: {
    apiKey: "",
    baseUrl: "https://api.deepseek.com/v1",
    enabled: false,
    model: "deepseek-v4-flash",
    prompt: DEFAULT_LLM_PREFERENCE,
    streaming: true,
    extraParameters: "",
  },
  launchAtStartup: false,
  openSettingsOnStartup: true,
  microphoneId: "",
  onboardingCompleted: false,
  overlayPosition: "bottom",
  shortcut: "CommandOrControl+Shift+Space",
};
