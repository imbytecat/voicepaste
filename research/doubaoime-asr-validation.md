# 豆包输入法旧客户端交叉验证与合成语音实测

日期：2026-10-04。固定代码：[xiaotian2333/doubaoime-asr@9210f628d0dddea5eda45724e79c7f534615a926](https://github.com/xiaotian2333/doubaoime-asr/tree/9210f628d0dddea5eda45724e79c7f534615a926)。源码提交于 2026-02-05 22:25:13 UTC，模拟输入法 Android `1.1.2 / 100102018`。与此前用户提供的 Android `1.4.6 / 100406010`、Windows `0.9.1.22` 交叉核对。[S1]

## 结论：旧客户端当次实际可用，不需要豆包账号登录

**五段合成音频均完成真实 ASR：TaskStarted → SessionStarted → 逐条确认的最终结果 → SessionFinished，全部收到的 protobuf 状态码均为 `20000000 / OK`。不是只连上 WebSocket，也没有把 partial 当成功。**

- 只注册了一个临时设备，获取一次 settings 配置；五次识别复用同一份临时设备凭据。没有豆包账号登录、短信、Cookie、Passport `x-tt-token` 或火山 API Key。
- 原客户端 ASR 源码与协议参数未改。只补齐隔离运行依赖、指定系统 CA，并在外层加超时及只读事件/时序记录。
- 普通中文及 15 dB 白噪声版本内容识别正确，数字“三”规范化为 `3`。
- 本地中文 TTS 的中英混输样本识别较差；同一句改用微软晓晓合成后，Linux、Python 均正确。不能把第一次结果直接解释成 ASR 不支持中英混输。
- 本次首字相对第一音频帧为 **0.768–0.810 秒**；最终结果相对 FinishSession 发送完成为 **0.141–0.172 秒**。每种输入只测一次，不能据此给出通用延迟或准确率保证。
- **语音识别可以先于账号/同步独立研究接入。** 账号个性化、词库同步、消费者授权及长期兼容性仍未验证，不能用五次 ASR 成功代替。

对[第一轮静态报告](doubao-ime-integration.md)的修正：当时“尚无匿名识别成功证据”属实；现在已补上动态证据。不应再把“完成官方账号登录”或“完整移植 Android native SDK”作为基础 ASR 实验的必需前置条件。发现新包存在 TokenGuard/加密分支，也不等于此次旧 ASR 路径必须执行它们。

### 后续原生实现验收补充

- 原生 Rust 后端曾以合成音频完成未登录识别，返回“今天下午 3 点开会，请把会议纪要发给我。”；真实桌面界面完成了无 API Key 引导和分后端配置保留验证。
- 用户主动扫码后，官方 PC 端会话通过了输入法账号接口的独立校验；原生应用重启后恢复并再次验证账号，随后完成本机退出清理。报告不保存账号令牌、昵称或 UID。
- 旧配置路径的账号音频请求及同设备未登录请求曾收到 `50700000`，脱敏原因是 `read backend response: rpc error: code = 2 desc = service discovery failure`。未改动的固定 Python 客户端也复现；延迟音频、对照 SDK header 和新版配置请求均未解决。随后在**同一设备、相同音频和相同请求参数下，仅替换字段 2 的应用路由标识**：旧配置仍失败，公开 Android 1.4.6 SDK 的标识成功返回完整文字与 SessionFinished。因此不能简单归因于全站故障或账号认证失败。
- 原生实现已直接切换到经过验证的当前 SDK 路由，删除旧配置获取、过期缓存及相关兼容分支，不采用轮换标识或重建身份绕过错误。新版无音频连接测试、原生未登录识别和账号识别均已通过：游客模式收到 13 次文本更新，在 5.873 秒返回“今天下午 3 点开会，请把会议纪要发给我。”；用户重新扫码、通过独立会话校验后，账号模式收到 13 次文本更新，在 5.891 秒返回“今天下午三点开会，请把会议纪要发给我。”。临时验收脚本最初因要求“三”必须写成“3”而失败，修正为接受这两种等义写法后通过；产品不改写识别结果。
- 当前 SDK 还会返回 `results:null` 心跳以及无 `index` 的多轮全文候选。原生解析按最新候选更新全文，仅使用该候选自己的确认标志，不拼接多个候选，不跨候选汇总最终标志；对应回归用例覆盖空心跳、全文修正及“旧候选已确认、最新候选仍临时”的情况。
- 连接测试必须等待无音频会话正常结束，不能仅凭 `TaskStarted` / `SessionStarted` 提前判定成功；否则会漏掉随后发生的后端失败。
- 进一步反汇编确认请求字段 2 是应用标识 `appkey`，字段 9 是从 1 开始递增的音频序号，不是旧开源客户端命名的 FIRST/MIDDLE/LAST 枚举。Android `libaudioeffect.so` 的队列构造 `0xa1a6c` 将计数器清零，入队 `0xa1ee0–0xa1ef4` 先递增再写入记录，序列化 `0xdaeac–0xdaebc` 写入字段 9。原生实现已修正，并保留了先失败、后通过的真实 Opus 分片/序号回归检查；未将该独立问题误认作本次上传音频前后的服务发现失败原因。
- 最终 `mise run check` 通过：前端构建、9 项前端测试、44 项 Rust 测试及 Clippy；原生程序重新构建通过。在真实 Tauri/WebKit 设置界面分别以游客和已登录身份点击测试连接，均观察到“当前语音识别连接已验证”；另分别经真实预览命令启动并结束无音频会话，均收到 `empty` 终态。账号音频使用上述独立的真实识别结果验收，不以握手、游客结果或无音频会话代替。

## 1. APK 是否更容易

**研究登录/同步，APK 更容易；在 Linux 上验证语音，现成 Python 客户端更直接。**

- APK 的 Java/Kotlin 字节码可追到账号提供者、参数配置、接口注解，比 Windows 原生程序容易定位。这次重新读取 DEX，确认新版 `SdkImpl#y` 的端点、appKey 提供者、可选账号头、音频格式等。
- APK 的语音核心仍是 Android AArch64/Bionic/JNI 的 `.so`，不是 Linux x86-64 可直接加载的库。运行完整 APK 需要 Android 运行环境；本次没有执行 APK、Windows 安装器或部署模拟器。
- 实测证明已有不依赖这些 native 库的协议实现；当前更小的路线是 **APK 用于核对新版，协议客户端用于实测/后续适配**，不是先搬整套输入法运行环境。

## 2. 新旧协议交叉验证

| 项目 | 固定旧客户端 | 新 APK / Windows 静态证据 | 判断 |
| --- | --- | --- | --- |
| WS 端点 | `wss://frontier-audio-ime-ws.doubao.com/ocean/api/v1/ws` | Android 与 Windows 配置路径均引用；另有 QUIC 端点 | 旧 WS 路径本次实际可用，不证明全部新协议等价 |
| 应用身份 | Android `aid=401734`，设备 ID，版本 1.1.2 | APK `aid=401734`，版本 1.4.6 | 无账号不等于无设备身份、无凭据或不可追踪 |
| 凭据 | 设备注册 → settings `asr_config.app_key`，旧客户端称其为 `token` | SDK `appKey`、`TOKEN_TO_C_D` 的设备 JSON、可选 Passport header 是不同层次 | 不可与用户账号 token 或火山 Key 混用 |
| header | `proto-version=v2`、UA、keepalive；无账号头 | 新 APK 还有 `sdk-version=2`，token 非空才加 `x-tt-token` | 当前无账号路径不要求复制全部新 header |
| 音频 | 输入 16 kHz/mono/S16 PCM，编码为 20 ms Opus 帧，声明 `speech_opus` | APK 最终也设置 `speech_opus`，frame_time_ms=10；Windows 有 PCM 输入边界 | PCM 是输入格式，不是此次线上裸 PCM 传输 |
| 任务流程 | StartTask/StartSession/TaskRequest/FinishSession | 两端 SDK 都有同名事件字符串 | 已有可执行协议，不必从零猜字段 |
| Protobuf | 仓库有明确字段编号/类型 | native 包中是 `mammon_internal.WebSocketRequest/Response` 描述 | 名字与层次不能直接等同；新 native 完整 schema 尚未逐字段恢复 |
| Wave 加密 | 真实调用方是 NER，上下文 HTTP | 新包也有独立上下文链和加密能力 | **该仓库的 Wave 不是 ASR 前置步骤** |
| 账号/词库同步 | 未实现 | 新 APK 有 Passport、账号长连接、同步开关和词库接口 | ASR 成功不等于实现新账号/同步功能 |

来源：[S2]–[S7]，新版样本定位见第一轮报告。补充 DEX 定位：`SdkImpl#y` 方法内 WS 字符串偏移 `0x2b6`，appKey 提供者调用 `0x2c4`，proto/sdk header `0x368/0x376`，账号 token/条件加入 `0x384/0x398`，`speech_opus` 覆盖 `0x94a/0x94e`。

还做了**仅本地、只输出布尔值**的比较：本次 settings 返回的 ASR token、新 APK 的静态 ASR appKey、旧 fork 的 SAMI_APP_KEY 两两不同。不能写成“新旧 token 相同”；值不同也不等于旧路径失效。报告与项目均不保存这些值。

### 实际执行链

```text
一次临时设备注册
  → POST log.snssdk.com/service/2/device_register/：HTTP 200，1.378 秒
  → POST is.snssdk.com/service/settings/v3/：HTTP 200，1.150 秒
  → 获取设备 ID 与 settings ASR 配置
  → 同一设备复用五次：
      WSS → StartTask → StartSession
      → S16 PCM 编成 Opus → TaskRequest(FIRST/MIDDLE/LAST)
      → FinishSession → final result → SessionFinished
```

没有执行 NER、KeyHub/Wave 握手、Passport 或词库同步请求。设备注册用客户端随机生成的标识和固定设备模板，没有读取用户真实 Android 设备或浏览器资料。

## 3. 输入语料及测试方法

### 音频来源

前四份：本地 CPU `piper-tts 1.4.2`，`zh_CN-huayan-medium`，固定[模型提交](https://huggingface.co/rhasspy/piper-voices/tree/c10ece1aade47bb51c153c893d14e5bf8e5b7117/zh/zh_CN/huayan/medium) `c10ece1aade47bb51c153c893d14e5bf8e5b7117`。原生 22050 Hz，经 ffmpeg 重采样；`length_scale=1.9`、noise_scale 0.667、noise_w_scale 0.8、volume 0.7、ONNX seed 20261004。

第五份：`edge-tts 7.2.8` 请求 Microsoft Edge 在线 TTS，声音 `zh-CN-XiaoxiaoNeural`、默认语速；只发送表中的公开合成句子，没有私人文本或账号数据。MP3 解码为相同 PCM 格式。

全部 WAV 经实际读取确认 **16 kHz、单声道、16-bit PCM、非静音**。传给客户端的是剥离 WAV 头后的 PCM bytes，再由其 Opus 编码器发送，避免把 WAV 文件头当音频样本。

噪声：对第一份实际清洁波形加入高斯白噪声，NumPy PCG64 seed 20261004，按全段 RMS 定标为 15 dB，最终量化后实测 SNR `14.999991600563224 dB`，无削波。不是语音活动区 SNR，也不是真实人群/街道噪声。

### 时序和成功门槛

采用原客户端 `transcribe_stream(pcm, realtime=True)`，默认每 20 ms 音频帧插入相应等待；不是加速上传。原客户端并非硬实时调度器，总耗时含编码、建连、逐帧调度及服务处理。

外层记录原始 protobuf `message_type/status_code/status_message` 和每条 result 的文本/最终标记，同时记录第一/最后音频帧与 FinishSession 的实际发送完成时间。每段确认：

1. TaskStarted 和 SessionStarted；
2. 同一条 result 自己带 `is_interim=false` 且 `is_vad_finished=true`；
3. 随后收到 SessionFinished；
4. 所有收到的服务状态码为 `20000000`，没有超时或网络错误。

五段共 28.736125 秒音频。四段首次正式测量开始于 `2026-10-04T10:59:00Z`，第五段复核开始于 `11:01:39Z`。

## 4. 逐句结果

### A. 普通中文，Piper

- 输入，5.596 秒：`今天下午三点开会，请把会议纪要发给我。`
- 最终输出：`今天下午 3 点开会，请把会议纪要发给我。`
- 观察：内容一致，数字规范化、增加数字周围空格。

### B. 中英混输，Piper

- 输入，5.178 秒：`请在 Linux 桌面打开终端，然后运行 Python 脚本。`
- 最终输出：`请在另一个桌面打开终端，然后运行白银搅拌。`
- 观察：Linux、Python 脚本明显误识别。Piper 使用 cmn 音素前端，本次没有人工听音确认其英文发音；这段不能单独衡量自然中英混输识别质量。

### C. 口语填充与修正，Piper

- 输入，7.326 秒：`这个方案，嗯，我想了一下，还是改成明天上午十点吧，不是今天。`
- 最终输出：`这个方案呢？我想了一下，还是改成明天上午 10 点吧？不是今天。`
- 观察：明天/不是今天及十点保留；“嗯”变成“呢”，标点被改为问号。不能宣称逐字无损或口语整理必定正确。

### D. 普通中文 + 15 dB 白噪声，Piper

- 输入与 A 相同，5.596 秒。
- 最终输出：`今天下午 3 点开会，请把会议纪要发给我。`
- 观察：本段与清洁版本结果一致；仅证明这一强度/种类/短句，不推导通用抗噪性能。

### E. 同一句中英混输，微软晓晓

- 输入与 B 完全相同，5.040 秒。
- 最终输出：`请在 Linux 桌面打开终端，然后运行 Python 脚本。`
- 观察：Linux 和 Python 脚本均正确。**同文不同合成声音结果不同，说明不能把 B 的失败直接归因于服务不支持英文。** 未进行人工听音或控制全部声学变量，不宣称已经唯一定位 B 的错误原因。

### 本次延迟

| 样本 | 音频秒数 | 本地调用总秒数 | 首个非空文本 − 第一音频帧发送 | 最终结果 − FinishSession 发送 |
| --- | --: | --: | --: | --: |
| A 普通中文 | 5.596 | 6.150 | 0.810 s | 0.172 s |
| B 中英/Piper | 5.178 | 5.729 | 0.770 s | 0.148 s |
| C 口语修正 | 7.326 | 7.929 | 0.768 s | 0.162 s |
| D 白噪声 | 5.596 | 6.183 | 0.777 s | 0.168 s |
| E 中英/晓晓 | 5.040 | 5.581 | 0.775 s | 0.141 s |

总时间不含首次设备注册/settings 的 2.528 秒，也不含 TTS 生成。尾延迟不是模型纯推理时间；样本少、单次、同一设备/网络，不计算或宣传通用准确率、p95、与官方输入法/火山 API 的优劣。

## 5. 旧客户端有哪些不能直接照搬的地方

代码审查和直接执行原解析器的离线构造输入确认：[S5][S6]

- `_receive_responses` 捕获 ConnectionClosed 后静默结束；文件流队列超时也直接 break。函数正常返回不代表完整识别成功。
- `_parse_response` 不检查 protobuf `status_code`；只靠部分 event 名识别错误。构造未知 event + 403，返回 UNKNOWN 而非 ERROR。
- final 判据跨整个 results 数组聚合，但文本取最后一个非空 result。构造“前条 final，后条 partial”时，后条 partial 文本会被标成 FINAL；两个最终标记甚至可以来自不同条目。
- SessionFinished 若同时携 results，原解析器直接返回无文本的结束事件。构造输入证明附带结果会被忽略；本次现网不代表发生过该情况。
- 初始化的两次 `recv()` 没有业务 deadline；设备/settings HTTP 默认也无 timeout。
- `pyproject.toml` 未列 cryptography，但包级导入 NER→Wave 需要它；本次在临时环境补装。未修改第三方源码或 VoicePaste 依赖。

因此本次没有直接相信 `transcribe()` 返回字符串，而是检查 wire 和逐条 result。将来移植必须正确处理状态码、最终结果归属、关闭/超时/取消，而不是复制这些边缘行为。

## 6. 实验环境问题与处理

第一次 ASR 尝试在 TLS 阶段失败，`SSLCertVerificationError: self-signed certificate in certificate chain`，没有任何 wire 事件，也未上传音频。

定位证据：

- 隔离 venv Python 默认 `openssl_cafile=/etc/ssl/cert.pem` 不存在，`cafile=None`；新建默认 context 的初始 cert_store_stats 为零。
- Requests 使用其 certifi bundle，设备注册/settings 请求已成功。
- 同一 WS 地址的 HTTPS HEAD 使用系统 curl 正常验证 TLS，返回 Frontier 的 HTTP 405 / `Sec-Websocket-Version: 13`。405 是该探测方法不被允许，不是认证或 ASR 失败结论。
- 只为进程显式设置 `SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt` 后，原 ASR 路径成功。**没有关闭证书校验，没有设 CERT_NONE，没有修改系统 CA。**

Opus 动态库由 Nix 提供 `libopus 1.6.1`，仅为隔离进程设置其 `LD_LIBRARY_PATH`。ASR 依赖按仓库 lock 的主要版本：websockets 16.0、pydantic 2.12.5、protobuf 6.33.5、requests 2.32.5、opuslib 3.0.1、miniaudio 1.61；补充 cryptography 50.0.2。Python 3.12.14。

## 7. 对 VoicePaste 的实施判断

现在可以把范围拆开，而不是先建设完整账号体系：

1. **基础语音后端：已有动态可行性证据。** 当前 `audio.rs` 的 16 kHz PCM 输出、快捷键、浮层、后处理与粘贴可以保留；新后端需要 Opus、此 ASR 协议、设备配置获取及明确错误/结束状态。无需把完整 APK 或 Windows DLL 作为运行依赖。
2. **账号登录与个性化：独立验证。** 此旧客户端不覆盖新 Passport token、用户上下文及退出/撤销；五次成功没有证明这些能力。
3. **词库/常用语同步：独立验证。** 不能把本项目火山热词表直接写入输入法同步 API，也不能切换后端时清空/删除原 API Key 和词表。
4. **本次不直接改产品。** 用户请求是调研和试验；没有增加 Python 运行时、Opus 或模型到 VoicePaste，也没有更改其隐私行为。

正式接入前的两个独立风险：

- **代码许可**：固定树无 LICENSE/COPYING，pyproject 无 license，GitHub license=null。公开可读/fork 不等于已经授予 MIT 等复制分发许可。README 的旧 `starccy` 地址当前 404；GitHub 当前 parent `yangmoling/doubaoime-asr` 源码仍可读，不能称上游已全部删除。[S1][S8]
- **服务许可/稳定性**：这仍是非官方消费者接口；本次可用不等于官方支持、无限额度、长期免费或不会变更。输入法专用用户协议中的授权边界仍需确认，不能由代码可用自动解决。[S9]

## 8. 复核工件

本机临时研究目录：`/tmp/voicepaste-ime-asr-check/`。

- `source/doubaoime-asr-9210f628d0dddea5eda45724e79c7f534615a926/`：固定源码。
- `audio/manifest.json`、`audio/edge-manifest.json`：参考文本、TTS 参数、格式、哈希、噪声统计。
- `audio/*.wav`：五份实际被测音频；`04_linux_python_edge.mp3` 是第五份重采样前输入。
- `credentials-probe.json`：仅 host/path/状态/耗时，无凭据值。
- `asr-results.json`、`edge-asr-results.json`：脱敏后的 wire/客户端事件和发送时间；没有保存完整 protobuf 密文/凭据或 req_payload。
- `run_asr_probe.py`：隔离测量脚本；`generate_audio.py`：Piper 生成脚本。

音频 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `01_meeting_clean.wav` | `f6fb606341c409c23c2ccd27c3811032d86fccaa65409046bb9dee00b4ccf257` |
| `02_linux_python_clean.wav` | `1401b8647624dfb67af86462ee1f1c52d800b0d8ef238156dafaf1698fc6c65f` |
| `03_correction_clean.wav` | `59aa1df034ce2282bee89401f1e629335a0b7af4420cfa84eb2f4667b44b3a9b` |
| `01_meeting_noise15db.wav` | `bea7accd231430d79feb143527e2297cd53c7d6f0441e8424bec6de366ae27c2` |
| `04_linux_python_edge.wav` | `286879d8f08b1f676eb90ac56be8b3bfab8749c3370843b9ca407d8e64083047` |

测量命令（适用于本次已创建的临时环境，运行会向服务发送合成音频）：

```sh
env SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
  LD_LIBRARY_PATH=/nix/store/ah26jmgs60s1dzphf0vi4f9pqmlpl9y6-libopus-1.6.1/lib \
  /tmp/voicepaste-ime-asr-check/client-venv/bin/python \
  /tmp/voicepaste-ime-asr-check/run_asr_probe.py
```

第五份复核在同一命令末尾追加：

```text
/tmp/voicepaste-ime-asr-check/audio/edge-manifest.json /tmp/voicepaste-ime-asr-check/edge-asr-results.json
```

临时设备凭据仅为本次串行复用保存，实验结束后清除；因此再次执行脚本会重新注册设备，不应无目的反复执行。音频/脱敏结果留在 `/tmp` 供本机核对，重启或临时目录清理可能丢失；本文保留全部最终文本、时序和输入哈希。

模型许可另有边界：[Huayan 模型卡](https://huggingface.co/rhasspy/piper-voices/blob/c10ece1aade47bb51c153c893d14e5bf8e5b7117/zh/zh_CN/huayan/medium/MODEL_CARD)标数据集 License 为 Unknown，不能仅凭模型仓库 MIT 标签给出再分发许可结论。本次没有把模型加入产品或仓库。

## 来源

- [S1] [固定提交](https://github.com/xiaotian2333/doubaoime-asr/commit/9210f628d0dddea5eda45724e79c7f534615a926)、[完整文件树](https://api.github.com/repos/xiaotian2333/doubaoime-asr/git/trees/9210f628d0dddea5eda45724e79c7f534615a926?recursive=1)。
- [S2] [config.py：初始化/header/session](https://github.com/xiaotian2333/doubaoime-asr/blob/9210f628d0dddea5eda45724e79c7f534615a926/doubaoime_asr/config.py#L58-L241)。
- [S3] [device.py：注册与 settings](https://github.com/xiaotian2333/doubaoime-asr/blob/9210f628d0dddea5eda45724e79c7f534615a926/doubaoime_asr/device.py#L263-L327)。
- [S4] [audio.py：PCM→Opus](https://github.com/xiaotian2333/doubaoime-asr/blob/9210f628d0dddea5eda45724e79c7f534615a926/doubaoime_asr/audio.py#L19-L58)、[asr.proto](https://github.com/xiaotian2333/doubaoime-asr/blob/9210f628d0dddea5eda45724e79c7f534615a926/doubaoime_asr/asr.proto)。
- [S5] [asr.py：会话生命周期](https://github.com/xiaotian2333/doubaoime-asr/blob/9210f628d0dddea5eda45724e79c7f534615a926/doubaoime_asr/asr.py#L128-L523)。
- [S6] [asr.py：结果解析](https://github.com/xiaotian2333/doubaoime-asr/blob/9210f628d0dddea5eda45724e79c7f534615a926/doubaoime_asr/asr.py#L589-L684)。
- [S7] [ner.py](https://github.com/xiaotian2333/doubaoime-asr/blob/9210f628d0dddea5eda45724e79c7f534615a926/doubaoime_asr/ner.py)、[Wave lazy 调用](https://github.com/xiaotian2333/doubaoime-asr/blob/9210f628d0dddea5eda45724e79c7f534615a926/doubaoime_asr/config.py#L243-L303)。
- [S8] [pyproject.toml](https://github.com/xiaotian2333/doubaoime-asr/blob/9210f628d0dddea5eda45724e79c7f534615a926/pyproject.toml)、[上游固定树](https://github.com/yangmoling/doubaoime-asr/tree/267972f815f519fd7c6149f85a8b7cc99daf61a5)。
- [S9] [豆包输入法用户协议](https://lf3-cdn-tos.draftstatic.com/obj/ies-hotsoon-draft/wave_ime/ime_privacy_user_agreement.html)。
- [T1] [Piper 固定模型与模型卡](https://huggingface.co/rhasspy/piper-voices/tree/c10ece1aade47bb51c153c893d14e5bf8e5b7117/zh/zh_CN/huayan/medium)、[Piper 1.4.2 发布元数据](https://pypi.org/pypi/piper-tts/1.4.2/json)、[edge-tts 项目](https://github.com/rany2/edge-tts)。
