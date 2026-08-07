import { invoke, isTauri } from "@tauri-apps/api/core";
import { AudioWaveform, Eye, EyeOff, Save, ShieldCheck } from "lucide-react";
import { type KeyboardEvent, useEffect, useState } from "react";
import { type AppSettings, DEFAULT_SETTINGS } from "../types";

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
  "h-10 w-full rounded-[10px] border border-[#dcdfe6] bg-[#fafbfc] px-3 text-[12px] text-[#222838] outline-none transition focus:border-[#9485f0] focus:bg-white focus:ring-3 focus:ring-[#6d5ce7]/10";

function shortcutFromKeyboardEvent(event: KeyboardEvent<HTMLButtonElement>): string | null {
  if (MODIFIER_CODE[event.code]) return null;

  const modifiers: string[] = [];
  if (event.ctrlKey || event.metaKey) modifiers.push("CommandOrControl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (modifiers.length === 0) return null;

  let key = event.code;
  if (key.startsWith("Key")) key = key.slice(3);
  else if (key.startsWith("Digit")) key = key.slice(5);
  return [...modifiers, key].join("+");
}

export function Settings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [recordingShortcut, setRecordingShortcut] = useState(false);

  useEffect(() => {
    if (!isTauri()) {
      setLoading(false);
      return;
    }
    invoke<AppSettings>("load_settings")
      .then(setSettings)
      .catch((error: unknown) => setMessage(String(error)))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      await invoke("save_settings", { settings });
      setMessage("设置已保存，快捷键立即生效");
    } catch (error) {
      setMessage(String(error));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="grid h-screen w-screen place-items-center bg-[#f5f6f8] text-[12px] text-[#7b8190]">
        正在读取设置…
      </main>
    );
  }

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
            <small className="mt-1 block text-[11px] text-[#8991a8]">随时开口，文字就位</small>
          </div>
        </div>

        <nav className="grid gap-[7px]" aria-label="设置分类">
          {[
            ["#doubao", "豆包语音"],
            ["#shortcut", "唤起方式"],
            ["#hotwords", "识别优化"],
          ].map(([href, label], index) => (
            <a
              key={href}
              className={`flex min-h-10.5 items-center gap-3 rounded-[11px] border px-[13px] text-[13px] no-underline transition ${
                index === 0
                  ? "border-white/7 bg-white/7 text-[#f8f9ff]"
                  : "border-transparent text-[#939bb0] hover:border-white/7 hover:bg-white/7 hover:text-[#f8f9ff]"
              }`}
              href={href}
            >
              <span
                className={`size-1.5 rounded-full ${index === 0 ? "bg-[#a78bfa] shadow-[0_0_0_4px_rgba(167,139,250,0.12)]" : "bg-[#4b5266]"}`}
              />
              {label}
            </a>
          ))}
        </nav>

        <div className="mt-auto flex gap-2.5 rounded-[13px] border border-white/8 bg-white/4 p-3.5">
          <ShieldCheck className="mt-0.5 shrink-0 text-[#34d399]" size={16} />
          <div>
            <strong className="text-[11px] font-semibold">安全存储</strong>
            <p className="mt-1.5 text-[10px] leading-[1.55] text-[#7f879c]">
              API Key 优先写入系统钥匙串；不可用时仅回退到本机设置。
            </p>
          </div>
        </div>
      </aside>

      <main className="h-screen overflow-auto scroll-smooth px-10.5 pt-8.5 pb-7 max-[800px]:px-6">
        <header className="mx-auto mb-6 flex max-w-[850px] items-start justify-between gap-8">
          <div>
            <p className="mb-2 text-[10px] font-bold tracking-[0.16em] text-[#6d5ce7] uppercase">偏好设置</p>
            <h1 className="m-0 text-[28px] font-bold tracking-[-0.045em] text-[#141925]">让语音输入自然一点</h1>
            <p className="mt-2.5 max-w-[580px] text-[12px] leading-7 text-[#737b8c]">
              按一次快捷键开始说话，再按一次完成。最终修正结果会自动粘贴到原来的输入位置。
            </p>
          </div>
          <button
            className="h-[38px] min-w-[104px] shrink-0 cursor-pointer rounded-[10px] border-0 bg-[#171b28] px-4 text-[12px] font-semibold text-white shadow-[0_8px_22px_rgba(23,27,40,0.14)] transition hover:-translate-y-px hover:bg-[#2b3041] disabled:cursor-wait disabled:opacity-55"
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
            className={`mx-auto mb-3.5 max-w-[850px] rounded-[10px] border px-3.5 py-2.5 text-[11px] ${message.includes("已保存") ? "border-[#bfe5d4] bg-[#eefaf5] text-[#247451]" : "border-[#f2cdc8] bg-[#fff3f1] text-[#9f342c]"}`}
          >
            {message}
          </div>
        ) : null}

        <section
          className="mx-auto mb-[15px] max-w-[850px] scroll-mt-5 rounded-2xl border border-[#e1e3e9] bg-white/90 px-6 pt-[22px] pb-6 shadow-[0_1px_2px_rgba(20,25,37,0.03),0_12px_34px_rgba(20,25,37,0.025)]"
          id="doubao"
        >
          <div className="mb-5 flex gap-3.5">
            <span className="grid size-[31px] shrink-0 place-items-center rounded-[10px] border border-[#ddd9ff] bg-[#f6f4ff] text-[9px] font-bold tracking-[0.08em] text-[#6c5ce7]">
              01
            </span>
            <div>
              <h2 className="mt-px text-[15px] font-semibold text-[#202534]">豆包语音</h2>
              <p className="mt-1 text-[11px] text-[#8990a0]">
                使用火山引擎 Seed-ASR 2.0 双向流式优化接口，新版控制台仅需 API Key。
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-4.5 gap-y-4 max-[800px]:grid-cols-1">
            <label className="col-span-full grid gap-2">
              <span className="text-[11px] font-semibold text-[#4e5668]">API Key</span>
              <div className="flex h-10 items-center overflow-hidden rounded-[10px] border border-[#dcdfe6] bg-[#fafbfc] transition focus-within:border-[#9485f0] focus-within:bg-white focus-within:ring-3 focus-within:ring-[#6d5ce7]/10">
                <input
                  className="min-w-0 flex-1 border-0 bg-transparent px-3 text-[12px] text-[#222838] outline-none"
                  type={showApiKey ? "text" : "password"}
                  value={settings.apiKey}
                  onChange={(event) => setSettings({ ...settings, apiKey: event.target.value })}
                  placeholder="请输入新版火山引擎控制台 API Key"
                  autoComplete="off"
                />
                <button
                  className="mr-1.5 flex h-7 cursor-pointer items-center gap-1 rounded-[7px] border-0 bg-[#f0edff] px-2 text-[10px] text-[#6c5ce7]"
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? <EyeOff size={12} /> : <Eye size={12} />}
                  {showApiKey ? "隐藏" : "显示"}
                </button>
              </div>
            </label>

            <label className="col-span-full grid gap-2">
              <span className="text-[11px] font-semibold text-[#4e5668]">Resource ID</span>
              <input
                className={INPUT_CLASS}
                value={settings.resourceId}
                onChange={(event) => setSettings({ ...settings, resourceId: event.target.value })}
                placeholder="volc.seedasr.sauc.duration"
                autoComplete="off"
              />
              <small className="text-[10px] leading-4 text-[#959cab]">默认值适用于大模型流式语音识别时长版资源。</small>
            </label>
          </div>
        </section>

        <section
          className="mx-auto mb-[15px] max-w-[850px] scroll-mt-5 rounded-2xl border border-[#e1e3e9] bg-white/90 px-6 pt-[22px] pb-6 shadow-[0_1px_2px_rgba(20,25,37,0.03),0_12px_34px_rgba(20,25,37,0.025)]"
          id="shortcut"
        >
          <div className="mb-5 flex gap-3.5">
            <span className="grid size-[31px] shrink-0 place-items-center rounded-[10px] border border-[#ddd9ff] bg-[#f6f4ff] text-[9px] font-bold tracking-[0.08em] text-[#6c5ce7]">
              02
            </span>
            <div>
              <h2 className="mt-px text-[15px] font-semibold text-[#202534]">全局快捷键</h2>
              <p className="mt-1 text-[11px] text-[#8990a0]">在任意软件中唤起底部悬浮窗，不抢走当前输入焦点。</p>
            </div>
          </div>

          <div className="flex items-center justify-between gap-6 rounded-xl border border-[#e7e8ed] bg-[#fafbfc] p-3.5 max-[800px]:flex-col max-[800px]:items-stretch">
            <div>
              <strong className="text-[12px] font-semibold text-[#303646]">开始 / 完成听写</strong>
              <p className="mt-1 text-[10px] text-[#9097a6]">点击右侧按键区域，再按下你想使用的组合键。</p>
            </div>
            <button
              className={`h-[38px] min-w-[206px] cursor-pointer rounded-[9px] border px-3 font-mono text-[10px] outline-none max-[800px]:w-full ${recordingShortcut ? "border-[#a99df1] bg-[#f6f4ff] text-[#6d5ce7] ring-3 ring-[#6d5ce7]/10" : "border-[#d9dce4] bg-linear-to-b from-white to-[#f2f3f6] text-[#4d5363] shadow-[0_2px_0_#d8dae1]"}`}
              type="button"
              onClick={() => setRecordingShortcut(true)}
              onBlur={() => setRecordingShortcut(false)}
              onKeyDown={(event) => {
                if (!recordingShortcut) return;
                event.preventDefault();
                event.stopPropagation();
                const shortcut = shortcutFromKeyboardEvent(event);
                if (!shortcut) return;
                setSettings({ ...settings, shortcut });
                setRecordingShortcut(false);
                event.currentTarget.blur();
              }}
            >
              {recordingShortcut ? "请按组合键…" : settings.shortcut}
            </button>
          </div>
        </section>

        <section
          className="mx-auto mb-[15px] max-w-[850px] scroll-mt-5 rounded-2xl border border-[#e1e3e9] bg-white/90 px-6 pt-[22px] pb-6 shadow-[0_1px_2px_rgba(20,25,37,0.03),0_12px_34px_rgba(20,25,37,0.025)]"
          id="hotwords"
        >
          <div className="mb-5 flex gap-3.5">
            <span className="grid size-[31px] shrink-0 place-items-center rounded-[10px] border border-[#ddd9ff] bg-[#f6f4ff] text-[9px] font-bold tracking-[0.08em] text-[#6c5ce7]">
              03
            </span>
            <div>
              <h2 className="mt-px text-[15px] font-semibold text-[#202534]">热词</h2>
              <p className="mt-1 text-[11px] text-[#8990a0]">提高姓名、产品名和专业词汇的识别准确率。</p>
            </div>
          </div>

          <label className="grid gap-2">
            <span className="text-[11px] font-semibold text-[#4e5668]">每行一个词</span>
            <textarea
              className="min-h-28 w-full resize-y rounded-[10px] border border-[#dcdfe6] bg-[#fafbfc] px-3 py-2.5 text-[12px] leading-7 text-[#222838] transition outline-none focus:border-[#9485f0] focus:bg-white focus:ring-3 focus:ring-[#6d5ce7]/10"
              value={settings.hotwords.join("\n")}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  hotwords: event.target.value
                    .split("\n")
                    .map((word) => word.trim())
                    .filter(Boolean),
                })
              }
              placeholder={"VoicePaste\n你的名字\n常用产品名"}
              rows={6}
            />
            <small className="text-[10px] leading-4 text-[#959cab]">
              豆包双向流式接口最多支持约 100 个 token，建议只填写真正容易识别错的词。
            </small>
          </label>
        </section>

        <footer className="mx-auto mt-5.5 flex max-w-[850px] justify-between px-1 pb-2 text-[9px] tracking-[0.02em] text-[#a0a6b2]">
          <span>支持 macOS · Windows · Linux</span>
          <span>关闭窗口后仍会留在系统托盘运行</span>
        </footer>
      </main>
    </div>
  );
}
