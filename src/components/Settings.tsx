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
import { SETTINGS_PATHS } from "@/routes/-settings-navigation";
import type { SettingsSectionId } from "@/routes/-settings-navigation";
import {
  formatShortcut,
  formatShortcutLabel,
  useShortcutRecorder,
} from "@/shortcut";
import { DEFAULT_SETTINGS } from "@/types";
import type { AppSettings, SystemDiagnostics } from "@/types";

const INPUT_CLASS =
  "h-9 w-full rounded-lg border border-[#d7d9de] bg-white px-3 text-[12px] text-[#202124] outline-none transition focus:border-[#7564e8] focus:ring-3 focus:ring-[#7564e8]/10 disabled:cursor-not-allowed disabled:bg-[#f5f5f6] disabled:text-[#8b8f97]";
const PRIMARY_BUTTON_CLASS =
  "flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg border-0 bg-[#6558e8] px-4 text-[11px] font-medium text-white transition hover:bg-[#584bcf] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#7564e8] disabled:cursor-not-allowed disabled:opacity-55";
const SECONDARY_BUTTON_CLASS =
  "flex h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-[#d7d9de] bg-white px-3 text-[10px] font-medium text-[#555962] transition hover:bg-[#f5f5f6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7564e8] disabled:cursor-not-allowed disabled:opacity-55";
const CONSOLE_URL = "https://console.volcengine.com/speech/new/setting/apikeys";
const FALLBACK_APP_VERSION = "1.0.0";
const SECTIONS = [
  ["general", "通用", Settings2],
  ["shortcut", "语音输入", Command],
  ["recognition", "识别与词汇", Sparkles],
  ["diagnostics", "权限与状态", ShieldCheck],
  ["about", "关于", Info],
] as const;
const SECTION_DESCRIPTIONS: Record<SettingsSectionId, string> = {
  about: "查看版本、发布和支持信息",
  diagnostics: "检查系统权限与输入状态",
  general: "管理启动行为和悬浮窗位置",
  recognition: "配置识别服务和常用词",
  shortcut: "调整快捷键、触发方式和麦克风",
};
const ONBOARDING_STEPS = [
  "欢迎",
  "豆包服务",
  "快捷键",
  "麦克风",
  "完成",
] as const;

type Message = { kind: "success" | "error" | "info"; text: string } | null;
interface LoadSettingsResult {
  settings: AppSettings;
  notice?: string;
}
type ProductLinkTarget = "homepage" | "help" | "privacy" | "releases";

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

function normalizeHotwords(value: string): string[] {
  const seen = new Set<string>();
  const hotwords: string[] = [];
  let totalChars = 0;
  for (const line of value.split("\n")) {
    const word = line.trim();
    const identity = word.toLocaleLowerCase();
    if (!word || seen.has(identity)) continue;
    seen.add(identity);
    totalChars += word.length;
    if (totalChars > 100)
      throw new Error(
        "热词总长度不能超过 100 个字符（按接口 token 上限保守限制）"
      );
    hotwords.push(word);
  }
  return hotwords;
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
    current.overlayPosition !== saved.overlayPosition ||
    hotwordsText !== savedHotwordsText
  );
}

function safeError(error: unknown, apiKey = ""): string {
  const detail = String(error);
  const secret = apiKey.trim();
  return secret.length >= 4 ? detail.split(secret).join("••••••••") : detail;
}

async function persistSettings(nextSettings: AppSettings) {
  if (isTauri()) await invoke("save_settings", { settings: nextSettings });
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
  vertical = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
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
        <h3 className="text-[12px] font-medium text-[#2c2e33]">{title}</h3>
        {description ? (
          <p className="mt-1 text-[10px] leading-5 text-[#6f737b]">
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

function microphoneTestError(error: unknown): string {
  const detail = String(error);
  return /permission|notallowederror|denied/iu.test(detail)
    ? "麦克风权限未开启。请在系统设置中允许 VoicePaste 使用麦克风，然后重试。"
    : `麦克风测试失败：${detail}`;
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
  const [message, setMessage] = useState<Message>(null);
  const [doubaoMessage, setDoubaoMessage] = useState<Message>(null);
  const [microphoneMessage, setMicrophoneMessage] = useState<Message>(null);
  const [onboardingMessage, setOnboardingMessage] = useState<Message>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [verifiedApiKey, setVerifiedApiKey] = useState("");
  const [microphones, setMicrophones] = useState<MicrophoneDevice[]>([]);
  const [testingMicrophone, setTestingMicrophone] = useState(false);
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [testingDoubao, setTestingDoubao] = useState(false);
  const [diagnostics, setDiagnostics] = useState<SystemDiagnostics | null>(
    null
  );

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
          `同步未保存状态失败：${safeError(error, settingsRef.current.apiKey)}`
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
      reportPersistentError(safeError(error, settingsRef.current.apiKey));
    }
  }, [reportPersistentError]);

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
      syncDirty(false);
      setLoading(false);
      return;
    }

    invoke<LoadSettingsResult>("load_settings")
      .then(({ settings: loadedSettings, notice }) => {
        const loadedHotwords = loadedSettings.hotwords.join("\n");
        settingsRef.current = loadedSettings;
        savedSettingsRef.current = loadedSettings;
        hotwordsTextRef.current = loadedHotwords;
        savedHotwordsTextRef.current = loadedHotwords;
        setSettings(loadedSettings);
        setHotwordsText(loadedHotwords);
        syncDirty(false);
        if (notice) showMessage({ kind: "info", text: notice });
        void refreshDiagnostics();
      })
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
        reportPersistentError(safeError(error, settingsRef.current.apiKey));
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
      void microphoneTestRef.current?.stop();
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

  const save = async () => {
    if (!startSaving()) return;
    setMessage(null);
    setOnboardingMessage(null);
    try {
      const hotwords = normalizeHotwords(hotwordsTextRef.current);
      const nextSettings = { ...settingsRef.current, hotwords };
      await persistSettings(nextSettings);
      const normalizedHotwords = hotwords.join("\n");
      commitSettings(nextSettings, normalizedHotwords);
      showMessage({
        kind: "success",
        text: isTauri() ? "已保存" : "预览校验通过",
      });
      await refreshDiagnostics();
    } catch (error) {
      reportPersistentError(safeError(error, settingsRef.current.apiKey));
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
      await persistSettings(persistedReset);
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
      showMessage({ kind: "success", text: "已恢复并保存“语音输入”默认值" });
      await refreshDiagnostics();
    } catch (error) {
      showMessage({
        kind: "error",
        text: safeError(error, settingsRef.current.apiKey),
      });
    } finally {
      stopSaving();
    }
  };

  const clearHotwords = () => {
    updateSetting("hotwords", []);
    updateHotwordsText("");
    showMessage({ kind: "info", text: "已清空常用词，保存后生效。" });
  };

  const testMicrophone = async () => {
    setTestingMicrophone(true);
    setMicrophoneLevel(0);
    setMicrophoneMessage(null);
    let failed = false;
    const capture = new AudioCapture(
      settingsRef.current.microphoneId,
      setMicrophoneLevel,
      (error) => {
        failed = true;
        if (microphoneTestRef.current === capture)
          microphoneTestRef.current = null;
        setMicrophoneMessage({
          kind: "error",
          text: microphoneTestError(error),
        });
        setTestingMicrophone(false);
        void capture.stop();
      }
    );
    try {
      microphoneTestRef.current = capture;
      await capture.start();
      window.setTimeout(() => {
        void (async () => {
          if (microphoneTestRef.current !== capture) return;
          try {
            await capture.stop();
            microphoneTestRef.current = null;
            await refreshMicrophones();
            await refreshDiagnostics();
            if (!failed)
              setMicrophoneMessage({ kind: "success", text: "麦克风工作正常" });
          } catch (error) {
            setMicrophoneMessage({
              kind: "error",
              text: `停止麦克风测试失败：${String(error)}`,
            });
          } finally {
            setTestingMicrophone(false);
          }
        })();
      }, 2500);
    } catch (error) {
      await microphoneTestRef.current?.stop().catch(() => {});
      microphoneTestRef.current = null;
      setMicrophoneMessage({ kind: "error", text: microphoneTestError(error) });
      setTestingMicrophone(false);
    }
  };

  const testDoubao = async (
    setFeedback: (message: Message) => void = setDoubaoMessage
  ) => {
    setTestingDoubao(true);
    setFeedback(null);
    const apiKey = settingsRef.current.apiKey.trim();
    try {
      if (!apiKey) throw new Error("请先填写豆包 API Key");
      if (!isTauri()) throw new Error("浏览器预览无法测试豆包连接");
      await invoke("test_doubao", { apiKey });
      setVerifiedApiKey(apiKey);
      setFeedback({
        kind: "success",
        text: "豆包 API Key 与流式识别服务连接正常",
      });
      return true;
    } catch (error) {
      setVerifiedApiKey("");
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
        text: "请返回豆包服务步骤填写并测试 API Key。",
      });
      return;
    }
    if (verifiedApiKey !== apiKey) {
      setOnboardingMessage({
        kind: "error",
        text: "API Key 已修改，请返回豆包服务步骤重新测试。",
      });
      return;
    }
    if (!startSaving()) return;
    setOnboardingMessage(null);
    try {
      const hotwords = normalizeHotwords(hotwordsTextRef.current);
      const nextSettings = {
        ...settingsRef.current,
        apiKey,
        hotwords,
        onboardingCompleted: true,
      };
      await persistSettings(nextSettings);
      commitSettings(nextSettings, hotwords.join("\n"));
      selectSection("general");
      setShowApiKey(false);
      showMessage({
        kind: "success",
        text: "设置完成，可以开始使用 VoicePaste",
      });
      await refreshDiagnostics();
    } catch (error) {
      setOnboardingMessage({ kind: "error", text: safeError(error, apiKey) });
    } finally {
      stopSaving();
    }
  };

  const openConsole = async () => {
    try {
      if (isTauri()) await invoke("open_api_key_console");
      else window.open(CONSOLE_URL, "_blank", "noopener,noreferrer");
    } catch (error) {
      reportPersistentError(safeError(error, settingsRef.current.apiKey));
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
        text: safeError(error, settingsRef.current.apiKey),
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
        text: safeError(error, settingsRef.current.apiKey),
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
  const currentVersion = diagnostics?.appVersion ?? FALLBACK_APP_VERSION;

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
              title="悬浮窗位置"
              description="选择听写状态悬浮窗出现的屏幕边缘。"
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
                  去配置
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
                description="点击后按下新的组合键。"
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
                    "请按组合键…"
                  ) : (
                    <ShortcutHint shortcut={settings.shortcut} />
                  )}
                </button>
              </SettingRow>

              <SettingRow
                title="麦克风"
                description="默认使用系统当前选择的输入设备。"
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
                      onClick={() => void testMicrophone()}
                      disabled={testingMicrophone}
                    >
                      <Mic size={11} /> {testingMicrophone ? "测试中…" : "测试"}
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
          <SettingsSection
            id="recognition"
            title="识别与词汇"
            description="配置识别服务，并提高人名和专业词汇的准确率。"
          >
            <SettingRow
              title="豆包 API Key"
              description="从火山引擎控制台获取，用于连接语音识别服务。"
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
            <SettingRow
              title="启用热词"
              description="关闭后保留词表，但听写时不发送给豆包。"
            >
              <Toggle
                checked={settings.hotwordsEnabled}
                onChange={(checked) => {
                  updateSetting("hotwordsEnabled", checked);
                }}
                label="启用热词"
              />
            </SettingRow>
            <SettingRow
              title="热词列表"
              description="每行一个词，最多 100 个字符。"
              vertical
            >
              <div className="mb-2 flex justify-end">
                <button
                  className="cursor-pointer border-0 bg-transparent p-0 text-[10px] font-medium text-[#6558e8] hover:text-[#4f43bd] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7564e8] disabled:cursor-default disabled:text-[#9a9da4]"
                  type="button"
                  onClick={clearHotwords}
                  disabled={!settings.hotwordsEnabled || !hotwordsText.trim()}
                >
                  清空
                </button>
              </div>
              <textarea
                className="min-h-28 w-full resize-y rounded-lg border border-[#d7d9de] bg-white px-3 py-2.5 text-[12px] leading-6 text-[#202124] transition outline-none focus:border-[#7564e8] focus:ring-3 focus:ring-[#7564e8]/10 disabled:cursor-not-allowed disabled:bg-[#f5f5f6]"
                value={hotwordsText}
                onChange={(event) => {
                  updateHotwordsText(event.target.value);
                }}
                disabled={!settings.hotwordsEnabled}
                placeholder={"VoicePaste\n你的名字\n常用产品名"}
                rows={5}
              />
            </SettingRow>
          </SettingsSection>
        );
      }
      case "diagnostics": {
        return (
          <SettingsSection
            id="diagnostics"
            title="权限与状态"
            description="仅在功能不可用时需要查看。"
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
                <RefreshCw size={11} /> 刷新
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
                          text: safeError(error, settingsRef.current.apiKey),
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
              title="关于 VoicePaste"
              description="版本信息和正式发布。"
            >
              <SettingRow
                title={`VoicePaste ${currentVersion}`}
                description="新版本由 GitHub Releases 发布，请手动下载安装。"
              >
                <button
                  className={SECONDARY_BUTTON_CLASS}
                  type="button"
                  onClick={() => void openProductLink("releases")}
                >
                  <ExternalLink size={11} /> 查看最新版本
                </button>
              </SettingRow>
            </SettingsSection>

            <SettingsSection
              id="about-support"
              title="日志与支持"
              description="排查问题时可打开日志或复制不含凭据的诊断信息。"
            >
              <SettingRow
                title="日志目录"
                description={diagnostics?.logDir ?? "应用日志目录"}
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
              title="产品链接"
              description="了解项目、获取帮助或查看隐私说明。"
            >
              {(
                [
                  ["homepage", "主页", "了解 VoicePaste 和最新动态"],
                  ["help", "帮助与反馈", "查看使用帮助并反馈问题"],
                  ["privacy", "隐私说明", "了解数据处理和凭据存储方式"],
                ] as const
              ).map(([target, label, description]) => (
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
                    打开 <ExternalLink size={10} />
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

            <p className="mt-auto text-[9px] leading-4 text-[#777b84]">
              约 2 分钟完成，之后可随时在设置中修改。
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
                      在任意输入框中听写，并把识别结果直接输入到光标位置。接下来完成服务、快捷键和麦克风设置。
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
                      连接豆包语音识别
                    </h1>
                    <p className="mt-2 text-[11px] leading-5 text-[#6f737b]">
                      API Key 会由系统凭据存储保管，不会写入应用日志。
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
                        onClick={() => void testMicrophone()}
                        disabled={testingMicrophone}
                      >
                        <Mic size={11} />{" "}
                        {testingMicrophone ? "测试中…" : "测试"}
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
                        <dt className="text-[#777b84]">豆包服务</dt>
                        <dd className="font-medium text-[#17633f]">
                          连接已验证
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
                        {saving ? "保存中…" : "完成设置"}{" "}
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
                  </>
                )}
              </Link>
            ))}
          </nav>

          <p className="mt-auto px-3 pb-1 text-[9px] leading-4 text-[#696d75]">
            关闭窗口后继续在系统托盘运行
          </p>
        </aside>

        <div className="flex min-w-0 flex-col">
          <header className="flex h-18 shrink-0 items-center justify-between border-b border-[#e4e5e8] bg-white px-8">
            <div>
              <h1 className="text-[18px] font-semibold tracking-[-0.02em] text-[#202124]">
                设置
              </h1>
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
                  <RotateCcw size={11} /> 恢复并保存默认
                </button>
              ) : null}
              <button
                className="flex h-8 min-w-22 cursor-pointer items-center justify-center gap-1.5 rounded-lg border-0 bg-[#6558e8] px-3 text-[10px] font-medium text-white transition hover:bg-[#584bcf] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#7564e8] disabled:cursor-wait disabled:opacity-55"
                type="button"
                onClick={() => void save()}
                disabled={saving}
              >
                <Save size={11} /> {saving ? "保存中…" : "保存"}
              </button>
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
