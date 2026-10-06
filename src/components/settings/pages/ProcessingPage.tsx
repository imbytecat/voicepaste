import { Ban, Bot, ChevronRight, RefreshCw } from "lucide-react";
import { useState } from "react";

import { useSettings } from "@/components/settings/controller";
import type { PostProcessMode } from "@/components/settings/controller";
import { DoubaoTextTools } from "@/components/settings/DoubaoTextTools";
import {
  Block,
  BrandMark,
  ChangedDot,
  Collapse,
  Feedback,
  Group,
  Notice,
  Row,
  SecretInput,
  ChoiceCards,
  StatusText,
} from "@/components/settings/kit";
import type { Choice } from "@/components/settings/kit";
import {
  CUSTOM_LLM_PARAMETER_PRESET,
  LLM_BASE_URL_PLACEHOLDER,
  LLM_MODEL_PLACEHOLDER,
  LLM_PARAMETER_PRESETS,
  detectLlmParameterPreset,
  llmParameterError,
} from "@/components/settings/llm";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_LLM_PREFERENCE } from "@/types";

const MODE_CHOICES: Record<PostProcessMode, Choice<PostProcessMode>> = {
  doubao: {
    brand: "doubao",
    description: "用豆包账号整理，失败时保留原文",
    title: "豆包智能整理",
    value: "doubao",
  },
  llm: {
    description: "用你配置的模型改写，多等几秒",
    hue: "violet",
    icon: Bot,
    title: "自定义 LLM",
    value: "llm",
  },
  off: {
    description: "直接输入识别结果",
    hue: "graphite",
    icon: Ban,
    title: "不处理",
    value: "off",
  },
};

export function ProcessingPage() {
  const {
    availableLlmModels,
    editingCustomLlmParameters,
    fetchLlmModels,
    isLlmSettingChanged,
    isSectionChanged,
    llm,
    llmModelsMessage,
    loadingLlmModels,
    postProcessMode,
    providerRevision,
    recognitionService,
    selectSection,
    setAvailableLlmModels,
    setEditingCustomLlmParameters,
    setLlmModelsMessage,
    setPostProcessMode,
    settings,
    updateLlmSetting,
  } = useSettings();
  const [advancedOpen, setAdvancedOpen] = useState(editingCustomLlmParameters);

  const { account } = recognitionService;
  const isDoubao = settings.recognition.provider === "doubaoIme";
  const signedIn = account.state === "signedIn";
  const doubaoLocked = !signedIn && postProcessMode !== "doubao";
  const modeOptions = [
    MODE_CHOICES.off,
    ...(isDoubao ? [{ ...MODE_CHOICES.doubao, disabled: doubaoLocked }] : []),
    MODE_CHOICES.llm,
  ];

  const presetId = detectLlmParameterPreset(llm.extraParameters);
  const preset = LLM_PARAMETER_PRESETS.find(({ id }) => id === presetId);
  const presetOptions = [
    ...(presetId === CUSTOM_LLM_PARAMETER_PRESET
      ? [
          {
            brands: [],
            label: "自定义 JSON",
            value: CUSTOM_LLM_PARAMETER_PRESET,
          },
        ]
      : []),
    ...LLM_PARAMETER_PRESETS.map(({ brands, id, label }) => ({
      brands,
      label,
      value: id,
    })),
  ];
  const parameterError = llmParameterError(llm.extraParameters);
  const modelQuery = llm.model.trim().toLocaleLowerCase();
  const filteredModels = availableLlmModels.filter(
    (model) => !modelQuery || model.toLocaleLowerCase().includes(modelQuery)
  );
  const clearModelList = () => {
    setAvailableLlmModels([]);
    setLlmModelsMessage(null);
  };

  return (
    <>
      <div>
        <section className="space-y-2.5">
          <header className="flex items-center gap-1.5 px-1.5">
            <h2 className="text-[13px] font-semibold tracking-[0.01em] text-foreground/75">
              识别后处理
            </h2>
            {isSectionChanged("processing") ? <ChangedDot /> : null}
          </header>
          <ChoiceCards
            legend="识别后处理方式"
            value={postProcessMode}
            onValueChange={setPostProcessMode}
            options={modeOptions}
          />
          {isDoubao && doubaoLocked ? (
            <p className="px-1.5 text-[12px] leading-4.5 text-muted-foreground">
              登录豆包账号后可使用豆包智能整理
            </p>
          ) : null}
        </section>

        <Collapse open={postProcessMode === "llm"}>
          <div className="space-y-7 pt-7">
            <Group title="模型">
              <Row
                title="接口地址"
                description="OpenAI 兼容接口"
                htmlFor="llm-base-url"
                changed={isLlmSettingChanged("baseUrl")}
              >
                <Input
                  id="llm-base-url"
                  className="w-72"
                  type="url"
                  value={llm.baseUrl}
                  onChange={(event) => {
                    updateLlmSetting("baseUrl", event.target.value);
                    clearModelList();
                  }}
                  placeholder={LLM_BASE_URL_PLACEHOLDER}
                  autoComplete="off"
                  spellCheck={false}
                />
              </Row>
              <Row
                title="API Key"
                htmlFor="llm-api-key"
                changed={isLlmSettingChanged("apiKey")}
              >
                <SecretInput
                  id="llm-api-key"
                  className="w-72"
                  aria-label="LLM API Key"
                  value={llm.apiKey}
                  onChange={(value) => {
                    updateLlmSetting("apiKey", value);
                    clearModelList();
                  }}
                  placeholder="本地服务可留空"
                />
              </Row>
              <Row title="模型" changed={isLlmSettingChanged("model")}>
                <Combobox
                  items={filteredModels}
                  filter={null}
                  inputValue={llm.model}
                  value={llm.model || null}
                  onInputValueChange={(value) => {
                    updateLlmSetting("model", value);
                  }}
                  onValueChange={(value) => {
                    if (value !== null) updateLlmSetting("model", value);
                  }}
                >
                  <ComboboxInput
                    aria-label="LLM 模型"
                    className="w-48"
                    placeholder={LLM_MODEL_PLACEHOLDER}
                    autoComplete="off"
                    spellCheck={false}
                    showTrigger={availableLlmModels.length > 0}
                  />
                  <ComboboxContent>
                    {availableLlmModels.length > 0 &&
                    filteredModels.length === 0 ? (
                      <ComboboxEmpty>不在列表中，仍可直接使用</ComboboxEmpty>
                    ) : null}
                    <ComboboxList>
                      {filteredModels.map((model) => (
                        <ComboboxItem key={model} value={model}>
                          {model}
                        </ComboboxItem>
                      ))}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => void fetchLlmModels()}
                  disabled={loadingLlmModels}
                >
                  <RefreshCw
                    className={loadingLlmModels ? "animate-spin" : undefined}
                  />
                  {loadingLlmModels ? "获取中…" : "获取列表"}
                </Button>
              </Row>
              {llmModelsMessage ? (
                <Block>
                  <Feedback message={llmModelsMessage} />
                </Block>
              ) : null}
              <Row
                title="流式显示"
                description="边生成边在悬浮窗显示"
                changed={isLlmSettingChanged("streaming")}
              >
                <Switch
                  checked={llm.streaming}
                  onCheckedChange={(checked) => {
                    updateLlmSetting("streaming", checked);
                  }}
                  aria-label="流式显示"
                />
              </Row>
            </Group>

            <Group>
              <Row
                title="表达偏好"
                description="描述期望的语气和格式"
                htmlFor="llm-preference"
                changed={isLlmSettingChanged("prompt")}
                stacked
              >
                <Textarea
                  id="llm-preference"
                  className="min-h-28 resize-y"
                  value={llm.prompt}
                  onChange={(event) => {
                    updateLlmSetting("prompt", event.target.value);
                  }}
                  placeholder={DEFAULT_LLM_PREFERENCE}
                  maxLength={8000}
                  rows={5}
                />
              </Row>
            </Group>

            <div>
              <div className="flex items-center gap-2 px-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-2.5"
                  type="button"
                  aria-expanded={advancedOpen}
                  onClick={() => {
                    setAdvancedOpen(!advancedOpen);
                  }}
                >
                  <ChevronRight
                    className={`vp-motion-fast transition-transform motion-reduce:transition-none ${
                      advancedOpen ? "rotate-90" : ""
                    }`}
                  />
                  高级
                </Button>
                {advancedOpen ? null : (
                  <>
                    <span className="truncate text-[12px] text-muted-foreground">
                      请求参数：{preset?.label ?? "自定义 JSON"}
                    </span>
                    {isLlmSettingChanged("extraParameters") ? (
                      <ChangedDot />
                    ) : null}
                  </>
                )}
              </div>
              <Collapse open={advancedOpen}>
                <Group className="pt-2">
                  <Row
                    title="请求参数"
                    description={preset?.description ?? "使用自定义 JSON 参数"}
                    htmlFor="llm-parameter-preset"
                    changed={isLlmSettingChanged("extraParameters")}
                  >
                    <Select
                      items={presetOptions}
                      value={presetId}
                      onValueChange={(value) => {
                        const next = LLM_PARAMETER_PRESETS.find(
                          ({ id }) => id === value
                        );
                        if (!next) return;
                        setEditingCustomLlmParameters(false);
                        updateLlmSetting("extraParameters", next.parameters);
                      }}
                    >
                      <SelectTrigger id="llm-parameter-preset" className="w-68">
                        <SelectValue className="truncate">
                          {(value: string) => {
                            const option = presetOptions.find(
                              (item) => item.value === value
                            );
                            return (
                              <span className="flex min-w-0 items-center gap-2">
                                {option?.brands.map((brand) => (
                                  <BrandMark
                                    key={brand}
                                    brand={brand}
                                    size="xs"
                                  />
                                ))}
                                <span className="truncate">
                                  {option?.label}
                                </span>
                              </span>
                            );
                          }}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {presetOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            <span className="flex items-center gap-2">
                              {option.brands.length > 0 ? (
                                <span className="flex items-center gap-1">
                                  {option.brands.map((brand) => (
                                    <BrandMark
                                      key={brand}
                                      brand={brand}
                                      size="xs"
                                    />
                                  ))}
                                </span>
                              ) : null}
                              {option.label}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Row>
                  <div>
                    <Row
                      title="自定义 JSON"
                      description="附加到请求体的额外字段"
                    >
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        aria-expanded={editingCustomLlmParameters}
                        onClick={() => {
                          setEditingCustomLlmParameters(
                            !editingCustomLlmParameters
                          );
                        }}
                      >
                        {editingCustomLlmParameters ? "收起" : "编辑"}
                      </Button>
                    </Row>
                    <Collapse open={editingCustomLlmParameters}>
                      <Block className="space-y-2 border-t border-border">
                        <Textarea
                          aria-label="自定义 JSON 参数"
                          aria-invalid={parameterError ? true : undefined}
                          className="min-h-24 resize-y font-mono text-[12px] leading-5"
                          value={llm.extraParameters}
                          onChange={(event) => {
                            updateLlmSetting(
                              "extraParameters",
                              event.target.value
                            );
                          }}
                          placeholder={'{\n  "parameter": "value"\n}'}
                          maxLength={8000}
                          rows={4}
                          spellCheck={false}
                        />
                        <div className="flex items-center justify-between gap-3">
                          <div
                            className="min-w-0"
                            role={parameterError ? "alert" : "status"}
                          >
                            {parameterError ? (
                              <StatusText tone="error">
                                {parameterError}
                              </StatusText>
                            ) : llm.extraParameters.trim() ? (
                              <StatusText tone="success">JSON 有效</StatusText>
                            ) : (
                              <StatusText tone="info">
                                留空则不附加参数
                              </StatusText>
                            )}
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              type="button"
                              disabled={
                                Boolean(parameterError) ||
                                !llm.extraParameters.trim()
                              }
                              onClick={() => {
                                const parsed: unknown = JSON.parse(
                                  llm.extraParameters
                                );
                                updateLlmSetting(
                                  "extraParameters",
                                  JSON.stringify(parsed, null, 2) ??
                                    llm.extraParameters
                                );
                              }}
                            >
                              格式化
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              type="button"
                              disabled={!llm.extraParameters}
                              onClick={() => {
                                setEditingCustomLlmParameters(false);
                                updateLlmSetting("extraParameters", "");
                              }}
                            >
                              清空
                            </Button>
                          </div>
                        </div>
                      </Block>
                    </Collapse>
                  </div>
                </Group>
              </Collapse>
            </div>

            <Notice>识别文本会发送到你配置的服务；失败时使用原文。</Notice>
          </div>
        </Collapse>
      </div>

      {isDoubao ? (
        <DoubaoTextTools
          key={`${providerRevision}-${account.revision}`}
          revision={providerRevision}
          signedIn={signedIn}
          onSignIn={() => {
            selectSection("recognition");
          }}
        />
      ) : null}
    </>
  );
}
