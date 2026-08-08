# mise bootstrap packages 用于 VoicePaste 系统依赖的评估

日期：2026-08-07

## 结论

- **能不能替代 GitHub Actions 里的手写 `apt-get`？技术上仅 Ubuntu 可以；当前不建议替代。** 把现有包名逐项写成 `"apt:<包名>" = "latest"`，再显式运行 `mise bootstrap packages apply --yes --update`，效果仍是检查 `dpkg-query` 后执行带 `sudo` 的 `apt-get install -y`。它减少的是 YAML 中的包名，不是 apt、sudo、网络或仓库依赖。[mise apt 机制](https://mise.jdx.dev/bootstrap/packages/apt.html) · [源码](https://github.com/jdx/mise/blob/main/src/system/packages/apt.rs)
- **是不是 VoicePaste 所需的真正跨平台系统依赖抽象？不是。** mise 只按 `manager:package` 调度各平台原生包管理器；没有“WebKitGTK”“C++ toolchain”“WebView2”这类逻辑依赖到 apt/Homebrew/Windows 安装器的统一映射。内置管理器为 apk、apt、dnf、pacman、brew、brew-cask、flatpak、flatpak-user、mas；没有 winget、Chocolatey 或 Windows Features 后端。[支持列表](https://mise.jdx.dev/bootstrap/packages/) · [内置管理器源码](https://github.com/jdx/mise/blob/main/src/system/packages/mod.rs)
- **有没有必要采用？CI 没有；开发机也不是默认方案。** 当前只有 Ubuntu 需要显式系统包安装；macOS/Windows job 依赖 GitHub runner 已配置的 Xcode/Visual Studio/WiX 等。Linux 开发机已有 `flake.nix` 同时提供库、开发头、`LD_LIBRARY_PATH`、GSettings schema 与 `pkg-config` 环境，mise 的 host-package 安装不能替代这些环境设置。[当前 flake](../flake.nix) · [mise 对 host packages 的定位](https://mise.jdx.dev/bootstrap/packages/)
- **推荐最小方案：保持现状。** `mise.toml` 只管理 Node/pnpm/Rust 等项目工具；Ubuntu CI/release 保留明确的 `apt-get update && apt-get install`；macOS/Windows 继续使用固定 OS runner 标签并依赖官方镜像清单。不要为一个 Ubuntu-only 安装步骤切换整个 `mise-action` 到实验性 bootstrap 路径。

## 当前仓库口径

| 场景           | 当前声明                                                                                                                                             | 作用与差异                                                                                                                                                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| mise 工具      | Node 26.7.0、pnpm 11.20.0、Rust 1.97.1、cargo-audit 0.22.2                                                                                           | 都是项目工具，不是系统库；workflow 通过 `install_args` 只安装 job 所需子集。[`mise.toml`](../mise.toml)                                                                                                                                                   |
| Linux CI       | `libasound2-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev libxkbcommon-dev`                                         | 包含 Tauri/WebKitGTK 与 VoicePaste 音频、键盘相关开发库。[`ci.yml`](../.github/workflows/ci.yml)                                                                                                                                                          |
| Linux release  | CI 包集，加 `patchelf rpm xdg-utils`                                                                                                                 | 为 Linux bundling 增加工具；Tauri 官方 GitHub workflow 同样显式安装 WebKitGTK、AppIndicator、librsvg、patchelf、xdg-utils。[`release.yml`](../.github/workflows/release.yml) · [Tauri GitHub pipeline](https://v2.tauri.app/distribute/pipelines/github/) |
| Nix 开发 shell | ALSA、GTK/WebKitGTK、AppIndicator、librsvg、libsoup、xkbcommon、OpenSSL 等开发/运行库；另设 `LD_LIBRARY_PATH`、`XDG_DATA_DIRS`、`pkg-config` wrapper | 不只是“包是否已装”，还建立构建和运行环境；bootstrap packages 没有等价的环境闭包。[`flake.nix`](../flake.nix)                                                                                                                                              |

Tauri 的 Debian/Ubuntu 通用前置命令还列出 `build-essential curl wget file libxdo-dev`。当前 workflow 没逐项安装这些包；Ubuntu runner 清单明确已有 gcc/g++/make、curl、wget、file，是否需要 `libxdo-dev`仍取决于实际 feature/依赖图，不能仅凭通用模板加入或删除。[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) · [Ubuntu 24.04 镜像清单](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md)

## bootstrap packages 实际机制

```toml
[bootstrap.packages]
"apt:libwebkit2gtk-4.1-dev" = "latest"
"brew:ffmpeg" = "latest"
```

1. key 必须是 `manager:package`；值为 `latest` 或该管理器原生版本格式。不同管理器需要分别写真实包名，mise 不做跨发行版语义映射。[配置与语义](https://mise.jdx.dev/bootstrap/packages/)
2. manager 是否执行取决于本机可用性。apt 要求 Linux 且 PATH 中有 `apt-get`；不可用 manager 会被跳过，未知 manager 只警告并提示安装插件。因此同一 TOML 可以“在多平台解析”，但不代表每个平台都被配置完整。[apt 可用性源码](https://github.com/jdx/mise/blob/main/src/system/packages/apt.rs) · [OS-filtered 语义](https://mise.jdx.dev/bootstrap/packages/)
3. `mise install` **不会**安装系统包，只提示缺失；必须显式调用 `mise bootstrap packages apply`，或让完整 `mise bootstrap` 执行 packages 阶段。[手动安装语义](https://mise.jdx.dev/bootstrap/packages/) · [`apply` CLI](https://mise.jdx.dev/cli/bootstrap/packages/apply.html)
4. apt 后端使用 `dpkg-query` 检查状态；缺失或版本不匹配时运行 `DEBIAN_FRONTEND=noninteractive apt-get install -y -- ...`。`--update` 才强制刷新索引；只有 `/var/lib/apt/lists` 没有包列表时会自动 update。[apt 文档](https://mise.jdx.dev/bootstrap/packages/apt.html) · [apt 源码](https://github.com/jdx/mise/blob/main/src/system/packages/apt.rs)
5. Linux 包管理器需要 root。mise 在非 root 时走 sudo；交互开发机会正常提示密码，非交互且无免密 sudo 会直接报错并打印应手动执行的命令，不会一直等待。GitHub-hosted Linux/macOS runner 提供免密 sudo；Windows runner 以管理员运行且关闭 UAC。[mise sudo 语义](https://mise.jdx.dev/bootstrap/packages/#sudo) · [GitHub runner 权限](https://docs.github.com/en/actions/reference/runners/github-hosted-runners#administrative-privileges)
6. Homebrew 是特殊实现：mise 可自行解析 Homebrew API、校验 bottle SHA-256 并写入标准 prefix，不要求预装 `brew`；但 macOS 仅支持 arm64，Intel mac 不支持。它仍管理 Homebrew formula/cask 名称，不会把 apt 包自动映射为 brew 包。[brew 实现与限制](https://mise.jdx.dev/bootstrap/packages/brew.html)
7. package plugin 可扩展其他 host-owned state，但插件不使用 mise sudo、不得自行提权，且官方文档示例是 VS Code/Helm/krew/GitHub CLI 扩展，不是内置 Windows 系统包层。为 VoicePaste 自建 winget/Visual Studio/WebView2 插件会增加维护面，仍无法成为官方跨平台抽象。[package plugins](https://mise.jdx.dev/bootstrap/packages/plugins.html)

## 它为何不是真正的跨平台抽象

真正的抽象至少要让一项逻辑依赖在各平台映射到各自安装机制；bootstrap packages 的抽象层仅统一了“检查并调用某个 manager”这一操作：

| 逻辑需求               | Ubuntu                               | macOS                     | Windows                                      | mise 是否统一映射                           |
| ---------------------- | ------------------------------------ | ------------------------- | -------------------------------------------- | ------------------------------------------- |
| Tauri WebView          | `libwebkit2gtk-4.1-dev`              | 系统 WebKit/Xcode SDK     | Edge WebView2 Runtime                        | 否；必须分别处理，且 Windows 无内置 manager |
| C/C++ 构建链           | `build-essential` 或 runner 预装 gcc | Xcode/Command Line Tools  | Visual Studio “Desktop development with C++” | 否；后两者不是同名 formula 的替换           |
| VoicePaste 音频/键盘库 | `libasound2-dev`、`libxkbcommon-dev` | 系统 frameworks/SDK       | Windows SDK/API                              | 否；只有 Linux 需要这些 apt 名称            |
| 安装包工具             | `patchelf`、`rpm`、`xdg-utils`       | Xcode/macOS bundling 工具 | WiX/NSIS、MSI 所需 VBSCRIPT                  | 否；Windows Features 也不在支持范围         |

因此 `apt:` 行在 macOS/Windows 被跳过，只能证明配置文件可共享，不能证明依赖已收敛。若 Windows runner 缺 WebView2、VC toolchain 或 VBSCRIPT，mise 不会补齐，也不会因 `apt:` 配置不可用而主动失败。[mise OS-filtered 语义](https://mise.jdx.dev/bootstrap/packages/) · [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/)

## 分平台结论

### Ubuntu 24.04

**能用，但没必要替换 CI。** 当前全部 Linux 包都可原样声明为 `apt:` 条目；GitHub runner 有免密 sudo，mise 可以非交互完成安装。Ubuntu 24.04 镜像当前明确预装 `libssl-dev`、`patchelf`、`rpm`，但未在清单中明确列出 VoicePaste 所需 WebKitGTK、ALSA、AppIndicator、librsvg、xkbcommon 开发包；继续显式安装可避免依赖镜像偶然状态。[Ubuntu 清单](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md)

开发机上，apt bootstrap 可作为**不用 Nix 的 Ubuntu 用户**的可选便利命令；代价是修改整台机器、需要 sudo、只适用于 Debian-family 名称，且不能复现 `flake.nix` 的环境变量和运行库路径。已有 Nix 用户应继续使用 flake。

### macOS 26

**不需要 bootstrap packages。** Tauri desktop 只要求 Xcode 或 Command Line Tools；`macos-26` 是 arm64 runner，当前镜像已带 Xcode 26.6、Command Line Tools 26.6、Homebrew、Rust 等。[Tauri macOS prerequisites](https://v2.tauri.app/start/prerequisites/#macos) · [macOS 26 arm64 清单](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md)

mise 的 `brew:` 后端在该 arm64 runner 可用，但 VoicePaste 当前没有需要用 Homebrew 补装的 macOS 系统依赖。为“跨平台对称”添加空泛 brew 包只会制造第二套依赖定义。

### Windows Server 2025

**不能用 bootstrap packages 管理 Tauri 核心前置条件。** Tauri 要求 Microsoft C++ Build Tools 与 Edge WebView2；MSI 还要求 VBSCRIPT optional feature。mise 没有 winget、Chocolatey、Visual Studio Installer 或 Windows Features 内置 manager。[Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/#windows) · [mise manager 列表](https://mise.jdx.dev/bootstrap/packages/)

当前 `windows-2025` runner 已带 Visual Studio Enterprise 2022、x86/x64 VC tools 与 WiX 3.14.1；镜像清单也有 Microsoft Edge，但未单独承诺 WebView2 Runtime/VBSCRIPT 状态。当前 workflow 实际上依赖 runner image，而不是 mise。[Windows 2025 清单](https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-Readme.md) Tauri Windows installer 默认还会在终端用户安装时下载 WebView2 bootstrapper；这属于产物安装策略，也不是构建机 package bootstrap 能解决的问题。[Tauri Windows installer](https://v2.tauri.app/distribute/windows-installer/#webview2-installation-options)

## 接入 mise-action 后的实际变化

当前 `jdx/mise-action@v4` 默认执行 `mise install`，`bootstrap` 默认关闭，所以仅向 `mise.toml` 添加 `[bootstrap.packages]` **不会改变 CI**。[mise-action README](https://github.com/jdx/mise-action/blob/main/README.md#bootstrap)

若设 `bootstrap: true`：

- action 改为运行 `mise bootstrap`，并自动启用 `MISE_EXPERIMENTAL=1`；[action 源码](https://github.com/jdx/mise-action/blob/main/src/index.ts#L339-L342)
- `install_args` 与 `bootstrap: true` 明确互斥；当前 frontend、rust、release 三处都依赖 `install_args` 控制只装 node/pnpm/rust；[action 源码](https://github.com/jdx/mise-action/blob/main/src/index.ts#L843-L885)
- 完整 bootstrap 会执行 packages 后再执行 `[tools]`，因而每个 job 会安装 `mise.toml` 的全部 Node、pnpm、Rust、cargo-audit，而非当前最小子集。[bootstrap 顺序](https://mise.jdx.dev/cli/bootstrap.html)
- 用 `bootstrap_args: "--only packages --yes --update"` 可以只装系统包，但随后仍需另一条 `mise install node pnpm` 或 `mise install rust`；这没有减少 workflow 复杂度。

技术上可行的最小替代如下，但**不推荐落地**：

```toml
[bootstrap.packages]
"apt:libasound2-dev" = "latest"
"apt:libwebkit2gtk-4.1-dev" = "latest"
"apt:libayatana-appindicator3-dev" = "latest"
"apt:librsvg2-dev" = "latest"
"apt:libssl-dev" = "latest"
"apt:libxkbcommon-dev" = "latest"
"apt:patchelf" = "latest"
"apt:rpm" = "latest"
"apt:xdg-utils" = "latest"
```

CI 仍需二选一：

```yaml
# 保留当前 mise-action install_args，再增加：
- run: mise bootstrap packages apply --manager apt --yes --update
```

或：

```yaml
- uses: jdx/mise-action@v4
  with:
    bootstrap: true
    bootstrap_args: --only packages --yes --update
- run: mise install rust # 各 job 仍需自己的工具安装
```

两种写法都只是把 `apt-get` 包装在 mise 后面；第二种还拆散当前一次 action 完成工具安装的路径。

## 可复现性与失败模式

- `"latest"` 表示“接受 manager 当前安装/提供的版本”，不是锁定版本；apt 精确 pin 虽可写成 Debian 版本号，但版本从 Ubuntu 仓库下架后会直接安装失败。[mise apt pins](https://mise.jdx.dev/bootstrap/packages/apt.html)
- mise-action 发现 `mise.lock` 时会给 bootstrap 加 `--locked`，但 host-package 版本仍只来自 `[bootstrap.packages]` 的 manager-native 值和当前系统仓库；`mise.lock` 不会把 Ubuntu apt 仓库变成项目内软件源快照。[mise-action lock files](https://github.com/jdx/mise-action/blob/main/README.md#lock-files) · [host packages 定位](https://mise.jdx.dev/bootstrap/packages/)
- 当前 workflow 固定 `ubuntu-24.04`、`macos-26`、`windows-2025`，避免 `-latest` 跨 OS 迁移，但同一标签的软件镜像仍按周更新；不能把 runner 预装状态当作固定 lockfile。[runner-images 更新策略](https://github.com/actions/runner-images#image-releases)
- 当前 `mise-action@v4` 未设置 `version`，官方默认下载 latest mise。若把系统安装也交给它，mise bootstrap 行为变化将直接进入 CI；当前项目已明确接受 Action major alias 的更新模型，但采用 bootstrap 时仍可单独固定 action 的 `version` 输入，减少 mise CLI 行为漂移。[mise-action inputs](https://github.com/jdx/mise-action/blob/main/action.yml)
- apt 常见失败包括索引陈旧导致 `Unable to locate package`、仓库/网络故障、精确版本消失、锁竞争、sudo 不可用；mise 保留这些失败，只提供自动状态检查与更安全的非交互调用。[apt metadata](https://mise.jdx.dev/bootstrap/packages/apt.html)
- 不可用 manager 被跳过而非跨平台替代；共享配置若只写 `apt:`，macOS/Windows 看似成功但没有安装任何对应依赖。CI 若需要验证，应额外使用 `mise bootstrap packages status --missing`，但它仍只能检查已声明且该平台可用的 manager。[status 与 OS-filtered 语义](https://mise.jdx.dev/bootstrap/packages/)

## 推荐最小方案

1. **CI/release：不采用 bootstrap packages。** 保留两处 Linux-only apt step；它们与 Tauri 官方 GitHub workflow 一致、失败位置清楚、不会改变 mise 工具安装范围。
2. **macOS/Windows：不新增空配置。** 继续依赖固定 runner 标签，并在镜像升级时对照官方清单；若某个 Tauri 前置条件以后被移除，使用该平台官方安装方式处理，不用自建 mise package plugin。
3. **Linux 开发：Nix 仍是主路径。** `flake.nix`负责包闭包和环境；若未来确有大量非 Nix Ubuntu 贡献者，再把仅 Ubuntu 的 apt 列表加入平台专用 mise 配置，作为可选 bootstrap，而不是宣称三平台统一。
4. **只有满足以下条件才重评：** mise 内置并稳定支持 winget/Chocolatey、Visual Studio workload/WebView2/Windows Features，且 `mise-action` 能在 bootstrap 模式继续按 job 选择 `[tools]` 子集。当前两项都不成立。
