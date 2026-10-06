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
      <h3 className="text-sm font-medium">豆包中译英</h3>
      <p className="text-xs text-muted-foreground">
        仅在点击翻译后上传这里的文本；结果供预览，不自动替换其他应用内容。
      </p>
      <Textarea
        aria-label="待翻译中文"
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
        {busy ? "翻译中…" : "翻译为英文"}
      </Button>
      {!signedIn && (
        <p className="text-xs text-muted-foreground">登录豆包账号后可用。</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {result && <Textarea aria-label="英文翻译结果" readOnly value={result} />}
    </div>
  );
}
