import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";

import { Settings } from "../components/Settings";
import type { SettingsSectionId } from "../components/Settings";
import { SETTINGS_PATHS } from "./-settings-navigation";

export const Route = createFileRoute("/onboarding")({
  component: OnboardingPreview,
});

function OnboardingPreview() {
  const navigate = Route.useNavigate();
  const selectSection = useCallback(
    (section: SettingsSectionId) => {
      void navigate({ to: SETTINGS_PATHS[section] });
    },
    [navigate]
  );

  return (
    <Settings
      activeSection="general"
      onSelectSection={selectSection}
      previewOnboarding
    />
  );
}
