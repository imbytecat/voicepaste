import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { AudioCapture } from "@/audio";
import type { MicrophoneDevice } from "@/audio";
import type { Message } from "@/components/settings/kit";
import { useRecognitionService } from "@/components/useRecognitionService";
import {
  hotwordActionMessage,
  replayHotwordChanges,
  hotwordDiff,
  normalizeHotwords,
  uniqueHotwords,
} from "@/hotwords";
import {
  isServiceIssue,
  recognitionConfigurationChanged,
  safeError,
} from "@/recognition";
import type { SettingsSectionId } from "@/routes/-settings-navigation";
import { useShortcutRecorder } from "@/shortcut";
import { DEFAULT_SETTINGS } from "@/types";
import type {
  AccountStatus,
  AppSettings,
  HotwordSnapshotResult,
  HotwordSyncStatus,
  LlmSettings,
  RecognitionProvider,
  RecognitionSettings,
  SaveSettingsResult,
  ServiceIssue,
  ServiceIssueLink,
  SystemDiagnostics,
  UpdateInfo,
} from "@/types";

export const DEFAULT_MICROPHONE_VALUE = "__voicepaste_system_default__";
const CONSOLE_URL = "https://console.volcengine.com/speech/new/setting/apikeys";

const DEFAULT_HOTWORD_STATUS: HotwordSyncStatus = {
  cloudCount: 0,
  count: 0,
  foreignTables: [],
  limit: 5000,
  state: "empty",
  tableId: null,
};

interface LoadSettingsResult {
  settings: AppSettings;
  account: AccountStatus | null;
  providerRevision: number;
  hotwordStatus: HotwordSyncStatus | null;
  notice?: string;
}
interface HotwordConflict {
  cloudHotwords: string[];
  words: string[];
  reviewToken: string;
}
type SavedSettingsResult = Extract<SaveSettingsResult, { kind: "saved" }>;
type ProductLinkTarget =
  | "homepage"
  | "help"
  | "privacy"
  | ServiceIssueLink["target"];

export const TRANSIENT_MESSAGE_DURATION = 2200;
export const SETTINGS_TOAST_ID = "settings-feedback";

function llmSettingsChanged(current: LlmSettings, saved: LlmSettings): boolean {
  return (
    current.enabled !== saved.enabled ||
    current.baseUrl !== saved.baseUrl ||
    current.apiKey !== saved.apiKey ||
    current.model !== saved.model ||
    current.prompt !== saved.prompt ||
    current.streaming !== saved.streaming ||
    current.extraParameters !== saved.extraParameters
  );
}

function settingsChanged(
  current: AppSettings,
  hotwordsText: string,
  saved: AppSettings,
  savedHotwordsText: string
): boolean {
  return (
    recognitionConfigurationChanged(current.recognition, saved.recognition) ||
    current.shortcut !== saved.shortcut ||
    current.activationMode !== saved.activationMode ||
    current.microphoneId !== saved.microphoneId ||
    current.onboardingCompleted !== saved.onboardingCompleted ||
    current.launchAtStartup !== saved.launchAtStartup ||
    current.openSettingsOnStartup !== saved.openSettingsOnStartup ||
    current.overlayPosition !== saved.overlayPosition ||
    (current.recognition.provider === "doubaoIme" &&
      current.recognition.doubaoIme.smartOrganize !==
        saved.recognition.doubaoIme.smartOrganize) ||
    llmSettingsChanged(
      current.recognition[current.recognition.provider].llm,
      saved.recognition[saved.recognition.provider].llm
    ) ||
    (current.recognition.provider === "volcengine" &&
      hotwordsText !== savedHotwordsText)
  );
}

async function persistSettings(
  nextSettings: AppSettings,
  providerRevision: number
): Promise<SaveSettingsResult> {
  if (!isTauri()) throw new Error("浏览器预览不保存设置；请在桌面版中操作");
  return await invoke<SaveSettingsResult>("save_settings", {
    providerRevision,
    settings: nextSettings,
  });
}

function microphoneTestError(error: unknown): string {
  const detail = String(error);
  return /permission|notallowederror|denied/iu.test(detail)
    ? "麦克风权限未开启。请在系统设置中允许 VoicePaste 使用麦克风，然后重试。"
    : `麦克风测试失败：${detail}`;
}

function stopCaptureIgnoringErrors(capture: AudioCapture): void {
  void capture.stop().catch(() => {});
}

export type PostProcessMode = "off" | "doubao" | "llm";
const VOICE_INPUT_DEFAULTS = {
  activationMode: DEFAULT_SETTINGS.activationMode,
  microphoneId: DEFAULT_SETTINGS.microphoneId,
  overlayPosition: DEFAULT_SETTINGS.overlayPosition,
  shortcut: DEFAULT_SETTINGS.shortcut,
} satisfies Partial<AppSettings>;

export function useSettingsController({
  activeSection,
  onSelectSection,
  previewOnboarding,
}: {
  activeSection: SettingsSectionId;
  onSelectSection: (section: SettingsSectionId) => void;
  previewOnboarding: boolean;
}) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [providerRevision, setProviderRevision] = useState(-1);
  const providerRevisionRef = useRef(-1);
  const [pendingAction, setPendingAction] = useState<
    RecognitionProvider | "close" | null
  >(null);
  const [switching, setSwitching] = useState(false);
  const [applyingHotwords, setApplyingHotwords] = useState(false);
  const [pendingHotwordApply, setPendingHotwordApply] = useState<{
    words: string[];
    reviewToken: string | null;
  } | null>(null);
  const [cloudConfirmedAt, setCloudConfirmedAt] = useState<string | null>(null);
  const reviewTokenRef = useRef<string | null>(null);
  const [hotwordsText, setHotwordsText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hotwordStatus, setHotwordStatus] = useState<HotwordSyncStatus>(
    DEFAULT_HOTWORD_STATUS
  );
  const [hotwordConflict, setHotwordConflict] =
    useState<HotwordConflict | null>(null);
  const [cloudHotwords, setCloudHotwords] = useState<string[]>([]);
  const [cloudHotwordsVerified, setCloudHotwordsVerified] = useState(false);
  const [checkingHotwords, setCheckingHotwords] = useState(false);
  const [hotwordMessage, setHotwordMessage] = useState<Message>(null);
  const [message, setMessage] = useState<Message>(null);
  const [saveIssue, setSaveIssue] = useState<ServiceIssue | null>(null);
  const [microphoneMessage, setMicrophoneMessage] = useState<Message>(null);
  const [onboardingMessage, setOnboardingMessage] = useState<Message>(null);
  const [editingCustomLlmParameters, setEditingCustomLlmParameters] =
    useState(false);
  const [availableLlmModels, setAvailableLlmModels] = useState<string[]>([]);
  const [loadingLlmModels, setLoadingLlmModels] = useState(false);
  const [llmModelsMessage, setLlmModelsMessage] = useState<Message>(null);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [microphones, setMicrophones] = useState<MicrophoneDevice[]>([]);
  const [testingMicrophone, setTestingMicrophone] = useState(false);
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [recognitionPreviewBusy, setRecognitionPreviewBusy] = useState(false);
  const [diagnostics, setDiagnostics] = useState<SystemDiagnostics | null>(
    null
  );
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);

  const settingsRef = useRef<AppSettings>(DEFAULT_SETTINGS);
  const hotwordsTextRef = useRef("");
  const savedSettingsRef = useRef<AppSettings>(DEFAULT_SETTINGS);
  const savedHotwordsTextRef = useRef("");
  const dirtyRef = useRef<boolean | null>(null);
  const savingRef = useRef(false);
  const microphoneTestRef = useRef<AudioCapture | null>(null);
  const shortcutButtonRef = useRef<HTMLButtonElement | null>(null);
  const onboardingHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const hotwordConflictReturnFocusRef = useRef<HTMLElement | null>(null);
  const getRecognition = useCallback(() => settingsRef.current.recognition, []);
  const recognitionService = useRecognitionService(
    getRecognition,
    providerRevision
  );
  const { acceptAccount } = recognitionService;

  const showMessage = useCallback((nextMessage: NonNullable<Message>) => {
    if (nextMessage.kind === "error") {
      toast.dismiss(SETTINGS_TOAST_ID);
      setMessage(nextMessage);
      return;
    }
    setMessage(null);
    const options = {
      duration: TRANSIENT_MESSAGE_DURATION,
      id: SETTINGS_TOAST_ID,
    };
    if (nextMessage.kind === "success")
      toast.success(nextMessage.text, options);
    else toast.info(nextMessage.text, options);
  }, []);

  const reportPersistentError = useCallback(
    (text: string) => {
      if (settingsRef.current.onboardingCompleted)
        showMessage({ kind: "error", text });
      else setOnboardingMessage({ kind: "error", text });
    },
    [showMessage]
  );

  const syncDirty = useCallback(
    (dirty: boolean) => {
      if (dirtyRef.current === dirty) return;
      dirtyRef.current = dirty;
      if (!isTauri()) return;
      void invoke("set_settings_dirty", { dirty }).catch((error: unknown) => {
        dirtyRef.current = null;
        reportPersistentError(
          `同步未保存状态失败：${safeError(error, settingsRef.current.recognition.volcengine.apiKey, settingsRef.current.recognition[settingsRef.current.recognition.provider].llm.apiKey)}`
        );
      });
    },
    [reportPersistentError]
  );

  const updateSettings = (patch: Partial<AppSettings>) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    syncDirty(
      settingsChanged(
        next,
        hotwordsTextRef.current,
        savedSettingsRef.current,
        savedHotwordsTextRef.current
      )
    );
  };
  const updateSetting = <Key extends keyof AppSettings>(
    key: Key,
    value: AppSettings[Key]
  ) => {
    updateSettings({ [key]: value });
  };
  const updateRecognition = (recognition: RecognitionSettings) => {
    const current = settingsRef.current.recognition;
    if (
      current.provider !== recognition.provider ||
      current.volcengine.apiKey !== recognition.volcengine.apiKey
    )
      recognitionService.invalidate();
    setSaveIssue(null);
    setOnboardingMessage(null);
    updateSetting("recognition", recognition);
  };
  const updateVolcengineSetting = <
    Key extends keyof RecognitionSettings["volcengine"],
  >(
    key: Key,
    value: RecognitionSettings["volcengine"][Key]
  ) => {
    const current = settingsRef.current.recognition;
    updateRecognition({
      ...current,
      volcengine: { ...current.volcengine, [key]: value },
    });
  };
  const updateLlmSetting = <Key extends keyof LlmSettings>(
    key: Key,
    value: LlmSettings[Key]
  ) => {
    const current = settingsRef.current.recognition;
    updateSetting("recognition", {
      ...current,
      [current.provider]: {
        ...current[current.provider],
        llm: { ...current[current.provider].llm, [key]: value },
      },
    });
  };

  const updateHotwordsText = (value: string) => {
    hotwordsTextRef.current = value;
    setHotwordsText(value);
    syncDirty(
      settingsChanged(
        settingsRef.current,
        value,
        savedSettingsRef.current,
        savedHotwordsTextRef.current
      )
    );
  };

  const selectSection = useCallback(
    (section: SettingsSectionId) => {
      toast.dismiss(SETTINGS_TOAST_ID);
      onSelectSection(section);
    },
    [onSelectSection]
  );

  const goToOnboardingStep = (step: number) => {
    setOnboardingMessage(null);
    setMicrophoneMessage(null);
    setOnboardingStep(step);
  };

  const shortcutRecorder = useShortcutRecorder({
    onInvalid: (text) => {
      if (settingsRef.current.onboardingCompleted)
        showMessage({ kind: "error", text });
      else setOnboardingMessage({ kind: "error", text });
      shortcutButtonRef.current?.blur();
    },
    onRecord: (shortcut) => {
      updateSetting("shortcut", shortcut);
      setMessage(null);
      setOnboardingMessage(null);
      shortcutButtonRef.current?.blur();
    },
  });

  const refreshMicrophones = useCallback(async () => {
    try {
      setMicrophones(await AudioCapture.devices());
    } catch (error) {
      setMicrophones([]);
      setMicrophoneMessage({
        kind: "error",
        text: `读取麦克风列表失败：${String(error)}`,
      });
    }
  }, []);

  const refreshDiagnostics = useCallback(async () => {
    if (!isTauri()) return;
    try {
      setDiagnostics(await invoke<SystemDiagnostics>("system_diagnostics"));
    } catch (error) {
      reportPersistentError(
        safeError(
          error,
          settingsRef.current.recognition.volcengine.apiKey,
          settingsRef.current.recognition[
            settingsRef.current.recognition.provider
          ].llm.apiKey
        )
      );
    }
  }, [reportPersistentError]);

  const refreshHotwords = useCallback(async () => {
    const current = settingsRef.current.recognition;
    if (current.provider !== "volcengine") return;
    const { apiKey } = current.volcengine;
    if (apiKey !== savedSettingsRef.current.recognition.volcengine.apiKey) {
      setHotwordMessage({
        kind: "info",
        text: "请先保存 API Key，再检查云端常用词。",
      });
      return;
    }
    if (!isTauri()) {
      setHotwordMessage({
        kind: "error",
        text: "浏览器预览无法检查云端常用词。",
      });
      return;
    }
    setCheckingHotwords(true);
    const revision = providerRevisionRef.current;
    const sourceText = hotwordsTextRef.current;
    const hadDraftEdits = sourceText !== savedHotwordsTextRef.current;
    try {
      const snapshot = await invoke<HotwordSnapshotResult>("refresh_hotwords", {
        providerRevision: revision,
      });
      if (
        revision !== providerRevisionRef.current ||
        apiKey !== savedSettingsRef.current.recognition.volcengine.apiKey
      )
        return;
      setCloudHotwordsVerified(true);
      setHotwordStatus(snapshot.hotwordStatus);
      setCloudHotwords(snapshot.cloudHotwords);
      reviewTokenRef.current = snapshot.reviewToken;
      setCloudConfirmedAt(new Date().toLocaleString());
      for (const ref of [settingsRef, savedSettingsRef]) {
        ref.current = {
          ...ref.current,
          recognition: {
            ...ref.current.recognition,
            volcengine: {
              ...ref.current.recognition.volcengine,
              hotwords: snapshot.confirmedHotwords,
              hotwordDraft: snapshot.hotwordDraft,
            },
          },
        };
      }
      const storedDraft = (
        snapshot.hotwordDraft ?? snapshot.confirmedHotwords
      ).join("\n");
      savedHotwordsTextRef.current = storedDraft;
      if (!hadDraftEdits && hotwordsTextRef.current === sourceText) {
        hotwordsTextRef.current = storedDraft;
        setHotwordsText(storedDraft);
      }
      setSettings(settingsRef.current);
      syncDirty(
        settingsChanged(
          settingsRef.current,
          hotwordsTextRef.current,
          savedSettingsRef.current,
          storedDraft
        )
      );
      setHotwordMessage(null);
    } catch (error) {
      if (
        revision !== providerRevisionRef.current ||
        apiKey !== savedSettingsRef.current.recognition.volcengine.apiKey
      )
        return;
      setHotwordMessage({
        kind: "error",
        text: `无法校验云端词表：${safeError(error, settingsRef.current.recognition.volcengine.apiKey, settingsRef.current.recognition[settingsRef.current.recognition.provider].llm.apiKey)}`,
      });
    } finally {
      if (revision === providerRevisionRef.current) setCheckingHotwords(false);
    }
  }, [syncDirty]);

  const checkForUpdate = useCallback(
    async (showResult: boolean) => {
      if (!isTauri()) {
        if (showResult)
          showMessage({
            kind: "error",
            text: "浏览器预览无法检查桌面应用更新",
          });
        return;
      }
      setCheckingUpdate(true);
      try {
        const update = await invoke<UpdateInfo | null>("check_for_update");
        setUpdateInfo(update);
        if (showResult)
          showMessage({
            kind: "info",
            text: update ? `发现新版本 ${update.version}` : "当前已是最新版本",
          });
      } catch (error) {
        if (showResult)
          showMessage({
            kind: "error",
            text: safeError(
              error,
              settingsRef.current.recognition.volcengine.apiKey,
              settingsRef.current.recognition[
                settingsRef.current.recognition.provider
              ].llm.apiKey
            ),
          });
      } finally {
        setCheckingUpdate(false);
      }
    },
    [showMessage]
  );

  const installUpdate = async () => {
    if (!updateInfo || installingUpdate) return;
    if (
      settingsChanged(
        settingsRef.current,
        hotwordsTextRef.current,
        savedSettingsRef.current,
        savedHotwordsTextRef.current
      )
    ) {
      showMessage({ kind: "error", text: "请先保存当前设置，再安装更新" });
      return;
    }
    setInstallingUpdate(true);
    setMessage(null);
    try {
      const started = await invoke<boolean>("install_update");
      if (!started) setInstallingUpdate(false);
    } catch (error) {
      showMessage({
        kind: "error",
        text: safeError(
          error,
          settingsRef.current.recognition.volcengine.apiKey,
          settingsRef.current.recognition[
            settingsRef.current.recognition.provider
          ].llm.apiKey
        ),
      });
      setInstallingUpdate(false);
    }
  };

  useEffect(() => {
    void refreshMicrophones();
    if (!isTauri()) {
      const previewSettings = {
        ...DEFAULT_SETTINGS,
        onboardingCompleted: !previewOnboarding,
      };
      const previewHotwords =
        previewSettings.recognition.volcengine.hotwords.join("\n");
      settingsRef.current = previewSettings;
      savedSettingsRef.current = previewSettings;
      hotwordsTextRef.current = previewHotwords;
      savedHotwordsTextRef.current = previewHotwords;
      setSettings(previewSettings);
      providerRevisionRef.current = 0;
      setProviderRevision(0);
      setHotwordsText(previewHotwords);
      setHotwordStatus(DEFAULT_HOTWORD_STATUS);
      syncDirty(false);
      setLoading(false);
      return;
    }

    invoke<LoadSettingsResult>("load_settings")
      .then(
        ({
          account: loadedAccount,
          hotwordStatus: loadedHotwordStatus,
          settings: loadedSettings,
          notice,
          providerRevision: loadedRevision,
        }) => {
          const loadedHotwords = (
            loadedSettings.recognition.volcengine.hotwordDraft ??
            loadedSettings.recognition.volcengine.hotwords
          ).join("\n");
          settingsRef.current = loadedSettings;
          savedSettingsRef.current = loadedSettings;
          hotwordsTextRef.current = loadedHotwords;
          savedHotwordsTextRef.current = loadedHotwords;
          setSettings(loadedSettings);
          providerRevisionRef.current = loadedRevision;
          setProviderRevision(loadedRevision);
          setHotwordsText(loadedHotwords);
          if (loadedAccount) acceptAccount(loadedAccount);
          setHotwordStatus(loadedHotwordStatus ?? DEFAULT_HOTWORD_STATUS);
          setCloudHotwords(loadedSettings.recognition.volcengine.hotwords);
          syncDirty(false);
          if (notice) showMessage({ kind: "info", text: notice });
          void refreshDiagnostics();
        }
      )
      .catch((error: unknown) => {
        setOnboardingMessage({ kind: "error", text: safeError(error) });
      })
      .finally(() => {
        setLoading(false);
      });
  }, [
    acceptAccount,
    previewOnboarding,
    refreshDiagnostics,
    refreshMicrophones,
    showMessage,
    syncDirty,
  ]);

  useEffect(() => {
    void checkForUpdate(false);
  }, [checkForUpdate]);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listen<string>("settings-section", (event) => {
      if (event.payload !== "about") return;
      selectSection("about");
    })
      .then((callback) => {
        if (disposed) callback();
        else unlisten = callback;
      })
      .catch((error: unknown) => {
        reportPersistentError(
          safeError(
            error,
            settingsRef.current.recognition.volcengine.apiKey,
            settingsRef.current.recognition[
              settingsRef.current.recognition.provider
            ].llm.apiKey
          )
        );
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [reportPersistentError, selectSection]);

  useEffect(() => {
    if (settings.onboardingCompleted) return;
    window.requestAnimationFrame(() => onboardingHeadingRef.current?.focus());
  }, [onboardingStep, settings.onboardingCompleted]);

  useEffect(
    () => () => {
      toast.dismiss(SETTINGS_TOAST_ID);
      const capture = microphoneTestRef.current;
      microphoneTestRef.current = null;
      if (capture) stopCaptureIgnoringErrors(capture);
    },
    []
  );

  const commitSettings = (nextSettings: AppSettings) => {
    settingsRef.current = nextSettings;
    savedSettingsRef.current = nextSettings;
    setSettings(nextSettings);
    syncDirty(hotwordsTextRef.current !== savedHotwordsTextRef.current);
  };

  const startSaving = () => {
    if (savingRef.current) return false;
    if (
      recognitionService.testing ||
      recognitionService.accountBusy ||
      recognitionPreviewBusy ||
      applyingHotwords ||
      switching ||
      checkingHotwords
    ) {
      reportPersistentError("请先结束识别测试或账号操作，再保存设置。");
      return false;
    }
    savingRef.current = true;
    setSaving(true);
    return true;
  };

  const stopSaving = () => {
    savingRef.current = false;
    setSaving(false);
  };
  const openHotwordConflict = (conflict: HotwordConflict) => {
    const { activeElement } = document;
    if (activeElement instanceof HTMLElement && activeElement !== document.body)
      hotwordConflictReturnFocusRef.current = activeElement;
    setHotwordConflict(conflict);
  };

  const persistAndCommit = async (
    nextSettings: AppSettings
  ): Promise<SavedSettingsResult> => {
    const result = await persistSettings(
      nextSettings,
      providerRevisionRef.current
    );
    if (result.kind !== "saved") throw new Error("普通设置保存不应修改云词库");
    dirtyRef.current = null;
    const keyChanged =
      nextSettings.recognition.provider === "volcengine" &&
      nextSettings.recognition.volcengine.apiKey !==
        savedSettingsRef.current.recognition.volcengine.apiKey;
    const loaded = await invoke<LoadSettingsResult>("load_settings");
    providerRevisionRef.current = loaded.providerRevision;
    setProviderRevision(loaded.providerRevision);
    commitSettings(loaded.settings);
    if (loaded.hotwordStatus) setHotwordStatus(loaded.hotwordStatus);
    if (keyChanged) {
      if (hotwordsTextRef.current === savedHotwordsTextRef.current) {
        const profile = loaded.settings.recognition.volcengine;
        const draft = (profile.hotwordDraft ?? profile.hotwords).join("\n");
        hotwordsTextRef.current = draft;
        savedHotwordsTextRef.current = draft;
        setHotwordsText(draft);
      }
      setCloudHotwords([]);
      setCloudHotwordsVerified(false);
      setCloudConfirmedAt(null);
      reviewTokenRef.current = null;
      setHotwordMessage({
        kind: "info",
        text: "Key 已更换。请先检查云端，再决定是否应用本机词条。",
      });
    }
    return result;
  };

  const finishSuccessfulSave = async (source: "onboarding" | "settings") => {
    if (source === "onboarding") {
      selectSection("shortcut");
      showMessage({
        kind: "success",
        text: "设置完成，按快捷键即可开始听写",
      });
    } else
      showMessage({
        kind: "success",
        text: "已保存",
      });
    await refreshDiagnostics();
  };

  const save = async () => {
    if (!startSaving()) return;
    setMessage(null);
    setOnboardingMessage(null);
    setSaveIssue(null);
    try {
      await persistAndCommit(settingsRef.current);
      await finishSuccessfulSave("settings");
    } catch (error) {
      if (isServiceIssue(error)) {
        setSaveIssue(error);
        reportPersistentError(error.title);
      } else
        reportPersistentError(
          safeError(
            error,
            settingsRef.current.recognition.volcengine.apiKey,
            settingsRef.current.recognition[
              settingsRef.current.recognition.provider
            ].llm.apiKey
          )
        );
    } finally {
      stopSaving();
    }
  };

  const saveHotwordDraft = async (lock = true) => {
    if (lock && !startSaving()) return;
    const sourceText = hotwordsTextRef.current;
    try {
      const words = normalizeHotwords(sourceText, hotwordStatus.limit);
      const revision = providerRevisionRef.current;
      await invoke("save_volcengine_hotword_draft", {
        words,
        providerRevision: revision,
      });
      if (revision !== providerRevisionRef.current) return;
      const text = words.join("\n");
      savedHotwordsTextRef.current = text;
      if (hotwordsTextRef.current === sourceText) {
        hotwordsTextRef.current = text;
        setHotwordsText(text);
      }
      syncDirty(
        settingsChanged(
          settingsRef.current,
          hotwordsTextRef.current,
          savedSettingsRef.current,
          text
        )
      );
      setHotwordMessage({
        kind: "info",
        text: "草稿已存到本机，尚未上传。",
      });
    } finally {
      if (lock) stopSaving();
    }
  };

  const applyHotwords = async (
    words?: string[],
    reviewToken: string | null = null
  ) => {
    if (!startSaving()) return;
    setApplyingHotwords(true);
    const revision = providerRevisionRef.current;
    try {
      const pendingWords =
        words ??
        normalizeHotwords(hotwordsTextRef.current, hotwordStatus.limit);
      await saveHotwordDraft(false);
      setCloudHotwordsVerified(false);
      reviewTokenRef.current = null;
      const result = await invoke<SaveSettingsResult>(
        "apply_volcengine_hotwords",
        {
          words: pendingWords,
          forceOverwrite: reviewToken !== null,
          reviewToken,
          providerRevision: revision,
        }
      );
      if (revision !== providerRevisionRef.current) return;
      if (result.kind === "conflict") {
        setCloudHotwords(result.cloudHotwords);
        setCloudHotwordsVerified(true);
        reviewTokenRef.current = result.reviewToken;
        openHotwordConflict({
          cloudHotwords: result.cloudHotwords,
          words: pendingWords,
          reviewToken: result.reviewToken,
        });
        return;
      }
      if (result.hotwordStatus) setHotwordStatus(result.hotwordStatus);
      setCloudHotwords(result.cloudHotwords);
      setCloudHotwordsVerified(true);
      setCloudConfirmedAt(new Date().toLocaleString());
      const text = result.cloudHotwords.join("\n");
      savedHotwordsTextRef.current = text;
      hotwordsTextRef.current = text;
      setHotwordsText(text);
      for (const ref of [settingsRef, savedSettingsRef]) {
        ref.current = {
          ...ref.current,
          recognition: {
            ...ref.current.recognition,
            volcengine: {
              ...ref.current.recognition.volcengine,
              hotwords: result.cloudHotwords,
              hotwordDraft: null,
            },
          },
        };
      }
      setSettings(settingsRef.current);
      dirtyRef.current = null;
      syncDirty(
        settingsChanged(
          settingsRef.current,
          text,
          savedSettingsRef.current,
          text
        )
      );
      setHotwordMessage({
        kind: "success",
        text: hotwordActionMessage(
          result.hotwordAction,
          result.cloudHotwords.length
        ),
      });
    } catch (error) {
      if (revision !== providerRevisionRef.current) return;
      try {
        const loaded = await invoke<LoadSettingsResult>("load_settings");
        if (revision === providerRevisionRef.current && loaded.hotwordStatus)
          setHotwordStatus(loaded.hotwordStatus);
      } catch {
        setHotwordMessage({
          kind: "error",
          text: "无法读取提交状态。草稿已保留，请稍后检查云端。",
        });
      }
      setHotwordMessage({
        kind: "error",
        text: `${safeError(error, settingsRef.current.recognition.volcengine.apiKey)}。草稿已保留；请求可能已发送，请先检查云端再重试。`,
      });
    } finally {
      setApplyingHotwords(false);
      stopSaving();
    }
  };

  const resolveHotwordConflict = (useCloud: boolean) => {
    const conflict = hotwordConflict;
    if (!conflict) return;
    setHotwordConflict(null);
    if (useCloud) {
      updateHotwordsText(
        replayHotwordChanges(
          savedSettingsRef.current.recognition.volcengine.hotwords,
          conflict.words,
          conflict.cloudHotwords
        ).join("\n")
      );
      setHotwordMessage({
        kind: "info",
        text: "已在云端词表基础上合并本机改动，请检查后再应用。",
      });
      return;
    }
    setPendingHotwordApply({
      words: conflict.words,
      reviewToken: conflict.reviewToken,
    });
  };

  const performAction = async (
    action: RecognitionProvider | "close",
    keep: boolean
  ) => {
    if (!startSaving()) return;
    try {
      if (keep) {
        if (
          settingsRef.current.recognition.provider === "volcengine" &&
          hotwordsTextRef.current !== savedHotwordsTextRef.current
        )
          await saveHotwordDraft(false);
        await persistAndCommit(settingsRef.current);
      }
      if (action === "close") {
        if (!keep) {
          settingsRef.current = savedSettingsRef.current;
          setSettings(savedSettingsRef.current);
          hotwordsTextRef.current = savedHotwordsTextRef.current;
          setHotwordsText(savedHotwordsTextRef.current);
        }
        syncDirty(false);
        await invoke("set_settings_dirty", { dirty: false });
        setPendingAction(null);
        await invoke("close_settings");
        return;
      }
      setSwitching(true);
      const loaded = await invoke<LoadSettingsResult>(
        "select_recognition_provider",
        { provider: action }
      );
      providerRevisionRef.current = loaded.providerRevision;
      setProviderRevision(loaded.providerRevision);
      settingsRef.current = loaded.settings;
      savedSettingsRef.current = loaded.settings;
      setSettings(loaded.settings);
      const profile = loaded.settings.recognition.volcengine;
      const draft =
        action === "volcengine"
          ? (profile.hotwordDraft ?? profile.hotwords).join("\n")
          : "";
      hotwordsTextRef.current = draft;
      savedHotwordsTextRef.current = draft;
      setHotwordsText(draft);
      setHotwordStatus(loaded.hotwordStatus ?? DEFAULT_HOTWORD_STATUS);
      setCloudHotwords(action === "volcengine" ? profile.hotwords : []);
      setCloudHotwordsVerified(false);
      setCloudConfirmedAt(null);
      reviewTokenRef.current = null;
      setHotwordConflict(null);
      setHotwordMessage(null);
      setAvailableLlmModels([]);
      setLlmModelsMessage(null);
      setEditingCustomLlmParameters(false);
      setSaveIssue(null);
      setOnboardingMessage(null);
      setMessage(null);
      if (loaded.account) acceptAccount(loaded.account);
      syncDirty(false);
      setPendingAction(null);
      if (loaded.notice) showMessage({ kind: "info", text: loaded.notice });
    } catch (error) {
      reportPersistentError(
        safeError(
          error,
          settingsRef.current.recognition.volcengine.apiKey,
          settingsRef.current.recognition[
            settingsRef.current.recognition.provider
          ].llm.apiKey
        )
      );
    } finally {
      setSwitching(false);
      stopSaving();
    }
  };

  const selectProvider = (provider: RecognitionProvider) => {
    if (provider === settingsRef.current.recognition.provider) return;
    if (
      settingsChanged(
        settingsRef.current,
        hotwordsTextRef.current,
        savedSettingsRef.current,
        savedHotwordsTextRef.current
      )
    )
      setPendingAction(provider);
    else void performAction(provider, false);
  };

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen("settings-close-requested", () => {
      if (savingRef.current) {
        reportPersistentError("正在保存或应用词库，请等待操作结束再关闭。");
      } else if (
        settingsChanged(
          settingsRef.current,
          hotwordsTextRef.current,
          savedSettingsRef.current,
          savedHotwordsTextRef.current
        )
      ) {
        setPendingAction("close");
      } else {
        void invoke("close_settings").catch((error: unknown) => {
          reportPersistentError(safeError(error));
        });
      }
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((error: unknown) => {
        reportPersistentError(safeError(error));
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [reportPersistentError]);

  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLocaleLowerCase() !== "s"
      )
        return;
      event.preventDefault();
      if (
        activeSection === "dictionary" &&
        settingsRef.current.recognition.provider === "volcengine"
      )
        void saveHotwordDraft().catch((error: unknown) => {
          reportPersistentError(safeError(error));
        });
      else void save();
    };
    window.addEventListener("keydown", handleSaveShortcut);
    return () => {
      window.removeEventListener("keydown", handleSaveShortcut);
    };
  });

  const voiceInputIsDefault = (
    Object.keys(VOICE_INPUT_DEFAULTS) as (keyof typeof VOICE_INPUT_DEFAULTS)[]
  ).every((key) => settings[key] === VOICE_INPUT_DEFAULTS[key]);
  const resetVoiceInput = () => {
    setMicrophoneMessage(null);
    updateSettings(VOICE_INPUT_DEFAULTS);
  };

  const discardChanges = () => {
    const saved = savedSettingsRef.current;
    const current = settingsRef.current.recognition;
    if (
      current.provider !== saved.recognition.provider ||
      current.volcengine.apiKey !== saved.recognition.volcengine.apiKey
    )
      recognitionService.invalidate();
    setSaveIssue(null);
    setMessage(null);
    setAvailableLlmModels([]);
    setLlmModelsMessage(null);
    updateSettings(saved);
  };

  const postProcessMode: PostProcessMode =
    settings.recognition.provider === "doubaoIme" &&
    settings.recognition.doubaoIme.smartOrganize
      ? "doubao"
      : settings.recognition[settings.recognition.provider].llm.enabled
        ? "llm"
        : "off";
  const setPostProcessMode = (mode: PostProcessMode) => {
    const current = settingsRef.current.recognition;
    const llmEnabled = mode === "llm";
    updateSetting(
      "recognition",
      current.provider === "doubaoIme"
        ? {
            ...current,
            doubaoIme: {
              ...current.doubaoIme,
              smartOrganize: mode === "doubao",
              llm: { ...current.doubaoIme.llm, enabled: llmEnabled },
            },
          }
        : {
            ...current,
            volcengine: {
              ...current.volcengine,
              llm: { ...current.volcengine.llm, enabled: llmEnabled },
            },
          }
    );
  };

  const startMicrophoneTest = async () => {
    if (microphoneTestRef.current) return;
    setTestingMicrophone(true);
    setMicrophoneLevel(0);
    setMicrophoneMessage(null);
    const capture = new AudioCapture(
      settingsRef.current.microphoneId,
      setMicrophoneLevel,
      (error) => {
        if (microphoneTestRef.current !== capture) return;
        microphoneTestRef.current = null;
        setMicrophoneLevel(0);
        setMicrophoneMessage({
          kind: "error",
          text: microphoneTestError(error),
        });
        setTestingMicrophone(false);
        stopCaptureIgnoringErrors(capture);
      },
      (reason) => {
        if (microphoneTestRef.current !== capture) return;
        microphoneTestRef.current = null;
        setMicrophoneLevel(0);
        setMicrophoneMessage({ kind: "info", text: reason });
        setTestingMicrophone(false);
        stopCaptureIgnoringErrors(capture);
      }
    );
    microphoneTestRef.current = capture;
    try {
      await capture.start();
    } catch (error) {
      if (microphoneTestRef.current === capture)
        microphoneTestRef.current = null;
      await capture.stop().catch(() => {});
      setMicrophoneMessage({ kind: "error", text: microphoneTestError(error) });
      setTestingMicrophone(false);
    }
  };

  const stopMicrophoneTest = async () => {
    const capture = microphoneTestRef.current;
    if (!capture) return;
    microphoneTestRef.current = null;
    try {
      await capture.stop();
      await Promise.all([refreshMicrophones(), refreshDiagnostics()]);
      setMicrophoneMessage(null);
    } catch (error) {
      setMicrophoneMessage({
        kind: "error",
        text: `停止麦克风测试失败：${String(error)}`,
      });
    } finally {
      setMicrophoneLevel(0);
      setTestingMicrophone(false);
    }
  };

  const toggleMicrophoneTest = () => {
    void (microphoneTestRef.current
      ? stopMicrophoneTest()
      : startMicrophoneTest());
  };

  useEffect(() => {
    if (activeSection === "shortcut") return;
    const capture = microphoneTestRef.current;
    if (!capture) return;
    microphoneTestRef.current = null;
    stopCaptureIgnoringErrors(capture);
    setMicrophoneLevel(0);
    setTestingMicrophone(false);
    setMicrophoneMessage({
      kind: "info",
      text: "已离开听写页面，麦克风测试已停止",
    });
  }, [activeSection]);

  const finishOnboarding = async () => {
    if (!recognitionService.verified) {
      goToOnboardingStep(1);
      setOnboardingMessage({
        kind: "error",
        text: "识别服务或账号状态已变化，请重新测试。",
      });
      return;
    }
    if (!startSaving()) return;
    setOnboardingMessage(null);
    setSaveIssue(null);
    try {
      await persistAndCommit({
        ...settingsRef.current,
        onboardingCompleted: true,
      });
      await finishSuccessfulSave("onboarding");
    } catch (error) {
      if (isServiceIssue(error)) {
        setOnboardingMessage(null);
        setSaveIssue(error);
      } else
        setOnboardingMessage({
          kind: "error",
          text: safeError(
            error,
            settingsRef.current.recognition.volcengine.apiKey
          ),
        });
    } finally {
      stopSaving();
    }
  };

  const openConsole = async () => {
    try {
      if (isTauri()) await invoke("open_api_key_console");
      else window.open(CONSOLE_URL, "_blank", "noopener,noreferrer");
    } catch (error) {
      reportPersistentError(
        safeError(
          error,
          settingsRef.current.recognition.volcengine.apiKey,
          settingsRef.current.recognition[
            settingsRef.current.recognition.provider
          ].llm.apiKey
        )
      );
    }
  };
  const fetchLlmModels = async () => {
    const { apiKey, baseUrl } =
      settingsRef.current.recognition[settingsRef.current.recognition.provider]
        .llm;
    const revision = providerRevisionRef.current;
    setLlmModelsMessage(null);
    if (!baseUrl.trim()) {
      setLlmModelsMessage({
        kind: "error",
        text: "请先填写 API 基础地址。",
      });
      return;
    }
    setLoadingLlmModels(true);
    try {
      if (!isTauri()) throw new Error("获取模型仅在 VoicePaste 桌面版中可用");
      const models = await invoke<string[]>("list_llm_models", {
        apiKey,
        baseUrl,
        providerRevision: revision,
      });
      if (
        revision !== providerRevisionRef.current ||
        apiKey !==
          settingsRef.current.recognition[
            settingsRef.current.recognition.provider
          ].llm.apiKey ||
        baseUrl !==
          settingsRef.current.recognition[
            settingsRef.current.recognition.provider
          ].llm.baseUrl
      )
        return;
      setAvailableLlmModels(models);
      setLlmModelsMessage({
        kind: "success",
        text: `获取到 ${models.length} 个模型`,
      });
    } catch (error) {
      if (
        revision !== providerRevisionRef.current ||
        apiKey !==
          settingsRef.current.recognition[
            settingsRef.current.recognition.provider
          ].llm.apiKey ||
        baseUrl !==
          settingsRef.current.recognition[
            settingsRef.current.recognition.provider
          ].llm.baseUrl
      )
        return;
      setAvailableLlmModels([]);
      setLlmModelsMessage({
        kind: "error",
        text: safeError(error, apiKey),
      });
    } finally {
      if (revision === providerRevisionRef.current) setLoadingLlmModels(false);
    }
  };

  const runAboutAction = async (
    command: "open_log_dir" | "copy_diagnostics",
    successText?: string
  ) => {
    setMessage(null);
    try {
      if (!isTauri()) throw new Error("此操作仅在 VoicePaste 桌面版中可用");
      await invoke(command);
      if (successText) showMessage({ kind: "success", text: successText });
    } catch (error) {
      showMessage({
        kind: "error",
        text: safeError(
          error,
          settingsRef.current.recognition.volcengine.apiKey,
          settingsRef.current.recognition[
            settingsRef.current.recognition.provider
          ].llm.apiKey
        ),
      });
    }
  };

  const openProductLink = async (target: ProductLinkTarget) => {
    setMessage(null);
    try {
      if (!isTauri()) throw new Error("此链接仅在 VoicePaste 桌面版中打开");
      await invoke("open_product_link", { target });
    } catch (error) {
      showMessage({
        kind: "error",
        text: safeError(
          error,
          settingsRef.current.recognition.volcengine.apiKey,
          settingsRef.current.recognition[
            settingsRef.current.recognition.provider
          ].llm.apiKey
        ),
      });
    }
  };

  const microphoneOptions = [
    { label: "系统默认麦克风", value: DEFAULT_MICROPHONE_VALUE },
    ...microphones.map((device) => ({
      label: device.label,
      value: device.id,
    })),
  ];
  const isSettingChanged = (key: keyof AppSettings) =>
    settings[key] !== savedSettingsRef.current[key];
  const isLlmSettingChanged = (key: keyof LlmSettings) =>
    settings.recognition[settings.recognition.provider].llm[key] !==
    savedSettingsRef.current.recognition[
      savedSettingsRef.current.recognition.provider
    ].llm[key];
  const llmChanged = llmSettingsChanged(
    settings.recognition[settings.recognition.provider].llm,
    savedSettingsRef.current.recognition[
      savedSettingsRef.current.recognition.provider
    ].llm
  );
  const hotwordsChanged = hotwordsText !== savedHotwordsTextRef.current;
  const localHotwords = uniqueHotwords(hotwordsText);
  const apiKeyChanged =
    settings.recognition.volcengine.apiKey !==
    savedSettingsRef.current.recognition.volcengine.apiKey;
  const recognitionChanged = recognitionConfigurationChanged(
    settings.recognition,
    savedSettingsRef.current.recognition
  );
  const cloudChanges = hotwordDiff(localHotwords, cloudHotwords);
  const hasUnsavedChanges = settingsChanged(
    settings,
    hotwordsText,
    savedSettingsRef.current,
    savedHotwordsTextRef.current
  );
  const hasUnsavedSettings = settingsChanged(
    settings,
    "",
    savedSettingsRef.current,
    ""
  );
  const isSectionChanged = (section: SettingsSectionId) => {
    if (section === "shortcut")
      return (
        isSettingChanged("activationMode") ||
        isSettingChanged("shortcut") ||
        isSettingChanged("microphoneId") ||
        isSettingChanged("overlayPosition")
      );
    if (section === "recognition") return recognitionChanged;
    if (section === "dictionary")
      return settings.recognition.provider === "volcengine" && hotwordsChanged;
    if (section === "processing")
      return (
        llmChanged ||
        (settings.recognition.provider === "doubaoIme" &&
          settings.recognition.doubaoIme.smartOrganize !==
            savedSettingsRef.current.recognition.doubaoIme.smartOrganize)
      );
    if (section === "general")
      return (
        isSettingChanged("launchAtStartup") ||
        isSettingChanged("openSettingsOnStartup")
      );
    return false;
  };
  const errorText = (error: unknown) =>
    safeError(
      error,
      settingsRef.current.recognition.volcengine.apiKey,
      settingsRef.current.recognition[settingsRef.current.recognition.provider]
        .llm.apiKey
    );
  const { llm } = settings.recognition[settings.recognition.provider];
  const { llm: savedLlm } =
    savedSettingsRef.current.recognition[
      savedSettingsRef.current.recognition.provider
    ];

  return {
    activeSection,
    applyHotwords,
    applyingHotwords,
    apiKeyChanged,
    availableLlmModels,
    checkForUpdate,
    checkingHotwords,
    checkingUpdate,
    cloudChanges,
    cloudConfirmedAt,
    cloudHotwords,
    cloudHotwordsVerified,
    diagnostics,
    discardChanges,
    editingCustomLlmParameters,
    errorText,
    fetchLlmModels,
    finishOnboarding,
    goToOnboardingStep,
    hasUnsavedChanges,
    hasUnsavedSettings,
    hotwordConflict,
    hotwordConflictReturnFocusRef,
    hotwordMessage,
    hotwordStatus,
    hotwordsChanged,
    hotwordsText,
    installUpdate,
    installingUpdate,
    isLlmSettingChanged,
    isSectionChanged,
    isSettingChanged,
    llm,
    llmChanged,
    llmModelsMessage,
    loading,
    loadingLlmModels,
    localHotwords,
    message,
    microphoneLevel,
    microphoneMessage,
    microphoneOptions,
    microphones,
    onboardingHeadingRef,
    onboardingMessage,
    onboardingStep,
    openConsole,
    openHotwordConflict,
    openProductLink,
    pendingAction,
    pendingHotwordApply,
    performAction,
    postProcessMode,
    providerRevision,
    recognitionChanged,
    recognitionPreviewBusy,
    recognitionService,
    refreshDiagnostics,
    refreshHotwords,
    resetVoiceInput,
    resolveHotwordConflict,
    reviewTokenRef,
    runAboutAction,
    saveIssue,
    save,
    saveHotwordDraft,
    savedLlm,
    savedSettingsRef,
    saving,
    selectProvider,
    selectSection,
    setAvailableLlmModels,
    setEditingCustomLlmParameters,
    setHotwordConflict,
    setHotwordMessage,
    setLlmModelsMessage,
    setMessage,
    setMicrophoneMessage,
    setOnboardingMessage,
    setPendingAction,
    setPendingHotwordApply,
    setPostProcessMode,
    setRecognitionPreviewBusy,
    settings,
    shortcutButtonRef,
    shortcutRecorder,
    showMessage,
    switching,
    testingMicrophone,
    toggleMicrophoneTest,
    updateHotwordsText,
    updateLlmSetting,
    updateRecognition,
    updateSetting,
    updateInfo,
    updateVolcengineSetting,
    voiceInputIsDefault,
  };
}

export type SettingsController = ReturnType<typeof useSettingsController>;

export const SettingsContext = createContext<SettingsController | null>(null);

export function useSettings(): SettingsController {
  const controller = useContext(SettingsContext);
  if (!controller)
    throw new Error("useSettings must be used inside the settings layout");
  return controller;
}
