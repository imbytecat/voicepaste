import { ChevronLeft, ClipboardPaste, Command, Mic } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { RecognitionSpeechTest } from "@/components/RecognitionSpeechTest";
import {
  DEFAULT_MICROPHONE_VALUE,
  useSettings,
} from "@/components/settings/controller";
import {
  Feedback,
  Group,
  IconTile,
  Keycap,
  Notice,
  Row,
  StatusText,
} from "@/components/settings/kit";
import type { TileHue } from "@/components/settings/kit";
import {
  RecognitionIssueNotice,
  RecognitionServicePanel,
} from "@/components/settings/pages/RecognitionPage";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatShortcutLabel } from "@/shortcut";

import appIconUrl from "../../../src-tauri/icons/app-icon.svg";

const STEP_COUNT = 5;

const FEATURES = [
  [Command, "indigo", "按下快捷键", "任意应用的输入框"],
  [Mic, "rose", "自然说话", "边说边识别"],
  [ClipboardPaste, "green", "自动输入", "文字回到光标处"],
] as const satisfies readonly (readonly [
  LucideIcon,
  TileHue,
  string,
  string,
])[];

export function Onboarding() {
  const { onboardingStep } = useSettings();

  return (
    <main className="vp-ambient flex h-screen w-screen flex-col text-foreground">
      <header className="flex h-12 shrink-0 items-center justify-between px-5">
        <div className="flex items-center gap-2.5">
          <img
            src={appIconUrl}
            alt=""
            aria-hidden="true"
            className="size-6 rounded-[7px] shadow-[0_2px_6px_rgb(21_23_40/0.2)]"
            draggable={false}
          />
          <span className="text-[14px] font-semibold tracking-[-0.01em]">
            VoicePaste
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-muted-foreground tabular-nums">
            {onboardingStep + 1} / {STEP_COUNT}
          </span>
          <Progress
            className="w-20 gap-0"
            aria-label="设置进度"
            value={((onboardingStep + 1) / STEP_COUNT) * 100}
          />
        </div>
      </header>

      <div className="vp-stable-scroll min-h-0 flex-1 overflow-auto">
        <div
          key={onboardingStep}
          className="vp-section-enter mx-auto flex min-h-full max-w-140 flex-col justify-center px-6 pt-10"
        >
          {onboardingStep === 0 ? <WelcomeStep /> : null}
          {onboardingStep === 1 ? <RecognitionStep /> : null}
          {onboardingStep === 2 ? <ShortcutStep /> : null}
          {onboardingStep === 3 ? <MicrophoneStep /> : null}
          {onboardingStep === 4 ? <FinishStep /> : null}
        </div>
      </div>
    </main>
  );
}

function StepHeading({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children: ReactNode;
}) {
  const { onboardingHeadingRef } = useSettings();
  return (
    <div className="mb-7">
      <p className="text-[12px] font-semibold text-primary">{label}</p>
      <h1
        ref={onboardingHeadingRef}
        tabIndex={-1}
        className="mt-1.5 text-[26px] leading-tight font-semibold tracking-[-0.025em] text-balance outline-none"
      >
        {title}
      </h1>
      <p className="mt-2 text-[13px] leading-5 text-pretty text-muted-foreground">
        {children}
      </p>
    </div>
  );
}

function StepFooter({
  onBack,
  backDisabled = false,
  hint,
  children,
}: {
  onBack?: () => void;
  backDisabled?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <footer className="vp-glass-float sticky bottom-4 mt-10 mb-4 flex items-center justify-between gap-3 rounded-2xl p-2">
      {onBack ? (
        <Button
          variant="ghost"
          size="lg"
          type="button"
          onClick={onBack}
          disabled={backDisabled}
        >
          <ChevronLeft />
          返回
        </Button>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-3">
        {hint ? (
          <span className="text-[12px] text-muted-foreground">{hint}</span>
        ) : null}
        {children}
      </div>
    </footer>
  );
}

function WelcomeStep() {
  const { goToOnboardingStep, onboardingHeadingRef, onboardingMessage } =
    useSettings();
  return (
    <div className="flex flex-col items-center pb-10 text-center">
      <img
        src={appIconUrl}
        alt=""
        aria-hidden="true"
        className="size-18 rounded-[20px] shadow-[0_18px_40px_-12px_rgb(40_50_160/0.55)]"
        draggable={false}
      />
      <h1
        ref={onboardingHeadingRef}
        tabIndex={-1}
        className="mt-7 text-[30px] leading-tight font-semibold tracking-[-0.03em] text-balance outline-none"
      >
        说话，文字就出现在光标处
      </h1>
      <p className="mt-3 text-[14px] text-muted-foreground">
        设置识别服务、快捷键和麦克风，之后在任何应用里都能听写。
      </p>
      <ol className="mt-10 grid w-full grid-cols-3 gap-2.5">
        {FEATURES.map(([Icon, hue, title, description]) => (
          <li
            className="vp-glass flex flex-col items-center gap-3 rounded-[18px] px-3 py-5"
            key={title}
          >
            <IconTile icon={Icon} hue={hue} size="lg" />
            <div>
              <p className="text-[13px] leading-5 font-semibold">{title}</p>
              <p className="mt-0.5 text-[12px] leading-4.5 text-muted-foreground">
                {description}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <Feedback message={onboardingMessage} className="mt-6 w-full text-left" />
      <Button
        size="lg"
        className="mt-10 h-10 rounded-full px-7"
        type="button"
        onClick={() => {
          goToOnboardingStep(1);
        }}
      >
        开始设置
      </Button>
    </div>
  );
}

function RecognitionStep() {
  const {
    dismissNotice,
    goToOnboardingStep,
    notice,
    onboardingMessage,
    recognitionPreviewBusy,
    recognitionService,
  } = useSettings();
  const { accountBusy, testing, verified } = recognitionService;
  const busy = testing || accountBusy || recognitionPreviewBusy;

  return (
    <>
      <StepHeading label="识别服务" title="选择识别服务">
        豆包输入法可直接使用，也可以填写自己的火山引擎 API Key。
      </StepHeading>
      {notice ? (
        <Notice
          tone="warning"
          className="mb-4"
          action={
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={dismissNotice}
            >
              知道了
            </Button>
          }
        >
          {notice}
        </Notice>
      ) : null}
      <RecognitionServicePanel />
      <Feedback message={onboardingMessage} className="mt-4" />
      <StepFooter
        onBack={() => {
          goToOnboardingStep(0);
        }}
        hint={!busy && !verified ? "测试连接通过后继续" : undefined}
      >
        <Button
          size="lg"
          type="button"
          onClick={() => {
            goToOnboardingStep(2);
          }}
          disabled={!verified || busy}
        >
          继续
        </Button>
      </StepFooter>
    </>
  );
}

function ShortcutStep() {
  const {
    goToOnboardingStep,
    onboardingMessage,
    settings,
    shortcutButtonRef,
    setOnboardingMessage,
    shortcutRecorder,
  } = useSettings();
  const { cancelRecording, isRecording, startRecording } = shortcutRecorder;

  return (
    <>
      <StepHeading label="快捷键" title="设置快捷键">
        在任意应用的输入框中按下它，开始听写。
      </StepHeading>
      <div className="flex flex-col items-center gap-3 py-6">
        <Button
          ref={shortcutButtonRef}
          variant="outline"
          size="lg"
          className={`h-14 min-w-60 rounded-xl ${
            isRecording
              ? "border-brand/50 text-muted-foreground ring-3 ring-brand/15"
              : ""
          }`}
          type="button"
          aria-label={
            isRecording
              ? "正在录制快捷键"
              : `修改快捷键，当前为 ${formatShortcutLabel(settings.shortcut)}`
          }
          onClick={() => {
            setOnboardingMessage(null);
            startRecording();
          }}
          onBlur={cancelRecording}
        >
          {isRecording ? (
            "按下新的组合键…"
          ) : (
            <Keycap shortcut={settings.shortcut} />
          )}
        </Button>
        <p className="text-[12px] text-muted-foreground">
          点击后按下新的组合键
        </p>
      </div>
      <p className="text-center text-[12px] text-muted-foreground">
        {settings.activationMode === "hold"
          ? "当前为按住说话：按住快捷键说话，松开后输入"
          : "当前为按一下切换：按一下开始，再按一下结束"}
      </p>
      <Feedback message={onboardingMessage} className="mt-4" />
      <StepFooter
        onBack={() => {
          goToOnboardingStep(1);
        }}
      >
        <Button
          size="lg"
          type="button"
          onClick={() => {
            goToOnboardingStep(3);
          }}
          disabled={!settings.shortcut.trim() || isRecording}
        >
          继续
        </Button>
      </StepFooter>
    </>
  );
}

function MicrophoneStep() {
  const {
    goToOnboardingStep,
    microphoneLevel,
    microphoneMessage,
    microphoneOptions,
    providerRevision,
    recognitionPreviewBusy,
    recognitionService,
    savedSettingsRef,
    setMicrophoneMessage,
    setRecognitionPreviewBusy,
    settings,
    testingMicrophone,
    toggleMicrophoneTest,
    updateSetting,
  } = useSettings();
  const { account, accountBusy, testing } = recognitionService;
  const busy = testingMicrophone || recognitionPreviewBusy;

  return (
    <>
      <StepHeading label="麦克风" title="选择麦克风">
        系统默认通常即可。说一句话，确认能收到声音。
      </StepHeading>
      <Group>
        <Row title="输入设备" htmlFor="onboarding-microphone">
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
            disabled={busy}
          >
            <SelectTrigger id="onboarding-microphone" className="w-60">
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
            disabled={recognitionPreviewBusy}
          >
            <Mic />
            {testingMicrophone ? "停止" : "测试"}
          </Button>
        </Row>
      </Group>
      <Feedback message={microphoneMessage} className="mt-4" />
      <div className="mt-6">
        <RecognitionSpeechTest
          recognition={savedSettingsRef.current.recognition}
          providerRevision={providerRevision}
          account={account}
          microphoneId={settings.microphoneId}
          disabled={testingMicrophone || testing || accountBusy}
          onBusyChange={setRecognitionPreviewBusy}
        />
      </div>
      <StepFooter
        onBack={() => {
          goToOnboardingStep(2);
        }}
        backDisabled={busy}
      >
        <Button
          size="lg"
          type="button"
          onClick={() => {
            goToOnboardingStep(4);
          }}
          disabled={busy}
        >
          继续
        </Button>
      </StepFooter>
    </>
  );
}

function FinishStep() {
  const {
    finishOnboarding,
    goToOnboardingStep,
    microphones,
    onboardingMessage,
    recognitionService,
    saving,
    settings,
  } = useSettings();
  const { verified } = recognitionService;
  const microphoneLabel =
    microphones.find((device) => device.id === settings.microphoneId)?.label ??
    "系统默认麦克风";

  return (
    <>
      <StepHeading label="完成" title="一切就绪">
        确认以下设置，完成后即可按快捷键听写。
      </StepHeading>
      <Group>
        <Row title="识别服务">
          <span className="text-[13px]">
            {settings.recognition.provider === "doubaoIme"
              ? "豆包输入法"
              : "火山引擎 API"}
          </span>
          <StatusText tone={verified ? "success" : "warning"}>
            {verified ? "已验证" : "需要重新测试"}
          </StatusText>
        </Row>
        <Row title="快捷键">
          <Keycap shortcut={settings.shortcut} />
        </Row>
        <Row title="麦克风">
          <span className="truncate text-[13px]">{microphoneLabel}</span>
        </Row>
      </Group>
      {verified ? null : (
        <Notice
          tone="warning"
          className="mt-4"
          action={
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => {
                goToOnboardingStep(1);
              }}
            >
              返回识别服务
            </Button>
          }
        >
          识别服务状态已变化，请重新测试连接。
        </Notice>
      )}
      <Feedback message={onboardingMessage} className="mt-4" />
      <div className="mt-4 empty:hidden">
        <RecognitionIssueNotice />
      </div>
      <StepFooter
        onBack={() => {
          goToOnboardingStep(3);
        }}
        backDisabled={saving}
      >
        <Button
          size="lg"
          type="button"
          onClick={() => {
            void finishOnboarding();
          }}
          disabled={saving || !verified}
        >
          {saving ? "正在保存…" : "完成"}
        </Button>
      </StepFooter>
    </>
  );
}
