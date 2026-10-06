import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Phrase {
  id: string;
  text: string;
}
interface Snapshot {
  version: string;
  phrases: Phrase[];
}
export function DoubaoPhrases({
  revision,
  signedIn,
}: {
  revision: number;
  signedIn: boolean;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Phrase | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = async () => {
    setBusy(true);
    setMessage("");
    try {
      setSnapshot(
        await invoke<Snapshot>("doubao_phrase_snapshot", {
          providerRevision: revision,
        })
      );
    } catch {
      setSnapshot(null);
      setMessage("无法读取豆包常用语，请检查账号和网络。");
    } finally {
      setBusy(false);
    }
  };
  const apply = async (id: string | null, value: string | null) => {
    if (!snapshot) return;
    setBusy(true);
    setMessage("");
    try {
      const next = await invoke<Snapshot>("apply_doubao_phrase", {
        providerRevision: revision,
        version: snapshot.version,
        id,
        text: value,
      });
      setSnapshot(next);
      setText("");
      setEditing(null);
      setDeleting(null);
      setMessage("已通过豆包云端回读确认。");
    } catch (error) {
      setSnapshot(null);
      setDeleting(null);
      setMessage(
        `${String(error)}。请重新读取云端后核对，勿重复提交；输入内容已保留。`
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4 px-6 py-5">
      <h3 className="text-sm font-medium">豆包账号常用语</h3>
      <p className="text-xs text-muted-foreground">
        与输入法常用语同步；不是自动学习的个人词库，不承诺语音热词增强。只在点击后读取或修改，不自动上传。
      </p>
      <Button
        type="button"
        disabled={!signedIn || busy}
        onClick={() => void load()}
      >
        {busy ? "处理中…" : "读取云端常用语"}
      </Button>
      {!signedIn && <p>请先登录豆包账号。</p>}
      <Input
        aria-label="豆包常用语内容"
        value={text}
        disabled={busy}
        maxLength={50}
        onChange={(e) => {
          setText(e.target.value);
        }}
      />
      {snapshot && (
        <>
          <p className="text-xs text-muted-foreground">
            已读取 {snapshot.phrases.length}{" "}
            条。保存会修改同账号输入法常用语；其他设备并发修改可能产生冲突。
          </p>
          <Button
            type="button"
            disabled={busy || !text.trim()}
            onClick={() => void apply(editing, text)}
          >
            {editing ? "确认修改云端常用语" : "确认新增云端常用语"}
          </Button>
          {editing && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setEditing(null);
                setText("");
              }}
            >
              取消编辑
            </Button>
          )}
          <ul className="max-h-80 space-y-2 overflow-auto">
            {snapshot.phrases.map((phrase) => (
              <li
                key={phrase.id}
                className="flex items-center gap-2 rounded-md border p-3"
              >
                <span className="min-w-0 flex-1 wrap-break-word">
                  {phrase.text}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  aria-label={`复制常用语 ${phrase.text}`}
                  onClick={() => {
                    void invoke("copy_tool_text", { text: phrase.text }).then(
                      () => {
                        setMessage("常用语已复制到本机剪贴板。");
                      },
                      () => {
                        setMessage("复制失败，请手动选择文本复制。");
                      }
                    );
                  }}
                >
                  复制
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  aria-label={`编辑常用语 ${phrase.text}`}
                  onClick={() => {
                    setEditing(phrase.id);
                    setText(phrase.text);
                  }}
                >
                  编辑
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  aria-label={`删除常用语 ${phrase.text}`}
                  onClick={() => {
                    setDeleting(phrase);
                  }}
                >
                  删除
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
      {deleting && (
        <div
          role="alert"
          className="space-y-2 rounded-md border border-destructive p-3"
        >
          <p>
            确认从豆包账号常用语删除“{deleting.text}”？其他设备同步后也会删除。
          </p>
          <Button
            type="button"
            disabled={busy}
            onClick={() => void apply(deleting.id, null)}
          >
            确认删除这条常用语
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setDeleting(null);
            }}
          >
            取消
          </Button>
        </div>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </div>
  );
}
