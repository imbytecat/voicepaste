import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Word {
  text: string;
  input: string;
  frequency: number;
}
export function DoubaoDictionary({
  revision,
  signedIn,
}: {
  revision: number;
  signedIn: boolean;
}) {
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
      setError("读取个人词库失败；未修改云端数据，请重试。");
    } finally {
      setBusy(false);
    }
  };
  const selected = words?.filter(
    (word) => word.text.includes(query) || word.input.includes(query)
  );
  return (
    <div className="space-y-3 border-t px-6 py-5">
      <h3 className="text-sm font-medium">自动学习的个人词库</h3>
      <p className="text-xs text-muted-foreground">
        只读查看输入法同步到账号的个人词库。不会自动学习或上传听写；读取成功不等于全部词条已参与语音识别。
      </p>
      <Button
        type="button"
        disabled={!signedIn || busy}
        onClick={() => void load()}
      >
        {busy ? "读取中…" : "读取个人词库"}
      </Button>
      {words && (
        <>
          <p className="text-xs text-muted-foreground">
            {words.length} 条记录；同词不同读音可分别存在。当前不执行云端重置。
          </p>
          <Input
            aria-label="搜索豆包个人词库"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            placeholder="搜索词语或拼音"
          />
          <ul className="max-h-72 overflow-auto text-sm">
            {selected?.slice(0, 100).map((word, index) => (
              <li
                key={`${word.input}-${word.text}-${index}`}
                className="flex justify-between gap-3 border-b py-2"
              >
                <span>{word.text}</span>
                <span className="text-xs text-muted-foreground">
                  {word.input} · {word.frequency}
                </span>
              </li>
            ))}
          </ul>
          {(selected?.length ?? 0) > 100 && (
            <p className="text-xs text-muted-foreground">
              显示前 100 条匹配记录，请缩小搜索范围。
            </p>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
