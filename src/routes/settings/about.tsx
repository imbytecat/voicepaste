import { createFileRoute } from "@tanstack/react-router";

import { AboutPage } from "@/components/settings/pages/AboutPage";

export const Route = createFileRoute("/settings/about")({
  component: AboutPage,
});
