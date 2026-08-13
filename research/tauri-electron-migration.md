# VoicePaste：Tauri 2 与 Electron 迁移可行性调研

调查日期：2026-08-13。目标：判断迁移 Electron 是否能在 Windows、macOS、Linux（X11+Wayland）保持现状，并覆盖单按键、右 Fn/右 Alt、跨应用粘贴、透明悬浮窗。**事实**来自官方文档/源码或仓库代码；**推断**已标注；**未知**表示公开证据不足。

## 结论

1. **不建议为“抹平平台差异”迁移 Electron。** Electron 的 `globalShortcut`、`BrowserWindow`、`clipboard` 是统一 API，但底层仍受 OS/显示服务器限制；Wayland 全局快捷键依赖 GlobalShortcuts portal，不能保证任意物理键。
2. **Electron 内置快捷键会让现有“按住说话”能力倒退。** VoicePaste 当前能接收 `Pressed`/`Released`；Electron `globalShortcut` 公开 API 和当前源码只回调按下，没有全局 key-up。即使 Wayland portal 本身有 Deactivated，Electron 也没有向应用暴露。要保持现状仍需原生模块或平台 helper。
3. **现有 Tauri 链路已覆盖核心功能。** `src-tauri/src/shortcut.rs` 用 Tauri global-shortcut；Wayland 改走 `ashpd` portal 并监听 Activated/Deactivated；`paste.rs` 先写剪贴板、Wayland 隐藏 overlay、再由 Enigo 模拟 Ctrl/Command+V，并失败时保留“已复制”结果。
4. **普通无修饰单键与右 Fn/右 Alt 是两类问题。** 普通键可由现有系统热键机制覆盖一部分；右 Alt/右 Ctrl 要读取物理 scan code/keycode，Fn 又常由固件/系统特殊处理。Electron/Tauri 的公开快捷键 API 都没有跨平台物理键抽象。
5. **Electron 的真实收益是捆绑 Chromium，前端渲染版本更一致，并可避开当前 WebKitGTK/AppImage 特有崩溃链路。** 但它不会解决输入注入和 Wayland 窗口限制；Electron 官方明确原生 Wayland 不支持读取全局鼠标位置或程序化定位窗口，Wayland 核心协议也没有应用可控制的全局置顶能力。VoicePaste 当前悬浮窗按鼠标所在显示器定位，因此不能假定迁移后保持现状。

## 现有真实调用链

- 快捷键：设置保存 `shortcut` → `ShortcutManager::replace` → 非 Wayland 调 `app.global_shortcut().register(parsed)`；Wayland 创建 `ashpd::desktop::global_shortcuts::GlobalShortcuts` session，`bind_shortcuts`，必要时 `configure_shortcuts`，再监听 Activated/Deactivated → `handle_shortcut_event`。当前只允许无修饰 F13–F20；其他无修饰键拒绝。
- 粘贴：`paste()` 读取旧剪贴板 → 写入识别文本 → Wayland 隐藏 overlay 并等待 120ms（其他平台 60ms）→ Enigo 模拟 Ctrl/Command+V → 450ms 后若剪贴板仍是插入文本则恢复旧文本；模拟失败返回 `Copied`。
- 透明悬浮窗：Tauri 窗口配置/前端 Overlay 负责悬浮显示；Linux `constrain_linux_overlay` 通过 GTK WebView `set_size_request(420,64)` 和 Tauri `set_size` 固定尺寸。Wayland 粘贴前隐藏窗口，避免窗口成为输入目标/遮挡 compositor 行为。
- Linux WebView 兼容：`PACKAGING.md` 记录 AppImage 需移除捆绑 `libwayland-client/cursor/egl/server`，否则宿主 Mesa/EGL 不匹配可能使 WebKitWebProcess abort；发布 workflow 调用重打包脚本。

## 第一方能力核实

### Tauri 2

- Global Shortcut 插件提供注册/注销、`ShortcutEvent` 的 `Pressed`/`Released` 状态，但快捷键字符串是抽象组合键，不承诺 Fn 或左右物理修饰键。[官方](https://v2.tauri.app/plugin/global-shortcut/) [JS API](https://v2.tauri.app/reference/javascript/global-shortcut/)
- Clipboard 插件提供读写系统剪贴板，平台表列 Windows/Linux/macOS。[官方](https://v2.tauri.app/plugin/clipboard/)
- 窗口支持透明等配置，但平台定制仍需原生代码。[官方](https://v2.tauri.app/learn/window-customization/)
- 仓库实际版本：`tauri = 2`、`tauri-plugin-global-shortcut = 2`、`tauri-plugin-clipboard-manager = 2`；`tao` 被 git revision 覆盖以修 Wayland 装饰问题。版本号未在 Cargo.toml 锁死，精确解析版本以 Cargo.lock 为准。

### Electron（当前稳定线）

- `globalShortcut.register(accelerator, callback)` 在应用无焦点时注册快捷键；官方明确 Linux Wayland 需 GlobalShortcuts portal，并提示 accelerator 支持受平台限制。[官方 API](https://www.electronjs.org/docs/latest/api/global-shortcut)
- **只有按下回调，没有释放回调。** Electron 43.4.0 源码入口是 `OnKeyPressed`，官方长期结论也是 `globalShortcut` 不提供 key-up；这不能直接承接 VoicePaste 的按住开始、松开结束。[43.4.0 源码](https://github.com/electron/electron/blob/v43.4.0/shell/browser/api/electron_api_global_shortcut.cc) [Electron issue #7802](https://github.com/electron/electron/issues/7802)
- `BrowserWindow` 支持 `transparent: true`、`frame: false`、`alwaysOnTop` 等；但官方明确原生 Wayland 通常不能程序化定位、移动、聚焦窗口，`setPosition` 不受支持；Wayland 核心协议也没有应用可控制的全局置顶能力。[BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window) [Electron issue #50403](https://github.com/electron/electron/issues/50403)
- Electron `screen.getCursorScreenPoint()` 在 Wayland 不受支持；VoicePaste 现有 overlay 恰好依赖鼠标位置选择显示器。[screen](https://www.electronjs.org/docs/latest/api/screen)
- `clipboard` 提供 `readText`/`writeText` 等系统剪贴板 API，但“写剪贴板”不等于跨应用注入；仍需模拟粘贴或平台输入 API。[官方 API](https://www.electronjs.org/docs/latest/api/clipboard)
- Electron 官方 API 没有 `FnLeft/FnRight`、`AltRight` 独立全局注册、CGEventTap/WH_KEYBOARD_LL 的跨平台封装。**推断：**要覆盖这些键并保留 key-up，Electron 必须增加 Node 原生模块或平台 helper，并承担权限、签名、崩溃和 ABI/预编译二进制维护。[原生 Node 模块](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)
- 调研时最新稳定版是 Electron 43.4.0（2026-08-11）；官方只支持最新三个稳定主版本。[稳定版本列表](https://releases.electronjs.org/release?channel=stable) [43.4.0 release](https://github.com/electron/electron/releases/tag/v43.4.0) [支持政策](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)

### Chromium/Ozone、X11、Wayland

- Chromium Ozone 是 Aura 下的平台抽象；Wayland 通过 `--ozone-platform=wayland`，处理窗口、GPU buffer、输入，但不是全局快捷键协议。[官方源码文档](https://chromium.googlesource.com/chromium/src/+/main/docs/ozone_overview.md) [Wayland README](https://chromium.googlesource.com/chromium/src/+/main/ui/ozone/platform/wayland/README.md)
- X11 `XGrabKey` 可按 keycode + modifier 建立被动抓取，主键本身可以是修饰键，并提供 KeyPress/KeyRelease；这是显示服务器能力，不是 Electron API。要区分具体物理键仍需原生代码，并处理与桌面快捷键的抓取冲突。[XGrabKey](https://www.x.org/releases/current/doc/man/man3/XGrabKey.3.xhtml)
- Wayland 普通客户端只接收拥有焦点 surface 的输入，不能主动全局抓键；GlobalShortcuts portal 由 compositor/桌面实现绑定与授权，客户端收到 Activated/Deactivated。[Wayland 输入模型](https://wayland.freedesktop.org/docs/book/Protocol.html#input) [portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.GlobalShortcuts.html) [规范](https://specifications.freedesktop.org/shortcuts-spec/latest/)

### Windows/macOS 限制

- Windows `RegisterHotKey` 使用虚拟键与通用修饰位，接口没有左右 Ctrl/Alt 标志；低级钩子可读取 `KBDLLHOOKSTRUCT` 的 vkCode/scanCode/flags。[RegisterHotKey](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerhotkey) [LowLevelKeyboardProc](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelkeyboardproc) [KBDLLHOOKSTRUCT](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-kbdllhookstruct)
- macOS CGEventTap 可监听 key-down/key-up/flags-changed，`keyboardEventKeycode` 可读取物理键码；监听/辅助功能受用户授权控制。[CGEventTapCreate](<https://developer.apple.com/documentation/coregraphics/cgevent/tapcreate(tap:place:options:eventsofinterest:callback:userinfo:)>) [keyboardEventKeycode](https://developer.apple.com/documentation/coregraphics/cgeventfield/keyboardeventkeycode)
- Fn：**平台专用，不能作为跨平台抽象承诺。** macOS 公开了 `NSEvent.ModifierFlags.function`，但文档把它描述为 F 键和导航键等“function keys”，并未保证独立物理 Fn 的全局按下/释放、左右侧或吞键行为；更不能外推到 Windows/Linux 或所有键盘。[Apple `function` 标志](https://developer.apple.com/documentation/appkit/nsevent/modifierflags-swift.struct/function)

## 支持矩阵

| 能力 | Tauri 2 当前 | Electron 当前 | 结论/边界 |
| --- | --- | --- | --- |
| 组合全局快捷键 Win/macOS/X11 | 可 | 可 | 两者均依赖 OS 注册，冲突/权限仍存在 |
| 全局按下/释放、按住说话 | 已有 `Pressed`/`Released`；Wayland portal 监听 Activated/Deactivated | 内置 `globalShortcut` 只有按下回调 | **直接迁移会功能倒退**；需原生模块/helper |
| Wayland 全局快捷键 | ashpd portal，需桌面授权 | Chromium/Electron 走 GlobalShortcuts portal（版本/桌面依赖） | 不能承诺任意单修饰键/左右键 |
| 普通安全单键 | 当前仅 F13–F20 | accelerator 语法可表达部分普通键，注册仍受平台限制 | 可评估；高频键禁止；F12 在 Windows 保留 |
| 单独右 Alt/Ctrl/Command | 当前不可 | 官方 API 不可 | 两者都需原生监听；Win/macOS 可做，Wayland 不可移植 |
| Fn/右 Fn | 无 | 无 | 暂不承诺；必须按具体硬件/OS 实测 |
| 跨应用粘贴 | 剪贴板 + Enigo 模拟粘贴，失败回退复制 | clipboard + 原生模块/模拟输入 | Electron 不自动抹平 Linux Wayland/X11/macOS 权限差异 |
| 透明悬浮窗 Win/macOS/X11 | 已有 | BrowserWindow 可配置透明/无边框/置顶 | 可实现，但仍需平台回归 |
| 悬浮窗原生 Wayland 定位/置顶 | 当前代码调用全局鼠标位置、显示器选择、`set_position`；实际 compositor 兼容范围仍需矩阵实测 | 官方不支持全局鼠标位置、`setPosition`；Wayland 无应用可控制的全局置顶 | **不能保证不比现状差**；XWayland 可绕过但不等于原生 Wayland |
| Linux WebView | WebKitGTK，需宿主库兼容与 AppImage 修复 | 捆绑 Chromium/Ozone，体积更大 | Chromium 一致性是真收益；只是把 WebKitGTK 风险换成 Ozone/GPU/Wayland 运行矩阵 |

## 竞品公开证据边界

- 闪电说官网/文档展示单个 Command/Option 键帽，并描述短按/长按语义；未公开左右侧和完整可配置列表。[官网](https://shandianshuo.cn/) [文档](https://shandianshuo.cn/docs/voice-input)
- 豆包输入法官方页写 macOS “按住 fn 开始说话”；未公开左右 Fn、事件吞键、松开语义或实现方式。[官方](https://ime.doubao.com/pc)
- Typeless 官方明确：macOS 默认 `Fn`，Windows 默认 `Right Alt`，按一次开始、再按一次完成；FAQ 还说明 macOS 通过 Accessibility 权限直接插入文本并允许 Fn 触发。其桌面下载只列 macOS/Windows，未提供 Linux。[首次听写](https://www.typeless.com/help/quickstart/first-dictation) [FAQ](https://www.typeless.com/help/faqs) [下载页](https://www.typeless.com/downloads)
- 微信输入法 macOS 2.0.0 写“长按 fn”，2.2.2 写“语音输入支持自定义更多快捷键”；未公开键位清单及左右 Fn。 [官方更新日志](https://z.weixin.qq.com/web/change-log/144) [macOS](https://z.weixin.qq.com/web/change-log/macos)
- **未知：**这些材料证明竞品产品能力，不能证明其框架或底层实现。Typeless 的 Accessibility 说明反而表明它接受了平台权限边界；竞品也没有证明同一方案覆盖 Linux Wayland。

## 迁移建议

1. **保持 Tauri 作为核心壳。** 现有快捷键释放事件、粘贴回退、透明 overlay、Linux WebView workaround 都是已实现链路；Electron 的明确迁移收益是 Chromium 渲染一致性，但会立即引入按住模式和原生 Wayland 悬浮定位的能力缺口。
2. 若要产品升级，先独立实现“触发源”而不是替换框架：保留 Tauri global-shortcut 处理组合键；Windows 增加最小原生 helper 处理右 Ctrl/右 Alt，macOS 再按实测选择右 Option/Command/Fn；Linux Wayland 继续 portal/组合键兜底。这个原生边界换 Electron 也不会消失。
3. Fn 只有在目标硬件、系统版本、权限和吞键行为完成逐平台实测后才可承诺。Electron 不能凭 API 直接解决。
4. 只有当 Chromium 渲染一致性已成为可测量的产品阻塞，才建立 Electron 原型。原型验收必须先通过：组合键按下/释放、按住说话、右修饰键、自动粘贴、KDE/GNOME 原生 Wayland 多显示器悬浮定位与置顶、X11、Windows、macOS；任一项低于现状即不迁移。

## 风险

- Wayland portal 绑定由 compositor 决定，版本、授权 UI、可接受 accelerator 集合不同。
- Electron 内置全局快捷键缺少释放事件，现有按住模式不能只靠通用 JS API 迁移。
- 单键可能吞掉正常输入；右修饰键若不吞 key-down/up，会向前台应用泄漏悬空修饰状态。
- macOS 输入监听权限、Windows 安全软件/钩子策略、Linux X11 权限均可能导致安装后行为不同。
- Electron 原生模块需要为 Electron ABI/目标架构重编译或提供预编译产物；升级 Electron 会增加发布维护面。
- Electron Chromium 更新会改变 Ozone、透明窗口和 portal 行为；Tauri WebKitGTK 则依赖宿主库，两者都需要发行版矩阵。

## 核心来源索引

Tauri：[global-shortcut](https://v2.tauri.app/plugin/global-shortcut/) · [clipboard](https://v2.tauri.app/plugin/clipboard/) · [window customization](https://v2.tauri.app/learn/window-customization/) Electron：[globalShortcut](https://www.electronjs.org/docs/latest/api/global-shortcut) · [globalShortcut 43.4.0 源码](https://github.com/electron/electron/blob/v43.4.0/shell/browser/api/electron_api_global_shortcut.cc) · [缺少 key-up](https://github.com/electron/electron/issues/7802) · [BrowserWindow/Wayland 限制](https://www.electronjs.org/docs/latest/api/browser-window) · [Wayland 置顶限制](https://github.com/electron/electron/issues/50403) · [screen/Wayland 限制](https://www.electronjs.org/docs/latest/api/screen) · [clipboard](https://www.electronjs.org/docs/latest/api/clipboard) · [原生模块](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules) · [稳定版本列表](https://releases.electronjs.org/release?channel=stable) · [支持政策](https://www.electronjs.org/docs/latest/tutorial/electron-timelines) 平台：[Chromium Ozone](https://chromium.googlesource.com/chromium/src/+/main/docs/ozone_overview.md) · [Wayland 输入模型](https://wayland.freedesktop.org/docs/book/Protocol.html#input) · [Wayland portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.GlobalShortcuts.html) · [XDG shortcut spec](https://specifications.freedesktop.org/shortcuts-spec/latest/) · [XGrabKey](https://www.x.org/releases/current/doc/man/man3/XGrabKey.3.xhtml) · [Windows](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerhotkey) · [macOS CGEventTap](<https://developer.apple.com/documentation/coregraphics/cgevent/tapcreate(tap:place:options:eventsofinterest:callback:userinfo:)>) · [macOS Fn 标志](https://developer.apple.com/documentation/appkit/nsevent/modifierflags-swift.struct/function)
