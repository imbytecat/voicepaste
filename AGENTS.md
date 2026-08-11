# VoicePaste AI Agent Instructions

本文件是仓库内 AI coding agents 的唯一权威规则。工具专用入口文件只指向这里，不复制规则。

## 工作流程

1. 修改前读取实际调用链、相邻实现和相关测试；复用现有模式，不建立第二套约定。
2. 修复根因并完成干净迁移；删除失效的兼容层、别名、注释和旧路径。
3. 行为变更必须运行覆盖真实路径的验证。完整检查使用 `mise run check`。
4. UI 变更除构建外还要实际启动并操作对应界面；发布变更按 `PACKAGING.md` 验证。
5. 提交前保持工作树只包含本任务改动，不覆盖或回滚其他人的工作。

首次开发环境设置：

```bash
mise install
pnpm install
mise run hooks:install
```

## 提交信息：中文强制

提交标题和 Pull Request 标题必须使用 Conventional Commits，且摘要必须写中文。Release Please 会直接把提交摘要写入 `CHANGELOG.md` 和 GitHub Release；英文摘要会直接污染面向用户的发布说明。

格式：

```text
<type>(<scope>): <中文摘要>
```

规则：

- `type` 与可选 `scope` 使用小写 ASCII；摘要至少包含一个汉字。
- 标题不超过 72 个字符，不加句号。
- 需要正文时使用中文解释原因、风险和迁移方式；issue 编号、命令、API 名称和代码标识保持原样。
- `fix` 触发 patch，`feat` 触发 minor，`!` 或 `BREAKING CHANGE:` 触发 major。
- `docs`、`test`、`refactor`、`ci`、`build`、`chore` 不单独触发版本。
- 自动生成的 `chore(release): <version>`、Git merge 信息不受中文摘要限制。

正确：

```text
feat(settings): 增加模型自动发现
fix(release): 修复更新资产命名
ci: 跳过发布提交的重复检查
```

错误：

```text
feat(settings): add model discovery
fix: update release workflow
```

本地 `commit-msg` hook 会拒绝英文摘要。禁止使用 `--no-verify` 绕过；先修正提交信息或检查失败。

## 发布与版本

- 版本唯一入口是 Conventional Commits。不要手工修改 `version.txt`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 或 `.release-please-manifest.json` 中的版本。
- `CHANGELOG.md` 由 Release Please 生成；不要为迎合格式器手工重排生成内容。
- Release Please 是父 workflow，Release 是被调用的三平台构建 workflow；界面显示两层不代表重复构建。
- 资产命名、签名、updater target 和发布清单以 `PACKAGING.md` 为准。

## 工程边界

- 优先标准库、平台能力和已安装依赖；没有实际第二个用例时不新增抽象。
- 信任边界的输入验证、避免数据丢失的错误处理、安全措施和无障碍基础不能简化。
- 新依赖必须有现有工具无法合理覆盖的明确需求。
- 数据收集、网络请求或隐私行为变更时同步检查 `PRIVACY.md`。
