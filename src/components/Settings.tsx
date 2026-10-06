import { Link } from "@tanstack/react-router";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  CheckCircle2,
  BookOpen,
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
import { DoubaoTranslation } from "@/components/DoubaoTranslation";
import { RecognitionSettingsPanel } from "@/components/RecognitionSettingsPanel";
import { RecognitionSpeechTest } from "@/components/RecognitionSpeechTest";
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
import { useRecognitionService } from "@/components/useRecognitionService";
import { VolcengineDictionary } from "@/components/VolcengineDictionary";
import {
  hotwordActionMessage,
  replayHotwordChanges,
  hotwordDiff,
  normalizeHotwords,
  uniqueHotwords,
} from "@/hotwords";
import {
  isServiceIssue,
  recognitionConfigurationChanged,
  recognitionReady,
  safeError,
} from "@/recognition";
import { SETTINGS_PATHS } from "@/routes/-settings-navigation";
import type { SettingsSectionId } from "@/routes/-settings-navigation";
import {
  formatShortcut,
  formatShortcutLabel,
  useShortcutRecorder,
} from "@/shortcut";
import { DEFAULT_LLM_PREFERENCE, DEFAULT_SETTINGS } from "@/types";
import type {
  AccountStatus,
  AppSettings,
  HotwordSnapshotResult,
  HotwordSyncStatus,
  LlmSettings,
  RecognitionProvider,
  RecognitionSettings,
  SaveSettingsResult,
  ServiceIssue,
  ServiceIssueLink,
  SystemDiagnostics,
  UpdateInfo,
} from "@/types";

import appIconUrl from "../../src-tauri/icons/app-icon.svg";

const DEFAULT_MICROPHONE_VALUE = "__voicepaste_system_default__";
const CONSOLE_URL = "https://console.volcengine.com/speech/new/setting/apikeys";
const LLM_BASE_URL_PLACEHOLDER = "https://api.deepseek.com/v1";
const LLM_MODEL_PLACEHOLDER = "deepseek-v4-flash";
const SECTIONS = [
  ["shortcut", "语音输入", Command],
  ["recognition", "使用方式", Mic],
  ["dictionary", "词库", BookOpen],
  ["processing", "文本处理", Sparkles],
  ["general", "应用", Settings2],
  ["diagnostics", "系统检查", ShieldCheck],
  ["about", "关于", Info],
] as const;
const SECTION_INDICATOR_POSITION: Record<SettingsSectionId, string> = {
  shortcut: "before:translate-y-0",
  recognition: "before:translate-y-[44px]",
  dictionary: "before:translate-y-[88px]",
  processing: "before:translate-y-[132px]",
  general: "before:translate-y-[176px]",
  diagnostics: "before:translate-y-[220px]",
  about: "before:translate-y-[264px]",
};
const SECTION_DESCRIPTIONS: Record<SettingsSectionId, string> = {
  shortcut: "设置听写方式、快捷键、麦克风和悬浮窗",
  recognition: "选择唯一启用的服务并配置账号或 Key",
  dictionary: "管理当前服务词库；本机草稿与云端应用分开",
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
  account: AccountStatus | null;
  providerRevision: number;
  hotwordStatus: HotwordSyncStatus | null;
  notice?: string;
}
interface HotwordConflict {
  cloudHotwords: string[];
  words: string[];
  reviewToken: string;
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

export function DictionarySettingsPage() {
  return <SettingsRouteSection section="dictionary" />;
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

function llmSettingsChanged(current: LlmSettings, saved: LlmSettings): boolean {
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
    recognitionConfigurationChanged(current.recognition, saved.recognition) ||
    current.shortcut !== saved.shortcut ||
    current.activationMode !== saved.activationMode ||
    current.microphoneId !== saved.microphoneId ||
    current.onboardingCompleted !== saved.onboardingCompleted ||
    current.launchAtStartup !== saved.launchAtStartup ||
    current.openSettingsOnStartup !== saved.openSettingsOnStartup ||
    current.overlayPosition !== saved.overlayPosition ||
    (current.recognition.provider === "doubaoIme" &&
      current.recognition.doubaoIme.smartOrganize !==
        saved.recognition.doubaoIme.smartOrganize) ||
    llmSettingsChanged(
      current.recognition[current.recognition.provider].llm,
      saved.recognition[saved.recognition.provider].llm
    ) ||
    (current.recognition.provider === "volcengine" &&
      hotwordsText !== savedHotwordsText)
  );
}

async function persistSettings(
  nextSettings: AppSettings,
  providerRevision: number
): Promise<SaveSettingsResult> {
  if (!isTauri()) throw new Error("浏览器预览不保存设置；请在桌面版中操作");
  return await invoke<SaveSettingsResult>("save_settings", {
    providerRevision,
    settings: nextSettings,
  });
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
    conflict.words,
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
        className="max-h-[85vh] w-[calc(100%-2.5rem)] max-w-110 gap-0 overflow-y-auto p-0"
      >
        <div className="flex items-start gap-3.5 p-5.5">
          <AlertDialogMedia className="mb-0 size-10 shrink-0 rounded-[12px] bg-[#fff0d5] text-[#7a5100]">
            <Info size={18} />
          </AlertDialogMedia>
          <div className="min-w-0">
            <AlertDialogTitle className="text-[15px] font-semibold tracking-[-0.015em] text-foreground">
              审阅云端常用词差异
            </AlertDialogTitle>
            <AlertDialogDescription className="mt-2 text-left text-[12px] leading-5 text-muted-foreground">
              云端多出 {onlyCloud.length} 个词，本机多出 {onlyLocal.length}{" "}
              个词。先审阅完整差异；保留云端会将本机明确增删重放到新草稿，不会立即上传。
            </AlertDialogDescription>
            {onlyCloud.length > 0 ? (
              <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                云端多出：{onlyCloud.join("、")}
              </p>
            ) : null}
            {onlyLocal.length > 0 ? (
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                本机多出：{onlyLocal.join("、")}
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
            保留云端并重放本机修改
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
  const [providerRevision, setProviderRevision] = useState(-1);
  const providerRevisionRef = useRef(-1);
  const [pendingAction, setPendingAction] = useState<
    RecognitionProvider | "close" | null
  >(null);
  const [switching, setSwitching] = useState(false);
  const [applyingHotwords, setApplyingHotwords] = useState(false);
  const [pendingHotwordApply, setPendingHotwordApply] = useState<{
    words: string[];
    reviewToken: string | null;
  } | null>(null);
  const [cloudConfirmedAt, setCloudConfirmedAt] = useState<string | null>(null);
  const reviewTokenRef = useRef<string | null>(null);
  const [hotwordsText, setHotwordsText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hotwordStatus, setHotwordStatus] = useState<HotwordSyncStatus>(
    DEFAULT_HOTWORD_STATUS
  );
  const [hotwordConflict, setHotwordConflict] =
    useState<HotwordConflict | null>(null);
  const [cloudHotwords, setCloudHotwords] = useState<string[]>([]);
  const [cloudHotwordsVerified, setCloudHotwordsVerified] = useState(false);
  const [checkingHotwords, setCheckingHotwords] = useState(false);
  const [hotwordMessage, setHotwordMessage] = useState<Message>(null);
  const [message, setMessage] = useState<Message>(null);
  const [saveIssue, setSaveIssue] = useState<ServiceIssue | null>(null);
  const [microphoneMessage, setMicrophoneMessage] = useState<Message>(null);
  const [onboardingMessage, setOnboardingMessage] = useState<Message>(null);
  const [showLlmApiKey, setShowLlmApiKey] = useState(false);
  const [editingCustomLlmParameters, setEditingCustomLlmParameters] =
    useState(false);
  const [availableLlmModels, setAvailableLlmModels] = useState<string[]>([]);
  const [loadingLlmModels, setLoadingLlmModels] = useState(false);
  const [llmModelsMessage, setLlmModelsMessage] = useState<Message>(null);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [microphones, setMicrophones] = useState<MicrophoneDevice[]>([]);
  const [testingMicrophone, setTestingMicrophone] = useState(false);
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [recognitionPreviewBusy, setRecognitionPreviewBusy] = useState(false);
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
  const getRecognition = useCallback(() => settingsRef.current.recognition, []);
  const recognitionService = useRecognitionService(
    getRecognition,
    providerRevision
  );
  const { acceptAccount } = recognitionService;

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
          `同步未保存状态失败：${safeError(error, settingsRef.current.recognition.volcengine.apiKey, settingsRef.current.recognition[settingsRef.current.recognition.provider].llm.apiKey)}`
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
    syncDirty(
      settingsChanged(
        next,
        hotwordsTextRef.current,
        savedSettingsRef.current,
        savedHotwordsTextRef.current
      )
    );
  };
  const updateRecognition = (recognition: RecognitionSettings) => {
    const current = settingsRef.current.recognition;
    if (
      current.provider !== recognition.provider ||
      current.volcengine.apiKey !== recognition.volcengine.apiKey
    )
      recognitionService.invalidate();
    setSaveIssue(null);
    setOnboardingMessage(null);
    updateSetting("recognition", recognition);
  };
  const updateVolcengineSetting = <
    Key extends keyof RecognitionSettings["volcengine"],
  >(
    key: Key,
    value: RecognitionSettings["volcengine"][Key]
  ) => {
    const current = settingsRef.current.recognition;
    updateRecognition({
      ...current,
      volcengine: { ...current.volcengine, [key]: value },
    });
  };
  const updateLlmSetting = <Key extends keyof LlmSettings>(
    key: Key,
    value: LlmSettings[Key]
  ) => {
    const current = settingsRef.current.recognition;
    updateSetting("recognition", {
      ...current,
      [current.provider]: {
        ...current[current.provider],
        llm: { ...current[current.provider].llm, [key]: value },
      },
    });
  };

  const updateHotwordsText = (value: string) => {
    hotwordsTextRef.current = value;
    setHotwordsText(value);
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
          settingsRef.current.recognition.volcengine.apiKey,
          settingsRef.current.recognition[
            settingsRef.current.recognition.provider
          ].llm.apiKey
        )
      );
    }
  }, [reportPersistentError]);

  const refreshHotwords = useCallback(async () => {
    const current = settingsRef.current.recognition;
    if (current.provider !== "volcengine") return;
    const { apiKey } = current.volcengine;
    if (apiKey !== savedSettingsRef.current.recognition.volcengine.apiKey) {
      setHotwordMessage({
        kind: "info",
        text: "请先保存 API Key，再检查云端常用词。",
      });
      return;
    }
    if (!isTauri()) {
      setHotwordMessage({
        kind: "error",
        text: "浏览器预览无法检查云端常用词。",
      });
      return;
    }
    setCheckingHotwords(true);
    const revision = providerRevisionRef.current;
    const sourceText = hotwordsTextRef.current;
    const hadDraftEdits = sourceText !== savedHotwordsTextRef.current;
    try {
      const snapshot = await invoke<HotwordSnapshotResult>("refresh_hotwords", {
        providerRevision: revision,
      });
      if (
        revision !== providerRevisionRef.current ||
        apiKey !== savedSettingsRef.current.recognition.volcengine.apiKey
      )
        return;
      setCloudHotwordsVerified(true);
      setHotwordStatus(snapshot.hotwordStatus);
      setCloudHotwords(snapshot.cloudHotwords);
      reviewTokenRef.current = snapshot.reviewToken;
      setCloudConfirmedAt(new Date().toLocaleString());
      for (const ref of [settingsRef, savedSettingsRef]) {
        ref.current = {
          ...ref.current,
          recognition: {
            ...ref.current.recognition,
            volcengine: {
              ...ref.current.recognition.volcengine,
              hotwords: snapshot.confirmedHotwords,
              hotwordDraft: snapshot.hotwordDraft,
            },
          },
        };
      }
      const storedDraft = (
        snapshot.hotwordDraft ?? snapshot.confirmedHotwords
      ).join("\n");
      savedHotwordsTextRef.current = storedDraft;
      if (!hadDraftEdits && hotwordsTextRef.current === sourceText) {
        hotwordsTextRef.current = storedDraft;
        setHotwordsText(storedDraft);
      }
      setSettings(settingsRef.current);
      syncDirty(
        settingsChanged(
          settingsRef.current,
          hotwordsTextRef.current,
          savedSettingsRef.current,
          storedDraft
        )
      );
      setHotwordMessage(null);
    } catch (error) {
      if (
        revision !== providerRevisionRef.current ||
        apiKey !== savedSettingsRef.current.recognition.volcengine.apiKey
      )
        return;
      setHotwordMessage({
        kind: "error",
        text: `无法校验云端词表：${safeError(error, settingsRef.current.recognition.volcengine.apiKey, settingsRef.current.recognition[settingsRef.current.recognition.provider].llm.apiKey)}`,
      });
    } finally {
      if (revision === providerRevisionRef.current) setCheckingHotwords(false);
    }
  }, [syncDirty]);

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
              settingsRef.current.recognition.volcengine.apiKey,
              settingsRef.current.recognition[
                settingsRef.current.recognition.provider
              ].llm.apiKey
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
          settingsRef.current.recognition.volcengine.apiKey,
          settingsRef.current.recognition[
            settingsRef.current.recognition.provider
          ].llm.apiKey
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
      const previewHotwords =
        previewSettings.recognition.volcengine.hotwords.join("\n");
      settingsRef.current = previewSettings;
      savedSettingsRef.current = previewSettings;
      hotwordsTextRef.current = previewHotwords;
      savedHotwordsTextRef.current = previewHotwords;
      setSettings(previewSettings);
      providerRevisionRef.current = 0;
      setProviderRevision(0);
      setHotwordsText(previewHotwords);
      setHotwordStatus(DEFAULT_HOTWORD_STATUS);
      syncDirty(false);
      setLoading(false);
      return;
    }

    invoke<LoadSettingsResult>("load_settings")
      .then(
        ({
          account: loadedAccount,
          hotwordStatus: loadedHotwordStatus,
          settings: loadedSettings,
          notice,
          providerRevision: loadedRevision,
        }) => {
          const loadedHotwords = (
            loadedSettings.recognition.volcengine.hotwordDraft ??
            loadedSettings.recognition.volcengine.hotwords
          ).join("\n");
          settingsRef.current = loadedSettings;
          savedSettingsRef.current = loadedSettings;
          hotwordsTextRef.current = loadedHotwords;
          savedHotwordsTextRef.current = loadedHotwords;
          setSettings(loadedSettings);
          providerRevisionRef.current = loadedRevision;
          setProviderRevision(loadedRevision);
          setHotwordsText(loadedHotwords);
          if (loadedAccount) acceptAccount(loadedAccount);
          setHotwordStatus(loadedHotwordStatus ?? DEFAULT_HOTWORD_STATUS);
          setCloudHotwords(loadedSettings.recognition.volcengine.hotwords);
          syncDirty(false);
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
    acceptAccount,
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
            settingsRef.current.recognition.volcengine.apiKey,
            settingsRef.current.recognition[
              settingsRef.current.recognition.provider
            ].llm.apiKey
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

  const commitSettings = (nextSettings: AppSettings) => {
    settingsRef.current = nextSettings;
    savedSettingsRef.current = nextSettings;
    setSettings(nextSettings);
    syncDirty(hotwordsTextRef.current !== savedHotwordsTextRef.current);
  };

  const startSaving = () => {
    if (savingRef.current) return false;
    if (
      recognitionService.testing ||
      recognitionService.accountBusy ||
      recognitionPreviewBusy ||
      applyingHotwords ||
      switching ||
      checkingHotwords
    ) {
      reportPersistentError("请先结束识别测试或账号操作，再保存设置。");
      return false;
    }
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

  const persistAndCommit = async (
    nextSettings: AppSettings
  ): Promise<SavedSettingsResult> => {
    const result = await persistSettings(
      nextSettings,
      providerRevisionRef.current
    );
    if (result.kind !== "saved") throw new Error("普通设置保存不应修改云词库");
    dirtyRef.current = null;
    const keyChanged =
      nextSettings.recognition.provider === "volcengine" &&
      nextSettings.recognition.volcengine.apiKey !==
        savedSettingsRef.current.recognition.volcengine.apiKey;
    const loaded = await invoke<LoadSettingsResult>("load_settings");
    providerRevisionRef.current = loaded.providerRevision;
    setProviderRevision(loaded.providerRevision);
    commitSettings(loaded.settings);
    if (loaded.hotwordStatus) setHotwordStatus(loaded.hotwordStatus);
    if (keyChanged) {
      if (hotwordsTextRef.current === savedHotwordsTextRef.current) {
        const profile = loaded.settings.recognition.volcengine;
        const draft = (profile.hotwordDraft ?? profile.hotwords).join("\n");
        hotwordsTextRef.current = draft;
        savedHotwordsTextRef.current = draft;
        setHotwordsText(draft);
      }
      setCloudHotwords([]);
      setCloudHotwordsVerified(false);
      setCloudConfirmedAt(null);
      reviewTokenRef.current = null;
      setHotwordMessage({
        kind: "info",
        text: "Key 已更换。旧云词表未删除；请先检查新目标，再确认是否将本机词条应用过去。",
      });
    }
    return result;
  };

  const finishSuccessfulSave = async (source: "onboarding" | "settings") => {
    if (source === "onboarding") {
      selectSection("shortcut");
      showMessage({
        kind: "success",
        text: "设置完成，可以开始使用 VoicePaste",
      });
    } else
      showMessage({
        kind: "success",
        text: "设置已保存在本机；词库草稿未上传",
      });
    await refreshDiagnostics();
  };

  const save = async () => {
    if (!startSaving()) return;
    setMessage(null);
    setOnboardingMessage(null);
    setSaveIssue(null);
    try {
      await persistAndCommit(settingsRef.current);
      await finishSuccessfulSave("settings");
    } catch (error) {
      if (isServiceIssue(error)) {
        setSaveIssue(error);
        reportPersistentError(error.title);
      } else
        reportPersistentError(
          safeError(
            error,
            settingsRef.current.recognition.volcengine.apiKey,
            settingsRef.current.recognition[
              settingsRef.current.recognition.provider
            ].llm.apiKey
          )
        );
    } finally {
      stopSaving();
    }
  };

  const saveHotwordDraft = async (lock = true) => {
    if (lock && !startSaving()) return;
    const sourceText = hotwordsTextRef.current;
    try {
      const words = normalizeHotwords(sourceText, hotwordStatus.limit);
      const revision = providerRevisionRef.current;
      await invoke("save_volcengine_hotword_draft", {
        words,
        providerRevision: revision,
      });
      if (revision !== providerRevisionRef.current) return;
      const text = words.join("\n");
      savedHotwordsTextRef.current = text;
      if (hotwordsTextRef.current === sourceText) {
        hotwordsTextRef.current = text;
        setHotwordsText(text);
      }
      syncDirty(
        settingsChanged(
          settingsRef.current,
          hotwordsTextRef.current,
          savedSettingsRef.current,
          text
        )
      );
      setHotwordMessage({
        kind: "info",
        text: "草稿已保留在本机，尚未发送给火山引擎。",
      });
    } finally {
      if (lock) stopSaving();
    }
  };

  const applyHotwords = async (
    words?: string[],
    reviewToken: string | null = null
  ) => {
    if (!startSaving()) return;
    setApplyingHotwords(true);
    const revision = providerRevisionRef.current;
    try {
      const pendingWords =
        words ??
        normalizeHotwords(hotwordsTextRef.current, hotwordStatus.limit);
      await saveHotwordDraft(false);
      setCloudHotwordsVerified(false);
      reviewTokenRef.current = null;
      const result = await invoke<SaveSettingsResult>(
        "apply_volcengine_hotwords",
        {
          words: pendingWords,
          forceOverwrite: reviewToken !== null,
          reviewToken,
          providerRevision: revision,
        }
      );
      if (revision !== providerRevisionRef.current) return;
      if (result.kind === "conflict") {
        setCloudHotwords(result.cloudHotwords);
        setCloudHotwordsVerified(true);
        reviewTokenRef.current = result.reviewToken;
        openHotwordConflict({
          cloudHotwords: result.cloudHotwords,
          words: pendingWords,
          reviewToken: result.reviewToken,
        });
        return;
      }
      if (result.hotwordStatus) setHotwordStatus(result.hotwordStatus);
      setCloudHotwords(result.cloudHotwords);
      setCloudHotwordsVerified(true);
      setCloudConfirmedAt(new Date().toLocaleString());
      const text = result.cloudHotwords.join("\n");
      savedHotwordsTextRef.current = text;
      hotwordsTextRef.current = text;
      setHotwordsText(text);
      for (const ref of [settingsRef, savedSettingsRef]) {
        ref.current = {
          ...ref.current,
          recognition: {
            ...ref.current.recognition,
            volcengine: {
              ...ref.current.recognition.volcengine,
              hotwords: result.cloudHotwords,
              hotwordDraft: null,
            },
          },
        };
      }
      setSettings(settingsRef.current);
      dirtyRef.current = null;
      syncDirty(
        settingsChanged(
          settingsRef.current,
          text,
          savedSettingsRef.current,
          text
        )
      );
      setHotwordMessage({
        kind: "success",
        text: hotwordActionMessage(
          result.hotwordAction,
          result.cloudHotwords.length
        ),
      });
    } catch (error) {
      if (revision !== providerRevisionRef.current) return;
      try {
        const loaded = await invoke<LoadSettingsResult>("load_settings");
        if (revision === providerRevisionRef.current && loaded.hotwordStatus)
          setHotwordStatus(loaded.hotwordStatus);
      } catch {
        setHotwordMessage({
          kind: "error",
          text: "无法读取提交状态；请保留草稿，重新打开设置后检查云端。",
        });
      }
      setHotwordMessage({
        kind: "error",
        text: `${safeError(error, settingsRef.current.recognition.volcengine.apiKey)}。草稿保留；若请求已发送，先刷新确认结果，不要直接重试。`,
      });
    } finally {
      setApplyingHotwords(false);
      stopSaving();
    }
  };

  const resolveHotwordConflict = (useCloud: boolean) => {
    const conflict = hotwordConflict;
    if (!conflict) return;
    setHotwordConflict(null);
    if (useCloud) {
      updateHotwordsText(
        replayHotwordChanges(
          savedSettingsRef.current.recognition.volcengine.hotwords,
          conflict.words,
          conflict.cloudHotwords
        ).join("\n")
      );
      setHotwordMessage({
        kind: "info",
        text: "已基于云端重放本机明确增删。请审阅草稿，再保留或应用；尚未上传。",
      });
      return;
    }
    setPendingHotwordApply({
      words: conflict.words,
      reviewToken: conflict.reviewToken,
    });
  };

  const performAction = async (
    action: RecognitionProvider | "close",
    keep: boolean
  ) => {
    if (!startSaving()) return;
    try {
      if (keep) {
        if (
          settingsRef.current.recognition.provider === "volcengine" &&
          hotwordsTextRef.current !== savedHotwordsTextRef.current
        )
          await saveHotwordDraft(false);
        await persistAndCommit(settingsRef.current);
      }
      if (action === "close") {
        if (!keep) {
          settingsRef.current = savedSettingsRef.current;
          setSettings(savedSettingsRef.current);
          hotwordsTextRef.current = savedHotwordsTextRef.current;
          setHotwordsText(savedHotwordsTextRef.current);
        }
        syncDirty(false);
        await invoke("set_settings_dirty", { dirty: false });
        setPendingAction(null);
        await invoke("close_settings");
        return;
      }
      setSwitching(true);
      const loaded = await invoke<LoadSettingsResult>(
        "select_recognition_provider",
        { provider: action }
      );
      providerRevisionRef.current = loaded.providerRevision;
      setProviderRevision(loaded.providerRevision);
      settingsRef.current = loaded.settings;
      savedSettingsRef.current = loaded.settings;
      setSettings(loaded.settings);
      const profile = loaded.settings.recognition.volcengine;
      const draft =
        action === "volcengine"
          ? (profile.hotwordDraft ?? profile.hotwords).join("\n")
          : "";
      hotwordsTextRef.current = draft;
      savedHotwordsTextRef.current = draft;
      setHotwordsText(draft);
      setHotwordStatus(loaded.hotwordStatus ?? DEFAULT_HOTWORD_STATUS);
      setCloudHotwords(action === "volcengine" ? profile.hotwords : []);
      setCloudHotwordsVerified(false);
      setCloudConfirmedAt(null);
      reviewTokenRef.current = null;
      setHotwordConflict(null);
      setHotwordMessage(null);
      setAvailableLlmModels([]);
      setLlmModelsMessage(null);
      setShowLlmApiKey(false);
      setEditingCustomLlmParameters(false);
      setSaveIssue(null);
      setOnboardingMessage(null);
      setMessage(null);
      if (loaded.account) acceptAccount(loaded.account);
      syncDirty(false);
      setPendingAction(null);
      if (loaded.notice) showMessage({ kind: "info", text: loaded.notice });
    } catch (error) {
      reportPersistentError(
        safeError(
          error,
          settingsRef.current.recognition.volcengine.apiKey,
          settingsRef.current.recognition[
            settingsRef.current.recognition.provider
          ].llm.apiKey
        )
      );
    } finally {
      setSwitching(false);
      stopSaving();
    }
  };

  const selectProvider = (provider: RecognitionProvider) => {
    if (provider === settingsRef.current.recognition.provider) return;
    if (
      settingsChanged(
        settingsRef.current,
        hotwordsTextRef.current,
        savedSettingsRef.current,
        savedHotwordsTextRef.current
      )
    )
      setPendingAction(provider);
    else void performAction(provider, false);
  };

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen("settings-close-requested", () => {
      if (savingRef.current) {
        reportPersistentError("正在保存或应用词库，请等待操作结束再关闭。");
      } else if (
        settingsChanged(
          settingsRef.current,
          hotwordsTextRef.current,
          savedSettingsRef.current,
          savedHotwordsTextRef.current
        )
      ) {
        setPendingAction("close");
      } else {
        void invoke("close_settings").catch((error: unknown) => {
          reportPersistentError(safeError(error));
        });
      }
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((error: unknown) => {
        reportPersistentError(safeError(error));
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [reportPersistentError]);

  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLocaleLowerCase() !== "s"
      )
        return;
      event.preventDefault();
      if (
        activeSection === "dictionary" &&
        settingsRef.current.recognition.provider === "volcengine"
      )
        void saveHotwordDraft().catch((error: unknown) => {
          reportPersistentError(safeError(error));
        });
      else void save();
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
      await persistSettings(persistedReset, providerRevisionRef.current);
      dirtyRef.current = null;
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
          settingsRef.current.recognition.volcengine.apiKey,
          settingsRef.current.recognition[
            settingsRef.current.recognition.provider
          ].llm.apiKey
        ),
      });
    } finally {
      stopSaving();
    }
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

  const finishOnboarding = async () => {
    if (!recognitionService.verified) {
      goToOnboardingStep(1);
      setOnboardingMessage({
        kind: "error",
        text: "识别服务或账号状态已变化，请重新测试。",
      });
      return;
    }
    if (!startSaving()) return;
    setOnboardingMessage(null);
    setSaveIssue(null);
    try {
      await persistAndCommit({
        ...settingsRef.current,
        onboardingCompleted: true,
      });
      await finishSuccessfulSave("onboarding");
    } catch (error) {
      if (isServiceIssue(error)) {
        setOnboardingMessage(null);
        setSaveIssue(error);
      } else
        setOnboardingMessage({
          kind: "error",
          text: safeError(
            error,
            settingsRef.current.recognition.volcengine.apiKey
          ),
        });
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
          settingsRef.current.recognition.volcengine.apiKey,
          settingsRef.current.recognition[
            settingsRef.current.recognition.provider
          ].llm.apiKey
        )
      );
    }
  };
  const fetchLlmModels = async () => {
    const { apiKey, baseUrl } =
      settingsRef.current.recognition[settingsRef.current.recognition.provider]
        .llm;
    const revision = providerRevisionRef.current;
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
        providerRevision: revision,
      });
      if (
        revision !== providerRevisionRef.current ||
        apiKey !==
          settingsRef.current.recognition[
            settingsRef.current.recognition.provider
          ].llm.apiKey ||
        baseUrl !==
          settingsRef.current.recognition[
            settingsRef.current.recognition.provider
          ].llm.baseUrl
      )
        return;
      setAvailableLlmModels(models);
      setLlmModelsMessage({
        kind: "success",
        text: `已获取 ${models.length} 个模型，可在输入框中选择或继续手动填写。`,
      });
    } catch (error) {
      if (
        revision !== providerRevisionRef.current ||
        apiKey !==
          settingsRef.current.recognition[
            settingsRef.current.recognition.provider
          ].llm.apiKey ||
        baseUrl !==
          settingsRef.current.recognition[
            settingsRef.current.recognition.provider
          ].llm.baseUrl
      )
        return;
      setAvailableLlmModels([]);
      setLlmModelsMessage({
        kind: "error",
        text: safeError(error, apiKey),
      });
    } finally {
      if (revision === providerRevisionRef.current) setLoadingLlmModels(false);
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
          settingsRef.current.recognition.volcengine.apiKey,
          settingsRef.current.recognition[
            settingsRef.current.recognition.provider
          ].llm.apiKey
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
          settingsRef.current.recognition.volcengine.apiKey,
          settingsRef.current.recognition[
            settingsRef.current.recognition.provider
          ].llm.apiKey
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
  const isLlmSettingChanged = (key: keyof LlmSettings) =>
    settings.recognition[settings.recognition.provider].llm[key] !==
    savedSettingsRef.current.recognition[
      savedSettingsRef.current.recognition.provider
    ].llm[key];
  const llmChanged = llmSettingsChanged(
    settings.recognition[settings.recognition.provider].llm,
    savedSettingsRef.current.recognition[
      savedSettingsRef.current.recognition.provider
    ].llm
  );
  const detectedLlmParameterPreset = detectLlmParameterPreset(
    settings.recognition[settings.recognition.provider].llm.extraParameters
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
  const llmModelQuery = settings.recognition[
    settings.recognition.provider
  ].llm.model
    .trim()
    .toLocaleLowerCase();
  const filteredLlmModels = availableLlmModels.filter(
    (model) =>
      !llmModelQuery || model.toLocaleLowerCase().includes(llmModelQuery)
  );
  const customLlmParameterError = llmParameterError(
    settings.recognition[settings.recognition.provider].llm.extraParameters
  );
  const hotwordsChanged = hotwordsText !== savedHotwordsTextRef.current;
  const localHotwords = uniqueHotwords(hotwordsText);
  const apiKeyChanged =
    settings.recognition.volcengine.apiKey !==
    savedSettingsRef.current.recognition.volcengine.apiKey;
  const recognitionChanged = recognitionConfigurationChanged(
    settings.recognition,
    savedSettingsRef.current.recognition
  );
  const cloudChanges = hotwordDiff(localHotwords, cloudHotwords);
  const hasUnsavedChanges = settingsChanged(
    settings,
    hotwordsText,
    savedSettingsRef.current,
    savedHotwordsTextRef.current
  );
  const hasUnsavedSettings = settingsChanged(
    settings,
    "",
    savedSettingsRef.current,
    ""
  );
  const isSectionChanged = (section: SettingsSectionId) => {
    if (section === "shortcut")
      return (
        isSettingChanged("activationMode") ||
        isSettingChanged("shortcut") ||
        isSettingChanged("microphoneId") ||
        isSettingChanged("overlayPosition")
      );
    if (section === "recognition") return recognitionChanged;
    if (section === "dictionary")
      return settings.recognition.provider === "volcengine" && hotwordsChanged;
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
        resolveHotwordConflict(false);
      }}
      onUseCloud={() => {
        resolveHotwordConflict(true);
      }}
    />
  ) : null;
  const hotwordApplyDialog = pendingHotwordApply ? (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) setPendingHotwordApply(null);
      }}
    >
      <AlertDialogContent className="max-h-[85vh] overflow-y-auto">
        <AlertDialogTitle>
          {pendingHotwordApply.reviewToken
            ? "确认以本机整体覆盖云端"
            : "确认应用到火山引擎"}
        </AlertDialogTitle>
        <AlertDialogDescription>
          目标是当前已保存 Key 对应的 VoicePaste
          受管理词表。先保留本机草稿，再提交云端。
          {pendingHotwordApply.words.length === 0
            ? "本次将删除 VoicePaste 管理的云词表。"
            : ""}
          {pendingHotwordApply.reviewToken
            ? "提交前会重新检查已审阅内容。火山接口没有已验证的原子版本锁，其他客户端同时修改仍有覆盖风险。"
            : ""}
        </AlertDialogDescription>
        <div className="text-[11px] leading-6">
          <p>
            新增：
            {hotwordDiff(
              pendingHotwordApply.words,
              cloudHotwords
            ).onlyLocal.join("、") || "无"}
          </p>
          <p>
            移除：
            {hotwordDiff(
              pendingHotwordApply.words,
              cloudHotwords
            ).onlyCloud.join("、") || "无"}
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              const pending = pendingHotwordApply;
              setPendingHotwordApply(null);
              void applyHotwords(pending.words, pending.reviewToken);
            }}
          >
            确认提交
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  ) : null;
  const pendingActionDialog = pendingAction ? (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) setPendingAction(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogTitle>
          {pendingAction === "close"
            ? "关闭前处理未保存修改"
            : "切换前处理当前渠道修改"}
        </AlertDialogTitle>
        <AlertDialogDescription>
          保留会保存当前设置与本机词库草稿，不上传词条。放弃仅撤销尚未保存的编辑；已保留草稿不会被删除。
        </AlertDialogDescription>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => {
              setPendingAction(null);
            }}
          >
            取消
          </Button>
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => void performAction(pendingAction, false)}
          >
            放弃编辑{pendingAction === "close" ? "并关闭" : "并切换"}
          </Button>
          <Button
            disabled={saving}
            onClick={() => void performAction(pendingAction, true)}
          >
            保留{pendingAction === "close" ? "并关闭" : "并切换"}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  ) : null;
  const recognitionIssue = recognitionService.issue ?? saveIssue;
  const recognitionFeedback = recognitionIssue ? (
    <ServiceIssueCard
      issue={recognitionIssue}
      onOpenLink={(target) => void openProductLink(target)}
    />
  ) : null;
  const recognitionPanel = (
    <RecognitionSettingsPanel
      recognition={settings.recognition}
      previewRecognition={savedSettingsRef.current.recognition}
      onSave={() => void save()}
      onChange={updateRecognition}
      onSelectProvider={selectProvider}
      providerRevision={providerRevision}
      service={recognitionService}
      onOpenConsole={() => void openConsole()}
      feedback={recognitionFeedback}
      changed={recognitionChanged}
      microphoneId={settings.microphoneId}
      previewBusy={recognitionPreviewBusy}
      onPreviewBusyChange={setRecognitionPreviewBusy}
      disabled={
        saving ||
        switching ||
        checkingHotwords ||
        loadingLlmModels ||
        testingMicrophone
      }
    />
  );

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
            {recognitionReady(
              settings.recognition,
              recognitionService.account
            ) ? null : (
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
            description="选择当前听写使用的服务；各服务的配置独立保留。"
          >
            {recognitionPanel}
          </SettingsSection>
        );
      }
      case "dictionary": {
        if (settings.recognition.provider === "doubaoIme")
          return (
            <SettingsSection
              id="dictionary"
              title="豆包个人词库"
              description="仅管理当前豆包账号的官方个人词库。"
            >
              <p className="px-6 py-5 text-[12px] leading-6 text-muted-foreground">
                {recognitionService.account.state === "signedIn"
                  ? "豆包官方个人词库协议尚未完成安全接入；登录与语音连接成功不代表词库已同步或用于识别。"
                  : "登录后才能管理豆包个人词库；游客语音仍可用。官方个人词库尚未接入。"}
              </p>
            </SettingsSection>
          );
        return (
          <SettingsSection
            id="dictionary"
            title="火山常用词"
            description="只操作当前已保存 Key 对应的 VoicePaste 受管理词表。"
          >
            <VolcengineDictionary
              key={providerRevision}
              providerRevision={providerRevision}
              text={hotwordsText}
              onChange={updateHotwordsText}
              status={hotwordStatus}
              cloudWords={cloudHotwords}
              cloudVerified={cloudHotwordsVerified}
              confirmedAt={cloudConfirmedAt}
              localDirty={hotwordsChanged}
              enabled={settings.recognition.volcengine.hotwordsEnabled}
              savedEnabled={
                savedSettingsRef.current.recognition.volcengine.hotwordsEnabled
              }
              onEnabledChange={(enabled) => {
                updateVolcengineSetting("hotwordsEnabled", enabled);
              }}
              busy={
                saving ||
                checkingHotwords ||
                recognitionPreviewBusy ||
                recognitionService.testing
              }
              configured={
                Boolean(settings.recognition.volcengine.apiKey.trim()) &&
                !apiKeyChanged
              }
              confirming={hotwordStatus.state === "confirming"}
              canReview={
                cloudHotwordsVerified && reviewTokenRef.current !== null
              }
              onSave={() =>
                void saveHotwordDraft().catch((error: unknown) => {
                  setHotwordMessage({ kind: "error", text: safeError(error) });
                })
              }
              onApply={() => {
                setPendingHotwordApply({
                  words: localHotwords,
                  reviewToken: null,
                });
              }}
              onRefresh={() => void refreshHotwords()}
              onDiscard={() => {
                updateHotwordsText(
                  savedSettingsRef.current.recognition.volcengine.hotwords.join(
                    "\n"
                  )
                );
                void saveHotwordDraft().catch((error: unknown) => {
                  setHotwordMessage({ kind: "error", text: safeError(error) });
                });
              }}
              onReview={() => {
                if (reviewTokenRef.current)
                  openHotwordConflict({
                    cloudHotwords,
                    words: localHotwords,
                    reviewToken: reviewTokenRef.current,
                  });
              }}
            />
            <div className="px-6 pb-5">
              <Feedback message={hotwordMessage} />
              <p className="mt-2 text-[11px] text-muted-foreground">
                待应用：新增 {cloudChanges.onlyLocal.length} 个 · 移除{" "}
                {cloudChanges.onlyCloud.length} 个
              </p>
              {hotwordStatus.foreignTables.length > 0 ? (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  当前资源另有 {hotwordStatus.foreignTables.length} 张非
                  VoicePaste 词表；不会修改或用于识别。
                </p>
              ) : null}
            </div>
          </SettingsSection>
        );
      }
      case "processing": {
        return (
          <SettingsSection
            id="processing"
            title="智能文本处理"
            description={`仅处理当前${settings.recognition.provider === "doubaoIme" ? "豆包输入法" : "火山引擎"}的识别文本；模型、提示词和凭据按使用方式独立保存。`}
          >
            {settings.recognition.provider === "doubaoIme" && (
              <DoubaoTranslation
                key={`${providerRevision}-${recognitionService.account.revision}`}
                revision={providerRevision}
                signedIn={recognitionService.account.state === "signedIn"}
              />
            )}
            {settings.recognition.provider === "doubaoIme" && (
              <SettingRow
                title="豆包输入法智能整理"
                description="使用已登录账号整理最终转写，不需要 LLM API Key。与自定义 LLM 二选一；失败保留原文，试说不整理。"
              >
                <Switch
                  checked={settings.recognition.doubaoIme.smartOrganize}
                  disabled={
                    !settings.recognition.doubaoIme.smartOrganize &&
                    recognitionService.account.state !== "signedIn"
                  }
                  aria-label="豆包输入法智能整理"
                  onCheckedChange={(checked) => {
                    updateRecognition({
                      ...settings.recognition,
                      doubaoIme: {
                        ...settings.recognition.doubaoIme,
                        smartOrganize: checked,
                        llm: {
                          ...settings.recognition.doubaoIme.llm,
                          enabled: false,
                        },
                      },
                    });
                  }}
                />
              </SettingRow>
            )}
            <SettingRow
              title="启用 LLM 后处理"
              description="识别完成后将文本发送到已配置的 LLM 服务；通常会增加数秒等待时间。"
              changed={isLlmSettingChanged("enabled")}
            >
              <Switch
                disabled={
                  settings.recognition.provider === "doubaoIme" &&
                  settings.recognition.doubaoIme.smartOrganize
                }
                checked={
                  settings.recognition[settings.recognition.provider].llm
                    .enabled
                }
                onCheckedChange={(checked) => {
                  updateLlmSetting("enabled", checked);
                }}
                aria-label="启用 LLM 后处理"
              />
            </SettingRow>
            <div
              className={`vp-motion-layout grid transition-[grid-template-rows] motion-reduce:transition-none ${
                settings.recognition[settings.recognition.provider].llm.enabled
                  ? "grid-rows-[1fr]"
                  : "grid-rows-[0fr]"
              }`}
              inert={
                !settings.recognition[settings.recognition.provider].llm.enabled
              }
              aria-hidden={
                !settings.recognition[settings.recognition.provider].llm.enabled
              }
            >
              <div className="min-h-0 overflow-hidden">
                <div
                  className={`vp-motion-layout divide-y divide-border transition-[transform,opacity] motion-reduce:transition-none ${
                    settings.recognition[settings.recognition.provider].llm
                      .enabled
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
                        value={
                          settings.recognition[settings.recognition.provider]
                            .llm.baseUrl
                        }
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
                        value={
                          settings.recognition[settings.recognition.provider]
                            .llm.apiKey
                        }
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
                          inputValue={
                            settings.recognition[settings.recognition.provider]
                              .llm.model
                          }
                          value={
                            settings.recognition[settings.recognition.provider]
                              .llm.model || null
                          }
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
                      checked={
                        settings.recognition[settings.recognition.provider].llm
                          .streaming
                      }
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
                            value={
                              settings.recognition[
                                settings.recognition.provider
                              ].llm.extraParameters
                            }
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
                                (settings.recognition[
                                  settings.recognition.provider
                                ].llm.extraParameters.trim()
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
                                  !settings.recognition[
                                    settings.recognition.provider
                                  ].llm.extraParameters.trim()
                                }
                                onClick={() => {
                                  const parsed: unknown = JSON.parse(
                                    settings.recognition[
                                      settings.recognition.provider
                                    ].llm.extraParameters
                                  );
                                  updateLlmSetting(
                                    "extraParameters",
                                    JSON.stringify(parsed, null, 2) ??
                                      settings.recognition[
                                        settings.recognition.provider
                                      ].llm.extraParameters
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
                      value={
                        settings.recognition[settings.recognition.provider].llm
                          .prompt
                      }
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
                            settingsRef.current.recognition.volcengine.apiKey,
                            settingsRef.current.recognition[
                              settingsRef.current.recognition.provider
                            ].llm.apiKey
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
    return (
      <TooltipProvider delay={400}>
        {settingsToaster}
        {hotwordConflictDialog}
        {pendingActionDialog}
        {hotwordApplyDialog}
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
                      可直接使用豆包输入法游客模式，也可选用自己的火山引擎 API
                      Key。
                    </p>

                    <div className="mt-5 rounded-[14px] border border-border bg-card">
                      {recognitionPanel}
                    </div>
                    <Feedback message={onboardingMessage} className="mt-4" />
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
                        disabled={
                          !recognitionService.verified ||
                          recognitionChanged ||
                          recognitionService.testing ||
                          recognitionService.accountBusy ||
                          recognitionPreviewBusy
                        }
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
                        disabled={testingMicrophone || recognitionPreviewBusy}
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
                        disabled={recognitionPreviewBusy}
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
                    <div className="mt-5">
                      <RecognitionSpeechTest
                        recognition={savedSettingsRef.current.recognition}
                        providerRevision={providerRevision}
                        account={recognitionService.account}
                        microphoneId={settings.microphoneId}
                        disabled={
                          testingMicrophone ||
                          recognitionService.testing ||
                          recognitionService.accountBusy
                        }
                        onBusyChange={setRecognitionPreviewBusy}
                      />
                    </div>
                    <div className="mt-7 flex items-center justify-between">
                      <Button
                        variant="outline"
                        size="lg"
                        className="text-[11px]"
                        type="button"
                        onClick={() => {
                          goToOnboardingStep(2);
                        }}
                        disabled={testingMicrophone || recognitionPreviewBusy}
                      >
                        <ChevronLeft size={12} /> 返回
                      </Button>
                      <Button
                        size="lg"
                        type="button"
                        onClick={() => {
                          goToOnboardingStep(4);
                        }}
                        disabled={testingMicrophone || recognitionPreviewBusy}
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
                          <Badge
                            className={
                              recognitionService.verified
                                ? "bg-[#eaf8f1] text-[#17633f]"
                                : "bg-[#fff2cc] text-[#7a5100]"
                            }
                          >
                            {settings.recognition.provider === "doubaoIme"
                              ? "豆包输入法"
                              : "火山引擎 API"}
                            {recognitionService.verified
                              ? " · 连接已验证"
                              : " · 需要重新测试"}
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
                    {recognitionService.verified ? null : (
                      <Alert className="mt-4" role="status">
                        <AlertDescription>
                          识别服务或账号状态已变化，请返回识别服务步骤重新测试。
                          <Button
                            variant="link"
                            type="button"
                            onClick={() => {
                              goToOnboardingStep(1);
                            }}
                          >
                            返回识别服务
                          </Button>
                        </AlertDescription>
                      </Alert>
                    )}
                    {recognitionFeedback}
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
                        disabled={saving || !recognitionService.verified}
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
        {pendingActionDialog}
        {hotwordApplyDialog}
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
                      ? "正在保存"
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
                    disabled={
                      saving ||
                      recognitionService.testing ||
                      recognitionService.accountBusy ||
                      recognitionPreviewBusy
                    }
                  >
                    <RotateCcw size={13} /> 恢复默认
                  </Button>
                ) : null}
                {hasUnsavedSettings ? (
                  <Button
                    type="button"
                    onClick={(event) => {
                      hotwordConflictReturnFocusRef.current =
                        event.currentTarget;
                      void save();
                    }}
                    disabled={
                      saving ||
                      recognitionService.testing ||
                      recognitionService.accountBusy ||
                      recognitionPreviewBusy
                    }
                    className="min-w-26 animate-in duration-200 zoom-in-95 fade-in"
                  >
                    <Save size={13} /> {saving ? "保存中…" : "保存设置"}
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
