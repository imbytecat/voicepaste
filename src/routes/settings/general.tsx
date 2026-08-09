import { createFileRoute } from "@tanstack/react-router";

import { GeneralSettingsPage } from "@/components/Settings";

export const Route = createFileRoute("/settings/general")({
  component: GeneralSettingsPage,
});
