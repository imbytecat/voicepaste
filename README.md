<p align="center">
  <img src="src-tauri/icons/128x128.png" width="96" height="96" alt="VoicePaste 图标">
</p>

<h1 align="center">VoicePaste</h1>

<p align="center">
  按下快捷键开始说话，让语音直接出现在当前输入位置。
</p>

<p align="center">
  <a href="https://github.com/imbytecat/voicepaste/releases/latest"><img src="https://img.shields.io/github/v/release/imbytecat/voicepaste?display_name=tag&sort=semver" alt="最新版本"></a>
  <a href="https://github.com/imbytecat/voicepaste/actions/workflows/ci.yml"><img src="https://github.com/imbytecat/voicepaste/actions/workflows/ci.yml/badge.svg" alt="CI 状态"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/imbytecat/voicepaste" alt="MIT 许可证"></a>
</p>

VoicePaste 是面向 Windows、macOS 和 Linux 的桌面语音输入工具。它通过全局快捷键启动听写，实时显示识别状态，并将最终文本粘贴到当前应用的光标位置。聊天窗口、文档、IDE、搜索框和表单都可以直接使用，不依赖特定编辑器或浏览器扩展。

VoicePaste 支持火山引擎官方 API 和豆包输入法服务两种识别方式，不运营中转服务器，也不提供或转售 API 配额。豆包输入法接入为实验性的非官方协议，不要求账号登录；也可主动扫码登录并在输入法服务验证会话后使用账号身份。

## 主要功能

- **全局语音输入**：在任意可输入文本的桌面应用中开始听写。
- **两种触发方式**：支持按一次开始、再按一次结束，也支持按住说话、松开结束。
- **实时状态浮层**：显示录音、识别、文本处理和错误状态，不打断当前工作。
- **唯一活动渠道**：豆包输入法或火山引擎 API 二选一；只运行所选渠道的功能，另一套配置独立保留，不后台校验、联网或自动接管。
- **可选豆包账号**：官方二维码、系统凭据库保存会话；过期后需重新登录或明确退出到未登录方式，不静默切换身份。
- **真实试说**：使用当前渠道已保存的识别与词库配置，结果只显示在设置页，不执行 LLM 后处理或外部粘贴。
- **独立词库管理**：火山常用词支持本机草稿、TXT 导入导出与明确云端提交；豆包账号常用语支持主动读取、增改和逐条确认删除，提交后回读验证。自动学习的豆包个人词库支持只读查看与本地搜索，不冒充已接入热词增强或云端重置。
- **渠道独立的 LLM 后处理**：各渠道分别保存 OpenAI 兼容模型、Key、开关和表达偏好，不在切换时继承另一渠道的处理配置。
- **豆包文本工具**：账号智能整理可用于正式听写后处理；手工文本支持中英互译、整理、总结、重写、要点与列表，保留原文、取消请求和明确复制，结果不自动替换其他应用。
- **系统级凭据存储**：API Key、设备身份及账号会话保存在系统凭据库；不可用时明确报错，不降级保存明文。
- **应用内更新**：从 GitHub Releases 获取经过 VoicePaste updater 密钥验证的更新包。
- **无自建遥测**：不包含行为分析、广告 SDK 或开发者自建的崩溃上报服务。

## 下载与安装

从 [GitHub Releases](https://github.com/imbytecat/voicepaste/releases/latest) 下载对应系统的安装包。

| 系统 | 支持范围 | 推荐安装包 |
| --- | --- | --- |
| Windows | Windows 10/11 x64 | `VoicePaste-<版本>-windows-x64-setup.exe` |
| macOS | Apple Silicon，macOS 11 及以上 | `VoicePaste-<版本>-darwin-aarch64.dmg` |
| Debian / Ubuntu | x86_64 | `VoicePaste-<版本>-linux-amd64.deb` |
| Fedora / RHEL | x86_64 | `VoicePaste-<版本>-linux-x86_64.rpm` |
| 其他 Linux 发行版 | x86_64，FHS 环境 | `VoicePaste-<版本>-linux-amd64.AppImage` |

Windows 也提供 MSI 安装包。Release 中的 `latest.json`、`.sig` 和 `.app.tar.gz` 用于应用内更新，普通用户无需手动下载。

> [!IMPORTANT] VoicePaste 是免费开源项目，目前未购买 Apple Developer 或 Windows 商业代码签名证书。macOS Gatekeeper 或 Windows SmartScreen 可能显示“未知开发者”提示。只有确认文件来自本仓库的 GitHub Release 时，才应选择继续运行。

macOS 可右键 VoicePaste 选择“打开”，或在“系统设置 → 隐私与安全性”中允许打开。Windows 可在 SmartScreen 页面选择“更多信息 → 仍要运行”。

NixOS 等非 FHS 发行版不能直接运行普通 AppImage。可启用 NixOS 的 AppImage 支持，或使用：

```bash
nix run nixpkgs#appimage-run -- ./VoicePaste_*.AppImage
```

详细原因和其他打包信息见 [PACKAGING.md](PACKAGING.md#appimage-与宿主库)。

## 开始使用

1. 启动 VoicePaste，选择“豆包输入法”或“火山引擎 API”。豆包方式无需填写 Key；火山方式需自行开通服务并配置 Key，费用和配额由火山账户决定。
2. 点击“测试连接”。豆包首次使用会注册设备，随后验证当前识别服务会话；连接测试不录音，也不代表词库已同步。
3. 豆包账号登录是可选操作：使用豆包或豆包输入法 App 扫描官方二维码，确认登录“豆包输入法 PC 端”。只有返回令牌通过输入法服务校验后才显示已登录；若服务拒绝，不会将网页 Cookie 或扫码完成本身当作成功。
4. 设置快捷键和麦克风，需要时“试说一句”；系统权限仅按实际操作申请。火山常用词在“词库”页管理：“保留本机草稿”不联网，“确认并应用到火山”才修改云词表。
5. 保存设置，在输入框中触发快捷键开始说话。切换使用方式前需结束录音或写入并处理未保存修改；不复制词条、不删除另一渠道数据、不自动回退。

当前配置结构为 schema 3。从公开 1.5.0 升级时，一次性迁移旧设置到火山渠道，先保存本机 `settings.pre-v3.json` 备份，并复制原凭据到新命名空间；其他不支持的文件或会话明确报错，不静默覆盖。关闭词库或切换渠道不会删除云端词表；删除火山受管理词表需在原 Key 有效时明确清空词条并确认应用。

本功能分支的豆包账号常用语操作须在词库页主动触发，登录不自动上传或读取词库。个人词库目前仅只读；语音热词上传、个人词库云端重置与超级互传尚未完成，不列为可用能力。新增能力仍在验收，公开 Release 不等于本分支功能已发布。非官方接口不保证长期可用、免费额度或与官方客户端效果完全相同；请确认适用的第三方服务条款。

关闭设置窗口不会退出 VoicePaste。应用会继续在系统托盘运行，可从托盘菜单重新打开设置、检查更新或完全退出。

## LLM 后处理

LLM 后处理默认关闭。启用后，VoicePaste 会在语音识别完成后，将识别文本发送到用户配置的 OpenAI 兼容 `/chat/completions` 接口，再粘贴模型返回的最终文本。请求失败、响应无效或返回空文本时，应用会使用原始识别结果。

设置页提供 DeepSeek、Qwen、OpenAI / Gemini / Ollama 和 OpenRouter 等常见服务的请求参数预设，也支持高级 JSON 参数。模型、消息和流式响应等核心字段由 VoicePaste 管理，API Key 不应写入自定义 JSON。

启用“流式显示”后，模型生成的正文会实时显示在悬浮窗中；推理或思考内容不会显示或粘贴。服务是否支持流式响应和关闭思考取决于具体模型。

## 数据与隐私

VoicePaste 不运营后端服务。正常听写的数据流如下：

```text
麦克风 → 当前选中的识别服务 → 可选豆包整理或用户自定义 LLM → 当前输入位置
```

- 麦克风只在用户主动听写、试说或测试音量时采集；VoicePaste 不在本机保存录音，单纯音量测试不上传。
- 听写与试说音频直接发送到选中的识别服务，不经过 VoicePaste 自建服务器，不在服务失败后自动改发另一后端。
- 火山常用词保存在本机，明确修改后保存时同步到对应火山账户；其他设置修改不会触发词表同步。
- 识别结果返回后，启用后处理的正式听写会将最终文本发给所选豆包整理或用户自定义 LLM；两者互斥，试说不会执行。手工文本工具仅在用户点击后发送输入框内容，详见隐私说明。
- 日志不记录 API Key、账号令牌、原始音频、识别正文或常用词内容。完整网络与会话处理见隐私说明。

完整说明见 [PRIVACY.md](PRIVACY.md)。提交公开 Issue 或日志前，请移除 API Key、录音、完整识别文本和其他敏感信息。

## 项目状态

VoicePaste 仍处于早期开发阶段。核心输入流程可用，但不同桌面环境的权限模型、全局快捷键和自动粘贴行为可能存在差异。遇到问题时，请在 [GitHub Issues](https://github.com/imbytecat/voicepaste/issues) 中提供系统版本、桌面环境、VoicePaste 版本和可复现步骤。

本项目的代码、测试、文档和发布流程主要由 AI coding agents 维护，项目所有者负责产品方向、权限管理和最终发布。Issue 与 Pull Request 均欢迎提交；涉及行为变更时，请说明实际使用场景和期望结果。

## 本地开发

项目使用 Tauri、Rust、React 和 TypeScript，工具链由 [`mise.toml`](mise.toml) 统一管理：

```bash
mise install
pnpm install
mise run hooks:install
mise run dev
```

运行完整检查：

```bash
mise run check
```

构建依赖、安装包格式、签名和发布流程见 [PACKAGING.md](PACKAGING.md)。

## 许可证

VoicePaste 以 [MIT License](LICENSE) 开源。
