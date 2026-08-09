# Tauri v2 updater 与平台代码签名

## 结论

**可以技术上安装更新，但不能省略 Tauri updater 自身的签名。** Tauri updater 强制要求使用其公钥/私钥验证更新，文档明确写着 “This cannot be disabled”。这套签名是更新包完整性/发布者密钥信任，不是 Apple Developer ID、Apple notarization 或 Windows Authenticode。

因此，当前 VoicePaste 的 `signingIdentity: "-"`（macOS ad-hoc）以及未签名 Windows 安装包，不会阻止 updater 下载、验证并安装带有 Tauri `.sig` 的更新；它们会影响操作系统对首次下载/启动的信任体验：macOS 外部分发通常需要 Apple Developer ID 签名和 notarization，Windows 未签名下载会触发 SmartScreen。来源：[Updater signing](https://v2.tauri.app/plugin/updater/#signing-updates)、[macOS signing/notarization](https://v2.tauri.app/distribute/sign/macos/)、[Windows signing](https://v2.tauri.app/distribute/sign/windows/)。

## 三类签名必须分开

| 签名 | 作用 | 当前仓库影响 |
| --- | --- | --- |
| Tauri updater 签名（Ed25519 密钥对，生成 `.sig`） | updater 用 `plugins.updater.pubkey` 验证更新包，且强制要求 | **必须新增**；与平台证书无关 |
| Apple Developer ID / notarization | macOS Gatekeeper/浏览器下载信任；Tauri 文档称外部分发需要 code signing + notarization | 当前 `signingIdentity: "-"` 是 ad-hoc；可安装/更新不等于无 Gatekeeper 警告 |
| Windows Authenticode | Windows 安装器身份与 SmartScreen/Store 信任 | 未签名仍可执行（用户接受 SmartScreen）；不影响 Tauri `.sig` 校验 |

Tauri 的 macOS 文档明确：ad-hoc identity `-` 可用于签名；其用途是 Apple Silicon 上满足“从 Internet 来的 app 需要 code-signing”。同页明确外部分发 DMG 仍需要 Apple code signing 和 notarization。Windows 文档明确 code signing 不是执行应用的必要条件，但可避免浏览器下载的 SmartScreen 警告。来源：[macOS Ad-Hoc Signing](https://v2.tauri.app/distribute/sign/macos/#ad-hoc-signing)、[macOS distribution](https://v2.tauri.app/distribute/#macos)、[Windows Code Signing](https://v2.tauri.app/distribute/sign/windows/)。

## 平台与 updater 产物

官方 updater 插件支持 `windows`、`linux`、`macos`；Android/iOS 不支持。[Supported Platforms](https://v2.tauri.app/plugin/updater/#supported-platforms)

启用 `bundle.createUpdaterArtifacts: true` 后，构建时需要环境变量 `TAURI_SIGNING_PRIVATE_KEY`（路径或内容）和可选 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`；`.env` 文件不生效。Tauri 生成平台包及对应 `.sig`：

- Linux：AppImage 及其 `.sig`；updater plugin 2.10 也支持 DEB、RPM，并由 `tauri-action@v1` 收集对应 `.sig`。
- macOS：生成 `myapp.app.tar.gz` 与 `.sig`。
- Windows：NSIS `myapp-setup.exe` 与 `.sig`；MSI `myapp.msi` 与 `.sig`。

这些是 updater artifact/signature，不是 Authenticode 或 Apple Developer ID 签名。来源：[Building updater artifacts](https://v2.tauri.app/plugin/updater/#building)。

**Windows NSIS/MSI caveat：** updater 支持两种安装器，且 `plugins.updater.windows.installMode` 可选 `passive`（默认）、`basicUi`、`quiet`；`quiet` 不能自行请求管理员权限，仅适用于 per-user 安装或应用已以管理员运行。[Windows installMode](https://v2.tauri.app/plugin/updater/#installmode-on-windows)

**Linux caveat：** updater plugin 2.10 已支持 AppImage、DEB、RPM，会识别当前安装包类型并优先选择 `{os}-{arch}-{installer}` metadata；DEB/RPM 更新调用 `dpkg`/`rpm`，可能要求管理员授权。这仍不是发行版仓库的原生更新渠道。[Updater 2.10 changelog](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/updater/CHANGELOG.md)、[bundle detection/install source](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/updater/src/updater.rs)、[tauri-action artifact discovery](https://github.com/tauri-apps/tauri-action/blob/dev/src/build.ts)

## 最小配置与 secrets

1. 安装 `tauri-plugin-updater` 并初始化 `tauri_plugin_updater::Builder::new().build()`；可直接使用 Rust `UpdaterExt`，只有前端直接调用 plugin API 时才需要 `@tauri-apps/plugin-updater`。[Setup](https://v2.tauri.app/plugin/updater/#setup)
2. 生成 updater 密钥：`npm run tauri signer generate -- -w ~/.tauri/myapp.key`。把**公钥内容**写入配置，不能写文件路径；私钥绝不提交且丢失后现有安装无法继续发布更新。[Signing updates](https://v2.tauri.app/plugin/updater/#signing-updates)
3. 配置：

```json
{
  "bundle": { "createUpdaterArtifacts": true },
  "plugins": {
    "updater": {
      "pubkey": "PUBLIC KEY CONTENT",
      "endpoints": [
        "https://github.com/OWNER/REPO/releases/latest/download/latest.json"
      ]
    }
  }
}
```

生产环境 endpoint 强制 TLS；`dangerousInsecureTransportProtocol: true` 才允许 HTTP，不建议。[Tauri Configuration](https://v2.tauri.app/plugin/updater/#tauri-configuration)

4. GitHub Actions 至少需要：`TAURI_SIGNING_PRIVATE_KEY`、如密钥加密则 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`，以及发布 Release 所需的 `GITHUB_TOKEN`。官方 GitHub pipeline 示例使用 `permissions: contents: write`、`tauri-apps/tauri-action@v1` 和 `GITHUB_TOKEN`；updater 私钥环境变量要求来自 updater 文档。[GitHub pipeline](https://v2.tauri.app/distribute/pipelines/github/#example-workflow)、[Building](https://v2.tauri.app/plugin/updater/#building)

本仓库当前 macOS ad-hoc 不需要 Apple secrets；未签名 Windows 不需要 `WINDOWS_CERTIFICATE`/密码。若未来要消除平台警告，再分别增加 Apple 证书/notarization secrets 或 Windows Authenticode 证书 secrets；那是平台分发改进，不是 updater 的最低要求。[macOS CI secrets](https://v2.tauri.app/distribute/sign/macos/#signing-in-cicd-platforms)、[Windows GitHub signing](https://v2.tauri.app/distribute/sign/windows/#sign-your-application-with-github-actions)

## `latest.json` / GitHub Releases

静态 JSON 可托管在 GitHub Releases；官方配置示例直接使用 `https://github.com/user/repo/releases/latest/download/latest.json`。[Updater configuration](https://v2.tauri.app/plugin/updater/#tauri-configuration)

静态 metadata 必须包含 `version`、目标平台 `platforms.[target].url`、`platforms.[target].signature`；`signature` 必须是 `.sig` 文件**内容**，不能是路径或 URL。基础平台 key 为 `linux|darwin|windows` + `-` + `x86_64|aarch64|i686|armv7`；新版插件还会优先查找 `{os}-{arch}-{installer}`，例如 `linux-x86_64-deb`、`windows-x86_64-nsis`。版本须 SemVer；`notes`、RFC3339 `pub_date` 可选。Tauri 会先验证整个 JSON，再检查版本，因此每个已列出的平台项都必须完整有效。[Static JSON File](https://v2.tauri.app/plugin/updater/#static-json-file)、[target selection source](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/updater/src/updater.rs)

示例结构：

```json
{
  "version": "1.1.0",
  "notes": "...",
  "pub_date": "2026-08-09T00:00:00Z",
  "platforms": {
    "darwin-x86_64": {
      "url": "...app.tar.gz",
      "signature": "...sig content..."
    },
    "windows-x86_64": {
      "url": "...exe or msi...",
      "signature": "...sig content..."
    },
    "linux-x86_64": { "url": "...AppImage", "signature": "...sig content..." }
  }
}
```

**Repo-specific setup：** 当前仓库已配置 updater plugin、`pubkey`、GitHub Releases endpoint 与 `createUpdaterArtifacts`；Rust commands 负责检查/安装，`tauri-action@v1` 使用 repository secret 生成签名资产和 `latest.json`。GitHub Actions 不会替平台签名，也不会替代 Tauri updater 密钥。[Official GitHub pipeline](https://v2.tauri.app/distribute/pipelines/github/)

## 最终判断

- macOS：**Yes，技术上可更新**；要求 Tauri `.sig` 验证。无 Developer ID/notarization 可能有 Gatekeeper/下载警告，ad-hoc 不提供 Apple 发布者信任。
- Windows NSIS/MSI：**Yes，技术上可更新**；要求各安装器 updater `.sig`。无 Authenticode 可能有 SmartScreen 警告，但不是 updater 安装硬门槛。
- Linux AppImage/DEB/RPM：**Yes，updater plugin 2.10 支持**；DEB/RPM 更新可能触发管理员授权。

所以“无需 Apple Developer ID/notarization 或 Windows Authenticode”答案是：**对 Tauri updater 的安装机制为 Yes；对无平台警告、OS 发布者信任和商店分发为 No。**
