import { invoke } from "@tauri-apps/api/core";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function DoubaoTranslation({
  revision,
  signedIn,
}: {
  revision: number;
  signedIn: boolean;
}) {
  const [text, setText] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [toEnglish, setToEnglish] = useState(true);
  const generation = useRef(0);
  const translate = async () => {
    generation.current += 1;
    const request = generation.current;
    setBusy(true);
    setError("");
    setResult("");
    try {
      const translated = await invoke<string>("translate_doubao_text", {
        text,
        toEnglish,
        providerRevision: revision,
      });
      if (generation.current === request) setResult(translated);
    } catch {
      if (generation.current === request)
        setError("翻译失败，原文已保留。请检查账号和网络后重试。");
    } finally {
      if (generation.current === request) setBusy(false);
    }
  };
  return (
    <div className="space-y-3 px-6 py-5">
      <h3 className="text-sm font-medium">豆包中英互译</h3>
      <p className="text-xs text-muted-foreground">
        仅在点击翻译后上传这里的文本；结果供预览，不自动替换其他应用内容。
      </p>
      <select
        aria-label="翻译方向"
        className="rounded-md border border-input bg-background p-2 text-sm"
        disabled={busy}
        value={toEnglish ? "en" : "zh"}
        onChange={(e) => {
          setToEnglish(e.target.value === "en");
          setResult("");
          setError("");
        }}
      >
        <option value="en">中文 → 英文</option>
        <option value="zh">英文 → 中文</option>
      </select>
      <Textarea
        aria-label="待翻译文本"
        value={text}
        disabled={busy}
        onChange={(e) => {
          setText(e.target.value);
          setResult("");
          setError("");
        }}
      />
      <Button
        type="button"
        disabled={!signedIn || busy || !text.trim()}
        onClick={() => void translate()}
      >
        {busy ? "翻译中…" : toEnglish ? "翻译为英文" : "翻译为中文"}
      </Button>
      {!signedIn && (
        <p className="text-xs text-muted-foreground">登录豆包账号后可用。</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {result && <Textarea aria-label="翻译结果" readOnly value={result} />}
    </div>
  );
}
