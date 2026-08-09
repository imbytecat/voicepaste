import {
  createHashHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";

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
  return <RouterProvider router={router} />;
}
