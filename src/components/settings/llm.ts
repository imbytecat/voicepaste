import type { Brand } from "@/components/settings/brands";

export const LLM_BASE_URL_PLACEHOLDER = "https://api.deepseek.com/v1";
export const LLM_MODEL_PLACEHOLDER = "deepseek-v4-flash";
const RESERVED_LLM_PARAMETERS = [
  "model",
  "messages",
  "stream",
  "stream_options",
] as const;
export const CUSTOM_LLM_PARAMETER_PRESET = "custom";
export const LLM_PARAMETER_PRESETS: readonly {
  brands: readonly Brand[];
  description: string;
  id: string;
  label: string;
  parameters: string;
}[] = [
  {
    description: "不附加额外参数，由服务决定是否思考",
    brands: [],
    id: "default",
    label: "服务默认",
    parameters: "",
  },
  {
    description: "发送 thinking.type=disabled",
    brands: ["deepseek"],
    id: "deepseek-no-thinking",
    label: "DeepSeek · 关闭思考",
    parameters: `{
  "thinking": {
    "type": "disabled"
  }
}`,
  },
  {
    description: "发送 enable_thinking=false，仅混合思考模型有效",
    brands: ["qwen"],
    id: "qwen-no-thinking",
    label: "Qwen · 关闭思考",
    parameters: `{
  "enable_thinking": false
}`,
  },
  {
    description: "发送 reasoning_effort=none，部分模型会忽略或拒绝",
    brands: ["openai", "gemini", "ollama"],
    id: "reasoning-effort-none",
    label: "OpenAI 等 · 关闭推理",
    parameters: `{
  "reasoning_effort": "none"
}`,
  },
  {
    description: "发送 reasoning.effort=none，强制推理模型无法关闭",
    brands: ["openrouter"],
    id: "openrouter-no-reasoning",
    label: "OpenRouter · 关闭推理",
    parameters: `{
  "reasoning": {
    "effort": "none"
  }
}`,
  },
];

function normalizeJson(value: string): string {
  if (!value.trim()) return "";
  try {
    const parsed: unknown = JSON.parse(value);
    return JSON.stringify(parsed) ?? value.trim();
  } catch {
    return value.trim();
  }
}

export function detectLlmParameterPreset(parameters: string): string {
  const normalized = normalizeJson(parameters);
  return (
    LLM_PARAMETER_PRESETS.find(
      (preset) => normalizeJson(preset.parameters) === normalized
    )?.id ?? CUSTOM_LLM_PARAMETER_PRESET
  );
}

export function llmParameterError(parameters: string): string | null {
  if (!parameters.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(parameters);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return "必须输入一个 JSON 对象";
    const reserved = RESERVED_LLM_PARAMETERS.find((key) => key in parsed);
    return reserved ? `不能覆盖 ${reserved}` : null;
  } catch (error) {
    return `JSON 格式错误：${String(error)}`;
  }
}
