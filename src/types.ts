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

export type RecognitionProvider = "volcengine" | "doubaoIme";

export interface VolcengineSettings {
  apiKey: string;
  hotwords: string[];
  hotwordsEnabled: boolean;
  hotwordDraft: string[] | null;
  llm: LlmSettings;
}

export interface DoubaoImeSettings {
  smartOrganize: boolean;
  disablePunctuation: boolean;
  disablePersonalWords: boolean;
  llm: LlmSettings;
}

export interface RecognitionSettings {
  provider: RecognitionProvider;
  volcengine: VolcengineSettings;
  doubaoIme: DoubaoImeSettings;
}

export interface AccountStatus {
  state: "guest" | "signingIn" | "signedIn" | "expired" | "unavailable";
  nickname: string | null;
  message: string | null;
  revision: number;
}

export interface AppSettings {
  recognition: RecognitionSettings;
  shortcut: string;
  activationMode: ActivationMode;
  microphoneId: string;
  onboardingCompleted: boolean;
  launchAtStartup: boolean;
  openSettingsOnStartup: boolean;
  overlayPosition: OverlayPosition;
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
  | "confirming"
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
  reviewToken: string;
  confirmedHotwords: string[];
  hotwordDraft: string[] | null;
}

export type SaveSettingsResult =
  | {
      kind: "saved";
      credentialStorage: "keyring" | "removed";
      hotwordStatus: HotwordSyncStatus | null;
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
      reviewToken: string;
    };

export interface TestRecognitionResult {
  provider: RecognitionProvider;
  providerRevision: number;
  accountRevision: number;
  hotwordStatus: HotwordSyncStatus | null;
  warning: string | null;
}

export type ServiceIssueKind =
  | "notActivated"
  | "unauthorized"
  | "rateLimited"
  | "network"
  | "server"
  | "loginRequired"
  | "credentialStorage"
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

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  apiKey: "",
  baseUrl: "",
  enabled: false,
  model: "",
  prompt: DEFAULT_LLM_PREFERENCE,
  streaming: true,
  extraParameters: "",
};

export const DEFAULT_SETTINGS: AppSettings = {
  activationMode: "hold",
  recognition: {
    provider: "doubaoIme",
    volcengine: {
      apiKey: "",
      hotwords: [],
      hotwordDraft: null,
      hotwordsEnabled: false,
      llm: { ...DEFAULT_LLM_SETTINGS },
    },
    doubaoIme: {
      smartOrganize: false,
      disablePunctuation: false,
      disablePersonalWords: false,
      llm: { ...DEFAULT_LLM_SETTINGS },
    },
  },
  launchAtStartup: false,
  openSettingsOnStartup: true,
  microphoneId: "",
  onboardingCompleted: false,
  overlayPosition: "bottom",
  shortcut: "CommandOrControl+Shift+Space",
};
