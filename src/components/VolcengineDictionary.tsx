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

import { useSettings } from "@/components/settings/controller";
import {
  Block,
  EmptyState,
  Group,
  Notice,
  Row,
  StatusText,
} from "@/components/settings/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { previewHotwordImport } from "@/hotwords";
import type { HotwordImportRow } from "@/hotwords";
import { cn } from "@/lib/utils";

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const DEFAULT_LIMIT = 5000;
const CHECKBOX = "size-3.5 shrink-0 accent-primary";

/** `normalizeHotwords` errors stringify as "Error: …"; show only the message. */
function issueText(row: HotwordImportRow, limit: number): string {
  if (row.state === "duplicate") return "已在词库中";
  if (row.state === "overLimit") return `超出 ${limit} 个上限`;
  return row.reason?.replace(/^Error: /u, "") ?? "格式不符合要求";
}

function isBlocking(row: HotwordImportRow) {
  return row.state === "invalid" || row.state === "overLimit";
}

const key = (word: string) => word.toLocaleLowerCase();

/**
 * The Volcengine word list. Every edit is saved on this device at once and
 * merged into the cloud table in the background, so there is nothing to
 * apply, review or resolve.
 */
export function VolcengineDictionary() {
  const {
    editHotwords,
    errorText,
    hotwordSync,
    hotwordSyncQueued,
    providerRevision,
    savedSettingsRef,
    selectSection,
    settings,
    syncHotwords,
  } = useSettings();
  const { hotwords: words, hotwordsEnabled: enabled } =
    settings.recognition.volcengine;
  const configured = Boolean(
    savedSettingsRef.current.recognition.volcengine.apiKey
  );
  const limit = hotwordSync.data?.limit ?? DEFAULT_LIMIT;

  const [search, setSearch] = useState("");
  const [addingWord, setAddingWord] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importText, setImportText] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const importGeneration = useRef(0);
  const selectAllId = useId();

  // Opening the page pulls edits made on other devices.
  useEffect(() => {
    syncHotwords();
  }, [syncHotwords, providerRevision]);
  useEffect(
    () => () => {
      importGeneration.current += 1;
    },
    []
  );

  const wordKeys = new Set(words.map(key));
  const selection = [...selected].filter((word) => wordKeys.has(word));
  const filtered = words.filter((word) =>
    key(word).includes(key(search.trim()))
  );
  const allSelected =
    filtered.length > 0 && filtered.every((word) => selected.has(key(word)));
  const imported =
    importText === null ? [] : previewHotwordImport(importText, words, limit);
  const importBlocked = imported.some(isBlocking);
  const importedWords = imported
    .filter((row) => row.state === "added")
    .map((row) => row.word);
  const importCount = (state: HotwordImportRow["state"]) =>
    imported.filter((row) => row.state === state).length;

  const edit = async (change: Parameters<typeof editHotwords>[0]) => {
    setEditError(null);
    setEditing(true);
    try {
      await editHotwords(change);
      return true;
    } catch (error) {
      setEditError(errorText(error));
      return false;
    } finally {
      setEditing(false);
    }
  };

  const addWord = async () => {
    const [row] = previewHotwordImport(addingWord, words, limit);
    if (!row) return;
    if (row.state !== "added") {
      setAddError(issueText(row, limit));
      return;
    }
    if (await edit({ add: [row.word] })) setAddingWord("");
  };

  const removeWords = async (remove: string[]) => {
    if (await edit({ remove })) setSelected(new Set());
  };

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    importGeneration.current += 1;
    const generation = importGeneration.current;
    setEditError(null);
    setImportText(null);
    if (file.size > MAX_IMPORT_BYTES) {
      setEditError("TXT 文件不能超过 2 MiB，请拆分后导入");
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
          setEditError(`无法读取 UTF-8 TXT：${String(error)}`);
      });
  };

  const exportWords = () => {
    setEditError(null);
    if (isTauri()) {
      setExporting(true);
      void invoke<boolean>("export_volcengine_hotwords", {
        words,
        providerRevision,
      })
        .catch((error: unknown) => {
          setEditError(`导出失败：${String(error)}`);
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
    link.download = "voicepaste-volcengine-hotwords.txt";
    link.click();
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  };

  let syncStatus = null;
  if (!configured)
    syncStatus = <StatusText tone="warning">未同步：尚未保存 Key</StatusText>;
  else if (hotwordSyncQueued || hotwordSync.isPending)
    syncStatus = <StatusText tone="info">正在同步…</StatusText>;
  else if (hotwordSync.isError)
    syncStatus = <StatusText tone="error">同步失败</StatusText>;
  else if (hotwordSync.isSuccess)
    syncStatus = <StatusText tone="success">已同步到火山</StatusText>;

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
              onClick={() => {
                selectSection("recognition");
              }}
            >
              去设置
            </Button>
          }
        >
          保存火山 API Key 后，词条会自动同步到云端
        </Notice>
      )}

      <Group>
        <Row
          title="听写时使用"
          description={enabled ? "识别时优先识别这些词" : "识别时不使用词条"}
        >
          <Switch
            checked={enabled}
            onCheckedChange={(next) => void edit({ enabled: next })}
            disabled={editing}
            aria-label="听写时使用火山常用词"
          />
        </Row>
        <Block className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-3">
          <span className="text-[12px] text-muted-foreground tabular-nums">
            {words.length} / {limit} 词
          </span>
          <span aria-live="polite">{syncStatus}</span>
          {hotwordSync.isError && configured ? (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              className="ml-auto"
              onClick={syncHotwords}
            >
              <RotateCw />
              重试
            </Button>
          ) : null}
          {hotwordSync.isError && configured ? (
            <p className="w-full text-[12px] leading-4.5 text-muted-foreground">
              {errorText(hotwordSync.error)}
            </p>
          ) : null}
          {(hotwordSync.data?.foreignTables.length ?? 0) > 0 ? (
            <p className="w-full text-[12px] leading-4.5 text-muted-foreground">
              账号里另有 {hotwordSync.data?.foreignTables.length}{" "}
              张其他词表，VoicePaste 不会修改或使用它们
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
              disabled={editing}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload />
              导入
            </Button>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              disabled={exporting || words.length === 0}
              onClick={exportWords}
            >
              <Download />
              {exporting ? "正在导出…" : "导出"}
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
                if (!editing) void addWord();
              }}
            >
              <Input
                value={addingWord}
                onChange={(event) => {
                  setAddingWord(event.target.value);
                  setAddError(null);
                }}
                aria-label="新增火山词条"
                aria-invalid={addError !== null}
                aria-describedby={addError ? `${selectAllId}-add` : undefined}
                placeholder="添加人名、术语…"
              />
              <Button
                variant="outline"
                type="submit"
                disabled={editing || !addingWord.trim()}
              >
                <Plus />
                添加
              </Button>
            </form>
            {words.length > 0 ? (
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
          <p
            id={`${selectAllId}-add`}
            className={cn(
              "text-[12px] leading-4.5",
              addError ? "text-destructive" : "text-muted-foreground"
            )}
            role={addError ? "alert" : undefined}
          >
            {addError ?? "最多 10 个字，不含空格"}
          </p>
          {editError ? <Notice tone="error">{editError}</Notice> : null}
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
                      {row.state === "added" ? "新增" : issueText(row, limit)}
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
                disabled={
                  editing || importBlocked || importedWords.length === 0
                }
                onClick={() => {
                  void edit({ add: importedWords }).then((done) => {
                    if (done) setImportText(null);
                  });
                }}
              >
                添加 {importedWords.length} 个词
              </Button>
            </div>
          </Block>
        )}

        {words.length === 0 ? (
          <EmptyState
            icon={BookText}
            title="还没有词条"
            description="添加容易识别错的人名、术语，或导入 TXT"
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
                checked={allSelected}
                onChange={(event) => {
                  setSelected(
                    event.target.checked
                      ? new Set(filtered.map(key))
                      : new Set()
                  );
                }}
              />
              {selection.length > 0 ? (
                <>
                  <span className="font-medium text-foreground tabular-nums">
                    已选 {selection.length} 项
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    className="ml-auto"
                    disabled={editing}
                    onClick={() => void removeWords(selection)}
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
                      ? `${filtered.length} / ${words.length}`
                      : words.length}{" "}
                    词
                  </span>
                </>
              )}
            </div>
            <ul className="max-h-96 divide-y divide-border overflow-y-auto border-t border-border">
              {filtered.map((word) => (
                <li
                  key={key(word)}
                  className="flex h-9 items-center gap-3 pr-2 pl-4"
                >
                  <input
                    type="checkbox"
                    className={CHECKBOX}
                    aria-label={`选择 ${word}`}
                    checked={selected.has(key(word))}
                    onChange={(event) => {
                      const next = new Set(selected);
                      if (event.target.checked) next.add(key(word));
                      else next.delete(key(word));
                      setSelected(next);
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                    {word}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    type="button"
                    disabled={editing}
                    onClick={() => void removeWords([word])}
                    aria-label={`删除 ${word}`}
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Group>
    </>
  );
}
