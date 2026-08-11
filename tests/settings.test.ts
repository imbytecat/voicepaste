import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_SETTINGS } from "../src/types.ts";

void test("product defaults favor hold-to-talk and streaming LLM output", () => {
  assert.equal(DEFAULT_SETTINGS.activationMode, "hold");
  assert.equal(DEFAULT_SETTINGS.llm.streaming, true);
  assert.equal(DEFAULT_SETTINGS.llm.baseUrl, "https://api.deepseek.com/v1");
  assert.equal(DEFAULT_SETTINGS.llm.model, "deepseek-v4-flash");
});
