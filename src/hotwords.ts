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
