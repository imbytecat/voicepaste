import assert from "node:assert/strict";
import test from "node:test";

import {
  hotwordDiff,
  normalizeHotwords,
  previewHotwordImport,
  replayHotwordChanges,
} from "../src/hotwords.ts";

void test("hotwordDiff compares case-insensitively and keeps original spelling", () => {
  const diff = hotwordDiff(["Tauri", "voicepaste"], ["tauri", "TanStack"]);
  assert.deepEqual(diff.onlyLocal, ["voicepaste"]);
  assert.deepEqual(diff.onlyCloud, ["TanStack"]);

  const same = hotwordDiff(["ABC"], ["abc"]);
  assert.deepEqual(same, { onlyCloud: [], onlyLocal: [] });
});

void test("normalizeHotwords trims, deduplicates and rejects invalid words", () => {
  assert.deepEqual(normalizeHotwords("  Tauri \n\n tauri\nVoicePaste\n", 10), [
    "Tauri",
    "VoicePaste",
  ]);
  assert.throws(() => normalizeHotwords("a\nb\nc", 2), /不能超过 2 条/u);
  assert.throws(() => normalizeHotwords("hello world", 10), /不能包含空格/u);
  assert.throws(() => normalizeHotwords("abcdefghijk", 10), /过长/u);
  assert.throws(() => normalizeHotwords("十一个汉字太长了吧真的", 10), /过长/u);
  assert.deepEqual(normalizeHotwords("十个汉字刚刚好没问题", 10), [
    "十个汉字刚刚好没问题",
  ]);
});

void test("replaying explicit draft deletions preserves unrelated remote edits without resurrecting words", () => {
  assert.deepEqual(
    replayHotwordChanges(["Old", "Keep"], ["Keep", "Local"], ["old", "Remote"]),
    ["Remote", "Local"]
  );
});

void test("TXT preview reports duplicate, invalid and over-limit rows without truncation", () => {
  const rows = previewHotwordImport(
    "\uFEFFTauri\r\nNew\nnew\nbad word\nOther\nFourth\n",
    ["tauri"],
    2
  );
  assert.deepEqual(
    rows.map(({ line, state }) => ({ line, state })),
    [
      { line: 1, state: "duplicate" },
      { line: 2, state: "added" },
      { line: 3, state: "duplicate" },
      { line: 4, state: "invalid" },
      { line: 5, state: "overLimit" },
      { line: 6, state: "overLimit" },
    ]
  );
  assert.equal(rows[3]?.word, "bad word");
  assert.equal(previewHotwordImport("a\u0000b", [], 5)[0]?.state, "invalid");
  assert.equal(previewHotwordImport("👨‍👩‍👧‍👦👨‍👩‍👧‍👦", [], 5)[0]?.state, "invalid");
});
