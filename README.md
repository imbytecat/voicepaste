# VoicePaste

VoicePaste 是跨平台桌面语音输入工具。按全局快捷键开始听写，豆包流式识别完成后，文本会粘贴到当前输入位置。

## 安装

从 [GitHub Releases](https://github.com/imbytecat/voicepaste/releases/latest) 下载当前系统对应的正式产物：

- **Windows**：优先使用 NSIS 安装程序（`.exe`），也可使用 MSI（`.msi`）。按安装向导完成安装。
- **Apple Silicon Mac（macOS 11 及以上）**：打开 `.dmg`，将 VoicePaste 拖入“应用程序”。
- **Debian / Ubuntu**：下载 `.deb` 后运行 `sudo apt install ./VoicePaste_*.deb`。
- **Fedora / RHEL**：下载 `.rpm` 后运行 `sudo dnf install ./VoicePaste-*.rpm`。
- **其他常见 Linux 发行版**：下载 AppImage，运行 `chmod +x VoicePaste_*.AppImage`，再双击或执行 `./VoicePaste_*.AppImage`。
- **NixOS 等非 FHS 发行版**：AppImage 需要 FHS 运行环境，直接执行会报 `libasound.so.2: cannot open shared object file`。开启 `programs.appimage.enable = true;`（可再加 `programs.appimage.binfmt = true;` 直接双击运行），或临时用 `nix run nixpkgs#appimage-run -- ./VoicePaste_*.AppImage`。详见 [PACKAGING.md](PACKAGING.md#appimage-与宿主库)。

VoicePaste 是完全开源的早期项目，目前不购买 Apple Developer 或 Windows 代码签名证书。macOS Gatekeeper 与 Windows SmartScreen 可能因此显示“未知开发者”提示；请核对下载来源确为本仓库 Release。

若系统拦截：macOS 可右键 VoicePaste 选择“打开”，或到“隐私与安全性”允许打开；Windows 可在 SmartScreen 中选择“更多信息”后继续。只有确认文件来自本仓库 Release 时才应绕过提示。

## 首次设置

1. 启动 VoicePaste，按系统提示授予麦克风权限；macOS、Windows 或 Linux 桌面环境还可能要求辅助功能、输入控制或全局快捷键权限。
2. 在设置中填写从火山引擎控制台获取的豆包 API Key，点击“测试连接”。
3. 选择麦克风，使用麦克风测试确认有输入音量。
4. 设置全局快捷键、按键模式和可选常用词；也可配置 OpenAI 兼容 API，在识别后使用 LLM 整理文本。LLM 后处理会增加最终输入的等待时间。
5. 保存设置，在任意可输入文本的应用中试用。

## 使用

- **切换模式**：按一次全局快捷键开始，再按一次完成。
- **按住模式**：按住全局快捷键说话，松开完成。
- **托盘**：关闭设置窗口后 VoicePaste 继续在系统托盘运行。托盘菜单可打开设置、检查更新或完全退出。
- **版本更新**：应用启动后会检查 GitHub Releases；发现新版本时，可在“关于”页确认安装。更新包使用 VoicePaste updater 密钥验证。

## 数据与隐私

VoicePaste 没有自建遥测。麦克风音频只在用户主动听写期间发送给豆包语音识别服务；常用词会保存在本机，并同步到用户自己的火山引擎账户。可选 LLM 后处理会将识别文本发送到用户配置的第三方服务。API Key 优先保存在系统凭据库。日志不会记录 API Key、音频数据或识别正文。详见 [PRIVACY.md](PRIVACY.md)。

## 开发

开发工具链由 `mise.toml` 统一管理：

```bash
mise install
pnpm install
mise run dev
```

Ubuntu 构建依赖：

```bash
sudo apt-get update
sudo apt-get install -y libasound2-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev libxkbcommon-dev patchelf xdg-utils
```

发布与签名流程见 [PACKAGING.md](PACKAGING.md)。

## 许可证

[MIT](LICENSE)
