import assert from "node:assert/strict";
import test from "node:test";

import {
  recognitionConfigurationChanged,
  recognitionReady,
  recognitionTestAttempt,
  recognitionTestIsCurrent,
} from "../src/recognition.ts";
import { DEFAULT_SETTINGS } from "../src/types.ts";
import type {
  AccountStatus,
  RecognitionSettings,
  TestRecognitionResult,
} from "../src/types.ts";

const guest: AccountStatus = {
  state: "guest",
  nickname: null,
  message: null,
  revision: 3,
};
const recognition: RecognitionSettings = DEFAULT_SETTINGS.recognition;

void test("guest can test without a key but unusable accounts cannot fall back", () => {
  assert.equal(recognitionReady(recognition, guest), true);
  for (const state of ["signingIn", "expired", "unavailable"] as const)
    assert.equal(recognitionReady(recognition, { ...guest, state }), false);
  assert.equal(
    recognitionReady({ ...recognition, provider: "volcengine" }, guest),
    false
  );
  assert.equal(
    recognitionReady(
      {
        ...recognition,
        provider: "volcengine",
        volcengine: { ...recognition.volcengine, apiKey: "configured-key" },
      },
      { ...guest, state: "expired" }
    ),
    true
  );
});

void test("connection proofs reject stale provider epochs, account identities and request generations", () => {
  const attempt = recognitionTestAttempt(recognition, guest, 7, 12);
  const result: TestRecognitionResult = {
    provider: "doubaoIme",
    providerRevision: 12,
    accountRevision: guest.revision,
  };
  assert.equal(
    recognitionTestIsCurrent(attempt, recognition, guest, 7, 12, result),
    true
  );
  assert.equal(
    recognitionTestIsCurrent(
      attempt,
      { ...recognition, provider: "volcengine" },
      guest,
      7,
      12,
      result
    ),
    false
  );
  assert.equal(
    recognitionTestIsCurrent(
      attempt,
      recognition,
      { ...guest, revision: 4 },
      7,
      12,
      result
    ),
    false
  );
  assert.equal(
    recognitionTestIsCurrent(
      attempt,
      recognition,
      { ...guest, state: "expired" },
      7,
      12,
      result
    ),
    false
  );
  assert.equal(
    recognitionTestIsCurrent(attempt, recognition, guest, 9, 12, result),
    false
  );
  assert.equal(
    recognitionTestIsCurrent(attempt, recognition, guest, 7, 14, result),
    false
  );
  assert.equal(
    recognitionTestIsCurrent(attempt, recognition, guest, 7, 12, {
      ...result,
      providerRevision: 10,
    }),
    false
  );
  assert.equal(
    recognitionTestIsCurrent(attempt, recognition, guest, 7, 12, {
      ...result,
      accountRevision: 2,
    }),
    false
  );
});

void test("inactive credentials cannot invalidate current provider settings or proof", () => {
  const attempt = recognitionTestAttempt(recognition, guest, 1, 4);
  const changedInactive: RecognitionSettings = {
    ...recognition,
    volcengine: {
      ...recognition.volcengine,
      apiKey: "different-key",
    },
  };
  assert.equal(
    recognitionConfigurationChanged(changedInactive, recognition),
    false
  );
  assert.equal(
    recognitionTestIsCurrent(attempt, changedInactive, guest, 1, 4),
    true
  );
  const api: RecognitionSettings = {
    ...recognition,
    provider: "volcengine",
    volcengine: { ...recognition.volcengine, apiKey: "configured-key" },
  };
  const apiAttempt = recognitionTestAttempt(api, guest, 1, 6);
  const result: TestRecognitionResult = {
    provider: "volcengine",
    providerRevision: 6,
    accountRevision: 0,
  };
  assert.equal(
    recognitionTestIsCurrent(
      apiAttempt,
      api,
      { ...guest, revision: 80, state: "expired" },
      1,
      6,
      result
    ),
    true
  );
  assert.equal(
    recognitionTestIsCurrent(
      apiAttempt,
      { ...api, volcengine: { ...api.volcengine, apiKey: "new-key" } },
      guest,
      1,
      6,
      result
    ),
    false
  );
});

void test("changed IME request options invalidate old connection proof", () => {
  const attempt = recognitionTestAttempt(recognition, guest, 1, 4);
  for (const key of ["disablePunctuation", "disablePersonalWords"] as const) {
    const changed = {
      ...recognition,
      doubaoIme: { ...recognition.doubaoIme, [key]: true },
    };
    assert.equal(recognitionConfigurationChanged(changed, recognition), true);
    assert.equal(
      recognitionTestIsCurrent(attempt, changed, guest, 1, 4),
      false
    );
    const inactive = { ...changed, provider: "volcengine" as const };
    assert.equal(
      recognitionConfigurationChanged(inactive, {
        ...recognition,
        provider: "volcengine",
      }),
      false
    );
  }
});
