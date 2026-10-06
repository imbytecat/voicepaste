import { createFileRoute } from "@tanstack/react-router";

import { GeneralPage } from "@/components/settings/pages/GeneralPage";

export const Route = createFileRoute("/settings/general")({
  component: GeneralPage,
});
