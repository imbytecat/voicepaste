# LLM 流式输出与 thinking/reasoning 参数调研

调查日期：2026-08-11。范围：VoicePaste 当前使用的 OpenAI-compatible Chat Completions、OpenAI、DeepSeek、阿里云百炼 Qwen/DashScope、OpenRouter、Ollama、Gemini OpenAI compatibility，以及 `async-openai 0.41.3`。

本文只引用提供方官方文档和 `async-openai` 官方源码，并使用以下标记：

- **[已验证]**：由所引第一方文档、源码或本仓库配置直接确认。
- **[推断]**：基于已验证事实给出的 VoicePaste 设计建议，不代表提供方承诺。
- **[未验证]**：第一方材料没有确认该兼容层或模型的具体行为；不能当作稳定契约。

## 结论

**[推断] 推荐契约：提供“提供方预设 + 高级额外请求体 JSON”，不要提供一个声称跨提供方通用的 thinking 开关。**

- 后端的可移植接缝应是一个**任意顶层 JSON 对象**，校验后浅合并到 VoicePaste 自己构造的 Chat Completions 请求体。
- UI 提供“无额外参数”以及 OpenAI、DeepSeek、Qwen/DashScope、OpenRouter、Ollama、Gemini 等预设；预设只是把准确 JSON 填入同一高级编辑框，不建立第二套配置来源。
- 可以把 UI 动作命名为“使用提供方预设关闭推理”，不能命名为“关闭推理（通用）”。同一个字段会被某些模型接受、某些模型拒绝、某些模型忽略；有些模型根本不允许关闭。
- VoicePaste 应只把 `choices[].delta.content` 归一化为可见后处理文本。`reasoning_content`、`reasoning_details`、`reasoning`、`thinking` 等字段不能混入最终粘贴文本。
- 提供方拒绝额外字段时，不应静默删除字段并自动重试；应展示原始错误，并提供明确的“本次不带额外参数重试”。静默回退可能违背用户明确要求，也可能造成第二次计费。

## 1. 没有一个跨提供方、跨模型通用的“关闭 thinking”字段

**[已验证]** 下列官方接口使用了不同的请求形状：

| 提供方 / 接口 | 官方关闭方式 | 关键限制 |
| --- | --- | --- |
| OpenAI Chat Completions | `"reasoning_effort": "none"` | 只有支持 `none` 的模型可用；官方明确说并非所有 reasoning 模型支持每个 effort 值。 |
| DeepSeek Chat Completions | `"thinking": {"type": "disabled"}` | `reasoning_effort` 用于调节已开启 thinking 的力度，不是关闭开关。 |
| Qwen / DashScope OpenAI-compatible | `"enable_thinking": false` | 只适用于 hybrid-thinking 模型；thinking-only 模型不能关闭。 |
| OpenRouter Chat Completions | `"reasoning": {"effort": "none"}` | `mandatory: true` 的模型会拒绝关闭。`exclude: true` 只隐藏返回的推理，不关闭内部推理。 |
| Ollama OpenAI compatibility | `"reasoning_effort": "none"` 或 `"reasoning": {"effort": "none"}` | 支持情况仍取决于模型；GPT-OSS 的官方 thinking 文档明确说 trace 不能完全关闭。 |
| Gemini OpenAI compatibility | `"reasoning_effort": "none"` | 仅可关闭允许关闭的 Gemini 2.5 模型；Gemini 2.5 Pro 和 Gemini 3 不能关闭。 |

**[推断]** 因此，VoicePaste 若只存一个布尔值 `disable_thinking=true`，仍必须知道提供方和模型，才能决定发送什么 JSON；对任意自定义 OpenAI-compatible 地址，它无法可靠完成该映射。通用布尔值不是可移植网络契约，最多只能是建立在提供方预设之上的 UI 便捷动作。

## 2. 提供方矩阵与准确请求 JSON

以下片段是要**浅合并到实际请求顶层**的 JSON。片段省略了 VoicePaste 自己控制的 `model`、`messages` 和 `stream`。

### 2.1 OpenAI Chat Completions

**[已验证] 关闭片段：**

```json
{
  "reasoning_effort": "none"
}
```

OpenAI Chat Completions 官方参考把 `reasoning_effort` 定义为顶层字段，当前列出的值包括 `none`、`minimal`、`low`、`medium`、`high`、`xhigh` 和 `max`，并明确说明不是所有 reasoning 模型都支持全部值。OpenAI reasoning 指南把 `none` 定义为不需要 reasoning 的低延迟场景，同时说明模型支持和默认值都不是通用的。来源：[Create chat completion](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create/)、[Reasoning models](https://developers.openai.com/api/docs/guides/reasoning)。

**[已验证] 不要混淆两个 API 的形状：**

- Chat Completions：`{"reasoning_effort":"none"}`。
- Responses API：`{"reasoning":{"effort":"none"}}`。

VoicePaste 当前调用 `/chat/completions`，不能把 Responses API 的嵌套对象当成 OpenAI Chat Completions 的标准字段。来源同上。

**[已验证] 流式形状：** 设置 `"stream": true` 后使用 SSE；可见文本位于 `choices[0].delta.content`，结束块可带空 `delta` 和 `finish_reason: "stop"`。若启用 `stream_options.include_usage`，`[DONE]` 前还可能有一个 `choices: []` 的 usage 块。来源：[OpenAI Chat Completions streaming example](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create/#chat-completions-create-streaming)。

```json
{
  "choices": [
    {
      "delta": { "content": "Hello" },
      "finish_reason": null
    }
  ]
}
```

**[已验证]** OpenAI reasoning tokens 不作为原始思维文本暴露给 API 调用方；它们计入 usage，但不形成一个应展示给用户的 Chat Completions 文本 delta。来源：[Reasoning models — How reasoning works](https://developers.openai.com/api/docs/guides/reasoning#how-reasoning-works)。

### 2.2 DeepSeek Chat Completions

**[已验证] 关闭片段：**

```json
{
  "thinking": {
    "type": "disabled"
  }
}
```

DeepSeek 当前 Chat Completions 参考把 `thinking.type` 定义为 `enabled` 或 `disabled`，默认 `enabled`。同一接口的 `reasoning_effort` 当前用于 `low`、`high`、`max` 等力度选择，不使用 `none` 关闭。来源：[DeepSeek Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion)、[Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)。

**[已验证] 流式形状：** `stream: true` 返回 data-only SSE，以 `data: [DONE]` 结束。thinking 模式中，推理片段位于 `choices[0].delta.reasoning_content`，最终回答位于 `choices[0].delta.content`。来源：[DeepSeek Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion)、[official streaming example](https://api-docs.deepseek.com/guides/thinking_mode_api_example_streaming)。

```json
{
  "choices": [
    {
      "delta": {
        "reasoning_content": "...",
        "content": null
      }
    }
  ]
}
```

```json
{
  "choices": [
    {
      "delta": {
        "reasoning_content": null,
        "content": "最终文本"
      }
    }
  ]
}
```

**[已验证] 特殊行为：** thinking 模式不支持 `temperature`、`top_p`、`presence_penalty`、`frequency_penalty`，但 DeepSeek 为兼容现有软件会静默忽略这些字段，而不是报错。来源：[Thinking Mode — Input and Output Parameters](https://api-docs.deepseek.com/guides/thinking_mode/#input-and-output-parameters)。这说明“请求成功”不等于“所有额外字段生效”。

### 2.3 Qwen / Alibaba Cloud Model Studio OpenAI-compatible

**[已验证] 关闭片段：**

```json
{
  "enable_thinking": false
}
```

阿里云百炼官方文档明确说明 `enable_thinking` 不是 OpenAI 标准参数；Python OpenAI SDK 通过 `extra_body={"enable_thinking": false}` 传入，Node.js 和直接 HTTP 请求则是请求体顶层字段。来源：[Use deep thinking models via API](https://www.alibabacloud.com/help/en/model-studio/deep-thinking)。

**[已验证] 模型限制：**

- hybrid-thinking 模型可用 `true` / `false` 按请求切换；不同模型默认值不同。
- thinking-only 模型不能关闭；此时不应发送一个暗示可以关闭的通用开关。
- 一些模型只支持 streaming；对这些模型发 non-streaming 请求会报 `parameter.enable_thinking only support stream call`。

来源：[Use deep thinking models via API — Usage, supported models and FAQ](https://www.alibabacloud.com/help/en/model-studio/deep-thinking)。

**[已验证] 流式形状：** thinking 模式先通过 `choices[0].delta.reasoning_content` 返回推理，再通过 `choices[0].delta.content` 返回最终回答；普通 OpenAI-compatible 流仍使用 SSE 和 `[DONE]`。来源：[Use deep thinking models via API](https://www.alibabacloud.com/help/en/model-studio/deep-thinking)、[Streaming output for Qwen models](https://www.alibabacloud.com/help/en/model-studio/stream)。

```json
{
  "choices": [
    {
      "delta": {
        "reasoning_content": "..."
      }
    }
  ]
}
```

```json
{
  "choices": [
    {
      "delta": {
        "content": "最终文本"
      }
    }
  ]
}
```

### 2.4 OpenRouter Chat Completions

**[已验证] 关闭片段：**

```json
{
  "reasoning": {
    "effort": "none"
  }
}
```

OpenRouter 把不同上游提供方的 reasoning 控制归一到 `reasoning` 对象；官方把 `effort: "none"` 定义为完全关闭 reasoning。来源：[OpenRouter Reasoning Tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)。

**[已验证] 不等价的“隐藏推理”片段：**

```json
{
  "reasoning": {
    "exclude": true
  }
}
```

这只让模型继续内部 reasoning、但不在响应中返回 reasoning tokens，不能用作“关闭推理”的实现。旧字段 `include_reasoning: false` 也只等价于 `reasoning.exclude: true`。来源同上。

**[已验证] 模型能力发现：** `GET /api/v1/models` 的模型对象可能带 `reasoning.supported_efforts`、`default_enabled` 和 `mandatory`。`mandatory: true` 表示 UI 应隐藏关闭控件，也不应发送 `effort: "none"`，因为模型会拒绝。动态路由模型可能没有这组元数据。来源：[OpenRouter Reasoning Tokens — Discovering per-model reasoning options](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens#discovering-per-model-reasoning-options)。

**[已验证] 流式形状：** 最终可见文本仍在 `choices[].delta.content`。结构化 reasoning 在流式响应中位于 `choices[].delta.reasoning_details`；OpenRouter 还可能发送以 `:` 开头的 SSE keep-alive 注释。来源：[OpenRouter Reasoning Tokens — Streaming Response](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens#streaming-response)、[OpenRouter Streaming](https://openrouter.ai/docs/api/reference/streaming)。

```json
{
  "choices": [
    {
      "delta": {
        "reasoning_details": [
          {
            "type": "reasoning.text",
            "text": "..."
          }
        ]
      }
    }
  ]
}
```

### 2.5 Ollama

VoicePaste 使用 OpenAI-compatible `/v1/chat/completions` 时，应采用兼容层明确列出的字段，而不是原生 `/api/chat` 的字段。

**[已验证] OpenAI-compatible 关闭片段：**

```json
{
  "reasoning_effort": "none"
}
```

或：

```json
{
  "reasoning": {
    "effort": "none"
  }
}
```

Ollama 的 OpenAI compatibility 页面把两种形状及 `none` 都列为 `/v1/chat/completions` 支持字段，并确认该端点支持 streaming 和 reasoning/thinking control。来源：[Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)。

**[已验证] 模型限制：** Ollama thinking 文档说明，大多数 thinking 模型的原生 `think` 可用布尔值或等级；GPT-OSS 只接受 `low`、`medium`、`high`，trace 不能完全关闭，布尔值会被忽略。因此，即使兼容端点认识 `none`，也不能推断每个底层模型都能真正关闭。来源：[Ollama Thinking](https://docs.ollama.com/capabilities/thinking)。

**[已验证] 原生 API 与兼容 API 不同：** 原生 `/api/chat` 的关闭字段是：

```json
{
  "think": false
}
```

原生流使用 NDJSON，推理在 `message.thinking`，最终回答在 `message.content`。它不是 OpenAI Chat Completions SSE 协议，不能直接交给 `async-openai` 的 `/chat/completions` SSE 流解析器。来源：[Ollama Thinking](https://docs.ollama.com/capabilities/thinking)、[Ollama native Chat API](https://docs.ollama.com/api/chat)。

**[未验证]** Ollama 官方 OpenAI compatibility 页面确认了兼容端点的 streaming 和 reasoning 控制，但该页没有固定承诺一个跨模型的“兼容层推理 delta 字段”。VoicePaste 应只依赖已确认的 OpenAI-compatible `choices[].delta.content` 作为最终文本，不应依赖某个未写入官方兼容契约的 reasoning 字段。

### 2.6 Gemini OpenAI compatibility

**[已验证] 关闭片段：**

```json
{
  "reasoning_effort": "none"
}
```

该片段只适用于允许关闭 thinking 的 Gemini 2.5 模型，例如可关闭的 Flash/Lite 类模型。Google 明确说明 Gemini 2.5 Pro 和 Gemini 3 不能关闭 reasoning；未设置时使用模型默认 thinking level/budget。来源：[Gemini OpenAI compatibility — Thinking](https://ai.google.dev/gemini-api/docs/openai#thinking)。

**[已验证] 不可组合：** `reasoning_effort` 与 Gemini 原生 `thinking_level` / `thinking_budget` 功能重叠，不能同时使用。Gemini-specific thinking config 可通过 compatibility 层的 `extra_body.google.thinking_config` 传递，但关闭可关闭的 2.5 模型时优先使用已明确映射的 `reasoning_effort: "none"`。来源同上。

**[已验证] 流式形状：** Gemini OpenAI compatibility 支持 `stream: true`，官方示例迭代 `chunk.choices[0].delta`。兼容支持仍标记为 beta。来源：[Gemini OpenAI compatibility — Streaming](https://ai.google.dev/gemini-api/docs/openai#streaming)、[Current limitations](https://ai.google.dev/gemini-api/docs/openai#current-limitations)。

**[未验证]** Google 的 OpenAI compatibility 页面没有为所有 Gemini 模型承诺一个统一的 reasoning delta 字段。VoicePaste 应依赖标准 `delta.content`；若未来要展示 thought summaries，应为 Google 的额外响应形状单独建模，而不是把它当成标准 Chat Completions content。

## 3. `async-openai 0.41.3` 能力与限制

### 3.1 当前 VoicePaste 配置

**[已验证]** `src-tauri/Cargo.toml` 固定 `async-openai = 0.41.3`，关闭默认 features，只启用 `chat-completion` 和 `rustls-no-provider`；当前没有启用 `byot`。`src-tauri/src/llm.rs` 使用 `CreateChatCompletionRequestArgs` 和 `chat().create(request)`，当前是 non-streaming，并只读取第一条 choice 的 `message.content`。

### 3.2 typed request 不是任意额外 JSON 接缝

**[已验证]** `CreateChatCompletionRequest` 是显式字段 struct，没有 `#[serde(flatten)]` 的任意扩展 map。它包含标准 `reasoning_effort`，所以可表达 OpenAI/Gemini/Ollama 的该标准形状；但不能直接表达 DeepSeek `thinking`、Qwen `enable_thinking`、OpenRouter `reasoning` 等未知顶层字段。来源：[0.41.3 CreateChatCompletionRequest source](https://github.com/64bit/async-openai/blob/async-openai-v0.41.3/async-openai/src/types/chat/chat_.rs#L739-L996)。

**[已验证]** 0.41.3 的 `ReasoningEffort` 枚举包含 `None`、`Minimal`、`Low`、`Medium`、`High`、`Xhigh`，不包含当前部分提供方文档中的 `max`。任意 JSON/BYOT 也因此比固定枚举更能承受兼容提供方扩展。来源：[0.41.3 ReasoningEffort source](https://github.com/64bit/async-openai/blob/async-openai-v0.41.3/async-openai/src/types/shared/reasoning_effort.rs#L1-L13)。

### 3.3 BYOT 是官方提供的 custom body 接缝

**[已验证]** 启用 `byot` feature 后，crate 为 API 方法生成 `*_byot` 泛型版本。官方 README 直接展示 `serde_json::Value` 请求，并把“OpenAI-compatible 请求/响应形状不完全一致”“用 serde flatten 扩展现有类型”列为用途。来源：[async-openai 0.41.3 README — Bring Your Own Types](https://github.com/64bit/async-openai/blob/async-openai-v0.41.3/async-openai/README.md#bring-your-own-types)、[0.41.3 Cargo features](https://github.com/64bit/async-openai/blob/async-openai-v0.41.3/async-openai/Cargo.toml#L22-L24)。

可用路径：

```rust
client.chat().create_byot(custom_serializable_request).await
client.chat().create_stream_byot(custom_serializable_request).await
```

**[已验证]** `create_byot` 要求调用方序列化的 body 自己保持 `stream: false`；`create_stream_byot` 要求 body 自己包含 `stream: true`。普通 typed `create_stream` 会自动设置 `stream = true`，BYOT 版本不会替调用方修正。来源：[0.41.3 chat.rs](https://github.com/64bit/async-openai/blob/async-openai-v0.41.3/async-openai/src/chat.rs#L29-L92)。

**[已验证]** 底层 client 会把任意 `Serialize` 请求用 `serde_json::to_vec` 序列化为 `application/json`，POST 到 `/chat/completions`；stream 版本在同一路径上建立 SSE 解析。来源：[0.41.3 client.rs](https://github.com/64bit/async-openai/blob/async-openai-v0.41.3/async-openai/src/client.rs#L393-L422)、[stream POST](https://github.com/64bit/async-openai/blob/async-openai-v0.41.3/async-openai/src/client.rs#L667-L688)。

### 3.4 streaming delta 的 typed 限制

**[已验证]** 0.41.3 的 typed `ChatCompletionStreamResponseDelta` 只声明 `content`、`function_call`、`tool_calls`、`role`、`refusal`，没有 `reasoning_content`、`reasoning_details`、`reasoning` 或 `thinking`。来源：[0.41.3 stream delta source](https://github.com/64bit/async-openai/blob/async-openai-v0.41.3/async-openai/src/types/chat/chat_.rs#L1138-L1200)。

**[推断]** 如果 VoicePaste 只需要最终可见文本，继续把 typed stream response 归一为 `delta.content` 即可；provider-specific reasoning-only 块应产生“无可见文本”事件并被忽略。若产品未来必须显示 reasoning/thought summaries，则要为响应也使用 BYOT 自定义类型或 `serde_json::Value`，不能只改请求体。

## 4. VoicePaste 可直接实现的后端契约

### 4.1 设置数据

**[推断] 最小持久化字段：**

```text
llm_extra_body_json: string
```

语义：

- 空字符串或仅空白：等价于 `{}`，不发送提供方额外字段。
- 非空：必须解析为一个 JSON object；array、string、number、boolean、null 均拒绝。
- 该 object 直接浅合并到 Chat Completions 请求顶层，不再包一层 VoicePaste 自定义键。
- 嵌套对象保持原样；不做跨对象 deep merge。
- JSON 使用严格语法，不接受注释和尾逗号。

**[推断] 合并顺序：**

1. VoicePaste 构造受保护的 base body。
2. 校验 extra object 不含 reserved key。
3. 将 extra object 的每个顶层键插入 base body。
4. 用 `create_byot` / `create_stream_byot` 发送。

示意：

```json
{
  "model": "provider-model",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "stream": true,
  "thinking": { "type": "disabled" }
}
```

### 4.2 reserved keys

**[推断] 下列顶层键必须拒绝由 extra body 覆盖：**

```text
model
messages
stream
stream_options
n
response_format
modalities
audio
tools
tool_choice
parallel_tool_calls
functions
function_call
```

理由：

- `model`、`messages`：应用身份、固定校对规则和 transcript 数据边界，不能被高级 JSON 替换。
- `stream`、`stream_options`：决定调用 `create_byot` 还是 `create_stream_byot`、结束和 usage 处理方式。
- `n`：VoicePaste 只消费一个确定的校对结果。
- `response_format`、`modalities`、`audio`：VoicePaste 的返回契约是单一纯文本。
- tool/function 相关字段：当前后处理没有工具循环，允许覆盖会产生无法正确消费的 tool-call 响应。

**[推断] 应允许的典型额外键：**

```text
reasoning_effort
reasoning
thinking
enable_thinking
think
extra_body
temperature
top_p
max_tokens
max_completion_tokens
stop
seed
```

是否生效由实际提供方和模型决定。允许不代表 VoicePaste 或 `async-openai` 为其语义背书。

### 4.3 流式归一化

**[推断] VoicePaste 对所有 OpenAI-compatible 提供方只公开一种内部事件：**

```text
VisibleTextDelta(string)
```

处理规则：

1. 只追加 `choices[0].delta.content` 中的非空字符串。
2. 忽略 reasoning-only 块：
   - DeepSeek / Qwen：`delta.reasoning_content`
   - OpenRouter：`delta.reasoning_details` / `delta.reasoning`
   - 其他未知额外字段
3. 允许首块只有 `role`、末块 `delta: {}`、usage 块 `choices: []`。
4. 收到 `[DONE]` 或正常 finish 后结束；若整个流没有任何 `content`，返回“没有可用文本”。
5. 原生 Ollama `/api/chat` 的 NDJSON 不进入此路径；VoicePaste 继续要求 OpenAI-compatible `/v1/chat/completions` 地址。

这使 thinking 开启时的等待块不会污染最终粘贴文本，也使关闭 thinking 的优化不成为正确性的前提。

## 5. 最小 UI

**[推断] 推荐两个控件：**

1. **提供方预设**下拉框：
   - 无额外参数
   - OpenAI：关闭 reasoning（支持 `none` 的模型）
   - DeepSeek：关闭 thinking
   - Qwen / DashScope：关闭 thinking（hybrid 模型）
   - OpenRouter：关闭 reasoning（非 mandatory 模型）
   - Ollama OpenAI compatibility：关闭 reasoning（模型允许时）
   - Gemini：关闭 reasoning（仅允许关闭的 2.5 模型）
2. **高级额外请求体 JSON**多行编辑框。

选择预设时，把本文件对应片段写入编辑框；保存时只保存编辑框这一份 JSON。这样预设与高级模式不会形成两套会冲突的状态。

**[推断] 不推荐：**

- 单独的“关闭 thinking”通用 checkbox：会掩盖提供方和模型差异。
- 自动按 base URL 猜提供方后静默发字段：代理、自建网关、OpenRouter 自定义路由和兼容层都可能让 URL 判断错误。
- 为每个提供方在后端增加独立长期配置 struct：用户已经允许任意兼容地址，最终仍需要 raw JSON escape hatch；多套 struct 只会复制同一个扩展问题。

**[推断] 可选增强：** OpenRouter 可在用户主动测试连接时读取官方模型 metadata，根据 `mandatory` / `supported_efforts` 禁用不适用的预设；不要把此能力假设成所有提供方都有。

## 6. 提供方拒绝字段时的 fallback

**[推断] 默认行为：失败可见，不静默自动回退。**

1. 本地 JSON 语法错误、非 object、reserved key 冲突：请求前直接拒绝，并指出具体键。
2. HTTP 4xx / 提供方参数错误：显示提供方原始错误，并说明当前附加的 preset/extra body。
3. UI 提供明确动作：**“本次不带额外参数重试”**。用户确认后只移除 extra body，保留 model、messages 和 stream 设置。
4. 不按错误文本自动删除某个键：不同提供方错误结构不同，有些还会静默忽略字段；错误字符串不是可移植 schema。
5. 不对超时、断流、5xx 自动做“去掉 extra body”重试：服务端可能已经开始生成或计费，第二次请求可能重复计费；而且这些错误没有证明 extra body 是原因。

**[推断]** 如果产品以后确实需要“尽最大努力可用”模式，应把它做成显式策略，例如“参数不受支持时允许回退到提供方默认”，并只在服务端明确返回参数校验 400/422、且尚未开始流式输出时重试一次。它不应是隐藏默认值。

## 7. 推荐预设清单

**无额外参数：**

```json
{}
```

**OpenAI Chat Completions（仅支持 `none` 的模型）：**

```json
{
  "reasoning_effort": "none"
}
```

**DeepSeek：**

```json
{
  "thinking": {
    "type": "disabled"
  }
}
```

**Qwen / DashScope hybrid-thinking 模型：**

```json
{
  "enable_thinking": false
}
```

**OpenRouter（mandatory reasoning 模型不可用）：**

```json
{
  "reasoning": {
    "effort": "none"
  }
}
```

**Ollama OpenAI compatibility（底层模型允许时）：**

```json
{
  "reasoning_effort": "none"
}
```

**Gemini OpenAI compatibility（仅允许关闭的 Gemini 2.5 模型）：**

```json
{
  "reasoning_effort": "none"
}
```

## 8. 最终建议

**[推断]** VoicePaste 应采用以下最小、干净的切换：

- 网络层：启用 `async-openai 0.41.3` 的 `byot` feature；用 `serde_json::Value` 或带 `#[serde(flatten)]` 的请求 wrapper 发送 base body + validated extra body。
- 返回层：non-streaming 可继续反序列化为 typed Chat Completion response；streaming 只归一化 `delta.content`，忽略 provider-specific reasoning 字段。
- 配置层：只持久化一份 extra body JSON；提供方预设负责填写它。
- 安全边界：拒绝 reserved keys，尤其 `messages`、`model`、`stream` 和会改变返回形状的 tool/format 字段。
- UX：不宣称 universal toggle；明确显示模型可能不支持关闭。
- fallback：不静默重试；让用户明确选择“去掉额外参数重试”。

该契约同时覆盖已知提供方字段和未来兼容服务扩展，而不会把某一家当前的参数名称固化成错误的跨提供方标准。
