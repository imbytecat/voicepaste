import { invoke } from "@tauri-apps/api/core";
import { Copy, Languages } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  Block,
  EmptyState,
  Feedback,
  Group,
  Notice,
  Row,
} from "@/components/settings/kit";
import type { Message } from "@/components/settings/kit";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { safeError } from "@/recognition";

// review: generative actions may add or drop information.
const ACTIONS = [
  {
    value: "en",
    label: "中文 → 英文",
    run: "翻译为英文",
    copy: "复制译文",
    review: false,
  },
  {
    value: "zh",
    label: "英文 → 中文",
    run: "翻译为中文",
    copy: "复制译文",
    review: false,
  },
  {
    value: "organize",
    label: "智能整理",
    run: "整理文本",
    copy: "复制",
    review: false,
  },
  {
    value: "summarize",
    label: "总结",
    run: "总结文本",
    copy: "复制",
    review: true,
  },
  {
    value: "rewrite",
    label: "重写",
    run: "重写文本",
    copy: "复制",
    review: true,
  },
  {
    value: "keypoints",
    label: "提取要点",
    run: "提取要点",
    copy: "复制",
    review: true,
  },
  {
    value: "list",
    label: "整理为列表",
    run: "整理为列表",
    copy: "复制",
    review: true,
  },
] as const;
type TextAction = (typeof ACTIONS)[number]["value"];

export function DoubaoTextTools({
  revision,
  signedIn,
  onSignIn,
}: {
  revision: number;
  signedIn: boolean;
  onSignIn: () => void;
}) {
  const [text, setText] = useState("");
  const [result, setResult] = useState("");
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const [copyMessage, setCopyMessage] = useState<Message>(null);
  const [action, setAction] = useState<TextAction>("en");
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
    setFailure("");
    setResult("");
    setCopyMessage(null);
    try {
      const translated = await invoke<string>("translate_doubao_text", {
        text,
        action,
        providerRevision: revision,
        requestId: id,
      });
      if (generation.current === request) setResult(translated);
    } catch (error) {
      if (generation.current === request)
        setFailure(`处理失败，原文已保留：${safeError(error)}`);
    } finally {
      if (generation.current === request) {
        setBusy(false);
        requestId.current = null;
      }
    }
  };
  const cancel = () => {
    const id = requestId.current;
    generation.current += 1;
    requestId.current = null;
    setBusy(false);
    setFailure("");
    if (id)
      void invoke("cancel_doubao_translation", { requestId: id }).catch(() => {
        setFailure("取消请求失败，晚到的结果不会显示。");
      });
  };
  const copy = () => {
    void invoke("copy_tool_text", { text: result }).then(
      () => {
        setCopyMessage({ kind: "success", text: "已复制到剪贴板" });
      },
      () => {
        setCopyMessage({ kind: "error", text: "复制失败，请手动选择文本复制" });
      }
    );
  };
  const current = ACTIONS.find((item) => item.value === action) ?? ACTIONS[0];

  return (
    <Group
      title="豆包文本工具"
      description="翻译、整理或总结一段文本，结果只在这里预览"
    >
      {signedIn ? (
        <>
          <Row title="操作" htmlFor="doubao-text-action">
            <Select
              items={ACTIONS}
              value={action}
              onValueChange={(value) => {
                const next = ACTIONS.find((item) => item.value === value);
                if (!next) return;
                setAction(next.value);
                setResult("");
                setFailure("");
              }}
              disabled={busy}
            >
              <SelectTrigger id="doubao-text-action" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTIONS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Block className="space-y-3">
            <Textarea
              aria-label="待处理文本"
              className="min-h-24 resize-y"
              placeholder="输入或粘贴要处理的文本（最多 8000 字）"
              maxLength={8000}
              value={text}
              disabled={busy}
              onChange={(event) => {
                setText(event.target.value);
                setResult("");
                setFailure("");
              }}
            />
            <div className="flex justify-end gap-2">
              {busy ? (
                <Button type="button" variant="outline" onClick={cancel}>
                  取消
                </Button>
              ) : null}
              <Button
                type="button"
                disabled={busy || !text.trim()}
                onClick={() => void translate()}
              >
                {busy ? "处理中…" : current.run}
              </Button>
            </div>
            {failure ? <Notice tone="error">{failure}</Notice> : null}
          </Block>
          {result ? (
            <Block className="space-y-2">
              <div className="flex items-center justify-between gap-4">
                <h3 className="text-[13px] leading-5 font-medium text-foreground">
                  结果
                </h3>
                <Button type="button" variant="ghost" size="sm" onClick={copy}>
                  <Copy />
                  {current.copy}
                </Button>
              </div>
              <output
                aria-label="文本处理结果"
                className="block max-h-64 overflow-y-auto rounded-lg bg-muted px-3 py-2 text-[13px] leading-6 wrap-break-word whitespace-pre-wrap text-foreground select-text"
              >
                {result}
              </output>
              {current.review ? (
                <p className="text-[12px] leading-4.5 text-muted-foreground">
                  结果可能增删信息，请核对后使用
                </p>
              ) : null}
              <Feedback message={copyMessage} />
            </Block>
          ) : null}
        </>
      ) : (
        <EmptyState
          icon={Languages}
          title="登录豆包账号后可用"
          action={
            <Button type="button" variant="outline" onClick={onSignIn}>
              前往识别服务
            </Button>
          }
        />
      )}
    </Group>
  );
}
