import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  Activity,
  AudioWaveform,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Mic,
  RefreshCw,
  Save,
  ShieldCheck,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { AudioCapture } from "../audio";
import { type AppSettings, DEFAULT_SETTINGS, type PlatformDiagnostics, type SaveSettingsResult } from "../types";

const MODIFIER_CODE: Record<string, true> = {
  AltLeft: true,
  AltRight: true,
  ControlLeft: true,
  ControlRight: true,
  MetaLeft: true,
  MetaRight: true,
  ShiftLeft: true,
  ShiftRight: true,
};

const INPUT_CLASS =
  "h-10 w-full rounded-[10px] border border-[#c9ced8] bg-[#fafbfc] px-3 text-[12px] text-[#222838] outline-none transition focus:border-[#7564e8] focus:bg-white focus:ring-3 focus:ring-[#6d5ce7]/15";
const CONSOLE_URL = "https://console.volcengine.com/speech/new/setting/apikeys";
const SECTIONS = [
  ["doubao", "豆包语音"],
  ["shortcut", "唤起方式"],
  ["hotwords", "识别优化"],
  ["diagnostics", "权限诊断"],
] as const;

type Platform = "mac" | "windows" | "linux";
type Message = { kind: "success" | "error" | "info"; text: string } | null;
type LoadSettingsResult = { settings: AppSettings; notice?: string };
type MicrophonePermission = "granted" | "denied" | "prompt" | "unknown";

const DISPLAY_KEY_LABELS: Record<Platform, Record<string, string>> = {
  mac: {
    CommandOrControl: "⌘",
    Command: "⌘",
    Control: "⌃",
    Alt: "⌥",
    Shift: "⇧",
    Meta: "⌘",
    Super: "⌘",
    Enter: "↩",
    Backspace: "⌫",
    Delete: "⌦",
  },
  windows: {
    CommandOrControl: "Ctrl",
    Command: "Win",
    Control: "Ctrl",
    Alt: "Alt",
    Shift: "Shift",
    Meta: "Win",
    Super: "Win",
    Delete: "Del",
  },
  linux: {
    CommandOrControl: "Ctrl",
    Command: "Super",
    Control: "Ctrl",
    Alt: "Alt",
    Shift: "Shift",
    Meta: "Super",
    Super: "Super",
    Delete: "Del",
  },
};

const COMMON_KEY_LABELS: Record<string, string> = {
  Escape: "Esc",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

function currentPlatform(): Platform {
  if (navigator.userAgent.includes("Macintosh")) return "mac";
  if (navigator.userAgent.includes("Windows")) return "windows";
  return "linux";
}

function ShortcutHint({ shortcut }: { shortcut: string }) {
  const platform = currentPlatform();
  const keys = shortcut.split("+").map((key) => DISPLAY_KEY_LABELS[platform][key] ?? COMMON_KEY_LABELS[key] ?? key);
  const accessibleKeys = shortcut
    .split("+")
    .map((key) =>
      key === "CommandOrControl"
        ? platform === "mac"
          ? "Command"
          : "Control"
        : platform === "mac" && key === "Alt"
          ? "Option"
          : key,
    )
    .join(" + ");

  return (
    <span aria-label={accessibleKeys}>
      <span className="inline-flex items-center gap-1" aria-hidden="true">
        {keys.map((key, index) => (
          <kbd
            className="grid h-6 min-w-6 place-items-center rounded-[6px] border border-[#c8cdd7] bg-white px-1.5 font-sans text-[10px] leading-none font-semibold text-[#3d4454] shadow-[0_1px_0_#bfc4ce]"
            key={`${key}-${index}`}
          >
            {key}
          </kbd>
        ))}
      </span>
    </span>
  );
}

function shortcutFromKeyboardEvent(event: KeyboardEvent<HTMLButtonElement>): string | null {
  if (MODIFIER_CODE[event.code]) return null;
  const platform = currentPlatform();
  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push("Control");
  if (event.metaKey) modifiers.push(platform === "mac" ? "Command" : "Super");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (modifiers.length === 0) return null;

  let key = event.code;
  if (key.startsWith("Key")) key = key.slice(3);
  else if (key.startsWith("Digit")) key = key.slice(5);
  return [...modifiers, key].join("+");
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
    totalChars += Array.from(word).length;
    if (totalChars > 100) throw new Error("热词总长度不能超过 100 个字符（按接口 token 上限保守限制）");
    hotwords.push(word);
  }
  return hotwords;
}

function SectionHeading({ number, title, description }: { number: string; title: string; description: string }) {
  return (
    <div className="mb-5 flex gap-3.5">
      <span className="grid size-[31px] shrink-0 place-items-center rounded-[10px] border border-[#d8d2ff] bg-[#f3f0ff] text-[9px] font-bold tracking-[0.08em] text-[#5948d5]">
        {number}
      </span>
      <div>
        <h2 className="mt-px text-[15px] font-semibold text-[#202534]">{title}</h2>
        <p className="mt-1 text-[11px] leading-5 text-[#747d8e]">{description}</p>
      </div>
    </div>
  );
}

export function Settings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [hotwordsText, setHotwordsText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [recordingShortcut, setRecordingShortcut] = useState(false);
  const [activeSection, setActiveSection] = useState("doubao");
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [testingMicrophone, setTestingMicrophone] = useState(false);
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [testingDoubao, setTestingDoubao] = useState(false);
  const [diagnostics, setDiagnostics] = useState<PlatformDiagnostics | null>(null);
  const [microphonePermission, setMicrophonePermission] = useState<MicrophonePermission>("unknown");
  const microphoneTestRef = useRef<AudioCapture | null>(null);

  const refreshMicrophones = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    setMicrophones(devices.filter((device) => device.kind === "audioinput"));
  };

  const refreshDiagnostics = async () => {
    if (navigator.permissions?.query) {
      try {
        const permission = await navigator.permissions.query({ name: "microphone" as PermissionName });
        setMicrophonePermission(permission.state as MicrophonePermission);
      } catch {
        setMicrophonePermission("unknown");
      }
    }
    if (isTauri()) {
      try {
        setDiagnostics(await invoke<PlatformDiagnostics>("platform_diagnostics"));
      } catch (error) {
        setMessage({ kind: "error", text: String(error) });
      }
    }
  };

  useEffect(() => {
    void refreshMicrophones();
    void refreshDiagnostics();
    if (!isTauri()) {
      setHotwordsText(DEFAULT_SETTINGS.hotwords.join("\n"));
      setLoading(false);
      return;
    }
    invoke<LoadSettingsResult>("load_settings")
      .then(({ settings: loadedSettings, notice }) => {
        setSettings(loadedSettings);
        setHotwordsText(loadedSettings.hotwords.join("\n"));
        if (notice) setMessage({ kind: "info", text: notice });
      })
      .catch((error: unknown) => setMessage({ kind: "error", text: String(error) }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .reduce<IntersectionObserverEntry | undefined>(
            (best, entry) => (!best || entry.intersectionRatio > best.intersectionRatio ? entry : best),
            undefined,
          );
        if (visible?.target.id) setActiveSection(visible.target.id);
      },
      { rootMargin: "-18% 0px -62% 0px", threshold: [0.1, 0.35, 0.6] },
    );
    for (const [id] of SECTIONS) {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    }
    return () => observer.disconnect();
  }, [loading]);

  useEffect(
    () => () => {
      void microphoneTestRef.current?.stop();
    },
    [],
  );

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const hotwords = normalizeHotwords(hotwordsText);
      const nextSettings = { ...settings, hotwords };
      if (isTauri()) {
        const result = await invoke<SaveSettingsResult>("save_settings", { settings: nextSettings });
        const storage =
          result.credentialStorage === "keyring" ? "API Key 已写入系统钥匙串" : "API Key 已从系统钥匙串删除";
        const backend = result.shortcutBackend === "portal" ? "Wayland 桌面门户" : "系统全局快捷键";
        setMessage({ kind: "success", text: `设置已保存；${storage}；${backend}已生效` });
      } else {
        setMessage({ kind: "success", text: "预览模式：设置校验通过" });
      }
      setSettings(nextSettings);
      setHotwordsText(hotwords.join("\n"));
      await refreshDiagnostics();
    } catch (error) {
      setMessage({ kind: "error", text: String(error) });
    } finally {
      setSaving(false);
    }
  };

  const testMicrophone = async () => {
    setTestingMicrophone(true);
    setMicrophoneLevel(0);
    setMessage(null);
    try {
      const capture = AudioCapture.create(settings.microphoneId, () => undefined, setMicrophoneLevel);
      microphoneTestRef.current = capture;
      await capture.start();
      window.setTimeout(async () => {
        try {
          await capture.stop();
          if (microphoneTestRef.current === capture) microphoneTestRef.current = null;
          await refreshMicrophones();
          await refreshDiagnostics();
          setMessage({ kind: "success", text: "麦克风工作正常" });
        } catch (error) {
          setMessage({ kind: "error", text: `停止麦克风测试失败：${String(error)}` });
        } finally {
          setTestingMicrophone(false);
        }
      }, 2500);
    } catch (error) {
      await microphoneTestRef.current?.stop().catch(() => undefined);
      microphoneTestRef.current = null;
      setMessage({ kind: "error", text: `麦克风测试失败：${String(error)}` });
      setTestingMicrophone(false);
    }
  };

  const testDoubao = async () => {
    setTestingDoubao(true);
    setMessage(null);
    try {
      if (!isTauri()) throw new Error("浏览器预览无法测试豆包连接");
      await invoke("test_doubao", { apiKey: settings.apiKey });
      setMessage({ kind: "success", text: "豆包 API Key 与流式识别服务连接正常" });
    } catch (error) {
      setMessage({ kind: "error", text: String(error) });
    } finally {
      setTestingDoubao(false);
    }
  };

  const openConsole = async () => {
    if (isTauri()) await invoke("open_api_key_console");
    else window.open(CONSOLE_URL, "_blank", "noopener,noreferrer");
  };

  if (loading) {
    return (
      <main className="grid h-screen w-screen place-items-center bg-[#f5f6f8] text-[12px] text-[#656d7d]">
        正在读取设置…
      </main>
    );
  }

  const messageStyle =
    message?.kind === "success"
      ? "border-[#a9d8c4] bg-[#eaf8f1] text-[#17633f]"
      : message?.kind === "error"
        ? "border-[#e8b7b0] bg-[#fff0ee] text-[#8d261f]"
        : "border-[#c9c2f5] bg-[#f3f0ff] text-[#5142a8]";
  const microphoneStatus =
    microphonePermission === "granted"
      ? "已授权"
      : microphonePermission === "denied"
        ? "已拒绝"
        : microphonePermission === "prompt"
          ? "首次测试时询问"
          : "由系统管理";

  return (
    <div className="grid h-screen w-screen grid-cols-[236px_minmax(0,1fr)] overflow-hidden bg-[#f5f6f8] text-[#182033] max-[800px]:grid-cols-[190px_minmax(0,1fr)]">
      <aside className="flex flex-col border-r border-white/5 bg-[radial-gradient(circle_at_18%_4%,rgba(129,140,248,0.2),transparent_32%),linear-gradient(155deg,#111523_0%,#0b0e16_72%)] px-5 pt-[30px] pb-[22px] text-[#eef2ff]">
        <div className="flex items-center gap-3 px-1.5 pb-7">
          <div
            className="grid size-[38px] place-items-center rounded-[13px] border border-white/20 bg-linear-to-br from-[#8b5cf6] to-[#4f46e5] shadow-[0_10px_30px_rgba(79,70,229,0.3)]"
            aria-hidden="true"
          >
            <AudioWaveform size={21} strokeWidth={2.4} />
          </div>
          <div>
            <strong className="block text-[15px] tracking-[-0.01em]">VoicePaste</strong>
            <small className="mt-1 block text-[11px] text-[#a0a8ba]">随时开口，文字就位</small>
          </div>
        </div>

        <nav className="grid gap-[7px]" aria-label="设置分类">
          {SECTIONS.map(([id, label]) => {
            const active = activeSection === id;
            return (
              <a
                key={id}
                className={`flex min-h-10.5 items-center gap-3 rounded-[11px] border px-[13px] text-[13px] no-underline transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a78bfa] ${
                  active
                    ? "border-white/10 bg-white/10 text-[#f8f9ff]"
                    : "border-transparent text-[#a4acc0] hover:border-white/8 hover:bg-white/7 hover:text-[#f8f9ff]"
                }`}
                href={`#${id}`}
              >
                <span
                  className={`size-1.5 rounded-full ${active ? "bg-[#b7a6ff] shadow-[0_0_0_4px_rgba(167,139,250,0.16)]" : "bg-[#596176]"}`}
                />
                {label}
              </a>
            );
          })}
        </nav>

        <div className="mt-auto flex gap-2.5 rounded-[13px] border border-white/10 bg-white/5 p-3.5">
          <ShieldCheck className="mt-0.5 shrink-0 text-[#4ade9a]" size={16} />
          <div>
            <strong className="text-[11px] font-semibold">安全存储</strong>
            <p className="mt-1.5 text-[10px] leading-[1.55] text-[#9ca4b7]">
              API Key 只写入系统钥匙串，不保存明文副本。
            </p>
          </div>
        </div>
      </aside>

      <main className="h-screen overflow-auto scroll-smooth px-10.5 pt-8.5 pb-7 max-[800px]:px-6">
        <header className="mx-auto mb-6 flex max-w-[850px] items-start justify-between gap-8">
          <div>
            <p className="mb-2 text-[10px] font-bold tracking-[0.16em] text-[#5d4dde] uppercase">偏好设置</p>
            <h1 className="m-0 text-[28px] font-bold tracking-[-0.045em] text-[#141925]">让语音输入自然一点</h1>
            <p className="mt-2.5 max-w-[580px] text-[12px] leading-7 text-[#687184]">
              可选择按一次切换，或按住说话、松开完成。最终修正结果会自动粘贴到原来的输入位置。
            </p>
          </div>
          <button
            className="h-[38px] min-w-[104px] shrink-0 cursor-pointer rounded-[10px] border-0 bg-[#171b28] px-4 text-[12px] font-semibold text-white shadow-[0_8px_22px_rgba(23,27,40,0.14)] transition hover:-translate-y-px hover:bg-[#2b3041] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#7564e8] disabled:cursor-wait disabled:opacity-55"
            type="button"
            onClick={save}
            disabled={saving}
          >
            <span className="flex items-center justify-center gap-1.5">
              <Save size={13} />
              {saving ? "保存中…" : "保存设置"}
            </span>
          </button>
        </header>

        {message ? (
          <div
            className={`mx-auto mb-3.5 max-w-[850px] rounded-[10px] border px-3.5 py-2.5 text-[11px] leading-5 ${messageStyle}`}
            role={message.kind === "error" ? "alert" : "status"}
          >
            {message.text}
          </div>
        ) : null}

        <section
          className="mx-auto mb-[15px] max-w-[850px] scroll-mt-5 rounded-2xl border border-[#d9dde5] bg-white/95 px-6 pt-[22px] pb-6 shadow-[0_1px_2px_rgba(20,25,37,0.04),0_12px_34px_rgba(20,25,37,0.03)]"
          id="doubao"
        >
          <SectionHeading
            number="01"
            title="豆包语音"
            description="使用火山引擎 Seed-ASR 2.0 双向流式优化接口；Resource ID 已由 VoicePaste 固定管理。"
          />

          <div className="mb-4 flex items-center justify-between gap-4 rounded-xl border border-[#ddd8ff] bg-[#f7f5ff] px-4 py-3 max-[800px]:items-start">
            <div>
              <strong className="flex items-center gap-2 text-[12px] text-[#332b69]">
                <KeyRound size={14} /> 还没有 API Key？
              </strong>
              <p className="mt-1 text-[10px] leading-5 text-[#6f6795]">
                前往火山引擎豆包语音控制台创建，再粘贴到下方。
              </p>
            </div>
            <button
              className="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-[8px] border border-[#bdb4f3] bg-white px-3 text-[10px] font-semibold text-[#5545c6] hover:bg-[#efecff] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#7564e8]"
              type="button"
              onClick={() => void openConsole()}
            >
              打开控制台 <ExternalLink size={11} />
            </button>
          </div>

          <label className="grid gap-2">
            <span className="text-[11px] font-semibold text-[#41495b]">API Key</span>
            <div className="flex h-10 items-center overflow-hidden rounded-[10px] border border-[#c9ced8] bg-[#fafbfc] transition focus-within:border-[#7564e8] focus-within:bg-white focus-within:ring-3 focus-within:ring-[#6d5ce7]/15">
              <input
                className="min-w-0 flex-1 border-0 bg-transparent px-3 text-[12px] text-[#222838] outline-none"
                type={showApiKey ? "text" : "password"}
                value={settings.apiKey}
                onChange={(event) => setSettings({ ...settings, apiKey: event.target.value })}
                placeholder="请输入火山引擎豆包语音 API Key"
                autoComplete="off"
              />
              <button
                className="mr-1.5 flex h-7 cursor-pointer items-center gap-1 rounded-[7px] border-0 bg-[#ece9ff] px-2 text-[10px] text-[#5848cc] focus-visible:outline-2 focus-visible:outline-[#7564e8]"
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
              >
                {showApiKey ? <EyeOff size={12} /> : <Eye size={12} />}
                {showApiKey ? "隐藏" : "显示"}
              </button>
            </div>
          </label>
          <button
            className="mt-3 flex h-8 cursor-pointer items-center gap-1.5 rounded-[8px] border border-[#cdd1da] bg-white px-3 text-[10px] font-semibold text-[#454c5c] hover:bg-[#f5f6f8] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#7564e8] disabled:cursor-wait disabled:opacity-55"
            type="button"
            onClick={() => void testDoubao()}
            disabled={testingDoubao}
          >
            <Activity size={12} /> {testingDoubao ? "正在连接…" : "测试豆包连接"}
          </button>
        </section>

        <section
          className="mx-auto mb-[15px] max-w-[850px] scroll-mt-5 rounded-2xl border border-[#d9dde5] bg-white/95 px-6 pt-[22px] pb-6 shadow-[0_1px_2px_rgba(20,25,37,0.04),0_12px_34px_rgba(20,25,37,0.03)]"
          id="shortcut"
        >
          <SectionHeading number="02" title="唤起方式" description="在任意软件中唤起底部悬浮窗，不抢走当前输入焦点。" />

          <div
            className="mb-4 grid grid-cols-2 gap-2 rounded-xl border border-[#e0e3e9] bg-[#f7f8fa] p-1.5"
            role="radiogroup"
            aria-label="听写触发方式"
          >
            {(
              [
                ["toggle", "按一下切换", "按一次开始，再按一次完成"],
                ["hold", "按住说话", "按下开始，松开立即完成"],
              ] as const
            ).map(([value, label, description]) => {
              const selected = settings.activationMode === value;
              return (
                <button
                  key={value}
                  className={`cursor-pointer rounded-[9px] border px-3 py-2.5 text-left transition focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-[#7564e8] ${selected ? "border-[#b9aff1] bg-white shadow-sm" : "border-transparent bg-transparent hover:bg-white/70"}`}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setSettings({ ...settings, activationMode: value })}
                >
                  <strong className={`block text-[11px] ${selected ? "text-[#5140ca]" : "text-[#3f4656]"}`}>
                    {label}
                  </strong>
                  <small className="mt-1 block text-[9px] text-[#7a8292]">{description}</small>
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-6 rounded-xl border border-[#e0e3e9] bg-[#fafbfc] p-3.5 max-[800px]:flex-col max-[800px]:items-stretch">
            <div>
              <strong className="text-[12px] font-semibold text-[#303646]">全局快捷键</strong>
              <p className="mt-1 text-[10px] text-[#7f8797]">点击右侧按键区域，再按下组合键；Esc 取消录制。</p>
            </div>
            <button
              className={`h-[38px] min-w-[206px] cursor-pointer rounded-[9px] border px-3 font-mono text-[10px] outline-none max-[800px]:w-full ${recordingShortcut ? "border-[#9385e8] bg-[#f2efff] text-[#5847d0] ring-3 ring-[#6d5ce7]/15" : "border-[#c9ced8] bg-linear-to-b from-white to-[#f0f2f5] text-[#3f4655] shadow-[0_2px_0_#cdd1d9] focus-visible:ring-3 focus-visible:ring-[#6d5ce7]/20"}`}
              type="button"
              onClick={() => setRecordingShortcut(true)}
              onBlur={() => setRecordingShortcut(false)}
              onKeyDown={(event) => {
                if (!recordingShortcut) return;
                event.preventDefault();
                event.stopPropagation();
                if (event.key === "Escape") {
                  setRecordingShortcut(false);
                  event.currentTarget.blur();
                  return;
                }
                const shortcut = shortcutFromKeyboardEvent(event);
                if (!shortcut) return;
                setSettings({ ...settings, shortcut });
                setRecordingShortcut(false);
                event.currentTarget.blur();
              }}
            >
              {recordingShortcut ? "请按组合键…（Esc 取消）" : <ShortcutHint shortcut={settings.shortcut} />}
            </button>
          </div>

          <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 max-[800px]:grid-cols-1">
            <label className="grid gap-2">
              <span className="text-[11px] font-semibold text-[#41495b]">麦克风</span>
              <select
                className={INPUT_CLASS}
                value={settings.microphoneId}
                onChange={(event) => setSettings({ ...settings, microphoneId: event.target.value })}
              >
                <option value="">系统默认麦克风</option>
                {microphones.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `麦克风 ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="flex h-10 min-w-[128px] cursor-pointer items-center justify-center gap-1.5 rounded-[9px] border border-[#c9ced8] bg-white px-3 text-[10px] font-semibold text-[#41495b] hover:bg-[#f5f6f8] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#7564e8] disabled:cursor-wait disabled:opacity-55"
              type="button"
              onClick={() => void testMicrophone()}
              disabled={testingMicrophone}
            >
              <Mic size={12} /> {testingMicrophone ? "正在测试…" : "测试麦克风"}
            </button>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e7e9ee]" aria-label="麦克风音量">
            <div
              className="h-full rounded-full bg-linear-to-r from-[#7665e7] to-[#43c894] transition-[width] duration-75"
              style={{ width: `${Math.max(testingMicrophone ? 3 : 0, microphoneLevel * 100)}%` }}
            />
          </div>
        </section>

        <section
          className="mx-auto mb-[15px] max-w-[850px] scroll-mt-5 rounded-2xl border border-[#d9dde5] bg-white/95 px-6 pt-[22px] pb-6 shadow-[0_1px_2px_rgba(20,25,37,0.04),0_12px_34px_rgba(20,25,37,0.03)]"
          id="hotwords"
        >
          <SectionHeading number="03" title="热词" description="提高姓名、产品名和专业词汇的识别准确率。" />
          <label className="grid gap-2">
            <span className="text-[11px] font-semibold text-[#41495b]">每行一个词</span>
            <textarea
              className="min-h-28 w-full resize-y rounded-[10px] border border-[#c9ced8] bg-[#fafbfc] px-3 py-2.5 text-[12px] leading-7 text-[#222838] transition outline-none focus:border-[#7564e8] focus:bg-white focus:ring-3 focus:ring-[#6d5ce7]/15"
              value={hotwordsText}
              onChange={(event) => setHotwordsText(event.target.value)}
              placeholder={"VoicePaste\n你的名字\n常用产品名"}
              rows={6}
            />
            <small className="text-[10px] leading-5 text-[#7f8797]">
              保存时自动去重并清理空行；总计最多 100 个字符，这是对接口 100 token 上限的保守限制。
            </small>
          </label>
        </section>

        <section
          className="mx-auto mb-[15px] max-w-[850px] scroll-mt-5 rounded-2xl border border-[#d9dde5] bg-white/95 px-6 pt-[22px] pb-6 shadow-[0_1px_2px_rgba(20,25,37,0.04),0_12px_34px_rgba(20,25,37,0.03)]"
          id="diagnostics"
        >
          <SectionHeading
            number="04"
            title="权限与平台诊断"
            description="快速确认麦克风、快捷键与自动粘贴所依赖的系统能力。"
          />
          <div className="grid grid-cols-2 gap-3 max-[800px]:grid-cols-1">
            {[
              ["运行平台", diagnostics ? `${diagnostics.platform} · ${diagnostics.displayServer}` : currentPlatform()],
              ["全局快捷键", diagnostics?.shortcutStatus ?? "浏览器预览不注册快捷键"],
              ["麦克风权限", microphoneStatus],
              [
                "自动粘贴",
                currentPlatform() === "mac"
                  ? diagnostics?.accessibility === "granted"
                    ? "辅助功能已授权"
                    : "需要辅助功能权限"
                  : currentPlatform() === "linux"
                    ? "优先使用桌面门户 / libei，失败时保留剪贴板内容"
                    : "受 Windows 目标程序权限级别限制",
              ],
            ].map(([label, value]) => (
              <div className="rounded-xl border border-[#e0e3e9] bg-[#fafbfc] p-3.5" key={label}>
                <span className="text-[9px] font-bold tracking-[0.08em] text-[#6b7280] uppercase">{label}</span>
                <p className="mt-1.5 text-[11px] leading-5 text-[#333a49]">{value}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="flex h-8 cursor-pointer items-center gap-1.5 rounded-[8px] border border-[#c9ced8] bg-white px-3 text-[10px] font-semibold text-[#41495b] hover:bg-[#f5f6f8] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#7564e8]"
              type="button"
              onClick={() => void refreshDiagnostics()}
            >
              <RefreshCw size={12} /> 刷新诊断
            </button>
            {currentPlatform() === "mac" && diagnostics?.accessibility !== "granted" ? (
              <button
                className="flex h-8 cursor-pointer items-center gap-1.5 rounded-[8px] border border-[#bdb4f3] bg-[#f3f0ff] px-3 text-[10px] font-semibold text-[#5545c6] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#7564e8]"
                type="button"
                onClick={async () => {
                  await invoke("request_accessibility");
                  await refreshDiagnostics();
                }}
              >
                <CheckCircle2 size={12} /> 请求辅助功能权限
              </button>
            ) : null}
          </div>
        </section>

        <footer className="mx-auto mt-5.5 flex max-w-[850px] justify-between px-1 pb-2 text-[9px] tracking-[0.02em] text-[#7e8593]">
          <span>支持 macOS · Windows · Linux</span>
          <span>关闭窗口后仍会留在系统托盘运行</span>
        </footer>
      </main>
    </div>
  );
}
