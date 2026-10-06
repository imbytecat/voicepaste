import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  isServiceIssue,
  recognitionReady,
  recognitionTestAttempt,
  recognitionTestIsCurrent,
  safeError,
} from "@/recognition";
import type { RecognitionTestAttempt } from "@/recognition";
import type {
  AccountStatus,
  RecognitionSettings,
  ServiceIssue,
  TestRecognitionResult,
} from "@/types";

const INITIAL_ACCOUNT: AccountStatus = {
  state: "unavailable",
  nickname: null,
  message: "正在读取账号状态…",
  revision: -1,
};

type AccountCommand =
  | "login_doubao"
  | "cancel_doubao_login"
  | "logout_doubao"
  | "recheck_doubao_account";

export interface RecognitionService {
  account: AccountStatus;
  accountBusy: boolean;
  accountError: string | null;
  accountAction: (command: AccountCommand) => Promise<void>;
  acceptAccount: (account: AccountStatus) => void;
  invalidate: () => void;
  issue: ServiceIssue | null;
  result: TestRecognitionResult | null;
  testing: boolean;
  testConnection: (revision?: number) => Promise<void>;
  verified: boolean;
}

export function useRecognitionService(
  getRecognition: () => RecognitionSettings,
  providerRevision: number
): RecognitionService {
  const [account, setAccount] = useState(INITIAL_ACCOUNT);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [issue, setIssue] = useState<ServiceIssue | null>(null);
  const [result, setResult] = useState<TestRecognitionResult | null>(null);
  const [verifiedAttempt, setVerifiedAttempt] =
    useState<RecognitionTestAttempt | null>(null);
  const accountRef = useRef(INITIAL_ACCOUNT);
  const generationRef = useRef(0);
  const testingRef = useRef(false);
  const accountBusyRef = useRef(false);
  const { provider } = getRecognition();
  const contextRef = useRef({ provider, providerRevision });
  contextRef.current = { provider, providerRevision };

  const invalidate = useCallback(() => {
    generationRef.current += 1;
    setVerifiedAttempt(null);
    setResult(null);
    setIssue(null);
  }, []);

  const acceptAccount = useCallback(
    (next: AccountStatus) => {
      const { current } = accountRef;
      if (next.revision < current.revision) return;
      if (next.revision !== current.revision || next.state !== current.state)
        invalidate();
      accountRef.current = next;
      setAccount(next);
    },
    [invalidate]
  );

  useEffect(() => {
    invalidate();
    setAccountError(null);
    if (providerRevision < 0 || provider !== "doubaoIme") return;
    if (!isTauri()) {
      acceptAccount({
        state: "guest",
        nickname: null,
        message: "浏览器预览不连接服务，也不保存账号。",
        revision: 0,
      });
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const stop = await listen<AccountStatus>(
          "doubao-account-changed",
          (event) => {
            if (!disposed) acceptAccount(event.payload);
          }
        );
        if (disposed) {
          stop();
          return;
        }
        unlisten = stop;
        const current = await invoke<AccountStatus>("get_doubao_account", {
          providerRevision,
        });
        if (!disposed) acceptAccount(current);
      } catch (error) {
        if (disposed) return;
        invalidate();
        setAccountError(`无法读取账号状态：${safeError(error)}`);
        const unavailable = {
          ...accountRef.current,
          state: "unavailable" as const,
          message: "账号状态不可用，请重试；不会自动切换为游客。",
        };
        accountRef.current = unavailable;
        setAccount(unavailable);
      }
    })();
    return () => {
      disposed = true;
      generationRef.current += 1;
      unlisten?.();
    };
  }, [acceptAccount, invalidate, provider, providerRevision]);

  const accountAction = async (command: AccountCommand) => {
    if (
      provider !== "doubaoIme" ||
      providerRevision < 0 ||
      accountBusyRef.current ||
      testingRef.current
    )
      return;
    accountBusyRef.current = true;
    setAccountBusy(true);
    setAccountError(null);
    invalidate();
    try {
      if (!isTauri()) throw new Error("登录与退出仅在 VoicePaste 桌面版中可用");
      const next = await invoke<AccountStatus>(command, { providerRevision });
      if (contextRef.current.providerRevision === providerRevision)
        acceptAccount(next);
    } catch (error) {
      if (contextRef.current.providerRevision === providerRevision)
        setAccountError(
          isServiceIssue(error) ? error.detail : safeError(error)
        );
    } finally {
      accountBusyRef.current = false;
      setAccountBusy(false);
    }
  };

  /** `revision` overrides the rendered one right after a save bumped it. */
  const testConnection = async (revision = providerRevision) => {
    if (testingRef.current || accountBusyRef.current) return;
    const recognition = getRecognition();
    invalidate();
    const attempt = recognitionTestAttempt(
      recognition,
      accountRef.current,
      generationRef.current,
      revision
    );
    testingRef.current = true;
    setTesting(true);
    try {
      if (!isTauri()) throw new Error("浏览器预览无法测试识别服务连接");
      if (!recognitionReady(recognition, accountRef.current))
        throw new Error(
          recognition.provider === "volcengine"
            ? "请先填写火山引擎 API Key"
            : "请完成登录、重新登录，或明确选择改用游客"
        );
      const response = await invoke<TestRecognitionResult>("test_recognition", {
        recognition,
        providerRevision: revision,
      });
      if (
        !recognitionTestIsCurrent(
          attempt,
          getRecognition(),
          accountRef.current,
          generationRef.current,
          contextRef.current.providerRevision,
          response
        )
      )
        return;
      setVerifiedAttempt(attempt);
      setResult(response);
    } catch (error) {
      if (
        attempt.generation !== generationRef.current ||
        attempt.providerRevision !== contextRef.current.providerRevision
      )
        return;
      setIssue(
        isServiceIssue(error)
          ? error
          : {
              kind: "unknown",
              title: "识别服务连接失败",
              detail: safeError(error, recognition.volcengine.apiKey),
              steps: [],
              links: [],
            }
      );
    } finally {
      testingRef.current = false;
      setTesting(false);
    }
  };

  return {
    account,
    accountBusy,
    accountError,
    accountAction,
    acceptAccount,
    invalidate,
    issue,
    result,
    testing,
    testConnection,
    verified:
      verifiedAttempt !== null &&
      result !== null &&
      recognitionTestIsCurrent(
        verifiedAttempt,
        getRecognition(),
        account,
        generationRef.current,
        providerRevision,
        result
      ),
  };
}
