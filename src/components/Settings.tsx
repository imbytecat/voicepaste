import { Link } from "@tanstack/react-router";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Activity,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
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
  TriangleAlert,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode, RefObject } from "react";
import { Toaster, toast } from "sonner";

import { AudioCapture } from "@/audio";
import type { MicrophoneDevice } from "@/audio";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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

import appIconUrl from "../../src-tauri/icons/app-icon.svg";

const DEFAULT_MICROPHONE_VALUE = "__voicepaste_system_default__";
const CONSOLE_URL = "https://console.volcengine.com/speech/new/setting/apikeys";
const LLM_BASE_URL_PLACEHOLDER = "https://api.deepseek.com/v1";
const LLM_MODEL_PLACEHOLDER = "deepseek-v4-flash";
const SECTIONS = [
  ["shortcut", "语音输入", Command],
  ["recognition", "语音识别", Mic],
  ["processing", "文本处理", Sparkles],
  ["general", "应用", Settings2],
  ["diagnostics", "系统检查", ShieldCheck],
  ["about", "关于", Info],
] as const;
const SECTION_INDICATOR_POSITION: Record<SettingsSectionId, string> = {
  shortcut: "before:translate-y-0",
  recognition: "before:translate-y-[44px]",
  processing: "before:translate-y-[88px]",
  general: "before:translate-y-[132px]",
  diagnostics: "before:translate-y-[176px]",
  about: "before:translate-y-[220px]",
};
const SECTION_DESCRIPTIONS: Record<SettingsSectionId, string> = {
  shortcut: "设置听写方式、快捷键、麦克风和悬浮窗",
  recognition: "连接豆包语音识别并管理常用词",
  processing: "配置识别文本的智能校对与改写",
  general: "管理 VoicePaste 的启动行为",
  diagnostics: "检查系统权限与输入链路",
  about: "查看版本、更新和支持信息",
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
  syncing: "bg-accent text-accent-foreground",
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

export function VoiceInputSettingsPage() {
  return <SettingsRouteSection section="shortcut" />;
}

export function RecognitionSettingsPage() {
  return <SettingsRouteSection section="recognition" />;
}

export function ProcessingSettingsPage() {
  return <SettingsRouteSection section="processing" />;
}

export function GeneralSettingsPage() {
  return <SettingsRouteSection section="general" />;
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
      className="rounded-lg border border-border bg-card px-2 py-1.5 font-mono text-[11px] leading-none font-semibold text-foreground shadow-[0_2px_0_rgba(74,82,112,0.12)]"
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
    <section
      className="mb-10 grid grid-cols-[10rem_minmax(0,1fr)] gap-8 max-[1040px]:grid-cols-1 max-[1040px]:gap-3"
      id={id}
    >
      <header className="pt-1">
        <h2 className="text-[17px] leading-tight font-semibold tracking-[-0.025em] text-foreground">
          {title}
        </h2>
        <p className="mt-2 max-w-44 text-[12px] leading-5 text-muted-foreground max-[1040px]:max-w-[60ch]">
          {description}
        </p>
      </header>
      <div className="vp-control-surface divide-y divide-border overflow-hidden rounded-[14px] border border-border bg-card">
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
          ? "px-6 py-5"
          : "grid min-h-20 grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)] items-center gap-x-6 px-6 py-4.5 max-[820px]:grid-cols-1 max-[820px]:gap-y-4"
      }
    >
      <div className={vertical ? "" : "min-w-0"}>
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] leading-5 font-semibold tracking-[-0.01em] text-foreground">
            {title}
          </h3>
          {changed ? (
            <Badge
              variant="outline"
              className="vp-state-pop h-5 border-[#d7b879] bg-[#fff4d8] px-1.5 text-[10px] text-[#7a5100]"
            >
              已修改
            </Badge>
          ) : null}
        </div>
        {description ? (
          <p className="mt-1.5 max-w-[58ch] text-[12px] leading-5 wrap-break-word text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      <div
        className={vertical ? "mt-4" : "min-w-0 shrink-0 max-[820px]:w-full"}
      >
        {children}
      </div>
    </div>
  );
}

const PERMISSION_STATUS_PRESENTATION = {
  granted: {
    className: "text-[#17633f]",
    icon: CheckCircle2,
    label: "已授权",
  },
  preview: {
    className: "text-[#666a73]",
    icon: Info,
    label: "预览模式",
  },
  unavailable: {
    className: "text-[#765b12]",
    icon: TriangleAlert,
    label: "待处理",
  },
} as const;

type PermissionStatusState = keyof typeof PERMISSION_STATUS_PRESENTATION;

function PermissionRow({
  detail,
  icon,
  iconClassName,
  state,
  title,
}: {
  detail?: string;
  icon: ReactNode;
  iconClassName: string;
  state: PermissionStatusState;
  title: string;
}) {
  const presentation = PERMISSION_STATUS_PRESENTATION[state];
  const StatusIcon = presentation.icon;

  return (
    <div className="grid min-h-22 grid-cols-[minmax(0,1fr)_minmax(15rem,20rem)] items-center gap-x-6 px-6 py-4.5 max-[820px]:grid-cols-1 max-[820px]:gap-y-3">
      <div className="flex min-w-0 items-center gap-3.5">
        <div
          className={`grid size-10 shrink-0 place-items-center rounded-[12px] ${iconClassName}`}
          aria-hidden="true"
        >
          {icon}
        </div>
        <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-foreground">
          {title}
        </h3>
      </div>
      <div
        className="min-w-0 text-right max-[820px]:w-full max-[820px]:pl-13.5 max-[820px]:text-left"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span
          className={`inline-flex items-center gap-1.5 text-[12px] font-semibold ${presentation.className}`}
        >
          <StatusIcon className="size-3.5" strokeWidth={2} aria-hidden="true" />
          {presentation.label}
        </span>
        {detail ? (
          <p className="mt-1 text-[11px] leading-5 wrap-break-word text-muted-foreground">
            {detail}
          </p>
        ) : null}
      </div>
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
      ? "border-[#a9d8c4] bg-[#edf7f1] text-[#17633f]"
      : message.kind === "error"
        ? "border-[#e8b7b0] bg-[#fff0ee] text-[#8d261f]"
        : "border-primary/20 bg-accent text-accent-foreground";
  return (
    <Alert
      className={`vp-feedback-enter px-4 py-3 text-[12px] leading-5 ${colors} ${className ?? ""}`}
      role={message.kind === "error" ? "alert" : "status"}
      aria-live={message.kind === "error" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <AlertDescription className="text-inherit">
        {message.text}
      </AlertDescription>
    </Alert>
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
    <Alert
      variant={warning ? "destructive" : "default"}
      className={`px-4 py-3.5 text-[12px] leading-5 ${
        warning
          ? "border-[#e8b7b0] bg-[#fff0ee]"
          : "border-primary/20 bg-accent text-accent-foreground"
      } ${className ?? ""}`}
      aria-live="assertive"
      aria-atomic="true"
    >
      <Info size={16} strokeWidth={1.8} />
      <AlertTitle className="text-[13px] font-semibold">
        {issue.title}
      </AlertTitle>
      <AlertDescription className="text-inherit">
        {issue.steps.length > 0 ? (
          <ol className="mt-1 list-decimal pl-4">
            {issue.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        ) : (
          <p className="mt-1">{issue.detail}</p>
        )}
        {issue.links.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {issue.links.map((link) => (
              <Button
                key={link.target}
                variant="outline"
                size="sm"
                className="h-8 text-[11px]"
                type="button"
                onClick={() => {
                  onOpenLink(link.target);
                }}
              >
                <ExternalLink size={11} /> {link.label}
              </Button>
            ))}
          </div>
        ) : null}
        {issue.steps.length > 0 ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-[11px] font-medium">
              技术详情
            </summary>
            <p className="mt-1.5 text-[11px] leading-5 wrap-break-word">
              {issue.detail}
            </p>
          </details>
        ) : null}
      </AlertDescription>
    </Alert>
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
  finalFocus,
  onCancel,
  onUseCloud,
  onOverwriteCloud,
}: {
  conflict: HotwordConflict;
  finalFocus: RefObject<HTMLElement | null>;
  onCancel: () => void;
  onUseCloud: () => void;
  onOverwriteCloud: () => void;
}) {
  const { onlyCloud, onlyLocal } = hotwordDiff(
    conflict.pendingSettings.hotwords,
    conflict.cloudHotwords
  );

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent
        finalFocus={finalFocus}
        className="w-[calc(100%-2.5rem)] max-w-110 gap-0 overflow-hidden p-0"
      >
        <div className="flex items-start gap-3.5 p-5.5">
          <AlertDialogMedia className="mb-0 size-10 shrink-0 rounded-[12px] bg-[#fff0d5] text-[#7a5100]">
            <Info size={18} />
          </AlertDialogMedia>
          <div className="min-w-0">
            <AlertDialogTitle className="text-[15px] font-semibold tracking-[-0.015em] text-foreground">
              云端常用词已被修改
            </AlertDialogTitle>
            <AlertDialogDescription className="mt-2 text-left text-[12px] leading-5 text-muted-foreground">
              云端多出 {onlyCloud.length} 个词，本机多出 {onlyLocal.length}{" "}
              个词。请选择保留哪个版本。
            </AlertDialogDescription>
            {onlyCloud.length > 0 ? (
              <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                云端多出：{describeHotwords(onlyCloud)}
              </p>
            ) : null}
            {onlyLocal.length > 0 ? (
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                本机多出：{describeHotwords(onlyLocal)}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-foreground/8 bg-muted/60 p-4">
          <AlertDialogCancel size="lg">取消</AlertDialogCancel>
          <AlertDialogAction
            variant="outline"
            size="lg"
            onClick={onOverwriteCloud}
          >
            用本机覆盖云端
          </AlertDialogAction>
          <AlertDialogAction size="lg" onClick={onUseCloud}>
            用云端替换本机
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
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
  const hotwordConflictReturnFocusRef = useRef<HTMLElement | null>(null);

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
  const openHotwordConflict = (conflict: HotwordConflict) => {
    const { activeElement } = document;
    if (activeElement instanceof HTMLElement && activeElement !== document.body)
      hotwordConflictReturnFocusRef.current = activeElement;
    setHotwordConflict(conflict);
  };

  const closeHotwordConflict = () => {
    setHotwordConflict(null);
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
      openHotwordConflict({
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
      selectSection("shortcut");
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
      overlayPosition: DEFAULT_SETTINGS.overlayPosition,
    };
    try {
      const result = await persistSettings(persistedReset);
      setCloudHotwords(result.cloudHotwords);
      if (result.kind === "conflict") {
        openHotwordConflict({
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
        overlayPosition: DEFAULT_SETTINGS.overlayPosition,
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
      offset={{ right: 28, top: 132 }}
      duration={TRANSIENT_MESSAGE_DURATION}
      visibleToasts={1}
      expand={false}
      containerAriaLabel="设置反馈"
      toastOptions={{ className: "font-sans text-[12px]" }}
    />
  );

  const diagnosticsPreview = diagnostics === null;
  const shortcutPermissionState = diagnosticsPreview
    ? "preview"
    : diagnostics.shortcutStatus === "全局快捷键已启用"
      ? "granted"
      : "unavailable";
  const microphonePermissionState = diagnosticsPreview
    ? "preview"
    : microphones.length > 0
      ? "granted"
      : "unavailable";
  const inputPermissionState = diagnosticsPreview
    ? "preview"
    : diagnostics.inputReady
      ? "granted"
      : "unavailable";
  const shortcutPermissionDetail =
    shortcutPermissionState === "granted"
      ? undefined
      : (diagnostics?.shortcutStatus ?? "浏览器预览不注册快捷键");
  const microphonePermissionDetail =
    microphonePermissionState === "granted"
      ? undefined
      : diagnosticsPreview
        ? "浏览器预览不检查麦克风权限"
        : "未检测到麦克风";
  const inputPermissionDetail =
    inputPermissionState === "granted"
      ? undefined
      : (diagnostics?.inputStatus ?? "浏览器预览不检查自动粘贴");
  const microphoneOptions = [
    { label: "系统默认麦克风", value: DEFAULT_MICROPHONE_VALUE },
    ...microphones.map((device) => ({
      label: device.label,
      value: device.id,
    })),
  ];
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
  const llmParameterPresetOptions = [
    ...(selectedLlmParameterPreset === CUSTOM_LLM_PARAMETER_PRESET
      ? [{ label: "自定义 JSON", value: CUSTOM_LLM_PARAMETER_PRESET }]
      : []),
    ...LLM_PARAMETER_PRESETS.map((preset) => ({
      label: preset.label,
      value: preset.id,
    })),
  ];
  const llmModelQuery = settings.llm.model.trim().toLocaleLowerCase();
  const filteredLlmModels = availableLlmModels.filter(
    (model) =>
      !llmModelQuery || model.toLocaleLowerCase().includes(llmModelQuery)
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
    if (section === "shortcut")
      return (
        isSettingChanged("activationMode") ||
        isSettingChanged("shortcut") ||
        isSettingChanged("microphoneId") ||
        isSettingChanged("overlayPosition")
      );
    if (section === "recognition")
      return (
        hotwordStatus.state === "pending" ||
        isSettingChanged("apiKey") ||
        isSettingChanged("hotwordsEnabled") ||
        hotwordsChanged
      );
    if (section === "processing") return llmChanged;
    if (section === "general")
      return (
        isSettingChanged("launchAtStartup") ||
        isSettingChanged("openSettingsOnStartup")
      );
    return false;
  };
  const hotwordConflictDialog = hotwordConflict ? (
    <HotwordConflictDialog
      conflict={hotwordConflict}
      finalFocus={hotwordConflictReturnFocusRef}
      onCancel={closeHotwordConflict}
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
            title="启动行为"
            description="控制 VoicePaste 如何随系统启动。"
          >
            <SettingRow
              title="开机启动"
              description="登录系统后自动启动 VoicePaste，并在托盘中等待。"
              changed={isSettingChanged("launchAtStartup")}
            >
              <Switch
                checked={settings.launchAtStartup}
                onCheckedChange={(checked) => {
                  updateSetting("launchAtStartup", checked);
                }}
                aria-label="开机启动"
              />
            </SettingRow>
            <SettingRow
              title="启动时打开窗口"
              description="启动 VoicePaste 时显示设置窗口；关闭后仅在托盘中运行。"
              changed={isSettingChanged("openSettingsOnStartup")}
            >
              <Switch
                checked={settings.openSettingsOnStartup}
                onCheckedChange={(checked) => {
                  updateSetting("openSettingsOnStartup", checked);
                }}
                aria-label="启动时打开窗口"
              />
            </SettingRow>
          </SettingsSection>
        );
      }
      case "shortcut": {
        return (
          <>
            {settings.apiKey ? null : (
              <Alert
                className="mb-5 border-[#ead9b7] bg-[#fff8ea] px-3.5 py-2.5 text-[#6d511e]"
                role="status"
              >
                <AlertDescription className="flex items-center justify-between gap-4 text-[11px] text-inherit">
                  <span>开始听写前，需要先配置语音识别服务。</span>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto shrink-0 px-0 text-[11px]"
                    type="button"
                    onClick={() => {
                      selectSection("recognition");
                    }}
                  >
                    前往配置
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            <SettingsSection
              id="shortcut"
              title="开始听写"
              description="配置触发方式、全局快捷键和输入设备。"
            >
              <SettingRow
                title="触发方式"
                description="选择快捷键按下后的行为。"
                changed={isSettingChanged("activationMode")}
              >
                <ToggleGroup
                  className={`relative isolate grid w-full max-w-71.5 grid-cols-2 overflow-hidden before:pointer-events-none before:absolute before:inset-y-1 before:left-1 before:z-0 before:w-[calc(50%-6px)] before:rounded-[8px] before:border before:border-border before:bg-card before:shadow-(--control-shadow) before:transition-transform before:duration-(--vp-duration-layout) before:ease-(--vp-ease-spring) before:content-[''] motion-reduce:before:transition-none ${
                    settings.activationMode === "hold"
                      ? "before:translate-x-[calc(100%+4px)]"
                      : ""
                  }`}
                  value={[settings.activationMode]}
                  onValueChange={(values) => {
                    const value = values[0] as
                      | AppSettings["activationMode"]
                      | undefined;
                    if (value) updateSetting("activationMode", value);
                  }}
                  aria-label="听写触发方式"
                >
                  {(
                    [
                      ["toggle", "按一下切换"],
                      ["hold", "按住说话"],
                    ] as const
                  ).map(([value, label]) => (
                    <ToggleGroupItem
                      key={value}
                      className="vp-segment-item relative z-1 h-9 w-full text-[12px] hover:text-foreground"
                      value={value}
                    >
                      {label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </SettingRow>

              <SettingRow
                title="全局快捷键"
                description="点击右侧快捷键，然后按下新的按键或组合键；也支持 F13–F20 单键。"
                changed={isSettingChanged("shortcut")}
              >
                <Button
                  ref={shortcutButtonRef}
                  variant="outline"
                  size="lg"
                  className={`min-w-46 font-mono text-[11px] ${
                    shortcutRecorder.isRecording
                      ? "border-primary/55 bg-accent text-accent-foreground ring-3 ring-ring/15"
                      : ""
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
                </Button>
              </SettingRow>

              <SettingRow
                title="麦克风"
                description="默认使用系统当前选择的输入设备。"
                changed={isSettingChanged("microphoneId")}
              >
                <div className="w-full max-w-102.5">
                  <div className="flex gap-2">
                    <Select
                      items={microphoneOptions}
                      value={settings.microphoneId || DEFAULT_MICROPHONE_VALUE}
                      onValueChange={(value) => {
                        if (value === null) return;
                        updateSetting(
                          "microphoneId",
                          value === DEFAULT_MICROPHONE_VALUE ? "" : value
                        );
                        setMicrophoneMessage(null);
                      }}
                      disabled={testingMicrophone}
                    >
                      <SelectTrigger
                        className="min-w-0 flex-1"
                        aria-label="麦克风"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {microphoneOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="lg"
                      type="button"
                      aria-pressed={testingMicrophone}
                      onClick={toggleMicrophoneTest}
                      className="text-[12px]"
                    >
                      <Mic size={12} />{" "}
                      {testingMicrophone ? "停止测试" : "开始测试"}
                    </Button>
                  </div>
                  <Progress
                    className="mt-2 gap-0"
                    aria-label="麦克风音量"
                    value={Math.max(
                      testingMicrophone ? 3 : 0,
                      microphoneLevel * 100
                    )}
                  />
                </div>
              </SettingRow>
              {microphoneMessage ? (
                <div className="px-5 py-3">
                  <Feedback message={microphoneMessage} />
                </div>
              ) : null}
            </SettingsSection>
            <SettingsSection
              id="overlay"
              title="悬浮窗"
              description="选择听写状态悬浮窗出现的位置。"
            >
              <SettingRow
                title="显示位置"
                description="固定在屏幕底部、左侧或右侧。"
                changed={isSettingChanged("overlayPosition")}
              >
                <ToggleGroup
                  className={`relative isolate grid w-full max-w-102.5 grid-cols-3 overflow-hidden before:pointer-events-none before:absolute before:inset-y-1 before:left-1 before:z-0 before:w-[calc(33.333333%-5.333px)] before:rounded-[8px] before:border before:border-border before:bg-card before:shadow-(--control-shadow) before:transition-transform before:duration-(--vp-duration-layout) before:ease-(--vp-ease-spring) before:content-[''] motion-reduce:before:transition-none ${
                    settings.overlayPosition === "left"
                      ? "before:translate-x-[calc(100%+4px)]"
                      : settings.overlayPosition === "right"
                        ? "before:translate-x-[calc(200%+8px)]"
                        : ""
                  }`}
                  value={[settings.overlayPosition]}
                  onValueChange={(values) => {
                    const value = values[0] as
                      | AppSettings["overlayPosition"]
                      | undefined;
                    if (value) updateSetting("overlayPosition", value);
                  }}
                  aria-label="悬浮窗位置"
                >
                  {(
                    [
                      ["bottom", "底部"],
                      ["left", "左侧"],
                      ["right", "右侧"],
                    ] as const
                  ).map(([value, label]) => (
                    <ToggleGroupItem
                      key={value}
                      className="vp-segment-item relative z-1 h-9 w-full text-[12px] hover:text-foreground"
                      value={value}
                    >
                      {label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </SettingRow>
            </SettingsSection>
          </>
        );
      }
      case "recognition": {
        return (
          <SettingsSection
            id="recognition"
            title="语音识别"
            description="连接识别服务，并提高人名和专业词汇的准确率。"
          >
            <SettingRow
              title="豆包 API Key"
              description="从火山引擎控制台获取，用于语音识别和云端常用词同步。"
              changed={isSettingChanged("apiKey")}
            >
              <div className="w-full max-w-102.5">
                <div className="vp-motion-control flex h-10 items-center overflow-hidden rounded-[10px] border border-input bg-card transition-[background-color,border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20">
                  <Input
                    className="h-10 min-w-0 flex-1 border-0 bg-transparent px-3 shadow-none focus-visible:ring-0"
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
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          type="button"
                          className="mr-1 text-muted-foreground"
                        />
                      }
                      onClick={() => {
                        setShowApiKey(!showApiKey);
                      }}
                      aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                    >
                      {showApiKey ? <EyeOff size={13} /> : <Eye size={13} />}
                    </TooltipTrigger>
                    <TooltipContent>
                      {showApiKey ? "隐藏 API Key" : "显示 API Key"}
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="mt-2 flex items-center justify-end gap-3">
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto px-0 text-[11px]"
                    type="button"
                    onClick={() => void openConsole()}
                  >
                    获取 API Key <ExternalLink size={10} />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-[11px]"
                    type="button"
                    onClick={() => void testDoubao()}
                    disabled={testingDoubao || !settings.apiKey.trim()}
                  >
                    <Activity size={11} />{" "}
                    {testingDoubao ? "连接中…" : "测试连接"}
                  </Button>
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
              title="常用词"
              description="添加人名、产品名和术语；保存时同步到火山引擎。"
              vertical
              changed={isSettingChanged("hotwordsEnabled") || hotwordsChanged}
            >
              <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={settings.hotwordsEnabled}
                    onCheckedChange={(checked) => {
                      updateSetting("hotwordsEnabled", checked);
                    }}
                    aria-labelledby="hotwords-enabled-label"
                  />
                  <span
                    id="hotwords-enabled-label"
                    className="text-[11px] font-semibold text-foreground"
                  >
                    听写时使用
                  </span>
                </div>
                <Badge
                  className={`h-5.5 px-2 text-[10px] ${HOTWORD_CHIP_CLASS[hotwordChipState.tone]}`}
                  role="status"
                  aria-live="polite"
                >
                  {hotwordChipState.label}
                </Badge>
                <span className="text-[10px] text-muted-foreground">
                  本机 {localHotwords.length} · 云端 {cloudHotwords.length}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  上限 {hotwordStatus.limit}
                </span>
                <div className="ml-auto flex items-center gap-3">
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto px-0 text-[11px]"
                    type="button"
                    onClick={() => void refreshHotwords()}
                    disabled={checkingHotwords}
                  >
                    {checkingHotwords ? "检查中…" : "重新检查"}
                  </Button>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto px-0 text-[11px]"
                    type="button"
                    onClick={clearHotwords}
                    disabled={!hotwordsText.trim()}
                  >
                    清空
                  </Button>
                </div>
              </div>
              <Textarea
                className="min-h-32 resize-y text-[12px] leading-6"
                value={hotwordsText}
                onChange={(event) => {
                  updateHotwordsText(event.target.value);
                }}
                placeholder={"VoicePaste\nTauri\nTanStack"}
                rows={6}
              />
              <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
                每行一个词，不支持词内空格。关闭“听写时使用”只停用识别加权，不会删除云端词表。
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
                      className="text-[11px] leading-5 text-muted-foreground"
                      key={table.name}
                    >
                      {table.name}（{table.wordCount} 词）
                    </li>
                  ))}
                </ul>
                <div className="flex">
                  <Button
                    variant="outline"
                    size="lg"
                    className="text-[11px]"
                    type="button"
                    onClick={() => void openConsole()}
                  >
                    <ExternalLink size={11} /> 打开控制台
                  </Button>
                </div>
              </SettingRow>
            ) : null}
          </SettingsSection>
        );
      }
      case "processing": {
        return (
          <SettingsSection
            id="processing"
            title="智能文本处理"
            description="用 OpenAI 兼容服务校对或改写识别文本。"
          >
            <SettingRow
              title="启用 LLM 后处理"
              description="识别完成后将文本发送到已配置的 LLM 服务；通常会增加数秒等待时间。"
              changed={isLlmSettingChanged("enabled")}
            >
              <Switch
                checked={settings.llm.enabled}
                onCheckedChange={(checked) => {
                  updateLlmSetting("enabled", checked);
                }}
                aria-label="启用 LLM 后处理"
              />
            </SettingRow>
            <div
              className={`vp-motion-layout grid transition-[grid-template-rows] motion-reduce:transition-none ${
                settings.llm.enabled ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
              }`}
              inert={!settings.llm.enabled}
              aria-hidden={!settings.llm.enabled}
            >
              <div className="min-h-0 overflow-hidden">
                <div
                  className={`vp-motion-layout divide-y divide-border transition-[transform,opacity] motion-reduce:transition-none ${
                    settings.llm.enabled
                      ? "translate-y-0 opacity-100"
                      : "-translate-y-2 opacity-0"
                  }`}
                >
                  <SettingRow
                    title="API 基础地址"
                    description="填写 OpenAI 兼容服务的 API 地址。"
                    changed={isLlmSettingChanged("baseUrl")}
                  >
                    <div className="w-full max-w-102.5">
                      <Input
                        aria-label="LLM API 基础地址"
                        className="text-[12px]"
                        type="url"
                        value={settings.llm.baseUrl}
                        onChange={(event) => {
                          updateLlmSetting("baseUrl", event.target.value);
                          setAvailableLlmModels([]);
                          setLlmModelsMessage(null);
                        }}
                        placeholder={LLM_BASE_URL_PLACEHOLDER}
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </div>
                  </SettingRow>
                  <SettingRow
                    title="API Key"
                    description="保存在系统凭据库；本地服务不需要鉴权时可以留空。"
                    changed={isLlmSettingChanged("apiKey")}
                  >
                    <div className="vp-motion-control flex h-10 w-full max-w-102.5 items-center overflow-hidden rounded-[10px] border border-input bg-card transition-[background-color,border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20">
                      <Input
                        aria-label="LLM API Key"
                        className="h-10 min-w-0 flex-1 border-0 bg-transparent px-3 text-[12px] shadow-none focus-visible:ring-0"
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
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              type="button"
                              className="mr-1 text-muted-foreground"
                            />
                          }
                          onClick={() => {
                            setShowLlmApiKey(!showLlmApiKey);
                          }}
                          aria-label={
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
                        </TooltipTrigger>
                        <TooltipContent>
                          {showLlmApiKey
                            ? "隐藏 LLM API Key"
                            : "显示 LLM API Key"}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </SettingRow>
                  <SettingRow
                    title="模型"
                    description="填写模型名称，或从服务获取可用模型列表。"
                    changed={isLlmSettingChanged("model")}
                  >
                    <div className="w-full max-w-102.5">
                      <div className="flex gap-2">
                        <Combobox
                          items={filteredLlmModels}
                          filter={null}
                          inputValue={settings.llm.model}
                          value={settings.llm.model || null}
                          onInputValueChange={(value) => {
                            updateLlmSetting("model", value);
                          }}
                          onValueChange={(value) => {
                            if (value !== null)
                              updateLlmSetting("model", value);
                          }}
                        >
                          <ComboboxInput
                            aria-label="LLM 模型"
                            className="min-w-0 flex-1 text-[12px]"
                            placeholder={LLM_MODEL_PLACEHOLDER}
                            autoComplete="off"
                            spellCheck={false}
                            showTrigger={availableLlmModels.length > 0}
                          />
                          <ComboboxContent>
                            {availableLlmModels.length > 0 &&
                            filteredLlmModels.length === 0 ? (
                              <ComboboxEmpty>
                                未在列表中找到，仍可直接使用此名称
                              </ComboboxEmpty>
                            ) : null}
                            <ComboboxList>
                              {filteredLlmModels.map((model) => (
                                <ComboboxItem key={model} value={model}>
                                  {model}
                                </ComboboxItem>
                              ))}
                            </ComboboxList>
                          </ComboboxContent>
                        </Combobox>
                        <Button
                          variant="outline"
                          size="lg"
                          className="text-[11px]"
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
                        </Button>
                      </div>
                      <Feedback message={llmModelsMessage} className="mt-2" />
                    </div>
                  </SettingRow>
                  <SettingRow
                    title="流式显示"
                    description="边生成边在悬浮窗显示最终文本；服务不支持流式响应时请关闭。"
                    changed={isLlmSettingChanged("streaming")}
                  >
                    <Switch
                      checked={settings.llm.streaming}
                      onCheckedChange={(checked) => {
                        updateLlmSetting("streaming", checked);
                      }}
                      aria-label="启用 LLM 流式显示"
                    />
                  </SettingRow>
                  <SettingRow
                    title="请求参数"
                    description="使用预设控制常见推理选项；其它服务参数可在高级 JSON 中配置。"
                    changed={isLlmSettingChanged("extraParameters")}
                    vertical
                  >
                    <div className="flex items-center gap-2">
                      <Select
                        items={llmParameterPresetOptions}
                        value={selectedLlmParameterPreset}
                        onValueChange={(value) => {
                          if (value === null) return;
                          const preset = LLM_PARAMETER_PRESETS.find(
                            ({ id }) => id === value
                          );
                          if (!preset) return;
                          setEditingCustomLlmParameters(false);
                          updateLlmSetting(
                            "extraParameters",
                            preset.parameters
                          );
                        }}
                      >
                        <SelectTrigger
                          aria-label="LLM 参数预设"
                          className="h-9 min-w-0 flex-1 text-[12px]"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {llmParameterPresetOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="outline"
                        size="lg"
                        className="text-[11px]"
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
                      </Button>
                    </div>
                    {selectedLlmParameterPresetDetails ? (
                      <p className="mt-2 rounded-[10px] bg-muted/70 px-3 py-2.5 text-[10px] leading-4 text-muted-foreground">
                        {selectedLlmParameterPresetDetails.description}
                      </p>
                    ) : (
                      <p className="mt-2 rounded-[10px] bg-muted/70 px-3 py-2.5 text-[10px] leading-4 text-muted-foreground">
                        当前使用自定义 JSON 参数。
                      </p>
                    )}
                    <div
                      className={`vp-motion-layout grid transition-[grid-template-rows] motion-reduce:transition-none ${
                        editingCustomLlmParameters
                          ? "grid-rows-[1fr]"
                          : "grid-rows-[0fr]"
                      }`}
                      inert={!editingCustomLlmParameters}
                      aria-hidden={!editingCustomLlmParameters}
                    >
                      <div className="min-h-0 overflow-hidden">
                        <div
                          className={`vp-motion-layout mt-2 rounded-[12px] bg-muted/55 p-3 transition-[transform,opacity] motion-reduce:transition-none ${
                            editingCustomLlmParameters
                              ? "translate-y-0 opacity-100"
                              : "-translate-y-2 opacity-0"
                          }`}
                        >
                          <Textarea
                            aria-label="LLM 高级自定义 JSON 参数"
                            className="min-h-24 resize-y font-mono text-[11px] leading-5"
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
                            <Badge
                              variant="outline"
                              className={`h-5.5 min-w-0 text-[10px] ${
                                customLlmParameterError
                                  ? "border-[#e8b7b0] bg-[#fff0ee] text-[#a33a31]"
                                  : "border-[#a9d8c4] bg-[#eaf8f1] text-[#55705f]"
                              }`}
                              role={
                                customLlmParameterError ? "alert" : "status"
                              }
                            >
                              {customLlmParameterError ??
                                (settings.llm.extraParameters.trim()
                                  ? "JSON 对象有效"
                                  : "空内容不会附加参数")}
                            </Badge>
                            <div className="flex shrink-0 gap-3">
                              <Button
                                variant="link"
                                size="sm"
                                className="h-auto px-0 text-[11px]"
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
                              </Button>
                              <Button
                                variant="link"
                                size="sm"
                                className="h-auto px-0 text-[11px]"
                                type="button"
                                onClick={() => {
                                  setEditingCustomLlmParameters(false);
                                  updateLlmSetting("extraParameters", "");
                                }}
                              >
                                恢复服务默认
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
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
                    <Textarea
                      aria-label="LLM 表达偏好"
                      className="min-h-32 resize-y text-[12px] leading-6"
                      value={settings.llm.prompt}
                      onChange={(event) => {
                        updateLlmSetting("prompt", event.target.value);
                      }}
                      placeholder={DEFAULT_LLM_PREFERENCE}
                      maxLength={8000}
                      rows={6}
                    />
                    <Alert
                      className="mt-2 border-[#ead9a4] bg-[#fff8df] px-3 py-2 text-[#765b12]"
                      role="status"
                    >
                      <AlertDescription className="text-[10px] leading-4 text-inherit">
                        启用后，识别文本和表达偏好会发送到你配置的第三方服务，最终输入通常会增加数秒等待。处理失败时会自动使用原始识别文本。
                      </AlertDescription>
                    </Alert>
                  </SettingRow>
                </div>
              </div>
            </div>
          </SettingsSection>
        );
      }
      case "diagnostics": {
        return (
          <SettingsSection
            id="diagnostics"
            title="输入链路检查"
            description="确认系统权限、麦克风和自动粘贴是否正常。"
          >
            <PermissionRow
              title="全局快捷键"
              icon={<Command size={17} strokeWidth={2.1} />}
              iconClassName="bg-accent text-accent-foreground"
              state={shortcutPermissionState}
              detail={shortcutPermissionDetail}
            />
            <PermissionRow
              title="麦克风"
              icon={<Mic size={17} strokeWidth={2.1} />}
              iconClassName="bg-[#e8f3ff] text-[#2878c7]"
              state={microphonePermissionState}
              detail={microphonePermissionDetail}
            />
            <PermissionRow
              title="自动粘贴"
              icon={<ClipboardPaste size={17} strokeWidth={2.1} />}
              iconClassName="bg-[#eaf8f1] text-[#21885b]"
              state={inputPermissionState}
              detail={inputPermissionDetail}
            />
            <div className="flex justify-end gap-2 px-5 py-3">
              <Button
                variant="outline"
                size="lg"
                className="text-[11px]"
                type="button"
                onClick={() => {
                  setMessage(null);
                  void refreshDiagnostics();
                }}
              >
                <RefreshCw size={11} /> 重新检查
              </Button>
              {diagnostics && !diagnostics.inputReady ? (
                <Button
                  variant="outline"
                  size="lg"
                  className="border-primary/25 bg-accent text-[11px] text-accent-foreground"
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
                </Button>
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
                  <Button
                    size="lg"
                    type="button"
                    onClick={() => void installUpdate()}
                    disabled={installingUpdate}
                  >
                    <Download size={11} />{" "}
                    {installingUpdate
                      ? "安装中…"
                      : `安装 ${updateInfo.version}`}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="lg"
                    className="text-[11px]"
                    type="button"
                    onClick={() => void checkForUpdate(true)}
                    disabled={checkingUpdate}
                  >
                    <RefreshCw
                      className={checkingUpdate ? "animate-spin" : undefined}
                      size={11}
                    />{" "}
                    {checkingUpdate ? "检查中…" : "检查更新"}
                  </Button>
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
                <Button
                  variant="outline"
                  size="lg"
                  className="text-[11px]"
                  type="button"
                  onClick={() => void runAboutAction("open_log_dir")}
                >
                  <FolderOpen size={11} /> 打开目录
                </Button>
              </SettingRow>
              <SettingRow
                title="诊断信息"
                description="复制版本、快捷键、自动粘贴和系统信息，不包含 API Key。"
              >
                <Button
                  variant="outline"
                  size="lg"
                  className="text-[11px]"
                  type="button"
                  onClick={() =>
                    void runAboutAction("copy_diagnostics", "诊断信息已复制")
                  }
                >
                  <Copy size={11} /> 复制诊断信息
                </Button>
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
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto px-0 text-[11px]"
                    type="button"
                    onClick={() => void openProductLink(target)}
                  >
                    {action} <ExternalLink size={10} />
                  </Button>
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
        <main className="vp-app-frame grid h-screen w-screen place-items-center p-8 text-foreground">
          <div className="w-full max-w-150 animate-pulse">
            <div className="h-4 w-24 rounded bg-foreground/10" />
            <div className="mt-3 h-8 w-48 rounded-lg bg-foreground/12" />
            <div className="mt-8 space-y-2 rounded-[16px] border border-border bg-card/70 p-5">
              <div className="h-14 rounded-xl bg-foreground/5.5" />
              <div className="h-14 rounded-xl bg-foreground/5.5" />
              <div className="h-14 rounded-xl bg-foreground/5.5" />
            </div>
            <p className="mt-5 text-[12px] text-muted-foreground">
              正在读取设置…
            </p>
          </div>
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
      <TooltipProvider delay={400}>
        {settingsToaster}
        {hotwordConflictDialog}
        <main className="vp-app-frame vp-stable-scroll h-screen w-screen overflow-auto bg-background text-foreground">
          <header className="border-b border-border bg-card px-8 py-5 max-[720px]:px-5">
            <div className="mx-auto flex max-w-260 items-center gap-8 max-[860px]:flex-col max-[860px]:items-stretch max-[860px]:gap-5">
              <div className="flex shrink-0 items-center gap-3">
                <img
                  src={appIconUrl}
                  alt=""
                  aria-hidden="true"
                  className="size-10 rounded-[12px] shadow-[0_8px_22px_rgba(50,58,92,0.14)]"
                  draggable={false}
                />
                <div>
                  <strong className="block text-[14px] font-semibold tracking-[-0.02em]">
                    VoicePaste
                  </strong>
                  <small className="mt-0.5 block text-[10px] text-muted-foreground">
                    首次设置
                  </small>
                </div>
              </div>

              <ol
                className="flex min-w-0 flex-1 items-center overflow-x-auto"
                aria-label="首次设置进度"
              >
                {ONBOARDING_STEPS.map((label, index) => {
                  const active = onboardingStep === index;
                  const complete = onboardingStep > index;
                  return (
                    <li
                      className="flex min-w-28 flex-1 items-center last:flex-none"
                      key={label}
                    >
                      <Button
                        variant="ghost"
                        className={`h-9 shrink-0 gap-2 px-2.5 text-[11px] ${
                          active
                            ? "bg-accent text-foreground"
                            : complete
                              ? "text-foreground"
                              : "text-muted-foreground"
                        }`}
                        type="button"
                        aria-current={active ? "step" : undefined}
                        disabled={!complete && !active}
                        onClick={() => {
                          goToOnboardingStep(index);
                        }}
                      >
                        <span
                          className={`vp-motion-control grid size-5 shrink-0 place-items-center rounded-full text-[10px] transition-[background-color,color,transform] ${
                            active
                              ? "scale-105 bg-primary text-primary-foreground"
                              : complete
                                ? "bg-foreground text-background"
                                : "bg-muted text-muted-foreground"
                          }`}
                          aria-hidden="true"
                        >
                          {complete ? <CheckCircle2 size={12} /> : index + 1}
                        </span>
                        {label}
                      </Button>
                      {index < ONBOARDING_STEPS.length - 1 ? (
                        <span
                          className={`vp-motion-layout mx-2 h-px min-w-5 flex-1 transition-colors ${
                            complete ? "bg-primary/45" : "bg-border"
                          }`}
                          aria-hidden="true"
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </div>
          </header>

          <section className="min-h-[calc(100%-81px)] px-8 py-10 max-[720px]:px-5 max-[720px]:py-7">
            <div className="mx-auto flex min-h-[calc(100vh-162px)] max-w-210 flex-col justify-center">
              <div key={onboardingStep} className="vp-section-enter w-full">
                {onboardingStep === 0 ? (
                  <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
                    <div>
                      <p className="text-[11px] font-semibold tracking-[0.08em] text-primary">
                        欢迎使用 VoicePaste
                      </p>
                      <h1
                        ref={onboardingHeadingRef}
                        className="mt-3 max-w-150 text-[44px] leading-[1.08] font-semibold tracking-[-0.055em] text-balance text-foreground outline-none max-[720px]:text-[36px]"
                        tabIndex={-1}
                      >
                        说完，文字已经在光标处
                      </h1>
                      <p className="mt-5 max-w-135 text-[14px] leading-7 text-pretty text-muted-foreground">
                        在任意应用按下快捷键开始听写。完成识别服务、快捷键和麦克风设置后即可使用。
                      </p>
                      <Feedback message={onboardingMessage} className="mt-5" />
                      <div className="mt-8">
                        <Button
                          size="lg"
                          type="button"
                          onClick={() => {
                            goToOnboardingStep(1);
                          }}
                        >
                          开始设置 <ChevronRight size={13} />
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-[16px] bg-foreground p-6 text-background shadow-[0_24px_70px_rgba(23,26,34,0.18)]">
                      <div className="flex items-center gap-3">
                        <img
                          src={appIconUrl}
                          alt=""
                          aria-hidden="true"
                          className="size-11 rounded-[13px]"
                          draggable={false}
                        />
                        <div>
                          <p className="text-[13px] font-semibold">
                            一次快捷键
                          </p>
                          <p className="mt-1 text-[11px] text-background/55">
                            从声音到文字
                          </p>
                        </div>
                      </div>
                      <ol className="mt-8 grid gap-5">
                        {(
                          [
                            [Command, "按下快捷键", "在当前输入框开始"],
                            [Mic, "自然说话", "实时识别你的声音"],
                            [ClipboardPaste, "自动输入", "结果回到光标位置"],
                          ] as const
                        ).map(([Icon, title, description], index) => (
                          <li className="flex items-center gap-4" key={title}>
                            <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-primary text-primary-foreground">
                              <Icon size={16} strokeWidth={1.9} />
                            </span>
                            <div>
                              <p className="text-[12px] font-semibold">
                                {title}
                              </p>
                              <p className="mt-0.5 text-[10px] text-background/55">
                                {description}
                              </p>
                            </div>
                            <span className="ml-auto font-mono text-[10px] text-background/60">
                              0{index + 1}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </div>
                ) : null}

                {onboardingStep === 1 ? (
                  <div>
                    <p className="text-[11px] font-semibold tracking-[0.08em] text-primary">
                      第 1 步
                    </p>
                    <h1
                      ref={onboardingHeadingRef}
                      className="mt-2 text-[27px] leading-8 font-semibold tracking-[-0.04em] outline-none"
                      tabIndex={-1}
                    >
                      配置语音识别服务
                    </h1>
                    <p className="mt-3 text-[13px] leading-6 text-pretty text-muted-foreground">
                      使用你自己的火山引擎 API
                      Key。凭据将安全保存在系统凭据库中，用于语音识别和常用词同步。
                    </p>

                    <label
                      className="mt-7 block text-[12px] font-semibold text-foreground"
                      htmlFor="onboarding-api-key"
                    >
                      豆包 API Key
                    </label>
                    <div className="vp-motion-control mt-2 flex h-10 items-center overflow-hidden rounded-[10px] border border-input bg-card transition-[background-color,border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20">
                      <Input
                        id="onboarding-api-key"
                        className="h-10 min-w-0 flex-1 border-0 bg-transparent px-3 shadow-none focus-visible:ring-0"
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
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              type="button"
                              className="mr-1 text-muted-foreground"
                            />
                          }
                          onClick={() => {
                            setShowApiKey(!showApiKey);
                          }}
                          aria-label={
                            showApiKey ? "隐藏 API Key" : "显示 API Key"
                          }
                        >
                          {showApiKey ? (
                            <EyeOff size={13} />
                          ) : (
                            <Eye size={13} />
                          )}
                        </TooltipTrigger>
                        <TooltipContent>
                          {showApiKey ? "隐藏 API Key" : "显示 API Key"}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto px-0 text-[11px]"
                        type="button"
                        onClick={() => void openConsole()}
                      >
                        获取 API Key <ExternalLink size={10} />
                      </Button>
                      <Button
                        variant="outline"
                        size="lg"
                        className="text-[11px]"
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
                      </Button>
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
                      <Button
                        variant="outline"
                        size="lg"
                        className="text-[11px]"
                        type="button"
                        onClick={() => {
                          goToOnboardingStep(0);
                        }}
                      >
                        <ChevronLeft size={12} /> 返回
                      </Button>
                      <Button
                        size="lg"
                        type="button"
                        onClick={() => {
                          goToOnboardingStep(2);
                        }}
                        disabled={!apiKeyVerified || testingDoubao}
                      >
                        继续 <ChevronRight size={13} />
                      </Button>
                    </div>
                  </div>
                ) : null}

                {onboardingStep === 2 ? (
                  <div>
                    <p className="text-[11px] font-semibold tracking-[0.08em] text-primary">
                      第 2 步
                    </p>
                    <h1
                      ref={onboardingHeadingRef}
                      className="mt-2 text-[27px] leading-8 font-semibold tracking-[-0.04em] outline-none"
                      tabIndex={-1}
                    >
                      录制全局快捷键
                    </h1>
                    <p className="mt-3 text-[13px] leading-6 text-muted-foreground">
                      点击下方按钮，再按下包含修饰键的组合键。
                    </p>

                    <div className="mt-7 rounded-[14px] bg-muted/60 p-5 ring-1 ring-foreground/7">
                      <div className="flex items-center justify-between gap-5">
                        <div>
                          <p className="text-[12px] font-semibold text-foreground">
                            开始听写
                          </p>
                          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                            可在任何应用的输入框中使用
                          </p>
                        </div>
                        <Button
                          ref={shortcutButtonRef}
                          variant="outline"
                          size="lg"
                          className={`min-w-47.5 font-mono text-[11px] ${
                            shortcutRecorder.isRecording
                              ? "border-primary/55 bg-accent text-accent-foreground ring-3 ring-ring/15"
                              : ""
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
                        </Button>
                      </div>
                    </div>
                    <Feedback message={onboardingMessage} className="mt-4" />
                    <div className="mt-7 flex items-center justify-between">
                      <Button
                        variant="outline"
                        size="lg"
                        className="text-[11px]"
                        type="button"
                        onClick={() => {
                          goToOnboardingStep(1);
                        }}
                      >
                        <ChevronLeft size={12} /> 返回
                      </Button>
                      <Button
                        size="lg"
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
                      </Button>
                    </div>
                  </div>
                ) : null}

                {onboardingStep === 3 ? (
                  <div>
                    <p className="text-[11px] font-semibold tracking-[0.08em] text-primary">
                      第 3 步
                    </p>
                    <h1
                      ref={onboardingHeadingRef}
                      className="mt-2 text-[27px] leading-8 font-semibold tracking-[-0.04em] outline-none"
                      tabIndex={-1}
                    >
                      选择麦克风
                    </h1>
                    <p className="mt-3 text-[13px] leading-6 text-pretty text-muted-foreground">
                      系统默认麦克风通常即可；测试时说一句话确认音量响应。
                    </p>

                    <label
                      className="mt-7 block text-[12px] font-semibold text-foreground"
                      htmlFor="onboarding-microphone"
                    >
                      输入设备
                    </label>
                    <div className="mt-2 flex gap-2">
                      <Select
                        items={microphoneOptions}
                        value={
                          settings.microphoneId || DEFAULT_MICROPHONE_VALUE
                        }
                        onValueChange={(value) => {
                          if (value === null) return;
                          updateSetting(
                            "microphoneId",
                            value === DEFAULT_MICROPHONE_VALUE ? "" : value
                          );
                          setMicrophoneMessage(null);
                        }}
                        disabled={testingMicrophone}
                      >
                        <SelectTrigger
                          id="onboarding-microphone"
                          className="min-w-0 flex-1"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {microphoneOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="outline"
                        size="lg"
                        className="text-[11px]"
                        type="button"
                        aria-pressed={testingMicrophone}
                        onClick={toggleMicrophoneTest}
                      >
                        <Mic size={11} />{" "}
                        {testingMicrophone ? "停止测试" : "开始测试"}
                      </Button>
                    </div>
                    <Progress
                      className="mt-3 gap-0"
                      aria-label="麦克风音量"
                      value={Math.max(
                        testingMicrophone ? 3 : 0,
                        microphoneLevel * 100
                      )}
                    />
                    <Feedback message={microphoneMessage} className="mt-4" />
                    <div className="mt-7 flex items-center justify-between">
                      <Button
                        variant="outline"
                        size="lg"
                        className="text-[11px]"
                        type="button"
                        onClick={() => {
                          goToOnboardingStep(2);
                        }}
                        disabled={testingMicrophone}
                      >
                        <ChevronLeft size={12} /> 返回
                      </Button>
                      <Button
                        size="lg"
                        type="button"
                        onClick={() => {
                          goToOnboardingStep(4);
                        }}
                        disabled={testingMicrophone}
                      >
                        继续 <ChevronRight size={13} />
                      </Button>
                    </div>
                  </div>
                ) : null}

                {onboardingStep === 4 ? (
                  <div>
                    <div
                      className="vp-state-pop mb-6 grid size-12 place-items-center rounded-[14px] bg-[#eaf8f1] text-[#17633f]"
                      aria-hidden="true"
                    >
                      <CheckCircle2 size={24} strokeWidth={1.9} />
                    </div>
                    <p className="text-[11px] font-semibold tracking-[0.08em] text-primary">
                      设置完成
                    </p>
                    <h1
                      ref={onboardingHeadingRef}
                      className="mt-2 text-[27px] leading-8 font-semibold tracking-[-0.04em] outline-none"
                      tabIndex={-1}
                    >
                      VoicePaste 已准备就绪
                    </h1>
                    <p className="mt-3 text-[13px] leading-6 text-muted-foreground">
                      确认以下设置，完成后可立即使用快捷键开始听写。
                    </p>

                    <dl className="mt-7 divide-y divide-foreground/7 overflow-hidden rounded-[14px] bg-muted/55 text-[12px] ring-1 ring-foreground/7">
                      <div className="flex items-center justify-between gap-5 px-4 py-3.5">
                        <dt className="text-muted-foreground">识别服务</dt>
                        <dd>
                          <Badge className="bg-[#eaf8f1] text-[#17633f]">
                            语音识别和常用词已验证
                          </Badge>
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-5 px-4 py-3.5">
                        <dt className="text-muted-foreground">快捷键</dt>
                        <dd>
                          <ShortcutHint shortcut={settings.shortcut} />
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-5 px-4 py-3.5">
                        <dt className="text-muted-foreground">麦克风</dt>
                        <dd className="max-w-xs truncate font-semibold text-foreground">
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
                      <Button
                        variant="outline"
                        size="lg"
                        className="text-[11px]"
                        type="button"
                        onClick={() => {
                          goToOnboardingStep(3);
                        }}
                        disabled={saving}
                      >
                        <ChevronLeft size={12} /> 返回修改
                      </Button>
                      <Button
                        size="lg"
                        type="button"
                        onClick={(event) => {
                          hotwordConflictReturnFocusRef.current =
                            event.currentTarget;
                          void finishOnboarding();
                        }}
                        disabled={saving}
                      >
                        {saving ? "正在同步设置…" : "完成设置"}{" "}
                        <CheckCircle2 size={13} />
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        </main>
      </TooltipProvider>
    );
  }

  return (
    // oxlint-disable-next-line react/jsx-no-constructed-context-values -- renderer must capture current settings state
    <SettingsOutletContext.Provider value={renderSection}>
      <TooltipProvider delay={400}>
        {settingsToaster}
        {hotwordConflictDialog}
        <div className="vp-app-frame grid h-screen w-screen grid-cols-[200px_minmax(0,1fr)] overflow-hidden bg-background text-foreground">
          <aside className="flex min-h-0 flex-col border-r border-border bg-card px-3.5 py-4">
            <div className="flex items-center gap-3 px-2 py-1.5">
              <img
                src={appIconUrl}
                alt=""
                aria-hidden="true"
                className="size-9 shrink-0 rounded-[11px] shadow-[0_6px_18px_rgba(50,58,92,0.14)]"
                draggable={false}
              />
              <div className="min-w-0">
                <strong className="block truncate text-[13px] font-semibold tracking-[-0.02em]">
                  VoicePaste
                </strong>
                <span className="mt-0.5 block text-[10px] text-muted-foreground">
                  设置
                </span>
              </div>
            </div>

            <nav
              className={`relative isolate mt-7 grid gap-1 before:pointer-events-none before:absolute before:top-0 before:left-0 before:z-0 before:h-10 before:w-full before:rounded-[11px] before:bg-accent before:transition-transform before:duration-(--vp-duration-layout) before:ease-(--vp-ease-spring) before:content-[''] motion-reduce:before:transition-none ${SECTION_INDICATOR_POSITION[activeSection]}`}
              aria-label="设置分类"
            >
              {SECTIONS.map(([id, label, Icon]) => (
                <Link
                  key={id}
                  activeOptions={{ exact: true }}
                  activeProps={{
                    className: "text-foreground",
                  }}
                  className="group vp-motion-control relative z-1 flex h-10 w-full items-center gap-2.5 rounded-[11px] bg-transparent px-3 text-left text-[12px] font-medium transition-[background-color,color,transform] focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-ring active:scale-[0.98]"
                  inactiveProps={{
                    className:
                      "text-muted-foreground hover:bg-muted/65 hover:text-foreground",
                  }}
                  to={SETTINGS_PATHS[id]}
                  onClick={() => {
                    toast.dismiss(SETTINGS_TOAST_ID);
                  }}
                >
                  {({ isActive }) => (
                    <>
                      <span
                        className={`vp-motion-control absolute inset-y-2 left-0 w-0.5 origin-center rounded-full transition-[background-color,transform] ${
                          isActive
                            ? "scale-y-100 bg-primary"
                            : "scale-y-0 bg-transparent"
                        }`}
                        aria-hidden="true"
                      />
                      <Icon
                        className={`vp-motion-control transition-transform ${
                          isActive ? "scale-105" : "scale-100"
                        }`}
                        size={15}
                        strokeWidth={isActive ? 2 : 1.7}
                        aria-hidden="true"
                      />
                      <span className="truncate">{label}</span>
                      {isSectionChanged(id) ? (
                        <span
                          className="vp-state-pop ml-auto size-1.5 rounded-full bg-primary"
                          aria-label="有未保存的修改"
                        />
                      ) : null}
                    </>
                  )}
                </Link>
              ))}
            </nav>

            <div className="mt-auto px-2 pb-1">
              <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                <CheckCircle2 size={12} strokeWidth={1.8} />
                {hasUnsavedChanges ? "有未保存修改" : "设置已保存"}
              </div>
              <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
                关闭窗口后继续在系统托盘运行
              </p>
            </div>
          </aside>

          <div className="flex min-h-0 min-w-0 flex-col">
            <header className="flex shrink-0 items-center justify-between gap-6 border-b border-border bg-background px-9 py-7">
              <div key={activeSection} className="vp-title-enter min-w-0">
                <h1 className="truncate text-[30px] leading-9 font-semibold tracking-[-0.045em] text-foreground">
                  {SECTIONS.find(([id]) => id === activeSection)?.[1] ?? "设置"}
                </h1>
                <p className="mt-1.5 truncate text-[12px] text-muted-foreground">
                  {SECTION_DESCRIPTIONS[activeSection]}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <span
                  className="mr-1 inline-flex h-9 items-center gap-1.5 text-[11px] font-medium text-muted-foreground"
                  aria-live="polite"
                >
                  <span
                    className={`vp-motion-control size-1.5 rounded-full transition-[background-color,transform] ${
                      hasUnsavedChanges
                        ? "scale-100 bg-primary"
                        : "scale-90 bg-muted-foreground/45"
                    }`}
                    aria-hidden="true"
                  />
                  <span
                    key={
                      saving ? "saving" : hasUnsavedChanges ? "dirty" : "saved"
                    }
                    className="vp-feedback-enter"
                  >
                    {saving
                      ? activeSection === "recognition" && cloudDirty
                        ? "正在同步"
                        : "正在保存"
                      : hasUnsavedChanges
                        ? "有未保存修改"
                        : "已保存"}
                  </span>
                </span>
                {activeSection === "shortcut" ? (
                  <Button
                    className="animate-in duration-200 zoom-in-95 fade-in"
                    variant="ghost"
                    type="button"
                    onClick={(event) => {
                      hotwordConflictReturnFocusRef.current =
                        event.currentTarget;
                      void resetVoiceInput();
                    }}
                    disabled={saving}
                  >
                    <RotateCcw size={13} /> 恢复默认
                  </Button>
                ) : null}
                {hasUnsavedChanges ? (
                  <Button
                    type="button"
                    onClick={(event) => {
                      hotwordConflictReturnFocusRef.current =
                        event.currentTarget;
                      void save();
                    }}
                    disabled={saving}
                    className="min-w-26 animate-in duration-200 zoom-in-95 fade-in"
                  >
                    <Save size={13} />{" "}
                    {saving
                      ? activeSection === "recognition" && cloudDirty
                        ? "同步中…"
                        : "保存中…"
                      : "保存更改"}
                  </Button>
                ) : null}
              </div>
            </header>

            <main
              className="vp-stable-scroll min-h-0 flex-1 overflow-auto scroll-smooth p-9"
              data-scroll-restoration-id="settings-content"
            >
              <div
                key={activeSection}
                className="vp-section-enter mx-auto max-w-225"
              >
                <Feedback
                  message={message?.kind === "error" ? message : null}
                  className="mb-6"
                />

                <fieldset
                  className="m-0 min-w-0 border-0 p-0"
                  disabled={saving}
                >
                  {children}
                </fieldset>
              </div>
            </main>
          </div>
        </div>
      </TooltipProvider>
    </SettingsOutletContext.Provider>
  );
}
