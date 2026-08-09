import { createFileRoute } from "@tanstack/react-router";

import { AboutSettingsPage } from "@/components/Settings";

export const Route = createFileRoute("/settings/about")({
  component: AboutSettingsPage,
});
