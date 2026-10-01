---
name: nix-webkit-debug
description: 排查 Nix/NixOS 下 Tauri、GTK 或 WebKitGTK 原生窗口空白、WebKitWebProcess SIGABRT、EGL_BAD_PARAMETER、GLIBC 符号版本错误；区分 devShell ABI 错配、AppImage 库覆盖与应用回归。
---

# Nix / WebKitGTK 崩溃排查

目标：找到最早的加载或运行错误，修复责任层，并证明原生 WebView 已渲染且可交互。主进程存活、编译成功、浏览器预览正常，都不能替代原生验证。

## 1. 保存现场，确认谁崩溃

用户已报告 crash 时直接查现场，不为确认一次失败而重复启动。

- 读取 `/etc/os-release`；内核名称不能证明发行版。记录会话类型、Wayland/X11、运行的是 AppImage 还是本地构建。
- 保存启动 stderr，限定时间查询 core，选中对应 PID：

```sh
coredumpctl list --since '10 minutes ago' --no-pager
coredumpctl info <PID> --no-pager
```

- 区分 `voicepaste`、`WebKitWebProcess`、`WebKitNetworkProcess`。`PlatformDisplayDefault::create → abort` 配合 EGL 错误指向渲染初始化，不等于 Rust panic。
- 只记录必要环境变量：`LD_LIBRARY_PATH`、`LD_PRELOAD`、`GDK_BACKEND`、`WAYLAND_DISPLAY`、`DISPLAY`、`__EGL_VENDOR_LIBRARY_FILENAMES`、`__EGL_VENDOR_LIBRARY_DIRS`。不要输出全部环境、凭据、用户设置或完整 core。

完成条件：崩溃进程、信号、启动方式和首条相关错误均有证据。

## 2. 检查实际加载链，不按版本号猜测

1. 从 `/proc/<存活主进程 PID>/maps` 或 core 的模块信息定位实际 WebKit、glibc、libm、libEGL、GBM、Wayland 路径。主进程映射只作线索，不能冒充已退出子进程的映射。
2. 对已定位的可执行文件运行 `readelf -l`、`readelf -d`，核对解释器和 RUNPATH。NixOS 还要检查 `/run/opengl-driver/share/glvnd/egl_vendor.d/` 中 JSON 指向的实际 vendor 库。
3. 若 EGL 错误隐藏了 dlopen 原因，仅作一次带 loader tracing 的诊断启动：

```sh
GDK_BACKEND=wayland LD_DEBUG=libs,versions \
  LD_DEBUG_OUTPUT=/tmp/voicepaste-loader <实际可执行文件>
```

先退出自己启动的旧实例，避免 single-instance 机制把新参数转交给旧进程。按 PID 区分 `/tmp/voicepaste-loader.*`，搜索 `version lookup error`、`GLIBC_`、`libEGL_mesa`、`libgallium`、`undefined symbol`。

`LD_DEBUG` 中的 `(fatal)` 不一定导致进程退出：库会试探不存在的可选符号。只有与实际失败的 dlopen、调用链和时间相符的错误才能作为根因。

普通 `ldd` 通常看不到后来 dlopen 的 Mesa vendor/gallium。宿主 Python 中 `ctypes.CDLL()` 成功也不能排除 ABI 错配：Python 可能已加载较新的宿主 glibc，而应用仍用旧 devShell glibc。

完成条件：得到具体缺失库、符号版本或设备访问失败；不能停在 `EGL_BAD_PARAMETER`。

## 3. 按证据选择修复层

### devShell 与宿主驱动 ABI 错配

例：应用加载 glibc 2.42，宿主 Mesa 的 libgallium 要求 `GLIBC_2.43`。

- 更新项目锁定的 nixpkgs，进入新开发环境后重新构建；以项目 `flake.nix` / `mise.toml` 为准。
- 本仓库可执行 `nix flake update nixpkgs`，再用 `nix develop --command mise run check` 和 `nix develop --command mise exec -- cargo build --manifest-path src-tauri/Cargo.toml --locked`。
- 更新 lock 不会刷新已经打开的 shell；必须重新进入 `nix develop` 或重新加载 direnv。检查新二进制解释器、实际运行库与宿主驱动所需 GLIBC 版本。
- 若连 `nix` 本身都报 `GLIBCXX_* not found`，外层旧 `LD_LIBRARY_PATH` 可能污染了系统 Nix/Lix。仅对启动器执行 `env -u LD_LIBRARY_PATH nix develop --command …`，让新 devShell 重新设置应用所需库路径；不要把清空应用库路径当作永久修复。
- 若发生链接输入中的 glibc 私有符号冲突，确认没有复用旧环境构建的 Cargo 产物；使用新的临时 `CARGO_TARGET_DIR` 验证，不先清空用户构建缓存。

### AppImage 的库覆盖或非 FHS 环境

先读仓库 [PACKAGING.md](../../../PACKAGING.md)。FHS 包装层解决找不到基础库；AppDir 中旧 Wayland/GBM 等库覆盖宿主驱动是另一条问题链。原生 devShell 崩溃不是修改 AppImage 重打包脚本的证据。

### ABI 正常，仍然失败

再检查 vendor JSON 可见性、sandbox mount、DRM 设备权限及 GPU 日志。每次只改变一个因素。X11 或软件渲染只作对照，成功不能证明 Wayland 已修复。保留沙箱与硬件加速的生产设置；不要把禁用沙箱、全局替换系统库、随机追加整个 `/nix/store` 到库路径当作修复。

### 依赖升级回归

若失败位于应用/窗口库而非 loader，结合实际锁文件和上游提交对比。已发布的修复与尚未合并 PR 分开记录；优先稳定版本约束，不把“最新版”当作安全证明。

## 4. 原生验收与结论

- 用修复后的真实环境启动应用；读取新日志，确认 WebView 子进程存活。
- 实际查看窗口并操作设置导航。必要时通过 AT-SPI 检查 WebView 内容，再截图确认；只有 frame/filler 而没有页面内容不足以验收。
- 音频路径可用合成音频验证，不依赖实体麦克风。将已知频率/幅度的 WAV 播放到临时 PipeWire sink/source，通过进程专用 `ALSA_CONFIG_PATH` 定向采集，调用真实 `AudioCapture::start`；不修改系统默认设备。
- 校验采集后的频率、有效时长、双声道混音 RMS 和音量回调，而非仅断言收到数据。例：48 kHz 双声道 997 Hz，左右幅度 0.12/0.04，转为 16 kHz 单声道后 RMS 应约为 `0.08 / sqrt(2)`，本项目音量约为 RMS 的五倍。
- Rubato `FixedSync::Input` 的输出帧数可以变化，不把每包恰好 6400 字节作为验收条件；检查 S16LE 对齐、下游大小限制、时长及信号保真。结束后销毁虚拟节点、临时配置、音频和验证器；合成音调不能证明云端语音识别准确率。
- 未经授权不保存用户设置、不触发云端付费请求。
- 查看验证时间窗内是否出现新的对应 core。停止自己启动的诊断进程并移除临时追踪文件，保留用户原有进程和 core。
- 最终分别报告：已观测根因、修改、原生操作证据、未验证的平台或安装包。NixOS 上复现不等于 NixOS 独有；ABI 错配的具体配置与所有发行版共享的图形加载机制应分开描述。
