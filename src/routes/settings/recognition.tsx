import { createFileRoute } from "@tanstack/react-router";

import { RecognitionSettingsPage } from "@/components/Settings";

export const Route = createFileRoute("/settings/recognition")({
  component: RecognitionSettingsPage,
});
