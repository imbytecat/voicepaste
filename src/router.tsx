import { QueryClientProvider } from "@tanstack/react-query";
import {
  createHashHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";

import { queryClient } from "@/components/settings/queries";

import { routeTree } from "./routeTree.gen";

const router = createRouter({
  defaultPreload: "intent",
  history: createHashHistory(),
  routeTree,
  scrollRestoration: true,
  scrollToTopSelectors: ['[data-scroll-restoration-id="settings-content"]'],
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export function SettingsRouter() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
