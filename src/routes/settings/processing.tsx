import { createFileRoute } from "@tanstack/react-router";

import { ProcessingSettingsPage } from "@/components/Settings";

export const Route = createFileRoute("/settings/processing")({
  component: ProcessingSettingsPage,
});
