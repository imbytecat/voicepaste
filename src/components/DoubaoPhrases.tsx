import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { settingsQueries } from "@/components/settings/queries";
import type {
  DoubaoPhrase as Phrase,
  DoubaoPhraseSnapshot as Snapshot,
} from "@/components/settings/queries";
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

const MAX_LENGTH = 50;

export function DoubaoPhrases({
  revision,
  accountRevision,
}: {
  revision: number;
  accountRevision: number;
}) {
  const queryClient = useQueryClient();
  // Rendered only while signed in, so the snapshot loads as the page opens.
  const phrasesQuery = useQuery(
    settingsQueries.doubaoPhrases({
      accountRevision,
      providerRevision: revision,
    })
  );
  const snapshot = phrasesQuery.data ?? null;
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<Phrase | null>(null);
  const [deleting, setDeleting] = useState<Phrase | null>(null);
  const [message, setMessage] = useState<Message>(null);

  // id null = add, text null = delete; otherwise edit.
  const applyMutation = useMutation({
    mutationFn: async (change: { id: string | null; text: string | null }) =>
      await invoke<Snapshot>("apply_doubao_phrase", {
        id: change.id,
        providerRevision: revision,
        text: change.text,
        version: snapshot?.version,
      }),
    onError: (error) => {
      // The write may have landed: re-read before anything is resubmitted.
      setDeleting(null);
      setMessage({
        kind: "error",
        text: `${String(error)}。已重新读取云端，请核对后再提交；输入内容已保留`,
      });
      void phrasesQuery.refetch();
    },
    onSuccess: (next, change) => {
      queryClient.setQueryData(
        settingsQueries.doubaoPhrases({
          accountRevision,
          providerRevision: revision,
        }).queryKey,
        next
      );
      if (change.id === null) setText("");
      else if (editing?.id === change.id) setEditing(null);
      setDeleting(null);
      setMessage({ kind: "success", text: "已同步，云端回读确认" });
    },
  });
  const busy = phrasesQuery.isFetching || applyMutation.isPending;
  const apply = (id: string | null, value: string | null) => {
    if (!snapshot) return;
    setMessage(null);
    applyMutation.mutate({ id, text: value });
  };
  const load = () => {
    setMessage(null);
    void phrasesQuery.refetch();
  };
  const loadError: Message = phrasesQuery.error
    ? { kind: "error", text: "无法读取豆包常用语，请检查账号和网络" }
    : null;

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
            onClick={load}
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
                if (text.trim()) apply(null, text);
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
                添加到豆包
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
                        if (editing.text.trim()) apply(phrase.id, editing.text);
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
                        更新到豆包
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
          title={busy ? "正在读取常用语…" : "未能读取常用语"}
          action={
            busy ? undefined : (
              <Button type="button" onClick={load}>
                重新读取
              </Button>
            )
          }
        />
      )}
      {message || loadError ? (
        <Block>
          <Feedback message={message ?? loadError} />
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
                if (deleting) apply(deleting.id, null);
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
