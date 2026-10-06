import { QueryClient, queryOptions } from "@tanstack/react-query";
import { invoke, isTauri } from "@tauri-apps/api/core";

import { AudioCapture } from "@/audio";
import type {
  RecognitionProvider,
  SystemDiagnostics,
  UpdateInfo,
} from "@/types";

/*
 * Every read the settings window makes against the backend or the cloud is
 * declared here, so caching, de-duplication and invalidation follow one set
 * of keys. Drafted settings and the Volcengine hotword sync stay in the
 * controller: they are local edits guarded by provider revisions, not fetches.
 */

export const queryClient = new QueryClient({
  defaultOptions: {
    // Reads may hit cloud accounts: never retry or refetch behind the user's
    // back. Stale data refreshes when a page mounts or the user asks.
    mutations: { retry: false },
    queries: { refetchOnWindowFocus: false, retry: false, staleTime: 30_000 },
  },
});

export interface DoubaoPhrase {
  id: string;
  text: string;
}
export interface DoubaoPhraseSnapshot {
  version: string;
  phrases: DoubaoPhrase[];
}
export interface DoubaoWord {
  text: string;
  input: string;
  frequency: number;
}

/** Bumping the provider or account revision gives a fresh key, never stale data. */
interface DoubaoScope {
  providerRevision: number;
  accountRevision: number;
}

export const settingsQueries = {
  diagnostics: () =>
    queryOptions({
      enabled: isTauri(),
      queryFn: async () =>
        await invoke<SystemDiagnostics>("system_diagnostics"),
      queryKey: ["diagnostics"],
      staleTime: 0,
    }),
  doubaoDictionary: ({ accountRevision, providerRevision }: DoubaoScope) =>
    queryOptions({
      queryFn: async () => {
        const snapshot = await invoke<{ version: string; words: DoubaoWord[] }>(
          "doubao_dictionary_snapshot",
          { providerRevision }
        );
        return snapshot.words;
      },
      queryKey: ["doubao", "dictionary", providerRevision, accountRevision],
    }),
  doubaoPhrases: ({ accountRevision, providerRevision }: DoubaoScope) =>
    queryOptions({
      queryFn: async () =>
        await invoke<DoubaoPhraseSnapshot>("doubao_phrase_snapshot", {
          providerRevision,
        }),
      queryKey: ["doubao", "phrases", providerRevision, accountRevision],
    }),
  /**
   * Keyed by everything the list depends on, so editing the address or key
   * simply shows no list until fetched again. Fetched only on request.
   */
  llmModels: (target: {
    providerRevision: number;
    provider: RecognitionProvider;
    baseUrl: string;
    apiKey: string;
  }) =>
    queryOptions({
      enabled: false,
      queryFn: async () => {
        if (!isTauri()) throw new Error("获取模型仅在 VoicePaste 桌面版中可用");
        if (!target.baseUrl.trim()) throw new Error("请先填写接口地址");
        return await invoke<string[]>("list_llm_models", {
          apiKey: target.apiKey,
          baseUrl: target.baseUrl,
          providerRevision: target.providerRevision,
        });
      },
      queryKey: [
        "llm-models",
        target.providerRevision,
        target.provider,
        target.baseUrl,
        target.apiKey,
      ],
      staleTime: Number.POSITIVE_INFINITY,
    }),
  microphones: () =>
    queryOptions({
      queryFn: async () => await AudioCapture.devices(),
      queryKey: ["microphones"],
      staleTime: 0,
    }),
  update: () =>
    queryOptions({
      enabled: isTauri(),
      queryFn: async () => await invoke<UpdateInfo | null>("check_for_update"),
      queryKey: ["update"],
      staleTime: Number.POSITIVE_INFINITY,
    }),
};
