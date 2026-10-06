import { BookText } from "lucide-react";

import { DoubaoDictionary } from "@/components/DoubaoDictionary";
import { DoubaoPhrases } from "@/components/DoubaoPhrases";
import { useSettings } from "@/components/settings/controller";
import { EmptyState, Group } from "@/components/settings/kit";
import { Button } from "@/components/ui/button";
import { VolcengineDictionary } from "@/components/VolcengineDictionary";

export function DictionaryPage() {
  const {
    apiKeyChanged,
    checkingHotwords,
    cloudConfirmedAt,
    cloudHotwords,
    cloudHotwordsVerified,
    errorText,
    hotwordMessage,
    hotwordStatus,
    hotwordsChanged,
    hotwordsText,
    localHotwords,
    openHotwordConflict,
    providerRevision,
    recognitionPreviewBusy,
    recognitionService,
    refreshHotwords,
    reviewTokenRef,
    saveHotwordDraft,
    savedSettingsRef,
    saving,
    selectSection,
    setHotwordMessage,
    setPendingHotwordApply,
    settings,
    updateHotwordsText,
    updateVolcengineSetting,
  } = useSettings();
  const { account } = recognitionService;

  if (settings.recognition.provider === "doubaoIme") {
    if (account.state !== "signedIn")
      return (
        <Group>
          <EmptyState
            icon={BookText}
            title="登录豆包账号后可管理常用语和个人词库"
            action={
              <Button
                type="button"
                onClick={() => {
                  selectSection("recognition");
                }}
              >
                去登录
              </Button>
            }
          />
        </Group>
      );
    return (
      <>
        <DoubaoPhrases
          key={`${providerRevision}-${account.revision}`}
          revision={providerRevision}
        />
        <DoubaoDictionary
          key={`personal-${providerRevision}-${account.revision}`}
          revision={providerRevision}
        />
      </>
    );
  }

  const { volcengine } = settings.recognition;
  const { hotwords: confirmedHotwords, hotwordsEnabled: savedEnabled } =
    savedSettingsRef.current.recognition.volcengine;
  const saveDraft = () => {
    void saveHotwordDraft().catch((error: unknown) => {
      setHotwordMessage({ kind: "error", text: errorText(error) });
    });
  };

  return (
    <VolcengineDictionary
      key={providerRevision}
      providerRevision={providerRevision}
      text={hotwordsText}
      onChange={updateHotwordsText}
      status={hotwordStatus}
      cloudWords={cloudHotwords}
      cloudVerified={cloudHotwordsVerified}
      confirmedAt={cloudConfirmedAt}
      localDirty={hotwordsChanged}
      canDiscard={hotwordsText !== confirmedHotwords.join("\n")}
      enabled={volcengine.hotwordsEnabled}
      savedEnabled={savedEnabled}
      onEnabledChange={(enabled) => {
        updateVolcengineSetting("hotwordsEnabled", enabled);
      }}
      busy={
        saving ||
        checkingHotwords ||
        recognitionPreviewBusy ||
        recognitionService.testing
      }
      configured={Boolean(volcengine.apiKey.trim()) && !apiKeyChanged}
      confirming={hotwordStatus.state === "confirming"}
      canReview={cloudHotwordsVerified && reviewTokenRef.current !== null}
      message={hotwordMessage}
      onSave={saveDraft}
      onApply={() => {
        setPendingHotwordApply({ words: localHotwords, reviewToken: null });
      }}
      onRefresh={() => void refreshHotwords()}
      onDiscard={() => {
        updateHotwordsText(confirmedHotwords.join("\n"));
        saveDraft();
      }}
      onReview={() => {
        const { current: reviewToken } = reviewTokenRef;
        if (reviewToken)
          openHotwordConflict({
            cloudHotwords,
            words: localHotwords,
            reviewToken,
          });
      }}
      onConfigure={() => {
        selectSection("recognition");
      }}
    />
  );
}
