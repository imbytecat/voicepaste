import { Link } from "@tanstack/react-router";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Activity,
  AudioWaveform,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Command,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  Info,
  Mic,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { Toaster, toast } from "sonner";

import { AudioCapture } from "@/audio";
import type { MicrophoneDevice } from "@/audio";
import {
  hotwordActionMessage,
  hotwordChip,
  hotwordDiff,
  normalizeHotwords,
  uniqueHotwords,
} from "@/hotwords";
import { SETTINGS_PATHS } from "@/routes/-settings-navigation";
import type { SettingsSectionId } from "@/routes/-settings-navigation";
import {
  formatShortcut,
  formatShortcutLabel,
  useShortcutRecorder,
} from "@/shortcut";
import { DEFAULT_LLM_PREFERENCE, DEFAULT_SETTINGS } from "@/types";
import type {
  AppSettings,
  HotwordSnapshotResult,
  HotwordSyncStatus,
  SaveSettingsResult,
  ServiceIssue,
  ServiceIssueLink,
  SystemDiagnostics,
  TestDoubaoResult,
  UpdateInfo,
} from "@/types";

const INPUT_CLASS =
  "h-9 w-full rounded-lg border border-[#d7d9de] bg-white px-3 text-[12px] text-[#202124] outline-none transition focus:border-[#7564e8] focus:ring-3 focus:ring-[#7564e8]/10 disabled:cursor-not-allowed disabled:bg-[#f5f5f6] disabled:text-[#8b8f97]";
const PRIMARY_BUTTON_CLASS =
  "flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg border-0 bg-[#6558e8] px-4 text-[11px] font-medium text-white transition hover:bg-[#584bcf] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#7564e8] disabled:cursor-not-allowed disabled:opacity-55";
const SECONDARY_BUTTON_CLASS =
  "flex h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-[#d7d9de] bg-white px-3 text-[10px] font-medium text-[#555962] transition hover:bg-[#f5f5f6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7564e8] disabled:cursor-not-allowed disabled:opacity-55";
const TEXT_BUTTON_CLASS =
  "cursor-pointer border-0 bg-transparent p-0 text-[10px] font-medium text-[#6558e8] hover:text-[#4f43bd] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7564e8] disabled:cursor-default disabled:text-[#9a9da4]";
const CONSOLE_URL = "https://console.volcengine.com/speech/new/setting/apikeys";
const SECTIONS = [
  ["general", "通用", Settings2],
  ["shortcut", "语音输入", Command],
  ["recognition", "识别与词汇", Sparkles],
  ["diagnostics", "权限与状态", ShieldCheck],
  ["about", "关于", Info],
] as const;
const SECTION_DESCRIPTIONS: Record<SettingsSectionId, string> = {
  about: "查看版本、更新和支持信息",
  diagnostics: "检查系统权限与输入状态",
  general: "管理启动行为和悬浮窗位置",
  recognition: "配置语音识别、常用词和文本处理",
  shortcut: "调整快捷键、触发方式和麦克风",
};
const ONBOARDING_STEPS = [
  "欢迎",
  "识别服务",
  "快捷键",
  "麦克风",
  "完成",
] as const;
const DEFAULT_HOTWORD_STATUS: HotwordSyncStatus = {
  cloudCount: 0,
  count: 0,
  foreignTables: [],
  limit: 5000,
  state: "empty",
  tableId: null,
};
const HOTWORD_CHIP_CLASS = {
  dirty: "bg-[#fff2cc] text-[#7a5100]",
  error: "bg-[#fff0ee] text-[#8d261f]",
  neutral: "bg-[#f0f1f3] text-[#666a73]",
  synced: "bg-[#eaf8f1] text-[#17633f]",
  syncing: "bg-[#efedff] text-[#5748ca]",
};
const HOTWORD_DIFF_PREVIEW = 6;
const RESERVED_LLM_PARAMETERS = [
  "model",
  "messages",
  "stream",
  "stream_options",
] as const;
const CUSTOM_LLM_PARAMETER_PRESET = "custom";
const LLM_PARAMETER_PRESETS = [
  {
    description: "不附加额外请求参数，由服务和模型决定是否思考。",
    id: "default",
    label: "使用服务默认参数",
    parameters: "",
  },
  {
    description: "发送 thinking.type=disabled。",
    id: "deepseek-no-thinking",
    label: "DeepSeek · 关闭思考",
    parameters: `{
  "thinking": {
    "type": "disabled"
  }
}`,
  },
  {
    description: "发送 enable_thinking=false；仅适用于混合思考模型。",
    id: "qwen-no-thinking",
    label: "Qwen · 关闭思考",
    parameters: `{
  "enable_thinking": false
}`,
  },
  {
    description: "发送 reasoning_effort=none；模型不支持时可能忽略或拒绝。",
    id: "reasoning-effort-none",
    label: "OpenAI / Gemini 2.5 / Ollama · 关闭推理",
    parameters: `{
  "reasoning_effort": "none"
}`,
  },
  {
    description: "发送 reasoning.effort=none；强制推理模型无法关闭。",
    id: "openrouter-no-reasoning",
    label: "OpenRouter · 关闭推理",
    parameters: `{
  "reasoning": {
    "effort": "none"
  }
}`,
  },
] as const;

type Message = { kind: "success" | "error" | "info"; text: string } | null;
interface LoadSettingsResult {
  settings: AppSettings;
  hotwordStatus: HotwordSyncStatus;
  notice?: string;
}
interface HotwordConflict {
  cloudHotwords: string[];
  pendingSettings: AppSettings;
  source: "onboarding" | "settings";
}
type SavedSettingsResult = Extract<SaveSettingsResult, { kind: "saved" }>;
type ProductLinkTarget =
  | "homepage"
  | "help"
  | "privacy"
  | ServiceIssueLink["target"];

const TRANSIENT_MESSAGE_DURATION = 2200;
const SETTINGS_TOAST_ID = "settings-feedback";

type SettingsSectionRenderer = (section: SettingsSectionId) => ReactNode;

const SettingsOutletContext = createContext<SettingsSectionRenderer | null>(
  null
);

function SettingsRouteSection({
  section,
}: {
  section: SettingsSectionId;
}): ReactNode {
  const renderSection = useContext(SettingsOutletContext);
  if (!renderSection)
    throw new Error("Settings route must render inside the settings layout");
  return renderSection(section);
}

export function GeneralSettingsPage() {
  return <SettingsRouteSection section="general" />;
}

export function VoiceInputSettingsPage() {
  return <SettingsRouteSection section="shortcut" />;
}

export function RecognitionSettingsPage() {
  return <SettingsRouteSection section="recognition" />;
}

export function DiagnosticsSettingsPage() {
  return <SettingsRouteSection section="diagnostics" />;
}

export function AboutSettingsPage() {
  return <SettingsRouteSection section="about" />;
}

function ShortcutHint({ shortcut }: { shortcut: string }) {
  return (
    <kbd
      aria-label={formatShortcutLabel(shortcut)}
      className="rounded-md border border-[#c8cdd7] bg-white px-1.5 py-1 font-sans text-[10px] leading-none font-semibold text-[#3d4454] shadow-[0_1px_0_#bfc4ce]"
    >
      {formatShortcut(shortcut)}
    </kbd>
  );
}

function llmSettingsChanged(
  current: AppSettings["llm"],
  saved: AppSettings["llm"]
): boolean {
  return (
    current.enabled !== saved.enabled ||
    current.baseUrl !== saved.baseUrl ||
    current.apiKey !== saved.apiKey ||
    current.model !== saved.model ||
    current.prompt !== saved.prompt ||
    current.streaming !== saved.streaming ||
    current.extraParameters !== saved.extraParameters
  );
}

function normalizeJson(value: string): string {
  if (!value.trim()) return "";
  try {
    const parsed: unknown = JSON.parse(value);
    return JSON.stringify(parsed) ?? value.trim();
  } catch {
    return value.trim();
  }
}

function detectLlmParameterPreset(parameters: string): string {
  const normalized = normalizeJson(parameters);
  return (
    LLM_PARAMETER_PRESETS.find(
      (preset) => normalizeJson(preset.parameters) === normalized
    )?.id ?? CUSTOM_LLM_PARAMETER_PRESET
  );
}

function llmParameterError(parameters: string): string | null {
  if (!parameters.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(parameters);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return "必须输入一个 JSON 对象";
    const reserved = RESERVED_LLM_PARAMETERS.find((key) => key in parsed);
    return reserved ? `不能覆盖 ${reserved}` : null;
  } catch (error) {
    return `JSON 格式错误：${String(error)}`;
  }
}

function settingsChanged(
  current: AppSettings,
  hotwordsText: string,
  saved: AppSettings,
  savedHotwordsText: string
): boolean {
  return (
    current.apiKey !== saved.apiKey ||
    current.shortcut !== saved.shortcut ||
    current.activationMode !== saved.activationMode ||
    current.microphoneId !== saved.microphoneId ||
    current.onboardingCompleted !== saved.onboardingCompleted ||
    current.hotwordsEnabled !== saved.hotwordsEnabled ||
    current.launchAtStartup !== saved.launchAtStartup ||
    current.openSettingsOnStartup !== saved.openSettingsOnStartup ||
    current.overlayPosition !== saved.overlayPosition ||
    llmSettingsChanged(current.llm, saved.llm) ||
    hotwordsText !== savedHotwordsText
  );
}

function safeError(error: unknown, ...secrets: string[]): string {
  let detail = String(error);
  for (const value of secrets) {
    const secret = value.trim();
    if (secret.length >= 4) detail = detail.split(secret).join("••••••••");
  }
  return detail;
}

async function persistSettings(
  nextSettings: AppSettings,
  forceHotwordOverwrite = false
): Promise<SaveSettingsResult> {
  if (isTauri())
    return await invoke<SaveSettingsResult>("save_settings", {
      forceHotwordOverwrite,
      settings: nextSettings,
    });
  const cloudHotwords = nextSettings.hotwords;
  return {
    cloudHotwords,
    credentialStorage: nextSettings.apiKey ? "keyring" : "removed",
    hotwordAction: cloudHotwords.length ? "updated" : "none",
    hotwordLimit: DEFAULT_HOTWORD_STATUS.limit,
    hotwordStatus: {
      cloudCount: cloudHotwords.length,
      count: cloudHotwords.length,
      foreignTables: [],
      limit: DEFAULT_HOTWORD_STATUS.limit,
      state: cloudHotwords.length
        ? nextSettings.hotwordsEnabled
          ? "synced"
          : "disabled"
        : "empty",
      tableId: null,
    },
    kind: "saved",
  };
}

function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-6" id={id}>
      <div className="mb-3 px-1">
        <h2 className="text-[14px] font-semibold text-[#202124]">{title}</h2>
        <p className="mt-1 text-[11px] leading-5 text-[#62666f]">
          {description}
        </p>
      </div>
      <div className="divide-y divide-[#ececef] overflow-hidden rounded-xl border border-[#e1e2e6] bg-white">
        {children}
      </div>
    </section>
  );
}

function SettingRow({
  title,
  description,
  children,
  changed = false,
  vertical = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  changed?: boolean;
  vertical?: boolean;
}) {
  return (
    <div
      className={
        vertical
          ? "px-5 py-4.5"
          : "flex min-h-16.5 items-center justify-between gap-8 px-5 py-3.5 max-[800px]:items-start"
      }
    >
      <div className={vertical ? "" : "min-w-0 flex-1"}>
        <div className="flex items-center gap-2">
          <h3 className="text-[12px] font-medium text-[#2c2e33]">{title}</h3>
          {changed ? (
            <span className="rounded-full bg-[#fff2cc] px-1.5 py-0.5 text-[8px] font-medium text-[#7a5100]">
              已修改
            </span>
          ) : null}
        </div>
        {description ? (
          <p className="mt-1 text-[11px] leading-5 text-[#6f737b]">
            {description}
          </p>
        ) : null}
      </div>
      <div className={vertical ? "mt-3" : "min-w-0 shrink-0"}>{children}</div>
    </div>
  );
}

function Feedback({
  message,
  className,
}: {
  message: Message;
  className?: string;
}) {
  if (!message) return null;
  const colors =
    message.kind === "success"
      ? "border-[#a9d8c4] bg-[#eaf8f1] text-[#17633f]"
      : message.kind === "error"
        ? "border-[#e8b7b0] bg-[#fff0ee] text-[#8d261f]"
        : "border-[#c9c2f5] bg-[#f3f0ff] text-[#5142a8]";
  return (
    <div
      className={`rounded-[10px] border px-3.5 py-2.5 text-[11px] leading-5 ${colors} ${className ?? ""}`}
      role={message.kind === "error" ? "alert" : "status"}
      aria-live={message.kind === "error" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      {message.text}
    </div>
  );
}

function isServiceIssue(payload: unknown): payload is ServiceIssue {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "kind" in payload &&
    "title" in payload &&
    "steps" in payload
  );
}

function ServiceIssueCard({
  issue,
  onOpenLink,
  className,
}: {
  issue: ServiceIssue;
  onOpenLink: (target: ServiceIssueLink["target"]) => void;
  className?: string;
}) {
  const warning = issue.kind === "notActivated";
  return (
    <section
      className={`rounded-[10px] border px-3.5 py-2.5 text-[11px] leading-5 ${warning ? "border-[#e8b7b0] bg-[#fff0ee] text-[#8d261f]" : "border-[#c9c2f5] bg-[#f3f0ff] text-[#5142a8]"} ${className ?? ""}`}
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
    >
      <div className="flex items-start gap-3">
        <div
          className={`grid size-9 shrink-0 place-items-center rounded-[10px] ${warning ? "bg-[#fff2cc] text-[#7a5100]" : "bg-white text-[#5142a8]"}`}
          aria-hidden="true"
        >
          <Info size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[12px] font-semibold">{issue.title}</h3>
          {issue.steps.length > 0 ? (
            <ol className="mt-1.5 list-decimal pl-4">
              {issue.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          ) : (
            <p className="mt-1.5">{issue.detail}</p>
          )}
          {issue.links.length > 0 ? (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {issue.links.map((link) => (
                <button
                  className={SECONDARY_BUTTON_CLASS}
                  key={link.target}
                  type="button"
                  onClick={() => {
                    onOpenLink(link.target);
                  }}
                >
                  <ExternalLink size={11} /> {link.label}
                </button>
              ))}
            </div>
          ) : null}
          {issue.steps.length > 0 ? (
            <details className="mt-2.5">
              <summary className="cursor-pointer text-[10px]">技术详情</summary>
              <p className="mt-1 text-[10px] leading-4 wrap-break-word">
                {issue.detail}
              </p>
            </details>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      className={`relative h-6 w-11 cursor-pointer rounded-full border-0 transition focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#7564e8] ${checked ? "bg-[#6558e8]" : "bg-[#cfd2d8]"}`}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => {
        onChange(!checked);
      }}
    >
      <span
        className={`absolute top-0.5 size-5 rounded-full bg-white shadow-[0_1px_3px_rgba(24,28,36,0.24)] transition-[left] ${checked ? "left-[22px]" : "left-0.5"}`}
        aria-hidden="true"
      />
    </button>
  );
}
function describeHotwords(words: string[]): string {
  const preview = words.slice(0, HOTWORD_DIFF_PREVIEW).join("、");
  return words.length > HOTWORD_DIFF_PREVIEW
    ? `${preview} 等 ${words.length} 个`
    : preview;
}

function HotwordConflictDialog({
  conflict,
  onCancel,
  onUseCloud,
  onOverwriteCloud,
}: {
  conflict: HotwordConflict;
  onCancel: () => void;
  onUseCloud: () => void;
  onOverwriteCloud: () => void;
}) {
  const primaryButtonRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    primaryButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onCancel]);
  const { onlyCloud, onlyLocal } = hotwordDiff(
    conflict.pendingSettings.hotwords,
    conflict.cloudHotwords
  );

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[#202124]/35 p-5"
      role="presentation"
    >
      <section
        className="w-full max-w-105 rounded-2xl border border-[#dedfe4] bg-white p-5 shadow-[0_24px_72px_rgba(22,25,34,0.24)]"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="hotword-conflict-title"
        aria-describedby="hotword-conflict-description"
      >
        <div className="flex items-start gap-3">
          <div
            className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[#fff2cc] text-[#7a5100]"
            aria-hidden="true"
          >
            <Info size={17} />
          </div>
          <div>
            <h2
              className="text-[14px] font-semibold text-[#202124]"
              id="hotword-conflict-title"
            >
              云端常用词已被修改
            </h2>
            <div
              className="mt-1.5 text-[11px] leading-5 text-[#62666f]"
              id="hotword-conflict-description"
            >
              <p>
                云端多出 {onlyCloud.length} 个词，本机多出 {onlyLocal.length}{" "}
                个词。请选择保留哪个版本。
              </p>
              {onlyCloud.length > 0 ? (
                <p className="mt-1.5 text-[10px] text-[#6f737b]">
                  云端多出：{describeHotwords(onlyCloud)}
                </p>
              ) : null}
              {onlyLocal.length > 0 ? (
                <p className="mt-1 text-[10px] text-[#6f737b]">
                  本机多出：{describeHotwords(onlyLocal)}
                </p>
              ) : null}
            </div>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            className={SECONDARY_BUTTON_CLASS}
            type="button"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            className={SECONDARY_BUTTON_CLASS}
            type="button"
            onClick={onOverwriteCloud}
          >
            用本机覆盖云端
          </button>
          <button
            ref={primaryButtonRef}
            className={PRIMARY_BUTTON_CLASS}
            type="button"
            onClick={onUseCloud}
          >
            用云端替换本机
          </button>
        </div>
      </section>
    </div>
  );
}

function microphoneTestError(error: unknown): string {
  const detail = String(error);
  return /permission|notallowederror|denied/iu.test(detail)
    ? "麦克风权限未开启。请在系统设置中允许 VoicePaste 使用麦克风，然后重试。"
    : `麦克风测试失败：${detail}`;
}

function stopCaptureIgnoringErrors(capture: AudioCapture): void {
  void capture.stop().catch(() => {});
}

export function Settings({
  activeSection,
  children,
  onSelectSection,
  previewOnboarding = false,
}: {
  activeSection: SettingsSectionId;
  children?: ReactNode;
  onSelectSection: (section: SettingsSectionId) => void;
  previewOnboarding?: boolean;
}) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [hotwordsText, setHotwordsText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hotwordStatus, setHotwordStatus] = useState<HotwordSyncStatus>(
    DEFAULT_HOTWORD_STATUS
  );
  const [hotwordConflict, setHotwordConflict] =
    useState<HotwordConflict | null>(null);
  const [hotwordSyncFailed, setHotwordSyncFailed] = useState(false);
  const [cloudHotwords, setCloudHotwords] = useState<string[]>([]);
  const [checkingHotwords, setCheckingHotwords] = useState(false);
  const [hotwordMessage, setHotwordMessage] = useState<Message>(null);
  const [message, setMessage] = useState<Message>(null);
  const [doubaoMessage, setDoubaoMessage] = useState<Message>(null);
  const [doubaoIssue, setDoubaoIssue] = useState<ServiceIssue | null>(null);
  const [microphoneMessage, setMicrophoneMessage] = useState<Message>(null);
  const [onboardingMessage, setOnboardingMessage] = useState<Message>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showLlmApiKey, setShowLlmApiKey] = useState(false);
  const [editingCustomLlmParameters, setEditingCustomLlmParameters] =
    useState(false);
  const [availableLlmModels, setAvailableLlmModels] = useState<string[]>([]);
  const [loadingLlmModels, setLoadingLlmModels] = useState(false);
  const [llmModelsMessage, setLlmModelsMessage] = useState<Message>(null);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [verifiedApiKey, setVerifiedApiKey] = useState("");
  const [microphones, setMicrophones] = useState<MicrophoneDevice[]>([]);
  const [testingMicrophone, setTestingMicrophone] = useState(false);
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [testingDoubao, setTestingDoubao] = useState(false);
  const [diagnostics, setDiagnostics] = useState<SystemDiagnostics | null>(
    null
  );
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);

  const settingsRef = useRef<AppSettings>(DEFAULT_SETTINGS);
  const hotwordsTextRef = useRef("");
  const savedSettingsRef = useRef<AppSettings>(DEFAULT_SETTINGS);
  const savedHotwordsTextRef = useRef("");
  const dirtyRef = useRef<boolean | null>(null);
  const savingRef = useRef(false);
  const microphoneTestRef = useRef<AudioCapture | null>(null);
  const shortcutButtonRef = useRef<HTMLButtonElement | null>(null);
  const onboardingHeadingRef = useRef<HTMLHeadingElement | null>(null);

  const showMessage = useCallback((nextMessage: NonNullable<Message>) => {
    if (nextMessage.kind === "error") {
      toast.dismiss(SETTINGS_TOAST_ID);
      setMessage(nextMessage);
      return;
    }
    setMessage(null);
    const options = {
      duration: TRANSIENT_MESSAGE_DURATION,
      id: SETTINGS_TOAST_ID,
    };
    if (nextMessage.kind === "success")
      toast.success(nextMessage.text, options);
    else toast.info(nextMessage.text, options);
  }, []);

  const reportPersistentError = useCallback(
    (text: string) => {
      if (settingsRef.current.onboardingCompleted)
        showMessage({ kind: "error", text });
      else setOnboardingMessage({ kind: "error", text });
    },
    [showMessage]
  );

  const syncDirty = useCallback(
    (dirty: boolean) => {
      if (dirtyRef.current === dirty) return;
      dirtyRef.current = dirty;
      if (!isTauri()) return;
      void invoke("set_settings_dirty", { dirty }).catch((error: unknown) => {
        dirtyRef.current = null;
        reportPersistentError(
          `同步未保存状态失败：${safeError(error, settingsRef.current.apiKey, settingsRef.current.llm.apiKey)}`
        );
      });
    },
    [reportPersistentError]
  );

  const updateSetting = <Key extends keyof AppSettings>(
    key: Key,
    value: AppSettings[Key]
  ) => {
    const next = { ...settingsRef.current, [key]: value };
    settingsRef.current = next;
    setSettings(next);
    if (key === "apiKey" || key === "hotwordsEnabled")
      setHotwordSyncFailed(false);
    syncDirty(
      settingsChanged(
        next,
        hotwordsTextRef.current,
        savedSettingsRef.current,
        savedHotwordsTextRef.current
      )
    );
  };
  const updateLlmSetting = <Key extends keyof AppSettings["llm"]>(
    key: Key,
    value: AppSettings["llm"][Key]
  ) => {
    updateSetting("llm", { ...settingsRef.current.llm, [key]: value });
  };

  const updateHotwordsText = (value: string) => {
    hotwordsTextRef.current = value;
    setHotwordsText(value);
    setHotwordSyncFailed(false);
    syncDirty(
      settingsChanged(
        settingsRef.current,
        value,
        savedSettingsRef.current,
        savedHotwordsTextRef.current
      )
    );
  };

  const selectSection = useCallback(
    (section: SettingsSectionId) => {
      toast.dismiss(SETTINGS_TOAST_ID);
      onSelectSection(section);
    },
    [onSelectSection]
  );

  const goToOnboardingStep = (step: number) => {
    setOnboardingMessage(null);
    setMicrophoneMessage(null);
    setOnboardingStep(step);
  };

  const shortcutRecorder = useShortcutRecorder({
    onInvalid: (text) => {
      if (settingsRef.current.onboardingCompleted)
        showMessage({ kind: "error", text });
      else setOnboardingMessage({ kind: "error", text });
      shortcutButtonRef.current?.blur();
    },
    onRecord: (shortcut) => {
      updateSetting("shortcut", shortcut);
      setMessage(null);
      setOnboardingMessage(null);
      shortcutButtonRef.current?.blur();
    },
  });

  const refreshMicrophones = useCallback(async () => {
    try {
      setMicrophones(await AudioCapture.devices());
    } catch (error) {
      setMicrophones([]);
      setMicrophoneMessage({
        kind: "error",
        text: `读取麦克风列表失败：${String(error)}`,
      });
    }
  }, []);

  const refreshDiagnostics = useCallback(async () => {
    if (!isTauri()) return;
    try {
      setDiagnostics(await invoke<SystemDiagnostics>("system_diagnostics"));
    } catch (error) {
      reportPersistentError(
        safeError(
          error,
          settingsRef.current.apiKey,
          settingsRef.current.llm.apiKey
        )
      );
    }
  }, [reportPersistentError]);

  const refreshHotwords = useCallback(async () => {
    if (!isTauri()) return;
    setCheckingHotwords(true);
    setHotwordStatus((current) => ({ ...current, state: "unknown" }));
    try {
      const snapshot = await invoke<HotwordSnapshotResult>("refresh_hotwords");
      setHotwordStatus(snapshot.hotwordStatus);
      setCloudHotwords(snapshot.cloudHotwords);
      setHotwordSyncFailed(false);
      setHotwordMessage(null);
    } catch (error) {
      setHotwordSyncFailed(true);
      setHotwordMessage({
        kind: "error",
        text: `无法校验云端词表：${safeError(error, settingsRef.current.apiKey, settingsRef.current.llm.apiKey)}`,
      });
    } finally {
      setCheckingHotwords(false);
    }
  }, []);

  const checkForUpdate = useCallback(
    async (showResult: boolean) => {
      if (!isTauri()) {
        if (showResult)
          showMessage({
            kind: "error",
            text: "浏览器预览无法检查桌面应用更新",
          });
        return;
      }
      setCheckingUpdate(true);
      try {
        const update = await invoke<UpdateInfo | null>("check_for_update");
        setUpdateInfo(update);
        if (showResult)
          showMessage({
            kind: "info",
            text: update ? `发现新版本 ${update.version}` : "当前已是最新版本",
          });
      } catch (error) {
        if (showResult)
          showMessage({
            kind: "error",
            text: safeError(
              error,
              settingsRef.current.apiKey,
              settingsRef.current.llm.apiKey
            ),
          });
      } finally {
        setCheckingUpdate(false);
      }
    },
    [showMessage]
  );

  const installUpdate = async () => {
    if (!updateInfo || installingUpdate) return;
    if (
      settingsChanged(
        settingsRef.current,
        hotwordsTextRef.current,
        savedSettingsRef.current,
        savedHotwordsTextRef.current
      )
    ) {
      showMessage({ kind: "error", text: "请先保存当前设置，再安装更新" });
      return;
    }
    setInstallingUpdate(true);
    setMessage(null);
    try {
      const started = await invoke<boolean>("install_update");
      if (!started) setInstallingUpdate(false);
    } catch (error) {
      showMessage({
        kind: "error",
        text: safeError(
          error,
          settingsRef.current.apiKey,
          settingsRef.current.llm.apiKey
        ),
      });
      setInstallingUpdate(false);
    }
  };

  useEffect(() => {
    void refreshMicrophones();
    if (!isTauri()) {
      const previewSettings = {
        ...DEFAULT_SETTINGS,
        onboardingCompleted: !previewOnboarding,
      };
      const previewHotwords = previewSettings.hotwords.join("\n");
      settingsRef.current = previewSettings;
      savedSettingsRef.current = previewSettings;
      hotwordsTextRef.current = previewHotwords;
      savedHotwordsTextRef.current = previewHotwords;
      setSettings(previewSettings);
      setHotwordsText(previewHotwords);
      setHotwordStatus(DEFAULT_HOTWORD_STATUS);
      syncDirty(false);
      setLoading(false);
      return;
    }

    invoke<LoadSettingsResult>("load_settings")
      .then(
        ({
          hotwordStatus: loadedHotwordStatus,
          settings: loadedSettings,
          notice,
        }) => {
          const loadedHotwords = loadedSettings.hotwords.join("\n");
          settingsRef.current = loadedSettings;
          savedSettingsRef.current = loadedSettings;
          hotwordsTextRef.current = loadedHotwords;
          savedHotwordsTextRef.current = loadedHotwords;
          setSettings(loadedSettings);
          setHotwordsText(loadedHotwords);
          setHotwordStatus(loadedHotwordStatus);
          syncDirty(loadedHotwordStatus.state === "pending");
          if (notice) showMessage({ kind: "info", text: notice });
          void refreshDiagnostics();
        }
      )
      .catch((error: unknown) => {
        setOnboardingMessage({ kind: "error", text: safeError(error) });
      })
      .finally(() => {
        setLoading(false);
      });
  }, [
    previewOnboarding,
    refreshDiagnostics,
    refreshMicrophones,
    showMessage,
    syncDirty,
  ]);

  useEffect(() => {
    void checkForUpdate(false);
  }, [checkForUpdate]);

  useEffect(() => {
    if (activeSection !== "recognition") return;
    void refreshHotwords();
  }, [activeSection, refreshHotwords]);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listen<string>("settings-section", (event) => {
      if (event.payload !== "about") return;
      selectSection("about");
    })
      .then((callback) => {
        if (disposed) callback();
        else unlisten = callback;
      })
      .catch((error: unknown) => {
        reportPersistentError(
          safeError(
            error,
            settingsRef.current.apiKey,
            settingsRef.current.llm.apiKey
          )
        );
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [reportPersistentError, selectSection]);

  useEffect(() => {
    if (settings.onboardingCompleted) return;
    window.requestAnimationFrame(() => onboardingHeadingRef.current?.focus());
  }, [onboardingStep, settings.onboardingCompleted]);

  useEffect(
    () => () => {
      toast.dismiss(SETTINGS_TOAST_ID);
      const capture = microphoneTestRef.current;
      microphoneTestRef.current = null;
      if (capture) stopCaptureIgnoringErrors(capture);
    },
    []
  );

  const commitSettings = (
    nextSettings: AppSettings,
    nextHotwordsText: string
  ) => {
    settingsRef.current = nextSettings;
    savedSettingsRef.current = nextSettings;
    hotwordsTextRef.current = nextHotwordsText;
    savedHotwordsTextRef.current = nextHotwordsText;
    setSettings(nextSettings);
    setHotwordsText(nextHotwordsText);
    syncDirty(false);
  };

  const startSaving = () => {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    return true;
  };

  const stopSaving = () => {
    savingRef.current = false;
    setSaving(false);
  };

  const cloudHotwordsChanged = () =>
    settingsRef.current.apiKey !== savedSettingsRef.current.apiKey ||
    hotwordsTextRef.current !== savedHotwordsTextRef.current;

  const persistAndCommit = async (
    nextSettings: AppSettings,
    source: HotwordConflict["source"],
    forceHotwordOverwrite = false
  ): Promise<SavedSettingsResult | null> => {
    const result = await persistSettings(nextSettings, forceHotwordOverwrite);
    setCloudHotwords(result.cloudHotwords);
    if (result.kind === "conflict") {
      setHotwordConflict({
        cloudHotwords: result.cloudHotwords,
        pendingSettings: nextSettings,
        source,
      });
      return null;
    }
    commitSettings(nextSettings, nextSettings.hotwords.join("\n"));
    setHotwordStatus(result.hotwordStatus);
    setHotwordSyncFailed(false);
    setHotwordMessage(null);
    return result;
  };

  const finishSuccessfulSave = async (
    source: HotwordConflict["source"],
    result: SavedSettingsResult
  ) => {
    if (source === "onboarding") {
      selectSection("general");
      setShowApiKey(false);
      showMessage({
        kind: "success",
        text: "设置完成，可以开始使用 VoicePaste",
      });
    } else
      showMessage({
        kind: "success",
        text: hotwordActionMessage(
          result.hotwordAction,
          result.hotwordStatus.cloudCount
        ),
      });
    await refreshDiagnostics();
  };

  const save = async () => {
    if (!startSaving()) return;
    setMessage(null);
    setOnboardingMessage(null);
    try {
      const hotwords = normalizeHotwords(
        hotwordsTextRef.current,
        hotwordStatus.limit
      );
      const nextSettings = { ...settingsRef.current, hotwords };
      const saved = await persistAndCommit(nextSettings, "settings");
      if (saved) await finishSuccessfulSave("settings", saved);
    } catch (error) {
      if (cloudHotwordsChanged()) setHotwordSyncFailed(true);
      if (isServiceIssue(error)) {
        setDoubaoMessage(null);
        setDoubaoIssue(error);
      } else
        reportPersistentError(
          safeError(
            error,
            settingsRef.current.apiKey,
            settingsRef.current.llm.apiKey
          )
        );
    } finally {
      stopSaving();
    }
  };

  const resolveHotwordConflict = async (useCloud: boolean) => {
    const conflict = hotwordConflict;
    if (!conflict || !startSaving()) return;
    setHotwordConflict(null);
    const nextSettings = {
      ...conflict.pendingSettings,
      hotwords: useCloud
        ? conflict.cloudHotwords
        : conflict.pendingSettings.hotwords,
    };
    try {
      const saved = await persistAndCommit(nextSettings, conflict.source, true);
      if (saved) await finishSuccessfulSave(conflict.source, saved);
    } catch (error) {
      setHotwordSyncFailed(true);
      reportPersistentError(
        safeError(
          error,
          conflict.pendingSettings.apiKey,
          conflict.pendingSettings.llm.apiKey
        )
      );
    } finally {
      stopSaving();
    }
  };

  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLocaleLowerCase() !== "s"
      )
        return;
      event.preventDefault();
      void save();
    };
    window.addEventListener("keydown", handleSaveShortcut);
    return () => {
      window.removeEventListener("keydown", handleSaveShortcut);
    };
  });

  const resetVoiceInput = async () => {
    if (!startSaving()) return;
    setMessage(null);
    const persistedReset = {
      ...savedSettingsRef.current,
      activationMode: DEFAULT_SETTINGS.activationMode,
      microphoneId: DEFAULT_SETTINGS.microphoneId,
      shortcut: DEFAULT_SETTINGS.shortcut,
    };
    try {
      const result = await persistSettings(persistedReset);
      setCloudHotwords(result.cloudHotwords);
      if (result.kind === "conflict") {
        setHotwordConflict({
          cloudHotwords: result.cloudHotwords,
          pendingSettings: persistedReset,
          source: "settings",
        });
        return;
      }
      setHotwordStatus(result.hotwordStatus);
      const nextCurrent = {
        ...settingsRef.current,
        activationMode: DEFAULT_SETTINGS.activationMode,
        microphoneId: DEFAULT_SETTINGS.microphoneId,
        shortcut: DEFAULT_SETTINGS.shortcut,
      };
      savedSettingsRef.current = persistedReset;
      settingsRef.current = nextCurrent;
      setSettings(nextCurrent);
      setMicrophoneLevel(0);
      setMicrophoneMessage(null);
      syncDirty(
        settingsChanged(
          nextCurrent,
          hotwordsTextRef.current,
          persistedReset,
          savedHotwordsTextRef.current
        )
      );
      showMessage({ kind: "success", text: "已恢复并保存“语音输入”默认设置" });
      await refreshDiagnostics();
    } catch (error) {
      showMessage({
        kind: "error",
        text: safeError(
          error,
          settingsRef.current.apiKey,
          settingsRef.current.llm.apiKey
        ),
      });
    } finally {
      stopSaving();
    }
  };

  const clearHotwords = () => {
    updateSetting("hotwords", []);
    updateHotwordsText("");
    showMessage({
      kind: "info",
      text: "已清空常用词，保存后将删除云端词表。",
    });
  };

  const startMicrophoneTest = async () => {
    if (microphoneTestRef.current) return;
    setTestingMicrophone(true);
    setMicrophoneLevel(0);
    setMicrophoneMessage(null);
    const capture = new AudioCapture(
      settingsRef.current.microphoneId,
      setMicrophoneLevel,
      (error) => {
        if (microphoneTestRef.current !== capture) return;
        microphoneTestRef.current = null;
        setMicrophoneLevel(0);
        setMicrophoneMessage({
          kind: "error",
          text: microphoneTestError(error),
        });
        setTestingMicrophone(false);
        stopCaptureIgnoringErrors(capture);
      },
      (reason) => {
        if (microphoneTestRef.current !== capture) return;
        microphoneTestRef.current = null;
        setMicrophoneLevel(0);
        setMicrophoneMessage({ kind: "info", text: reason });
        setTestingMicrophone(false);
        stopCaptureIgnoringErrors(capture);
      }
    );
    microphoneTestRef.current = capture;
    try {
      await capture.start();
    } catch (error) {
      if (microphoneTestRef.current === capture)
        microphoneTestRef.current = null;
      await capture.stop().catch(() => {});
      setMicrophoneMessage({ kind: "error", text: microphoneTestError(error) });
      setTestingMicrophone(false);
    }
  };

  const stopMicrophoneTest = async () => {
    const capture = microphoneTestRef.current;
    if (!capture) return;
    microphoneTestRef.current = null;
    try {
      await capture.stop();
      await Promise.all([refreshMicrophones(), refreshDiagnostics()]);
      setMicrophoneMessage({ kind: "info", text: "麦克风测试已停止" });
    } catch (error) {
      setMicrophoneMessage({
        kind: "error",
        text: `停止麦克风测试失败：${String(error)}`,
      });
    } finally {
      setMicrophoneLevel(0);
      setTestingMicrophone(false);
    }
  };

  const toggleMicrophoneTest = () => {
    void (microphoneTestRef.current
      ? stopMicrophoneTest()
      : startMicrophoneTest());
  };

  useEffect(() => {
    if (activeSection === "shortcut") return;
    const capture = microphoneTestRef.current;
    if (!capture) return;
    microphoneTestRef.current = null;
    stopCaptureIgnoringErrors(capture);
    setMicrophoneLevel(0);
    setTestingMicrophone(false);
    setMicrophoneMessage({
      kind: "info",
      text: "离开语音输入后，麦克风测试已自动停止",
    });
  }, [activeSection]);

  const testDoubao = async (
    setFeedback: (message: Message) => void = setDoubaoMessage
  ) => {
    setTestingDoubao(true);
    setFeedback(null);
    const apiKey = settingsRef.current.apiKey.trim();
    try {
      if (!apiKey) throw new Error("请先填写豆包 API Key");
      if (!isTauri()) throw new Error("浏览器预览无法测试豆包连接");
      const result = await invoke<TestDoubaoResult>("test_doubao", { apiKey });
      setVerifiedApiKey(apiKey);
      setDoubaoIssue(null);
      setHotwordStatus((current) => ({
        ...current,
        limit: result.hotwordLimit,
      }));
      setHotwordSyncFailed(false);
      setFeedback({
        kind: "success",
        text: `语音识别与常用词同步可用（云端 ${result.hotwordCount}/${result.hotwordLimit}）`,
      });
      return true;
    } catch (error) {
      setVerifiedApiKey("");
      if (isServiceIssue(error)) {
        setFeedback(null);
        setDoubaoIssue(error);
        return false;
      }
      setDoubaoIssue(null);
      setFeedback({
        kind: "error",
        text: `豆包连接失败：${safeError(error, apiKey)}`,
      });
      return false;
    } finally {
      setTestingDoubao(false);
    }
  };

  const finishOnboarding = async () => {
    const apiKey = settingsRef.current.apiKey.trim();
    if (!apiKey) {
      setOnboardingMessage({
        kind: "error",
        text: "请返回识别服务步骤填写并测试 API Key。",
      });
      return;
    }
    if (verifiedApiKey !== apiKey) {
      setOnboardingMessage({
        kind: "error",
        text: "API Key 已修改，请返回识别服务步骤重新测试。",
      });
      return;
    }
    if (!startSaving()) return;
    setOnboardingMessage(null);
    try {
      const hotwords = normalizeHotwords(
        hotwordsTextRef.current,
        hotwordStatus.limit
      );
      const nextSettings = {
        ...settingsRef.current,
        apiKey,
        hotwords,
        onboardingCompleted: true,
      };
      const saved = await persistAndCommit(nextSettings, "onboarding");
      if (saved) await finishSuccessfulSave("onboarding", saved);
    } catch (error) {
      if (isServiceIssue(error)) {
        setOnboardingMessage(null);
        setDoubaoIssue(error);
      } else
        setOnboardingMessage({ kind: "error", text: safeError(error, apiKey) });
      if (cloudHotwordsChanged()) setHotwordSyncFailed(true);
    } finally {
      stopSaving();
    }
  };

  const openConsole = async () => {
    try {
      if (isTauri()) await invoke("open_api_key_console");
      else window.open(CONSOLE_URL, "_blank", "noopener,noreferrer");
    } catch (error) {
      reportPersistentError(
        safeError(
          error,
          settingsRef.current.apiKey,
          settingsRef.current.llm.apiKey
        )
      );
    }
  };
  const fetchLlmModels = async () => {
    const { apiKey, baseUrl } = settingsRef.current.llm;
    setLlmModelsMessage(null);
    if (!baseUrl.trim()) {
      setLlmModelsMessage({
        kind: "error",
        text: "请先填写 API 基础地址。",
      });
      return;
    }
    setLoadingLlmModels(true);
    try {
      if (!isTauri()) throw new Error("获取模型仅在 VoicePaste 桌面版中可用");
      const models = await invoke<string[]>("list_llm_models", {
        apiKey,
        baseUrl,
      });
      setAvailableLlmModels(models);
      setLlmModelsMessage({
        kind: "success",
        text: `已获取 ${models.length} 个模型，可在输入框中选择或继续手动填写。`,
      });
    } catch (error) {
      setAvailableLlmModels([]);
      setLlmModelsMessage({
        kind: "error",
        text: safeError(error, apiKey),
      });
    } finally {
      setLoadingLlmModels(false);
    }
  };

  const runAboutAction = async (
    command: "open_log_dir" | "copy_diagnostics",
    successText?: string
  ) => {
    setMessage(null);
    try {
      if (!isTauri()) throw new Error("此操作仅在 VoicePaste 桌面版中可用");
      await invoke(command);
      if (successText) showMessage({ kind: "success", text: successText });
    } catch (error) {
      showMessage({
        kind: "error",
        text: safeError(
          error,
          settingsRef.current.apiKey,
          settingsRef.current.llm.apiKey
        ),
      });
    }
  };

  const openProductLink = async (target: ProductLinkTarget) => {
    setMessage(null);
    try {
      if (!isTauri()) throw new Error("此链接仅在 VoicePaste 桌面版中打开");
      await invoke("open_product_link", { target });
    } catch (error) {
      showMessage({
        kind: "error",
        text: safeError(
          error,
          settingsRef.current.apiKey,
          settingsRef.current.llm.apiKey
        ),
      });
    }
  };

  const settingsToaster = (
    <Toaster
      position="top-right"
      offset={{ right: 32, top: 84 }}
      duration={TRANSIENT_MESSAGE_DURATION}
      visibleToasts={1}
      expand={false}
      containerAriaLabel="设置反馈"
      toastOptions={{ className: "font-sans text-[11px]" }}
    />
  );

  const microphoneStatus =
    microphones.length > 0
      ? `原生采集可用（${microphones.length} 个设备）`
      : "未检测到麦克风";
  const versionTitle = diagnostics
    ? `VoicePaste ${diagnostics.appVersion}`
    : "VoicePaste";
  const isSettingChanged = (key: keyof AppSettings) =>
    settings[key] !== savedSettingsRef.current[key];
  const isLlmSettingChanged = (key: keyof AppSettings["llm"]) =>
    settings.llm[key] !== savedSettingsRef.current.llm[key];
  const llmChanged = llmSettingsChanged(
    settings.llm,
    savedSettingsRef.current.llm
  );
  const detectedLlmParameterPreset = detectLlmParameterPreset(
    settings.llm.extraParameters
  );
  const selectedLlmParameterPreset = detectedLlmParameterPreset;
  const selectedLlmParameterPresetDetails = LLM_PARAMETER_PRESETS.find(
    (preset) => preset.id === selectedLlmParameterPreset
  );
  const customLlmParameterError = llmParameterError(
    settings.llm.extraParameters
  );
  const hotwordsChanged = hotwordsText !== savedHotwordsTextRef.current;
  const localHotwords = uniqueHotwords(hotwordsText);
  const cloudDirty = isSettingChanged("apiKey") || hotwordsChanged;
  const hotwordChipState = hotwordChip({
    cloud: cloudHotwords,
    failed: hotwordSyncFailed,
    local: localHotwords,
    state: hotwordStatus.state,
    syncing: saving && cloudDirty,
  });
  const hasUnsavedChanges =
    hotwordStatus.state === "pending" ||
    settingsChanged(
      settings,
      hotwordsText,
      savedSettingsRef.current,
      savedHotwordsTextRef.current
    );
  const isSectionChanged = (section: SettingsSectionId) => {
    if (section === "general")
      return (
        isSettingChanged("launchAtStartup") ||
        isSettingChanged("openSettingsOnStartup") ||
        isSettingChanged("overlayPosition")
      );
    if (section === "shortcut")
      return (
        isSettingChanged("activationMode") ||
        isSettingChanged("shortcut") ||
        isSettingChanged("microphoneId")
      );
    if (section === "recognition")
      return (
        hotwordStatus.state === "pending" ||
        isSettingChanged("apiKey") ||
        isSettingChanged("hotwordsEnabled") ||
        llmChanged ||
        hotwordsChanged
      );
    return false;
  };
  const hotwordConflictDialog = hotwordConflict ? (
    <HotwordConflictDialog
      conflict={hotwordConflict}
      onCancel={() => {
        setHotwordConflict(null);
      }}
      onOverwriteCloud={() => {
        void resolveHotwordConflict(false);
      }}
      onUseCloud={() => {
        void resolveHotwordConflict(true);
      }}
    />
  ) : null;

  function renderSection(section: SettingsSectionId): ReactNode {
    switch (section) {
      case "general": {
        return (
          <SettingsSection
            id="general"
            title="通用"
            description="控制 VoicePaste 的启动方式和悬浮窗位置。"
          >
            <SettingRow
              title="开机启动"
              description="登录系统后自动启动 VoicePaste，并在托盘中等待。"
              changed={isSettingChanged("launchAtStartup")}
            >
              <Toggle
                checked={settings.launchAtStartup}
                onChange={(checked) => {
                  updateSetting("launchAtStartup", checked);
                }}
                label="开机启动"
              />
            </SettingRow>
            <SettingRow
              title="启动时打开窗口"
              description="启动 VoicePaste 时显示设置窗口；关闭后仅在托盘中运行。"
              changed={isSettingChanged("openSettingsOnStartup")}
            >
              <Toggle
                checked={settings.openSettingsOnStartup}
                onChange={(checked) => {
                  updateSetting("openSettingsOnStartup", checked);
                }}
                label="启动时打开窗口"
              />
            </SettingRow>
            <SettingRow
              title="悬浮窗位置"
              description="选择听写状态悬浮窗出现的屏幕边缘。"
              changed={isSettingChanged("overlayPosition")}
            >
              <div
                className="grid w-102.5 grid-cols-3 gap-1 rounded-lg bg-[#f0f1f3] p-1 max-[800px]:w-90"
                role="radiogroup"
                aria-label="悬浮窗位置"
              >
                {(
                  [
                    ["bottom", "底部"],
                    ["left", "左侧"],
                    ["right", "右侧"],
                  ] as const
                ).map(([value, label]) => {
                  const selected = settings.overlayPosition === value;
                  return (
                    <button
                      key={value}
                      className={`h-7 cursor-pointer rounded-md border-0 text-[10px] font-medium transition focus-visible:outline-2 focus-visible:outline-[#7564e8] ${
                        selected
                          ? "bg-white text-[#4f43bd] shadow-[0_1px_3px_rgba(25,28,36,0.12)]"
                          : "bg-transparent text-[#62666f]"
                      }`}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => {
                        updateSetting("overlayPosition", value);
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </SettingRow>
          </SettingsSection>
        );
      }
      case "shortcut": {
        return (
          <>
            {settings.apiKey ? null : (
              <div
                className="mb-5 flex items-center justify-between gap-4 rounded-lg border border-[#ead9b7] bg-[#fff8ea] px-3.5 py-2.5 text-[10px] text-[#6d511e]"
                role="status"
              >
                <span>开始听写前，需要先配置语音识别服务。</span>
                <button
                  className="shrink-0 cursor-pointer border-0 bg-transparent p-0 font-medium text-[#5748ca] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7564e8]"
                  type="button"
                  onClick={() => {
                    selectSection("recognition");
                  }}
                >
                  前往配置
                </button>
              </div>
            )}
            <SettingsSection
              id="shortcut"
              title="语音输入"
              description="在任意输入框按快捷键开始说话。"
            >
              <SettingRow
                title="触发方式"
                description="选择快捷键按下后的行为。"
                changed={isSettingChanged("activationMode")}
              >
                <div
                  className="grid w-71.5 grid-cols-2 rounded-lg bg-[#f0f1f3] p-1"
                  role="radiogroup"
                  aria-label="听写触发方式"
                >
                  {(
                    [
                      ["toggle", "按一下切换"],
                      ["hold", "按住说话"],
                    ] as const
                  ).map(([value, label]) => {
                    const selected = settings.activationMode === value;
                    return (
                      <button
                        key={value}
                        className={`h-7 cursor-pointer rounded-md border-0 text-[10px] font-medium transition focus-visible:outline-2 focus-visible:outline-[#7564e8] ${
                          selected
                            ? "bg-white text-[#4f43bd] shadow-[0_1px_3px_rgba(25,28,36,0.12)]"
                            : "bg-transparent text-[#62666f]"
                        }`}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => {
                          updateSetting("activationMode", value);
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </SettingRow>

              <SettingRow
                title="全局快捷键"
                description="点击右侧快捷键，然后按下新的按键或组合键；也支持 F13–F20 单键。"
                changed={isSettingChanged("shortcut")}
              >
                <button
                  ref={shortcutButtonRef}
                  className={`h-9 min-w-46 cursor-pointer rounded-lg border px-3 font-mono text-[10px] outline-none ${
                    shortcutRecorder.isRecording
                      ? "border-[#8f83e8] bg-[#f1efff] text-[#5748ca] ring-3 ring-[#7564e8]/10"
                      : "border-[#d7d9de] bg-white text-[#3f434b] hover:bg-[#f8f8f9] focus-visible:ring-3 focus-visible:ring-[#7564e8]/10"
                  }`}
                  type="button"
                  onClick={() => {
                    setMessage(null);
                    shortcutRecorder.startRecording();
                  }}
                  onBlur={shortcutRecorder.cancelRecording}
                >
                  {shortcutRecorder.isRecording ? (
                    "请按新的按键或组合键…"
                  ) : (
                    <ShortcutHint shortcut={settings.shortcut} />
                  )}
                </button>
              </SettingRow>

              <SettingRow
                title="麦克风"
                description="默认使用系统当前选择的输入设备。"
                changed={isSettingChanged("microphoneId")}
              >
                <div className="w-102.5 max-[800px]:w-90">
                  <div className="flex gap-2">
                    <select
                      className={INPUT_CLASS}
                      aria-label="麦克风"
                      value={settings.microphoneId}
                      onChange={(event) => {
                        updateSetting("microphoneId", event.target.value);
                        setMicrophoneMessage(null);
                      }}
                      disabled={testingMicrophone}
                    >
                      <option value="">系统默认麦克风</option>
                      {microphones.map((device) => (
                        <option key={device.id} value={device.id}>
                          {device.label}
                        </option>
                      ))}
                    </select>
                    <button
                      className={SECONDARY_BUTTON_CLASS}
                      type="button"
                      aria-pressed={testingMicrophone}
                      onClick={toggleMicrophoneTest}
                    >
                      <Mic size={11} />{" "}
                      {testingMicrophone ? "停止测试" : "开始测试"}
                    </button>
                  </div>
                  <div
                    className="mt-2 h-1 overflow-hidden rounded-full bg-[#ececef]"
                    role="meter"
                    aria-label="麦克风音量"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(microphoneLevel * 100)}
                  >
                    <div
                      className="h-full rounded-full bg-[#6558e8] transition-[width] duration-75"
                      style={{
                        width: `${Math.max(testingMicrophone ? 3 : 0, microphoneLevel * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </SettingRow>
              {microphoneMessage ? (
                <div className="px-5 py-3">
                  <Feedback message={microphoneMessage} />
                </div>
              ) : null}
            </SettingsSection>
          </>
        );
      }
      case "recognition": {
        return (
          <>
            <SettingsSection
              id="recognition"
              title="识别与词汇"
              description="配置识别服务，并提高人名和专业词汇的准确率。"
            >
              <SettingRow
                title="豆包 API Key"
                description="从火山引擎控制台获取，用于语音识别和云端常用词同步。"
                changed={isSettingChanged("apiKey")}
              >
                <div className="w-102.5 max-[800px]:w-90">
                  <div className="flex h-9 items-center overflow-hidden rounded-lg border border-[#d7d9de] bg-white transition focus-within:border-[#7564e8] focus-within:ring-3 focus-within:ring-[#7564e8]/10">
                    <input
                      className="min-w-0 flex-1 border-0 bg-transparent px-3 text-[12px] text-[#202124] outline-none disabled:cursor-not-allowed disabled:bg-[#f5f5f6]"
                      type={showApiKey ? "text" : "password"}
                      value={settings.apiKey}
                      onChange={(event) => {
                        updateSetting("apiKey", event.target.value);
                        setVerifiedApiKey("");
                        setDoubaoMessage(null);
                        setDoubaoIssue(null);
                      }}
                      placeholder="粘贴 API Key"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button
                      className="mr-1 grid size-7 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-[#777b84] hover:bg-[#f1f1f3] focus-visible:outline-2 focus-visible:outline-[#7564e8]"
                      type="button"
                      onClick={() => {
                        setShowApiKey(!showApiKey);
                      }}
                      aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                      title={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                    >
                      {showApiKey ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-end gap-3">
                    <button
                      className="cursor-pointer border-0 bg-transparent p-0 text-[10px] text-[#6558e8] hover:text-[#4f43bd] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7564e8]"
                      type="button"
                      onClick={() => void openConsole()}
                    >
                      <span className="flex items-center gap-1">
                        获取 API Key <ExternalLink size={10} />
                      </span>
                    </button>
                    <button
                      className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-[#d7d9de] bg-white px-2.5 text-[10px] font-medium text-[#555962] hover:bg-[#f5f5f6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7564e8] disabled:cursor-wait disabled:opacity-55"
                      type="button"
                      onClick={() => void testDoubao()}
                      disabled={testingDoubao || !settings.apiKey.trim()}
                    >
                      <Activity size={11} />{" "}
                      {testingDoubao ? "连接中…" : "测试连接"}
                    </button>
                  </div>
                </div>
              </SettingRow>
              {doubaoMessage ? (
                <div className="px-5 py-3">
                  <Feedback message={doubaoMessage} />
                </div>
              ) : null}
              {doubaoIssue ? (
                <div className="px-5 py-3">
                  <ServiceIssueCard
                    issue={doubaoIssue}
                    onOpenLink={(target) => {
                      void openProductLink(target);
                    }}
                  />
                </div>
              ) : null}
              <SettingRow
                title="启用常用词"
                description="关闭后保留云端词表，但听写时不使用。"
                changed={isSettingChanged("hotwordsEnabled")}
              >
                <Toggle
                  checked={settings.hotwordsEnabled}
                  onChange={(checked) => {
                    updateSetting("hotwordsEnabled", checked);
                  }}
                  label="启用常用词"
                />
              </SettingRow>
              <SettingRow
                title="常用词"
                description="保存时同步到火山引擎，用于提高人名、产品名和专业术语的识别准确率。"
                vertical
                changed={hotwordsChanged}
              >
                <div className="mb-2.5 flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${HOTWORD_CHIP_CLASS[hotwordChipState.tone]}`}
                    role="status"
                    aria-live="polite"
                  >
                    {hotwordChipState.label}
                  </span>
                  <span className="text-[9px] text-[#666a73]">
                    本机 {localHotwords.length} · 云端 {cloudHotwords.length}
                  </span>
                  <span className="text-[9px] text-[#666a73]">
                    上限 {hotwordStatus.limit}
                  </span>
                  <button
                    className={`ml-auto ${TEXT_BUTTON_CLASS}`}
                    type="button"
                    onClick={() => void refreshHotwords()}
                    disabled={checkingHotwords}
                  >
                    {checkingHotwords ? "检查中…" : "重新检查"}
                  </button>
                  <button
                    className={TEXT_BUTTON_CLASS}
                    type="button"
                    onClick={clearHotwords}
                    disabled={!settings.hotwordsEnabled || !hotwordsText.trim()}
                  >
                    清空
                  </button>
                </div>
                <textarea
                  className="min-h-32 w-full resize-y rounded-lg border border-[#d7d9de] bg-white px-3 py-2.5 text-[12px] leading-6 text-[#202124] transition outline-none focus:border-[#7564e8] focus:ring-3 focus:ring-[#7564e8]/10 disabled:cursor-not-allowed disabled:bg-[#f5f5f6]"
                  value={hotwordsText}
                  onChange={(event) => {
                    updateHotwordsText(event.target.value);
                  }}
                  disabled={!settings.hotwordsEnabled}
                  placeholder={"VoicePaste\nTauri\nTanStack"}
                  rows={6}
                />
                <p className="mt-2 text-[9px] leading-4 text-[#666a73]">
                  每行一个词，不支持词内空格；词表会保存在火山引擎。听写仍保持实时流式返回。
                </p>
              </SettingRow>
              {hotwordMessage ? (
                <div className="px-5 py-3">
                  <Feedback message={hotwordMessage} />
                </div>
              ) : null}
              {hotwordStatus.foreignTables.length > 0 ? (
                <SettingRow
                  title="火山引擎上的其它词表"
                  description={`账号里还有 ${hotwordStatus.foreignTables.length} 张 VoicePaste 未管理的词表，识别时不会使用。需要清理请前往火山引擎控制台。`}
                  vertical
                >
                  <ul className="mb-2.5 flex flex-col gap-1">
                    {hotwordStatus.foreignTables.map((table) => (
                      <li
                        className="text-[10px] leading-5 text-[#6f737b]"
                        key={table.name}
                      >
                        {table.name}（{table.wordCount} 词）
                      </li>
                    ))}
                  </ul>
                  <div className="flex">
                    <button
                      className={SECONDARY_BUTTON_CLASS}
                      type="button"
                      onClick={() => void openConsole()}
                    >
                      <ExternalLink size={11} /> 打开控制台
                    </button>
                  </div>
                </SettingRow>
              ) : null}
            </SettingsSection>

            <SettingsSection
              id="llm-postprocessing"
              title="LLM 后处理"
              description="使用 OpenAI 兼容服务校对或改写识别文本，并可流式预览结果。"
            >
              <SettingRow
                title="启用 LLM 后处理"
                description="识别完成后将文本发送到已配置的 LLM 服务；通常会增加数秒等待时间。"
                changed={isLlmSettingChanged("enabled")}
              >
                <Toggle
                  checked={settings.llm.enabled}
                  onChange={(checked) => {
                    updateLlmSetting("enabled", checked);
                  }}
                  label="启用 LLM 后处理"
                />
              </SettingRow>
              {settings.llm.enabled ? (
                <>
                  <SettingRow
                    title="API 基础地址"
                    description="填写服务提供方给出的 OpenAI 兼容地址。"
                    changed={isLlmSettingChanged("baseUrl")}
                  >
                    <div className="w-102.5 max-[800px]:w-90">
                      <input
                        aria-label="LLM API 基础地址"
                        className="h-9 w-full rounded-lg border border-[#d7d9de] bg-white px-3 text-[11px] text-[#202124] transition outline-none focus:border-[#7564e8] focus:ring-3 focus:ring-[#7564e8]/10"
                        type="url"
                        value={settings.llm.baseUrl}
                        onChange={(event) => {
                          updateLlmSetting("baseUrl", event.target.value);
                          setAvailableLlmModels([]);
                          setLlmModelsMessage(null);
                        }}
                        placeholder="https://api.openai.com/v1"
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[9px] text-[#62666f]">
                        <span className="rounded-md bg-[#f0f1f3] px-2 py-1">
                          聊天请求 <code>/chat/completions</code>
                        </span>
                        <span className="rounded-md bg-[#f0f1f3] px-2 py-1">
                          模型列表 <code>/models</code>
                        </span>
                      </div>
                    </div>
                  </SettingRow>
                  <SettingRow
                    title="API Key"
                    description="保存在系统凭据库；本地服务不需要鉴权时可以留空。"
                    changed={isLlmSettingChanged("apiKey")}
                  >
                    <div className="flex h-9 w-102.5 items-center overflow-hidden rounded-lg border border-[#d7d9de] bg-white transition focus-within:border-[#7564e8] focus-within:ring-3 focus-within:ring-[#7564e8]/10 max-[800px]:w-90">
                      <input
                        aria-label="LLM API Key"
                        className="min-w-0 flex-1 border-0 bg-transparent px-3 text-[11px] text-[#202124] outline-none"
                        type={showLlmApiKey ? "text" : "password"}
                        value={settings.llm.apiKey}
                        onChange={(event) => {
                          updateLlmSetting("apiKey", event.target.value);
                          setAvailableLlmModels([]);
                          setLlmModelsMessage(null);
                        }}
                        placeholder="可选"
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <button
                        className="mr-1 grid size-7 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-[#777b84] hover:bg-[#f1f1f3] focus-visible:outline-2 focus-visible:outline-[#7564e8]"
                        type="button"
                        onClick={() => {
                          setShowLlmApiKey(!showLlmApiKey);
                        }}
                        aria-label={
                          showLlmApiKey
                            ? "隐藏 LLM API Key"
                            : "显示 LLM API Key"
                        }
                        title={
                          showLlmApiKey
                            ? "隐藏 LLM API Key"
                            : "显示 LLM API Key"
                        }
                      >
                        {showLlmApiKey ? (
                          <EyeOff size={13} />
                        ) : (
                          <Eye size={13} />
                        )}
                      </button>
                    </div>
                  </SettingRow>
                  <SettingRow
                    title="模型"
                    description="可手动填写，也可从服务的 /models 接口获取。"
                    changed={isLlmSettingChanged("model")}
                  >
                    <div className="w-102.5 max-[800px]:w-90">
                      <div className="flex gap-2">
                        <input
                          aria-label="LLM 模型"
                          className={INPUT_CLASS}
                          type="text"
                          value={settings.llm.model}
                          onChange={(event) => {
                            updateLlmSetting("model", event.target.value);
                          }}
                          placeholder="gpt-4.1-mini"
                          autoComplete="off"
                          spellCheck={false}
                          list={
                            availableLlmModels.length > 0
                              ? "llm-model-options"
                              : undefined
                          }
                        />
                        <button
                          className={SECONDARY_BUTTON_CLASS}
                          type="button"
                          onClick={() => void fetchLlmModels()}
                          disabled={loadingLlmModels}
                        >
                          <RefreshCw
                            className={
                              loadingLlmModels ? "animate-spin" : undefined
                            }
                            size={11}
                          />{" "}
                          {loadingLlmModels ? "获取中…" : "获取模型"}
                        </button>
                      </div>
                      {availableLlmModels.length > 0 ? (
                        <datalist id="llm-model-options">
                          {availableLlmModels.map((model) => (
                            <option key={model} value={model}>
                              {model}
                            </option>
                          ))}
                        </datalist>
                      ) : null}
                      <Feedback message={llmModelsMessage} className="mt-2" />
                    </div>
                  </SettingRow>
                  <SettingRow
                    title="流式显示"
                    description="边生成边在悬浮窗显示最终文本；服务不支持流式响应时请关闭。"
                    changed={isLlmSettingChanged("streaming")}
                  >
                    <Toggle
                      checked={settings.llm.streaming}
                      onChange={(checked) => {
                        updateLlmSetting("streaming", checked);
                      }}
                      label="启用 LLM 流式显示"
                    />
                  </SettingRow>
                  <SettingRow
                    title="请求参数"
                    description="使用预设控制常见推理选项；其它服务参数可在高级 JSON 中配置。"
                    changed={isLlmSettingChanged("extraParameters")}
                    vertical
                  >
                    <div className="flex items-center gap-2">
                      <select
                        aria-label="LLM 参数预设"
                        className={INPUT_CLASS}
                        value={selectedLlmParameterPreset}
                        onChange={(event) => {
                          const preset = LLM_PARAMETER_PRESETS.find(
                            ({ id }) => id === event.target.value
                          );
                          if (!preset) return;
                          setEditingCustomLlmParameters(false);
                          updateLlmSetting(
                            "extraParameters",
                            preset.parameters
                          );
                        }}
                      >
                        {selectedLlmParameterPreset ===
                        CUSTOM_LLM_PARAMETER_PRESET ? (
                          <option value={CUSTOM_LLM_PARAMETER_PRESET}>
                            自定义 JSON
                          </option>
                        ) : null}
                        {LLM_PARAMETER_PRESETS.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.label}
                          </option>
                        ))}
                      </select>
                      <button
                        className={SECONDARY_BUTTON_CLASS}
                        type="button"
                        aria-expanded={editingCustomLlmParameters}
                        onClick={() => {
                          setEditingCustomLlmParameters(
                            !editingCustomLlmParameters
                          );
                        }}
                      >
                        <Settings2 size={11} />{" "}
                        {editingCustomLlmParameters
                          ? "收起高级 JSON"
                          : "高级 JSON"}
                      </button>
                    </div>
                    {selectedLlmParameterPresetDetails ? (
                      <p className="mt-2 rounded-lg border border-[#e1e2e6] bg-[#f7f7f8] px-3 py-2 text-[9px] leading-4 text-[#62666f]">
                        {selectedLlmParameterPresetDetails.description}
                      </p>
                    ) : (
                      <p className="mt-2 rounded-lg border border-[#e1e2e6] bg-[#f7f7f8] px-3 py-2 text-[9px] leading-4 text-[#62666f]">
                        当前使用自定义 JSON 参数。
                      </p>
                    )}
                    {editingCustomLlmParameters ? (
                      <div className="mt-2 rounded-lg border border-[#e1e2e6] bg-[#fafafa] p-2.5">
                        <textarea
                          aria-label="LLM 高级自定义 JSON 参数"
                          className="min-h-24 w-full resize-y rounded-lg border border-[#d7d9de] bg-white px-3 py-2.5 font-mono text-[11px] leading-5 text-[#202124] transition outline-none focus:border-[#7564e8] focus:ring-3 focus:ring-[#7564e8]/10"
                          value={settings.llm.extraParameters}
                          onChange={(event) => {
                            updateLlmSetting(
                              "extraParameters",
                              event.target.value
                            );
                          }}
                          placeholder={'{\n  "parameter": "value"\n}'}
                          maxLength={8000}
                          rows={4}
                          spellCheck={false}
                        />
                        <div className="mt-2 flex items-center justify-between gap-3">
                          <span
                            className={`min-w-0 text-[9px] leading-4 ${
                              customLlmParameterError
                                ? "text-[#a33a31]"
                                : "text-[#55705f]"
                            }`}
                            role={customLlmParameterError ? "alert" : "status"}
                          >
                            {customLlmParameterError ??
                              (settings.llm.extraParameters.trim()
                                ? "JSON 对象有效"
                                : "空内容不会附加参数")}
                          </span>
                          <div className="flex shrink-0 gap-3">
                            <button
                              className={TEXT_BUTTON_CLASS}
                              type="button"
                              disabled={
                                Boolean(customLlmParameterError) ||
                                !settings.llm.extraParameters.trim()
                              }
                              onClick={() => {
                                const parsed: unknown = JSON.parse(
                                  settings.llm.extraParameters
                                );
                                updateLlmSetting(
                                  "extraParameters",
                                  JSON.stringify(parsed, null, 2) ??
                                    settings.llm.extraParameters
                                );
                              }}
                            >
                              格式化
                            </button>
                            <button
                              className={TEXT_BUTTON_CLASS}
                              type="button"
                              onClick={() => {
                                setEditingCustomLlmParameters(false);
                                updateLlmSetting("extraParameters", "");
                              }}
                            >
                              恢复服务默认
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : null}
                    <p className="mt-2 text-[9px] leading-4 text-[#666a73]">
                      预设只会修改额外请求字段，不会更改 API
                      Key、模型或表达偏好。模型不支持相应字段时，服务可能忽略或拒绝请求。
                    </p>
                  </SettingRow>
                  <SettingRow
                    title="表达偏好"
                    description="描述期望的语气和格式。VoicePaste 会尽量保留说话者身份、第一人称、原意和事实。"
                    changed={isLlmSettingChanged("prompt")}
                    vertical
                  >
                    <textarea
                      aria-label="LLM 表达偏好"
                      className="min-h-32 w-full resize-y rounded-lg border border-[#d7d9de] bg-white px-3 py-2.5 text-[12px] leading-6 text-[#202124] transition outline-none focus:border-[#7564e8] focus:ring-3 focus:ring-[#7564e8]/10"
                      value={settings.llm.prompt}
                      onChange={(event) => {
                        updateLlmSetting("prompt", event.target.value);
                      }}
                      placeholder={DEFAULT_LLM_PREFERENCE}
                      maxLength={8000}
                      rows={6}
                    />
                    <p className="mt-2 rounded-lg border border-[#ead9a4] bg-[#fff8df] px-3 py-2 text-[9px] leading-4 text-[#765b12]">
                      启用后，识别文本和表达偏好会发送到你配置的第三方服务，最终输入通常会增加数秒等待。处理失败时会自动使用原始识别文本。
                    </p>
                  </SettingRow>
                </>
              ) : null}
            </SettingsSection>
          </>
        );
      }
      case "diagnostics": {
        return (
          <SettingsSection
            id="diagnostics"
            title="权限与状态"
            description="用于确认系统权限和输入能力是否正常。"
          >
            <SettingRow title="全局快捷键">
              <span className="max-w-102.5 text-right text-[10px] leading-5 text-[#666a73]">
                {diagnostics?.shortcutStatus ?? "浏览器预览不注册快捷键"}
              </span>
            </SettingRow>
            <SettingRow title="麦克风">
              <span className="max-w-102.5 text-right text-[10px] leading-5 text-[#666a73]">
                {microphoneStatus}
              </span>
            </SettingRow>
            <SettingRow title="自动粘贴">
              <span className="max-w-102.5 text-right text-[10px] leading-5 text-[#666a73]">
                {diagnostics?.inputStatus ?? "浏览器预览不检查自动粘贴"}
              </span>
            </SettingRow>
            <div className="flex justify-end gap-2 px-5 py-3">
              <button
                className={SECONDARY_BUTTON_CLASS}
                type="button"
                onClick={() => {
                  setMessage(null);
                  void refreshDiagnostics();
                }}
              >
                <RefreshCw size={11} /> 重新检查
              </button>
              {diagnostics && !diagnostics.inputReady ? (
                <button
                  className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-[#cfc9f6] bg-[#f3f1ff] px-3 text-[10px] font-medium text-[#5748ca] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7564e8]"
                  type="button"
                  onClick={() => {
                    void (async () => {
                      setMessage(null);
                      try {
                        await invoke("retry_input_access");
                        await refreshDiagnostics();
                      } catch (error) {
                        showMessage({
                          kind: "error",
                          text: safeError(
                            error,
                            settingsRef.current.apiKey,
                            settingsRef.current.llm.apiKey
                          ),
                        });
                      }
                    })();
                  }}
                >
                  <CheckCircle2 size={11} /> 重试自动粘贴
                </button>
              ) : null}
            </div>
          </SettingsSection>
        );
      }
      case "about": {
        return (
          <>
            <SettingsSection
              id="about-version"
              title="版本与更新"
              description="查看当前版本并检查软件更新。"
            >
              <SettingRow
                title={versionTitle}
                description={
                  updateInfo
                    ? `发现新版本 ${updateInfo.version}，可直接下载并安装。`
                    : "VoicePaste 会在启动时自动检查更新，也可随时手动检查。"
                }
              >
                {updateInfo ? (
                  <button
                    className={PRIMARY_BUTTON_CLASS}
                    type="button"
                    onClick={() => void installUpdate()}
                    disabled={installingUpdate}
                  >
                    <Download size={11} />{" "}
                    {installingUpdate
                      ? "安装中…"
                      : `安装 ${updateInfo.version}`}
                  </button>
                ) : (
                  <button
                    className={SECONDARY_BUTTON_CLASS}
                    type="button"
                    onClick={() => void checkForUpdate(true)}
                    disabled={checkingUpdate}
                  >
                    <RefreshCw
                      className={checkingUpdate ? "animate-spin" : undefined}
                      size={11}
                    />{" "}
                    {checkingUpdate ? "检查中…" : "检查更新"}
                  </button>
                )}
              </SettingRow>
            </SettingsSection>

            <SettingsSection
              id="about-support"
              title="日志与支持"
              description="排查问题时可打开日志或复制不含凭据的诊断信息。"
            >
              <SettingRow
                title="日志目录"
                description={diagnostics?.logDir ?? "日志保存位置"}
              >
                <button
                  className={SECONDARY_BUTTON_CLASS}
                  type="button"
                  onClick={() => void runAboutAction("open_log_dir")}
                >
                  <FolderOpen size={11} /> 打开目录
                </button>
              </SettingRow>
              <SettingRow
                title="诊断信息"
                description="复制版本、快捷键、自动粘贴和系统信息，不包含 API Key。"
              >
                <button
                  className={SECONDARY_BUTTON_CLASS}
                  type="button"
                  onClick={() =>
                    void runAboutAction("copy_diagnostics", "诊断信息已复制")
                  }
                >
                  <Copy size={11} /> 复制诊断信息
                </button>
              </SettingRow>
            </SettingsSection>

            <SettingsSection
              id="about-links"
              title="项目与支持"
              description="访问项目主页、问题反馈和隐私说明。"
            >
              {(
                [
                  [
                    "homepage",
                    "项目主页",
                    "了解 VoicePaste 和最新动态",
                    "打开项目主页",
                  ],
                  [
                    "help",
                    "帮助与反馈",
                    "查看使用帮助并反馈问题",
                    "打开帮助与反馈",
                  ],
                  [
                    "privacy",
                    "隐私说明",
                    "了解数据处理和凭据存储方式",
                    "查看隐私说明",
                  ],
                ] as const
              ).map(([target, label, description, action]) => (
                <SettingRow
                  key={target}
                  title={label}
                  description={description}
                >
                  <button
                    className="flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-1 text-[10px] font-medium text-[#6558e8] hover:text-[#4f43bd] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7564e8]"
                    type="button"
                    onClick={() => void openProductLink(target)}
                  >
                    {action} <ExternalLink size={10} />
                  </button>
                </SettingRow>
              ))}
            </SettingsSection>
          </>
        );
      }
      default: {
        throw new Error("Unknown settings section");
      }
    }
  }
  if (loading) {
    return (
      <>
        {settingsToaster}
        <main className="grid h-screen w-screen place-items-center bg-[#f5f6f8] text-[12px] text-[#656d7d]">
          正在读取设置…
        </main>
      </>
    );
  }

  if (!settings.onboardingCompleted) {
    const selectedMicrophone =
      microphones.find((device) => device.id === settings.microphoneId)
        ?.label ?? "系统默认麦克风";
    const apiKeyVerified =
      Boolean(settings.apiKey.trim()) &&
      verifiedApiKey === settings.apiKey.trim();

    return (
      <>
        {settingsToaster}
        {hotwordConflictDialog}
        <main className="grid h-screen w-screen grid-cols-[220px_minmax(0,1fr)] overflow-hidden bg-[#f6f7f9] text-[#202124] max-[720px]:grid-cols-1">
          <aside className="flex flex-col border-r border-[#e4e5e8] bg-[#fbfbfc] px-6 py-7 max-[720px]:hidden">
            <div className="flex items-center gap-3">
              <div
                className="grid size-9 place-items-center rounded-[11px] bg-[#6558e8] text-white shadow-[0_4px_12px_rgba(101,88,232,0.22)]"
                aria-hidden="true"
              >
                <AudioWaveform size={19} strokeWidth={2.4} />
              </div>
              <div>
                <strong className="block text-[14px] font-semibold tracking-[-0.01em]">
                  VoicePaste
                </strong>
                <small className="mt-0.5 block text-[9px] text-[#696d75]">
                  首次设置
                </small>
              </div>
            </div>

            <ol className="mt-10 grid gap-1" aria-label="首次设置进度">
              {ONBOARDING_STEPS.map((label, index) => {
                const active = onboardingStep === index;
                const complete = onboardingStep > index;
                return (
                  <li key={label}>
                    <button
                      className={`flex h-10 w-full items-center gap-3 rounded-lg border-0 px-2.5 text-left text-[11px] font-medium transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#7564e8] ${
                        active
                          ? "bg-[#efedff] text-[#5748ca]"
                          : complete
                            ? "cursor-pointer bg-transparent text-[#444851] hover:bg-[#f0f1f3]"
                            : "cursor-default bg-transparent text-[#9699a0]"
                      }`}
                      type="button"
                      aria-current={active ? "step" : undefined}
                      disabled={!complete}
                      onClick={() => {
                        goToOnboardingStep(index);
                      }}
                    >
                      <span
                        className={`grid size-5 shrink-0 place-items-center rounded-full border text-[9px] ${
                          active
                            ? "border-[#6558e8] bg-[#6558e8] text-white"
                            : complete
                              ? "border-[#a9d8c4] bg-[#eaf8f1] text-[#17633f]"
                              : "border-[#d8dae0] bg-white text-[#8b8f97]"
                        }`}
                        aria-hidden="true"
                      >
                        {complete ? <CheckCircle2 size={12} /> : index + 1}
                      </span>
                      {label}
                    </button>
                  </li>
                );
              })}
            </ol>

            <p className="mt-auto text-[9px] leading-4 text-[#666a73]">
              所有设置均可在完成后随时修改。
            </p>
          </aside>

          <section className="min-w-0 overflow-auto px-10 py-8 max-[720px]:px-5 max-[720px]:py-6">
            <div className="mx-auto flex min-h-full max-w-155 flex-col justify-center">
              <div className="mb-7 hidden items-center gap-2.5 max-[720px]:flex">
                <div
                  className="grid size-8 place-items-center rounded-[10px] bg-[#6558e8] text-white"
                  aria-hidden="true"
                >
                  <AudioWaveform size={17} />
                </div>
                <strong className="text-[13px] font-semibold">
                  VoicePaste
                </strong>
                <span className="ml-auto text-[10px] text-[#777b84]">
                  {onboardingStep + 1} / {ONBOARDING_STEPS.length}
                </span>
              </div>

              <div className="rounded-2xl border border-[#e1e2e6] bg-white px-8 py-7 shadow-[0_12px_36px_rgba(31,35,48,0.07)] max-[720px]:px-5">
                {onboardingStep === 0 ? (
                  <div>
                    <div
                      className="mb-6 grid size-12 place-items-center rounded-[14px] bg-[#efedff] text-[#6558e8]"
                      aria-hidden="true"
                    >
                      <AudioWaveform size={24} strokeWidth={2.2} />
                    </div>
                    <p className="text-[10px] font-medium tracking-[0.12em] text-[#6558e8]">
                      欢迎使用
                    </p>
                    <h1
                      ref={onboardingHeadingRef}
                      className="mt-2 text-[25px] font-semibold tracking-[-0.03em] text-[#202124] outline-none"
                      tabIndex={-1}
                    >
                      用说话代替打字
                    </h1>
                    <p className="mt-3 max-w-125 text-[12px] leading-6 text-[#62666f]">
                      VoicePaste
                      可在任意输入框中听写，并将识别结果输入到当前光标位置。接下来完成识别服务、快捷键和麦克风设置。
                    </p>
                    <Feedback message={onboardingMessage} className="mt-5" />
                    <div className="mt-7 flex justify-end">
                      <button
                        className={PRIMARY_BUTTON_CLASS}
                        type="button"
                        onClick={() => {
                          goToOnboardingStep(1);
                        }}
                      >
                        开始设置 <ChevronRight size={13} />
                      </button>
                    </div>
                  </div>
                ) : null}

                {onboardingStep === 1 ? (
                  <div>
                    <p className="text-[10px] font-medium tracking-[0.12em] text-[#6558e8]">
                      第 1 步
                    </p>
                    <h1
                      ref={onboardingHeadingRef}
                      className="mt-2 text-[22px] font-semibold tracking-[-0.02em] outline-none"
                      tabIndex={-1}
                    >
                      配置语音识别服务
                    </h1>
                    <p className="mt-2 text-[11px] leading-5 text-[#6f737b]">
                      使用你自己的火山引擎 API
                      Key。凭据将安全保存在系统凭据库中，用于语音识别和常用词同步。
                    </p>

                    <label
                      className="mt-6 block text-[11px] font-medium text-[#34373d]"
                      htmlFor="onboarding-api-key"
                    >
                      豆包 API Key
                    </label>
                    <div className="mt-2 flex h-10 items-center overflow-hidden rounded-lg border border-[#d7d9de] bg-white transition focus-within:border-[#7564e8] focus-within:ring-3 focus-within:ring-[#7564e8]/10">
                      <input
                        id="onboarding-api-key"
                        className="min-w-0 flex-1 border-0 bg-transparent px-3 text-[12px] text-[#202124] outline-none"
                        type={showApiKey ? "text" : "password"}
                        value={settings.apiKey}
                        onChange={(event) => {
                          updateSetting("apiKey", event.target.value);
                          setVerifiedApiKey("");
                          setOnboardingMessage(null);
                          setDoubaoIssue(null);
                        }}
                        placeholder="粘贴 API Key"
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <button
                        className="mr-1 grid size-7 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-[#777b84] hover:bg-[#f1f1f3] focus-visible:outline-2 focus-visible:outline-[#7564e8]"
                        type="button"
                        onClick={() => {
                          setShowApiKey(!showApiKey);
                        }}
                        aria-label={
                          showApiKey ? "隐藏 API Key" : "显示 API Key"
                        }
                        title={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                      >
                        {showApiKey ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <button
                        className="flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[10px] text-[#6558e8] hover:text-[#4f43bd] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7564e8]"
                        type="button"
                        onClick={() => void openConsole()}
                      >
                        获取 API Key <ExternalLink size={10} />
                      </button>
                      <button
                        className={SECONDARY_BUTTON_CLASS}
                        type="button"
                        onClick={() => void testDoubao(setOnboardingMessage)}
                        disabled={testingDoubao || !settings.apiKey.trim()}
                      >
                        <Activity size={11} />{" "}
                        {testingDoubao
                          ? "连接中…"
                          : apiKeyVerified
                            ? "重新测试"
                            : "测试连接"}
                      </button>
                    </div>
                    <Feedback message={onboardingMessage} className="mt-4" />
                    {doubaoIssue ? (
                      <ServiceIssueCard
                        className="mt-4"
                        issue={doubaoIssue}
                        onOpenLink={(target) => {
                          void openProductLink(target);
                        }}
                      />
                    ) : null}
                    <div className="mt-7 flex items-center justify-between">
                      <button
                        className={SECONDARY_BUTTON_CLASS}
                        type="button"
                        onClick={() => {
                          goToOnboardingStep(0);
                        }}
                      >
                        <ChevronLeft size={12} /> 返回
                      </button>
                      <button
                        className={PRIMARY_BUTTON_CLASS}
                        type="button"
                        onClick={() => {
                          goToOnboardingStep(2);
                        }}
                        disabled={!apiKeyVerified || testingDoubao}
                      >
                        继续 <ChevronRight size={13} />
                      </button>
                    </div>
                  </div>
                ) : null}

                {onboardingStep === 2 ? (
                  <div>
                    <p className="text-[10px] font-medium tracking-[0.12em] text-[#6558e8]">
                      第 2 步
                    </p>
                    <h1
                      ref={onboardingHeadingRef}
                      className="mt-2 text-[22px] font-semibold tracking-[-0.02em] outline-none"
                      tabIndex={-1}
                    >
                      录制全局快捷键
                    </h1>
                    <p className="mt-2 text-[11px] leading-5 text-[#6f737b]">
                      点击下方按钮，再按下包含修饰键的组合键。
                    </p>

                    <div className="mt-7 rounded-xl border border-[#e1e2e6] bg-[#f8f8fa] p-5">
                      <div className="flex items-center justify-between gap-5">
                        <div>
                          <p className="text-[11px] font-medium text-[#34373d]">
                            开始听写
                          </p>
                          <p className="mt-1 text-[10px] leading-5 text-[#777b84]">
                            可在任何应用的输入框中使用
                          </p>
                        </div>
                        <button
                          ref={shortcutButtonRef}
                          className={`h-10 min-w-47.5 cursor-pointer rounded-lg border px-3 font-mono text-[10px] outline-none ${
                            shortcutRecorder.isRecording
                              ? "border-[#8f83e8] bg-[#f1efff] text-[#5748ca] ring-3 ring-[#7564e8]/10"
                              : "border-[#d7d9de] bg-white text-[#3f434b] hover:bg-[#f5f5f6] focus-visible:ring-3 focus-visible:ring-[#7564e8]/10"
                          }`}
                          type="button"
                          onClick={() => {
                            setOnboardingMessage(null);
                            shortcutRecorder.startRecording();
                          }}
                          onBlur={shortcutRecorder.cancelRecording}
                        >
                          {shortcutRecorder.isRecording ? (
                            "请按组合键…"
                          ) : (
                            <ShortcutHint shortcut={settings.shortcut} />
                          )}
                        </button>
                      </div>
                    </div>
                    <Feedback message={onboardingMessage} className="mt-4" />
                    <div className="mt-7 flex items-center justify-between">
                      <button
                        className={SECONDARY_BUTTON_CLASS}
                        type="button"
                        onClick={() => {
                          goToOnboardingStep(1);
                        }}
                      >
                        <ChevronLeft size={12} /> 返回
                      </button>
                      <button
                        className={PRIMARY_BUTTON_CLASS}
                        type="button"
                        onClick={() => {
                          goToOnboardingStep(3);
                        }}
                        disabled={
                          !settings.shortcut.trim() ||
                          shortcutRecorder.isRecording
                        }
                      >
                        继续 <ChevronRight size={13} />
                      </button>
                    </div>
                  </div>
                ) : null}

                {onboardingStep === 3 ? (
                  <div>
                    <p className="text-[10px] font-medium tracking-[0.12em] text-[#6558e8]">
                      第 3 步
                    </p>
                    <h1
                      ref={onboardingHeadingRef}
                      className="mt-2 text-[22px] font-semibold tracking-[-0.02em] outline-none"
                      tabIndex={-1}
                    >
                      选择麦克风
                    </h1>
                    <p className="mt-2 text-[11px] leading-5 text-[#6f737b]">
                      系统默认麦克风通常即可；测试时说一句话确认音量响应。
                    </p>

                    <label
                      className="mt-6 block text-[11px] font-medium text-[#34373d]"
                      htmlFor="onboarding-microphone"
                    >
                      输入设备
                    </label>
                    <div className="mt-2 flex gap-2">
                      <select
                        id="onboarding-microphone"
                        className={INPUT_CLASS}
                        value={settings.microphoneId}
                        onChange={(event) => {
                          updateSetting("microphoneId", event.target.value);
                          setMicrophoneMessage(null);
                        }}
                        disabled={testingMicrophone}
                      >
                        <option value="">系统默认麦克风</option>
                        {microphones.map((device) => (
                          <option key={device.id} value={device.id}>
                            {device.label}
                          </option>
                        ))}
                      </select>
                      <button
                        className={SECONDARY_BUTTON_CLASS}
                        type="button"
                        aria-pressed={testingMicrophone}
                        onClick={toggleMicrophoneTest}
                      >
                        <Mic size={11} />{" "}
                        {testingMicrophone ? "停止测试" : "开始测试"}
                      </button>
                    </div>
                    <div
                      className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#ececef]"
                      role="meter"
                      aria-label="麦克风音量"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(microphoneLevel * 100)}
                    >
                      <div
                        className="h-full rounded-full bg-[#6558e8] transition-[width] duration-75"
                        style={{
                          width: `${Math.max(testingMicrophone ? 3 : 0, microphoneLevel * 100)}%`,
                        }}
                      />
                    </div>
                    <Feedback message={microphoneMessage} className="mt-4" />
                    <div className="mt-7 flex items-center justify-between">
                      <button
                        className={SECONDARY_BUTTON_CLASS}
                        type="button"
                        onClick={() => {
                          goToOnboardingStep(2);
                        }}
                        disabled={testingMicrophone}
                      >
                        <ChevronLeft size={12} /> 返回
                      </button>
                      <button
                        className={PRIMARY_BUTTON_CLASS}
                        type="button"
                        onClick={() => {
                          goToOnboardingStep(4);
                        }}
                        disabled={testingMicrophone}
                      >
                        继续 <ChevronRight size={13} />
                      </button>
                    </div>
                  </div>
                ) : null}

                {onboardingStep === 4 ? (
                  <div>
                    <div
                      className="mb-5 grid size-12 place-items-center rounded-full bg-[#eaf8f1] text-[#17633f]"
                      aria-hidden="true"
                    >
                      <CheckCircle2 size={25} strokeWidth={2.1} />
                    </div>
                    <p className="text-[10px] font-medium tracking-[0.12em] text-[#6558e8]">
                      设置完成
                    </p>
                    <h1
                      ref={onboardingHeadingRef}
                      className="mt-2 text-[22px] font-semibold tracking-[-0.02em] outline-none"
                      tabIndex={-1}
                    >
                      VoicePaste 已准备就绪
                    </h1>
                    <p className="mt-2 text-[11px] leading-5 text-[#6f737b]">
                      确认以下设置，完成后可立即使用快捷键开始听写。
                    </p>

                    <dl className="mt-6 divide-y divide-[#ececef] overflow-hidden rounded-xl border border-[#e1e2e6] bg-[#fbfbfc] text-[11px]">
                      <div className="flex items-center justify-between gap-5 px-4 py-3">
                        <dt className="text-[#777b84]">识别服务</dt>
                        <dd className="font-medium text-[#17633f]">
                          语音识别和常用词已验证
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-5 px-4 py-3">
                        <dt className="text-[#777b84]">快捷键</dt>
                        <dd>
                          <ShortcutHint shortcut={settings.shortcut} />
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-5 px-4 py-3">
                        <dt className="text-[#777b84]">麦克风</dt>
                        <dd className="max-w-xs truncate font-medium text-[#34373d]">
                          {selectedMicrophone}
                        </dd>
                      </div>
                    </dl>
                    <Feedback message={onboardingMessage} className="mt-4" />
                    {doubaoIssue ? (
                      <ServiceIssueCard
                        className="mt-4"
                        issue={doubaoIssue}
                        onOpenLink={(target) => {
                          void openProductLink(target);
                        }}
                      />
                    ) : null}
                    <div className="mt-7 flex items-center justify-between">
                      <button
                        className={SECONDARY_BUTTON_CLASS}
                        type="button"
                        onClick={() => {
                          goToOnboardingStep(3);
                        }}
                        disabled={saving}
                      >
                        <ChevronLeft size={12} /> 返回修改
                      </button>
                      <button
                        className={PRIMARY_BUTTON_CLASS}
                        type="button"
                        onClick={() => void finishOnboarding()}
                        disabled={saving}
                      >
                        {saving ? "正在同步设置…" : "完成设置"}{" "}
                        <CheckCircle2 size={13} />
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        </main>
      </>
    );
  }

  return (
    // oxlint-disable-next-line react/jsx-no-constructed-context-values -- renderer must capture current settings state
    <SettingsOutletContext.Provider value={renderSection}>
      {settingsToaster}
      {hotwordConflictDialog}
      <div className="grid h-screen w-screen grid-cols-[188px_minmax(0,1fr)] overflow-hidden bg-[#f6f7f9] text-[#202124]">
        <aside className="flex flex-col border-r border-[#e4e5e8] bg-[#fbfbfc] px-3.5 py-4">
          <div className="flex items-center gap-2.5 px-2.5 py-2">
            <div
              className="grid size-8 place-items-center rounded-[10px] bg-[#6558e8] text-white shadow-[0_4px_12px_rgba(101,88,232,0.22)]"
              aria-hidden="true"
            >
              <AudioWaveform size={17} strokeWidth={2.4} />
            </div>
            <div>
              <strong className="block text-[13px] font-semibold tracking-[-0.01em]">
                VoicePaste
              </strong>
              <small className="mt-0.5 block text-[9px] text-[#696d75]">
                设置
              </small>
            </div>
          </div>

          <nav className="mt-5 grid gap-1" aria-label="设置分类">
            {SECTIONS.map(([id, label, Icon]) => (
              <Link
                key={id}
                activeOptions={{ exact: true }}
                activeProps={{
                  className: "bg-[#efedff] text-[#5748ca]",
                }}
                className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 text-left text-[11px] font-medium transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#7564e8]"
                inactiveProps={{
                  className:
                    "bg-transparent text-[#666a73] hover:bg-[#f0f1f3] hover:text-[#282b31]",
                }}
                to={SETTINGS_PATHS[id]}
                onClick={() => {
                  toast.dismiss(SETTINGS_TOAST_ID);
                }}
              >
                {({ isActive }) => (
                  <>
                    <Icon size={14} strokeWidth={isActive ? 2.2 : 1.8} />
                    {label}
                    {isSectionChanged(id) ? (
                      <span className="ml-auto rounded-full bg-[#fff2cc] px-1.5 py-0.5 text-[8px] font-medium text-[#7a5100]">
                        未保存
                      </span>
                    ) : null}
                  </>
                )}
              </Link>
            ))}
          </nav>

          <p className="mt-auto px-3 pb-1 text-[9px] leading-4 text-[#696d75]">
            关闭窗口后继续在系统托盘运行
          </p>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-col">
          <header className="flex h-18 shrink-0 items-center justify-between border-b border-[#e4e5e8] bg-white px-8">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-[18px] font-semibold tracking-[-0.02em] text-[#202124]">
                  设置
                </h1>
                {hasUnsavedChanges ? (
                  <span className="rounded-full bg-[#fff2cc] px-2 py-0.5 text-[9px] font-medium text-[#7a5100]">
                    有未保存的修改
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-[10px] text-[#6f737b]">
                {SECTION_DESCRIPTIONS[activeSection]}
              </p>
            </div>
            <div className="flex gap-2">
              {activeSection === "shortcut" ? (
                <button
                  className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-[#d7d9de] bg-white px-3 text-[10px] font-medium text-[#5c6068] transition hover:bg-[#f5f5f6] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#7564e8] disabled:cursor-wait disabled:opacity-55"
                  type="button"
                  onClick={() => void resetVoiceInput()}
                  disabled={saving}
                >
                  <RotateCcw size={11} /> 恢复默认并保存
                </button>
              ) : null}
              {hasUnsavedChanges ? (
                <button
                  className="flex h-8 min-w-22 cursor-pointer items-center justify-center gap-1.5 rounded-lg border-0 bg-[#6558e8] px-3 text-[10px] font-medium text-white transition hover:bg-[#584bcf] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#7564e8] disabled:cursor-wait disabled:opacity-55"
                  type="button"
                  onClick={() => void save()}
                  disabled={saving}
                >
                  <Save size={11} />{" "}
                  {saving
                    ? activeSection === "recognition" && cloudDirty
                      ? "同步中…"
                      : "保存中…"
                    : "保存更改"}
                </button>
              ) : (
                <span className="flex h-8 min-w-22 items-center justify-center gap-1.5 rounded-lg bg-[#eeeff2] px-3 text-[10px] font-medium text-[#62666f]">
                  <CheckCircle2 size={11} /> 已保存
                </span>
              )}
            </div>
          </header>

          <main
            className="min-h-0 flex-1 overflow-auto scroll-smooth px-8 py-6"
            data-scroll-restoration-id="settings-content"
          >
            <div className="mx-auto max-w-180">
              <Feedback
                message={message?.kind === "error" ? message : null}
                className="mb-5"
              />

              <fieldset className="m-0 min-w-0 border-0 p-0" disabled={saving}>
                {children}
              </fieldset>
            </div>
          </main>
        </div>
      </div>
    </SettingsOutletContext.Provider>
  );
}
