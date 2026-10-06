import { Link } from "@tanstack/react-router";
import {
  AudioLines,
  BookText,
  Info,
  Keyboard,
  ShieldCheck,
  SlidersHorizontal,
  WandSparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { Toaster, toast } from "sonner";

import {
  SETTINGS_TOAST_ID,
  SettingsContext,
  TRANSIENT_MESSAGE_DURATION,
  useSettingsController,
} from "@/components/settings/controller";
import type { SettingsController } from "@/components/settings/controller";
import { SettingsDialogs } from "@/components/settings/dialogs";
import { Feedback, IconTile } from "@/components/settings/kit";
import type { TileHue } from "@/components/settings/kit";
import { Onboarding } from "@/components/settings/Onboarding";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SETTINGS_PATHS } from "@/routes/-settings-navigation";
import type { SettingsSectionId } from "@/routes/-settings-navigation";

import appIconUrl from "../../../src-tauri/icons/app-icon.svg";

interface SectionMeta {
  label: string;
  subtitle: string;
  icon: LucideIcon;
  hue: TileHue;
}

const SECTIONS: Record<SettingsSectionId, SectionMeta> = {
  about: {
    hue: "graphite",
    icon: Info,
    label: "关于",
    subtitle: "版本、更新与支持",
  },
  diagnostics: {
    hue: "green",
    icon: ShieldCheck,
    label: "权限检查",
    subtitle: "确认听写所需的系统权限都已就绪",
  },
  dictionary: {
    hue: "amber",
    icon: BookText,
    label: "词库",
    subtitle: "让人名、术语和专有名词识别得更准",
  },
  general: {
    hue: "graphite",
    icon: SlidersHorizontal,
    label: "通用",
    subtitle: "启动与窗口行为",
  },
  processing: {
    hue: "violet",
    icon: WandSparkles,
    label: "文本处理",
    subtitle: "识别完成后自动润色或改写",
  },
  recognition: {
    hue: "blue",
    icon: AudioLines,
    label: "识别服务",
    subtitle: "选择把语音转成文字的服务",
  },
  shortcut: {
    hue: "indigo",
    icon: Keyboard,
    label: "听写",
    subtitle: "快捷键、麦克风与悬浮窗",
  },
};
const PRIMARY_SECTIONS: SettingsSectionId[] = [
  "shortcut",
  "recognition",
  "dictionary",
  "processing",
];
const SECONDARY_SECTIONS: SettingsSectionId[] = [
  "general",
  "diagnostics",
  "about",
];

export function Settings({
  activeSection,
  children,
  onSelectSection,
  previewOnboarding = false,
}: {
  activeSection: SettingsSectionId;
  children?: ReactNode;
  onSelectSection: (section: SettingsSectionId) => void;
  previewOnboarding?: boolean;
}) {
  const controller = useSettingsController({
    activeSection,
    onSelectSection,
    previewOnboarding,
  });

  return (
    // oxlint-disable-next-line react/jsx-no-constructed-context-values -- pages must observe every controller render
    <SettingsContext.Provider value={controller}>
      <TooltipProvider delay={400}>
        <Toaster
          position="bottom-right"
          offset={{ bottom: 28, right: 28 }}
          duration={TRANSIENT_MESSAGE_DURATION}
          visibleToasts={1}
          expand={false}
          containerAriaLabel="设置反馈"
          toastOptions={{
            className: "font-sans text-[13px] rounded-2xl!",
            style: {
              backdropFilter: "blur(28px) saturate(1.8)",
              background: "rgb(255 255 255 / 0.78)",
              border: "0",
              boxShadow:
                "inset 0 1px 0 rgb(255 255 255 / 0.95), 0 0 0 1px rgb(30 34 70 / 0.07), 0 16px 40px -14px rgb(40 46 110 / 0.35)",
            },
          }}
        />
        <SettingsDialogs />
        {controller.loading ? (
          <main
            className="vp-ambient grid h-screen w-screen place-items-center"
            aria-busy="true"
          >
            <img
              src={appIconUrl}
              alt="正在读取设置"
              className="size-12 animate-pulse rounded-[13px] opacity-80"
              draggable={false}
            />
          </main>
        ) : controller.settings.onboardingCompleted ? (
          <SettingsShell controller={controller}>{children}</SettingsShell>
        ) : (
          <Onboarding />
        )}
      </TooltipProvider>
    </SettingsContext.Provider>
  );
}

function NavItem({ id, changed }: { id: SettingsSectionId; changed: boolean }) {
  const { hue, icon, label } = SECTIONS[id];
  return (
    <Link
      activeOptions={{ exact: true }}
      activeProps={{ className: "vp-glass-strong text-foreground" }}
      inactiveProps={{
        className: "text-foreground/70 hover:bg-white/45 hover:text-foreground",
      }}
      className="vp-motion-fast flex h-9 items-center gap-2.5 rounded-[11px] pr-2.5 pl-1.5 text-[13px] font-medium transition-[background-color,color] outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
      to={SETTINGS_PATHS[id]}
      onClick={() => {
        toast.dismiss(SETTINGS_TOAST_ID);
      }}
    >
      {({ isActive }) => (
        <>
          <IconTile icon={icon} hue={hue} size="sm" filled={isActive} />
          <span className="truncate">{label}</span>
          {changed ? (
            <span
              className="vp-state-pop ml-auto size-1.5 shrink-0 rounded-full bg-brand shadow-[0_0_6px_rgb(79_95_230/0.7)]"
              role="img"
              aria-label="有未保存的修改"
            />
          ) : null}
        </>
      )}
    </Link>
  );
}

function SettingsShell({
  controller,
  children,
}: {
  controller: SettingsController;
  children: ReactNode;
}) {
  const {
    activeSection,
    discardChanges,
    hasUnsavedSettings,
    isSectionChanged,
    message,
    recognitionPreviewBusy,
    recognitionService,
    save,
    saving,
  } = controller;
  const saveBlocked =
    saving ||
    recognitionService.testing ||
    recognitionService.accountBusy ||
    recognitionPreviewBusy;
  const section = SECTIONS[activeSection];
  const [scrolled, setScrolled] = useState(false);

  return (
    <div className="vp-ambient grid h-screen w-screen grid-cols-[208px_minmax(0,1fr)] overflow-hidden text-foreground">
      <aside className="flex min-h-0 flex-col px-3 pt-4 pb-3">
        <div className="flex items-center gap-2.5 px-2 pb-6">
          <img
            src={appIconUrl}
            alt=""
            aria-hidden="true"
            className="size-7 rounded-[8px] shadow-[0_4px_10px_-2px_rgb(21_23_40/0.35)]"
            draggable={false}
          />
          <span className="text-[15px] font-semibold tracking-[-0.015em]">
            VoicePaste
          </span>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5" aria-label="设置分类">
          {PRIMARY_SECTIONS.map((id) => (
            <NavItem key={id} id={id} changed={isSectionChanged(id)} />
          ))}
          <div className="mt-auto flex flex-col gap-0.5 pt-3">
            {SECONDARY_SECTIONS.map((id) => (
              <NavItem key={id} id={id} changed={isSectionChanged(id)} />
            ))}
          </div>
        </nav>
      </aside>

      <div className="flex min-h-0 min-w-0 py-2.5 pr-2.5">
        <main className="vp-glass relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[22px]">
          <div
            aria-hidden="true"
            className={`vp-glass-float pointer-events-none absolute inset-x-0 top-0 z-10 flex h-11 items-center justify-center rounded-t-[22px] text-[13px] font-semibold shadow-[inset_0_-1px_0_rgb(30_34_70/0.07)] transition-opacity duration-200 ${
              scrolled ? "opacity-100" : "opacity-0"
            }`}
          >
            {section.label}
          </div>
          <div
            className="vp-stable-scroll min-h-0 flex-1 overflow-auto"
            data-scroll-restoration-id="settings-content"
            onScroll={(event) => {
              setScrolled(event.currentTarget.scrollTop > 64);
            }}
          >
            {/*
              No per-page entrance motion: rapid sidebar clicks restart it, and
              any restart (opacity or offset) reads as flicker or jitter.
              Pages swap instantly, like native settings apps.
            */}
            <div className="mx-auto max-w-160 px-8 pt-10 pb-28">
              <header className="flex items-center gap-3.5 px-1">
                <IconTile
                  icon={section.icon}
                  hue={section.hue}
                  size="lg"
                  filled
                />
                <div className="min-w-0">
                  <h1 className="text-[24px] leading-8 font-semibold tracking-[-0.03em]">
                    {section.label}
                  </h1>
                  <p className="truncate text-[13px] text-muted-foreground">
                    {section.subtitle}
                  </p>
                </div>
              </header>
              <Feedback
                message={message?.kind === "error" ? message : null}
                className="mt-5"
              />
              <fieldset
                className="m-0 mt-8 min-w-0 space-y-8 border-0 p-0"
                disabled={saving}
              >
                {children}
              </fieldset>
            </div>
          </div>

          {hasUnsavedSettings ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center px-4">
              <section
                aria-label="未保存的修改"
                className="vp-glass-dark pointer-events-auto flex animate-in items-center gap-1 rounded-full py-1.5 pr-1.5 pl-5 text-overlay-foreground duration-300 ease-(--vp-ease-spring) fade-in slide-in-from-bottom-3"
              >
                <span className="mr-3 flex items-center gap-2 text-[13px]">
                  <span
                    className="size-1.5 rounded-full bg-[#9aa5ff] shadow-[0_0_8px_rgb(154_165_255/0.9)]"
                    aria-hidden="true"
                  />
                  有未保存的修改
                </span>
                <Button
                  variant="ghost"
                  className="rounded-full text-overlay-muted hover:bg-white/10 hover:text-overlay-foreground"
                  type="button"
                  disabled={saveBlocked}
                  onClick={discardChanges}
                >
                  撤销
                </Button>
                <Button
                  className="rounded-full px-4"
                  type="button"
                  disabled={saveBlocked}
                  onClick={() => void save()}
                >
                  {saving ? "保存中…" : "保存"}
                </Button>
              </section>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
