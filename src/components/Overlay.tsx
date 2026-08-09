import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Check, LoaderCircle, Mic, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { AudioCapture } from "../audio";
import type { AsrEvent, ShortcutEvent } from "../types";

type Phase =
  | "idle"
  | "starting"
  | "recording"
  | "finishing"
  | "success"
  | "error";
const WAVE_WEIGHTS = [0.45, 0.7, 1, 0.62, 0.84, 0.52, 0.92, 0.66, 0.4] as const;

export function Overlay() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [text, setText] = useState("");
  const [level, setLevel] = useState(0);
  const phaseRef = useRef<Phase>("idle");
  const captureRef = useRef<AudioCapture | null>(null);
  const sessionRef = useRef<string | null>(null);
  const audioFailedRef = useRef(false);
  const finishRequestedRef = useRef(false);
  const hideTimerRef = useRef<number | null>(null);
  const hideGenerationRef = useRef(0);
  const activationModeRef = useRef<ShortcutEvent["activationMode"]>("toggle");
  const previewRef = useRef<HTMLParagraphElement | null>(null);

  const updatePhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const clearHideTimer = useCallback(() => {
    hideGenerationRef.current += 1;
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const stopCapture = useCallback(async () => {
    const capture = captureRef.current;
    captureRef.current = null;
    if (capture) await capture.stop();
  }, []);

  const hideLater = useCallback(
    (delay: number) => {
      clearHideTimer();
      const generation = hideGenerationRef.current;
      hideTimerRef.current = window.setTimeout(() => {
        if (generation !== hideGenerationRef.current) return;
        updatePhase("idle");
        setText("");
        setLevel(0);
        sessionRef.current = null;
        void invoke("hide_overlay");
      }, delay);
    },
    [clearHideTimer, updatePhase]
  );

  const cancelSession = useCallback(
    async (sessionId: string | null) => {
      finishRequestedRef.current = false;
      await stopCapture().catch(() => {});
      if (sessionId)
        await invoke("cancel_recognition", { sessionId }).catch(() => {});
      if (sessionRef.current === sessionId) sessionRef.current = null;
    },
    [stopCapture]
  );

  const failSession = useCallback(
    async (sessionId: string, error: unknown) => {
      if (sessionRef.current !== sessionId || audioFailedRef.current) return;
      audioFailedRef.current = true;
      await cancelSession(sessionId);
      setText(String(error));
      updatePhase("error");
      hideLater(3200);
    },
    [cancelSession, hideLater, updatePhase]
  );

  const finish = useCallback(
    async (sessionId = sessionRef.current) => {
      if (!sessionId || sessionRef.current !== sessionId) return;
      if (phaseRef.current === "starting") {
        finishRequestedRef.current = true;
        return;
      }
      if (phaseRef.current !== "recording") return;
      updatePhase("finishing");
      setLevel(0);
      setText((current) => current || "正在整理刚才的话…");

      try {
        await stopCapture();
        if (sessionRef.current === sessionId && !audioFailedRef.current) {
          await invoke("finish_recognition", { sessionId });
        }
      } catch (error) {
        await failSession(sessionId, error);
      }
    },
    [failSession, stopCapture, updatePhase]
  );

  const begin = useCallback(
    async (shortcut: ShortcutEvent) => {
      if (
        phaseRef.current !== "idle" &&
        phaseRef.current !== "success" &&
        phaseRef.current !== "error"
      )
        return;
      clearHideTimer();
      const previousSession = sessionRef.current;
      if (previousSession) await cancelSession(previousSession);

      const sessionId = crypto.randomUUID();
      sessionRef.current = sessionId;
      activationModeRef.current = shortcut.activationMode;
      audioFailedRef.current = false;
      finishRequestedRef.current = false;
      updatePhase("starting");
      setText("正在准备麦克风…");
      setLevel(0);

      try {
        const capture = new AudioCapture(
          shortcut.microphoneId,
          setLevel,
          (error) => {
            void failSession(sessionId, error);
          }
        );
        captureRef.current = capture;
        await invoke("start_recognition", { sessionId });
        await capture.start(sessionId);
        if (sessionRef.current !== sessionId) return;
        setText("");
        updatePhase("recording");
        if (finishRequestedRef.current) void finish(sessionId);
      } catch (error) {
        await failSession(sessionId, error);
      }
    },
    [cancelSession, clearHideTimer, failSession, finish, updatePhase]
  );

  useEffect(() => {
    let disposed = false;
    const unlistenCallbacks: (() => void)[] = [];

    Promise.all([
      listen<ShortcutEvent>("shortcut-event", (event) => {
        if (disposed) return;
        const shortcut = event.payload;
        activationModeRef.current = shortcut.activationMode;
        if (shortcut.activationMode === "hold") {
          if (shortcut.state === "pressed") void begin(shortcut);
          else void finish();
          return;
        }
        if (shortcut.state === "pressed") {
          if (
            phaseRef.current === "recording" ||
            phaseRef.current === "starting"
          )
            void finish();
          else void begin(shortcut);
        }
      }),
      listen<AsrEvent>("asr-event", (event) => {
        if (disposed) return;
        const { payload } = event;
        const sessionId = sessionRef.current;
        if (payload.sessionId && payload.sessionId !== sessionId) return;
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
          sessionRef.current = null;
          setText(
            payload.message ??
              (payload.kind === "completed" ? "已输入" : "已复制到剪贴板")
          );
          updatePhase("success");
          hideLater(payload.kind === "completed" ? 900 : 2600);
          return;
        }
        if (payload.kind === "empty") {
          sessionRef.current = null;
          setText(payload.message ?? "没有听到可输入的内容");
          updatePhase("error");
          hideLater(2000);
          return;
        }
        if (payload.kind === "error") {
          void stopCapture();
          sessionRef.current = null;
          setText(payload.message ?? "识别失败，请重试");
          updatePhase("error");
          hideLater(3200);
        }
      }),
    ])
      .then((callbacks) => {
        if (disposed)
          callbacks.forEach((unlisten) => {
            unlisten();
          });
        else {
          unlistenCallbacks.push(...callbacks);
          void invoke("overlay_ready");
        }
      })
      .catch((error: unknown) => {
        if (disposed) return;
        setText(`悬浮窗初始化失败：${String(error)}`);
        updatePhase("error");
        hideLater(3200);
      });

    return () => {
      disposed = true;
      unlistenCallbacks.forEach((unlisten) => {
        unlisten();
      });
      clearHideTimer();
      void cancelSession(sessionRef.current);
    };
  }, [
    begin,
    cancelSession,
    clearHideTimer,
    finish,
    hideLater,
    stopCapture,
    updatePhase,
  ]);

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;
    preview.scrollLeft = phase === "recording" ? preview.scrollWidth : 0;
  }, [phase, text]);

  const status =
    phase === "recording"
      ? "正在听"
      : phase === "finishing"
        ? "正在整理"
        : phase === "starting"
          ? "正在连接"
          : phase === "success"
            ? "已完成"
            : phase === "error"
              ? "需要处理"
              : "VoicePaste";
  const displayText =
    phase === "finishing"
      ? "正在生成最终文本…"
      : text || (phase === "recording" ? "请开始说话…" : "按快捷键开始听写");
  const orbColor =
    phase === "success"
      ? "from-[#6ee7b7] to-[#087a4b] shadow-[0_6px_18px_rgba(22,163,106,0.28)]"
      : phase === "error"
        ? "from-[#fda4af] to-[#b62038] shadow-[0_6px_18px_rgba(229,72,93,0.28)]"
        : "from-[#a99aff] to-[#4f3dbe] shadow-[0_6px_18px_rgba(103,84,223,0.34)]";
  const statusColor =
    phase === "success"
      ? "text-[#86efac]"
      : phase === "error"
        ? "text-[#fda4af]"
        : "text-[#b8afff]";

  return (
    <main className="grid h-screen w-screen place-items-center overflow-hidden bg-transparent p-1 select-none">
      <div className="grid size-full animate-in grid-cols-[40px_minmax(0,1fr)_74px] items-center gap-2.5 rounded-[24px] border border-white/13 bg-[linear-gradient(110deg,rgba(27,29,38,0.96),rgba(11,12,17,0.97))] py-2 pr-3.5 pl-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] duration-200 zoom-in-95 fade-in slide-in-from-bottom-2">
        <div
          className={`relative grid size-10 place-items-center rounded-full bg-linear-to-br ${orbColor}`}
          aria-hidden="true"
        >
          {phase === "starting" || phase === "finishing" ? (
            <LoaderCircle
              className="size-5 animate-spin text-white"
              strokeWidth={2.2}
            />
          ) : phase === "success" ? (
            <Check className="size-5.5 text-white" strokeWidth={2.5} />
          ) : phase === "error" ? (
            <TriangleAlert className="size-5 text-white" strokeWidth={2.3} />
          ) : (
            <Mic className="size-5 text-white" strokeWidth={2.3} />
          )}
          {phase === "recording" ? (
            <span className="absolute -inset-0.5 animate-ping rounded-full border border-[#a78bfa]/45" />
          ) : null}
        </div>

        <div className="min-w-0" aria-live="polite">
          <div className="mb-0.5 flex items-center gap-2 overflow-hidden whitespace-nowrap">
            <span
              className={`shrink-0 text-[9px] font-bold tracking-[0.08em] ${statusColor}`}
            >
              {status}
            </span>
            {phase === "recording" ? (
              <small className="truncate text-[9px] text-[#858da1]">
                {activationModeRef.current === "hold"
                  ? "松开完成"
                  : "再次按下完成"}
              </small>
            ) : null}
          </div>
          <p
            ref={previewRef}
            className={`m-0 overflow-hidden text-[12.5px] leading-[1.3] font-medium tracking-[-0.01em] whitespace-nowrap ${phase === "error" ? "text-[#fecaca]" : phase === "success" ? "text-[#bbf7d0]" : "text-[#f3f4f8]"}`}
            title={displayText}
          >
            {displayText}
          </p>
        </div>

        <div
          className={`flex h-8 items-center justify-end gap-1 transition-opacity duration-150 ${phase === "success" || phase === "error" ? "opacity-0" : "opacity-80"}`}
          aria-hidden="true"
        >
          {WAVE_WEIGHTS.map((weight, index) => (
            <span
              className={`max-h-8 min-h-1 w-0.5 rounded-full bg-linear-to-t from-[#7161df] to-[#c4b9ff] transition-[height,opacity] duration-75 ${phase === "finishing" ? "animate-[pulse_900ms_ease-in-out_infinite]" : ""}`}
              key={`${weight}-${index}`}
              style={{
                animationDelay: `${index * -90}ms`,
                height: `${6 + Math.max(level, phase === "recording" ? 0.1 : 0) * weight * 24}px`,
              }}
            />
          ))}
        </div>
      </div>
    </main>
  );
}
