# TanStack Router × Tauri 审计（2026-08-09）

## 范围

审计对象：`package.json`、`vite.config.ts`、`tsconfig.json`、`src/router.tsx`、`src/routes/**`、`src/components/Settings.tsx`。基线版本为 `@tanstack/react-router 1.170.23`、`@tanstack/router-plugin 1.168.27`、Vite `8.2.1`、Tauri `2.11.x`。

一手来源：

- [Vite 集成](https://tanstack.com/router/latest/docs/installation/with-vite)
- [文件命名](https://tanstack.com/router/latest/docs/routing/file-naming-conventions)
- [Outlet](https://tanstack.com/router/latest/docs/guide/outlets)
- [导航与 Link](https://tanstack.com/router/latest/docs/guide/navigation)
- [预加载](https://tanstack.com/router/latest/docs/guide/preloading)
- [Not-found](https://tanstack.com/router/latest/docs/guide/not-found-errors)
- [错误处理](https://tanstack.com/router/latest/docs/guide/error-handling)
- [数据加载](https://tanstack.com/router/latest/docs/guide/data-loading)
- [Search params](https://tanstack.com/router/latest/docs/guide/search-params)
- [Route context](https://tanstack.com/router/latest/docs/framework/react/guide/router-context)
- [自动代码拆分](https://tanstack.com/router/latest/docs/guide/automatic-code-splitting)
- [滚动恢复](https://tanstack.com/router/latest/docs/framework/react/guide/scroll-restoration)
- [Tauri 前端配置](https://v2.tauri.app/start/frontend/)

## 已修复

### 路由布局与导航

- `/settings` 是父布局路由，设置壳层包裹 `<Outlet />`；`settings/*.tsx` 是静态子路由。符合文件路由和嵌套路由约定。
- 设置侧栏改用类型安全 `<Link>`，由 Router 提供激活态、`aria-current`、URL 语义和 intent preload。程序事件及引导完成后的跳转继续使用 `Route.useNavigate()`；两种方式均为官方支持路径。
- `defaultPreload: "intent"` 保留。改用 Link 后，hover/touch intent 预加载才真正覆盖侧栏导航。

### 未知路径

- `/` 和 `/settings/` 仍重定向到产品默认页 `/settings/general`。
- `/$` 不再把未知路径静默伪装成设置首页，而是抛出 `notFound()`。
- 根路由提供可理解的 `notFoundComponent` 和返回设置入口。

### 滚动

- Router 开启 `scrollRestoration`。
- 设置内容滚动容器使用稳定的 `data-scroll-restoration-id`，并列入 `scrollToTopSelectors`；子页面前进/返回可恢复位置，普通导航可回到顶部。

### Vite 与生成路由树

- `tanstackRouter({ target: "react", autoCodeSplitting: true })` 位于 React 插件之前。
- `routeTree.gen.ts` 继续作为生成文件使用，不手改。
- 删除冗余 `@tanstack/router-cli`、`routes:generate` 和构建前显式生成步骤。Vite 插件已在 `vite build` 中生成路由树，随后执行 `tsc`；CLI 仅在脱离支持的 bundler 时才需要。

## 版本结论

TanStack 各包的公开版本号并不共用同一 minor：审计当天最新版本分别为 React Router `1.170.24`、Router Plugin `1.168.28`、Router CLI `1.167.26`。因此“版本号必须相同”是错误规则。

真正约束是插件发布的 `peerDependencies`。当前 `@tanstack/router-plugin 1.168.27` 要求 `@tanstack/react-router ^1.170.22`，项目的 `1.170.23` 满足约束。无需为了数字一致做无意义升级。

## 当前合理保留

### HashHistory

Tauri 提供静态 WebView 前端，HashHistory 能避开宿主对深路径回退的要求。它是当前项目的保守工程选择，不是 Tauri 强制要求。未来若需要无 hash URL，必须先验证生产 WebView 深链接和 `index.html` 回退。

### 组件内设置状态

设置是可编辑表单、设备状态和 Tauri 命令的组合，不是可缓存的服务端 route data。当前无需把它强塞进 loader、search params 或 route context：

- loader：没有共享远端读取或基于 URL 的缓存需求。
- search params：没有需要复制、刷新后恢复的查询状态。
- route context：没有 Router 创建期依赖注入需求。
- pendingComponent：当前路由无 loader，组件已有真实初始化状态。

若以后把设置读取迁入 loader，再同时设计 `pendingComponent`、`errorComponent`、失效策略和保存后的重新验证；不要先加空壳。

### 自动代码拆分

插件已开启自动拆分，但子路由页面目前仍从共享 `Settings.tsx` 导入，父布局也依赖同一模块。工程上这会限制每个设置分区的独立 chunk 收益；它不是路由正确性问题。当前桌面设置页体量有限，先保留共享状态和实现 locality。只有构建分析证明首屏体积或加载时间有问题时，再把各分区视图移入独立模块。

## TypeScript 路径

- `tsconfig.json` 定义 `@/* -> ./src/*`。
- Vite 使用绝对 `resolve.alias` 对齐该映射。
- 跨目录源码导入使用 `@/…`；同目录 `./…` 和生成文件内相对导入保留。

## 当前无需增加

- TanStack Router Devtools：桌面生产功能不依赖它，需要路由调试时再临时加入开发环境。
- 全局自定义 `errorComponent`：Router 已有默认错误边界，当前无 loader；出现产品级恢复需求时再增加真实恢复操作。
- view transitions、route masking、SSR：当前 Tauri 单 WebView 设置应用没有对应需求。

## 验证

- `pnpm check` 通过：Ultracite、Vite production build、TypeScript 均成功。
- 浏览器实际访问 `/settings/general`、`voice-input`、`recognition`、`diagnostics`、`about`、`onboarding`。
- 侧栏渲染为带 hash `href` 的 Link；未知路径显示 not-found 并可返回设置。
- 设置滚动容器在普通导航后归零，浏览器返回时恢复原滚动位置。
