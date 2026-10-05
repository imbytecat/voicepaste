import type { HotwordAction } from "@/types";

const UTF8_ENCODER = new TextEncoder();
const CHARACTER_SEGMENTER = new Intl.Segmenter("zh", {
  granularity: "grapheme",
});

export function uniqueHotwords(value: string): string[] {
  const seen = new Set<string>();
  const hotwords: string[] = [];
  for (const line of value.split("\n")) {
    const word = line.trim();
    const identity = word.toLocaleLowerCase();
    if (!word || seen.has(identity)) continue;
    seen.add(identity);
    hotwords.push(word);
  }
  return hotwords;
}

export function normalizeHotwords(value: string, limit: number): string[] {
  const hotwords = uniqueHotwords(value);
  if (hotwords.length > limit)
    throw new Error(
      `常用词数量不能超过 ${limit} 条，当前为 ${hotwords.length} 条`
    );
  for (const word of hotwords) {
    if (/\s/u.test(word)) throw new Error(`常用词“${word}”不能包含空格`);
    if (/\p{Cc}/u.test(word))
      throw new Error(`常用词“${word}”不能包含控制字符`);
    if (
      [...CHARACTER_SEGMENTER.segment(word)].length > 10 ||
      UTF8_ENCODER.encode(word).length > 30
    )
      throw new Error(`常用词“${word}”过长：最多 10 个字符且不超过 30 字节`);
  }
  return hotwords;
}

/** Case-insensitive comparison; the original spelling is kept in the result. */
export function hotwordDiff(
  local: string[],
  cloud: string[]
): { onlyLocal: string[]; onlyCloud: string[] } {
  const localKeys = new Set(local.map((word) => word.toLocaleLowerCase()));
  const cloudKeys = new Set(cloud.map((word) => word.toLocaleLowerCase()));
  return {
    onlyCloud: cloud.filter((word) => !localKeys.has(word.toLocaleLowerCase())),
    onlyLocal: local.filter((word) => !cloudKeys.has(word.toLocaleLowerCase())),
  };
}

export function replayHotwordChanges(
  baseline: string[],
  draft: string[],
  cloud: string[]
): string[] {
  const { onlyLocal: added, onlyCloud: removed } = hotwordDiff(draft, baseline);
  const removedKeys = new Set(removed.map((word) => word.toLocaleLowerCase()));
  return uniqueHotwords(
    [
      ...cloud.filter((word) => !removedKeys.has(word.toLocaleLowerCase())),
      ...added,
    ].join("\n")
  );
}

export interface HotwordImportRow {
  line: number;
  word: string;
  state: "added" | "duplicate" | "invalid" | "overLimit";
  reason: string | null;
}

export function previewHotwordImport(
  text: string,
  existing: string[],
  limit: number
): HotwordImportRow[] {
  const seen = new Set(existing.map((word) => word.toLocaleLowerCase()));
  const rows: HotwordImportRow[] = [];
  for (const [index, line] of text
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/u)
    .entries()) {
    const word = line.trim();
    if (!word) continue;
    const row: HotwordImportRow = {
      line: index + 1,
      word,
      state: "added",
      reason: null,
    };
    try {
      normalizeHotwords(word, 1);
      if (seen.has(word.toLocaleLowerCase())) row.state = "duplicate";
      else {
        seen.add(word.toLocaleLowerCase());
        if (seen.size > limit) row.state = "overLimit";
      }
    } catch (error) {
      row.state = "invalid";
      row.reason = String(error);
    }
    rows.push(row);
  }
  return rows;
}

export function hotwordActionMessage(
  action: HotwordAction,
  cloudCount: number
): string {
  if (action === "created") return `已创建云端词表，共 ${cloudCount} 个常用词`;
  if (action === "updated") return `云端词表已更新，共 ${cloudCount} 个常用词`;
  if (action === "deleted") return "云端词表已删除";
  if (action === "unchanged") return "云端词表已是最新";
  return "已保存";
}
