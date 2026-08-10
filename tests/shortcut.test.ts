import assert from "node:assert/strict";
import test from "node:test";

import { shortcutValidationError } from "../src/shortcut.ts";

void test("portable shortcuts allow combinations and F13-F20 single keys", () => {
  for (const shortcut of ["Mod+Shift+Space", "Control+F12", "F13", "F20"])
    assert.equal(shortcutValidationError(shortcut), null);

  for (const shortcut of ["A", "Space", "F12", "F21"])
    assert.ok(shortcutValidationError(shortcut)?.includes("F13–F20"), shortcut);
});
