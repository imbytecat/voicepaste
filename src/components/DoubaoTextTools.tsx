import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function DoubaoTextTools({
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
  const [action, setAction] = useState("en");
  const generation = useRef(0);
  const requestId = useRef<string | null>(null);
  useEffect(
    () => () => {
      generation.current += 1;
      if (requestId.current)
        void invoke("cancel_doubao_translation", {
          requestId: requestId.current,
        }).catch(() => {});
    },
    []
  );
  const translate = async () => {
    generation.current += 1;
    const request = generation.current;
    const id = crypto.randomUUID();
    requestId.current = id;
    setBusy(true);
    setError("");
    setResult("");
    try {
      const translated = await invoke<string>("translate_doubao_text", {
        text,
        action,
        providerRevision: revision,
        requestId: id,
      });
      if (generation.current === request) setResult(translated);
    } catch {
      if (generation.current === request)
        setError("文本处理失败，原文已保留。请检查账号和网络后重试。");
    } finally {
      if (generation.current === request) {
        setBusy(false);
        requestId.current = null;
      }
    }
  };
  return (
    <div className="space-y-3 px-6 py-5">
      <h3 className="text-sm font-medium">豆包文本工具</h3>
      <p className="text-xs text-muted-foreground">
        仅在点击处理后上传这里的文本；整理或翻译结果供预览，不自动替换其他应用内容。
      </p>
      <p className="text-xs text-muted-foreground">
        总结和重写可能省略或补充信息，请核对后自行采用。
      </p>
      <select
        aria-label="文本处理方式"
        className="rounded-md border border-input bg-background p-2 text-sm"
        disabled={busy}
        value={action}
        onChange={(e) => {
          setAction(e.target.value);
          setResult("");
          setError("");
        }}
      >
        <option value="en">中文 → 英文</option>
        <option value="zh">英文 → 中文</option>
        <option value="organize">智能整理</option>
        <option value="summarize">总结</option>
        <option value="rewrite">重写</option>
        <option value="keypoints">提取要点</option>
        <option value="list">整理为列表</option>
      </select>
      <Textarea
        aria-label="待处理文本"
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
        {busy
          ? "处理中…"
          : {
              en: "翻译为英文",
              zh: "翻译为中文",
              organize: "整理文本",
              summarize: "总结文本",
              rewrite: "重写文本",
              keypoints: "提取要点",
              list: "整理为列表",
            }[action]}
      </Button>
      {busy && (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            const id = requestId.current;
            generation.current += 1;
            requestId.current = null;
            setBusy(false);
            setError("");
            if (id)
              void invoke("cancel_doubao_translation", { requestId: id }).catch(
                () => {
                  setError("取消请求失败；晚到结果不会显示。");
                }
              );
          }}
        >
          取消处理
        </Button>
      )}
      {!signedIn && (
        <p className="text-xs text-muted-foreground">登录豆包账号后可用。</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {result && <Textarea aria-label="文本处理结果" readOnly value={result} />}
      {result && (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void invoke("copy_tool_text", { text: result }).then(
              () => {
                setError("");
              },
              () => {
                setError("复制失败，请手动选择译文复制。");
              }
            );
          }}
        >
          复制结果
        </Button>
      )}
    </div>
  );
}
