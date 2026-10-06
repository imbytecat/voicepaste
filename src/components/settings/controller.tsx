import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import type { Message } from "@/components/settings/kit";
import { settingsQueries } from "@/components/settings/queries";
import { useRecognitionService } from "@/components/useRecognitionService";
import { recognitionConfigurationChanged, safeError } from "@/recognition";
import type { SettingsSectionId } from "@/routes/-settings-navigation";
import { useShortcutRecorder } from "@/shortcut";
import { DEFAULT_SETTINGS } from "@/types";
import type {
  AccountStatus,
  AppSettings,
  HotwordSyncResult,
  LlmSettings,
  RecognitionProvider,
  RecognitionSettings,
  ServiceIssueLink,
  VolcengineSettings,
} from "@/types";

export const DEFAULT_MICROPHONE_VALUE = "__voicepaste_system_default__";

interface LoadSettingsResult {
  settings: AppSettings;
  account: AccountStatus | null;
  providerRevision: number;
  notice?: string;
}
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

function settingsChanged(current: AppSettings, saved: AppSettings): boolean {
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
    )
  );
}

async function persistSettings(
  nextSettings: AppSettings,
  providerRevision: number
): Promise<"keyring" | "removed"> {
  if (!isTauri()) throw new Error("浏览器预览不保存设置；请在桌面版中操作");
  return await invoke<"keyring" | "removed">("save_settings", {
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  // A page-level error belongs to the page that raised it; leaving the page
  // dismisses it (state adjusted during render, so no stale frame shows).
  const [messageSection, setMessageSection] = useState(activeSection);
  if (messageSection !== activeSection) {
    setMessageSection(activeSection);
    setMessage(null);
  }
  // Save and dialog failures render next to the control that caused them,
  // and startup notices persist until dismissed: a toast in a hidden window is lost.
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingActionError, setPendingActionError] = useState<string | null>(
    null
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [microphoneMessage, setMicrophoneMessage] = useState<Message>(null);
  const [onboardingMessage, setOnboardingMessage] = useState<Message>(null);
  const [editingCustomLlmParameters, setEditingCustomLlmParameters] =
    useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [testingMicrophone, setTestingMicrophone] = useState(false);
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [recognitionPreviewBusy, setRecognitionPreviewBusy] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);

  const queryClient = useQueryClient();
  const microphonesQuery = useQuery(settingsQueries.microphones());
  const microphones = microphonesQuery.data ?? [];
  const diagnosticsQuery = useQuery(settingsQueries.diagnostics());
  const diagnostics = diagnosticsQuery.data ?? null;
  const updateQuery = useQuery(settingsQueries.update());
  const updateInfo = updateQuery.data ?? null;
  const { llm: currentLlm } =
    settings.recognition[settings.recognition.provider];
  const llmModelsQuery = useQuery(
    settingsQueries.llmModels({
      apiKey: currentLlm.apiKey,
      baseUrl: currentLlm.baseUrl,
      provider: settings.recognition.provider,
      providerRevision,
    })
  );

  const settingsRef = useRef<AppSettings>(DEFAULT_SETTINGS);
  const savedSettingsRef = useRef<AppSettings>(DEFAULT_SETTINGS);
  const dirtyRef = useRef<boolean | null>(null);
  const savingRef = useRef(false);
  const microphoneTestRef = useRef<AudioCapture | null>(null);
  const shortcutButtonRef = useRef<HTMLButtonElement | null>(null);
  const onboardingHeadingRef = useRef<HTMLHeadingElement | null>(null);
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
    syncDirty(settingsChanged(next, savedSettingsRef.current));
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

  /** Word-list edits persist through their own commands, so they land in
   * both the working and the saved copy and never mark settings dirty. */
  const acceptVolcengineWords = (
    patch: Pick<Partial<VolcengineSettings>, "hotwords" | "hotwordsEnabled">
  ) => {
    for (const ref of [settingsRef, savedSettingsRef]) {
      const { recognition } = ref.current;
      ref.current = {
        ...ref.current,
        recognition: {
          ...recognition,
          volcengine: { ...recognition.volcengine, ...patch },
        },
      };
    }
    setSettings(settingsRef.current);
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
    await queryClient.invalidateQueries({
      queryKey: settingsQueries.microphones().queryKey,
    });
  }, [queryClient]);

  const refreshDiagnostics = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: settingsQueries.diagnostics().queryKey,
    });
  }, [queryClient]);

  const checkForUpdate = async () => {
    if (!isTauri()) {
      showMessage({ kind: "error", text: "浏览器预览无法检查桌面应用更新" });
      return;
    }
    const { data, error } = await updateQuery.refetch();
    showMessage(
      error
        ? { kind: "error", text: errorText(error) }
        : {
            kind: "info",
            text: data ? `发现新版本 ${data.version}` : "当前已是最新版本",
          }
    );
  };

  const installUpdate = async () => {
    if (!updateInfo || installingUpdate) return;
    if (settingsChanged(settingsRef.current, savedSettingsRef.current)) {
      showMessage({ kind: "error", text: "请先保存当前设置，再安装更新" });
      return;
    }
    setInstallingUpdate(true);
    setMessage(null);
    try {
      await invoke("install_update");
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
    if (!isTauri()) {
      const previewSettings = {
        ...DEFAULT_SETTINGS,
        onboardingCompleted: !previewOnboarding,
      };
      settingsRef.current = previewSettings;
      savedSettingsRef.current = previewSettings;
      setSettings(previewSettings);
      providerRevisionRef.current = 0;
      setProviderRevision(0);
      syncDirty(false);
      setLoading(false);
      return;
    }

    invoke<LoadSettingsResult>("load_settings")
      .then(
        ({
          account: loadedAccount,
          settings: loadedSettings,
          notice: loadedNotice,
          providerRevision: loadedRevision,
        }) => {
          settingsRef.current = loadedSettings;
          savedSettingsRef.current = loadedSettings;
          setSettings(loadedSettings);
          providerRevisionRef.current = loadedRevision;
          setProviderRevision(loadedRevision);
          if (loadedAccount) acceptAccount(loadedAccount);
          syncDirty(false);
          if (loadedNotice) setNotice(loadedNotice);
        }
      )
      .catch((error: unknown) => {
        setOnboardingMessage({ kind: "error", text: safeError(error) });
      })
      .finally(() => {
        setLoading(false);
      });
  }, [acceptAccount, previewOnboarding, syncDirty]);

  const { refetch: refetchUpdate } = updateQuery;
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    // The tray's "检查更新…" lands here; the cached result may be days old.
    listen<string>("settings-section", (event) => {
      if (event.payload !== "about") return;
      selectSection("about");
      void refetchUpdate();
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
  }, [refetchUpdate, reportPersistentError, selectSection]);

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
    syncDirty(false);
  };

  const startSaving = () => {
    if (savingRef.current) return false;
    if (
      recognitionService.testing ||
      recognitionService.accountBusy ||
      recognitionPreviewBusy ||
      switching
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

  const hotwordSync = useMutation({
    mutationFn: async (revision: number) =>
      await invoke<HotwordSyncResult>("sync_volcengine_hotwords", {
        providerRevision: revision,
      }),
    onSuccess: (result, revision) => {
      if (revision === providerRevisionRef.current)
        acceptVolcengineWords({ hotwords: result.hotwords });
    },
  });
  const { mutate: mutateHotwordSync } = hotwordSync;
  const hotwordSyncTimerRef = useRef(0);
  const [hotwordSyncQueued, setHotwordSyncQueued] = useState(false);
  /** Syncs the saved word list with the cloud; a no-op until a key is saved. */
  const syncHotwords = useCallback(() => {
    window.clearTimeout(hotwordSyncTimerRef.current);
    setHotwordSyncQueued(false);
    const { recognition } = savedSettingsRef.current;
    if (
      !isTauri() ||
      recognition.provider !== "volcengine" ||
      !recognition.volcengine.apiKey
    )
      return;
    mutateHotwordSync(providerRevisionRef.current);
  }, [mutateHotwordSync]);
  useEffect(
    () => () => {
      window.clearTimeout(hotwordSyncTimerRef.current);
    },
    []
  );

  const editHotwords = async (change: {
    add?: string[];
    remove?: string[];
    enabled?: boolean;
  }) => {
    const revision = providerRevisionRef.current;
    const hotwords = await invoke<string[]>("edit_volcengine_hotwords", {
      add: change.add ?? [],
      remove: change.remove ?? [],
      enabled: change.enabled ?? null,
      providerRevision: revision,
    });
    if (revision !== providerRevisionRef.current) return;
    acceptVolcengineWords(
      change.enabled === undefined
        ? { hotwords }
        : { hotwords, hotwordsEnabled: change.enabled }
    );
    if (change.add?.length || change.remove?.length) {
      // Coalesce a burst of edits into one cloud write.
      window.clearTimeout(hotwordSyncTimerRef.current);
      setHotwordSyncQueued(true);
      hotwordSyncTimerRef.current = window.setTimeout(syncHotwords, 800);
    }
  };

  const persistAndCommit = async (nextSettings: AppSettings) => {
    await persistSettings(nextSettings, providerRevisionRef.current);
    dirtyRef.current = null;
    const keyChanged =
      nextSettings.recognition.provider === "volcengine" &&
      nextSettings.recognition.volcengine.apiKey !==
        savedSettingsRef.current.recognition.volcengine.apiKey;
    const loaded = await invoke<LoadSettingsResult>("load_settings");
    providerRevisionRef.current = loaded.providerRevision;
    setProviderRevision(loaded.providerRevision);
    commitSettings(loaded.settings);
    // A new key is a new account: merge the word list into it right away.
    if (keyChanged) syncHotwords();
  };

  /**
   * Onboarding has no save bar, so its connection test saves the recognition
   * draft first: what passes the test is what dictation will use.
   */
  const testRecognition = async () => {
    const { current } = settingsRef;
    if (
      !current.onboardingCompleted &&
      recognitionConfigurationChanged(
        current.recognition,
        savedSettingsRef.current.recognition
      )
    ) {
      if (!startSaving()) return;
      try {
        await persistAndCommit(current);
      } catch (error) {
        setOnboardingMessage({
          kind: "error",
          text: safeError(error, current.recognition.volcengine.apiKey),
        });
        return;
      } finally {
        stopSaving();
      }
    }
    await recognitionService.testConnection(providerRevisionRef.current);
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
    setSaveError(null);
    try {
      await persistAndCommit(settingsRef.current);
      await finishSuccessfulSave("settings");
    } catch (error) {
      const text = safeError(
        error,
        settingsRef.current.recognition.volcengine.apiKey,
        settingsRef.current.recognition[
          settingsRef.current.recognition.provider
        ].llm.apiKey
      );
      if (settingsRef.current.onboardingCompleted) setSaveError(text);
      else setOnboardingMessage({ kind: "error", text });
    } finally {
      stopSaving();
    }
  };

  /** A hidden window keeps its React state: drop what would be stale on reopen. */
  const { invalidate: invalidateRecognition } = recognitionService;
  const closeWindow = useCallback(async () => {
    await invoke("close_settings");
    setMessage(null);
    setMicrophoneMessage(null);
    invalidateRecognition();
  }, [invalidateRecognition]);

  const cancelPendingAction = () => {
    setPendingAction(null);
    setPendingActionError(null);
  };

  const performAction = async (
    action: RecognitionProvider | "close",
    keep: boolean
  ) => {
    if (!startSaving()) return;
    setPendingActionError(null);
    try {
      if (keep) await persistAndCommit(settingsRef.current);
      else {
        settingsRef.current = savedSettingsRef.current;
        setSettings(savedSettingsRef.current);
        setSaveError(null);
        syncDirty(false);
        // The backend refuses to switch while it believes edits are pending.
        await invoke("set_settings_dirty", { dirty: false });
      }
      if (action === "close") {
        setPendingAction(null);
        await closeWindow();
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
      hotwordSync.reset();
      setEditingCustomLlmParameters(false);
      setOnboardingMessage(null);
      setMessage(null);
      if (loaded.account) acceptAccount(loaded.account);
      syncDirty(false);
      setPendingAction(null);
      if (loaded.notice) setNotice(loaded.notice);
    } catch (error) {
      const text = safeError(
        error,
        settingsRef.current.recognition.volcengine.apiKey,
        settingsRef.current.recognition[
          settingsRef.current.recognition.provider
        ].llm.apiKey
      );
      if (pendingAction) setPendingActionError(text);
      else reportPersistentError(text);
    } finally {
      setSwitching(false);
      stopSaving();
    }
  };

  const selectProvider = (provider: RecognitionProvider) => {
    if (provider === settingsRef.current.recognition.provider) return;
    if (settingsChanged(settingsRef.current, savedSettingsRef.current))
      setPendingAction(provider);
    else void performAction(provider, false);
  };

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen("settings-close-requested", () => {
      if (savingRef.current) {
        reportPersistentError("正在保存设置，请等待保存结束再关闭。");
      } else if (
        settingsChanged(settingsRef.current, savedSettingsRef.current)
      ) {
        setPendingAction("close");
      } else {
        void closeWindow().catch((error: unknown) => {
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
  }, [closeWindow, reportPersistentError]);

  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLocaleLowerCase() !== "s"
      )
        return;
      event.preventDefault();
      if (
        settingsRef.current.onboardingCompleted &&
        settingsChanged(settingsRef.current, savedSettingsRef.current)
      )
        void save();
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
    setSaveError(null);
    setMessage(null);
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
    try {
      await persistAndCommit({
        ...settingsRef.current,
        onboardingCompleted: true,
      });
      await finishSuccessfulSave("onboarding");
    } catch (error) {
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
    await openProductLink("apiKeyConsole");
  };
  // The model list is keyed by address and key (see settingsQueries.llmModels),
  // so edits drop a stale list on their own; fetching is always on request.
  const fetchLlmModels = () => {
    void llmModelsQuery.refetch();
  };
  const availableLlmModels = llmModelsQuery.data ?? [];
  const loadingLlmModels = llmModelsQuery.isFetching;
  const llmModelsMessage: Message = llmModelsQuery.error
    ? {
        kind: "error",
        text: safeError(llmModelsQuery.error, currentLlm.apiKey),
      }
    : llmModelsQuery.data
      ? { kind: "success", text: `获取到 ${llmModelsQuery.data.length} 个模型` }
      : null;
  const microphoneNotice: Message =
    microphoneMessage ??
    (microphonesQuery.error
      ? {
          kind: "error",
          text: `读取麦克风列表失败：${String(microphonesQuery.error)}`,
        }
      : null);

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
  const apiKeyChanged =
    settings.recognition.volcengine.apiKey !==
    savedSettingsRef.current.recognition.volcengine.apiKey;
  const recognitionChanged = recognitionConfigurationChanged(
    settings.recognition,
    savedSettingsRef.current.recognition
  );
  const hasUnsavedChanges = settingsChanged(settings, savedSettingsRef.current);
  const isSectionChanged = (section: SettingsSectionId) => {
    if (section === "shortcut")
      return (
        isSettingChanged("activationMode") ||
        isSettingChanged("shortcut") ||
        isSettingChanged("microphoneId") ||
        isSettingChanged("overlayPosition")
      );
    if (section === "recognition") return recognitionChanged;
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

  return {
    activeSection,
    apiKeyChanged,
    availableLlmModels,
    checkForUpdate,
    checkingUpdate: updateQuery.isFetching,
    diagnostics,
    discardChanges,
    editingCustomLlmParameters,
    errorText,
    fetchLlmModels,
    editHotwords,
    finishOnboarding,
    goToOnboardingStep,
    hasUnsavedChanges,
    hotwordSync,
    hotwordSyncQueued,
    installUpdate,
    installingUpdate,
    isLlmSettingChanged,
    isSectionChanged,
    isSettingChanged,
    llm,
    llmModelsMessage,
    loading,
    loadingLlmModels,
    message,
    notice,
    dismissNotice: () => {
      setNotice(null);
    },
    microphoneLevel,
    microphoneMessage: microphoneNotice,
    microphoneOptions,
    microphones,
    onboardingHeadingRef,
    onboardingMessage,
    onboardingStep,
    openConsole,
    openProductLink,
    pendingAction,
    performAction,
    pendingActionError,
    cancelPendingAction,
    postProcessMode,
    providerRevision,
    recognitionChanged,
    recognitionPreviewBusy,
    recognitionService,
    refreshDiagnostics,
    resetVoiceInput,
    runAboutAction,
    saveError,
    save,
    savedSettingsRef,
    saving,
    selectProvider,
    selectSection,
    setEditingCustomLlmParameters,
    setMessage,
    setMicrophoneMessage,
    setOnboardingMessage,
    setPostProcessMode,
    setRecognitionPreviewBusy,
    settings,
    shortcutButtonRef,
    shortcutRecorder,
    showMessage,
    switching,
    testRecognition,
    testingMicrophone,
    toggleMicrophoneTest,
    syncHotwords,
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
