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

VoicePaste 使用用户自己的火山引擎豆包语音识别服务，不运营中转服务器，也不提供或转售 API 配额。

## 主要功能

- **全局语音输入**：在任意可输入文本的桌面应用中开始听写。
- **两种触发方式**：支持按一次开始、再按一次结束，也支持按住说话、松开结束。
- **实时状态浮层**：显示录音、识别、文本处理和错误状态，不打断当前工作。
- **云端常用词**：将专业名词、人名和产品名同步到用户自己的火山引擎词表，提高识别准确率。
- **可选 LLM 后处理**：使用 OpenAI 兼容接口整理标点、修正表达或按自定义风格改写文本。
- **系统级凭据存储**：API Key 优先保存在 macOS 钥匙串、Windows 凭据管理器或 Linux Secret Service。
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

1. 准备火山引擎豆包语音识别 API Key。第三方服务的开通条件、配额和费用由用户自己的火山引擎账户决定。
2. 启动 VoicePaste，并按系统提示授予麦克风、全局快捷键和输入控制等必要权限。
3. 在设置中填写豆包 API Key，点击“测试连接”，再选择并测试麦克风。
4. 设置全局快捷键和触发方式；需要时添加常用词或配置 LLM 后处理。
5. 保存设置，在任意输入框中触发快捷键并开始说话。

关闭设置窗口不会退出 VoicePaste。应用会继续在系统托盘运行，可从托盘菜单重新打开设置、检查更新或完全退出。

## LLM 后处理

LLM 后处理默认关闭。启用后，VoicePaste 会在语音识别完成后，将识别文本发送到用户配置的 OpenAI 兼容 `/chat/completions` 接口，再粘贴模型返回的最终文本。请求失败、响应无效或返回空文本时，应用会使用原始识别结果。

设置页提供 DeepSeek、Qwen、OpenAI / Gemini / Ollama 和 OpenRouter 等常见服务的请求参数预设，也支持高级 JSON 参数。模型、消息和流式响应等核心字段由 VoicePaste 管理，API Key 不应写入自定义 JSON。

启用“流式显示”后，模型生成的正文会实时显示在悬浮窗中；推理或思考内容不会显示或粘贴。服务是否支持流式响应和关闭思考取决于具体模型。

## 数据与隐私

VoicePaste 不运营后端服务。正常听写的数据流如下：

```text
麦克风 → 豆包语音识别 → 可选的用户自定义 LLM 服务 → 当前输入位置
```

- 麦克风只在用户主动听写期间采集；VoicePaste 不在本机保存录音。
- 音频直接发送到豆包语音识别服务，不经过 VoicePaste 自建服务器。
- 常用词保存在本机，并同步到用户自己的火山引擎账户。
- 识别文本默认只在本机处理；只有启用 LLM 后处理时才会发送到用户指定的第三方服务。
- 日志不记录 API Key、原始音频、识别正文或常用词内容。

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
