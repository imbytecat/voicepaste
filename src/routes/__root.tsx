import { createRootRoute, Link, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: Outlet,
  notFoundComponent: NotFoundPage,
});

function NotFoundPage() {
  return (
    <main className="grid h-screen w-screen place-items-center bg-[#f6f7f9] px-6 text-[#202124]">
      <div className="max-w-sm text-center">
        <h1 className="text-lg font-semibold">页面不存在</h1>
        <p className="mt-2 text-xs leading-5 text-[#6f737b]">
          当前链接无效或页面已移动。
        </p>
        <Link
          className="mt-5 inline-flex h-9 items-center justify-center rounded-lg bg-[#6558e8] px-4 text-xs font-medium text-white transition hover:bg-[#584bcf] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#7564e8]"
          to="/settings/general"
        >
          返回设置
        </Link>
      </div>
    </main>
  );
}
