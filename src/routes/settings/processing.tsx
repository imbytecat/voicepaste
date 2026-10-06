import { createFileRoute } from "@tanstack/react-router";

import { ProcessingPage } from "@/components/settings/pages/ProcessingPage";

export const Route = createFileRoute("/settings/processing")({
  component: ProcessingPage,
});
