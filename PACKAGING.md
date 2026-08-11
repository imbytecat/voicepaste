# VoicePaste 发布与打包

VoicePaste 是完全开源的免费项目。当前发布不使用付费 Apple Developer 或 Windows 代码签名证书：

- macOS Apple Silicon 使用 ad-hoc 签名，未做 Apple 公证；
- Windows 安装包不做 Authenticode 签名；
- 应用使用 Tauri updater 从 GitHub Releases 检查并安装更新；更新包使用独立密钥签名。

版本准备由 `.github/workflows/release-please.yml` 管理；它维护 Release PR、版本号、CHANGELOG、tag 与 GitHub Release 草稿。`.github/workflows/release.yml` 是可复用的三平台构建工作流，也可通过 `workflow_dispatch` 手动生成测试产物。

## 正式产物

`src-tauri/tauri.conf.json` 使用 `bundle.targets = "all"`：

- Linux：DEB、AppImage、RPM；
- Apple Silicon Mac（macOS 11+）：DMG、`.app`；
- Windows：NSIS `.exe`、MSI。

Release 资产统一使用 `[name]-[version]-[platform]-[arch][setup][ext]`：ASCII 连字符分隔，字段顺序固定，系统名采用 `tauri-action` 的机器可读值 `linux`、`darwin`、`windows`。架构名保留各平台打包格式的惯例，因此 Linux DEB/AppImage 使用 `amd64`，RPM 使用 `x86_64`，Windows 使用 `x64`。

| 系统                | 推荐文件                                     |
| ------------------- | -------------------------------------------- |
| Windows 10/11 x64   | `VoicePaste-<version>-windows-x64-setup.exe` |
| Apple Silicon Mac   | `VoicePaste-<version>-darwin-aarch64.dmg`    |
| Debian / Ubuntu x64 | `VoicePaste-<version>-linux-amd64.deb`       |
| Fedora / RHEL x64   | `VoicePaste-<version>-linux-x86_64.rpm`      |
| 其他 x64 Linux      | `VoicePaste-<version>-linux-amd64.AppImage`  |

MSI 是 Windows 备选安装包。`latest.json`、`.sig` 与 `.app.tar.gz` 服务于 updater，普通用户无需手动下载。

正式 Release 默认保持草稿，验证完成后再公开发布。Release Please 与构建 job 使用按 job 收紧权限的 `GITHUB_TOKEN`；构建 job 仅从 `TAURI_SIGNING_PRIVATE_KEY` secret 读取 updater 私钥，不需要平台代码签名 secrets。

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

#### 上游状态

这不是本项目独有的问题，也不是我们绕开了官方做法：

- [tauri-apps/tauri#15665](https://github.com/tauri-apps/tauri/issues/15665)（2026-07-07 提交，仍 open）描述的就是这条链路：默认 bundler 配置 + ubuntu-24.04 runner 构建的 AppImage，在 Mesa 25+ 的发行版上 WebKitWebProcess 直接 abort。
- Tauri 维护者的回应是更新 linuxdeploy 每次都会让 AppImage 更坏，且 `bundle.linux.appimage` 至今没有 `excludeLibraries` 之类的配置口，所以受影响项目一致采用“在 CI 里 post-process AppImage”。本仓库的 `tools/repack-appimage.sh` 就是这个做法。
- 真正的上游修复是 [tauri-apps/tauri#12491](https://github.com/tauri-apps/tauri/pull/12491)（Truly portable appimage，仍是 draft），它要求在 Arch 上构建。等它合并并支持 Ubuntu runner，或等 Tauri 提供官方排除配置，就可以删掉 `tools/repack-appimage.sh` 与对应的两个工作流步骤。

#### 同一 issue 里另外两条机制（本项目不受影响，故不处理）

- **`GST_PLUGIN_SYSTEM_PATH_1_0` 指向不存在的目录**：AppImageKit 的 `AppRun.wrapped` 无条件导出它（`grep -a` 可在二进制里看到），而 `bundleMediaFramework` 为默认 false 时 `usr/lib/gstreamer-1.0` 根本不会创建。对使用 WebKit 媒体能力的应用，这会让 GStreamer 找不到插件并可能写坏用户的 `~/.cache/gstreamer-1.0/registry.*.bin`。VoicePaste 的录音全在 Rust 侧（`start_audio_capture`/`list_microphones`），webview 不碰 `getUserMedia`、`<audio>` 或 WebRTC，实测运行前后宿主 registry 未被改写，因此不做处理。**若以后在 webview 里引入任何媒体能力，必须重新评估这一条。**
- **WebKit 辅助进程只有 `RUNPATH=$ORIGIN`**：只有绕过 AppRun 直接执行内层 `usr/bin/voicepaste` 才会触发（AppRun 的 `chdir($APPDIR/usr)` 是关键）。正常下载运行与桌面项都经过 AppRun，因此属于潜在项。

另外注意：上游报告者还额外删掉了 glib 家族、`libgst*`、`libmount`/`libblkid`/`libselinux`/`libpcre2-8`、`libzstd`/`libelf`/`libffi`。本仓库只删 4 个 Wayland 库，已在 Mesa 26.2 + wayland 1.26 上实测通过；如果将来更新的发行版又出现同类崩溃，glib 家族是下一个排查对象。

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

Updater 不要求安装包使用固定文件名；`latest.json` 记录实际资产 URL 与签名。`latest.json` 文件名、配置 endpoint 和平台 target key 必须保持稳定，安装包扩展名必须保留。Release 资产统一由 `tauri-action` 的 `releaseAssetNamePattern` 重命名，不在构建后手工改动文件配对关系。旧版本通过固定 endpoint 获取 `latest.json`，再按稳定 target key 读取实际 URL，因此本次资产改名不影响已安装版本升级。

构建 updater 产物时，`TAURI_SIGNING_PRIVATE_KEY` 可指向私钥文件：

```bash
export TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/voicepaste.key"
```

NixOS 本地环境不能可靠生成 AppImage；本地只运行检查与原生构建，三平台安装包和 updater 产物统一通过 GitHub Actions `Release` 工作流构建。

## 发布版本

日常提交和合并后的 PR 标题必须遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

- `fix:` 产生 patch 版本；
- `feat:` 产生 minor 版本；
- `feat!:`、`fix!:` 或正文中的 `BREAKING CHANGE:` 产生 major 版本；
- `docs:`、`test:`、`refactor:`、`ci:`、`build:` 与 `chore:` 不单独触发版本。

推荐 squash merge，让每个用户可见改动只产生一条清晰的发布记录。发布说明由提交历史自动生成，不再手写版本摘要。

1. 合并普通功能或修复 PR。`Release Please` workflow 会创建或更新 `chore(release): <version>` Release PR。
2. 审核 Release PR 中的版本和 `CHANGELOG.md`。该 PR 会同时更新根目录 `version.txt`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 与 `.release-please-manifest.json`；不要手动修改其中任一版本。Release PR 由内置 `GITHUB_TOKEN` 创建，其 `pull_request` checks 会进入待批准状态；仓库维护者批准运行后再合并。
3. 确认 Release PR 的 CI 通过后合并。Release Please 随即创建 `v<version>` tag 和 GitHub Release 草稿。
4. 同一 workflow 直接调用可复用的 `Release` workflow，构建 Linux、macOS、Windows 产物并上传到草稿。这样不依赖由 `GITHUB_TOKEN` 创建 tag 后再次触发 workflow。
5. 按下方清单验证安装包、updater 签名和核心功能，再手动公开 Release。任一平台失败或产物不完整时不要公开。

需要提前验证打包链路时，在 Actions 中手动运行 **Release** workflow。手动运行只上传三平台测试 artifacts，不创建 tag 或 GitHub Release。

仓库必须启用 **Allow GitHub Actions to create and approve pull requests**。Release Please 使用仓库内置 `GITHUB_TOKEN`，不需要长期 PAT；release job 只授予 `contents`、`issues` 与 `pull-requests` 所需权限。第三方 Actions 使用主版本别名，并由 Dependabot 自动跟踪更新。

## 发布验证清单

### Release 资产

- [ ] Linux 包含 `.deb`、`.AppImage`、`.rpm`；`latest.json` 含对应 installer target。
- [ ] macOS 包含 Apple Silicon `.dmg` 与 updater `.app.tar.gz`。
- [ ] Windows 包含 NSIS `.exe`、MSI；`latest.json` 含对应 installer target。
- [ ] Release 包含完整 `latest.json`，保留 `darwin-aarch64`、`linux-x86_64`、`windows-x86_64` 等 target key，其中 URL 指向实际更新资产，嵌入签名与资产匹配。
- [ ] Release 中没有密钥、密码、本地路径或证书文件。

### 安装与功能

- [ ] Ubuntu/Debian 安装 DEB；RPM 系安装 RPM；AppImage 可启动。
- [ ] Apple Silicon Mac 可从 DMG 安装；确认系统显示的是预期未公证提示，而非损坏包。
- [ ] Windows 分别验证 NSIS、MSI 安装、启动、卸载；确认未知发布者提示符合预期。
- [ ] 首次设置可完成：API Key 测试、快捷键、麦克风、保存设置。
- [ ] 切换与按住模式均可完成听写，最终文本进入原输入位置。
- [ ] 关闭设置窗口后仍在托盘运行；托盘可打开设置、检查更新、退出。
- [ ] 从当前公开版本的“关于”页检查更新；可下载、验证、安装新版本并重启。
