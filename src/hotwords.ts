import type { HotwordAction, HotwordSyncState } from "@/types";

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

export function hotwordChip(input: {
  state: HotwordSyncState;
  syncing: boolean;
  failed: boolean;
  local: string[];
  cloud: string[];
}): {
  label: string;
  tone: "synced" | "dirty" | "error" | "neutral" | "syncing";
} {
  if (input.syncing) return { label: "正在同步", tone: "syncing" };
  if (input.failed) return { label: "同步失败", tone: "error" };
  if (input.state === "unknown") return { label: "校验中…", tone: "neutral" };
  const { onlyCloud, onlyLocal } = hotwordDiff(input.local, input.cloud);
  if (onlyCloud.length > 0 || onlyLocal.length > 0)
    return { label: "待同步", tone: "dirty" };
  if (input.state === "disabled")
    return {
      label: `云端保留 ${input.cloud.length} 词 · 识别时不使用`,
      tone: "neutral",
    };
  if (input.cloud.length === 0 && input.local.length === 0)
    return { label: "未使用", tone: "neutral" };
  return { label: "已同步", tone: "synced" };
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
