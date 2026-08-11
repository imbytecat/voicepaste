import assert from "node:assert/strict";
import test from "node:test";

import { commitMessageError } from "../tools/check-commit-message.ts";

void test("commit subjects require Conventional Commits with Chinese summaries", () => {
  assert.equal(commitMessageError("feat(settings): 增加模型自动发现"), null);
  assert.equal(commitMessageError("fix!: 修复不兼容的配置格式"), null);
  assert.equal(commitMessageError("chore(release): 1.4.4"), null);
  assert.match(
    commitMessageError("feat(settings): add model discovery") ?? "",
    /中文/u
  );
  assert.match(
    commitMessageError("更新模型发现") ?? "",
    /Conventional Commits/u
  );
});
