import type {
  AccountStatus,
  RecognitionSettings,
  ServiceIssue,
  TestRecognitionResult,
} from "./types";

export interface RecognitionTestAttempt {
  generation: number;
  provider: RecognitionSettings["provider"];
  apiKey: string;
  providerRevision: number;
  accountRevision: number;
  disablePunctuation: boolean;
  disablePersonalWords: boolean;
}

export function recognitionConfigurationChanged(
  current: RecognitionSettings,
  saved: RecognitionSettings
): boolean {
  return (
    current.provider !== saved.provider ||
    (current.provider === "doubaoIme" &&
      (current.doubaoIme.disablePunctuation !==
        saved.doubaoIme.disablePunctuation ||
        current.doubaoIme.disablePersonalWords !==
          saved.doubaoIme.disablePersonalWords)) ||
    (current.provider === "volcengine" &&
      current.volcengine.apiKey !== saved.volcengine.apiKey)
  );
}

export function recognitionReady(
  recognition: RecognitionSettings,
  account: AccountStatus
): boolean {
  return recognition.provider === "volcengine"
    ? Boolean(recognition.volcengine.apiKey.trim())
    : account.state === "guest" || account.state === "signedIn";
}

export function recognitionTestAttempt(
  recognition: RecognitionSettings,
  account: AccountStatus,
  generation: number,
  providerRevision: number
): RecognitionTestAttempt {
  return {
    generation,
    provider: recognition.provider,
    apiKey:
      recognition.provider === "volcengine"
        ? recognition.volcengine.apiKey.trim()
        : "",
    providerRevision,
    disablePunctuation: recognition.doubaoIme.disablePunctuation,
    disablePersonalWords: recognition.doubaoIme.disablePersonalWords,
    accountRevision:
      recognition.provider === "doubaoIme" ? account.revision : 0,
  };
}

export function recognitionTestIsCurrent(
  attempt: RecognitionTestAttempt,
  recognition: RecognitionSettings,
  account: AccountStatus,
  generation: number,
  providerRevision: number,
  result?: TestRecognitionResult
): boolean {
  return (
    attempt.generation === generation &&
    attempt.provider === recognition.provider &&
    attempt.providerRevision === providerRevision &&
    (recognition.provider === "volcengine"
      ? attempt.apiKey === recognition.volcengine.apiKey.trim()
      : attempt.accountRevision === account.revision &&
        attempt.disablePunctuation ===
          recognition.doubaoIme.disablePunctuation &&
        attempt.disablePersonalWords ===
          recognition.doubaoIme.disablePersonalWords) &&
    recognitionReady(recognition, account) &&
    (!result ||
      (result.provider === attempt.provider &&
        result.providerRevision === attempt.providerRevision &&
        result.accountRevision === attempt.accountRevision))
  );
}

export function isServiceIssue(payload: unknown): payload is ServiceIssue {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "kind" in payload &&
    "title" in payload &&
    "steps" in payload
  );
}

export function safeError(error: unknown, ...secrets: string[]): string {
  let detail = String(error);
  for (const value of secrets) {
    const secret = value.trim();
    if (secret.length >= 4) detail = detail.split(secret).join("••••••••");
  }
  return detail;
}
