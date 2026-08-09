import {
  createFileRoute,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { useCallback } from "react";

import { Settings } from "@/components/Settings";
import {
  SETTINGS_PATHS,
  settingsSectionFromPath,
} from "@/routes/-settings-navigation";
import type { SettingsSectionId } from "@/routes/-settings-navigation";

export const Route = createFileRoute("/settings")({ component: SettingsRoute });

function SettingsRoute() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
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
