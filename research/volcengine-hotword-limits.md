# 火山引擎/豆包语音热词限制调查

调查日期：2026-08-10。结论只针对仓库当前代码实际调用的协议。

## 1. 代码对应产品/API

`src-tauri/src/asr.rs` 使用：

- WebSocket：`wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async`
- 资源标识：`volc.seedasr.sauc.duration`
- 首帧 `request.corpus.context` 是 JSON 字符串，内容形如： `{"hotwords":[{"word":"VoicePaste"}]}`。
- 启用热词时，代码把 `enable_nonstream` 设为 `false`，因此不使用文档所说的 `nostream` 5000 词路径。

这对应豆包语音“语音识别大模型 → 大模型流式语音识别 API”，而不是旧版“流式语音识别”页面，也不是自学习平台的 `boosting_table_id/name` 词表机制。官方产品目录将“大模型流式语音识别API”列为当前流式识别 API，并把“热词”列为自学习平台的独立功能：

- [大模型流式语音识别 API（官方）](https://www.volcengine.com/docs/6561/1354869?lang=zh)
- [豆包语音产品目录（官方，含当前/历史 API 链接）](https://www.volcengine.com/docs/6561/120573?lang=zh)
- [热词（自学习平台，官方）](https://www.volcengine.com/docs/6561/155739?lang=zh)

官方当前 API 文档明确把 `corpus.context` 定义为字符串，并分别说明热词直传与对话上下文的限制；这与仓库将 `Corpus.context` 定义为 `String` 相符。

## 2. 官方已公开的限制

| 项目 | 官方说明 | 对当前 `corpus.context.hotwords` 的适用性 |
| --- | --- | --- |
| 单词条数量 | 自学习平台热词表：每个文件最多 **5000 条热词**。 | 这是词表文件限制，不是 inline `context.hotwords` 的已证实限制；当前代码没有使用词表 ID。来源：[热词](https://www.volcengine.com/docs/6561/155739?lang=zh)。 |
| 单热词长度 | 自学习平台热词表：每条热词最多 **10 个字**。 | 仅明确适用于热词文件；官方未证明它适用于 inline `{"word":...}`。来源：[热词](https://www.volcengine.com/docs/6561/155739?lang=zh)。 |
| 词表数量 | 每个应用最多 **500 个热词文件**。 | 不适用于当前 inline 机制。来源：[热词](https://www.volcengine.com/docs/6561/155739?lang=zh)。 |
| 权重 | 词表格式为 `热词 | 权重`；权重 **1–10**，默认 **4**。 | 当前 JSON 只发送 `word`，没有 `weight`；官方未公开 inline `word` 的权重字段/范围。来源：[热词](https://www.volcengine.com/docs/6561/155739?lang=zh)。 |
| 语言/字符 | 热词文件支持中文、英文；数字和特殊符号建议改写为等效中文形式；除换行、空格外的标点不支持。 | 这些是词表文件编辑规则；inline `word` 的完整字符集/语言限制未公开。来源：[热词](https://www.volcengine.com/docs/6561/155739?lang=zh)。 |
| 单次请求使用词表 | 一次识别请求只能生效一张词表。 | 词表机制，不是当前 inline 数组的数量限制。来源：[热词](https://www.volcengine.com/docs/6561/155739?lang=zh)。 |
| inline 热词直传 | **双向流式支持 100 tokens；流式输入 `nostream` 支持 5000 个词。** | 当前代码使用双向流式优化端点 `bigmodel_async`，因此适用 **100 tokens** 限制；它不是 100 个字符。来源：[大模型流式语音识别 API](https://www.volcengine.com/docs/6561/1354869?lang=zh)。 |
| 请求总大小/总 hotword 字节数 | 官方页面未找到对当前 inline `corpus.context` 的“总字节数”或“总 hotword 字节数”上限。 | **未公开**。WebSocket 帧/JSON 的协议封装大小不能替代 API 字段限制。 |

## 3. 100 字符是否 API 要求？

**结论：API 有 100 tokens 限制，但没有 100 字符限制。** VoicePaste 的 100 字符上限是应用为了规避双向流式热词直传的 100 tokens 上限而做的近似校验。

官方原文区分两类限制：

1. 热词直传：双向流式 100 tokens，`nostream` 5000 个词；
2. 对话上下文：800 tokens、20 轮。

当前代码发送的是第一类 `{"hotwords":[{"word":"..."}]}`，所以 100 tokens 确实相关；但文档没有公开 tokenizer、JSON 结构是否计入、超限后截断还是报错，也没有规定字符到 token 的换算关系。

因此不能把 100 tokens 等同于 100 个字符：

- 中文常用字可能接近一字一 token，但这不是接口契约；
- 英文单词通常会让“100 字符”明显严于“100 tokens”；
- 生僻 Unicode、emoji 或特殊符号可能拆成多个 token，100 字符也不保证一定不超限；
- 前端当前用 JavaScript `string.length` 统计 UTF-16 code units，后端用 Rust `chars().count()` 统计 Unicode scalar values，两端对非 BMP 字符的计数还不完全一致。

## 4. 可确认与不可确认清单

- **可确认**：当前代码是大模型双向流式优化版；inline `corpus.context.hotwords` 适用 100 tokens；`nostream` 热词直传支持 5000 个词；自学习词表另有 5000 条、单条少于 10 字、权重 1–10 等规则。
- **不可确认/官方未公开**：inline 热词 tokenizer、单条 token/字符上限、数组条数上限、100 tokens 的精确计数范围以及超限行为。
- **不应混用**：自学习平台“每条少于 10 字/每表 5000 条”不能直接套到 inline 热词；100 tokens 也不能写成 100 字符。

## 5. 最终判断

VoicePaste 当前限制有 API 背景，但界面文案不够准确。安全的最小调整是保留保守限制，同时把“最多 100 个字符”改成“接口上限为 100 tokens；当前按字符数保守控制”。若要真正放宽英文热词，必须获得官方 tokenizer/计数规则或通过真实接口验证；若需要大量热词，应改用自学习平台词表，而不是继续扩大 inline 数组。
