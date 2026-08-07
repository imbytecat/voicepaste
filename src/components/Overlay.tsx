import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Mic } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AudioCapture } from "../audio";
import type { AsrEvent } from "../types";

type Phase = "idle" | "starting" | "recording" | "finishing" | "success" | "error";

export function Overlay() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [text, setText] = useState("");
  const [level, setLevel] = useState(0);
  const phaseRef = useRef<Phase>("idle");
  const captureRef = useRef<AudioCapture | null>(null);
  const audioQueueRef = useRef<Promise<void>>(Promise.resolve());
  const hideTimerRef = useRef<number | null>(null);

  const updatePhase = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  const stopCapture = async () => {
    const capture = captureRef.current;
    captureRef.current = null;
    if (capture) await capture.stop();
  };

  const hideLater = (delay: number) => {
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      updatePhase("idle");
      setText("");
      setLevel(0);
      void invoke("hide_overlay");
    }, delay);
  };

  const begin = async () => {
    if (phaseRef.current !== "idle" && phaseRef.current !== "success" && phaseRef.current !== "error") return;
    updatePhase("starting");
    setText("正在准备麦克风…");
    setLevel(0);
    audioQueueRef.current = Promise.resolve();

    try {
      const capture = await AudioCapture.create((pcm) => {
        audioQueueRef.current = audioQueueRef.current.then(() => invoke("send_audio", pcm));
      }, setLevel);
      captureRef.current = capture;
      await invoke("start_recognition");
      await capture.start();
      setText("");
      updatePhase("recording");
    } catch (error) {
      await stopCapture();
      setText(String(error));
      updatePhase("error");
      hideLater(2600);
    }
  };

  const finish = async () => {
    if (phaseRef.current !== "recording") return;
    updatePhase("finishing");
    setLevel(0);
    setText((current) => current || "正在整理刚才的话…");

    try {
      await stopCapture();
      await audioQueueRef.current;
      await invoke("finish_recognition");
    } catch (error) {
      setText(String(error));
      updatePhase("error");
      hideLater(2600);
    }
  };

  useEffect(() => {
    let disposed = false;
    const unlistenCallbacks: Array<() => void> = [];

    Promise.all([
      listen("shortcut-pressed", () => {
        if (phaseRef.current === "recording") void finish();
        else void begin();
      }),
      listen<AsrEvent>("asr-event", (event) => {
        if (disposed) return;
        const payload = event.payload;
        if (payload.kind === "partial") {
          setText(payload.text ?? "");
          return;
        }
        if (payload.kind === "final") {
          setText(payload.text ?? "");
          updatePhase("finishing");
          return;
        }
        if (payload.kind === "completed" || payload.kind === "copied") {
          setText(payload.message ?? (payload.kind === "completed" ? "已输入" : "已复制到剪贴板"));
          updatePhase("success");
          hideLater(payload.kind === "completed" ? 900 : 2200);
          return;
        }
        if (payload.kind === "error") {
          void stopCapture();
          setText(payload.message ?? "识别失败，请重试");
          updatePhase("error");
          hideLater(2800);
        }
      }),
    ]).then((callbacks) => {
      if (disposed) callbacks.forEach((unlisten) => unlisten());
      else unlistenCallbacks.push(...callbacks);
    });

    return () => {
      disposed = true;
      unlistenCallbacks.forEach((unlisten) => unlisten());
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
      void stopCapture();
    };
  }, []);

  const status =
    phase === "recording"
      ? "正在聆听"
      : phase === "finishing"
        ? "正在润色"
        : phase === "starting"
          ? "正在连接"
          : "VoicePaste";
  const displayText = text || (phase === "recording" ? "请开始说话…" : "按快捷键开始听写");
  const orbColor =
    phase === "success"
      ? "from-[#6ee7b7] to-[#087a4b] shadow-[0_8px_25px_rgba(22,163,106,0.3)]"
      : phase === "error"
        ? "from-[#fda4af] to-[#b62038] shadow-[0_8px_25px_rgba(229,72,93,0.3)]"
        : "from-[#a99aff] to-[#4f3dbe] shadow-[0_8px_25px_rgba(103,84,223,0.38)]";

  return (
    <main className="grid h-screen w-screen place-items-center overflow-hidden bg-transparent p-1.5 select-none">
      <div className="grid h-full w-full animate-in grid-cols-[54px_minmax(0,1fr)_116px] items-center gap-[15px] rounded-full border border-white/13 bg-[linear-gradient(110deg,rgba(27,29,38,0.96),rgba(11,12,17,0.97))] py-2.5 pr-5.5 pl-3 shadow-[0_18px_54px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-3xl duration-200 zoom-in-95 fade-in slide-in-from-bottom-2">
        <div
          className={`relative grid size-[54px] place-items-center rounded-full bg-linear-to-br ${orbColor}`}
          aria-hidden="true"
        >
          <Mic className="size-7 text-white" strokeWidth={2.3} />
          {phase === "recording" ? (
            <span className="absolute -inset-1 animate-ping rounded-full border border-[#a78bfa]/50" />
          ) : null}
        </div>

        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2.5">
            <span className="text-[9px] font-bold tracking-[0.08em] text-[#a89cf7]">{status}</span>
            {phase === "recording" ? <small className="text-[9px] text-[#62697a]">再次按快捷键完成</small> : null}
          </div>
          <p
            className={`m-0 overflow-hidden text-[15px] leading-[1.4] font-medium tracking-[-0.015em] text-ellipsis whitespace-nowrap ${phase === "error" ? "text-[#fecaca]" : phase === "success" ? "text-[#bbf7d0]" : "text-[#f3f4f8]"}`}
          >
            {displayText}
          </p>
        </div>

        <div className="flex h-10.5 items-center justify-end gap-1.25" aria-hidden="true">
          {[0.45, 0.7, 1, 0.62, 0.84, 0.52, 0.92, 0.66, 0.4].map((weight, index) => (
            <span
              className={`max-h-10.5 min-h-1.25 w-[3px] rounded-full bg-linear-to-t from-[#7161df] to-[#c4b9ff] opacity-80 transition-[height,opacity] duration-75 ${phase === "finishing" ? "animate-[pulse_900ms_ease-in-out_infinite]" : ""}`}
              key={`${weight}-${index}`}
              style={{
                height: `${8 + Math.max(level, phase === "recording" ? 0.1 : 0) * weight * 34}px`,
                animationDelay: `${index * -90}ms`,
              }}
            />
          ))}
        </div>
      </div>
    </main>
  );
}
