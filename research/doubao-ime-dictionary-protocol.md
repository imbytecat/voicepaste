# 豆包官方个人词库：协议证据与当前阻塞

更新：2026-10-05。目标：在 Linux VoicePaste 中管理用户自己的豆包官方个人词库，并证明它参与账号语音识别。**读取、测试词新增/属性更新、语音上下文上传及单词 ASR 增强已通过真实实验；删除/清空没有通过，旧 `start_version_seq` 也未阻止提交。实验探针不是产品接入，当前版本不开放豆包词库写操作。**

此前执行了 APK DEX 解码、ELF 符号/重定位/虚表/分派表恢复及 AArch64、Windows x64 反汇编，并完成第 1–10 节所述只读验证。用户随后明确允许修改词库测试；第 11–12 节记录备份后的真实写入与残留。全程只使用 VoicePaste 已授权会话，不读取其他应用或浏览器凭据，不披露原有私有词条、UID/DID、令牌、密钥或签名 URL。

## 1. 两条链路已区分

1. **官方个人词库同步**：版本查询、上传二进制对象、push 提交、pull 取得下载地址。账号词库的完整记录和同步元数据属于这条链路。
2. **语音上下文**：本地词库经筛选、去重和时间窗口投影后，上传 `/api/v3/context/ime/user_words`。不是官方词库的 CRUD，也不保留完整记录或删除信息。

扫码登录、账号接口校验和账号 ASR 成功，不证明词库接口已授权或词库已参与 ASR。基础 ASR 的既有实测见 [识别验收记录](doubaoime-asr-validation.md)。

## 2. 已恢复的实际同步协议

Android 1.4.6 包同时有 `libkeyboard.so` 和 `libshell.so` 中的引擎代码。JNI 的实际引擎分派需跟到 `libshell.so`，不能把另一个副本的地址直接当运行时证据。关键分支已做双副本交叉核对。

| 操作 | 恢复事实 | 主要证据 |
| --- | --- | --- |
| 查询版本 | `GET https://ime.doubao.com/api/v2/sync/version?sync_type=2`，无请求体 | 实际 `libshell.so` GetVersion `0x3890c4`；方法 0 写入 `0x3891b8`；query 字段 `0x3891dc`；Java HostNetworkExecutor 将方法 0 映射为 GET |
| 拉取 | `GET /api/v2/sync/pull?sync_type=2&start_version_seq=<uint64>`，无请求体 | SyncNetworkClient Pull 构造及 ParsePullResponse；个人词库类型为 2，不借用类型 1 常用语协议 |
| 成功包络 | JSON `code=0` 且 `data` 为对象；版本读取 `data.last_version_seq` 非负整数 | native 响应解析与类型检查 |
| 拉取结果 | `data.data_type` 与 `data.url`；客户端允许空类型或 `full`，其他类型拒绝 | ParsePullResponse `libkeyboard.so 0x50a650`；处理器 `0x528204` |
| 上传 | `/api/v2/stream/sync/upload` 上传 protobuf 控制流；`Content-MD5` 是二进制 MD5 的 Base64，不是十六进制 | SyncUploadTaskControl writer `0x6a4234` 及上传请求构造 |
| 提交 | `/api/v2/sync/push` JSON 含 `sync_type`、`start_version_seq`、`object_key`、`data:[]` | SyncNetworkClient Push 构造；上传暂存和 push 提交是两个动作 |

上传嵌套结构已恢复：

- `SyncUploadTaskControl`：字段 1 设备类型，字段 2 `SyncUserDictPackage`，字段 3 平台枚举。
- package 字段 1 为 repeated `SyncUserDict`。
- dict 字段 1 信息、字段 2 类型枚举、字段 3 统计、字段 4 repeated entry。
- entry 字段 1 公共属性，oneof 字段 100 为拼音用户词。
- 拼音用户词：字段 1 packed uint32 音节 ID，字段 2 UTF-8 输入串，字段 3 packed uint32 UTF-16 词单元；不是简单 `word:string`。
- 实际 `libshell.so` exporter `0x3b9a64` 区分 FULL=1、INCREMENTAL=2；`0x3baffc..0x3bb018` 排除频率 0 和早于 cutoff 的记录。零词条上传被抑制。

**没有证明：** FULL 会按缺失记录删除云端词、`start_version_seq` 是原子 CAS、服务端冲突码、提交幂等保证、逐词删除墓碑和安全清空语义。不能把另一个常用语协议的 DELETE 搬到个人词库。

## 3. 下载对象不是上传 protobuf

下载对象是编译后的 `usr_side_dict.dat`。实际 `libshell.so` 校验路径 `0x27064c..0x2706e4`，另一个副本校验器 `0x632a98`：

- 48 字节小端头，12 个 u32：magic `0x2f0c`、版本 `20260710`、头长、文件长、节点数量/偏移/字节数、数据数量/偏移/字节数、扩展区偏移/字节数。
- 节点为 10 字节：u16 音节、u32 首子节点、u32 数据偏移；后一节点提供区间结束信息。
- 词条数据保留 UTF-16LE 文本、输入串、标志和属性记录；不是仅文本数组。扩展区有字段数量、属性布局、逻辑时间、同步版本、时间戳和 MD5。
- 校验摘要计算前将同步版本对应字节归零，并将摘要存储区改为 ASCII `0`；不能用直接整文件 MD5 代替。
- native 有 40000 条目上限及布局校验。

公开的 [taxueseek/ime-lexicon 格式记录](https://github.com/taxueseek/ime-lexicon/blob/main/skill/references/formats.md)描述的是另一种 `usr.dat`，且明确区分 `usr_side_dict.dat`，因此不能直接复用其编解码器。[ejjcc 的导入工具](https://github.com/ejjcc/third-party-dict-to-doubao-ime)依赖已安装的 macOS 引擎，不是 Linux 可直接使用的独立词库接口。本轮未执行这些第三方工具。

实际运行库的 452 项音节 ID ↔ 拼写表已恢复，并与独立长度表逐项核对通过；这不等于已解决任意中文词的分词、多音字、正确发音及元数据初始化。看似可用的 `Jni_InsertUsrClause` 在实际拼音引擎的 task `0x1f` 分派到 `0x295cac`，返回初始化默认值 2（不支持）；不能只凭导出函数名搭一个假的插词实现。

## 4. 语音词库投影已找到，但不能当同步替代品

实际运行链路：JNI → `libshell.so` PinyinEngineTask → `UsrDict` collector `0x29c5cc` → `speech.B#i` → `/api/v3/context/ime/user_words`。

发送体包含 `user` 元数据、可选 `user_words:[{word,class,time,freq}]`、`common_words:[string]`、其他独立上下文字段与 `additions:{}`。个人词有时间窗口、频率非零、去重、长度筛选和总计 500 UTF-16 单元的投影限制。空数组不用于清空；没有记录 ID、删除操作或确认版本。

`B$d#invokeSuspend` 先推进本地上传时间戳，之后只记录 `x-api-status-code`；未比较成功码、解析业务确认或回读。**调用返回不能视为服务成功接受。** VoicePaste 不能照搬这种确认方式。

ASR 的 `extra.context` 是 Base64 的聊天/位置/输入场景信息，不是此词数组。`disable_user_words` 对应个人数据云端使用开关；`last_uid` 来自先前账号记录。静态调用关系不等于当前私有服务已接受请求或识别效果已验证。

`clear_lexicon` 来自官方退出时的清除本地数据选择，并会传到后续上下文登录；服务端具体删除范围未证实。它不是无害初始化参数，本轮未调用。

## 5. 认证、原始失败与已验证根因

静态恢复的输入包括：

- Passport 全局 token hook `com.ss.android.account.token.c → token.w.d`，返回的请求头受 SDK 会话、TicketGuard 等动态状态影响，不只是一个公开常量。
- BDInstall Level.L1 的应用、设备、安装和版本 query 参数。
- `use-olympus-account=1` 是 **URL query**：DEX `input.ttnet.g.a#a +0x98` 写 URL builder，`+0xa6` 安装新 URL；只有 `not-use-olympus-account` opt-out 是内部 header。
- 请求拦截器添加 `x-tt-e-k=<已有 DID>+W`、`x-tt-e-b=1`、`x-metasec-bp-body-compress=1`。其中 `e-k` 是 SDK 内部控制输入，不能原样发送来代替传输层握手；成功分支会移除它。
- `x-tt-e-r` 是 SDK 合成的诊断结果，不是服务端签名。服务端可以返回未加密 JSON；本轮成功读取就是这种情况。

对同一份用户已授权的 VoicePaste 会话、同一已注册设备，进行了四组有静态依据的 GET 检查：

1. `x-tt-token + sdk-version=2`，`sync_type=2`。
2. 增加已注册设备的 Level.L1 query 与实际客户端 UA；此时 Olympus 字段误放 header，后续根据字节码纠正。
3. 将 `use-olympus-account=1` 放入正确的 URL query。
4. 在无请求体 GET 上增加上述三个实际拦截器控制头；未宣称实现底层加密。

四组词库版本请求均为 **HTTP 403**，后续诊断确认 `application/octet-stream`、15 字节，没有可解析的业务成功包络。独立对照 `passport/account/info/v2/` 返回 **HTTP 200、JSON、有效账号**。未轮换设备、注册新身份、换用他人令牌或尝试写入。

上述 403 后续确认包含“路由已封禁”。这并不证明域名永久关闭或账号无权限：2026-10-05 补齐实际 TTNet 握手后，同一应用、同一既有设备、同一原始 VoicePaste 账号令牌的版本读取成功。没有通过换域名、换账号或重新注册设备绕开错误。

## 6. 继续实现所缺的前提

1. 可确认的逐词删除/清空语义：第 11 节真实实验中，INCREMENTAL/FULL 零频提交均未删除测试词，空本机词库 FULL 提交返回业务错误。不能将“HTTP 200”视为操作完成。
2. 并发保护：已实证旧 `start_version_seq` 仍可提交新对象，不能把该字段当 CAS。原生增量合并和同一对象重放的单次成功，不保证任意覆盖、文本替换、其他设备贡献删除或所有重试均安全。
3. 任意新词的读音/元数据构造及产品端完整交互：测试词使用已核对的四个音节和明确的本机学习状态，不等于已解决任意多音词或把云 side 快照直接当本机 learned 词库。语音增强的正向证据目前限于第 12 节的单词、账号及设备。

已实现的唯一活动渠道、独立设置、火山词库生命周期和真实桌面验证不替代以上缺口。产品界面继续如实说明豆包官方词库未接入，不发布假的同步按钮或上下文替代实现。

## 7. 已通过的真实读取与传输层握手

公开 TNC 配置请求 `https://tnc3-bjlgy.snssdk.com/get_domains/v5/` 对 Android 应用 `401734` 与桌面应用 `685343` 均返回 HTTP 200、`message=success`。配置 `encrypt_config_v1.enabled=1`、`ver=3`，允许主机包含 `ime.doubao.com`，协商地址为 `https://keyhub.zijieapi.com/handshake`。这里只查询公开应用配置；不把默认配置响应称为某个已安装 Mac 的缓存状态，也未保留备用票据或备用对称密钥。

原生 macOS `libsscronet.dylib` 的实际握手实现位于 `0x3befbc`、JSON 构造 `0x3c1d6c`、响应检查 `0x3c2198`、KDF `0x3c3100`。协议随后在 Linux 上用 VoicePaste 自己已注册的 Android 设备实测成功：

1. 本机新生成 P-256 密钥对与 32 字节随机数。JSON 使用 `version=2`、`app_id`、原始 `did`、Base64 随机数、`key_shares:[{curve:"secp256r1",pubkey:<SEC1 公钥>}]`、`cipher_suites:[4097]`。配置版本 3 与握手版本 2 不是同一字段。
2. 使用这对新密钥对原样发送的 JSON 做 ECDSA-SHA256，DER 签名再 Base64，放入 `x-tt-s-sign`；不是复制官方客户端私钥或伪造厂商证明。握手请求不带账号令牌或 Cookie，HTTPS 正常验证证书。
3. 实际响应 HTTP 200。使用响应 PEM 证书的 EC 公钥验证 `x-tt-s-cert-sign` 对原始响应 JSON 的签名，再用服务端 key-share 公钥验证 `x-tt-s-sign` 对前一签名头原始文本的签名；两项均通过。P-256 ECDH 与 HKDF-SHA256 派生成功。
4. 空 GET 使用服务端真实签发的 `x-tt-e-t` 票据、新随机 12 字节 nonce 的 Base64 `x-tt-e-p`，保留 `x-tt-e-b=1`，不发送内部 `e-k`，不虚构 `e-h` 或 `e-d`。
5. 原版本端点返回 **HTTP 200、业务码 0、有效 `last_version_seq`**。全量 pull 使用 `start_version_seq=0`，返回 **HTTP 200、业务码 0、`data_type=full` 和下载地址**。这两次读取响应均为未加密 JSON；后续第 12 节的 context 写入收到了真实加密响应并成功解密。
6. 从返回的 HTTPS `lf11-ime-pts-sign.doubaocdn.com` 地址下载成功，未向 CDN 发送账号 Cookie、令牌或握手票据。真实文件通过头部/区间/节点排序、MD5、UTF-16 与属性布局检查，解析出 **573 条记录、544 个不同词文本**。不同发音或属性可对应相同文本，不能按文本去重后回写完整词库。
7. 补验完整稳定快照链：版本查询 → 全量 pull → 下载与完整校验 → 再查版本及当前账号，前后版本和账号均一致。本次读取为 **585 条记录、555 个不同词文本**，较前次增加，说明其他客户端确实会更新云库；探针仍为零云端写入，不能用前一次快照盲目全量覆盖。

上述读取探针没有词库云端写入，也未替换产品账号状态或配置。该证据证明这条请求的 403 根因为缺失实际传输握手，不证明任意其他拒绝都有相同原因。随后经用户明确授权执行的写入、并发边界和语音关联实验见第 11–12 节。

## 8. 火山实际闭环补验

随后已找到用户自己的有效火山凭据，独立调用真实 Rust 词表客户端完成临时词表创建、更新、回读、带该词表的真实 ASR 最终结果、删除及清理确认。原有 4 个词保持不变。验证不依赖 mock，也没有在产品中重新接入旧凭据别名；不能再把“缺少有效 Key”列为当前阻塞。带词表识别成功不等于已量化对照准确率提升。

## 9. macOS 新增、撤销与删除边界补查

对当前 macOS 1.0.1 / 1000103 的 `DoubaoIme`、`DoubaoImeSettings`、`OimeEngine` 继续追踪实际 producer/consumer，26 项离线指令与元数据断言通过，未执行任何云写入：

- app 撤销输入 → `ImeEngine rollback` → `Engine::Rollback` → `UsrDict::Rollback`（`OimeEngine 0x1a131c`）只恢复最近一次本地学习的旧频次、伪时间和 flags，不接收任意云记录 ID。首次新增回滚后频次为 0；实际上传 callback `0x32566c` 直接省略频次 0，因而“新增并同步后再撤销输入”不是云删除协议。
- 内部 task 43 `ForceToCommit`（`0x1d3544`）可通过官方 `SysDict::Zhuyin` 生成音节，并以频次 1、本地伪时间加 1、当前时间和来源 flags 学习新词；同时会更新 bigram/history。没有证明这是可供 Linux 直接调用的设置编辑接口，也不能把下载的云 side metadata 当成本地生成器状态。
- 实际上传只构造 oneof100 用户词及 side 元数据；101–103 的已发现构造者是 protobuf 复制、合并、解析和 New thunk，不是已发现的删除 producer。同步任务 generation 的消费方是 `IsCurrentTaskLocked`，用于排除本地过期回调，不是云端 reset epoch。
- macOS ASR 的真实 `getASRUserWords` → `AsrGetUserWord`（`0x1d0468`）枚举本地学习词，经频次、模型分数、长度和 500 UTF-16 单元上限筛选后交给 `ASRContext.HotwordContext`；它不枚举下载的云 side 记录。不能宣称拉到的全部云词已参与识别。
- 已解析的 macOS x86_64 `Engine::ClearUsrDict(bool)` 调用 `UsrDictsManager::Clear`、`ClearNerDict` 等本地清理，并关联 `SyncTaskManager::OnLocalUserDictClear` → `CancelInflightLocked`/`ClearInflightRuntimeLocked`。直接调用分析未发现上传或 push 构造，但网络客户端虚调用尚未逐一解析，不能据此排除间接云端操作。三端静态字符串扫描未发现专用个人词库删除端点；字符串缺失不证明服务不存在删除能力。

该缺口不是缺账号，也不是等待用户补一次登录。当前客户端的正向执行链仍未给出个人云词逐条删除、删除确认或并发提交契约；[官方隐私政策](https://lf3-cdn-tos.draftstatic.com/obj/ies-hotsoon-draft/wave_ime/ime_privacy_policy.html)说明整库清空入口，也没有提供上述操作级保证。不能将“未找到可安全调用的删除协议”夸大成“服务永远没有删除接口”；同样不能在确实存在其他写入者的真实词库上猜测墓碑、空 FULL 或用旧快照覆盖来试验撤销。

## 10. 真实 ASR 个人词开关对照

2026-10-05 再次完成稳定快照检查，读到 607 条记录、576 个不同文本，账号及读窗口内版本一致。下载服务实际返回过 `lf11-ime-pts-sign.doubaocdn.com`、`lf5-ime-pts-sign.doubaocdn.com` 等区域节点；签名地址会过期，不能永久缓存旧地址或把单个 CDN 节点当固定接口。

从已校验快照中确定性选取 3 个四字中文词，使用本机离线 Mandarin TTS 生成音频；未将词文本交给第三方 TTS，未记录词文本或识别全文。对每段相同音频，使用同一 VoicePaste 设备和账号各执行一次 `disable_user_words=true/false`，其他会话字段保持一致；均传空 context，并关闭体验改进标记。6 次真实会话均收到最终结果和 `SessionFinished`，没有调用词库写接口或上下文上传接口：

| 样本 | 禁用个人词时命中目标文本 | 启用个人词时命中目标文本 |
| ---- | ------------------------ | ------------------------ |
| 1    | 否                       | 否                       |
| 2    | 是                       | 是                       |
| 3    | 是                       | 是                       |

结论限定为：这 3 个样本未观察到开关带来的识别提升，不能据此确认云词库已参与 ASR，也不能反向断言所有个人化均无效。基础账号 ASR 的真实成功与词库增强效果必须分开报告；不会把“请求成功”或“识别出已有常见词”当成词库关联已验收。

## 11. 用户授权后的真实单词变更实验

用户明确允许修改词库后，先做版本前后检查、完整二进制/JSON 解码备份与落盘回读；初始为 **611 条记录**，测试词不存在。备份保留在本机 `~/.local/share/voicepaste-verification/`，独立目录权限 `0700`、文件 `0600`，不进入仓库，也不包含登录令牌或握手密钥。备份保留原始数据，**不等于已证明可一键恢复云端**。

仅使用新建的公开测试词 **“语贴验词”**：`input=yutieyanci`，音节 `[408,365,398,84]` 已与实际 `libshell.so` 表逐项核对为 `yu/tie/yan/ci`；设备枚举 MOBILE=1、平台 ANDROID=1 由实际 enum 初始化指令确认。本验证客户端此前没有上传 learned 词库，首次学习使用频次 1、伪时间 1、当前秒级时间和 flags=0；并未把原有云 side 数据冒充本机 learned 数据。

上传使用恢复的 protobuf、明文 protobuf MD5 的标准 Base64、当前 TTNet 密钥/票据及每请求新 nonce；POST body 采用 ChaCha20，密文与明文等长。先 upload 取得对象，再以已验证版本 push，最后重新 pull、校验文件与逐记录核对。`X-Ss-Req-Ticket` 为实际 native 时钟链对应的毫秒时间。

| 实验 | 服务响应 | 真实回读/效果 |
| --- | --- | --- |
| 新增测试词 | upload/push 均接受，版本推进 | 611→612 条，测试词唯一，频次 1 |
| 修改测试词属性 | upload/push 均接受 | 频次 1→2、伪时间 1→2，其他记录不变；这不是任意文本编辑已验收 |
| INCREMENTAL 提交频次 0 | 接受，版本推进 | 频次仍为 2，仅伪时间/时间更新；**未删除** |
| FULL 提交同一测试词频次 0 | 接受，版本推进 | 频次仍为 2；**未删除**，其他记录仍保留 |
| 新对象使用已知旧 `start_version_seq` | 接受 | 新伪时间实际应用；该字段未提供本次所需的版本前置拒绝 |
| 重放同一已确认对象及请求内容 | 接受 | 测试词属性和当前版本均未变化；仅证明这次对象重放没有重复应用 |
| 空本机 learned 词库 FULL，加当前 side 元数据 | upload 成功，push 为 HTTP 200 / **code 900102006 / internal error** | 回读不变；**未重置云端词库** |

每个写入窗口都比较了前后全部非测试词的完整 key 与属性：原有记录删除数、其他记录属性变化数均为 **0**。其他客户端在实验间隔继续增加词条，最后一次本轮回读为 **627 条**；不能用最初 611 条旧快照覆盖来撤销测试。

**残留与发布边界：** 最近一次真实回读中，canonical 云词库仍有 1 条“语贴验词”，频次 2；尚未找到并验证能安全删除该词的客户端操作。第 12 节仅证明固定音频在未上传 context 时未命中，不能推广为该词不影响任何账号 ASR。没有把失败的删除/重置说成清理完成，也未继续猜测全库清空接口。当前产品没有接入这些实验写路径，仍如实显示豆包官方词库未接入；不能将本版宣传为完整云词库 CRUD，也不能在产品中把这些服务响应映射成虚假的“已删除”。

## 12. 新增测试词的语音增强与行为撤回

基于第 11 节已在 canonical 云库回读确认的频次 2 测试词，只上传该词到真实 `/api/v3/context/ime/user_words`。使用从 APK 实际请求构造恢复的 context 路由键（与 ASR 路由键不同）、同一账号/设备、真实词条时间与频次；体验改进关闭，编辑器包名为空串，不附加其他词、contacts 或常用语。没有调用 context login/logout 或 `clear_lexicon`。

context 上传得到 **HTTP 200、`x-api-status-code=20000000`**；返回带加密头的响应，使用响应 nonce 成功解密为 `{}`。它没有逐词回执或 context 版本，因此额外执行了真实 ASR 对照，而不是只以请求成功判断效果。

固定公开句“请记录语贴验词，语贴验词。”由本机离线 Piper 合成，16 kHz/单声道/S16LE，同一 WAV SHA-256 为 `6e5e7a6f475d4ba9dfb70fd81f39b8e9a8af60c23f3a8b0d9fcd717e5f5738f1`；没有向第三方 TTS 发送词文本。各场保持相同音频和账号/设备，每次建立新会话，所有场次均收到 Final、`SessionFinished` 与状态码 `20000000`：

| 阶段 | 禁用个人词 | 启用个人词 |
| --- | --- | --- |
| 仅有 canonical 测试词、尚未上传 context | 不命中 | 不命中 |
| 单词 freq2 context 上传后 | 不命中，全文与上传前关闭场相同 | **精确命中“语贴验词”** |
| 同一测试词 freq0 context 实验后 | 不命中 | 不命中；间隔 5 秒再次开启测试仍不命中 |

freq0 context 也得到 HTTP/API 成功及 `{}` 响应。原有增强在两个开启场不再复现，构成**该单样本的行为撤回证据**；没有逐词回读/删除回执，不能断言服务端物理删除、长期或跨设备清理。canonical 测试词同期仍为 freq2，说明不能将 context 效果撤回等同于 canonical 删除。

这次正向对照比第 10 节更进一步：确认了该账号/设备上的单词 context 与 ASR 开关实际关联。它不保证任意词、真人发音、其他设备或长期效果，也不意味着当前产品已实现这条上传链。
