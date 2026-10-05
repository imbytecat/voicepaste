import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Switch } from "@/components/ui/switch";
import { hotwordDiff, previewHotwordImport, uniqueHotwords } from "@/hotwords";
import type { HotwordImportRow } from "@/hotwords";
import type { HotwordSyncStatus } from "@/types";

const IMPORT_LABELS: Record<HotwordImportRow["state"], string> = {
  added: "新增",
  duplicate: "重复，不重复添加",
  invalid: "非法",
  overLimit: "超限",
};

export function VolcengineDictionary({
  text,
  onChange,
  status,
  cloudWords,
  cloudVerified,
  confirmedAt,
  localDirty,
  enabled,
  savedEnabled,
  onEnabledChange,
  busy,
  configured,
  confirming,
  onSave,
  onApply,
  onRefresh,
  onDiscard,
  onReview,
  providerRevision,
  canReview,
}: {
  text: string;
  providerRevision: number;
  onChange: (text: string) => void;
  status: HotwordSyncStatus;
  cloudWords: string[];
  cloudVerified: boolean;
  confirmedAt: string | null;
  localDirty: boolean;
  enabled: boolean;
  savedEnabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  busy: boolean;
  configured: boolean;
  confirming: boolean;
  canReview: boolean;
  onSave: () => void;
  onApply: () => void;
  onRefresh: () => void;
  onDiscard: () => void;
  onReview: () => void;
}) {
  const [search, setSearch] = useState("");
  const [addingWord, setAddingWord] = useState("");
  const [discarding, setDiscarding] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importText, setImportText] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const importGeneration = useRef(0);
  useEffect(() => {
    setSelected(new Set());
  }, [text]);
  useEffect(
    () => () => {
      importGeneration.current += 1;
    },
    []
  );
  const lines = text ? text.split("\n") : [];
  const words = uniqueHotwords(text);
  const validation = previewHotwordImport(text, [], status.limit);
  const invalid = validation.filter(
    (row) => row.state === "invalid" || row.state === "overLimit"
  );
  const imported =
    importText === null
      ? []
      : previewHotwordImport(importText, words, status.limit);
  const importBlocked = imported.some(
    (row) => row.state === "invalid" || row.state === "overLimit"
  );
  const importedWords = imported
    .filter((row) => row.state === "added")
    .map((row) => row.word);
  const changes = hotwordDiff(words, cloudWords);
  const filtered = lines
    .map((word, index) => ({ word, index }))
    .filter(({ word }) =>
      word.toLocaleLowerCase().includes(search.toLocaleLowerCase())
    );

  const updateLines = (next: string[]) => {
    setSelected(new Set());
    onChange(next.join("\n"));
  };

  return (
    <div className="space-y-4 px-6 py-5">
      <div className="flex flex-wrap items-center gap-3">
        <Switch
          checked={enabled}
          onCheckedChange={onEnabledChange}
          disabled={busy}
          aria-label="听写时使用火山常用词"
        />
        <span className="text-[12px] font-semibold">听写时使用常用词</span>
        <span className="text-[11px] text-muted-foreground">
          开关由“保存设置”保存；不会创建或删除云词表。
        </span>
      </div>
      <dl
        className="grid gap-2 rounded-[10px] bg-muted/55 p-4 text-[11px] leading-5"
        aria-live="polite"
      >
        <div>
          <dt className="inline font-semibold">本机草稿：</dt>
          <dd className="inline">
            {localDirty ? "有未保留修改" : "已保留本机"} · {words.length} /{" "}
            {status.limit} 个词
          </dd>
        </div>
        <div>
          <dt className="inline font-semibold">云端：</dt>
          <dd className="inline">
            {confirming
              ? "提交结果待确认，请先刷新"
              : cloudVerified
                ? `最近确认 ${cloudWords.length} 个词`
                : confirmedAt
                  ? `已有 ${cloudWords.length} 个词的快照，请重新检查`
                  : "尚未检查"}
            {confirmedAt ? ` · ${confirmedAt}` : ""}
          </dd>
        </div>
        <div>
          <dt className="inline font-semibold">下一次识别：</dt>
          <dd className="inline">
            {savedEnabled
              ? confirming
                ? "提交待确认，先检查云端或保存停用设置"
                : status.tableId
                  ? "使用已保存的云词表绑定；本机草稿不参与识别"
                  : "尚无已确认的云词表绑定"
              : "未启用常用词"}
            {enabled === savedEnabled ? "" : "（使用开关尚未保存）"}
          </dd>
        </div>
      </dl>
      {configured ? null : (
        <Alert>
          <AlertDescription>
            请先在“使用方式”保存当前火山
            Key，再检查或应用词库。本机仍可编辑并保留草稿。
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
          placeholder="搜索词条"
          aria-label="搜索火山词条"
          className="min-w-32 flex-1"
        />
        <Input
          value={addingWord}
          onChange={(event) => {
            setAddingWord(event.target.value);
          }}
          aria-label="新增火山词条，点击添加后进入草稿"
          placeholder="输入新词"
          disabled={busy}
          className="w-32"
        />
        <Button
          variant="outline"
          disabled={busy || !addingWord.trim()}
          onClick={() => {
            updateLines([...lines, addingWord.trim()]);
            setAddingWord("");
          }}
        >
          添加词条
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          导入 TXT
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,text/plain"
          className="hidden"
          aria-label="导入 UTF-8 TXT 词库"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            importGeneration.current += 1;
            const generation = importGeneration.current;
            setFileError(null);
            setImportText(null);
            if (file.size > 2 * 1024 * 1024) {
              setFileError(
                "TXT 文件不能超过 2 MiB；请拆分后导入，不会截断内容。"
              );
              return;
            }
            void file
              .arrayBuffer()
              .then((buffer) => {
                if (generation !== importGeneration.current) return;
                setImportText(
                  new TextDecoder("utf-8", { fatal: true }).decode(buffer)
                );
              })
              .catch((error: unknown) => {
                if (generation === importGeneration.current)
                  setFileError(`无法读取 UTF-8 TXT：${String(error)}`);
              });
          }}
        />
        <Button
          variant="outline"
          disabled={busy || exporting || invalid.length > 0}
          onClick={() => {
            setFileError(null);
            if (isTauri()) {
              setExporting(true);
              void invoke<boolean>("export_volcengine_hotwords", {
                words,
                providerRevision,
              })
                .catch((error: unknown) => {
                  setFileError(`导出失败，草稿仍保留：${String(error)}`);
                })
                .finally(() => {
                  setExporting(false);
                });
              return;
            }
            const url = URL.createObjectURL(
              new Blob([words.join("\n") + (words.length ? "\n" : "")], {
                type: "text/plain;charset=utf-8",
              })
            );
            const link = document.createElement("a");
            link.href = url;
            link.download = "voicepaste-volcengine-words.txt";
            link.click();
            window.setTimeout(() => {
              URL.revokeObjectURL(url);
            }, 1000);
          }}
        >
          {exporting ? "正在导出…" : "导出 TXT"}
        </Button>
        <Button
          variant="outline"
          disabled={busy || !configured}
          onClick={onRefresh}
        >
          刷新云端
        </Button>
      </div>
      <p className="text-[11px] leading-5 text-muted-foreground">
        每行一词，最多 10 字素且不超过 30 UTF-8
        字节；词内不能有空白。导入默认追加，重复项保留原词，不静默截断。
      </p>
      <div className="max-h-96 overflow-auto rounded-[10px] border border-border">
        <div className="flex items-center gap-3 border-b border-border bg-muted/50 px-3 py-2">
          <label className="flex items-center gap-2 text-[11px]">
            <input
              type="checkbox"
              disabled={busy || filtered.length === 0}
              checked={
                filtered.length > 0 &&
                filtered.every(({ index }) => selected.has(index))
              }
              onChange={(event) => {
                setSelected(
                  event.target.checked
                    ? new Set(filtered.map(({ index }) => index))
                    : new Set()
                );
              }}
            />
            选择搜索结果
          </label>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || selected.size === 0}
            onClick={() => {
              updateLines(lines.filter((_, index) => !selected.has(index)));
            }}
          >
            删除选中 {selected.size} 项
          </Button>
        </div>
        {filtered.map(({ word, index }) => {
          const issue = validation.find(
            (row) => row.line === index + 1 && row.state !== "added"
          );
          return (
            <div
              key={index}
              className="border-b border-border px-3 py-2 last:border-b-0"
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  aria-label={`选择第 ${index + 1} 行`}
                  disabled={busy}
                  checked={selected.has(index)}
                  onChange={(event) => {
                    const next = new Set(selected);
                    if (event.target.checked) next.add(index);
                    else next.delete(index);
                    setSelected(next);
                  }}
                />
                <span className="w-7 text-[10px] text-muted-foreground">
                  {index + 1}
                </span>
                <Input
                  value={word}
                  aria-label={`第 ${index + 1} 行词条`}
                  aria-invalid={
                    issue?.state === "invalid" || issue?.state === "overLimit"
                  }
                  disabled={busy}
                  onChange={(event) => {
                    onChange(
                      lines
                        .map((line, at) =>
                          at === index ? event.target.value : line
                        )
                        .join("\n")
                    );
                  }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    updateLines(lines.filter((_, at) => at !== index));
                  }}
                  aria-label={`删除第 ${index + 1} 行`}
                >
                  删除
                </Button>
              </div>
              {issue ? (
                <p
                  className="mt-1 text-[11px]"
                  role={issue.state === "duplicate" ? "status" : "alert"}
                >
                  {IMPORT_LABELS[issue.state]}
                  {issue.reason ? `：${issue.reason}` : ""}
                </p>
              ) : null}
            </div>
          );
        })}
        {filtered.length === 0 ? (
          <p className="p-4 text-[12px] text-muted-foreground">
            {search ? "没有匹配词条" : "尚无词条；点击添加或导入。"}
          </p>
        ) : null}
      </div>
      {fileError ? (
        <Alert variant="destructive">
          <AlertDescription>{fileError}</AlertDescription>
        </Alert>
      ) : null}
      {importText === null ? null : (
        <section
          className="space-y-3 rounded-[10px] border border-border p-4"
          aria-label="导入预览"
        >
          <h3 className="text-[12px] font-semibold">追加导入预览</h3>
          <p className="text-[11px]">
            新增 {importedWords.length} · 重复{" "}
            {imported.filter((row) => row.state === "duplicate").length} · 非法{" "}
            {imported.filter((row) => row.state === "invalid").length} · 超限{" "}
            {imported.filter((row) => row.state === "overLimit").length}
          </p>
          <ol className="max-h-60 overflow-auto text-[11px] leading-6">
            {imported.map((row) => (
              <li key={row.line}>
                第 {row.line} 行 · {row.word} · {IMPORT_LABELS[row.state]}
                {row.reason ? `：${row.reason}` : ""}
              </li>
            ))}
          </ol>
          {importBlocked ? (
            <p role="alert" className="text-[11px]">
              存在非法或超限词条。请修正文件后重新导入；不会只导入其中一部分。
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button
              disabled={busy || importBlocked || importedWords.length === 0}
              onClick={() => {
                updateLines([...words, ...importedWords]);
                setImportText(null);
              }}
            >
              确认追加到草稿
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setImportText(null);
              }}
            >
              取消导入
            </Button>
          </div>
        </section>
      )}
      <details className="text-[11px] leading-6">
        <summary className="cursor-pointer font-semibold">
          完整变更预览：新增 {changes.onlyLocal.length} · 移除{" "}
          {changes.onlyCloud.length}
        </summary>
        <p>新增：{changes.onlyLocal.join("、") || "无"}</p>
        <p>移除：{changes.onlyCloud.join("、") || "无"}</p>
      </details>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={busy || invalid.length > 0}
          onClick={onSave}
        >
          保留本机草稿
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            setDiscarding(true);
          }}
        >
          放弃草稿修改
        </Button>
        <Button
          disabled={
            busy ||
            !configured ||
            invalid.length > 0 ||
            confirming ||
            !cloudVerified
          }
          onClick={onApply}
        >
          确认并应用到火山
        </Button>
        {canReview ? (
          <Button
            variant="outline"
            disabled={busy || invalid.length > 0}
            onClick={onReview}
          >
            审阅云端差异
          </Button>
        ) : null}
      </div>
      <AlertDialog open={discarding} onOpenChange={setDiscarding}>
        <AlertDialogContent>
          <AlertDialogTitle>放弃本机草稿修改？</AlertDialogTitle>
          <AlertDialogDescription>
            恢复上次已确认的词条并保留到本机。此操作不会修改或删除云端词条。
          </AlertDialogDescription>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={onDiscard}>放弃草稿</AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
