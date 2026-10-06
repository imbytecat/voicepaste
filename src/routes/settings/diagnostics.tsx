import { createFileRoute } from "@tanstack/react-router";

import { DiagnosticsPage } from "@/components/settings/pages/DiagnosticsPage";

export const Route = createFileRoute("/settings/diagnostics")({
  component: DiagnosticsPage,
});
