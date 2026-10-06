import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AudioCapture } from "@/audio";
import { Block, Group, Notice, Row } from "@/components/settings/kit";
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
  disabledReason,
  onBusyChange,
}: {
  recognition: RecognitionSettings;
  providerRevision: number;
  account: AccountStatus;
  microphoneId: string;
  disabled?: boolean;
  /** Why the test is unavailable; replaces the idle hint. */
  disabledReason?: string;
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

  const ready = recognitionReady(recognition, account);
  const description =
    phase === "starting"
      ? "正在连接识别服务…"
      : phase === "recording"
        ? "请说话，说完点结束"
        : phase === "finishing"
          ? "正在识别…"
          : (disabledReason ??
            (ready ? "说一句话，检查识别效果" : "识别服务尚未就绪"));

  return (
    <Group>
      <Row title="试说一句" description={description}>
        {phase === "recording" ? (
          <Progress
            className="w-24 gap-0"
            aria-label="试说麦克风音量"
            value={Math.max(3, level * 100)}
          />
        ) : null}
        {phase === "idle" ? null : (
          <Button variant="ghost" type="button" onClick={() => void cancel()}>
            取消
          </Button>
        )}
        <Button
          variant="outline"
          type="button"
          disabled={
            phase === "starting" ||
            phase === "finishing" ||
            (phase === "idle" && (disabled || !ready))
          }
          onClick={() => void (phase === "recording" ? finish() : begin())}
        >
          {phase === "recording" ? <Square /> : <Mic />}
          {phase === "recording"
            ? "结束"
            : phase === "starting"
              ? "连接中…"
              : phase === "finishing"
                ? "识别中…"
                : "开始试说"}
        </Button>
      </Row>
      {text || errorMessage ? (
        <Block className="space-y-2">
          {text ? (
            <p
              className="rounded-lg bg-muted px-3 py-2.5 text-[13px] leading-5 whitespace-pre-wrap text-foreground"
              role="status"
              aria-live="polite"
            >
              {text}
            </p>
          ) : null}
          {errorMessage ? <Notice tone="error">{errorMessage}</Notice> : null}
        </Block>
      ) : null}
    </Group>
  );
}
