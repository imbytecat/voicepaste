# TanStack Router × Vite × Tauri v2 调研

调查基线：`@tanstack/react-router ^1.170.23`、Vite `^8.2.1`、Tauri CLI `^2.11.0`。实施后新增 `@tanstack/router-plugin ^1.168.27` 与 `@tanstack/router-cli ^1.167.25`（见 [`package.json`](../package.json)）。资料访问：2026-08-09。以下“官方”仅指 TanStack/Tauri 官方文档；“工程推断”明确标注。

## 结论速览

- **文件路由：官方支持且 Vite 集成页明确推荐的集成路径**。TanStack 的 Vite 安装页要求安装 `@tanstack/router-plugin`，并以 `tanstackRouter({ target: 'react', autoCodeSplitting: true })` 接入文件路由。[官方：Installation with Vite](https://tanstack.com/router/latest/docs/installation/with-vite)
- **Vite 插件：调研时未使用，本次迁移后已使用。** `vite.config.ts` 现已在 `react()` 之前注册 `tanstackRouter({ target: 'react', autoCodeSplitting: true })`。
- **HashHistory：适合当前 Tauri 静态资源模型。** TanStack 官方说明 Hash routing 适用于服务器不支持将请求重写到 `index.html` 的环境；Tauri 官方说明前端本质是由 WebView 托管的静态 HTML/CSS/JS，推荐 SPA，且不原生支持 SSR。因此保留 `createHashHistory()` 是稳妥选择。[TanStack History Types](https://tanstack.com/router/latest/docs/guide/history-types) · [Tauri Frontend Configuration](https://v2.tauri.app/start/frontend/)
- **实施后已达到 TanStack 官方 Vite 文件路由推荐形态。** 路由位于 `src/routes`，插件生成 `src/routeTree.gen.ts`，并启用自动代码拆分。

## 官方推荐集成拆解

### 1. 文件路由与插件

TanStack 官方 Vite 文档说：使用 Vite 的 file-based routing 需安装 `@tanstack/router-plugin`；React 配置示例为：

```ts
import { tanstackRouter } from "@tanstack/router-plugin/vite";

export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
  ],
});
```

**插件顺序是硬性要求：** 官方原文要求 `@tanstack/router-plugin` 放在 `@vitejs/plugin-react` 之前。Tailwind 插件没有被该文档规定相对顺序；工程上保留现有 `tailwindcss()`，把 TanStack 插件放到 `react()` 前即可。

文件路由的默认配置是 `routesDirectory: './src/routes'`、`generatedRouteTree: './src/routeTree.gen.ts'`、`routeFileIgnorePrefix: '-'`、`quoteStyle: 'single'`。文件命名映射 URL（如 `posts.tsx`、`posts.route.tsx`、`posts/route.tsx` 可表示 `/posts`）。[官方：File-Based Routing API](https://tanstack.com/router/latest/docs/api/file-based-routing)

### 2. 自动代码拆分

官方自动拆分指南要求在 bundler plugin 配置中设 `autoCodeSplitting: true`。插件在开发和构建时把 route properties（如 `component`、`pendingComponent`、`loader`）转换为懒加载/虚拟文件，从而按路由按需加载；默认 split groupings 是 `component`、`errorComponent`、`notFoundComponent` 各自拆分。官方还警告：除非有特定理由，不要把 `loader` 拆到独立 chunk，因为会增加渲染前一次加载往返。[官方：Automatic Code Splitting](https://tanstack.com/router/latest/docs/guide/automatic-code-splitting)

工程推断：VoicePaste 当前设置页和 onboarding 体量有限，自动拆分收益可能很小；若迁移文件路由，启用它仍是官方示例默认值，但不应为“拆分”单独重构组件。

### 3. `routeTree.gen.ts` 管理

官方说明生成树由 TanStack Router 管理，不应由 formatter/linter 修改；建议忽略它。默认生成路径是 `./src/routeTree.gen.ts`，默认 `autoCodeSplitting` 为 `false`（下一大版本计划改为 `true`）。官方还建议 VS Code 将其设为只读，并从 watcher/search 排除。[Vite 安装页](https://tanstack.com/router/latest/docs/installation/with-vite) · [File-Based Routing API](https://tanstack.com/router/latest/docs/api/file-based-routing)

**建议：** 将 `routeTree.gen.ts` 作为生成产物提交与否，官方页面没有给出必须的 Git 策略；工程推断是保留在源码树中并交由插件持续生成，禁止手改，CI/开发环境确保插件运行。不要把它当业务源码维护。

### 4. Agent / CI 显式生成

TanStack 提供公开 CLI 命令 `tsr generate` 和 `tsr watch`；官方同时提醒：使用受支持 bundler 时应优先使用 bundler 插件，因为 CLI 只负责生成路由树，不提供自动代码拆分。[官方：Installation with Router CLI](https://tanstack.com/router/latest/docs/installation/with-router-cli)

本项目保留 Vite 插件作为主集成，并额外提供 `pnpm routes:generate` 调用一次性 `tsr generate`，供 Agent、CI 和 `tsc` 前确定性刷新 `routeTree.gen.ts`。这是工程折中，不是官方主推荐：它替代通过 `resolveConfig(...); process.exit(0)` 触发 Vite 插件副作用的脚本，同时仍由 Vite 插件负责开发监听与自动拆分。

## Tauri v2 的资源、URL 与窗口边界

Tauri 官方前端配置将 Tauri 描述为静态 Web host：提供包含 HTML/CSS/JavaScript（可选 WASM）的目录；支持 SPA/SSG/MPA，不原生支持 SSR。Tauri 的 Vite 指南要求 `frontendDist` 指向 Vite 输出目录、开发 URL 指向 Vite server，并用 `beforeDevCommand`/`beforeBuildCommand` 驱动脚本。[Frontend Configuration](https://v2.tauri.app/start/frontend/) · [Vite](https://v2.tauri.app/start/frontend/vite/)

当前 `src-tauri/tauri.conf.json` 已是官方 Vite 形态：`devUrl: http://localhost:1420`、`frontendDist: ../dist`、`beforeDevCommand: pnpm dev`、`beforeBuildCommand: pnpm build`。这与 `vite.config.ts` 的端口/strictPort 对齐。

### HashHistory 是否适合

官方只明确说 Hash routing 在服务器无法 rewrite 到 `index.html` 时有帮助；Tauri 页面只保证静态资源 WebView 托管，并未要求某一种 Router history。**官方事实：** HashHistory 避免深链接被静态资源宿主当作文件路径处理。**工程推断：** 对嵌入式 Tauri 资源，hash 是低风险默认值；它让 `/settings/general` 出现在 `#/settings/general`，无需额外 deep-link/rewrite 配置。若将来需要无 hash 的可复制 URL，可改 BrowserHistory，但必须验证 Tauri 生产 WebView 对深路径回退到 `index.html` 的行为，并处理启动深链接；这不是当前验收所需修改。

### 原生多窗口 vs 前端 Router

当前 Tauri 配置声明两个原生窗口：`settings` 与 `overlay`，分别有尺寸、可见性、透明/置顶等窗口级属性。Tauri 官方窗口 API以唯一 label 管理多个窗口，并提供窗口创建/查找/事件通信；能力配置也按窗口/webview label 授权。[Tauri Window API](https://v2.tauri.app/reference/javascript/api/namespacewindow/) · [Capabilities](https://v2.tauri.app/reference/acl/capability/)

**职责边界（工程推断，基于上述 API 模型）：**

- Tauri 原生窗口负责进程级窗口生命周期、位置尺寸、透明、置顶、权限边界和跨窗口 IPC。
- TanStack Router 负责单个 WebView 内的 URL、页面状态、组件树和导航；它不应替代 Tauri 的 `settings`/`overlay` 窗口。
- 因此 settings WebView 的 `/settings/*` 页面路由与 overlay WebView 的单用途入口可以分开处理；跨窗口显示/隐藏、识别事件仍由 Tauri window API/事件完成。

## 审计与实施结果

### 迁移前差距

1. 未安装或注册 `@tanstack/router-plugin`。
2. `src/router.tsx` 手工 `createRoute`/`addChildren` 建树。
3. 没有 `src/routes`、`routeTree.gen.ts` 或自动代码拆分。
4. 不能通过公开的一次性命令确定性刷新路由树。

### 本次已实施

1. 安装 `@tanstack/router-plugin`，并在 `react()` 之前注册 `tanstackRouter({ target: 'react', autoCodeSplitting: true })`。
2. 迁移到 `src/routes` 文件路由；设置页使用父布局与静态子路由，切换页面不会卸载设置状态。
3. `src/router.tsx` 只负责导入生成树、创建 `createHashHistory()` 和注册 Router 类型。
4. 生成 `src/routeTree.gen.ts`，并从 Oxlint/Oxfmt 排除，禁止手改。
5. 添加 `pnpm routes:generate`（`tsr generate`）；构建先显式生成，再执行 Vite 构建和 TypeScript 检查。
6. 保留 Tauri `settings`/`overlay` 原生窗口 label 分工；Router 只管理 settings WebView 内页面。

### 最终判断

当前实现已达到 TanStack 官方的 Vite 文件路由、生成树和自动代码拆分形态；HashHistory 与 Tauri 静态 WebView 匹配。额外 CLI 只用于 Agent/CI 的确定性单次生成，Vite 插件仍是主集成。

## 一手来源索引

- [TanStack Router：Installation with Vite](https://tanstack.com/router/latest/docs/installation/with-vite)
- [TanStack Router：File-Based Routing API](https://tanstack.com/router/latest/docs/api/file-based-routing)
- [TanStack Router：Automatic Code Splitting](https://tanstack.com/router/latest/docs/guide/automatic-code-splitting)
- [TanStack Router：History Types](https://tanstack.com/router/latest/docs/guide/history-types)
- [Tauri v2：Frontend Configuration](https://v2.tauri.app/start/frontend/)
- [Tauri v2：Vite](https://v2.tauri.app/start/frontend/vite/)
- [Tauri v2：Window JavaScript API](https://v2.tauri.app/reference/javascript/api/namespacewindow/)
- [Tauri v2：Capabilities](https://v2.tauri.app/reference/acl/capability/)
