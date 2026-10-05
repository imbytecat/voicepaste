import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Mic, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AudioCapture } from "@/audio";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { isServiceIssue, recognitionReady, safeError } from "@/recognition";
import type { AccountStatus, AsrEvent, RecognitionSettings } from "@/types";

interface PreviewSession {
  id: string;
  capture: AudioCapture | null;
  unlisten: (() => void) | null;
  cancelled: boolean;
}

async function releasePreview(session: PreviewSession, cancel: boolean) {
  session.cancelled = true;
  session.unlisten?.();
  session.unlisten = null;
  try {
    await session.capture?.stop();
  } finally {
    if (cancel) await invoke("cancel_recognition", { sessionId: session.id });
  }
}

export function RecognitionSpeechTest({
  recognition,
  providerRevision,
  account,
  microphoneId,
  disabled = false,
  onBusyChange,
}: {
  recognition: RecognitionSettings;
  providerRevision: number;
  account: AccountStatus;
  microphoneId: string;
  disabled?: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [phase, setPhase] = useState<
    "idle" | "starting" | "recording" | "finishing"
  >("idle");
  const [text, setText] = useState("");
  const [level, setLevel] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const sessionRef = useRef<PreviewSession | null>(null);

  useEffect(() => {
    setText("");
    setErrorMessage(null);
    setLevel(0);
    setPhase("idle");
    return () => {
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session) void releasePreview(session, true).catch(() => {});
      onBusyChange(false);
    };
  }, [
    recognition.provider,
    providerRevision,
    recognition.volcengine.apiKey,
    account.revision,
    account.state,
    microphoneId,
    onBusyChange,
  ]);

  const fail = async (session: PreviewSession, cause: unknown) => {
    if (sessionRef.current !== session) return;
    sessionRef.current = null;
    setErrorMessage(
      isServiceIssue(cause)
        ? cause.detail
        : safeError(cause, recognition.volcengine.apiKey)
    );
    setPhase("idle");
    setLevel(0);
    onBusyChange(false);
    await releasePreview(session, true).catch(() => {});
  };

  const begin = async () => {
    if (sessionRef.current || disabled) return;
    setText("");
    setErrorMessage(null);
    if (!isTauri()) {
      setErrorMessage(
        "浏览器预览无法试说；请在 VoicePaste 桌面版中使用真实麦克风。"
      );
      return;
    }
    const session: PreviewSession = {
      id: crypto.randomUUID(),
      capture: null,
      unlisten: null,
      cancelled: false,
    };
    sessionRef.current = session;
    setPhase("starting");
    onBusyChange(true);
    try {
      session.unlisten = await listen<AsrEvent>("asr-event", (event) => {
        if (
          sessionRef.current !== session ||
          event.payload.sessionId !== session.id
        )
          return;
        const { payload } = event;
        if (payload.kind === "partial" || payload.kind === "final") {
          setText(payload.text ?? "");
          return;
        }
        if (payload.kind === "error" || payload.kind === "empty") {
          void fail(session, payload.message ?? "未识别到语音，请重试");
          return;
        }
        if (payload.kind === "completed") {
          if (payload.text !== undefined) setText(payload.text);
          sessionRef.current = null;
          setPhase("idle");
          setLevel(0);
          onBusyChange(false);
          void releasePreview(session, false).catch((error: unknown) => {
            setErrorMessage(safeError(error, recognition.volcengine.apiKey));
          });
        }
      });
      if (session.cancelled) {
        session.unlisten();
        return;
      }
      session.capture = new AudioCapture(
        microphoneId,
        (next) => {
          if (sessionRef.current === session) setLevel(next);
        },
        (cause) => void fail(session, cause)
      );
      await invoke("start_recognition_preview", {
        sessionId: session.id,
        recognition,
        providerRevision,
      });
      if (session.cancelled) {
        await releasePreview(session, true);
        return;
      }
      await session.capture.start(session.id);
      if (session.cancelled) {
        await releasePreview(session, true);
        return;
      }
      setPhase("recording");
    } catch (error) {
      await fail(session, error);
    }
  };

  const finish = async () => {
    const session = sessionRef.current;
    if (!session || phase !== "recording") return;
    setPhase("finishing");
    try {
      await session.capture?.stop();
      setLevel(0);
      if (sessionRef.current === session)
        await invoke("finish_recognition", { sessionId: session.id });
    } catch (error) {
      await fail(session, error);
    }
  };

  const cancel = async () => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    setPhase("idle");
    setLevel(0);
    setText("");
    onBusyChange(false);
    try {
      await releasePreview(session, true);
    } catch (error) {
      setErrorMessage(safeError(error, recognition.volcengine.apiKey));
    }
  };

  return (
    <div className="space-y-3 rounded-[10px] border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[12px] font-semibold text-foreground">
            试说一句
          </h3>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            使用当前服务、麦克风与已保存的词库配置；本机草稿不参与识别。结果仅显示在这里，不执行文本处理或粘贴。
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            type="button"
            disabled={
              phase === "starting" ||
              phase === "finishing" ||
              (phase === "idle" &&
                (disabled || !recognitionReady(recognition, account)))
            }
            onClick={() => void (phase === "recording" ? finish() : begin())}
          >
            {phase === "recording" ? <Square size={11} /> : <Mic size={11} />}
            {phase === "recording"
              ? "结束试说"
              : phase === "starting"
                ? "连接中…"
                : phase === "finishing"
                  ? "识别中…"
                  : "开始试说"}
          </Button>
          {phase === "idle" ? null : (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => void cancel()}
            >
              <X size={11} /> 取消
            </Button>
          )}
        </div>
      </div>
      {phase === "recording" ? (
        <Progress
          aria-label="试说麦克风音量"
          value={Math.max(3, level * 100)}
        />
      ) : null}
      {text ? (
        <p
          className="rounded-[8px] bg-muted/55 p-3 text-[12px] leading-6 whitespace-pre-wrap"
          role="status"
          aria-live="polite"
        >
          {text}
        </p>
      ) : null}
      {errorMessage ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
