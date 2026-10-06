import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  BookText,
  Download,
  Plus,
  RotateCw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  Block,
  ChangedDot,
  EmptyState,
  Feedback,
  Group,
  Notice,
  Row,
} from "@/components/settings/kit";
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
import { Switch } from "@/components/ui/switch";
import { hotwordDiff, previewHotwordImport, uniqueHotwords } from "@/hotwords";
import type { HotwordImportRow } from "@/hotwords";
import { cn } from "@/lib/utils";
import type { HotwordSyncStatus } from "@/types";

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const CHECKBOX = "size-3.5 shrink-0 accent-primary";

/** `normalizeHotwords` errors stringify as "Error: …"; show only the message. */
function issueText(row: HotwordImportRow, limit: number): string {
  if (row.state === "duplicate") return "重复，只保留第一个";
  if (row.state === "overLimit") return `超出 ${limit} 个上限`;
  return row.reason?.replace(/^Error: /u, "") ?? "格式不符合要求";
}

function isBlocking(row: HotwordImportRow) {
  return row.state === "invalid" || row.state === "overLimit";
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-1.5 font-medium text-foreground tabular-nums">
        {children}
      </dd>
    </div>
  );
}

export function VolcengineDictionary({
  text,
  onChange,
  status,
  cloudWords,
  cloudVerified,
  confirmedAt,
  localDirty,
  canDiscard,
  enabled,
  savedEnabled,
  onEnabledChange,
  busy,
  configured,
  confirming,
  message,
  onSave,
  onApply,
  onRefresh,
  onDiscard,
  onReview,
  onConfigure,
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
  /** Draft differs from what is saved on this device. */
  localDirty: boolean;
  /** Draft (saved or not) differs from the last confirmed cloud words. */
  canDiscard: boolean;
  enabled: boolean;
  savedEnabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  busy: boolean;
  configured: boolean;
  confirming: boolean;
  canReview: boolean;
  message: Message;
  onSave: () => void;
  onApply: () => void;
  onRefresh: () => void;
  onDiscard: () => void;
  onReview: () => void;
  onConfigure: () => void;
}) {
  const [search, setSearch] = useState("");
  const [addingWord, setAddingWord] = useState("");
  const [discarding, setDiscarding] = useState(false);
  // Selection is tied to the text it was made on; any edit clears it.
  const [selection, setSelection] = useState<{
    text: string;
    rows: Set<number>;
  }>({ text: "", rows: new Set() });
  const [importText, setImportText] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const importGeneration = useRef(0);
  const selectAllId = useId();
  useEffect(
    () => () => {
      importGeneration.current += 1;
    },
    []
  );

  const selected = selection.text === text ? selection.rows : new Set<number>();
  const lines = text ? text.split("\n") : [];
  const words = uniqueHotwords(text);
  const validation = previewHotwordImport(text, [], status.limit);
  const issues = new Map(
    validation
      .filter((row) => row.state !== "added")
      .map((row) => [row.line - 1, row])
  );
  const invalidCount = validation.filter(isBlocking).length;
  const imported =
    importText === null
      ? []
      : previewHotwordImport(importText, words, status.limit);
  const importBlocked = imported.some(isBlocking);
  const importedWords = imported
    .filter((row) => row.state === "added")
    .map((row) => row.word);
  const importCount = (state: HotwordImportRow["state"]) =>
    imported.filter((row) => row.state === state).length;
  const changes = hotwordDiff(words, cloudWords);
  const filtered = lines
    .map((word, index) => ({ word, index }))
    .filter(({ word }) =>
      word.toLocaleLowerCase().includes(search.toLocaleLowerCase())
    );
  const allSelected =
    filtered.length > 0 && filtered.every(({ index }) => selected.has(index));

  const updateLines = (next: string[]) => {
    onChange(next.join("\n"));
  };

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    importGeneration.current += 1;
    const generation = importGeneration.current;
    setFileError(null);
    setImportText(null);
    if (file.size > MAX_IMPORT_BYTES) {
      setFileError("TXT 文件不能超过 2 MiB，请拆分后导入");
      return;
    }
    void file
      .arrayBuffer()
      .then((buffer) => {
        if (generation !== importGeneration.current) return;
        setImportText(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
      })
      .catch((error: unknown) => {
        if (generation === importGeneration.current)
          setFileError(`无法读取 UTF-8 TXT：${String(error)}`);
      });
  };

  const exportWords = () => {
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
  };

  let usageHint = "识别时不使用词条";
  if (enabled)
    usageHint = confirming
      ? "上次提交待确认，请先刷新云端"
      : status.tableId
        ? "识别时使用已应用到火山的词条"
        : "词条应用到火山后生效";
  const cloudState = confirming ? (
    <span className="text-warning">待确认</span>
  ) : cloudVerified ? (
    `${cloudWords.length} 词`
  ) : confirmedAt ? (
    <span className="text-warning">需重新检查</span>
  ) : (
    <span className="text-muted-foreground">未检查</span>
  );
  let applyHint: string | null = "需先保存火山 Key";
  if (configured)
    applyHint =
      invalidCount > 0
        ? `有 ${invalidCount} 个词条需修正`
        : confirming
          ? "提交结果待确认，请先刷新云端"
          : cloudVerified
            ? null
            : "请先刷新云端";

  return (
    <>
      {configured ? null : (
        <Notice
          tone="warning"
          action={
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={onConfigure}
            >
              去设置
            </Button>
          }
        >
          先在「识别服务」保存火山 Key
        </Notice>
      )}

      <Group>
        <Row
          title="听写时使用"
          description={usageHint}
          changed={enabled !== savedEnabled}
        >
          <Switch
            checked={enabled}
            onCheckedChange={onEnabledChange}
            disabled={busy}
            aria-label="听写时使用火山常用词"
          />
        </Row>
        <Block className="py-3">
          <dl
            className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] leading-4.5"
            aria-live="polite"
          >
            <Stat label="本机">
              {words.length} / {status.limit} 词
              {localDirty ? <ChangedDot /> : null}
            </Stat>
            <Stat label="云端">{cloudState}</Stat>
            <Stat label="待应用">
              <span aria-hidden="true">
                +{changes.onlyLocal.length} −{changes.onlyCloud.length}
              </span>
              <span className="sr-only">
                新增 {changes.onlyLocal.length} 个，移除{" "}
                {changes.onlyCloud.length} 个
              </span>
            </Stat>
            {confirmedAt ? (
              <Stat label="检查于">
                <span className="font-normal text-muted-foreground">
                  {confirmedAt}
                </span>
              </Stat>
            ) : null}
          </dl>
          {status.foreignTables.length > 0 ? (
            <p className="mt-1.5 text-[12px] leading-4.5 text-muted-foreground">
              另有 {status.foreignTables.length} 张非 VoicePaste
              词表，不会修改或用于识别
            </p>
          ) : null}
        </Block>
      </Group>

      <Group
        title="词条"
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload />
              导入 TXT
            </Button>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              disabled={busy || exporting || invalidCount > 0}
              onClick={exportWords}
            >
              <Download />
              {exporting ? "正在导出…" : "导出 TXT"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              disabled={busy || !configured}
              onClick={onRefresh}
            >
              <RotateCw />
              刷新云端
            </Button>
          </>
        }
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,text/plain"
          className="hidden"
          aria-label="导入 UTF-8 TXT 词库"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            pickFile(file);
          }}
        />
        <Block className="space-y-2">
          <div className="flex gap-2">
            <form
              className="flex min-w-0 flex-1 gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const word = addingWord.trim();
                if (busy || !word) return;
                updateLines([...lines, word]);
                setAddingWord("");
              }}
            >
              <Input
                value={addingWord}
                onChange={(event) => {
                  setAddingWord(event.target.value);
                }}
                aria-label="新增火山词条"
                placeholder="输入新词"
                disabled={busy}
              />
              <Button
                variant="outline"
                type="submit"
                disabled={busy || !addingWord.trim()}
              >
                <Plus />
                添加
              </Button>
            </form>
            {lines.length > 0 ? (
              <div className="relative w-40 shrink-0">
                <Search
                  className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  type="search"
                  className="pl-8"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                  }}
                  placeholder="搜索"
                  aria-label="搜索火山词条"
                />
              </div>
            ) : null}
          </div>
          <p className="text-[12px] leading-4.5 text-muted-foreground">
            每行一词，最多 10 个字，不含空格
          </p>
          {fileError ? <Notice tone="error">{fileError}</Notice> : null}
        </Block>

        {importText === null ? null : (
          <Block
            className="space-y-3 bg-muted/40"
            role="region"
            aria-label="导入预览"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="text-[13px] font-medium text-foreground">
                导入预览
              </h3>
              <p className="text-[12px] text-muted-foreground tabular-nums">
                新增 {importedWords.length} · 重复 {importCount("duplicate")} ·
                不符合 {importCount("invalid")} · 超限{" "}
                {importCount("overLimit")}
              </p>
            </div>
            {imported.length > 0 ? (
              <ol className="max-h-48 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-card text-[12px] leading-4.5">
                {imported.map((row) => (
                  <li key={row.line} className="flex gap-3 px-3 py-1.5">
                    <span className="w-14 shrink-0 text-muted-foreground tabular-nums">
                      第 {row.line} 行
                    </span>
                    <span className="min-w-0 flex-1 wrap-break-word">
                      {row.word}
                    </span>
                    <span
                      className={cn(
                        "max-w-[55%] text-right",
                        isBlocking(row)
                          ? "text-destructive"
                          : "text-muted-foreground"
                      )}
                    >
                      {row.state === "added"
                        ? "新增"
                        : issueText(row, status.limit)}
                    </span>
                  </li>
                ))}
              </ol>
            ) : null}
            {importBlocked ? (
              <Notice tone="error">
                有不符合要求或超限的词条。请修正文件后重新导入，不会只导入一部分
              </Notice>
            ) : importedWords.length === 0 ? (
              <Notice>没有可新增的词条</Notice>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                type="button"
                onClick={() => {
                  setImportText(null);
                }}
              >
                取消
              </Button>
              <Button
                type="button"
                disabled={busy || importBlocked || importedWords.length === 0}
                onClick={() => {
                  updateLines([...words, ...importedWords]);
                  setImportText(null);
                }}
              >
                确认追加
              </Button>
            </div>
          </Block>
        )}

        {lines.length === 0 ? (
          <EmptyState
            icon={BookText}
            title="还没有词条"
            description="添加易识别错的人名、术语，或导入 TXT"
          />
        ) : filtered.length === 0 ? (
          <EmptyState title="没有匹配的词条" className="py-6" />
        ) : (
          <div>
            <div className="flex h-10 items-center gap-3 bg-muted/40 pr-2 pl-4 text-[12px]">
              <input
                id={selectAllId}
                type="checkbox"
                className={CHECKBOX}
                disabled={busy}
                checked={allSelected}
                onChange={(event) => {
                  setSelection({
                    text,
                    rows: event.target.checked
                      ? new Set(filtered.map(({ index }) => index))
                      : new Set(),
                  });
                }}
              />
              {selected.size > 0 ? (
                <>
                  <span className="font-medium text-foreground tabular-nums">
                    已选 {selected.size} 项
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    className="ml-auto"
                    disabled={busy}
                    onClick={() => {
                      updateLines(
                        lines.filter((_, index) => !selected.has(index))
                      );
                    }}
                  >
                    <Trash2 />
                    删除选中
                  </Button>
                </>
              ) : (
                <>
                  <label
                    htmlFor={selectAllId}
                    className="text-muted-foreground"
                  >
                    {search ? "全选搜索结果" : "全选"}
                  </label>
                  <span className="ml-auto pr-2 text-muted-foreground tabular-nums">
                    {search
                      ? `${filtered.length} / ${lines.length}`
                      : lines.length}{" "}
                    行
                  </span>
                </>
              )}
            </div>
            <ul className="max-h-96 divide-y divide-border overflow-y-auto border-t border-border">
              {filtered.map(({ word, index }) => {
                const issue = issues.get(index);
                const blocking = issue ? isBlocking(issue) : false;
                return (
                  <li key={index} className="py-1 pr-2 pl-4">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className={CHECKBOX}
                        aria-label={`选择第 ${index + 1} 行`}
                        disabled={busy}
                        checked={selected.has(index)}
                        onChange={(event) => {
                          const next = new Set(selected);
                          if (event.target.checked) next.add(index);
                          else next.delete(index);
                          setSelection({ text, rows: next });
                        }}
                      />
                      <span className="w-6 shrink-0 text-right text-[12px] text-muted-foreground tabular-nums">
                        {index + 1}
                      </span>
                      <Input
                        className="h-7 border-transparent bg-transparent shadow-none"
                        value={word}
                        aria-label={`第 ${index + 1} 行词条`}
                        aria-invalid={blocking}
                        disabled={busy}
                        onChange={(event) => {
                          updateLines(
                            lines.map((line, at) =>
                              at === index ? event.target.value : line
                            )
                          );
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          updateLines(lines.filter((_, at) => at !== index));
                        }}
                        aria-label={`删除第 ${index + 1} 行`}
                      >
                        <X />
                      </Button>
                    </div>
                    {issue ? (
                      <p
                        className={cn(
                          "pb-1 pl-16.5 text-[12px] leading-4.5",
                          blocking
                            ? "text-destructive"
                            : "text-muted-foreground"
                        )}
                        role={blocking ? "alert" : "status"}
                      >
                        {issueText(issue, status.limit)}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Group>

      <div className="space-y-3">
        <Feedback message={message} />
        <div className="flex flex-wrap items-center gap-2 px-1">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            className="-ml-2.5"
            disabled={busy || !canDiscard}
            onClick={() => {
              setDiscarding(true);
            }}
          >
            放弃修改
          </Button>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {applyHint ? (
              <span className="text-[12px] text-muted-foreground">
                {applyHint}
              </span>
            ) : null}
            {canReview ? (
              <Button
                variant="ghost"
                type="button"
                disabled={busy || invalidCount > 0}
                onClick={onReview}
              >
                查看差异
              </Button>
            ) : null}
            <Button
              variant="outline"
              type="button"
              disabled={busy || invalidCount > 0}
              onClick={onSave}
            >
              保留本机草稿
            </Button>
            <Button
              type="button"
              disabled={
                busy ||
                !configured ||
                invalidCount > 0 ||
                confirming ||
                !cloudVerified
              }
              onClick={onApply}
            >
              应用到火山
            </Button>
          </div>
        </div>
      </div>

      <AlertDialog open={discarding} onOpenChange={setDiscarding}>
        <AlertDialogContent>
          <AlertDialogTitle>放弃本机修改？</AlertDialogTitle>
          <AlertDialogDescription>
            词条将恢复为上次应用到火山的内容，云端不受影响。
          </AlertDialogDescription>
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <AlertDialogCancel variant="ghost">取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDiscarding(false);
                onDiscard();
              }}
            >
              放弃修改
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
