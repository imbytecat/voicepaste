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

## AppImage 与宿主库

AppImage 不是完全自包含的容器。linuxdeploy 按 [AppImage excludelist](https://github.com/AppImage/pkg2appimage/blob/master/excludelist) 主动排除一批“假定宿主已提供”的基础库，因此产物依赖宿主的 FHS 库路径。VoicePaste 1.1.0 的 AppImage 打进了 167 个 `.so`，但以下 17 个按 excludelist 被排除：

```
libEGL.so.1      libGL.so.1        libX11-xcb.so.1   libX11.so.6
libasound.so.2   libcom_err.so.2   libdrm.so.2       libexpat.so.1
libfontconfig.so.1  libfreetype.so.6  libfribidi.so.0  libgbm.so.1
libgpg-error.so.0   libharfbuzz.so.0  libstdc++.so.6   libxcb.so.1
libz.so.1
```

`libasound.so.2` 排在最前面被 loader 报出来，是因为 cpal 在编译期链接 ALSA（`readelf -d` 可见 `NEEDED libasound.so.2`）；excludelist 对它的注释是“绑定后会导致找不到声卡”。在 Debian、Ubuntu、Fedora 上这些库来自系统路径，所以能直接运行；NixOS 没有 `/usr/lib`，17 个全部找不到——只补 `libasound` 不解决问题，会立刻撞上后面 16 个。

因此这不是打包漏了库，也不是用户系统损坏，而是 AppImage 的前提假设与非 FHS 发行版冲突。NixOS 用户应走 FHS 包装层：

```nix
programs.appimage.enable = true;   # 提供 appimage-run
programs.appimage.binfmt = true;   # 可选：直接执行 .AppImage
```

或临时执行 `nix run nixpkgs#appimage-run -- ./VoicePaste_*.AppImage`。注意这一层只解决“基础库找不到”，1.2.0 及更早的 AppImage 在 FHS 包装层里仍会因为下面这个捆绑问题导致渲染进程崩溃。

### 捆绑 Wayland 库导致 WebKit 崩溃

`linuxdeploy-plugin-gtk` 会顺着 gdk-3 依赖把 `libwayland-client.so.0`、`libwayland-cursor.so.0`、`libwayland-egl.so.1`、`libwayland-server.so.0` 拖进 AppDir，而这几个同样在 excludelist 里。AppRun 把 `$APPDIR/usr/lib` 放在 `LD_LIBRARY_PATH` 最前，构建机（Ubuntu 24.04，wayland 1.22）的副本就会盖掉宿主副本；glvnd 的 `libEGL` 随后无法加载宿主 `libEGL_mesa.so.0`，`eglGetDisplay()` 返回 `EGL_BAD_PARAMETER`，WebKitWebProcess 直接 abort：

```
Could not create default EGL display: EGL_BAD_PARAMETER. Aborting...
```

主进程仍然存活，所以日志看起来像“启动成功”，实际窗口已经没有渲染进程。任何 Wayland/Mesa 版本与构建机不一致的发行版都会中招，NixOS 只是最早暴露的一个。

Tauri 在 linuxdeploy 与 AppImage 打包之间没有 hook，因此 `tools/repack-appimage.sh` 在打包完成后删掉这四个库、用 Tauri 已缓存的 `linuxdeploy-plugin-appimage` 重新打包并重新签名。发布流程会用重打包后的产物覆盖 Release 资产，并在所有平台 job 结束后由 `sync-updater-signature` job 把 `latest.json` 的 Linux 签名同步成新文件的签名。

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
