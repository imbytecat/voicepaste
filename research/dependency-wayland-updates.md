# 依赖升级与 Wayland 补丁核查

核查日期：2026-10-01。版本以本次锁文件为准；上游发布说明不代替各平台实测。

## PR 处理

- [#17：前端依赖](https://github.com/imbytecat/voicepaste/pull/17) 已说明原因关闭。CI 因已删除的 `react/react-compiler` 规则失败；TanStack Hotkeys 的默认录制格式也由逻辑键名改为物理键码，不能直接传给 Tauri。
- [#18：Rust 依赖](https://github.com/imbytecat/voicepaste/pull/18) 虽然三平台编译检查通过，但引入 Tao 0.37.1 的 Windows 被动窗口抢焦点回归，未原样合并，已说明原因关闭。
- 可用升级已在本次工作树中整合；关闭机器人 PR 不表示这些本地改动已经提交或发布。

## 采用的更新与兼容约束

- Tauri 2.12.1，前端 API/CLI 2.12.0；React 19.3.0、Vite 8.3.1，以及锁文件中的其他稳定前端更新。
- Rustls 0.23.45、cpal 0.18.2、rtrb 0.4.0、async-openai 0.42.1、更新后的 Tauri 插件与兼容传递依赖。
- Node 26.10.0、pnpm 11.28.2、Rust 工具链 1.98.1；未改变应用版本或 Cargo 声明的最低 Rust 版本。
- 快捷键录制显式使用 `recordBy: "key"`，清除操作接入 `onClear`。迁移已移除的 Oxlint 规则，同时保留项目未启用 React Compiler 的既有检查取舍；现有 react-hooks-js 检查继续启用。
- updater 显式保留 `rustls-tls`、`zip`，不启用新增默认 `system-proxy`。Cargo feature 合并会影响所有 reqwest 客户端，故维持此前代理行为，不顺带改变热词和 LLM 请求路由。[上游功能声明](https://docs.rs/crate/tauri-plugin-updater/2.13.1/features)
- cpal 0.18.2 开始在 WASAPI/CoreAudio 上报告 xrun；继续保留现有音频错误处理，不静默忽略丢帧。[发布说明](https://github.com/RustAudio/cpal/releases/tag/v0.18.2)

## Wayland：可以移除什么，必须保留什么

Tao 的窗口装饰补丁 [#1218 / 07f3742b](https://github.com/tauri-apps/tao/pull/1218) 已包含在 [0.36.0 正式发布](https://github.com/tauri-apps/tao/releases/tag/tao-v0.36.0)。GitHub [提交比较](https://github.com/tauri-apps/tao/compare/07f3742b1833b64be27b1ef991e38d557d4276c9...tao-v0.37.0) 确认它也是 0.37.0 的祖先。本次删除旧 `[patch.crates-io]` Git 覆盖；Cargo 实际解析为 `tauri 2.12.1 → tauri-runtime-wry 2.12.1 → tao 0.37.0`。

不能直接取 Tao 0.37.1：[上游 #1358](https://github.com/tauri-apps/tao/pull/1358) 描述 `set_visible(true)` 用 `SW_SHOW` 激活不可聚焦的 Windows 窗口。VoicePaste 悬浮窗使用 `focusable: false`，因此暂以 Windows 目标依赖的精确约束锁定 0.37.0。待修复正式发布并验证 Windows 浮层不抢焦点后，移除此约束。本机未执行 Windows 端到端粘贴验证。

AppImage 剔除四个 Wayland 库的重打包措施保持不变：它防止捆绑库覆盖宿主 Mesa/Wayland，与 Tao 装饰修复不同。机制和移除门槛继续以 [PACKAGING.md](../PACKAGING.md#捆绑-wayland-库导致-webkit-崩溃) 为准。ashpd 0.13.13、enigo 0.6.1 的 portal 路径未被改写；不能宣称所有 Wayland 权限、定位或粘贴问题均已解决。

## 本次原生启动崩溃

观察到两个 `WebKitWebProcess` SIGABRT，主进程仍存活，AT-SPI 只剩窗口 frame/filler；日志为 `Could not create default EGL display: EGL_BAD_PARAMETER`，core 栈落在 `WebCore::PlatformDisplayDefault::create`。

带 `LD_DEBUG` 的子进程日志进一步定位到：

```text
libm.so.6: version `GLIBC_2.43' not found
(required by ...mesa-26.2.3/lib/libgallium-26.2.3.so)
```

应用来自旧 devShell（glibc 2.42），宿主 NixOS 的 Mesa 26.2.3 来自更新的系统闭包。EGL 是下游症状，具体原因是开发环境与宿主驱动的 ABI 错配，不是 Rust panic，也不是本次已经删除的 Tao 装饰补丁。宿主 Python 的 EGL/dlopen 探测成功不能排除它，因为 Python 使用不同的 glibc。

`flake.lock` 的 nixpkgs 从 2026-08-05 的 `b7c2ada94fe99c15b0dbcf4d11fd7850b957a436` 更新至 2026-10-01 的 `c59305bab2065cfecc4944690d9eedbb56f3a9fa`。需要重新进入开发环境并重新构建，不能沿用旧 shell 的运行库。不采用禁用沙箱或 GPU 的规避。

这是在 NixOS 上确认的具体配置错配；没有其他发行版对照实测，不能扩大为“NixOS 独有”，也不能把它当作 AppImage 打包问题。

可复用流程见 [nix-webkit-debug skill](../.agents/skills/nix-webkit-debug/SKILL.md)。

## 安全检查

- 更新传递依赖 `brace-expansion` 后，`pnpm audit` 报告无已知漏洞；此前命中两项 high 和一项 moderate。[公告](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr)
- `cargo audit` 未报告漏洞错误，但保留两项上游警告：[glib 0.18.5 的 VariantStrIter unsoundness](https://rustsec.org/advisories/RUSTSEC-2024-0429)、[proc-macro-error 1.0.4 停止维护](https://rustsec.org/advisories/RUSTSEC-2024-0370)。未用忽略规则隐藏，也未声称 Rust 依赖零风险。

## 验证结果

- 更新 Nix 环境后，`env -u LD_LIBRARY_PATH nix develop --command mise run check` 通过：前端格式、Lint、生产构建、TypeScript、7 个前端测试、37 个 Rust 测试及 Clippy。
- 新环境原生构建通过；ELF 解释器已指向 glibc 2.44。重新启动 Wayland 应用后，原生设置页恢复渲染，AT-SPI 可读取页面内容并切换到“语音输入”，截图确认不再空白；该验证时间窗内没有新 core。
- 浏览器预览实测组合键、F13、非法单键、Backspace 清除反馈，以及设置开关；没有页面异常。
- 最初默认音频设备不可用，随后按用户要求改用合成音频：12 秒、48 kHz 双声道、997 Hz，左右幅度分别 0.12/0.04，经临时 PipeWire 虚拟源进入未修改的 `AudioCapture::start`。实际验证覆盖 CPAL 采集、单声道混音、rtrb、Rubato 重采样、S16LE 编码、音量回调及停止回收；未接入实体麦克风或修改系统默认设备。
- 合成音频验证通过：输出 16 kHz 单声道 S16LE，频率 997 Hz，有效时长 11.999750 秒，RMS 0.056566（理论 0.056569），平均有效音量 0.280092，62 个分片，采集错误 0。首次验证器误将每片严格 200ms 当作契约；核对 Rubato `FixedSync::Input` 后改为检查实际信号时长、频率、幅度及下游帧限制，未修改产品音频代码。
- 未保存测试期间的用户设置，也未触发云端听写；本次没有证明云端识别准确率或完整听写/粘贴链路。Windows/macOS 与 AppImage 安装包未在本机实测。
- 若旧 shell 使 Nix/Lix 自身报 `GLIBCXX_* not found`，重新进入环境前对启动器清除旧 `LD_LIBRARY_PATH`；不要继续用旧环境执行新构建。
