import { BookText } from "lucide-react";

import { DoubaoDictionary } from "@/components/DoubaoDictionary";
import { DoubaoPhrases } from "@/components/DoubaoPhrases";
import { useSettings } from "@/components/settings/controller";
import { EmptyState, Group } from "@/components/settings/kit";
import { Button } from "@/components/ui/button";
import { VolcengineDictionary } from "@/components/VolcengineDictionary";

export function DictionaryPage() {
  const { providerRevision, recognitionService, selectSection, settings } =
    useSettings();
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
                前往识别服务
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
          accountRevision={account.revision}
        />
        <DoubaoDictionary
          key={`personal-${providerRevision}-${account.revision}`}
          revision={providerRevision}
          accountRevision={account.revision}
        />
      </>
    );
  }

  return <VolcengineDictionary key={providerRevision} />;
}
