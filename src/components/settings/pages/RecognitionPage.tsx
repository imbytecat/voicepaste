import { Activity, ExternalLink, UserRound } from "lucide-react";
import { useId } from "react";

import { RecognitionSpeechTest } from "@/components/RecognitionSpeechTest";
import { useSettings } from "@/components/settings/controller";
import {
  Block,
  ChoiceCards,
  Group,
  Notice,
  Row,
  SecretInput,
  StatusText,
} from "@/components/settings/kit";
import type { Choice } from "@/components/settings/kit";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { recognitionReady } from "@/recognition";
import type { AccountStatus, RecognitionProvider } from "@/types";

const PROVIDERS: readonly Choice<RecognitionProvider>[] = [
  {
    brand: "doubao",
    description: "免 Key，可选登录 · 实验性",
    title: "豆包输入法",
    value: "doubaoIme",
  },
  {
    brand: "volcengine",
    description: "官方接口，需要自己的 Key",
    title: "火山引擎 API",
    value: "volcengine",
  },
];

const ACCOUNT_TEXT: Record<
  AccountStatus["state"],
  { label: string; hint: string }
> = {
  expired: { label: "登录已过期", hint: "请重新登录或改用游客" },
  guest: { label: "游客模式", hint: "无需登录即可识别" },
  signedIn: { label: "已登录豆包账号", hint: "已登录" },
  signingIn: { label: "等待完成登录", hint: "完成登录后自动更新" },
  unavailable: { label: "账号状态不可用", hint: "可重新校验或改用游客" },
};

/** Current recognition service problem (connection test or save), or nothing. */
export function RecognitionIssueNotice() {
  const { openProductLink, recognitionService, saveIssue } = useSettings();
  const issue = recognitionService.issue ?? saveIssue;
  if (!issue) return null;
  const { detail, kind, links, steps, title } = issue;
  return (
    <Notice tone={kind === "notActivated" ? "error" : "warning"} title={title}>
      {steps.length > 0 ? (
        <ol className="mt-1 list-decimal space-y-0.5 pl-4">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : (
        <p className="mt-0.5">{detail}</p>
      )}
      {links.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {links.map((link) => (
            <Button
              key={link.target}
              variant="outline"
              size="sm"
              type="button"
              onClick={() => void openProductLink(link.target)}
            >
              <ExternalLink />
              {link.label}
            </Button>
          ))}
        </div>
      ) : null}
      {steps.length > 0 ? (
        <details className="mt-2.5">
          <summary className="cursor-pointer font-medium">技术详情</summary>
          <p className="mt-1 wrap-break-word opacity-80">{detail}</p>
        </details>
      ) : null}
    </Notice>
  );
}

/**
 * Provider choice, account or API Key, connection test and speech test.
 * Self-contained so onboarding can render it outside the settings layout.
 */
export function RecognitionServicePanel() {
  const {
    checkingHotwords,
    loadingLlmModels,
    openConsole,
    providerRevision,
    recognitionChanged,
    recognitionPreviewBusy,
    recognitionService: service,
    savedSettingsRef,
    saveIssue,
    saving,
    selectProvider,
    setRecognitionPreviewBusy,
    settings,
    switching,
    testingMicrophone,
    updateRecognition,
  } = useSettings();
  const id = useId();
  const { microphoneId, recognition } = settings;
  const saved = savedSettingsRef.current.recognition;
  const { account } = service;
  const disabled =
    saving ||
    switching ||
    checkingHotwords ||
    loadingLlmModels ||
    testingMicrophone;
  const busy =
    disabled ||
    service.testing ||
    service.accountBusy ||
    recognitionPreviewBusy;
  const accountText = ACCOUNT_TEXT[account.state];
  const accountLabel =
    account.state === "signedIn"
      ? (account.nickname ?? accountText.label)
      : accountText.label;

  const accountButton = (
    label: string,
    command: Parameters<typeof service.accountAction>[0]
  ) => (
    <Button
      key={command}
      variant="outline"
      type="button"
      disabled={busy}
      onClick={() => void service.accountAction(command)}
    >
      {label}
    </Button>
  );

  return (
    <div className="space-y-7">
      <ChoiceCards
        legend="识别服务"
        value={recognition.provider}
        onValueChange={selectProvider}
        options={PROVIDERS}
        disabled={busy}
      />

      {recognition.provider === "doubaoIme" ? (
        <Group title="豆包账号">
          <div className="flex min-h-14 items-center gap-3 px-4 py-3">
            <span
              aria-hidden="true"
              className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-[13px] font-medium text-muted-foreground"
            >
              {account.state === "signedIn" && account.nickname ? (
                account.nickname.slice(0, 1)
              ) : (
                <UserRound className="size-4" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] leading-5 font-medium text-foreground">
                {accountLabel}
              </p>
              <p
                className="mt-0.5 text-[12px] leading-4.5 text-muted-foreground"
                role="status"
              >
                {account.message ?? accountText.hint}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              {account.state === "signingIn"
                ? accountButton("取消登录", "cancel_doubao_login")
                : account.state === "signedIn"
                  ? accountButton("退出并改用游客", "logout_doubao")
                  : [
                      account.state === "unavailable"
                        ? accountButton("重新校验", "recheck_doubao_account")
                        : null,
                      account.state === "expired" ||
                      account.state === "unavailable"
                        ? accountButton("改用游客", "logout_doubao")
                        : null,
                      accountButton(
                        account.state === "expired"
                          ? "重新登录"
                          : "登录豆包账号",
                        "login_doubao"
                      ),
                    ]}
            </div>
          </div>
          {account.state === "expired" || service.accountError ? (
            <Block className="space-y-2">
              {account.state === "expired" ? (
                <Notice tone="warning">
                  原账号已无法识别。请重新登录或改用游客，不会自动切换。
                </Notice>
              ) : null}
              {service.accountError ? (
                <Notice tone="error">{service.accountError}</Notice>
              ) : null}
            </Block>
          ) : null}
          <Row
            title="自动标点"
            description="在识别结果中加入标点"
            changed={
              recognition.doubaoIme.disablePunctuation !==
              saved.doubaoIme.disablePunctuation
            }
          >
            <Switch
              aria-label="豆包自动标点"
              checked={!recognition.doubaoIme.disablePunctuation}
              disabled={busy}
              onCheckedChange={(checked) => {
                updateRecognition({
                  ...recognition,
                  doubaoIme: {
                    ...recognition.doubaoIme,
                    disablePunctuation: !checked,
                  },
                });
              }}
            />
          </Row>
          <Row
            title="个人词增强"
            description="使用账号中的个人词库提升识别"
            changed={
              recognition.doubaoIme.disablePersonalWords !==
              saved.doubaoIme.disablePersonalWords
            }
          >
            <Switch
              aria-label="豆包个人词增强"
              checked={!recognition.doubaoIme.disablePersonalWords}
              disabled={busy}
              onCheckedChange={(checked) => {
                updateRecognition({
                  ...recognition,
                  doubaoIme: {
                    ...recognition.doubaoIme,
                    disablePersonalWords: !checked,
                  },
                });
              }}
            />
          </Row>
        </Group>
      ) : (
        <Group>
          <Row
            title="API Key"
            htmlFor={`${id}-api-key`}
            changed={recognition.volcengine.apiKey !== saved.volcengine.apiKey}
            stacked
          >
            <div className="flex gap-2">
              <SecretInput
                id={`${id}-api-key`}
                className="flex-1"
                aria-label="API Key"
                value={recognition.volcengine.apiKey}
                onChange={(apiKey) => {
                  updateRecognition({
                    ...recognition,
                    volcengine: { ...recognition.volcengine, apiKey },
                  });
                }}
                disabled={busy}
                placeholder="粘贴 API Key"
              />
              <Button
                variant="outline"
                type="button"
                onClick={() => void openConsole()}
              >
                <ExternalLink />
                获取 API Key
              </Button>
            </div>
          </Row>
        </Group>
      )}

      <Group title="连接">
        <Row
          title="测试连接"
          description={
            service.verified ? (
              <StatusText tone="success">已连接</StatusText>
            ) : service.issue ? (
              <StatusText tone="error">连接失败</StatusText>
            ) : (
              "不录音，只验证当前配置能否连上服务"
            )
          }
        >
          <Button
            variant="outline"
            type="button"
            disabled={busy || !recognitionReady(recognition, account)}
            onClick={() => void service.testConnection()}
          >
            <Activity />
            {service.testing
              ? "连接中…"
              : service.verified
                ? "重新测试"
                : "测试连接"}
          </Button>
        </Row>
        {service.issue || saveIssue ? (
          <Block>
            <RecognitionIssueNotice />
          </Block>
        ) : null}
      </Group>

      <RecognitionSpeechTest
        recognition={saved}
        providerRevision={providerRevision}
        account={account}
        microphoneId={microphoneId}
        disabled={
          disabled ||
          service.testing ||
          service.accountBusy ||
          recognitionChanged
        }
        disabledReason={recognitionChanged ? "保存后可试说" : undefined}
        onBusyChange={setRecognitionPreviewBusy}
      />
    </div>
  );
}

export function RecognitionPage() {
  return <RecognitionServicePanel />;
}
