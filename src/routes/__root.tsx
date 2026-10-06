import { createRootRoute, Link, Outlet } from "@tanstack/react-router";

import { buttonVariants } from "@/components/ui/button";

export const Route = createRootRoute({
  component: Outlet,
  notFoundComponent: NotFoundPage,
});

function NotFoundPage() {
  return (
    <main className="grid min-h-dvh w-screen place-items-center bg-background px-6 text-foreground">
      <section className="vp-section-enter w-full max-w-sm text-center">
        <p className="font-mono text-[12px] text-muted-foreground">404</p>
        <h1 className="mt-2 text-[22px] font-semibold tracking-[-0.02em]">
          页面不存在
        </h1>
        <p className="mt-2 text-[13px] text-muted-foreground">
          链接无效或页面已移动。
        </p>
        <Link
          className={buttonVariants({ className: "mt-6" })}
          to="/settings/voice-input"
        >
          返回设置
        </Link>
      </section>
    </main>
  );
}
