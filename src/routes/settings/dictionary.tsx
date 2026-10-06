import { createFileRoute } from "@tanstack/react-router";

import { DictionaryPage } from "@/components/settings/pages/DictionaryPage";

export const Route = createFileRoute("/settings/dictionary")({
  component: DictionaryPage,
});
