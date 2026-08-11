# Typeless 设计语言调研：面向 VoicePaste 的可移植结论

调查日期：2026-08-12。范围仅限 Typeless 官方网站、官方帮助中心、官方发布说明及其中嵌入的官方产品截图/视频。本文不使用媒体评测、应用聚合站、用户帖子或其他二手材料。

本文使用三种标记：

- **[直接观察]**：可由所引第一方页面、页面实时渲染样式或官方产品截图/视频直接确认。
- **[设计推断]**：基于直接观察形成的设计解释或迁移建议，不代表 Typeless 官方公开承诺。
- **[证据缺口]**：公开第一方材料不足以确认，不能当作事实。

## 结论摘要

1. **[设计推断] Typeless 的“高级感”主要来自克制，不来自装饰堆叠。** 官网和桌面应用都以黑、白、浅灰为骨架；柔和蓝、薄荷、淡紫只用于局部强调，错误与警告才引入红/橙。大面积留白、少量粗体标题、细边框和低对比表面共同形成安静、可信的工具感。来源：[Typeless 官网](https://www.typeless.com/)、[安装与设置](https://www.typeless.com/help/installation-and-setup)、[麦克风不可用](https://www.typeless.com/help/troubleshooting/microphone-unavailable)（访问：2026-08-12）。
2. **[设计推断] 产品界面强调“任务状态清楚”而非“品牌图形抢眼”。** 设置页用稳定的左侧导航与右侧内容区；听写时用独立悬浮条表达取消、音量、计时、完成；错误和时限警告另起信息层，不把所有信息挤进同一控件。来源：[语言变体设置](https://www.typeless.com/help/release-notes/macos/more-language-variants-supported)、[首次听写](https://www.typeless.com/help/quickstart/first-dictation)、[听写时限](https://www.typeless.com/help/troubleshooting/dictation-limit)（访问：2026-08-12）。
3. **[设计推断] 产品把高频任务与低频管理分层。** Home、History、Dictionary 等日常入口处于主导航；账户、设置、帮助、发布说明等管理入口位于底部或设置内层。不同版本截图显示过导航演化，但“日常任务优先、管理入口后置”的方向稳定。来源：[关键功能](https://www.typeless.com/help/quickstart/key-features)、[缺失转写](https://www.typeless.com/help/troubleshooting/missing-transcript)、[个性化](https://www.typeless.com/help/release-notes/macos/personalized-smarter)（访问：2026-08-12）。
4. **[设计推断] 引导不是功能巡礼，而是逐步消除失败条件。** 先登录，再解释并申请权限，再用动态蓝色音量条验证麦克风，最后让用户实际体验 Dictate、Translate、Ask anything。成功标准在每一步都可见。来源：[安装与设置](https://www.typeless.com/help/installation-and-setup)（访问：2026-08-12）。
5. **[设计推断] 错误设计遵循“状态—原因—下一步”。** “Microphone unavailable”先说明系统状态，再列出可能原因，最后提供“Get help”；时限警告提前 60 秒出现，并在到达限制时自动保存到 History。来源：[麦克风不可用](https://www.typeless.com/help/troubleshooting/microphone-unavailable)、[听写时限](https://www.typeless.com/help/troubleshooting/dictation-limit)（访问：2026-08-12）。
6. **[设计推断] VoicePaste 应迁移 Typeless 的信息层级、状态反馈与克制原则，不应复制其 Logo、口号、Prompt/Inter 组合、天空模糊背景、蓝紫卡片、图标造型或具体版式。** 目标是形成 VoicePaste 自己的工具气质，不是制作“Typeless 换皮”。

## 1. 证据范围与强度

### 1.1 核心第一方页面

| 来源 | 主要证据 | 访问日期 |
| --- | --- | --- |
| [Typeless 官网](https://www.typeless.com/) | 官网字体、颜色、层级、卡片、导航、营销文案 | 2026-08-12 |
| [Manifesto](https://www.typeless.com/manifesto) | 品牌语气与叙事强度 | 2026-08-12 |
| [安装与设置](https://www.typeless.com/help/installation-and-setup) | 登录、权限、麦克风测试、引导、成功反馈 | 2026-08-12 |
| [首次听写](https://www.typeless.com/help/quickstart/first-dictation) | 启动/结束语义、声音与 Voice bar 反馈 | 2026-08-12 |
| [关键功能](https://www.typeless.com/help/quickstart/key-features) | Dictionary、跨应用、语言、隐私、功能分类 | 2026-08-12 |
| [语言变体设置](https://www.typeless.com/help/release-notes/macos/more-language-variants-supported) | 设置导航、弹窗、下拉菜单、行式设置 | 2026-08-12 |
| [Translation mode](https://www.typeless.com/help/release-notes/macos/translation-mode) | 快捷键设置、模式说明、设置行结构 | 2026-08-12 |
| [多目标翻译语言](https://www.typeless.com/help/release-notes/macos/set-multiple-target-languages) | 语言管理、悬浮条上方模式切换 | 2026-08-12 |
| [个性化](https://www.typeless.com/help/release-notes/macos/personalized-smarter) | 二级设置导航、信息卡、菜单、进度展示 | 2026-08-12 |
| [听写时限](https://www.typeless.com/help/troubleshooting/dictation-limit) | 警告、计时、自动保存、悬浮条形态 | 2026-08-12 |
| [麦克风不可用](https://www.typeless.com/help/troubleshooting/microphone-unavailable) | 错误浮层、错误文案、修复路径 | 2026-08-12 |
| [缺失转写](https://www.typeless.com/help/troubleshooting/missing-transcript) | History、保留周期、数据恢复 | 2026-08-12 |
| [提交反馈](https://www.typeless.com/help/troubleshooting/give-feedback) | 转写级反馈、通用反馈 | 2026-08-12 |
| [检查更新](https://www.typeless.com/help/troubleshooting/check-for-updates) | 低频管理入口与版本信息 | 2026-08-12 |
| [Troubleshooting 首页](https://www.typeless.com/help/troubleshooting) | 帮助中心信息架构 | 2026-08-12 |

### 1.2 证据边界

- **[直接观察]** 官网在 1280 px 桌面视口实时渲染时，正文使用 Inter，一级/二级大标题使用 Prompt；页面父级 `h1` 为 96 px/100 px、500，首个 `h2` 为 72 px/88 px、500；首个主按钮为 Inter 14 px、500、约 24.5 px 行高、`12px 16px` 内边距、深色背景与全圆角。来源：[Typeless 官网](https://www.typeless.com/)（浏览器计算样式核验，访问：2026-08-12）。
- **[证据缺口]** 这些数值只证明官网当前桌面断点，不证明 Typeless 桌面应用使用相同字体文件、字号或设计令牌。
- **[证据缺口]** 官方公开材料没有给出桌面应用的准确字体家族、完整色板、圆角令牌、间距令牌、阴影令牌、动效时长或 easing。
- **[直接观察]** 官方帮助页包含大量应用截图、GIF 与 MP4；本文只把画面可见结构与官方文字说明写成事实，不从压缩图片反推未公开的精确像素令牌。来源：[安装与设置](https://www.typeless.com/help/installation-and-setup)、[Translation mode](https://www.typeless.com/help/release-notes/macos/translation-mode)、[多目标翻译语言](https://www.typeless.com/help/release-notes/macos/set-multiple-target-languages)（访问：2026-08-12）。

## 2. 视觉系统

### 2.1 字体与层级

- **[直接观察]** 官网正文使用 Inter，营销大标题使用 Prompt；大标题以中等字重、超大字号和紧凑行高构成视觉主角，正文与按钮维持中性无衬线。来源：[Typeless 官网](https://www.typeless.com/)（访问：2026-08-12）。
- **[直接观察]** 官网首屏“Speak, don't type”在视觉上把部分文字显示为深色、部分显示为较浅灰色；同类双色文字也出现在“Private by design”等章节标题。来源：[Typeless 官网](https://www.typeless.com/)（访问：2026-08-12）。
- **[直接观察]** 桌面应用截图使用清晰无衬线层级：页面标题最大，区块标题与设置项名称次之，说明文案更小更灰；按钮与导航标签通常使用中等字重。截图本身不能确认具体字体家族。来源：[安装与设置](https://www.typeless.com/help/installation-and-setup)、[语言变体设置](https://www.typeless.com/help/release-notes/macos/more-language-variants-supported)（访问：2026-08-12）。
- **[设计推断]** 高级感来自“字号差异明确、字重种类少”，不是每层都换字体、加粗或加颜色。VoicePaste 设置页应限制为页面标题、区块标题、设置项标题、说明/辅助文字四级；悬浮窗只保留状态文字和计时两级。
- **[设计推断]** 官网 96 px 展示字适合营销页，不适合 920×720 设置窗口。VoicePaste 可用 28–32 px 页面标题、16 px 区块标题、14 px 设置项标题、12–13 px 说明文字；重点靠间距和对比建立。

### 2.2 颜色

- **[直接观察]** 官网以白色背景、近黑正文、浅灰次级文字为主；功能卡使用极淡的蓝、薄荷绿、淡紫等低饱和色块。来源：[Typeless 官网](https://www.typeless.com/)（访问：2026-08-12）。
- **[直接观察]** 官网首个主 CTA 的计算背景色为 `rgb(29, 26, 26)`，文字为白色；按钮无可见重阴影，使用极大圆角形成胶囊。来源：[Typeless 官网](https://www.typeless.com/)（浏览器计算样式核验，访问：2026-08-12）。
- **[直接观察]** 桌面应用常态界面以白、浅灰、黑为主；选中导航用浅灰底而不是强烈品牌色。来源：[关键功能](https://www.typeless.com/help/quickstart/key-features)、[缺失转写](https://www.typeless.com/help/troubleshooting/missing-transcript)（访问：2026-08-12）。
- **[直接观察]** 麦克风测试成功使用明亮蓝色活动条；开关和升级按钮等明确动作也可见蓝色。来源：[安装与设置](https://www.typeless.com/help/installation-and-setup)、[检查更新](https://www.typeless.com/help/troubleshooting/check-for-updates)（访问：2026-08-12）。
- **[直接观察]** “Microphone unavailable”错误使用深色浮层与红色警告图标；听写即将超时使用橙色警告图标，悬浮条本体仍保持黑白。来源：[麦克风不可用](https://www.typeless.com/help/troubleshooting/microphone-unavailable)、[听写时限](https://www.typeless.com/help/troubleshooting/dictation-limit)（访问：2026-08-12）。
- **[设计推断]** 颜色策略可概括为：中性色承担结构，单一冷色承担正常交互，红/橙只承担语义状态。VoicePaste 不应给每个设置分类分配不同颜色，也不应让悬浮窗在录音时整块变红。

### 2.3 表面、边框、圆角与阴影

- **[直接观察]** 登录卡、设置弹窗、语言变体弹窗、历史记录行和反馈表单都使用白色或近白表面，配细边框或轻微层次差；没有玻璃拟态式高亮描边。来源：[安装与设置](https://www.typeless.com/help/installation-and-setup)、[语言变体设置](https://www.typeless.com/help/release-notes/macos/more-language-variants-supported)、[提交反馈](https://www.typeless.com/help/troubleshooting/give-feedback)（访问：2026-08-12）。
- **[直接观察]** 模态弹窗出现时，背景应用被整体压暗；弹窗本体使用明显但不过分夸张的圆角。下拉菜单使用白色浮层、轻阴影和圆角，当前选项用浅灰底。来源：[语言变体设置](https://www.typeless.com/help/release-notes/macos/more-language-variants-supported)、[个性化](https://www.typeless.com/help/release-notes/macos/personalized-smarter)（访问：2026-08-12）。
- **[直接观察]** 主按钮多为胶囊形；导航选中态、设置行、卡片与弹窗使用较小常规圆角，形成“动作更圆、容器较稳”的层级。来源：[安装与设置](https://www.typeless.com/help/installation-and-setup)、[关键功能](https://www.typeless.com/help/quickstart/key-features)、[语言变体设置](https://www.typeless.com/help/release-notes/macos/more-language-variants-supported)（访问：2026-08-12）。
- **[设计推断]** VoicePaste 应避免层层卡片。建议窗口基底、导航选中态、设置组、弹出层、按钮只使用 3–4 个圆角等级；阴影只给真正悬浮的下拉、弹窗和桌面听写条。

### 2.4 间距与密度

- **[直接观察]** 官网长页在章节之间保留大量纵向留白，每个产品能力通常由一个标题、短说明和一个大媒体区域构成；同屏不会密集塞入许多等权信息。来源：[Typeless 官网](https://www.typeless.com/)（访问：2026-08-12）。
- **[直接观察]** 桌面应用比官网更紧凑，但设置项仍以“标题/说明在左、当前值或操作在右”的宽行组织；弹窗列表按稳定行高垂直排列。来源：[Translation mode](https://www.typeless.com/help/release-notes/macos/translation-mode)、[语言变体设置](https://www.typeless.com/help/release-notes/macos/more-language-variants-supported)（访问：2026-08-12）。
- **[设计推断]** 920×720 不适合照搬官网大留白，也不应压成企业后台表格。VoicePaste 可用 4/8/12/16/24/32 px 间距级别：页面边距 24–28 px，区块间距 24 px，设置行内间距 12–16 px，相关控件间距 8 px。

## 3. 导航与信息架构

- **[直接观察]** 官网顶部主导航只放 Manifesto、Pricing、About 和“Download for free”；核心产品能力通过单页长滚动叙事展开。来源：[Typeless 官网](https://www.typeless.com/)（访问：2026-08-12）。
- **[直接观察]** 较早官方截图中，左侧主导航出现 Home、Dictionary、History、Settings、Account；较新截图中，主导航突出 Home、History、Dictionary，账户、设置、帮助等以底部图标或设置内层出现。来源：[关键功能](https://www.typeless.com/help/quickstart/key-features)、[缺失转写](https://www.typeless.com/help/troubleshooting/missing-transcript)、[个性化](https://www.typeless.com/help/release-notes/macos/personalized-smarter)（访问：2026-08-12）。
- **[直接观察]** 设置弹窗内部又使用 Account、Settings、Personalization、About，以及 Help center、Release note 等二级导航。来源：[个性化](https://www.typeless.com/help/release-notes/macos/personalized-smarter)（访问：2026-08-12）。
- **[直接观察]** 选中导航通常是浅灰圆角矩形；图标与文字同排，未选项保持低对比。来源：[缺失转写](https://www.typeless.com/help/troubleshooting/missing-transcript)、[语言变体设置](https://www.typeless.com/help/release-notes/macos/more-language-variants-supported)（访问：2026-08-12）。
- **[直接观察]** Troubleshooting 首页按问题组织入口：缺失转写、听写时限、权限、系统冲突、反馈、更新、麦克风不可用。来源：[Troubleshooting 首页](https://www.typeless.com/help/troubleshooting)（访问：2026-08-12）。
- **[直接观察]** History 同时承担恢复、保留周期、隐私解释和转写级反馈入口；错误不是一次性死路。来源：[缺失转写](https://www.typeless.com/help/troubleshooting/missing-transcript)、[提交反馈](https://www.typeless.com/help/troubleshooting/give-feedback)（访问：2026-08-12）。
- **[设计推断]** 不同版本 IA 不应被当作固定模板复制；更值得迁移的是“日常任务在上、低频管理在下、选中态低噪声”。VoicePaste 历史页应成为恢复界面，而不只是日志列表。

## 4. 设置页设计与 920×720 映射

### 4.1 直接观察

- **[直接观察]** Typeless 设置画面常采用左侧分类、右侧内容；主内容以大标题开场，设置项按功能区分组。来源：[Translation mode](https://www.typeless.com/help/release-notes/macos/translation-mode)、[语言变体设置](https://www.typeless.com/help/release-notes/macos/more-language-variants-supported)（访问：2026-08-12）。
- **[直接观察]** 设置项常见结构为：左侧图标/名称/说明，右侧当前值、下拉箭头、快捷键键帽、开关或按钮。来源：[Translation mode](https://www.typeless.com/help/release-notes/macos/translation-mode)、[语言变体设置](https://www.typeless.com/help/release-notes/macos/more-language-variants-supported)（访问：2026-08-12）。
- **[直接观察]** 快捷键用独立键帽表达，例如 `fn` 与 Shift 图标；Translation mode 旁带小型“New”标签，但标签没有压过设置项名称。来源：[Translation mode](https://www.typeless.com/help/release-notes/macos/translation-mode)（访问：2026-08-12）。
- **[直接观察]** 多语言变体不是直接展开在长设置页中，而是从“Select language variants”进入独立弹窗；弹窗中每种语言占一行，当前变体位于右侧。来源：[语言变体设置](https://www.typeless.com/help/release-notes/macos/more-language-variants-supported)（访问：2026-08-12）。
- **[直接观察]** 个性化页面用一张隐私说明卡先解释数据边界，再展示“Overall personalization: 64%”等状态；禁用动作收进三点菜单，不与核心状态争夺注意力。来源：[个性化](https://www.typeless.com/help/release-notes/macos/personalized-smarter)（访问：2026-08-12）。

### 4.2 VoicePaste 可落地规格

以下均为迁移建议，不是 Typeless 像素复刻：

- **[设计推断] 窗口骨架：** 固定左栏 + 可滚动内容区。920 px 宽度下，左栏建议 176–192 px；内容区保留 24–28 px 水平内边距。VoicePaste 本身就是设置应用，不要再模拟“主应用背景 + 居中设置弹窗”。
- **[设计推断] 导航密度：** 导航项建议 40 px 高、10–12 px 圆角、18 px 图标、10 px 图标文字间距。一级分类控制在 5–7 个；版本、帮助、隐私、关于放底部。
- **[设计推断] 内容层级：** 页面标题 28–32/34–38 px；区块标题 16/24 px；设置项标题 14/20 px；说明 12–13/18 px；正文至少分主文字、次文字、禁用文字三级。
- **[设计推断] 设置行：** 常规行建议 64–76 px 高。左侧允许两行文字，右侧控件保持 32–36 px 高；同一行只承载一个主操作。
- **[设计推断] 表面：** 优先用分隔线和浅灰分组背景，不要每个设置项都做独立带阴影卡片。需要解释隐私、风险或状态时，再使用单独信息卡。
- **[设计推断] 二级编辑：** 模型列表、语言列表、快捷键录制、保留周期等复杂选择可进入弹窗或抽屉；弹层保留清晰标题、关闭按钮和当前选择。
- **[设计推断] 首屏状态：** 优先显示麦克风、系统权限、快捷键、服务连接是否可用；异常状态直接给修复动作。

## 5. 听写状态与 420×64 桌面悬浮反馈

### 5.1 直接观察

- **[直接观察]** 桌面听写流程是：聚焦任意文本框，按一次快捷键，听到交互声音或看到 Voice bar 后开始说话，再按一次快捷键结束并插入格式化文本。来源：[首次听写](https://www.typeless.com/help/quickstart/first-dictation)（访问：2026-08-12）。
- **[直接观察]** 官方时限截图中的 Voice bar 为横向深色胶囊：左侧圆形取消按钮，中间白色波形与倒计时，右侧白色圆形确认按钮。来源：[听写时限](https://www.typeless.com/help/troubleshooting/dictation-limit)（访问：2026-08-12）。
- **[直接观察]** 到 8 分钟时，Voice bar 显示 60 秒倒计时；同一截图在悬浮条上方增加独立深色警告卡，标题说明会话将在 1 分钟内结束，正文说明 9 分钟限制和重新开始方法。来源：[听写时限](https://www.typeless.com/help/troubleshooting/dictation-limit)（访问：2026-08-12）。
- **[直接观察]** Translation 模式允许在 Voice bar 上方显示目标语言，并通过悬停后选择语言。来源：[多目标翻译语言](https://www.typeless.com/help/release-notes/macos/set-multiple-target-languages)（访问：2026-08-12）。
- **[设计推断]** 基础悬浮条只承载即时控制和最短状态；解释性警告、语言菜单、帮助应作为临时附层出现。

### 5.2 VoicePaste 可落地规格

- **[设计推断] 外框：** 固定 420×64；左右内边距 8–10 px；整体圆角 18–22 px；近黑表面、细浅边框与单层柔和阴影。不要复制 Typeless 的具体黑色、按钮造型或图标。
- **[设计推断] 左区：** 40×40 取消按钮，保留至少 8 px 窗口边缘安全距离；点击目标不小于 32×32。
- **[设计推断] 中区：** 92–120 px 波形或音量条 + 自适应状态文字。波形必须是真实输入反馈，不做与音量无关的装饰循环。
- **[设计推断] 计时：** 44–52 px 固定宽度，使用等宽数字或 tabular numbers，避免秒数变化导致布局抖动。
- **[设计推断] 右区：** 40×40 完成按钮；Listening 状态可用高对比中性按钮，成功状态再短暂使用品牌强调色或勾选，不让录音态整条变成危险红。
- **[设计推断] 文字：** 14–15 px 状态文字，13–14 px 计时；同屏最多一条短状态，不显示两行说明。
- **[设计推断] 警告附层：** 420×64 固定窗无法容纳 Typeless 式大警告卡。时限、权限和设备错误应使用第二个临时通知窗、系统通知，或让悬浮窗短暂扩展高度。

### 5.3 悬浮窗状态矩阵

| 状态 | 420×64 内建议 | 额外反馈 |
| --- | --- | --- |
| **[设计推断] 正在听写** | 取消、真实波形、“正在听写”、已用时间、完成 | 启动时可有短促声音；提供静音选项 |
| **[设计推断] 正在整理** | 波形收束为轻量进度动效、“正在整理…”；完成按钮暂时禁用或替换为取消 | 超过预期时显示具体阶段，不无限旋转无文案 |
| **[设计推断] 已插入** | 勾选 + “已输入”，保持约 0.7–1.0 秒后退出 | 不弹大型成功卡，避免打断当前应用 |
| **[设计推断] 麦克风不可用** | 警告图标 + “麦克风不可用” + “设置”短按钮 | 独立附层说明权限/设备原因；提供打开设置 |
| **[设计推断] 即将超时** | 计时转琥珀色，状态改为“剩余 60 秒” | 悬浮条上方出现紧凑通知；到时先保存再结束 |
| **[设计推断] 网络/模型失败** | “处理失败” + “重试”或“保留原文” | 不清空录音；History 保留原始转写与失败原因 |

## 6. 引导、成功与错误

### 6.1 引导

- **[直接观察]** Typeless 安装引导顶部显示 Sign up → Set up → Experience it，并以横向进度线表现阶段。来源：[安装与设置](https://www.typeless.com/help/installation-and-setup)（访问：2026-08-12）。
- **[直接观察]** 权限步骤分别解释 Accessibility 用于向当前文本框插入内容，Microphone 用于听写；没有把权限请求合并成一段抽象说明。来源：[安装与设置](https://www.typeless.com/help/installation-and-setup)（访问：2026-08-12）。
- **[直接观察]** 麦克风测试页标题为“Speak to test your microphone”，右侧显示随声音移动的蓝色条；页面直接问“Do you see the blue bars moving while you speak?”，提供“No, change microphone”与“Continue”。来源：[安装与设置](https://www.typeless.com/help/installation-and-setup)（访问：2026-08-12）。
- **[直接观察]** Experience 阶段将 Dictate、Translate、Ask anything 分为三张快捷键卡，先建立模式与按键的对应关系。来源：[安装与设置](https://www.typeless.com/help/installation-and-setup)（访问：2026-08-12）。
- **[设计推断]** VoicePaste 首次启动应依次验证：麦克风权限 → 辅助功能/全局快捷键权限 → 麦克风活动 → 快捷键触发 → 在测试输入框完成一次真实听写。任何一步失败都在原地修复，不把用户丢进完整设置页自行排查。

### 6.2 错误、警告与成功

- **[直接观察]** “Microphone unavailable”浮层使用深色表面、红色警告图标、右上关闭按钮、居中标题、原因说明和“Get help”按钮。来源：[麦克风不可用](https://www.typeless.com/help/troubleshooting/microphone-unavailable)（访问：2026-08-12）。
- **[直接观察]** 官方说明把错误原因列为操作系统权限被阻止、安全/设备管理限制、其他应用占用麦克风、当前设备不可用；修复步骤按 Windows/macOS 分开。来源：[麦克风不可用](https://www.typeless.com/help/troubleshooting/microphone-unavailable)（访问：2026-08-12）。
- **[直接观察]** Typeless 在硬性停止前 60 秒预警；到达 9 分钟限制后自动把已有听写保存到 History。来源：[听写时限](https://www.typeless.com/help/troubleshooting/dictation-limit)（访问：2026-08-12）。
- **[直接观察]** History 允许设置 Off、24 hours、1 week、1 month、Forever 等保留周期；页面同时解释记录只在设备本地保存，超过周期自动删除。来源：[缺失转写](https://www.typeless.com/help/troubleshooting/missing-transcript)（访问：2026-08-12）。
- **[直接观察]** 麦克风可用的明确成功反馈是蓝色活动条随说话移动，并允许点击 Continue。来源：[安装与设置](https://www.typeless.com/help/installation-and-setup)（访问：2026-08-12）。
- **[直接观察]** 首次听写完成后，文本直接插入当前文本框；官方流程没有要求用户回到 Typeless 主窗口复制粘贴。来源：[首次听写](https://www.typeless.com/help/quickstart/first-dictation)（访问：2026-08-12）。
- **[证据缺口]** 公开第一方材料未展示稳定、完整的“听写成功 toast”规范，不能断言 Typeless 使用何种成功颜色、停留时长或退场动画。
- **[设计推断]** VoicePaste 错误文案应显示用户能理解的状态名，并在可判断时指出具体原因；无法判断时给出检查麦克风、权限、网络、模型配置的顺序。失败时保留录音或原始转写。

## 7. 动效与声音

- **[直接观察]** 官方安装指南明确用“蓝色条是否移动”判断麦克风输入；这是与真实音量绑定的动态反馈。来源：[安装与设置](https://www.typeless.com/help/installation-and-setup)（访问：2026-08-12）。
- **[直接观察]** 官方首次听写指南把交互声音或 Voice bar 出现视为可以开始说话的反馈。来源：[首次听写](https://www.typeless.com/help/quickstart/first-dictation)（访问：2026-08-12）。
- **[直接观察]** 官方帮助与发布说明使用 MP4/GIF 展示权限申请、语言选择、快捷键设置、文本改写和模式切换，动态演示被用于解释跨步骤操作。来源：[安装与设置](https://www.typeless.com/help/installation-and-setup)、[Translation mode](https://www.typeless.com/help/release-notes/macos/translation-mode)、[多目标翻译语言](https://www.typeless.com/help/release-notes/macos/set-multiple-target-languages)（访问：2026-08-12）。
- **[证据缺口]** 第一方公开页面未给出应用转场时长、弹簧参数、easing、波形采样频率或成功态停留时间。
- **[设计推断]** 可迁移的不是某个 easing，而是“动效必须回答状态问题”：是否收到声音、是否正在处理、是否完成、是否即将结束。VoicePaste 应避免与真实进度无关的呼吸光、持续缩放和大面积渐变流动。
- **[设计推断]** VoicePaste 可从控件状态切换 120–180 ms、弹层 160–220 ms、成功停留 700–1000 ms 开始实机调试；这些数值是设计建议，不是 Typeless 令牌。

## 8. 文案语气

- **[直接观察]** 官网与 Manifesto 使用强主张：“Speak, don't type”“The keyboard was a mistake”“Welcome to the end of typing”；品牌叙事短句多、节奏强、对立明确。来源：[Typeless 官网](https://www.typeless.com/)、[Manifesto](https://www.typeless.com/manifesto)（访问：2026-08-12）。
- **[直接观察]** 官网功能命名以动词为主：Dictate、Translate、Ask anything；能力标题直接描述结果，如 Removes filler words、Auto-formats、Personalized style and tone。来源：[Typeless 官网](https://www.typeless.com/)（访问：2026-08-12）。
- **[直接观察]** 引导和帮助文案比品牌文案克制，常用“动作 + 结果”：Speak to test your microphone、Click any text field、Press your keyboard shortcut once、No, change microphone、Continue。来源：[安装与设置](https://www.typeless.com/help/installation-and-setup)、[首次听写](https://www.typeless.com/help/quickstart/first-dictation)（访问：2026-08-12）。
- **[直接观察]** 错误文案先给状态名，再用完整句解释影响和原因；警告文案给出剩余时间和继续方法。来源：[麦克风不可用](https://www.typeless.com/help/troubleshooting/microphone-unavailable)、[听写时限](https://www.typeless.com/help/troubleshooting/dictation-limit)（访问：2026-08-12）。
- **[设计推断]** VoicePaste 应采用“状态优先、动词明确、少形容词”的中文文案。建议用“正在听写”“正在整理”“已输入”“麦克风不可用”“打开系统设置”，避免营销化状态文案。
- **[设计推断]** Typeless 的激进反键盘口号属于其品牌资产，不适合照搬。VoicePaste 可强调“在任何输入框快速说出文字”，但应建立自己的语言与品牌立场。

## 9. 可移植到 VoicePaste 的 11 条原则

1. **[设计推断] 中性色建结构，强调色只做动作与实时反馈。** 设置页保持黑白灰；品牌色用于主按钮、选中控制、音量反馈；红/橙仅用于错误与警告。
2. **[设计推断] 字号跨度明确，字重种类克制。** 页面标题、区块标题、设置项、说明四级足够；不要给每个字段都加粗。
3. **[设计推断] 一个表面只解决一个问题。** 设置组承载配置，信息卡解释隐私/风险，弹窗处理复杂选择，悬浮条处理即时听写。
4. **[设计推断] 高频任务前置，低频管理后置。** 快捷键、录音、转写、模型放主导航；版本、更新、隐私、帮助、关于放底部。
5. **[设计推断] 设置行固定为“名称/说明 + 当前值/动作”。** 用户扫左侧理解意义，扫右侧确认状态；同一行不放多个竞争按钮。
6. **[设计推断] 首次体验按失败条件排序。** 先权限，再设备，再快捷键，再真实听写；每一步有可观察成功标准。
7. **[设计推断] 悬浮窗始终回答三个问题：是否在听、多久了、怎样结束。** 取消、真实波形/状态、计时、完成四部分不可被装饰挤掉。
8. **[设计推断] 解释性信息与即时控制分层。** 420×64 只留短状态；错误原因、超时说明、设备选择用附层、通知或设置页。
9. **[设计推断] 硬中断前预警，失败后保留成果。** 超时提前提示；模型或网络失败保留录音/原始转写；History 提供恢复和重试。
10. **[设计推断] 动效绑定真实状态。** 音量条反映输入，处理动画反映等待，成功动画短暂收尾；不做无意义循环。
11. **[设计推断] 文案写“发生了什么、下一步做什么”。** 错误不只给代码，成功不写长说明，按钮使用明确动作词。

## 10. 不应照搬的部分

1. **[直接观察]** Typeless 使用自有 Logo、品牌名、“Speak, don't type”与“The keyboard was a mistake”等标志性文案。来源：[Typeless 官网](https://www.typeless.com/)、[Manifesto](https://www.typeless.com/manifesto)（访问：2026-08-12）。 **[设计推断]** VoicePaste 不应复制 Logo 轮廓、口号、语句节奏或“反键盘”品牌立场。
2. **[直接观察]** Typeless 引导与营销素材大量使用蓝白模糊天空/室内背景、淡蓝淡紫卡片与自有图标。来源：[安装与设置](https://www.typeless.com/help/installation-and-setup)、[Typeless 官网](https://www.typeless.com/)（访问：2026-08-12）。 **[设计推断]** VoicePaste 不应复制背景图、渐变组合、图标造型和卡片构图；可迁移低饱和、低噪声原则，但应重建色彩与图形系统。
3. **[直接观察]** 官网使用 Prompt 超大标题与 Inter 正文。来源：[Typeless 官网](https://www.typeless.com/)（访问：2026-08-12）。 **[设计推断]** VoicePaste 不应为“像 Typeless”而引入相同字体；设置应用优先使用现有字体栈或系统字体，减少包体与跨平台渲染差异。
4. **[直接观察]** Typeless 拥有 Dictate、Translate、Ask anything、Personalization、Dictionary、团队与升级等更大功能面。来源：[Typeless 官网](https://www.typeless.com/)、[安装与设置](https://www.typeless.com/help/installation-and-setup)、[个性化](https://www.typeless.com/help/release-notes/macos/personalized-smarter)（访问：2026-08-12）。 **[设计推断]** VoicePaste 不应为了视觉完整而虚构 Translate、AI assistant、团队、统计或个性化进度等不在当前范围内的模块。
5. **[直接观察]** Typeless 主应用可在内容背后打开大型设置模态弹窗。来源：[Translation mode](https://www.typeless.com/help/release-notes/macos/translation-mode)、[个性化](https://www.typeless.com/help/release-notes/macos/personalized-smarter)（访问：2026-08-12）。 **[设计推断]** VoicePaste 当前就是 920×720 设置应用，不应再套一层伪主应用和居中大设置弹窗；直接两栏布局更简单。
6. **[直接观察]** Typeless 的时限警告卡明显高于 64 px，并悬浮在 Voice bar 上方。来源：[听写时限](https://www.typeless.com/help/troubleshooting/dictation-limit)（访问：2026-08-12）。 **[设计推断]** VoicePaste 不能把该卡按比例缩进 420×64；应使用独立附层或扩展状态窗。
7. **[设计推断]** 不应照搬 Typeless 的具体颜色值、圆角值、按钮排列和悬浮条图标。即使结构相似，也应通过 VoicePaste 自有品牌色、图标、文案与状态逻辑形成可识别差异。

## 11. 最终映射

### 11.1 920×720 设置应用

- **[设计推断]** 视觉目标：安静、清晰、桌面原生感；不追求营销页式戏剧性。
- **[设计推断]** IA：听写、快捷键、转写与模型、词典/表达、历史与隐私为主要分类；帮助、更新、关于放底部。最终分类以 VoicePaste 现有功能为准，不为对齐 Typeless 增加空模块。
- **[设计推断]** 首屏优先显示“当前是否可用”：麦克风、权限、快捷键、服务连接四项状态；有问题时直接给修复动作。
- **[设计推断]** 复杂配置用弹窗/抽屉，主设置层保持行式布局；减少卡片、阴影和强调色面积。
- **[设计推断]** 历史页承担恢复、重试、复制、删除与保留周期；隐私解释与实际数据控制放在同一处。

### 11.2 420×64 听写悬浮窗

- **[设计推断]** 视觉目标：像系统级输入状态控件，不像缩小的聊天窗口。
- **[设计推断]** 固定四区：取消 / 输入反馈 / 状态与计时 / 完成。处理态可暂时合并中间两区，但左右控制位置不跳动。
- **[设计推断]** 正常态只用中性色与 VoicePaste 品牌色；错误/警告用图标、文字和局部色，不用整窗闪烁或大面积变色。
- **[设计推断]** 所有数字使用稳定宽度；波形、状态和按钮变化不改变窗口整体尺寸。
- **[设计推断]** 长错误、权限解释、设备选择和重试详情离开 64 px 主条，进入附层或设置页。

## 12. 证据缺口与验证要求

- **[证据缺口]** 未获得 Typeless 桌面应用可检查的 DOM/CSS 或设计令牌，无法确认应用字体、精确色值、圆角和间距。
- **[证据缺口]** 官方图片来自多个版本，导航与功能位置有演化；本文不把任一旧截图当成当前唯一实现。
- **[证据缺口]** 未公开 Voice bar 的精确宽高、屏幕锚点、拖动能力、跨显示器行为、动画参数和无障碍语义。
- **[证据缺口]** 未找到完整成功 toast、离线状态、模型处理失败、网络重试与高对比模式的第一方截图。
- **[设计推断]** VoicePaste 重构前应在 920×720 和 420×64 两个真实 Tauri 窗口中验证：文字截断、125%/150% 缩放、Windows/macOS/Linux 字体差异、键盘焦点、屏幕阅读器标签、减少动态效果、浅色/深色对比和多显示器定位。

## 最终判断

- **[设计推断]** Typeless 最值得 VoicePaste 学习的不是外观，而是秩序：少量视觉令牌、明确任务层级、实时输入反馈、提前警告、失败可恢复、文案直接。
- **[设计推断]** 对 920×720 设置应用，迁移重点是两栏 IA、行式设置、低噪声状态卡和逐步引导。
- **[设计推断]** 对 420×64 悬浮窗，迁移重点是取消、真实波形、状态/计时、完成四区稳定，以及把解释性错误移出主条。
- **[设计推断]** VoicePaste 使用自己的字体、品牌色、图标、文案和功能边界，即可形成同等级精致感，不构成 Typeless 品牌或界面复制。
