# Changelog

## [2.3.0](https://github.com/imbytecat/voicepaste/compare/v2.2.0...v2.3.0) (2026-10-06)


### 新增

* **dictionary:** 火山常用词改为自动三方合并同步 ([91e673c](https://github.com/imbytecat/voicepaste/commit/91e673cd651b2a2058e2c345279838bbd267679b))


### 修复

* **doubao:** 账号一次网络校验失败后不再持续拦截听写 ([91e673c](https://github.com/imbytecat/voicepaste/commit/91e673cd651b2a2058e2c345279838bbd267679b))
* **onboarding:** 首次引导测试连接前先保存识别配置，修复无法继续 ([91e673c](https://github.com/imbytecat/voicepaste/commit/91e673cd651b2a2058e2c345279838bbd267679b))
* **paste:** 自动粘贴失败后可重新授权并区分目标窗口拒绝输入 ([91e673c](https://github.com/imbytecat/voicepaste/commit/91e673cd651b2a2058e2c345279838bbd267679b))
* **settings:** 修复切换识别服务时选择不保存必然失败 ([91e673c](https://github.com/imbytecat/voicepaste/commit/91e673cd651b2a2058e2c345279838bbd267679b))
* **settings:** 外部链接在后台打开，不再阻塞设置窗口 ([91e673c](https://github.com/imbytecat/voicepaste/commit/91e673cd651b2a2058e2c345279838bbd267679b))
* **shortcut:** 修复 Wayland 下全局快捷键因缺少应用 ID 无法注册 ([91e673c](https://github.com/imbytecat/voicepaste/commit/91e673cd651b2a2058e2c345279838bbd267679b))
* **startup:** 设置文件无法读取时提示原因而非直接退出 ([91e673c](https://github.com/imbytecat/voicepaste/commit/91e673cd651b2a2058e2c345279838bbd267679b))

## [2.2.0](https://github.com/imbytecat/voicepaste/compare/v2.1.0...v2.2.0) (2026-10-06)


### 新增

* **settings:** 重新设计设置界面与首次引导 ([d3680ab](https://github.com/imbytecat/voicepaste/commit/d3680abab2961432bead518bd33c1cbd021874ae))

## [2.1.0](https://github.com/imbytecat/voicepaste/compare/v2.0.1...v2.1.0) (2026-10-06)


### 新增

* **asr:** 接入豆包标点与个人词增强独立开关 ([1232a0d](https://github.com/imbytecat/voicepaste/commit/1232a0d720b9202cf6101f1804bd414da1c22726))
* **doubao:** 接入个人词库只读查看与本地搜索 ([7652a11](https://github.com/imbytecat/voicepaste/commit/7652a11429b71a8ea7f7949f03aa452960815680))
* **doubao:** 接入原生智能整理与独立后处理设置 ([9615118](https://github.com/imbytecat/voicepaste/commit/96151180c6651dd02bc249f05c9f47229af1be3f))
* **doubao:** 接入手工中译英与原文保留预览 ([0b18eb4](https://github.com/imbytecat/voicepaste/commit/0b18eb4fc22465992e4ad0d9a7882e25b8e35444))
* **doubao:** 接入账号常用语真实增改删与云端回读 ([a7b32f8](https://github.com/imbytecat/voicepaste/commit/a7b32f8c79999e222703560fd6b18c494aad43b1))
* **doubao:** 补齐中英双向翻译与原生方向选择 ([2266fee](https://github.com/imbytecat/voicepaste/commit/2266feec6cc810f957a9b4bf07283d7aa1fa6940))
* **tools:** 增加手工文本智能整理预览 ([da19e97](https://github.com/imbytecat/voicepaste/commit/da19e970fdc91d151477182e2bb900f17d8bf51d))
* **tools:** 接入官方要点提取与列表整理 ([ce949d9](https://github.com/imbytecat/voicepaste/commit/ce949d91c1fd0c1e7134b53131b4f53dea073080))
* **tools:** 接入豆包官方总结与重写 ([3022757](https://github.com/imbytecat/voicepaste/commit/3022757881cac1e7c2dadd9284b677fb06fdf244))
* **tools:** 支持取消翻译并阻止晚到结果覆盖 ([c2ff9fd](https://github.com/imbytecat/voicepaste/commit/c2ff9fd2b2a3463048be33816d06e472f3e31670))
* **tools:** 支持显式复制译文与账号常用语 ([f8f32fc](https://github.com/imbytecat/voicepaste/commit/f8f32fc7f5373504f6461391763eacff285e1b6c))


### 修复

* **doubao:** 保留常用语失败草稿并区分个人词库说明 ([ee7e0c5](https://github.com/imbytecat/voicepaste/commit/ee7e0c574d9b9782a6753be9851be02934de648e))
* **doubao:** 避免翻译等待阻塞听写与账号操作 ([3600534](https://github.com/imbytecat/voicepaste/commit/3600534a5a6aebe468546a6558998d6bfa8d5137))

## [2.0.1](https://github.com/imbytecat/voicepaste/compare/v2.0.0...v2.0.1) (2026-10-05)


### 修复

* **settings:** 保留旧设置并修复公开版本升级启动失败 ([be62389](https://github.com/imbytecat/voicepaste/commit/be623898747cf1d5900c6f8a5424f58786aaf023))

## [2.0.0](https://github.com/imbytecat/voicepaste/compare/v1.5.0...v2.0.0) (2026-10-05)


### ⚠ BREAKING CHANGES

* **recognition:** 仅支持当前配置与账号会话结构，不迁移旧格式；旧数据需备份后重新配置

### 新增

* **recognition:** 接入豆包语音并隔离识别渠道 ([75f79af](https://github.com/imbytecat/voicepaste/commit/75f79af8121968af9a46f90e06fd11dc42bcdd34))


### 修复

* **deps:** 升级依赖并修复 Nix 图形环境兼容性 ([5aad40c](https://github.com/imbytecat/voicepaste/commit/5aad40c0e09b8d276e4c8c1c559a3c6042b81908))
* **linux:** 回补 GLib 内存安全修复并更新词库验收 ([ebb09f1](https://github.com/imbytecat/voicepaste/commit/ebb09f1adef662ca9637854469facc4778e1377f))
* **paste:** 隔离 X11 与门户输入后端并补齐真实验收 ([af69fd0](https://github.com/imbytecat/voicepaste/commit/af69fd0e65f91b23303567f1d4fe44ded67f11f1))
* **windows:** 为测试和应用统一嵌入公共控件清单 ([290fa47](https://github.com/imbytecat/voicepaste/commit/290fa4728071c6f5a76cc2f9404eda4e2e556a86))

## [1.5.0](https://github.com/imbytecat/voicepaste/compare/v1.4.3...v1.5.0) (2026-08-11)


### 新增

* **ui:** 统一全局动效与展开体验 ([329b694](https://github.com/imbytecat/voicepaste/commit/329b694585214cf79249ecbef0276dcfbe9305d8))
* **ui:** 重塑设置体验与词库同步 ([30da894](https://github.com/imbytecat/voicepaste/commit/30da8949defa1c0b716f33d40bd76af517a0a4d9))
* **ui:** 重构设置界面并统一品牌图标 ([8903106](https://github.com/imbytecat/voicepaste/commit/890310676813cfe15ea90766710b2d91efbac9c9))

## [1.4.3](https://github.com/imbytecat/voicepaste/compare/v1.4.2...v1.4.3) (2026-08-11)


### 修复

* **release:** 规范发布流程 ([c5d9f9a](https://github.com/imbytecat/voicepaste/commit/c5d9f9a65dbf1c45de338b1323ead6d148d6a2e6))
