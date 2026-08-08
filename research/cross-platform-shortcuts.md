# VoicePaste 跨平台快捷键与自动粘贴方案调研

日期：2026-08-07

## 结论

- **前端采用 TanStack Hotkeys，并封装在 `src/shortcut.ts`。** 设置页不再维护 `KeyboardEvent` 键名映射；录制、解析和平台显示交给依赖，VoicePaste 只保留 TanStack `Mod` → Tauri `CommandOrControl` 的边界转换。[录制指南](https://tanstack.com/hotkeys/latest/docs/framework/react/guides/hotkey-recording) · [显示指南](https://tanstack.com/hotkeys/latest/docs/framework/react/guides/formatting-display) · [仓库](https://github.com/TanStack/hotkeys)
- **后端不存在一个稳定库同时覆盖全局快捷键注册、Wayland Portal 和跨平台输入注入。** 当前组合 `tauri-plugin-global-shortcut/global-hotkey + ashpd + enigo` 已是职责清晰、依赖成熟度相对最高的稳定方案。
- 平台差异可以隐藏在 VoicePaste 模块接口后面，但不能从实现中消失。Wayland 用户授权、macOS Accessibility、Windows UIPI、X11 `XGrabKey` 都是系统安全模型，不是库选择造成的差异。

## 前端候选

| 候选                                                        | 能力                                                | 能否替换当前实现                                                                 | 结论                                                                                                                                                                            |
| ----------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tauri Global Shortcut JS                                    | 注册、注销、查询全局快捷键；事件包含 shortcut/state | 不录制 DOM `KeyboardEvent`，不生成平台显示标签                                   | 继续只用于全局注册；不能替换 UI 逻辑。[官方文档](https://v2.tauri.app/plugin/global-shortcut/)                                                                                  |
| `react-hotkeys-hook`                                        | React 内快捷键匹配与回调                            | 没有 accelerator 录制器或 Tauri 格式化器                                         | 当前场景不需要。[官方文档](https://react-hotkeys-hook.vercel.app/docs/intro)                                                                                                    |
| `hotkeys-js`                                                | 浏览器快捷键匹配、scope、按键状态                   | 不负责录制成 Tauri accelerator，也不负责 `<kbd>` 平台渲染                        | 当前场景不需要。[官方仓库](https://github.com/jaywcjlove/hotkeys-js)                                                                                                            |
| `react-hotkey-display` 1.1.2                                | `Mod` 平台格式化、`<Kbd>`/`<Hotkey>`、ARIA 标签     | 可替换显示 map；不能替换 KeyboardEvent 录制；不认识 `CommandOrControl`，仍需适配 | 只有一个快捷键时依赖收益不足。[官方仓库](https://github.com/mulkatz/react-hotkey-display) · [格式源码](https://github.com/mulkatz/react-hotkey-display/blob/main/src/format.ts) |
| TanStack Hotkeys (`@tanstack/hotkeys` 0.8.0 / React 0.10.0) | 录制、解析、规范化、校验、平台显示、React hook      | 替换当前录制与显示逻辑；仅需 `Mod` → `CommandOrControl` 边界适配                 | 已采用；所有依赖调用集中在 `src/shortcut.ts`。[官方仓库](https://github.com/TanStack/hotkeys)                                                                                   |

HTML 原生 `<kbd>` 已是表示键盘输入的标准元素，项目保留自定义样式没有问题。[MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/kbd)

### TanStack Hotkeys 封装边界

1. UI 只调用 `formatShortcut`、`formatShortcutLabel` 和 `useShortcutRecorder`，不直接依赖 TanStack API。
2. 设置继续保存 Tauri 原生格式，避免迁移已有用户配置；录制结果仅在离开前端适配模块时把 `Mod` 转成 `CommandOrControl`。
3. TanStack `0.x` API 或 Tauri accelerator 语法变化时，只需修改 `src/shortcut.ts`。

## 后端候选与实际平台边界

### 全局快捷键

`tauri-plugin-global-shortcut` 把注册工作交给 `global-hotkey`。[插件源码](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/global-shortcut/src/lib.rs)

`global-hotkey` 的实际后端是：

- Windows：Win32 `RegisterHotKey` / `WM_HOTKEY`；
- macOS：`RegisterEventHotKey`，部分媒体键使用 `CGEventTap`；
- Linux：X11 `XGrabKey`。

其 Linux 源码明确写明其他 Linux window system 不受支持，因此官方 Tauri 插件不能独立覆盖原生 Wayland。[global-hotkey X11 源码](https://github.com/tauri-apps/global-hotkey/blob/dev/src/platform_impl/x11/mod.rs)

Wayland 全局快捷键必须走 XDG Desktop Portal。Portal 规定了 `CreateSession`、`BindShortcuts`、`ListShortcuts`、`ConfigureShortcuts` 和 Activated/Deactivated 信号；绑定通常允许系统向用户展示授权或配置界面。[XDG GlobalShortcuts v2](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.GlobalShortcuts.html) `ashpd` 是该 Portal 的 Rust wrapper。[ashpd API](https://docs.rs/ashpd/latest/ashpd/desktop/global_shortcuts/struct.GlobalShortcuts.html)

因此当前分工合理：

- Windows/macOS/X11：Tauri global shortcut plugin；
- Wayland：`ashpd` GlobalShortcuts Portal。

### 自动粘贴

Enigo 提供 Windows、macOS、Linux 的统一键鼠模拟接口；Linux stable 0.6.1 提供 X11、Wayland、libei feature。[Enigo API](https://docs.rs/enigo/latest/enigo/) · [feature 列表](https://docs.rs/crate/enigo/latest/features)

但库无法消除系统限制：

- Wayland/libei 或 RemoteDesktop Portal 需要 compositor 支持和用户授权；
- macOS 键盘注入需要 Accessibility 权限；
- Windows `SendInput` 受 UIPI 限制，只能注入到相同或更低 integrity level 的目标进程。[Microsoft SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)

`tauri-plugin-user-input` 不构成更好的替代：它本身仍使用 Enigo，并且 Linux/Wayland 支持有限；再包一层 Tauri plugin 不会减少底层约束。[官方仓库](https://github.com/kunkunsh/tauri-plugin-user-input)

## 当前建议

1. **前端通过单一适配模块使用 TanStack Hotkeys。** 不在组件中新增键名 map 或原生录制逻辑。
2. **不替换后端依赖组合。** 当前 `global-hotkey + ashpd + enigo` 已是最佳稳定组合。
3. **后端通过 `ShortcutManager` 隐藏平台实现。** `lib.rs` 只负责注册/替换语义；Portal 与 native backend 生命周期留在 `shortcut.rs`，以后升级 Wayland 后端不改调用方。
4. **关注下一版 Enigo。** Enigo 主分支已出现 `xdg_desktop`、restore token 和成功后停止继续尝试其他后端的实现；等正式版本发布并验证后，可能删除 VoicePaste 当前 Linux Enigo 后端选择代码。不要为此改用 git dependency。[Enigo Linux 主分支](https://github.com/enigo-rs/enigo/blob/master/src/linux/mod.rs)
