import {
  createFileRoute,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { useCallback } from "react";

import { Settings } from "@/components/settings/SettingsLayout";
import {
  SETTINGS_PATHS,
  settingsSectionFromPath,
} from "@/routes/-settings-navigation";
import type { SettingsSectionId } from "@/routes/-settings-navigation";

export const Route = createFileRoute("/settings")({ component: SettingsRoute });

function SettingsRoute() {
  // The resolved location changes in the same commit as <Outlet />'s content;
  // `location` changes first, which re-keyed the page animation on stale content.
  const pathname = useRouterState({
    select: (state) => (state.resolvedLocation ?? state.location).pathname,
  });
  const navigate = Route.useNavigate();
  const activeSection = settingsSectionFromPath(pathname);
  const selectSection = useCallback(
    (section: SettingsSectionId) => {
      void navigate({ to: SETTINGS_PATHS[section] });
    },
    [navigate]
  );

  return (
    <Settings activeSection={activeSection} onSelectSection={selectSection}>
      <Outlet />
    </Settings>
  );
}
