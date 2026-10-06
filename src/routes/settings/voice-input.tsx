import { createFileRoute } from "@tanstack/react-router";

import { VoiceInputPage } from "@/components/settings/pages/VoiceInputPage";

export const Route = createFileRoute("/settings/voice-input")({
  component: VoiceInputPage,
});
