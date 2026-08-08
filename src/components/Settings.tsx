import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  Activity,
  AudioWaveform,
  CheckCircle2,
  Command,
  ExternalLink,
  Eye,
  EyeOff,
  Mic,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { AudioCapture, type MicrophoneDevice } from "../audio";
import { formatShortcut, formatShortcutLabel, useShortcutRecorder } from "../shortcut";
import { type AppSettings, DEFAULT_SETTINGS, type SystemDiagnostics } from "../types";

const INPUT_CLASS =
  "h-9 w-full rounded-lg border border-[#d7d9de] bg-white px-3 text-[12px] text-[#202124] outline-none transition focus:border-[#7564e8] focus:ring-3 focus:ring-[#7564e8]/10";
const CONSOLE_URL = "https://console.volcengine.com/speech/new/setting/apikeys";
const SECTIONS = [
  ["shortcut", "语音输入", Command],
  ["recognition", "识别与词汇", Sparkles],
  ["diagnostics", "权限与状态", ShieldCheck],
] as const;
type SectionId = (typeof SECTIONS)[number][0];

type Message = { kind: "success" | "error" | "info"; text: string } | null;
type LoadSettingsResult = { settings: AppSettings; notice?: string };

function ShortcutHint({ shortcut }: { shortcut: string }) {
  return (
    <kbd
      aria-label={formatShortcutLabel(shortcut)}
      className="rounded-[6px] border border-[#c8cdd7] bg-white px-1.5 py-1 font-sans text-[10px] leading-none font-semibold text-[#3d4454] shadow-[0_1px_0_#bfc4ce]"
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
    totalChars += Array.from(word).length;
    if (totalChars > 100) throw new Error("热词总长度不能超过 100 个字符（按接口 token 上限保守限制）");
    hotwords.push(word);
  }
  return hotwords;
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
        <p className="mt-1 text-[11px] leading-5 text-[#62666f]">{description}</p>
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
          : "flex min-h-[66px] items-center justify-between gap-8 px-5 py-3.5 max-[800px]:items-start"
      }
    >
      <div className={vertical ? "" : "min-w-0 flex-1"}>
        <h3 className="text-[12px] font-medium text-[#2c2e33]">{title}</h3>
        {description ? <p className="mt-1 text-[10px] leading-5 text-[#6f737b]">{description}</p> : null}
      </div>
      <div className={vertical ? "mt-3" : "min-w-0 shrink-0"}>{children}</div>
    </div>
  );
}

function Feedback({ message, className }: { message: Message; className?: string }) {
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
    >
      {message.text}
    </div>
  );
}

function microphoneTestError(error: unknown): string {
  const detail = String(error);
  return /permission|notallowederror|denied/i.test(detail)
    ? "麦克风权限未开启。请在系统设置中允许 VoicePaste 使用麦克风，然后重试。"
    : `麦克风测试失败：${detail}`;
}

export function Settings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [hotwordsText, setHotwordsText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [doubaoMessage, setDoubaoMessage] = useState<Message>(null);
  const [microphoneMessage, setMicrophoneMessage] = useState<Message>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionId>("shortcut");
  const [microphones, setMicrophones] = useState<MicrophoneDevice[]>([]);
  const [testingMicrophone, setTestingMicrophone] = useState(false);
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [testingDoubao, setTestingDoubao] = useState(false);
  const [diagnostics, setDiagnostics] = useState<SystemDiagnostics | null>(null);
  const microphoneTestRef = useRef<AudioCapture | null>(null);
  const shortcutButtonRef = useRef<HTMLButtonElement | null>(null);
  const shortcutRecorder = useShortcutRecorder({
    onRecord: (shortcut) => {
      setSettings((current) => ({ ...current, shortcut }));
      setMessage(null);
      shortcutButtonRef.current?.blur();
    },
    onInvalid: (text) => {
      setMessage({ kind: "error", text });
      shortcutButtonRef.current?.blur();
    },
  });

  const resetPreferences = () => {
    setSettings({ ...DEFAULT_SETTINGS, apiKey: settings.apiKey });
    setHotwordsText(DEFAULT_SETTINGS.hotwords.join("\n"));
    setMessage({ kind: "info", text: "已恢复默认值并保留 API Key；点击“保存”后生效。" });
  };

  const refreshMicrophones = async () => {
    try {
      setMicrophones(await AudioCapture.devices());
    } catch (error) {
      setMicrophones([]);
      setMicrophoneMessage({ kind: "error", text: `读取麦克风列表失败：${String(error)}` });
    }
  };

  const refreshDiagnostics = async () => {
    if (isTauri()) {
      try {
        setDiagnostics(await invoke<SystemDiagnostics>("system_diagnostics"));
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
        await invoke("save_settings", { settings: nextSettings });
        setMessage({ kind: "success", text: "设置已保存" });
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
    setMicrophoneMessage(null);
    let failed = false;
    const capture = AudioCapture.create(settings.microphoneId, setMicrophoneLevel, (error) => {
      failed = true;
      if (microphoneTestRef.current === capture) microphoneTestRef.current = null;
      setMicrophoneMessage({ kind: "error", text: microphoneTestError(error) });
      setTestingMicrophone(false);
      void capture.stop();
    });
    try {
      microphoneTestRef.current = capture;
      await capture.start();
      window.setTimeout(async () => {
        if (microphoneTestRef.current !== capture) return;
        try {
          await capture.stop();
          microphoneTestRef.current = null;
          await refreshMicrophones();
          await refreshDiagnostics();
          if (!failed) setMicrophoneMessage({ kind: "success", text: "麦克风工作正常" });
        } catch (error) {
          setMicrophoneMessage({ kind: "error", text: `停止麦克风测试失败：${String(error)}` });
        } finally {
          setTestingMicrophone(false);
        }
      }, 2500);
    } catch (error) {
      await microphoneTestRef.current?.stop().catch(() => undefined);
      microphoneTestRef.current = null;
      setMicrophoneMessage({ kind: "error", text: microphoneTestError(error) });
      setTestingMicrophone(false);
    }
  };

  const testDoubao = async () => {
    setTestingDoubao(true);
    setDoubaoMessage(null);
    try {
      if (!isTauri()) throw new Error("浏览器预览无法测试豆包连接");
      await invoke("test_doubao", { apiKey: settings.apiKey });
      setDoubaoMessage({ kind: "success", text: "豆包 API Key 与流式识别服务连接正常" });
    } catch (error) {
      setDoubaoMessage({ kind: "error", text: `豆包连接失败：${String(error)}` });
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

  const microphoneStatus = microphones.length > 0 ? `原生采集可用（${microphones.length} 个设备）` : "未检测到麦克风";

  return (
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
            <strong className="block text-[13px] font-semibold tracking-[-0.01em]">VoicePaste</strong>
            <small className="mt-0.5 block text-[9px] text-[#696d75]">设置</small>
          </div>
        </div>

        <nav className="mt-5 grid gap-1" aria-label="设置分类">
          {SECTIONS.map(([id, label, Icon]) => {
            const active = activeSection === id;
            return (
              <button
                key={id}
                className={`flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg border-0 px-3 text-left text-[11px] font-medium transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#7564e8] ${
                  active
                    ? "bg-[#efedff] text-[#5748ca]"
                    : "bg-transparent text-[#666a73] hover:bg-[#f0f1f3] hover:text-[#282b31]"
                }`}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => setActiveSection(id)}
              >
                <Icon size={14} strokeWidth={active ? 2.2 : 1.8} />
                {label}
              </button>
            );
          })}
        </nav>

        <p className="mt-auto px-3 pb-1 text-[9px] leading-4 text-[#696d75]">关闭窗口后继续在系统托盘运行</p>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-[#e4e5e8] bg-white px-8">
          <div>
            <h1 className="text-[18px] font-semibold tracking-[-0.02em] text-[#202124]">设置</h1>
            <p className="mt-1 text-[10px] text-[#6f737b]">调整语音输入、快捷键和识别偏好</p>
          </div>
          <div className="flex gap-2">
            <button
              className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-[#d7d9de] bg-white px-3 text-[10px] font-medium text-[#5c6068] transition hover:bg-[#f5f5f6] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#7564e8] disabled:cursor-wait disabled:opacity-55"
              type="button"
              onClick={resetPreferences}
              disabled={saving}
            >
              <RotateCcw size={11} /> 恢复默认
            </button>
            <button
              className="flex h-8 min-w-[88px] cursor-pointer items-center justify-center gap-1.5 rounded-lg border-0 bg-[#6558e8] px-3 text-[10px] font-medium text-white transition hover:bg-[#584bcf] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#7564e8] disabled:cursor-wait disabled:opacity-55"
              type="button"
              onClick={save}
              disabled={saving}
            >
              <Save size={11} /> {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-auto scroll-smooth px-8 py-6">
          <div className="mx-auto max-w-[720px]">
            <Feedback message={message} className="mb-5" />
            {activeSection === "shortcut" && !settings.apiKey ? (
              <div
                className="mb-5 flex items-center justify-between gap-4 rounded-lg border border-[#ead9b7] bg-[#fff8ea] px-3.5 py-2.5 text-[10px] text-[#6d511e]"
                role="status"
              >
                <span>开始听写前，需要先配置语音识别服务。</span>
                <button
                  className="shrink-0 cursor-pointer border-0 bg-transparent p-0 font-medium text-[#5748ca] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7564e8]"
                  type="button"
                  onClick={() => setActiveSection("recognition")}
                >
                  去配置
                </button>
              </div>
            ) : null}

            {activeSection === "shortcut" ? (
              <SettingsSection id="shortcut" title="语音输入" description="在任意输入框按快捷键开始说话。">
                <SettingRow title="触发方式" description="选择快捷键按下后的行为。">
                  <div
                    className="grid w-[286px] grid-cols-2 rounded-lg bg-[#f0f1f3] p-1"
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
                          onClick={() => setSettings({ ...settings, activationMode: value })}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </SettingRow>

                <SettingRow title="全局快捷键" description="点击后按下新的组合键，Esc 取消。">
                  <button
                    ref={shortcutButtonRef}
                    className={`h-9 min-w-[184px] cursor-pointer rounded-lg border px-3 font-mono text-[10px] outline-none ${
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
                    {shortcutRecorder.isRecording ? "请按组合键…" : <ShortcutHint shortcut={settings.shortcut} />}
                  </button>
                </SettingRow>

                <SettingRow title="麦克风" description="默认使用系统当前选择的输入设备。">
                  <div className="w-[410px] max-[800px]:w-[360px]">
                    <div className="flex gap-2">
                      <select
                        className={INPUT_CLASS}
                        aria-label="麦克风"
                        value={settings.microphoneId}
                        onChange={(event) => {
                          setSettings({ ...settings, microphoneId: event.target.value });
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
                        className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-[#d7d9de] bg-white px-3 text-[10px] font-medium text-[#555962] hover:bg-[#f5f5f6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7564e8] disabled:cursor-wait disabled:opacity-55"
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
                        style={{ width: `${Math.max(testingMicrophone ? 3 : 0, microphoneLevel * 100)}%` }}
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
            ) : null}

            {activeSection === "recognition" ? (
              <SettingsSection
                id="recognition"
                title="识别与词汇"
                description="配置识别服务，并提高人名和专业词汇的准确率。"
              >
                <SettingRow title="豆包 API Key" description="从火山引擎控制台获取，用于连接语音识别服务。">
                  <div className="w-[410px] max-[800px]:w-[360px]">
                    <div className="flex h-9 items-center overflow-hidden rounded-lg border border-[#d7d9de] bg-white transition focus-within:border-[#7564e8] focus-within:ring-3 focus-within:ring-[#7564e8]/10">
                      <input
                        className="min-w-0 flex-1 border-0 bg-transparent px-3 text-[12px] text-[#202124] outline-none"
                        type={showApiKey ? "text" : "password"}
                        value={settings.apiKey}
                        onChange={(event) => {
                          setSettings({ ...settings, apiKey: event.target.value });
                          setDoubaoMessage(null);
                        }}
                        placeholder="粘贴 API Key"
                        autoComplete="off"
                      />
                      <button
                        className="mr-1 grid size-7 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-[#777b84] hover:bg-[#f1f1f3] focus-visible:outline-2 focus-visible:outline-[#7564e8]"
                        type="button"
                        onClick={() => setShowApiKey(!showApiKey)}
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
                        disabled={testingDoubao}
                      >
                        <Activity size={11} /> {testingDoubao ? "连接中…" : "测试连接"}
                      </button>
                    </div>
                  </div>
                </SettingRow>
                {doubaoMessage ? (
                  <div className="px-5 py-3">
                    <Feedback message={doubaoMessage} />
                  </div>
                ) : null}
                <SettingRow title="常用词" description="每行一个词，最多 100 个字符。" vertical>
                  <textarea
                    className="min-h-28 w-full resize-y rounded-lg border border-[#d7d9de] bg-white px-3 py-2.5 text-[12px] leading-6 text-[#202124] transition outline-none focus:border-[#7564e8] focus:ring-3 focus:ring-[#7564e8]/10"
                    value={hotwordsText}
                    onChange={(event) => setHotwordsText(event.target.value)}
                    placeholder={"VoicePaste\n你的名字\n常用产品名"}
                    rows={5}
                  />
                </SettingRow>
              </SettingsSection>
            ) : null}

            {activeSection === "diagnostics" ? (
              <SettingsSection id="diagnostics" title="权限与状态" description="仅在功能不可用时需要查看。">
                <SettingRow title="全局快捷键">
                  <span className="max-w-[410px] text-right text-[10px] leading-5 text-[#666a73]">
                    {diagnostics?.shortcutStatus ?? "浏览器预览不注册快捷键"}
                  </span>
                </SettingRow>
                <SettingRow title="麦克风">
                  <span className="max-w-[410px] text-right text-[10px] leading-5 text-[#666a73]">
                    {microphoneStatus}
                  </span>
                </SettingRow>
                <SettingRow title="自动粘贴">
                  <span className="max-w-[410px] text-right text-[10px] leading-5 text-[#666a73]">
                    {diagnostics?.inputStatus ?? "浏览器预览不检查自动粘贴"}
                  </span>
                </SettingRow>
                <div className="flex justify-end gap-2 px-5 py-3">
                  <button
                    className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-[#d7d9de] bg-white px-3 text-[10px] font-medium text-[#555962] hover:bg-[#f5f5f6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7564e8]"
                    type="button"
                    onClick={() => void refreshDiagnostics()}
                  >
                    <RefreshCw size={11} /> 刷新
                  </button>
                  {diagnostics && !diagnostics.inputReady ? (
                    <button
                      className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-[#cfc9f6] bg-[#f3f1ff] px-3 text-[10px] font-medium text-[#5748ca] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7564e8]"
                      type="button"
                      onClick={async () => {
                        try {
                          await invoke("retry_input_access");
                          await refreshDiagnostics();
                        } catch (error) {
                          setMessage({ kind: "error", text: String(error) });
                        }
                      }}
                    >
                      <CheckCircle2 size={11} /> 重试自动粘贴
                    </button>
                  ) : null}
                </div>
              </SettingsSection>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}
