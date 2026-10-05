import { createFileRoute } from "@tanstack/react-router";

import { DictionarySettingsPage } from "@/components/Settings";

export const Route = createFileRoute("/settings/dictionary")({
  component: DictionarySettingsPage,
});
