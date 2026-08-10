# VoicePaste 单键、左右修饰键可行性暨竞品调研

调查日期：2026-08-10。范围：VoicePaste 当前代码、三款产品官方桌面网站/帮助页、所用快捷键库源码及操作系统第一方接口文档。竞品未公开的字段明确写“未找到第一方证据”，不把搜索摘要或推测写成事实。

## 结论摘要

1. **VoicePaste 目前不支持单键录入，限制在前端。** `src/shortcut.ts` 明确拒绝“没有修饰键”的记录结果；设置页也只提示“组合键”。默认键为 `CommandOrControl+Shift+Space`。
2. **普通单键技术上已接近可用。** 前端 TanStack 录制器能记录 `Space` 等普通单键，Rust `global-hotkey` 解析器明确支持无修饰键，Linux XDG 快捷键规范也以裸 `a` 为合法示例。移除前端限制并调整文案即可进入系统注册；但字母、数字、空格等高频键会抢占正常输入，不应无条件开放。
3. **单独按 Ctrl/Option/Command/Fn，以及区分左/右 Ctrl，不属于上述“小改”。** 当前前端把左右修饰键都压成通用 `Control/Alt/Meta`，后端 Tauri/global-hotkey 也只保存通用修饰位；当前链路无法表达 `ControlLeft`、`ControlRight` 或单独一个修饰键。
4. **Windows、macOS 可以通过平台级键盘监听实现左右键；Linux Wayland 无法承诺同等能力。** Windows 需低级键盘钩子/Raw Input，macOS 需 CGEventTap 并申请监听权限；Wayland 当前走 XDG Global Shortcuts Portal，具体可绑定范围由桌面环境决定，左右修饰键没有可移植保证。
5. **竞品方向确实偏向“一个低冲突物理键”。** 闪电说官方页面以单个 Command 键帽展示，官方文档截图又出现单个 Option 键帽；豆包输入法 macOS 明确“按住 fn”；微信输入法 macOS 2.0.0 同样明确“长按 fn”，2.2.2 又增加“语音输入支持自定义更多快捷键”。
6. **推荐产品路径：** 若目标是尽快支持单键，只开放低冲突普通键并保留组合键默认值；若目标是复刻竞品体验，优先实现 Windows `右 Ctrl`、macOS `右 Option/右 Command`，Linux 继续使用组合键兜底。`Fn` 暂不承诺。

## 竞品对比表

| 产品 | 官方确认的桌面状态 | 官方展示的触发键 | 单物理键判断 | 触发语义 | 证据强度 |
| --- | --- | --- | --- | --- | --- |
| 闪电说 | macOS、Windows 正式下载；Linux 内测 | 官网展示单个 `⌘ command` 键帽；文档截图示例为单个 `⌥` 键帽；实际以应用内当前快捷键为准 | 官方材料强烈表明支持单个修饰键触发；左右侧、完整可配置范围未公开 | 短按一次开始、再短按一次结束；长按后松开触发“帮我说” | 第一方 |
| 豆包输入法 | macOS 当前提供下载；Windows “敬请期待” | `fn`，文案为“按住fn开始说话” | 官方明确为单个 Fn；左右侧和自定义范围未公开 | 仅确认按住开始；松开行为未公开 | 第一方动态页面 |
| 微信输入法 | macOS 2.2.2；Windows 2.1.1 | macOS 2.0.0 默认文案为“长按 fn”；2.2.2 支持自定义更多语音快捷键 | 官方明确单个 Fn 且支持更多自定义键；具体键位范围、左右侧未公开 | 长按开始，实时转写；松开结束规则未公开 | 第一方更新日志 |

## 术语

- **普通单键：** 不同时按住 Control、Command、Option/Alt、Shift、Fn 等修饰键，仅用一个普通键，例如 `F13`、字母键或空格。
- **单修饰键：** 只按一个原本属于修饰键的物理键，例如右 Ctrl、右 Option、右 Command 或 Fn。竞品重点更接近这一类。
- **左右区分：** 绑定到具体物理位置，例如 `ControlLeft+K` 与 `ControlRight+K` 被视为两个不同快捷键。

## VoicePaste 当前实现

### 已有能力

- 默认快捷键为 `CommandOrControl+Shift+Space`；设置页提供“按一下切换”和“按住说话”两种模式。来源：`src/types.ts`、`src/components/Settings.tsx`。
- Rust 后端和前端悬浮窗已处理 `pressed/released`，因此切换式与按住式语义不用重做。来源：`src-tauri/src/lib.rs`、`src/components/Overlay.tsx`。
- Windows、macOS、Linux X11 通过 `tauri-plugin-global-shortcut` 注册；Linux Wayland 通过 XDG Global Shortcuts Portal 注册并监听 Activated/Deactivated。来源：`src-tauri/src/shortcut.rs`。

### 当前为什么不能录入普通单键

`src/shortcut.ts` 在录制完成后检查 `parseHotkey(hotkey).modifiers.length === 0`，直接报错“全局快捷键必须包含至少一个修饰键”。设置页同时写着“点击后按下新的组合键”和“请按组合键…”。这是当前用户可见的硬限制。

前端所用 TanStack Hotkeys 本身支持无修饰键：官方 README 以 `Escape` 为合法快捷键示例，实际解析 `Space` 得到空 modifiers；其录制器也会把普通 keydown 归一化为单键。当前是 VoicePaste 自己追加了限制。

### 普通单键后端可行性

- `global-hotkey 0.8.0` 文档直接给出 `HotKey::new(None, Code::KeyQ)`；解析器单独处理 “single key hotkey”，测试覆盖 `KeyX`、`Digit5`、`KeyG`。
- Windows 实现把空修饰位加上 `MOD_NOREPEAT` 后调用 `RegisterHotKey`；Microsoft 接口没有要求必须存在 Alt/Ctrl/Shift/Win 修饰键，但 F12 被系统保留。
- macOS 实现允许 `mods = 0` 后调用 `RegisterEventHotKey`。
- Linux X11 实现允许空 modifier mask 调用 `XGrabKey`。
- XDG 快捷键规范明确把裸 `a` 列为合法示例；VoicePaste 的 `to_xdg_shortcut` 也能把单独 `Space` 转成 `space`。

因此，**普通单键是“小改可做”**。限制主要是产品风险：若注册 `A`、数字或空格，用户每次正常输入该键都可能触发听写、被系统热键机制占用或与其他软件冲突。

### 当前录制器的特殊键限制

- 单独按 Control/Shift/Alt/Meta 会被录制器视为“只有修饰键”，不会完成录制。
- `Escape` 固定用于取消录制。
- 无修饰的 `Backspace`/`Delete` 固定用于清空快捷键。
- `Fn` 不在当前可注册热键模型中。

所以，仅删除 VoicePaste 的 modifiers 检查，能支持普通单键，**不能**支持右 Ctrl、右 Option、右 Command 或 Fn。

## 闪电说

### 官方确认

- 官网与下载页明确提供 Windows、macOS 正式版本，Linux 为内测。来源：[闪电说官网](https://shandianshuo.cn/)、[下载页](https://shandianshuo.cn/download)（访问：2026-08-10）。
- 官方“短按快捷键直接说”文档说明：光标置于输入框后，“短按快捷键开始说话，再短按快捷键结束”，转写文字输入当前位置；适用于微信、飞书、钉钉、企业微信、文档、邮件、表单、搜索框等。来源：[短按快捷键直接说](https://shandianshuo.cn/docs/voice-input)（访问：2026-08-10）。
- 官方入门文档说明“不同系统、不同用户设置的快捷键可能不一样”，要求以首页顶部的当前快捷键为准。其首页截图与演示截图以仅含 `⌥` 符号的单个键帽展示当前快捷键。来源：[入门指南](https://shandianshuo.cn/docs)、[首页快捷键截图](https://shandianshuo.cn/docs/_next/static/media/home-overview.04iqd-q0km4zu.png)、[快捷键演示截图](https://shandianshuo.cn/docs/_next/static/media/shortcut-demo.0.6.zjlp3x-1q.png)（访问：2026-08-10）。
- 官网“直接说/帮我说”展示中使用单个 `⌘ command` 键帽，并分别写“按一下开始说话，再按一下结束”“按住再松开，AI 会帮你说”。来源：[闪电说官网](https://shandianshuo.cn/)（访问：2026-08-10）。
- 官方文档说明没有麦克风权限时无法录音，没有辅助功能权限时可能无法监听快捷键或自动输入。来源：[短按快捷键直接说](https://shandianshuo.cn/docs/voice-input)（访问：2026-08-10）。

### 字段判断

- 支持 OS：Windows、macOS 正式下载；Linux 内测。
- 当前材料展示的键：单个 Command/Option 键帽，且文档明确快捷键会因系统、用户设置而异。
- 可配置范围：未找到第一方完整列表。
- 单物理键：有第一方截图和页面展示；但左/右 Command、左/右 Option、任意普通单键是否可选，未找到第一方证据。
- 触发语义：同一快捷键区分短按与长按；短按是切换式，长按在松开时触发“帮我说”。这与 VoicePaste 当前“切换/按住”是相近但不完全相同的产品语义。

## 豆包输入法

### 官方确认

- 豆包输入法官网的 JavaScript 渲染结果当前显示“macOS版下载”和“Windows版敬请期待”；静态 HTML 仍含“macOS版敬请期待”的旧内容，因此当前状态以浏览器渲染后的官方页面为准。来源：[豆包输入法官网](https://ime.doubao.com/pc)（浏览器核验：2026-08-10）。
- 同一页面明确写“macOS版语音输入”“按住fn开始说话，重新定义效率”。来源同上。
- 页面还写“语音待机+悬浮窗，双模式随心选”，但标记“iOS 端专用”；不能外推到 macOS。

### 字段判断

- 桌面状态：macOS 当前可下载；Windows 为“敬请期待”。
- macOS 快捷键：`fn` 单键按住。
- 可配置范围、左右 Fn、松开后的结束/提交行为：未找到第一方证据。
- `Fn` 是平台特殊键；不能从豆包的输入法实现推断普通桌面应用可直接使用同一系统接口复刻。

## 微信输入法

### 官方确认

- 微信输入法 macOS 2.0.0 官方更新日志明确写“长按「fn」试试语音输入”“语音可实时转写到输入框”“支持连续语音输入不限时长”。来源：[微信输入法 2.0.0 for macOS](https://z.weixin.qq.com/web/change-log/144)（发布：2026-03-23；访问：2026-08-10）。
- 当前 macOS 2.2.2 更新日志明确写“语音输入支持自定义更多快捷键”。来源：[微信输入法 Mac 更新日志](https://z.weixin.qq.com/web/change-log/macos)（2.2.2 发布：2026-07-25；访问：2026-08-10）。
- 当前 Windows 2.1.1 与 Windows 2.0.0 官方更新日志未写语音输入快捷键；不能把 macOS 结论外推到 Windows。来源：[Windows 当前更新日志](https://z.weixin.qq.com/web/change-log/windows)、[Windows 2.0.0](https://z.weixin.qq.com/web/change-log/145)（访问：2026-08-10）。

### 字段判断

- macOS：明确支持长按 Fn 语音输入；当前版本支持自定义更多语音快捷键。
- Windows：当前有正式版本，但未找到语音快捷键第一方证据。
- 可配置范围：官方只写“更多快捷键”，没有列出具体键位、普通单键白名单或左/右 Fn。
- 触发语义：长按开始并实时转写；松开是否结束/提交未公开。

## 左右 Ctrl、左右修饰键能力

### 当前栈为什么不能区分

1. **前端先丢失左右信息。** TanStack 录制器使用 `event.ctrlKey`、`event.altKey`、`event.metaKey` 等布尔值生成通用 `Control/Alt/Meta`，没有把 `event.code` 的 `ControlLeft/ControlRight` 写进快捷键；修饰键单独按下还会被直接忽略。
2. **字符串格式无法表达。** VoicePaste 当前只保存 `CommandOrControl+Shift+Space` 这类通用修饰键字符串，没有 `ControlLeft`、`ControlRight` 等约定。
3. **后端注册模型也丢失左右信息。** `global-hotkey::HotKey` 只有通用 `Modifiers::CONTROL/ALT/SHIFT/SUPER` 加一个普通 `Code`；虽然底层 `keyboard-types::Code` 枚举存在 `ControlLeft/ControlRight`，`global-hotkey` 的字符串解析器与 Windows/macOS/X11 按键映射均未把它们作为可注册主键。
4. **Windows 当前 API 本身不区分。** `RegisterHotKey` 只接受通用 `MOD_CONTROL`，没有 Left/Right Control 标志。

因此，当前项目里的：

- `左 Ctrl + Space` 与 `右 Ctrl + Space`：都会退化成 `Control+Space`。
- `只按右 Ctrl`：前端录不到，后端也注册不了。
- `左 Ctrl` 与 `右 Ctrl` 分配不同功能：当前不能。

### 平台级实现可能性

| 平台 | 可行路径 | 判断 |
| --- | --- | --- |
| Windows | 使用 `WH_KEYBOARD_LL` 或 Raw Input，读取 `KBDLLHOOKSTRUCT.vkCode/scanCode/flags`，自行维护左右键按下/释放状态；需要时可返回非零阻止按键继续传给目标应用 | **可做**，但需替换该绑定的 Tauri 全局热键路径 |
| macOS | 使用 CGEventTap 监听 key-down/key-up/flags-changed，并读取 `keyboardEventKeycode` 区分物理键；主动过滤需要相应系统权限 | **可做**，但需权限与平台代码 |
| Linux X11 | [INFERENCE] 可用更底层 X11/XInput 事件和物理 keycode 自行匹配；当前 `global-hotkey` 不提供此能力 | **可做但维护成本高** |
| Linux Wayland | VoicePaste 当前依赖 XDG Global Shortcuts Portal；规范提供通用 CTRL/ALT/SHIFT/LOGO 与 keysym，但最终绑定由 compositor/portal UI 决定 | **不能承诺可移植的左右修饰键支持** |

### Fn 特别说明

`Fn/Globe` 常由键盘固件或操作系统特殊处理，不等同于普通 Ctrl/Alt/Command。当前前后端模型都不支持它。豆包输入法属于输入法产品，可能使用系统输入法集成或专用事件路径；在没有其实现证据前，不能把“按住 fn”当成 VoicePaste 能低成本复刻的证明。

## VoicePaste 实现建议

### 路线 A：普通单键，最小改动

适合“用户有额外功能键、脚踏键盘或鼠标映射到 F13–F24”的场景：

1. 删除 `src/shortcut.ts` 的“至少一个修饰键”限制。
2. 设置页文案改为“按键或组合键”。
3. 增加单键安全校验：不默认开放字母、数字、空格、Enter、Tab、Backspace、Delete；Windows 排除 F12。
4. 保存时继续依赖现有系统注册错误回滚。

这条路线改动小，但**不能提供竞品式右 Ctrl/右 Option/Fn 体验**。

### 路线 B：右 Ctrl / 右 Option，推荐竞品对齐方向

1. 保留现有全局快捷键后端处理普通组合键。
2. 为 `ControlLeft/ControlRight/AltLeft/AltRight/MetaLeft/MetaRight` 增加明确字符串 token 和自定义录制逻辑。
3. Windows 为这些物理键走低级键盘监听；macOS 走 CGEventTap。
4. Linux 先保留组合键或普通安全单键，不承诺 Wayland 左右修饰键。
5. 绑定单修饰键时吞掉对应 key-down/key-up，避免右 Ctrl 被前台应用当成悬空修饰键；监听回调只做状态切换，耗时工作继续交给现有异步链路。

推荐优先级：**Windows 右 Ctrl → macOS 右 Option/右 Command → Linux 评估**。先不做 Fn；它不是同一难度等级。

## 验证记录

- `node` 实测 `parseHotkey("Space")`：得到 `key: "Space"`、四个 modifier 均为 `false`、`modifiers: []`；显示结果为 `␣`。
- 运行 `global-hotkey 0.8.0` 自带 `test_parse_hotkey`：通过；该测试覆盖无修饰 `KeyX`、`Digit5`、`KeyG`。
- 运行 VoicePaste `cargo test shortcut::tests::converts_tauri_shortcut_to_xdg_syntax`：通过。
- 当前会话为 KDE Wayland；未实际提交单键 Portal 绑定，因为系统会弹出用户授权/配置 UI。
- 使用 `agent-browser` 核验 JavaScript 渲染内容：豆包页面为“macOS版下载 / Windows版敬请期待”；微信 macOS 2.0.0 为“长按 fn”，macOS 2.2.2 为“语音输入支持自定义更多快捷键”。
- Windows、macOS 没有在本机运行时注册验证；相关判断基于当前依赖源码和操作系统第一方接口文档。

## 证据缺口

本次未将搜索摘要、用户教程或第三方评测作为产品定论。仍需应用内实测的字段包括：闪电说左/右 Command/Option 与完整可配置范围；豆包输入法 Fn 左右侧、松开行为及自定义范围；微信输入法 macOS 可选快捷键清单、Fn 左右侧和松开行为，以及 Windows 语音能力；Linux Wayland 各 portal/compositor 对单修饰键的实际接受范围。

## 对 VoicePaste 的产品结论

1. **能做普通单键。** 工程改动小，但必须限制高冲突键；否则“支持单键”会直接破坏正常打字。
2. **能做左右 Ctrl，但不是当前 Tauri 热键配置的自然扩展。** 需要平台级物理键监听、前端录制格式升级和权限处理。
3. **无法一次实现完全一致的三平台左右键体验。** Windows/macOS 可先落地；Linux Wayland 必须保留组合键兜底。
4. **竞品最值得借鉴的是单个低使用频率修饰键，不是任意普通键。** 闪电说展示 Command/Option，豆包和微信输入法均采用 Fn；微信输入法还已开放更多语音快捷键。VoicePaste 若追求同等手感，应优先右 Ctrl/右 Option，而不是开放 `Space` 或字母。
5. **现有切换/按住链路可复用。** 真正新增的是“怎样可靠识别一个具体物理键”，不是录音或识别流程。

## 主要来源

### 竞品第一方

- https://shandianshuo.cn/
- https://shandianshuo.cn/download
- https://shandianshuo.cn/docs
- https://shandianshuo.cn/docs/voice-input
- https://ime.doubao.com/pc
- https://help.wechat.com/cgi-bin/readtemplate?faq=keyboard_0427&t=page%2Ffaq%2Fkeyboard%2F0427%2Findex
- https://z.weixin.qq.com/web/change-log/144
- https://z.weixin.qq.com/web/change-log/macos
- https://z.weixin.qq.com/web/change-log/windows
- https://z.weixin.qq.com/web/change-log/145

### 平台与依赖

- [Tauri Global Shortcut](https://v2.tauri.app/plugin/global-shortcut/)
- [Windows RegisterHotKey](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerhotkey)
- [Windows LowLevelKeyboardProc](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelkeyboardproc)
- [Windows KBDLLHOOKSTRUCT](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-kbdllhookstruct)
- [XDG Global Shortcuts Portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.GlobalShortcuts.html)
- [XDG Shortcuts Specification](https://specifications.freedesktop.org/shortcuts-spec/latest/)
- [macOS CGEventTapCreate](<https://developer.apple.com/documentation/coregraphics/cgevent/tapcreate(tap:place:options:eventsofinterest:callback:userinfo:)>)
- [macOS keyboardEventKeycode](https://developer.apple.com/documentation/coregraphics/cgeventfield/keyboardeventkeycode)

未解决证据：闪电说没有公开左/右 Command/Option 和完整可配置范围；豆包输入法没有公开 Fn 左右侧、松开行为和自定义范围；微信输入法没有公开 macOS 可选快捷键清单、左右 Fn 和 Windows 语音快捷键；Linux Wayland 各 portal/compositor 对单修饰键的实际接受范围仍需逐桌面实测。
