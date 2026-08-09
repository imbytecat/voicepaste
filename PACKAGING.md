# VoicePaste 发布与打包

VoicePaste 是完全开源的免费项目。当前发布不使用付费 Apple Developer 或 Windows 代码签名证书：

- macOS Apple Silicon 使用 ad-hoc 签名，未做 Apple 公证；
- Windows 安装包不做 Authenticode 签名；
- 应用不提供自动更新，用户从 GitHub Releases 手动下载安装。

发布工作流位于 `.github/workflows/release.yml`。推送版本 tag 时构建 GitHub Release 草稿；手动运行 `workflow_dispatch` 时生成三平台测试产物。

## 正式产物

`src-tauri/tauri.conf.json` 使用 `bundle.targets = "all"`：

- Linux：DEB、AppImage、RPM；
- Apple Silicon Mac（macOS 11+）：DMG、`.app`；
- Windows：NSIS `.exe`、MSI。

Release 默认保持草稿，验证完成后再公开。工作流只使用 GitHub Actions 自动提供的 `GITHUB_TOKEN`，不需要 updater 或平台代码签名 secrets。

## 工具链

Node.js、pnpm 与 Rust 版本统一定义在 `mise.toml`。本地与 GitHub Actions 均通过 mise 安装；Linux 系统库仍由 `apt` 安装。

```bash
mise install
```

## 未签名平台提示

- macOS 使用 `bundle.macOS.signingIdentity = "-"` 做 Apple Silicon 必需的 ad-hoc 签名，不代表已验证开发者身份，也不包含公证票据。用户可能需要右键应用并选择“打开”，或在“隐私与安全性”中允许打开。
- Windows SmartScreen 可能显示未知发布者。用户应核对下载 URL 与 Release 信息后，通过“更多信息”继续。
- 后续若项目获得签名条件，再加入 Developer ID、公证与 Authenticode；当前工作流不要求这些付费凭据。

## 发布版本

1. 安装 `mise.toml` 中定义的工具链：

   ```bash
   mise install
   ```

2. 确认三个清单中的版本一致：

   ```bash
   node -e "const fs=require('fs');const p=require('./package.json').version;const t=require('./src-tauri/tauri.conf.json').version;const c=fs.readFileSync('./src-tauri/Cargo.toml','utf8').match(/^version = \"([^\"]+)\"/m)?.[1];console.log({package:p,tauri:t,cargo:c});if(p!==t||p!==c)process.exit(1)"
   ```

3. 确认 CI 通过。可先手动运行 **Release** workflow，验证三平台测试构建。
4. 创建并推送 tag：

   ```bash
   VERSION="$(node -p "require('./package.json').version")"
   git tag -a "v$VERSION" -m "VoicePaste $VERSION"
   git push origin "v$VERSION"
   ```

5. 等待 Linux、macOS、Windows jobs 全部成功。
6. 验证 Release 草稿后公开发布。任一平台失败或产物不完整时不要公开。

## 发布验证清单

### Release 资产

- [ ] Linux 包含 `.deb`、`.AppImage`、`.rpm`。
- [ ] macOS 包含 Apple Silicon `.dmg`。
- [ ] Windows 包含 NSIS `.exe`、`.msi`。
- [ ] Release 中没有密钥、密码、本地路径或证书文件。

### 安装与功能

- [ ] Ubuntu/Debian 安装 DEB；RPM 系安装 RPM；AppImage 可启动。
- [ ] Apple Silicon Mac 可从 DMG 安装；确认系统显示的是预期未公证提示，而非损坏包。
- [ ] Windows 分别验证 NSIS、MSI 安装、启动、卸载；确认未知发布者提示符合预期。
- [ ] 首次设置可完成：API Key 测试、快捷键、麦克风、保存设置。
- [ ] 切换与按住模式均可完成听写，最终文本进入原输入位置。
- [ ] 关闭设置窗口后仍在托盘运行；托盘可打开设置、查看最新版本、退出。
