# VoicePaste 发布与打包

VoicePaste 是完全开源的免费项目。当前发布不使用付费 Apple Developer 或 Windows 代码签名证书：

- macOS Apple Silicon 使用 ad-hoc 签名，未做 Apple 公证；
- Windows 安装包不做 Authenticode 签名；
- 应用使用 Tauri updater 从 GitHub Releases 检查并安装更新；更新包使用独立密钥签名。

发布工作流位于 `.github/workflows/release.yml`。推送版本 tag 时构建 GitHub Release 草稿；手动运行 `workflow_dispatch` 时生成三平台测试产物。

## 正式产物

`src-tauri/tauri.conf.json` 使用 `bundle.targets = "all"`：

- Linux：DEB、AppImage、RPM；
- Apple Silicon Mac（macOS 11+）：DMG、`.app`；
- Windows：NSIS `.exe`、MSI。

面向用户的 Release 文件名必须包含系统与架构：

| 系统                | 推荐文件                                     |
| ------------------- | -------------------------------------------- |
| Windows 10/11 x64   | `VoicePaste_<version>_Windows_x64-setup.exe` |
| Apple Silicon Mac   | `VoicePaste_<version>_macOS_aarch64.dmg`     |
| Debian / Ubuntu x64 | `VoicePaste_<version>_Linux_amd64.deb`       |
| Fedora / RHEL x64   | `VoicePaste_<version>_Linux_x86_64.rpm`      |
| 其他 x64 Linux      | `VoicePaste_<version>_Linux_amd64.AppImage`  |

MSI 是 Windows 备选安装包。`latest.json`、`.sig` 与 `.app.tar.gz` 服务于 updater，普通用户无需手动下载。

Release 默认保持草稿，验证完成后再公开发布。工作流使用 GitHub Actions 自动提供的 `GITHUB_TOKEN`，并从 `TAURI_SIGNING_PRIVATE_KEY` secret 读取 updater 私钥；不需要平台代码签名 secrets。

## 工具链

Node.js、pnpm 与 Rust 版本统一定义在 `mise.toml`。本地与 GitHub Actions 均通过 mise 安装；Linux 系统库仍由 `apt` 安装。

```bash
mise install
```

## 未签名平台提示

- macOS 使用 `bundle.macOS.signingIdentity = "-"` 做 Apple Silicon 必需的 ad-hoc 签名，不代表已验证开发者身份，也不包含公证票据。用户可能需要右键应用并选择“打开”，或在“隐私与安全性”中允许打开。
- Windows SmartScreen 可能显示未知发布者。用户应核对下载 URL 与 Release 信息后，通过“更多信息”继续。
- 后续若项目获得签名条件，再加入 Developer ID、公证与 Authenticode；当前工作流不要求这些付费凭据。

## Updater 签名

Tauri updater 签名与 Apple Developer ID、Apple 公证、Windows Authenticode 相互独立。它只验证更新包确由 VoicePaste 发布，不能消除 Gatekeeper 或 SmartScreen 警告。

- 公钥保存在 `src-tauri/tauri.conf.json`；
- 私钥本机备份位于 `~/.tauri/voicepaste.key`，权限应为 `600`；
- GitHub Actions 私钥保存在 `TAURI_SIGNING_PRIVATE_KEY` repository secret；
- 私钥不得提交、上传到 Release 或写入日志。丢失后，已安装版本无法验证后续更新。

Updater 不要求安装包使用固定文件名；`latest.json` 记录实际资产 URL 与签名。`latest.json` 文件名和配置 endpoint 必须保持一致，安装包扩展名必须保留。Release 资产统一由 `tauri-action` 的 `releaseAssetNamePattern` 重命名，不在构建后手工改动文件配对关系。

构建 updater 产物时，`TAURI_SIGNING_PRIVATE_KEY` 可指向私钥文件：

```bash
export TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/voicepaste.key"
```

NixOS 本地环境不能可靠生成 AppImage；本地只运行检查与原生构建，三平台安装包和 updater 产物统一通过 GitHub Actions `Release` 工作流构建。

## 发布版本

1. 安装 `mise.toml` 中定义的工具链：

   ```bash
   mise install
   ```

2. 升级版本：只改 `src-tauri/Cargo.toml` 的 `version`。应用、安装包、updater 与 tag 校验都以它为准；`tauri.conf.json` 省略 `version` 时 Tauri 回退到 Cargo 版本，`package.json` 不记录版本。

3. 确认 CI 通过。手动运行 **Release** workflow，下载三平台测试 artifact，验证安装包与 updater `.sig` 已生成。
4. 创建并推送 tag：

   ```bash
   VERSION="$(node -p "require('fs').readFileSync('src-tauri/Cargo.toml','utf8').match(/^version = \"([^\"]+)\"/m)[1]")"
   git tag -a "v$VERSION" -m "VoicePaste $VERSION"
   git push origin "v$VERSION"
   ```

5. 等待 Linux、macOS、Windows jobs 全部成功。
6. 验证 Release 草稿后公开发布。任一平台失败或产物不完整时不要公开。

## 发布验证清单

### Release 资产

- [ ] Linux 包含 `.deb`、`.AppImage`、`.rpm`；`latest.json` 含对应 installer target。
- [ ] macOS 包含 Apple Silicon `.dmg` 与 updater `.app.tar.gz`。
- [ ] Windows 包含 NSIS `.exe`、MSI；`latest.json` 含对应 installer target。
- [ ] Release 包含完整 `latest.json`，其中嵌入的签名匹配实际更新资产。
- [ ] Release 中没有密钥、密码、本地路径或证书文件。

### 安装与功能

- [ ] Ubuntu/Debian 安装 DEB；RPM 系安装 RPM；AppImage 可启动。
- [ ] Apple Silicon Mac 可从 DMG 安装；确认系统显示的是预期未公证提示，而非损坏包。
- [ ] Windows 分别验证 NSIS、MSI 安装、启动、卸载；确认未知发布者提示符合预期。
- [ ] 首次设置可完成：API Key 测试、快捷键、麦克风、保存设置。
- [ ] 切换与按住模式均可完成听写，最终文本进入原输入位置。
- [ ] 关闭设置窗口后仍在托盘运行；托盘可打开设置、检查更新、退出。
- [ ] “关于”页可检查更新；发现新版本后可下载、验证、安装并重启。
