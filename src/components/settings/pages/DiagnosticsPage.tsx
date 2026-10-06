import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { ClipboardPaste, Keyboard, Mic, RefreshCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";

import { useSettings } from "@/components/settings/controller";
import {
  Feedback,
  Group,
  IconTile,
  StatusText,
} from "@/components/settings/kit";
import type { TileHue, Tone } from "@/components/settings/kit";
import { settingsQueries } from "@/components/settings/queries";
import { Button } from "@/components/ui/button";

type CheckState = "granted" | "unavailable" | "preview";

const STATE_PRESENTATION: Record<
  CheckState,
  { tone: Tone; label: string; pill: string }
> = {
  granted: { label: "正常", pill: "bg-success/8", tone: "success" },
  preview: { label: "仅桌面版可检查", pill: "bg-muted", tone: "info" },
  unavailable: { label: "需要处理", pill: "bg-warning/9", tone: "warning" },
};

function CheckRow({
  icon,
  hue,
  title,
  description,
  state,
  detail,
}: {
  icon: LucideIcon;
  hue: TileHue;
  title: string;
  description: string;
  state: CheckState;
  detail?: string;
}) {
  const { label, pill, tone } = STATE_PRESENTATION[state];
  return (
    <div className="flex min-h-16 items-center gap-3.5 px-4 py-3">
      <IconTile icon={icon} hue={hue} />
      <div className="min-w-0 flex-1">
        <h3 className="text-[13px] leading-5 font-medium">{title}</h3>
        <p className="text-[12px] leading-4.5 wrap-break-word text-muted-foreground">
          {state === "unavailable" && detail ? detail : description}
        </p>
      </div>
      <div role="status" aria-live="polite" aria-atomic="true">
        <StatusText tone={tone} className={`rounded-full px-2.5 py-1 ${pill}`}>
          {label}
        </StatusText>
      </div>
    </div>
  );
}

export function DiagnosticsPage() {
  const { errorText, setMessage, showMessage } = useSettings();
  // Observed here too so every visit re-checks (the queries are always stale).
  const diagnosticsQuery = useQuery(settingsQueries.diagnostics());
  const microphonesQuery = useQuery(settingsQueries.microphones());
  const microphones = microphonesQuery.data ?? [];
  const [retryingInput, setRetryingInput] = useState(false);
  const checking = diagnosticsQuery.isFetching || microphonesQuery.isFetching;
  const diagnostics = diagnosticsQuery.data ?? null;
  const preview = diagnostics === null;
  const shortcutState: CheckState = preview
    ? "preview"
    : diagnostics.shortcutReady
      ? "granted"
      : "unavailable";
  const microphoneState: CheckState = preview
    ? "preview"
    : microphones.length > 0
      ? "granted"
      : "unavailable";
  const inputState: CheckState = preview
    ? "preview"
    : diagnostics.inputReady
      ? "granted"
      : "unavailable";

  return (
    <>
      <Group description="听写需要以下三项都正常。">
        <CheckRow
          icon={Keyboard}
          hue="indigo"
          title="全局快捷键"
          description="在任意应用中触发听写"
          state={shortcutState}
          detail={diagnostics?.shortcutStatus}
        />
        <CheckRow
          icon={Mic}
          hue="rose"
          title="麦克风设备"
          description="检测输入设备；麦克风权限在首次听写时申请"
          state={microphoneState}
          detail="未检测到可用的麦克风"
        />
        <CheckRow
          icon={ClipboardPaste}
          hue="green"
          title="自动粘贴"
          description="把识别结果输入到光标位置"
          state={inputState}
          detail={diagnostics?.inputStatus}
        />
      </Group>
      <Feedback
        message={
          diagnosticsQuery.error
            ? { kind: "error", text: errorText(diagnosticsQuery.error) }
            : null
        }
      />
      <div className="flex gap-2 px-1">
        <Button
          variant="outline"
          type="button"
          disabled={checking}
          onClick={() => {
            setMessage(null);
            void diagnosticsQuery.refetch();
            void microphonesQuery.refetch();
          }}
        >
          <RefreshCw className={checking ? "animate-spin" : undefined} />{" "}
          重新检查
        </Button>
        {diagnostics && !diagnostics.inputReady ? (
          <Button
            type="button"
            disabled={retryingInput}
            onClick={() => {
              void (async () => {
                setMessage(null);
                setRetryingInput(true);
                try {
                  await invoke("retry_input_access");
                  await diagnosticsQuery.refetch();
                } catch (error) {
                  showMessage({ kind: "error", text: errorText(error) });
                } finally {
                  setRetryingInput(false);
                }
              })();
            }}
          >
            重新授权自动粘贴
          </Button>
        ) : null}
      </div>
    </>
  );
}
