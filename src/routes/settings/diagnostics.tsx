import { createFileRoute } from "@tanstack/react-router";

import { DiagnosticsSettingsPage } from "@/components/Settings";

export const Route = createFileRoute("/settings/diagnostics")({
  component: DiagnosticsSettingsPage,
});
