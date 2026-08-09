import { createFileRoute } from "@tanstack/react-router";

import { VoiceInputSettingsPage } from "@/components/Settings";

export const Route = createFileRoute("/settings/voice-input")({
  component: VoiceInputSettingsPage,
});
