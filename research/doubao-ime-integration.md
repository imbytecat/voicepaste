# 豆包输入法账号、同步与语音识别接入调研

第一轮调研日期：2026-10-04。样本：用户提供的 Windows `0.9.1.22` 与 Android `1.4.6 / 100406010`。本轮静态解包、分析字节码/原生二进制、读取官方资料，并对照 VoicePaste 当前调用链；未修改产品代码。

**第一轮没有执行安装包、登录账号、发送短信、注册设备、读取用户凭据、调用识别或同步接口。以下保留当时的静态证据和未知项，不代表后续实测仍未完成。** 包内 app key、token、secret 值不在报告中展示，也没有复制进项目。

> 后续更新：已交叉验证 `xiaotian2333/doubaoime-asr`，并在 Linux 上用一个临时设备、无需账号登录完成五段合成音频识别，均确认最终结果与 SessionFinished。基础 ASR 不必先完成账号登录或移植 APK 原生库；账号个性化与词库同步仍未验证。详见[旧客户端交叉验证与合成语音实测](doubaoime-asr-validation.md)，包含逐句结果、延迟和旧客户端解析风险。

## 第一轮结论

**值得继续验证，但应定义为“豆包输入法私有协议接入研究”，不能目前就承诺“官方授权登录、自动同步、稳定识别”。**

1. **产品方向不冲突。** 官网目前列 Windows、macOS、iOS、Android、HarmonyOS NEXT，没有 Linux 条目。VoicePaste 的录音→识别→粘贴链路独立于输入法，不必为了接入语音服务改成 Fcitx/IBus 插件或替换用户输入法。具体自动粘贴仍受桌面权限、焦点及目标应用影响，不等于任何环境零限制。[O1][P1]
2. **登录与语音确实有关联。** Android 代码已追通：账号提供 Passport token→ASR header 写入非空 `x-tt-token`→登录/退出重建连接池。不是只在 APK 中搜到两个不相关的 SDK。[A1]
3. **输入法有独立语音链路。** 两个包均包含并在配置代码中引用 `frontier-audio-ime-*` 端点，使用 SAMI/Frontier；它既不是之前研究的豆包网页 ASR，也不是 VoicePaste 当前火山引擎公开 API。不能只改 URL 或把消费者 token 填进 `apiKey`。[A2][W1][P2]
4. **同步不等于全部信息互通。** 官方隐私政策明确基础账号信息与个人词库同步；Android 进一步有个人词库、常用语开关和“设置项仅在移动端间同步”文案。没有证据证明 VoicePaste 的火山热词表能直接与输入法个人词库互换。[O2][A3]
5. **未找到公开第三方接入契约。** 本次检索未发现输入法面向第三方的 OAuth 客户端注册、scope/回调规范、消费者账号 ASR 或词库同步 API 文档。查不到不等于不存在合作接口；包中代码也不能代替服务授权。[O3][O4]
6. **建议保留现有官方 API 默认路径。** 若继续探索，先独立验证“合法取得会话→真实音频→最终结果”，不要先做完整账号/同步 UI，也不要引入 Windows/Android 运行环境作为产品依赖。官方 SDK/合作授权是更稳妥的产品化路线。

## 1. 样本与证据等级

### 1.1 样本指纹

样本目录：`/home/imbytecat/Downloads/doubao-ime/`。

| 样本 | 大小 | SHA-256 |
| --- | --- | --- |
| `DoubaoIME_Installer_0.9.1.22_release.exe` | 122482120 bytes | `bf7028592661b845c896fb1f5f17012c5b6de550c7e1534e22fbe12a78ed38e5` |
| `doubaoime_v1.4.6_100406010_official_arm64_release.apk` | 169762365 bytes | `6ee3a460577bae2d5a8246304e208beb7b39088357842dac67b20ee0fefd8801` |

Android Manifest：包名 `com.bytedance.android.doubaoime`，版本 `1.4.6 / 100406010`，minSdk 26、targetSdk 33。含四个 DEX、76 个 native `.so`，ABI 仅 `arm64-v8a`。ZIP CRC 检查全部通过。

Windows：外层 PE32 Inno Setup 6.7.0 安装器；载荷含 x64 `ImeService.exe`、SAMI/TTNet DLL、.NET WPF 设置界面与 x86 TSF 组件。

### 1.2 如何解释证据

- **官方资料**：证明官方公开的功能、接入方式或政策，不证明本机样本运行时已启用全部功能。
- **DEX 指令、接口注解、调用关系**：证明客户端实际存在对应配置/调用路径，不证明服务端接受第三方请求。
- **原生符号/字符串**：定位协议、字段、SDK 与实现线索；没有调用关系时不直接认定分支必定执行。
- **反汇编交叉引用**：Windows 已核对端点常量进入配置初始化，不只是全包字符串命中。
- **未验证**：登录成功、握手、token 失效/撤销、识别质量、配额、服务端签名要求和同步冲突处理。

提取工具有边界：原版 innoextract 不支持该安装器；使用兼容分支解包后退出 0，但有 155 条多段文件回读校验警告。关键文件 PE 结构与导入表可解析，**不宣称 Windows 载荷内部校验全部通过或 Authenticode 已验签**。Android v1/v2 签名结构识别也不等于证书归属验证。

## 2. 账号登录：不是开放 OAuth

### 2.1 Android 的真实账号实现

定位：[A1]。

- `ImeMainProcessPassportInitializer#run` / `ImeCountPassportInitializer#run` 初始化 `com.larus.account.saas`。
- `classes2.dex:com.bytedance.common.e.c`（日志名 `ImeCountPassportManager`）配置主域 `ime.doubao.com`，域名列表还包括 `speech.bytedance.com`、`www.doubao.com`；显式启用 TokenGuard。
- 用户 ID、头像、用户名、昵称和登录状态写入 `ImeKv`，经内部 ContentProvider 通知多进程组件。
- `ImeFlowNetworkDepend` 把相对账号路径补为 `https://ime.doubao.com`，通过 TTNet/Retrofit 请求。

登录相关路径：

| 路径 | 本次定位 |
| --- | --- |
| `https://www.doubao.com/flow-account/sdk-app-login` | `classes3.dex:com.larus.account.saas.login.impl.internal.m#b`，登录 UI 打开逻辑 |
| `https://www.doubao.com/flow-account/scan-login` | `AccountScanLoginService#a/b`，扫码目标校验/路由；默认值可由服务端配置覆盖 |
| `/passport/mobile/send_code/v1/`、`/passport/mobile/sms_login/` | SDK 请求构造；未执行 |
| `/passport/auth/share_login/`、`/passport/auth/unbind/` | SDK 共享登录/解绑请求构造 |
| `/passport/account/info/v2/`、`/passport/user/logout/`、`/passport/token/beat/v2/` | SDK 路径；token beat 有调用位置 |

`doubaoAccount.mobileSmsLogin`、`doubaoAccount.getLoginContext` 等 JSBridge 最终转发到 Android 主进程。相关登录 Activity 为 `exported=false`；导出输入法服务需要系统 `BIND_INPUT_METHOD` 权限；导出 Provider 需要 `signatureOrSystem` 级自定义权限。**这些不是独立 Linux 程序可直接调用的公开登录 SDK。**

不能仅把上述登录网页放入 WebView，就认定授权完成：网页还依赖宿主 bridge、账号 SDK、设备状态和 token 管理；第三方客户端注册、回调、权限范围、续期/撤销合同尚不明确。Passport/共享登录不等于标准第三方 OAuth/OIDC。

### 2.2 Windows 登录状态需保留判断边界

`ImeService.exe` 中有 `UserAccountInfoState`、`OnUserAccountChanged` 和账户变化取消/触发同步的逻辑线索。主要服务/设置模块扫描未找到明确 Passport 登录端点；三个主要 .NET UI 程序集的 UTF-16 扫描未找到“登录”“账号”“同步”文案。发现的二维码资源用于 Android 下载，不是登录二维码。[W2]

官网有“立即登录→快速扫码登录”的电脑指引，但菜单栏措辞和图片偏 macOS 场景。因此：**可以确认官方产品有电脑登录功能，不能据此认定所给 Windows 版本已开放全部相同 UI；静态未命中也不能证明它完全没有登录。** 本次未运行 Windows UI。[O5]

### 2.3 统一账号的边界

官方《豆包账号服务须知》将豆包输入法、火山引擎等列入统一账号体系，但 1.4(b) 明确各产品使用记录、偏好与输入内容默认不因统一账号跨产品同步；1.4(c) 的网页 SSO 指同设备、同浏览器、体系内产品。[O3]

**同一个账号 ≠ 同一会话凭据 ≠ 同一服务权限 ≠ 同一费用/配额。**

## 3. 账号怎样进入语音识别

### 3.1 Android 已追通调用链

以下均在 `classes.dex`，以类/方法定位，非推测：[A1]

```text
AccountManager（com.bytedance.android.input.j.g.u）#q
  → 注册 u$b token 提供者
  → u$b#invoke 调用 com.ss.android.token.w.j()
  → common.C.a.c#a 返回当前 token
  → SdkImpl#y / common.C.a.e.a#e,f
  → 非空时加入 x-tt-token
  → SAMI / Frontier 语音连接

登录成功 u#Z / 退出处理 u#e
  → u#V
  → SdkImpl#e → SdkImpl$i#invokeSuspend
  → 连接管理器 C.a.e.a#a
  → 已连接时 disconnect，再重建连接
```

`SdkImpl#y` 方法内 DEX 字节偏移 `0x384` 调用 token 提供者、`0x398` 引用 `x-tt-token`。登录成功另调用 `speech.B#f(uid, clear_lexicon)`，对应语音上下文 `/api/v3/context/ime/login`。

**已证明账号状态传入语音链路；没有证明 token 单独足够。** 代码允许 token 为空时不加 header，也不能由此断言匿名识别可用或登录不是必需。

### 3.2 输入法专用 ASR 端点与格式

两个样本的实际配置代码均引用：[A2][W1]

```text
wss://frontier-audio-ime-ws.doubao.com/ocean/api/v1/ws
wss://frontier-audio-ime-quic.doubao.com/api/v1/ws
```

Android `SdkImpl#y` 构造 `SAMICoreAsrContextCreateParameter`，调用 `SAMICoreCreateHandleByIdentify(SAMICoreIdentify_Streaming_ASR_V2, ...)`：

| 参数/行为 | 静态确认内容 |
| --- | --- |
| header | `proto-version=v2`、`sdk-version=2`，非空时附 `x-tt-token` |
| token 类型 | `TOKEN_TO_C_D`；输入 token 参数是含 `device_id`、`aid` 的 JSON，不是当前火山 API Key |
| 应用/设备 | `aid=401734` 为应用标识；`did/iid` 来自 AppLog；还构造版本、渠道、设备与系统参数 |
| 音频入口 | 16 kHz、单声道，`frame_time_ms=10` |
| 网络编码配置 | 初始 `pcm` 随后被明确覆盖为 `speech_opus`，并开启网络传输压缩；不能当作裸 PCM 协议 |
| 结束 | `finish_audio` / `force_asr_twopass` extra；最终帧与状态机仍需 native/动态验证 |
| 识别上下文 | 包含 `context`、`disable_user_words`、`last_uid`、多遍识别等字段 |

字段核验：`tokenType` 写入位于方法内 `0x874`，`sampleRate` 为 `0x8c8`，`channel` 为 `0x8ce`，`speech_opus` 位于 `0x94a`，紧随 `format` 写入 `0x94e`。

Windows 有 `SamiAsrClientWin::FeedPcm16kMono`、`sample_rate=16000 channels=1 bits=16` 日志与 `oime_windows` 配置。反汇编确认两条端点及 `proto-version=v2` 进入同一初始化代码。这里只确认 Windows PCM 输入边界，不把 Android 的所有网络编码选择直接套给 Windows。

### 3.3 Native 层仍然是主要未知

Windows `ImeService.exe` 从 `audioeffect-mt.dll` 导入 `SAMICoreInitContext`、`SAMICoreCreateHandleByIdentify`、`SAMICoreSetProperty`、`SAMICoreProcess`，后者依赖 `sscronet.dll`。Android 对应 `libaudioeffect.so` / `libsscronet.so`。[A2][W1]

两端 SDK 都能找到 Protobuf 描述：

- `mammon_internal.WebSocketRequest`：`token`、`appkey`、`namespace`、`version`、`event`、`payload`、`task_id`、`session_id`。
- `WebSocketResponse`：`task_id`、`message_id`、`namespace`、`event`、`status_text`、`payload`、`session_id`。
- Frontier 的 `startAuthorization`、`x-tt-e-k` / `x-tt-e-b`、加密相关实现线索。

Android 连接池等待设备 ID；初始化链确实加载 MSSDK，并更新 DID/IID；账号 SDK 启用 TokenGuard。**但没有确认服务端对每类请求强制哪些签名、设备绑定或加密模式。** 不把同集团常见签名头套成该接口必需条件，也不把 SDK 中通用 HMAC/token 代码当作当前主音频链已验证协议。

还缺完整 Protobuf 字段编号/消息结构、Frontier 握手、压缩与加密顺序、音频封装、最终结果/取消语义及服务端接受条件。不能用 `tokio-tungstenite + JSON + PCM` 的假实现代替。

### 3.4 三种 token 不可混用

Android 另有独立语音上下文链：[A4]

1. `https://ime.oceancloudapi.com/api/v1/user/get_config`：配置响应中读取 `sami_token`。
2. `https://speech.bytedance.com/api/v3/context/ime/login`、`logout`、`user_words`、`modify_pair`、`ner` 等上下文请求。
3. 上下文 interceptor 配置 `X-Api-Resource-Id=asr.user.context`、应用标识类 header；已登录分支走账号相关 header，另一分支可用缓存 `X-Api-Token`。

需区分 **Passport 的 `x-tt-token`、上下文的 `sami_token`/`X-Api-Token`、主 ASR 的 `TOKEN_TO_C_D` 参数**。发现其中一种不代表已取得全部服务的通用凭据。

## 4. 信息同步：哪些有证据，哪些不能承诺

### 4.1 官方声明与 Android 实现

官方隐私政策 2.7 明确豆包账号基础信息（头像、昵称、账号 ID）同步，及登录后手机/电脑个人词库同步。[O2]

Android 资源与代码进一步确认：[A3]

- `account_login_sync_desc`：“登录后同步设置与词库”。
- `account_data_sync_desc`：“当前账号所有数据将存储至云端，并可同步至其他设备。**设置项仅在移动端间同步。**”该文案不是完整数据 schema，不扩写成所有聊天/历史信息同步。
- 有“个人词库”“常用语”分项。
- `IRequests$AccountSyncApi#syncSettings` 为 `POST https://ime.doubao.com/api/v2/sync/settings`。
- `j.g.H#b` 实发 `switches`、`client_modify_timestamp`；调用实参能映射 type 1 总开关、2 个人词库、3 常用语，enabled 1/2 为开/关。
- 这证明同步开关请求，**不等于已经恢复全部设置数据内容**。

### 4.2 同步传输是独立协议

`AccountSyncConn`（`j.g.F#d`）要求已登录、有效 UID 和 DID/IID，连接 `wss://frontier-ime.doubao.com/ws/v2`，带 `sdk-version=2`、`x-tt-token`、`is_login=1` 等。[A3]

Android `libkeyboard.so` 的 `SyncNetworkClient` 与 Windows `ImeService.exe` 均有：

```text
/api/v2/sync/version
/api/v2/stream/sync/upload
/api/v2/sync/push
/api/v2/sync/pull
```

可确定有专门词库同步实现；尚未完整恢复对象格式、版本冲突、删除语义、压缩及客户端兼容规则。不能把 VoicePaste 的 `Vec<String>` 或火山 `boosting_table_id` 直接写入这些接口。

### 4.3 不要误认 `/auth/sync`

`/api/v2/auth/sync` 实际属于 `CrossDeviceClipboardApi`，请求包含 `device_name`、`x_device_type`、`status`，由 `AuthSyncScene.LOGIN_SUCCESS` 等场景触发；同组还有 clipboard copy/image token/switch 接口。[A3]

**它是设备/跨端剪贴板授权业务，不是任意第三方同步登录 token 的 OAuth 接口。** 官网“超级互传”也不能推导为全部剪贴板历史自动云同步；本次没有取得该功能完整数据告知或技术协议。

## 5. 三条路线的可行性

| 路线 | 已知基础 | 未解决问题 | 当前建议 |
| --- | --- | --- | --- |
| 火山引擎公开 ASR | VoicePaste 已实现；官方协议、API Key、资源和热词文档齐全 | 开通、费用、用户配置门槛；不能承诺与输入法效果完全相同 | 保持默认产品路径 |
| 豆包网页账号 ASR | 之前已研究公开开源客户端如何复用网页会话 | 非官方消费者协议、会话/风控、Linux 登录兼容、许可；不会自动获得输入法词库 | 若目标只是不填 Key 的登录体验，作为独立实验路线评估 |
| 豆包输入法原生账号 + ASR + 同步 | 本次确认真实 token→ASR 链及词库/常用语同步实现 | Linux 授权会话、设备依赖、native 线协议、同步 schema、许可与长期兼容性 | 有进一步验证价值，但目前不能按稳定接入交付 |

网页路线的开源参考见 [quanru/doubao-say 固定版本](https://github.com/quanru/doubao-say/tree/642638420f23ea29a6928c6afafcb7db54b41846)：其端点为 `ws-samantha.doubao.com/samantha/audio/asr`，与此次输入法端点不同。此前结论未在本次重新做真实登录/识别验证。

官方火山流式文档列 `bigmodel`、`bigmodel_nostream`、`bigmodel_async`；新版控制台支持 `X-Api-Key`，旧版使用 App-Key/Access-Key，另有资源与请求字段。当前项目使用优化版及 `volc.seedasr.sauc.duration`，已有明确文档基础。[O6][P2]

### 为什么不能直接搬 DLL / SO

- Windows 依赖 PE/Windows API、TTNet/SAMI；不是可直接链接的 Linux 库。
- Android 是 AArch64/Bionic/JNI，`libaudioeffect.so` 还依赖 `libandroid.so`、`liblog.so`、`libsscronet.so`、`libttcrypto.so`、`libiesapplogger.so` 等。即使同为 ARM64，也不是 glibc Linux 的直接替代品。
- 包中存在离线 ASR 资源和 `asr_model_path` 分支，不证明模型完整可独立运行、可移植或可重新分发。
- [INFERENCE] Wine/Android 容器可以作为未来隔离观察环境，但作为 VoicePaste 正式依赖会增加体积、权限和维护成本，背离原生独立语音工具定位。本次没有运行此方案。

## 6. 对 VoicePaste 的实际影响

当前流程：[P1][P2]

```text
快捷键 / 浮层
  → audio.rs：CPAL 采集、混音与 16 kHz PCM
  → AudioCommand::Data / Finish
  → asr::run：火山 API Key + 二进制流协议
  → AsrOutcome::Text
  → 可选 llm::postprocess
  → paste::paste：剪贴板与系统粘贴
```

### 可复用

录音、快捷键、浮层、取消通道、结果事件、LLM 后处理、剪贴板/粘贴和系统凭据库思路。接入后端不要求接管用户键盘输入，也不需要复制官方输入法整套前端/进程架构。

### 若以后实施，不能漏掉的接入点

| 当前文件/符号 | 必要改动范围 |
| --- | --- |
| `settings.rs::AppSettings`、`src/types.ts` | 识别后端选择；账号状态与秘密分离，保留现有 API Key |
| `lib.rs::start_recognition`（550–612） | 不再一律要求 `api_key`；按后端检查就绪状态与选择识别实现 |
| `lib.rs::setup_app`（1227–1245）、`save_settings`（473 起） | 输入会话初始化目前以 Key 非空为条件，需要按实际后端就绪判断 |
| `Settings.tsx::testDoubao` / `finishOnboarding`（1428–1495） | 新手引导与连接测试目前锁定 API Key，不能只加登录按钮 |
| 独立账号/识别模块 | 合法会话获取、过期/退出、隔离凭据保存、实际语音协议适配；先不建设通用插件框架 |
| 热词相关操作 | 输入法个人词库与火山热词表保持独立；不支持的能力明确显示，不静默忽略 |
| `PRIVACY.md` | 真正改变数据流时更新消费者账号凭据、音频目的端、上下文/词库上传、退出与留存说明 |

**数据风险：** `lib.rs::save_settings` 的 384–430 行把 API Key 与热词绑定；清空旧 Key 且有绑定时可触发旧云端词表删除。不能用“切换账号模式时清空 API Key”实现后端选择。必须保留原凭据/词表，不自动迁移、删除或把录音重发到另一服务。

账号凭据不进入 React 状态、日志、错误详情或诊断包。若最终采用 WebView，远程登录窗口不能获得设置/剪贴板/文件等本地业务 IPC；不得读取用户已有浏览器 profile。当前 capability 仅面向 `settings`、`overlay`，现有命令也有窗口标签校验，但新增远程页面仍需单独审查来源边界。[P3]

## 7. 服务许可和隐私边界

应引用**输入法自身**《用户协议》，而非只用豆包网页协议代替：[O4]

- 4.1/4.1.4 涉及未经授权访问、修改、衍生使用与逆向等限制，保留法律允许/事先书面许可例外。
- 5.2/5.3 是有限、不可转授权的软件使用权；商业或非商业范围外使用知识产权、品牌关联均需注意。
- SDK 开源组件许可不自动授予消费者云服务使用权、账号权限或模型再分发权。
- 官方联系邮箱：`doubaoime@bytedance.com`。可询问 Linux 独立语音工具的账号授权、ASR SDK/接口及词库同步合作条件；本次没有发信。

这是需要确认的风险，不作“必然违法/封号”的法律结论，也不把本次静态研究直接判作违约。

输入法隐私政策说明云端识别可能结合个人词库、常用语实体、人名、部分输入文本及场景。其常规语音“不存储”声明还有用户主动反馈、体验改进计划等不同处理场景，不能概括为所有音频永不留存。**VoicePaste 不应为了模拟客户端而悄悄收集屏幕文本、通讯录、输入历史或剪贴板。** 如果以后确实需要某项上下文，应单独说明并由用户选择；也不能把输入法隐私承诺直接套到网页或火山 API。[O2]

## 8. 下一步最小验证门槛

不先改产品 UI。先确认允许的服务接入方式；若继续私有协议实验，隔离验证必须证明：

1. **会话**：用户主动在官方流程登录；Linux 侧能通过明确允许的方式取得必要会话，不靠复制安装包静态秘密或读取其他应用账号文件。
2. **语音闭环**：本地准备已知短句音频，明确上传内容与账号后，得到中间/最终结果；证明音频封装、停止、取消、网络中断语义，而不只是 HTTP 101 握手。
3. **账号变化**：重启复用、过期重新登录、退出清理；普通网络错误不销毁有效凭据。区分本机清除与服务端撤销。
4. **同步另验**：先取得明确 schema/许可并读取，不直接向真实词库写入；用可控测试数据验证合并/删除/冲突后才考虑用户数据。Android“设置仅移动端同步”的边界必须保留。
5. **互不破坏**：切换后端不删除火山热词/Key，不自动双重上传；失败结果不能冒充已成功最终识别。

本次仍缺：可供第三方/Linux 使用的认证契约与授权、完整 native 线协议、用户主动建立的测试会话及现网验证。**没有这些证据，能交付的是当前可行性研究，不是可用性承诺。**

## 9. 可复核证据与执行记录

### Windows

先执行 `file` / `7zz l`；7-Zip 26.02 仅识别外层 PE。原版 innoextract 报 loader revision 2 不支持；改用[上游兼容 PR #210](https://github.com/dscharrer/innoextract/pull/210)的固定源码构建静态提取工具，未运行安装器：

```sh
nix build --impure --no-link --print-out-paths --expr 'let pkgs = (builtins.getFlake "nixpkgs").legacyPackages.x86_64-linux; in pkgs.innoextract.overrideAttrs (old: { src = builtins.fetchTarball "https://github.com/dscho/innoextract/archive/376a13e7c41cc5528b6088d0dd16ec1b323a8d37.tar.gz"; })'
```

用返回目录的 `bin/innoextract --extract --output-dir /tmp/voicepaste-doubao-ime-windows` 提取原样本。退出 0、155 条回读校验警告，边界见第 1 节。

下列偏移均为 `app/versions/v0.9.1.22/` 下文件的原始字节偏移：

| 来源 | 文件/偏移或方法 |
| --- | --- |
| [W1] 语音端点与配置 | `ImeService.exe`：WS `0x10e7ef0`、QUIC `0x10e7f28`、`oime_windows` `0x10e7f60`、proto-version `0x10e7f70`、FeedPcm16kMono `0x10e77f0` |
| [W1] 实际配置引用 | 映像基址 `0x140000000`；指令地址 `0x140724b68` / `0x140724b81` / `0x140724bb3` 引用端点/版本，`objdump -d --start-address=0x140724b58 --stop-address=0x140724bbf ImeService.exe` 可复核 |
| [W1] SDK 协议字段 | `audioeffect-mt.dll`：Request.token `0x24a1b0`、appkey 字段名 `0x24a1d8`、namespace `0x24a200`、payload `0x24a288`、startAuthorization `0x224ef0` |
| [W2] 同步线索 | `ImeService.exe`：upload `0x1483a20`、version `0x1483a40`、push `0x1483a58`、pull `0x1483a70`、OnUserAccountChanged `0x1366440` |

提取结果指纹：

- `ImeService.exe`：`94ace7e504e6aa70c15095d5219604aee93e17247eb85429a046c7a4fdb95e90`。
- `audioeffect-mt.dll`：`717db8cc5d88b521846990716ad56f381f3355c3761065c8733a2a4b77283fc5`。
- `sscronet.dll`：`bdd553ccb0d6e11c6f9ea3cce7c9fa67b213f47fd1d564f93e1e9c38bc3f680d`。

### Android

临时隔离环境使用 Androguard 4.1.3，未改仓库依赖。四个 DEX 建立 xref 后局部反编译；关键字段再次核对原始 DEX 指令，避免协程反编译失真。Retrofit 方法注解独立解析，确认相关请求为 POST。ARSC 解码同步文案，ELF `file` / `objdump -p` 核对平台与依赖。

| 来源 | APK 内可追溯位置 |
| --- | --- |
| [A1] 账号→ASR | `classes.dex:com.bytedance.android.input.j.g.u#q/Z/V/e`、`u$b#invoke`；`common.C.a.c#a`；`common.asr.sdkImp.SdkImpl#y/e`、`SdkImpl$i#invokeSuspend`；`common.C.a.e.a#a/e/f` |
| [A1] Passport | `classes2.dex:com.bytedance.common.e.c#g/h/d/c`；`ImeFlowNetworkDepend`；`classes3.dex:com.larus.account.saas.login.impl.internal.m#b`、`AccountScanLoginService#a/b` |
| [A2] ASR 配置 | `classes.dex:com.bytedance.android.input.common.asr.sdkImp.SdkImpl#y/f`；`common.C.a.e.a#b/e/f`、`common.C.a.f.a#b`；`lib/arm64-v8a/libaudioeffect.so` |
| [A3] 同步 | `resources.arsc`：`account_data_sync_desc` `0x7f110027`；`classes.dex:IRequests$AccountSyncApi#syncSettings`、`j.g.H#b`、`j.g.u#Q/h0/E/m0`、`j.g.F#d`；`libkeyboard.so` 的 `SyncNetworkClient` |
| [A3] 剪贴板授权 | `IRequests$CrossDeviceClipboardApi`、`ImeClipboardApiManager#j` |
| [A4] 语音上下文 | `classes.dex:com.bytedance.android.input.speech.A#invokeSuspend`、`speech.B`、`speech.q#a`；`IRequests` 的 ImeTokenApi/ImeLoginApi/UserWordsApi；`common.passport.depend.b#a` |

已实际运行的最小复核脚本（需上述隔离环境；只输出身份和白名单指令）：

```python
import hashlib
from pathlib import Path
from zipfile import ZipFile
from loguru import logger
from androguard.core.apk import APK
from androguard.core.dex import DEX

logger.disable("androguard")
p = Path("/home/imbytecat/Downloads/doubao-ime/"
         "doubaoime_v1.4.6_100406010_official_arm64_release.apk")
with p.open("rb") as f:
    print(p.stat().st_size, hashlib.file_digest(f, "sha256").hexdigest())
a = APK(str(p))
print(a.get_package(), a.get_androidversion_name(), a.get_androidversion_code())
with ZipFile(p) as z:
    print("entries", len(z.infolist()), "crc_bad_entry", z.testzip())
    vm = DEX(z.read("classes.dex"))
    c = vm.get_class("Lcom/bytedance/android/input/common/asr/sdkImp/SdkImpl;")
    m = next(m for m in c.get_methods() if m.get_name() == "y")
    markers = (";->tokenType ", ";->sampleRate ", ";->channel ",
               ";->format ", "SAMICoreCreateHandleByIdentify",
               "common/C/a/c;->a()")
    for off, ins in m.get_instructions_idx():
        text = ins.get_output()
        if any(marker in text for marker in markers):
            print(hex(off), ins.get_name(), text)
```

结果：退出 0；包名/版本/哈希与第 1 节一致；3272 个 ZIP 条目，`crc_bad_entry=None`；关键字段写入与 native 创建调用均可定位。未把“能解析 APK”当作“ASR 已实测可用”。

### 官方资料与项目核对

本次重新读取官网、输入法专用协议/隐私政策、账号须知和火山文档。检索覆盖 `site:doubao.com 输入法 OAuth/SDK/开放平台`、`豆包输入法 开放API/账号同步接口`、官方隐私/词库/登录及火山 ASR 接入资料；未把第三方教程当官方授权文件。

火山文档原生读取只得到页面空壳，改用公开文本渲染取得官方正文；引用仍指官方原址。隔离浏览器尝试因 `GLIBC_2.43 not found` 未启动，未据此修改系统环境；没有动态网页登录/UI验证。

本次只新增此研究记录；未改产品行为、依赖或隐私声明，未运行与研究无关的 `mise run check`。

## 来源

- [O1] [豆包输入法官网](https://shurufa.doubao.com/pc)：当前五平台展示，无 Linux 条目。
- [O2] [豆包输入法隐私政策](https://lf3-cdn-tos.draftstatic.com/obj/ies-hotsoon-draft/wave_ime/ime_privacy_policy.html)：2026-08-11 更新、08-18 生效；尤其 2.3、2.7、反馈与体验改进计划。
- [O3] [豆包账号服务须知](https://www.doubao.com/legal/doubao_account_service_terms)：尤其 1.4 与账号保管条款。
- [O4] [豆包输入法用户协议](https://lf3-cdn-tos.draftstatic.com/obj/ies-hotsoon-draft/wave_ime/ime_privacy_user_agreement.html)：2026-08-18 更新、08-24 生效；尤其 4.1.4、5.2、5.3。
- [O5] [电脑端登录指引](https://shurufa.doubao.com/cross-copy-pc)、[移动端登录指引](https://shurufa.doubao.com/cross-copy-mobile)。
- [O6] [火山大模型流式语音识别 API](https://docs.volcengine.com/docs/6561/1354869?lang=zh)、[产品概述](https://www.volcengine.com/docs/6561/1354871?lang=zh)、[控制台 FAQ](https://www.volcengine.com/docs/6561/196768)。
- [P1] [`lib.rs`](../src-tauri/src/lib.rs) `start_recognition`、[`audio.rs`](../src-tauri/src/audio.rs)、[`paste.rs`](../src-tauri/src/paste.rs)。
- [P2] [`asr.rs`](../src-tauri/src/asr.rs) `DOUBAO_ENDPOINT`、`build_connection_request`、`run`；[`settings.rs`](../src-tauri/src/settings.rs) `AppSettings` 与系统凭据库；[`Settings.tsx`](../src/components/Settings.tsx) 连接测试/新手引导。
- [P3] [`capabilities/default.json`](../src-tauri/capabilities/default.json)、[`tauri.conf.json`](../src-tauri/tauri.conf.json)、[`PRIVACY.md`](../PRIVACY.md)。
- [A1]–[A4]、[W1]–[W2]：用户提供样本的静态证据，完整文件哈希及包内类/方法/偏移见第 1、9 节，不依赖临时分析文件保留。

## 扩展接入范围与发布门槛（2026-10-06）

用户要求：输入法已有、可适用于独立工具的能力全部纳入接入，按 VoicePaste 场景优化后再发布新功能。以下是官网与现有安装包证据对应的功能清单，不把端点存在当成可用验收。

| 能力 | VoicePaste 适配 | 当前门槛 |
| --- | --- | --- |
| 账号登录、退出、会话失效 | 独立账号入口，系统凭据库，账号失败不降级访客 | 已有实现；新上下文生命周期需单独验收 |
| 流式语音、方言、中英混输、专业术语 | 保持按住/切换录音及任意输入法共存 | 基础链路已验；方言与复杂噪声不能用普通合成音频代替验收 |
| 标点、口语整理、语音指令 | 可控识别选项，明确区分转写与改写，保留原文及失败恢复 | 需追踪官方字段和整理服务真实请求 |
| 个人词库与常用语 | 手工维护优先，账号隔离，明确本地/同步/识别上下文三种状态 | 上传可达，稳定增强及安全删除仍在定位 |
| 清空词库 | 对应用户指出的辅助输入入口；执行前说明实际范围 | 不能把本地清空提示当作云端清空，整库操作须另行确认 |
| 文本整理、改写、总结、翻译 | 用户主动提供或选中文本后操作，预览确认再替换 | 接口、长度限制、取消、错误保留原文需验收 |
| 超级互传、常用语跨端同步 | 用户主动发送/接收，避免默认上传整个剪贴板历史 | 需确认设备授权、同步类型、冲突与撤销语义 |
| 纠错学习、场景上下文 | 仅使用工具内用户明确确认的修正；上下文上传单独开关 | 不监听其他应用全部键盘输入，不默认读取屏幕或联系人 |
| 离线语音 | 若官方模型能合法独立运行，作为明确可选下载 | 包含模型路径不证明 Linux 可运行或允许再分发；不得用空实现替代 |
| 拼音候选、键盘布局、皮肤、按键联想 | 属于系统输入法前端，不接管用户现有输入法 | 不作为独立语音工具功能；文本补全能力如可独立调用则按主动文本工具评估 |

官网依据：https://shurufa.doubao.com/pc 。移动包资源还明确包含智能文字整理、翻译、语音标点、离线语音下载、AI 检查/重写/总结/列表及常用语操作；每项仍须追踪实际调用链。发布门槛为产品真实入口、真实服务结果、取消和错误路径、数据保留及升级验收全部通过，不以研究报告、成功状态码或构建通过代替。

### 智能整理调用链定位

Android 1.4.6 `SmartOrganizeApi#organizeTextStream` 的 Retrofit POST 注解为 `/api/v2/ai/text_organization`；工厂 `SmartOrganizeApi$a$a#invoke` 使用 `https://ime.doubao.com` 和两个公共网络拦截器。请求对象 `smart_organize.Z` 的 Gson 注解给出精确字段：`scene:int`、`query:string`、`space_at_cn_en_nb:int`、`space_at_newline:int`、`stream:boolean`。调用者 `a0$c#invokeSuspend +0x186..0x1b0` 构造请求并发起流式调用。

响应消费者 `smart_organize.a0#a/b` 按 SSE 的 `event:`、`data:` 和空行分帧，区分 `scene.delta`、`scene.completed`、`scene.error`、`done` 与 `[DONE]`。后续接入应保留这种完成/错误区分，不能把连接结束或部分文本当成整理成功。scene 的产品操作映射、字段默认来源及真实服务验收尚待完成；本节仅记录实际 DEX 调用与注解，不宣称接口已经可用。

后续真实请求已通过：`m0$g#invokeSuspend +0x10` 与 `w#invokeSuspend +0x8e` 均将 scene 设为 6。使用既有授权账号、设备和真实 TTNet 握手，发送公开测试文本“嗯今天下午三点开会然后请把会议纪要发给我谢谢”，得到 HTTP 200、`text/event-stream`、两个 `scene.delta`、一个 `scene.completed` 和 `done/[DONE]`。最终原始响应为“今天下午三点开会，然后请把会议纪要发给我，谢谢。”，没有账号或词库写入。

该结果证明独立文本整理服务真实可用，不代表已经完成 Rust、设置界面、取消和失败恢复接入。探针 `/tmp/voicepaste-organize-live.py`；原始公开文本响应与脱敏摘要在 `/tmp/voicepaste-organize-live-proof/`。请求没有上传剪贴板、屏幕文字、通讯录或用户实际听写。

传输必要性对照：同一已验证账号、同一公开文本、scene 6，普通 HTTPS JSON POST（无 TTNet 票据/密文）返回 HTTP 403、15 字节 `application/octet-stream`，无完成事件；带已协商 TTNet 加密的请求已返回完整整理结果。因此不能用直接 reqwest JSON 请求替代所需握手，也不能把 403 当成账号无效而反复登录。Rust 接入必须实现并验证该传输层；不能依赖临时 Python 探针作为发布运行时。

### Rust 智能整理实现验证

`src-tauri/src/doubao_ime_transport.rs` 已实现标准库之外所需的 P-256 签名/密钥交换、两项响应签名校验、HKDF-SHA256 和 ChaCha20 传输，使用标准 OpenSSL 实现而非手写曲线/流密码。真实 Rust smoke 通过同一账号与设备调用整理服务，返回“今天下午三点开会，然后请把会议纪要发给我，谢谢。”；该 smoke 已移除，不作为常驻凭据读取入口。

已接入豆包渠道默认关闭的 `smartOrganize` 开关及正式听写后处理，失败保留原文，取消不继续输入；与自定义 LLM 后处理互斥。浏览器实际页面已确认控件和未登录禁用状态，原生 debug 窗口已启动并进入文本处理页面。完整 `mise run check` 与新 SSE 完成/错误边界测试通过。真实录音到整理再自动粘贴、开关保存交互以及新增 OpenSSL 依赖的三平台发布构建仍待验收，不将服务 smoke 当成整项发布完成。

原生交互补验：使用 tauri-driver/WebKitWebDriver 驱动实际桌面程序，在独立设置目录且保留用户已授权账号的环境打开“文本处理”，真实点击“豆包输入法智能整理”和“保存设置”。落盘 `recognition.doubaoIme.smartOrganize=true`，自定义 LLM `enabled=false`；重新加载原生 WebView 后开关仍为 true，LLM 开关为 disabled。没有使用模拟 IPC，也未修改用户原设置目录。真实账号服务 smoke 与原生配置交互分别已验证；完整语音录入链仍须补验。

完整链路补验：提交 `9615118` 的[三平台未发布打包](https://github.com/imbytecat/voicepaste/actions/runs/37438383779)全部通过，包含 vendored OpenSSL；没有创建新版本或公开 Release。原生程序在 Xvfb 下使用独立配置，按真实全局快捷键录音；PulseAudio source-output 核对仅连接 `voicepaste_organize_verify.monitor`，输入公开合成音频，未采集物理麦克风。实际观察到实时识别 → “正在使用豆包输入法智能整理” → 整理完成；独立 GTK 输入框最终提交“今天下午 3 点开会，请把会议纪要发给我。”，进程退出码 0。

前两次实验仅移除 WAYLAND_DISPLAY、未覆盖宿主 XDG_SESSION_TYPE，导致混合显示环境下目标框为空，不能计作粘贴成功；将验证环境显式设为 `XDG_SESSION_TYPE=x11` 后真实目标通过，未为测试修改产品输入路由。测试进程、driver 和合成音频节点已停止/卸载。其余词库、翻译、跨端能力与全项目发布仍未完成，不因智能整理单项通过而提前发版。

### 手工中译英真实接入

从 Android `libkeyboard.so` 的 `TranslateRequest::TryRequestServer`（`0x2afae0`）恢复 `source_language`、`target_language`、`text_list` 请求字段，语言编号 185/38 的实际请求将“今天下午三点开会。”译为 “The meeting will be held at 3 o'clock this afternoon.”，HTTP 200、业务 code 0。

已复用 Rust 加密传输并接入设置中的独立“豆包中译英”文本框和预览结果，只有用户点击后才发送，原文保持不变，不读取剪贴板。实际 tauri-driver 驱动原生界面输入该公开句、点击“翻译为英文”，Rust 返回上述译文并在结果框显示，错误列表为空。完整检查通过；该新增切片仍在未发布功能分支，不代表反向翻译、全部语言或其他输入法能力已交付。

双向补齐：官方 `getTransSourceLang`/`getTransDestLang`（`0x2b0274`/`0x2b0290`）以 185/38 互换实现两个方向，产品已提供原生方向选择。实际桌面选择“英文 → 中文”，输入 “The meeting starts at three this afternoon.”，点击“翻译为中文”后结果框显示“会议今天下午三点开始。”，输入框保留原句。两方向均已通过真实 Rust 请求及原生 UI 操作，完整检查通过。

翻译请求在账号验证后释放全局识别门锁，避免网络等待阻塞听写或账号操作；返回时核对渠道和账号 revision，不把旧账号结果交给新账号页面。变更后再次通过实际原生页面中译英请求；完整检查通过。账号切换发生在请求发出后不能撤回服务端已收到的文本，返回结果会丢弃。

工具场景补齐显式复制：常用语列表和翻译结果提供本机复制按钮，复用受 settings 窗口限制的 Rust 剪贴板命令。实际原生页面翻译公开句后点击复制，独立 X11 `xclip -selection clipboard -o` 得到与结果框一致的英文译文。该行为不读取剪贴板历史，也不等同于官方超级互传；完整检查通过。
