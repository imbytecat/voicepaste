import { invoke } from "@tauri-apps/api/core";
import {
  Copy,
  MessageSquareText,
  Pencil,
  RotateCw,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import { Block, EmptyState, Feedback, Group } from "@/components/settings/kit";
import type { Message } from "@/components/settings/kit";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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

const MAX_LENGTH = 50;

export function DoubaoPhrases({ revision }: { revision: number }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<Phrase | null>(null);
  const [deleting, setDeleting] = useState<Phrase | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const load = async () => {
    setBusy(true);
    setMessage(null);
    try {
      setSnapshot(
        await invoke<Snapshot>("doubao_phrase_snapshot", {
          providerRevision: revision,
        })
      );
    } catch {
      setSnapshot(null);
      setMessage({
        kind: "error",
        text: "无法读取豆包常用语，请检查账号和网络",
      });
    } finally {
      setBusy(false);
    }
  };

  // id null = add, value null = delete; otherwise edit.
  const apply = async (id: string | null, value: string | null) => {
    if (!snapshot) return;
    setBusy(true);
    setMessage(null);
    try {
      const next = await invoke<Snapshot>("apply_doubao_phrase", {
        providerRevision: revision,
        version: snapshot.version,
        id,
        text: value,
      });
      setSnapshot(next);
      if (id === null) setText("");
      else if (editing?.id === id) setEditing(null);
      setDeleting(null);
      setMessage({ kind: "success", text: "已同步，云端回读确认" });
    } catch (error) {
      // The write may have landed; force a fresh read before any retry.
      setSnapshot(null);
      setDeleting(null);
      setMessage({
        kind: "error",
        text: `${String(error)}。请重新读取后核对，避免重复提交；输入内容已保留`,
      });
    } finally {
      setBusy(false);
    }
  };

  const copy = (phrase: Phrase) => {
    void invoke("copy_tool_text", { text: phrase.text }).then(
      () => {
        setMessage({ kind: "success", text: "已复制到剪贴板" });
      },
      () => {
        setMessage({ kind: "error", text: "复制失败，请手动选择文本复制" });
      }
    );
  };

  return (
    <Group
      title="常用语"
      description={
        snapshot
          ? `与豆包输入法同步的常用短语 · ${snapshot.phrases.length} 条`
          : "与豆包输入法同步的常用短语"
      }
      actions={
        snapshot ? (
          <Button
            variant="ghost"
            size="sm"
            type="button"
            disabled={busy}
            onClick={() => void load()}
          >
            <RotateCw />
            刷新
          </Button>
        ) : null
      }
    >
      {snapshot ? (
        <>
          <Block>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (text.trim()) void apply(null, text);
              }}
            >
              <Input
                aria-label="豆包常用语内容"
                placeholder="新常用语"
                value={text}
                disabled={busy}
                maxLength={MAX_LENGTH}
                onChange={(event) => {
                  setText(event.target.value);
                }}
              />
              <Button type="submit" disabled={busy || !text.trim()}>
                添加
              </Button>
            </form>
          </Block>
          {snapshot.phrases.length === 0 ? (
            <EmptyState title="还没有常用语" className="py-6" />
          ) : (
            <ul className="max-h-80 divide-y divide-border overflow-y-auto">
              {snapshot.phrases.map((phrase) =>
                editing?.id === phrase.id ? (
                  <li key={phrase.id} className="px-4 py-2">
                    <form
                      className="flex items-center gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (editing.text.trim())
                          void apply(phrase.id, editing.text);
                      }}
                    >
                      <Input
                        aria-label={`编辑常用语 ${phrase.text}`}
                        value={editing.text}
                        disabled={busy}
                        maxLength={MAX_LENGTH}
                        autoFocus
                        onChange={(event) => {
                          setEditing({ ...editing, text: event.target.value });
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Escape" && !busy) setEditing(null);
                        }}
                      />
                      <Button
                        type="submit"
                        size="sm"
                        disabled={busy || !editing.text.trim()}
                      >
                        保存
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          setEditing(null);
                        }}
                      >
                        取消
                      </Button>
                    </form>
                  </li>
                ) : (
                  <li
                    key={phrase.id}
                    className="group/phrase flex min-h-11 items-center gap-2 py-1.5 pr-2 pl-4"
                  >
                    <span className="min-w-0 flex-1 text-[13px] leading-5 wrap-break-word">
                      {phrase.text}
                    </span>
                    <div className="flex shrink-0 items-center opacity-0 transition-opacity group-focus-within/phrase:opacity-100 group-hover/phrase:opacity-100">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`复制常用语 ${phrase.text}`}
                        onClick={() => {
                          copy(phrase);
                        }}
                      >
                        <Copy />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={busy}
                        aria-label={`编辑常用语 ${phrase.text}`}
                        onClick={() => {
                          setEditing(phrase);
                        }}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={busy}
                        aria-label={`删除常用语 ${phrase.text}`}
                        onClick={() => {
                          setDeleting(phrase);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </li>
                )
              )}
            </ul>
          )}
        </>
      ) : (
        <EmptyState
          icon={MessageSquareText}
          title="常用语保存在豆包云端"
          description="读取后可在这里添加、编辑和删除"
          action={
            <Button type="button" disabled={busy} onClick={() => void load()}>
              {busy ? "读取中…" : "读取云端常用语"}
            </Button>
          }
        />
      )}
      {message ? (
        <Block>
          <Feedback message={message} />
        </Block>
      ) : null}
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>删除这条常用语？</AlertDialogTitle>
          <AlertDialogDescription>
            “{deleting?.text}”将从豆包账号删除。其他设备同步后也会删除。
          </AlertDialogDescription>
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <AlertDialogCancel variant="ghost" disabled={busy}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (deleting) void apply(deleting.id, null);
              }}
            >
              {busy ? "删除中…" : "删除"}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </Group>
  );
}
