import { invoke } from "@tauri-apps/api/core";
import { BookText, RotateCw, Search } from "lucide-react";
import { useState } from "react";

import { Block, EmptyState, Group, Notice } from "@/components/settings/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Word {
  text: string;
  input: string;
  frequency: number;
}

const ROW_CAP = 100;

export function DoubaoDictionary({ revision }: { revision: number }) {
  const [words, setWords] = useState<Word[] | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    setBusy(true);
    setError("");
    try {
      const value = await invoke<{ version: string; words: Word[] }>(
        "doubao_dictionary_snapshot",
        { providerRevision: revision }
      );
      setWords(value.words);
    } catch {
      setError("读取个人词库失败，云端数据未修改，请重试");
    } finally {
      setBusy(false);
    }
  };
  const errorNotice = error ? (
    <Block>
      <Notice tone="error">{error}</Notice>
    </Block>
  ) : null;

  if (!words)
    return (
      <Group title="个人词库" description="豆包输入法自动学习的词，只读">
        <EmptyState
          icon={BookText}
          title="个人词库保存在豆包云端"
          description="读取后可在这里搜索查看"
          action={
            <Button type="button" disabled={busy} onClick={() => void load()}>
              {busy ? "读取中…" : "读取个人词库"}
            </Button>
          }
        />
        {errorNotice}
      </Group>
    );
  const matched = words.filter(
    (word) => word.text.includes(query) || word.input.includes(query)
  );

  return (
    <Group
      title="个人词库"
      description={`豆包输入法自动学习的词，只读 · ${words.length} 条`}
      actions={
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
      }
    >
      {words.length === 0 ? (
        <EmptyState title="个人词库为空" className="py-6" />
      ) : (
        <>
          <Block>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                className="pl-8"
                aria-label="搜索豆包个人词库"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
                placeholder="搜索词语或拼音"
              />
            </div>
          </Block>
          {matched.length === 0 ? (
            <EmptyState title="没有匹配的词" className="py-6" />
          ) : (
            <ul className="max-h-80 divide-y divide-border overflow-y-auto">
              {matched.slice(0, ROW_CAP).map((word, index) => (
                <li
                  key={`${word.input}-${word.text}-${index}`}
                  className="flex items-baseline justify-between gap-4 px-4 py-2"
                >
                  <span className="min-w-0 text-[13px] wrap-break-word">
                    {word.text}
                  </span>
                  <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">
                    {word.input} · {word.frequency}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {matched.length > ROW_CAP ? (
            <Block className="py-2.5 text-[12px] text-muted-foreground">
              仅显示前 {ROW_CAP} 条匹配结果，请缩小搜索范围
            </Block>
          ) : null}
        </>
      )}
      {errorNotice}
    </Group>
  );
}
