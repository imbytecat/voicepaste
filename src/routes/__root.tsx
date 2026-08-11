import { createRootRoute, Link, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: Outlet,
  notFoundComponent: NotFoundPage,
});

function NotFoundPage() {
  return (
    <main className="vp-app-frame grid min-h-dvh w-screen place-items-center px-6 text-foreground">
      <section className="vp-enter w-full max-w-sm rounded-[20px] bg-card p-8 ring-1 ring-foreground/8">
        <p className="font-mono text-[11px] font-semibold tracking-[0.08em] text-primary">
          404
        </p>
        <h1 className="mt-3 text-[28px] leading-8 font-semibold tracking-[-0.045em]">
          页面不存在
        </h1>
        <p className="mt-3 text-[13px] leading-6 text-muted-foreground">
          当前链接无效或页面已移动。
        </p>
        <Link
          className="mt-6 inline-flex h-10 items-center justify-center rounded-[10px] bg-primary px-4 text-[12px] font-semibold text-primary-foreground shadow-[0_8px_20px_rgba(79,96,220,0.2)] transition-[transform,background-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-[#4658d8] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.98]"
          to="/settings/voice-input"
        >
          返回设置
        </Link>
      </section>
    </main>
  );
}
