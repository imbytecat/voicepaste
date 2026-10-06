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
    | "fallback"
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

export interface ForeignHotwordTable {
  name: string;
  wordCount: number;
}

export interface HotwordSyncResult {
  hotwords: string[];
  limit: number;
  foreignTables: ForeignHotwordTable[];
}

export interface TestRecognitionResult {
  provider: RecognitionProvider;
  providerRevision: number;
  accountRevision: number;
}

export type ServiceIssueKind =
  | "notActivated"
  | "unauthorized"
  | "rateLimited"
  | "network"
  | "server"
  | "loginRequired"
  | "credentialStorage"
  | "busy"
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
  shortcutReady: boolean;
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
