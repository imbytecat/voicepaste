import { Activity, ExternalLink, Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";
import type { ReactNode } from "react";

import { RecognitionSpeechTest } from "@/components/RecognitionSpeechTest";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { RecognitionService } from "@/components/useRecognitionService";
import { recognitionReady } from "@/recognition";
import type { RecognitionSettings } from "@/types";

export function RecognitionSettingsPanel({
  recognition,
  previewRecognition,
  onSave,
  onChange,
  onSelectProvider,
  providerRevision,
  service,
  onOpenConsole,
  feedback,
  microphoneId,
  previewBusy,
  onPreviewBusyChange,
  changed = false,
  disabled = false,
}: {
  recognition: RecognitionSettings;
  previewRecognition: RecognitionSettings;
  onSave: () => void;
  onChange: (recognition: RecognitionSettings) => void;
  onSelectProvider: (provider: RecognitionSettings["provider"]) => void;
  providerRevision: number;
  service: RecognitionService;
  onOpenConsole: () => void;
  feedback: ReactNode;
  microphoneId: string;
  previewBusy: boolean;
  onPreviewBusyChange: (busy: boolean) => void;
  changed?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const [showApiKey, setShowApiKey] = useState(false);
  const busy =
    disabled || service.testing || service.accountBusy || previewBusy;
  const { account } = service;
  const accountLabel =
    account.state === "guest"
      ? "游客模式"
      : account.state === "signedIn"
        ? (account.nickname ?? "已登录豆包账号")
        : account.state === "signingIn"
          ? "等待完成登录"
          : account.state === "expired"
            ? "登录已过期"
            : "账号状态不可用";

  return (
    <div className="space-y-5 px-6 py-5">
      <fieldset disabled={busy}>
        <legend className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-foreground">
          使用方式（同一时间只启用一种）
          {changed ? (
            <Badge
              variant="outline"
              className="h-5 border-[#d7b879] bg-[#fff4d8] px-1.5 text-[10px] text-[#7a5100]"
            >
              已修改
            </Badge>
          ) : null}
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["doubaoIme", "豆包输入法", "免填 API Key · 实验性"],
              ["volcengine", "火山引擎 API", "官方接口 · 自备 Key"],
            ] as const
          ).map(([provider, title, description]) => (
            <label
              key={provider}
              aria-label={title}
              htmlFor={`${id}-${provider}`}
              className={`vp-motion-control flex cursor-pointer items-start gap-3 rounded-[10px] border p-3.5 transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/20 ${
                recognition.provider === provider
                  ? "border-primary/40 bg-accent"
                  : "border-input bg-card"
              }`}
            >
              <input
                id={`${id}-${provider}`}
                className="mt-0.5 accent-primary"
                type="radio"
                name={`${id}-provider`}
                value={provider}
                checked={recognition.provider === provider}
                onChange={() => {
                  onSelectProvider(provider);
                }}
              />
              <span>
                <span className="block text-[12px] font-semibold text-foreground">
                  {title}
                </span>
                <span className="mt-1 block text-[11px] leading-5 text-muted-foreground">
                  {description}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {recognition.provider === "volcengine" ? (
        <div>
          <label
            htmlFor={`${id}-api-key`}
            className="text-[12px] font-semibold text-foreground"
          >
            火山引擎 API Key
          </label>
          <p className="mt-1.5 text-[12px] leading-5 text-muted-foreground">
            从火山引擎控制台获取，用于语音识别和云端常用词同步。保存后写入系统凭据库。
          </p>
          <div className="vp-motion-control mt-3 flex h-10 items-center overflow-hidden rounded-[10px] border border-input bg-card transition-[background-color,border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20">
            <Input
              id={`${id}-api-key`}
              className="h-10 min-w-0 flex-1 border-0 bg-transparent px-3 shadow-none focus-visible:ring-0"
              type={showApiKey ? "text" : "password"}
              value={recognition.volcengine.apiKey}
              onChange={(event) => {
                onChange({
                  ...recognition,
                  volcengine: {
                    ...recognition.volcengine,
                    apiKey: event.target.value,
                  },
                });
              }}
              disabled={busy}
              placeholder="粘贴 API Key"
              autoComplete="off"
              spellCheck={false}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              className="mr-1 text-muted-foreground"
              onClick={() => {
                setShowApiKey(!showApiKey);
              }}
              aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
            >
              {showApiKey ? <EyeOff size={13} /> : <Eye size={13} />}
            </Button>
          </div>
          <Button
            variant="link"
            size="sm"
            className="mt-2 h-auto px-0 text-[11px]"
            type="button"
            onClick={onOpenConsole}
          >
            获取 API Key <ExternalLink size={10} />
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-[10px] bg-muted/55 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[12px] font-semibold text-foreground">
                  {accountLabel}
                </p>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  登录可选；游客也可使用识别。账号状态与服务连接状态分别显示。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {account.state === "signingIn" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void service.accountAction("cancel_doubao_login")
                    }
                  >
                    取消登录
                  </Button>
                ) : account.state === "signedIn" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    disabled={busy}
                    onClick={() => void service.accountAction("logout_doubao")}
                  >
                    退出并改用游客
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      disabled={busy}
                      onClick={() => void service.accountAction("login_doubao")}
                    >
                      {account.state === "expired"
                        ? "重新登录"
                        : "登录豆包账号"}
                    </Button>
                    {account.state === "expired" ||
                    account.state === "unavailable" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void service.accountAction("logout_doubao")
                        }
                      >
                        改用游客
                      </Button>
                    ) : null}
                    {account.state === "unavailable" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void service.accountAction("recheck_doubao_account")
                        }
                      >
                        重新校验
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
            </div>
            {account.message ? (
              <p
                className="mt-2 text-[11px] leading-5 text-muted-foreground"
                role="status"
              >
                {account.message}
              </p>
            ) : null}
            {account.state === "expired" ? (
              <p
                className="mt-2 text-[11px] leading-5 text-[#8d261f]"
                role="alert"
              >
                原账号不可继续识别；请重新登录或明确选择游客，不会自动回退。
              </p>
            ) : null}
            <p className="mt-2 text-[10px] leading-5 text-muted-foreground">
              登录、取消与退出立即生效，不需要保存，也不会切换识别服务。退出只清除此应用的账号会话，不保证撤销服务端授权。
            </p>
          </div>
          {service.accountError ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{service.accountError}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      )}
      {recognition.provider === "doubaoIme" && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="flex items-center justify-between gap-3 text-sm">
            自动标点
            <Switch
              aria-label="豆包自动标点"
              checked={!recognition.doubaoIme.disablePunctuation}
              disabled={busy}
              onCheckedChange={(checked) => {
                onChange({
                  ...recognition,
                  doubaoIme: {
                    ...recognition.doubaoIme,
                    disablePunctuation: !checked,
                  },
                });
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            使用服务端个人词增强
            <Switch
              aria-label="豆包个人词增强"
              checked={!recognition.doubaoIme.disablePersonalWords}
              disabled={busy}
              onCheckedChange={(checked) => {
                onChange({
                  ...recognition,
                  doubaoIme: {
                    ...recognition.doubaoIme,
                    disablePersonalWords: !checked,
                  },
                });
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            开关只控制识别请求，不上传或删除词库。关闭自动标点不影响另行启用的文本整理。
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-110 text-[11px] leading-5 text-muted-foreground">
          {recognition.provider === "doubaoIme"
            ? "测试会连接豆包输入法服务，首次使用会注册设备；不录音、不上传麦克风音频。"
            : "仅测试当前识别配置，不录音。常用词同步异常不会阻止识别连接验证。"}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-[11px]"
          type="button"
          disabled={busy || !recognitionReady(recognition, account)}
          onClick={() => void service.testConnection()}
        >
          <Activity size={11} />
          {service.testing
            ? "连接中…"
            : service.verified
              ? "重新测试"
              : "测试连接"}
        </Button>
      </div>
      {service.verified ? (
        <Alert
          className="border-[#a9d8c4] bg-[#edf7f1] text-[#17633f]"
          role="status"
        >
          <AlertDescription className="text-inherit">
            当前语音识别连接已验证。
          </AlertDescription>
        </Alert>
      ) : null}
      {changed ? (
        <Button variant="outline" disabled={busy} onClick={onSave}>
          保存当前服务配置
        </Button>
      ) : null}
      {feedback}
      <RecognitionSpeechTest
        recognition={previewRecognition}
        providerRevision={providerRevision}
        account={account}
        microphoneId={microphoneId}
        disabled={disabled || service.testing || service.accountBusy || changed}
        onBusyChange={onPreviewBusyChange}
      />
      <p className="text-[10px] leading-5 text-muted-foreground">
        使用方式切换立即保存；Key
        和识别开关需保存后生效。试说使用已保存配置，不上传词库草稿。
      </p>
    </div>
  );
}
