import assert from "node:assert/strict";
import test from "node:test";

import {
  hotwordActionMessage,
  hotwordChip,
  hotwordDiff,
  normalizeHotwords,
} from "../src/hotwords.ts";

void test("hotwordDiff compares case-insensitively and keeps original spelling", () => {
  const diff = hotwordDiff(["Tauri", "voicepaste"], ["tauri", "TanStack"]);
  assert.deepEqual(diff.onlyLocal, ["voicepaste"]);
  assert.deepEqual(diff.onlyCloud, ["TanStack"]);

  const same = hotwordDiff(["ABC"], ["abc"]);
  assert.deepEqual(same, { onlyCloud: [], onlyLocal: [] });
});

void test("hotwordChip resolves states by priority", () => {
  const base: Parameters<typeof hotwordChip>[0] = {
    cloud: ["Tauri"],
    failed: false,
    local: ["Tauri"],
    state: "synced",
    syncing: false,
  };

  assert.deepEqual(hotwordChip({ ...base, failed: true, syncing: true }), {
    label: "正在同步",
    tone: "syncing",
  });
  assert.deepEqual(hotwordChip({ ...base, failed: true, state: "unknown" }), {
    label: "同步失败",
    tone: "error",
  });
  assert.deepEqual(hotwordChip({ ...base, local: [], state: "unknown" }), {
    label: "校验中…",
    tone: "neutral",
  });
  assert.deepEqual(hotwordChip({ ...base, local: [], state: "disabled" }), {
    label: "待同步",
    tone: "dirty",
  });
  assert.deepEqual(hotwordChip({ ...base, state: "disabled" }), {
    label: "云端保留 1 词 · 识别时不使用",
    tone: "neutral",
  });
  assert.deepEqual(hotwordChip({ ...base, cloud: [], local: [] }), {
    label: "未使用",
    tone: "neutral",
  });
  assert.deepEqual(hotwordChip(base), { label: "已同步", tone: "synced" });
});

void test("hotwordActionMessage covers every action", () => {
  assert.equal(
    hotwordActionMessage("created", 3),
    "已创建云端词表，共 3 个常用词"
  );
  assert.equal(
    hotwordActionMessage("updated", 2),
    "云端词表已更新，共 2 个常用词"
  );
  assert.equal(hotwordActionMessage("deleted", 0), "云端词表已删除");
  assert.equal(hotwordActionMessage("unchanged", 5), "云端词表已是最新");
  assert.equal(hotwordActionMessage("none", 0), "已保存");
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
