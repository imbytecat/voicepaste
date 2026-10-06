import { createFileRoute } from "@tanstack/react-router";

import { RecognitionPage } from "@/components/settings/pages/RecognitionPage";

export const Route = createFileRoute("/settings/recognition")({
  component: RecognitionPage,
});
