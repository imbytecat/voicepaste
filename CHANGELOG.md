# Changelog

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
