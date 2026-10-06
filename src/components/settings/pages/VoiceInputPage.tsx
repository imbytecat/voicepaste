import { useQuery } from "@tanstack/react-query";
import { Mic } from "lucide-react";

import {
  DEFAULT_MICROPHONE_VALUE,
  useSettings,
} from "@/components/settings/controller";
import {
  Feedback,
  Group,
  Keycap,
  Notice,
  Row,
  Segmented,
} from "@/components/settings/kit";
import { settingsQueries } from "@/components/settings/queries";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { recognitionReady } from "@/recognition";
import { formatShortcutLabel } from "@/shortcut";

export function VoiceInputPage() {
  const {
    isSettingChanged,
    microphoneLevel,
    microphoneMessage,
    microphoneOptions,
    recognitionService,
    resetVoiceInput,
    selectSection,
    setMessage,
    setMicrophoneMessage,
    settings,
    shortcutButtonRef,
    shortcutRecorder,
    testingMicrophone,
    toggleMicrophoneTest,
    updateSetting,
    voiceInputIsDefault,
  } = useSettings();
  // Mounting a fresh observer refetches the device list each time the page opens.
  useQuery(settingsQueries.microphones());

  return (
    <>
      {recognitionReady(
        settings.recognition,
        recognitionService.account
      ) ? null : (
        <Notice
          tone="warning"
          action={
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => {
                selectSection("recognition");
              }}
            >
              去配置
            </Button>
          }
        >
          识别服务尚未就绪，暂时无法听写。
        </Notice>
      )}

      <Group>
        <Row
          title="快捷键"
          description="在任意应用的输入框中按下，开始听写"
          changed={isSettingChanged("shortcut")}
        >
          <Button
            ref={shortcutButtonRef}
            variant="outline"
            className={`min-w-36 ${
              shortcutRecorder.isRecording
                ? "border-brand/50 text-muted-foreground ring-3 ring-brand/15"
                : ""
            }`}
            type="button"
            aria-label={
              shortcutRecorder.isRecording
                ? "正在录制快捷键"
                : `修改快捷键，当前为 ${formatShortcutLabel(settings.shortcut)}`
            }
            onClick={() => {
              setMessage(null);
              shortcutRecorder.startRecording();
            }}
            onBlur={shortcutRecorder.cancelRecording}
          >
            {shortcutRecorder.isRecording ? (
              "按下新的快捷键…"
            ) : (
              <Keycap shortcut={settings.shortcut} />
            )}
          </Button>
        </Row>
        <Row
          title="触发方式"
          description={
            settings.activationMode === "hold"
              ? "按住快捷键说话，松开后输入"
              : "按一下开始，再按一下结束"
          }
          changed={isSettingChanged("activationMode")}
        >
          <Segmented
            className="w-52"
            aria-label="触发方式"
            value={settings.activationMode}
            onValueChange={(value) => {
              updateSetting("activationMode", value);
            }}
            options={[
              { label: "按一下切换", value: "toggle" },
              { label: "按住说话", value: "hold" },
            ]}
          />
        </Row>
      </Group>

      <Group title="麦克风">
        <Row
          title="输入设备"
          changed={isSettingChanged("microphoneId")}
          htmlFor="voice-input-microphone"
        >
          <Select
            items={microphoneOptions}
            value={settings.microphoneId || DEFAULT_MICROPHONE_VALUE}
            onValueChange={(value) => {
              if (value === null) return;
              updateSetting(
                "microphoneId",
                value === DEFAULT_MICROPHONE_VALUE ? "" : value
              );
              setMicrophoneMessage(null);
            }}
            disabled={testingMicrophone}
          >
            <SelectTrigger id="voice-input-microphone" className="w-60">
              <SelectValue className="truncate" />
            </SelectTrigger>
            <SelectContent>
              {microphoneOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row
          title="音量测试"
          description={
            testingMicrophone
              ? "说几句话，音量条应随声音跳动"
              : "检查麦克风是否能收到声音"
          }
        >
          <Progress
            className="w-24 gap-0"
            aria-label="麦克风音量"
            value={Math.max(testingMicrophone ? 3 : 0, microphoneLevel * 100)}
          />
          <Button
            variant="outline"
            type="button"
            aria-pressed={testingMicrophone}
            onClick={toggleMicrophoneTest}
          >
            <Mic />
            {testingMicrophone ? "停止" : "测试"}
          </Button>
        </Row>
        {microphoneMessage ? (
          <div className="px-4 py-3">
            <Feedback message={microphoneMessage} />
          </div>
        ) : null}
      </Group>

      <Group title="悬浮窗">
        <Row
          title="显示位置"
          description="听写时在屏幕上显示状态"
          changed={isSettingChanged("overlayPosition")}
        >
          <Segmented
            className="w-52"
            aria-label="悬浮窗位置"
            value={settings.overlayPosition}
            onValueChange={(value) => {
              updateSetting("overlayPosition", value);
            }}
            options={[
              { label: "底部", value: "bottom" },
              { label: "左侧", value: "left" },
              { label: "右侧", value: "right" },
            ]}
          />
        </Row>
      </Group>

      <div className="px-1">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2.5"
          type="button"
          disabled={voiceInputIsDefault || testingMicrophone}
          onClick={resetVoiceInput}
        >
          恢复默认设置
        </Button>
      </div>
    </>
  );
}
