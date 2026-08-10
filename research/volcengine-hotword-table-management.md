# Volcengine 热词表管理与 VoicePaste 评估

调查日期：2026-08-10。范围：官方 Volcengine 文档；未由官方明确说明的内容标为“未知/推断”。

## 结论

`enable_nonstream=false` 不是直传热词的官方限制，而是 VoicePaste 自己的策略。当前 `asr.rs` 只要启用 inline 热词，就同时关闭 `enable_nonstream` 和 `enable_ddc`；引入该逻辑的提交说明是“avoid second-pass rewrites when hotwords are active”。官方文档只把 `enable_nonstream` 定义为双遍识别开关，没有声明它与 `corpus.context.hotwords` 互斥。来源：[大模型流式语音识别 API](https://www.volcengine.com/docs/6561/1354869?lang=zh)。

换成 managed 热词表，确实更适合数百到数千条词：请求只传 `boosting_table_id/name`，不再受双向流式 inline 热词约 100 tokens 的限制。官方同时提供基于新控制台 `X-Api-Key` 的热词表 CRUD 入口，因此不一定需要额外 AK/SK。它不能自动证明双遍结果都会应用热词；官方没有明确说明 managed table 对首轮流式和二轮 nostream 的具体作用范围，发布前仍需真实接口测试。

建议保留 inline 作为默认小词表模式，新增显式的“云端大词库”模式，而不是全部切换。前者无需远端资源管理；后者允许更多热词，但会把词表持久化到火山引擎，并引入同步、配额和失败状态。

## VoicePaste 当前路径

- endpoint：`wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async`；resource id：`volc.seedasr.sauc.duration`。
- 鉴权：WebSocket 握手发送 `X-Api-Key`、`X-Api-Resource-Id`、`X-Api-Connect-Id`。热词管理 API 同样支持新控制台 API Key，但使用单独的 HTTP proxy endpoint。
- 有 inline 热词时，`enable_nonstream` 和 `enable_ddc` 都设为 `false`；无热词时都设为 `true`。
- 当前代码没有 `boosting_table_id/name`，也没有热词表 CRUD。

## 直传与 managed table

| 方式 | 官方可确认 | 评估 |
| --- | --- | --- |
| `corpus.context.hotwords` | 双向流式约 100 tokens；nostream 最多 5000 个词。 | 每次请求携带，保存后立即用于下一次识别，无 CRUD；适合个人小列表。 |
| `boosting_table_id/name` | 大模型流式 API 列出词表字段；自学习平台支持创建、更新、查询、删除词表。 | 请求只带标识，适合大词库；词表会在云端持久化，需要同步状态和错误处理。 |

### 限制

- 自学习平台产品页公开：单表最多 5000 条、每应用最多 500 个热词文件、单条少于 10 个字；词条支持 `词|权重`，权重 1–10，默认 4；一次识别请求只能使用一张词表。来源：[热词](https://www.volcengine.com/docs/6561/155739?lang=zh)。
- 管理 API 另提供 `ListBoostingTableLimits`。官方响应示例是单表 1000 条、总计 5000 条、10 张表，与产品页上限不同；这些值可能按账号或接入方式变化。实现必须查询实际配额，不能硬编码 1000 或 5000。来源：[热词管理 API v1.1](https://www.volcengine.com/docs/6561/1742791?lang=zh)。
- inline 双向流式约 100 tokens、nostream 最多 5000 词。官方未公开 tokenizer、100 tokens 的精确计数范围、单条 inline 上限或超限行为。来源：[大模型流式语音识别 API](https://www.volcengine.com/docs/6561/1354869?lang=zh)。
- 官方 FAQ 称识别/字幕请求传入热词后即时生效，但未说明 managed table 更新后的索引传播延迟、旧连接行为或回滚机制。来源：[常见问题](https://www.volcengine.com/docs/6561/155743?lang=zh)。
- 官方未公开 managed table 在 `bigmodel_async` 首轮流式和 `enable_nonstream` 二轮中的分别生效规则；必须实测。

## 热词管理 API v1.1

官方入口：[热词管理 API v1.1](https://www.volcengine.com/docs/6561/1742791?lang=zh)。

- 新控制台 API Key 路由：`https://openspeech.bytedance.com/api/proxy/invoke?Action={Action}`。
- 鉴权：请求头 `X-Api-Key: {YOUR_API_KEY}`。文档明确以 `ListBoostingTable` 展示该方式，并说明其余参数与签名方式相同。
- 管理能力：`ListBoostingTableLimits`、`CreateBoostingTable`、`CheckBoostingTableName`、`UpdateBoostingTable`、`DeleteBoostingTable`、`ListBoostingTable`、`GetBoostingTable`。
- 创建和更新使用小于 8 MB 的 TXT 文件；删除、列表和查询使用 JSON。
- 旧路由 `open.volcengineapi.com` 使用 AK/SK HMAC 签名；VoicePaste 没必要优先接入这条更复杂的路径。
- 文档的 AK/SK 参数表要求 `AppID`，但 `X-Api-Key` 示例省略 `AppID`。API Key 是否已唯一绑定应用、创建/更新调用是否也可省略，仍需用真实 VoicePaste API Key 验证。
- 官方没有说明 CRUD QPS、更新传播时间、并发修改冲突或跨设备所有权策略。

## 隐私、可靠性、UX

- inline：热词虽然仍会随每次识别请求发送给火山引擎，但 VoicePaste 不负责创建长期云端词表。
- managed table：词表会在火山引擎保存，不能静默启用。UI 应明确提示“上传并保存到火山引擎”，隐私说明也要同步更新。
- 同一 API Key 在多台设备使用时，固定表名会产生覆盖竞争。最小实现应保存服务端返回的 table ID，只在用户点击“保存”时更新，不做后台自动轮询。
- 云端同步失败不能丢失本地编辑内容；识别时只能使用最后一次成功同步的 table ID，并明确显示“未同步”。
- managed table 支持权重 1–10；VoicePaste 当前只有词条文本，首版无需增加权重 UI。

## 推荐迁移方案

1. 默认继续使用 inline，保留当前小词表的简单路径。
2. 增加用户显式开启的“云端大词库”模式；保存时用现有 API Key 调用 `ListBoostingTableLimits`，再创建或更新一张 VoicePaste 词表。
3. 本地保存 `boosting_table_id`、最后成功同步内容的哈希和同步错误；识别请求只发送该 ID。
4. 大词库模式恢复 `enable_nonstream=true` 前，至少实测：首轮流式命中热词、最终二次结果仍保留热词、更新后的词表何时生效。
5. 若只想先验证收益，最小实验是让用户在控制台创建一张表，VoicePaste 临时读取 table ID；实验通过后再做自动 CRUD。

这条路径能让用户添加更多热词，但不应把“更多”写死成 5000：实际可用数量以 `ListBoostingTableLimits` 返回值和单条格式校验为准。

### 官方链接

- [大模型流式语音识别 API](https://www.volcengine.com/docs/6561/1354869?lang=zh)
- [热词](https://www.volcengine.com/docs/6561/155739?lang=zh)
- [热词管理 API v1.1](https://www.volcengine.com/docs/6561/1742791?lang=zh)
- [常见问题](https://www.volcengine.com/docs/6561/155743?lang=zh)
