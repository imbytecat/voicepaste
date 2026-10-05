# 豆包官方个人词库：协议证据与当前阻塞

日期：2026-10-04。目标：在 Linux VoicePaste 中管理用户自己的豆包官方个人词库，并证明它参与账号语音识别。**尚未完成接入，不能将下述静态恢复当成服务已接受的实现。**

本轮执行了 APK DEX 解码、ELF 符号/重定位/虚表/分派表恢复及 AArch64、Windows x64 反汇编。只使用 VoicePaste 内用户已主动授权的会话进行了下述只读检查；未调用词库上传、push、删除、清空或上下文写接口，没有读取其他应用或浏览器凭据，没有输出用户词条、原始 UID、令牌或设备标识。

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

新增词的音节 ID 生成也未形成可靠独立契约。看似可用的 `Jni_InsertUsrClause` 在实际拼音引擎的 task `0x1f` 分派到 `0x295cac`，返回初始化默认值 2（不支持）；不能只凭导出函数名搭一个假的插词实现。

## 4. 语音词库投影已找到，但不能当同步替代品

实际运行链路：JNI → `libshell.so` PinyinEngineTask → `UsrDict` collector `0x29c5cc` → `speech.B#i` → `/api/v3/context/ime/user_words`。

发送体包含 `user` 元数据、可选 `user_words:[{word,class,time,freq}]`、`common_words:[string]`、其他独立上下文字段与 `additions:{}`。个人词有时间窗口、频率非零、去重、长度筛选和总计 500 UTF-16 单元的投影限制。空数组不用于清空；没有记录 ID、删除操作或确认版本。

`B$d#invokeSuspend` 先推进本地上传时间戳，之后只记录 `x-api-status-code`；未比较成功码、解析业务确认或回读。**调用返回不能视为服务成功接受。** VoicePaste 不能照搬这种确认方式。

ASR 的 `extra.context` 是 Base64 的聊天/位置/输入场景信息，不是此词数组。`disable_user_words` 对应个人数据云端使用开关；`last_uid` 来自先前账号记录。静态调用关系不等于当前私有服务已接受请求或识别效果已验证。

`clear_lexicon` 来自官方退出时的清除本地数据选择，并会传到后续上下文登录；服务端具体删除范围未证实。它不是无害初始化参数，本轮未调用。

## 5. 认证与四组只读实测

静态恢复的输入包括：

- Passport 全局 token hook `com.ss.android.account.token.c → token.w.d`，返回的请求头受 SDK 会话、TicketGuard 等动态状态影响，不只是一个公开常量。
- BDInstall Level.L1 的应用、设备、安装和版本 query 参数。
- `use-olympus-account=1` 是 **URL query**：DEX `input.ttnet.g.a#a +0x98` 写 URL builder，`+0xa6` 安装新 URL；只有 `not-use-olympus-account` opt-out 是内部 header。
- 请求拦截器添加 `x-tt-e-k=<已有 DID>+W`、`x-tt-e-b=1`、`x-metasec-bp-body-compress=1`。空请求体 GET 也添加这些控制头，但底层 TTNet/Metasec 的完整机制没有由此实现。
- 响应拦截器 `common.j.b.c` 对缺失 `x-tt-e-r` 的响应直接返回原响应，不构成“所有响应必须加密”的证据。

对同一份用户已授权的 VoicePaste 会话、同一已注册设备，进行了四组有静态依据的 GET 检查：

1. `x-tt-token + sdk-version=2`，`sync_type=2`。
2. 增加已注册设备的 Level.L1 query 与实际客户端 UA；此时 Olympus 字段误放 header，后续根据字节码纠正。
3. 将 `use-olympus-account=1` 放入正确的 URL query。
4. 在无请求体 GET 上增加上述三个实际拦截器控制头；未宣称实现底层加密。

四组词库版本请求均为 **HTTP 403**，后续诊断确认 `application/octet-stream`、15 字节，没有可解析的业务成功包络。独立对照 `passport/account/info/v2/` 返回 **HTTP 200、JSON、有效账号**。未轮换设备、注册新身份、换用他人令牌或尝试写入。

**结论：当前合法会话的私有词库访问条件尚未建立。不能把它归因于已确认的全站故障，也不能把账号有效等同于词库已授权。** 没有被接受的读取，就没有安全修改现有词库的基准。

## 6. 继续实现所缺的前提

1. 被词库服务接受的、用户授权的请求契约：需要官方接入信息，或在受控官方客户端上确认缺失的认证/传输行为；不能用猜测的 SDK/防护头充数。
2. 可控测试数据上的服务器确认：上传、提交、读取、并发修改、重复请求、删除及空库语义。不对真实个人词库做全量覆盖实验。
3. 新词音节和元数据的正确构造，以及词库同步成功后实际参与 ASR 的证明。
4. 火山真实云词表与识别验收还需要有效的用户 API Key；本轮系统凭据库中未配置，未用无效 Key 或 mock 结果冒充云端验收。

已实现的唯一活动渠道、独立设置、火山词库生命周期和真实桌面验证不替代以上缺口。产品界面继续如实说明豆包官方词库未接入，不发布假的同步按钮或上下文替代实现。
