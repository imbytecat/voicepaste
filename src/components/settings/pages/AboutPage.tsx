import { isTauri } from "@tauri-apps/api/core";
import {
  ArrowUpRight,
  Copy,
  Download,
  FolderOpen,
  RefreshCw,
} from "lucide-react";

import { useSettings } from "@/components/settings/controller";
import { Group, Row } from "@/components/settings/kit";
import { Button } from "@/components/ui/button";

import appIconUrl from "../../../../src-tauri/icons/app-icon.svg";

const LINKS = [
  ["homepage", "项目主页"],
  ["help", "帮助与反馈"],
  ["privacy", "隐私说明"],
] as const;

export function AboutPage() {
  const {
    checkForUpdate,
    checkingUpdate,
    diagnostics,
    installUpdate,
    installingUpdate,
    openProductLink,
    runAboutAction,
    updateInfo,
  } = useSettings();

  return (
    <>
      <section className="vp-glass-strong overflow-hidden rounded-[22px] px-6 pt-8 pb-6 text-center">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -top-24 h-56 bg-[radial-gradient(closest-side,rgb(79_95_230/0.16),transparent)]"
        />
        <img
          src={appIconUrl}
          alt=""
          aria-hidden="true"
          className="relative mx-auto size-16 rounded-[18px] shadow-[0_10px_30px_-8px_rgb(21_23_40/0.45)]"
          draggable={false}
        />
        <p className="relative mt-4 text-[18px] font-semibold tracking-[-0.02em]">
          VoicePaste
        </p>
        <p className="relative mt-1 text-[13px] text-muted-foreground tabular-nums">
          {diagnostics
            ? `版本 ${diagnostics.appVersion}`
            : isTauri()
              ? "版本未知"
              : "浏览器预览"}
          {updateInfo ? (
            <span className="font-medium text-primary">
              {" "}
              · 新版本 {updateInfo.version} 可用
            </span>
          ) : null}
        </p>
        <div className="relative mt-5 flex justify-center">
          {updateInfo ? (
            <Button
              size="lg"
              type="button"
              onClick={() => void installUpdate()}
              disabled={installingUpdate}
            >
              <Download />
              {installingUpdate ? "正在安装…" : "安装并重启"}
            </Button>
          ) : (
            <Button
              variant="outline"
              type="button"
              onClick={() => void checkForUpdate()}
              disabled={checkingUpdate}
            >
              <RefreshCw
                className={checkingUpdate ? "animate-spin" : undefined}
              />
              {checkingUpdate ? "检查中…" : "检查更新"}
            </Button>
          )}
        </div>
      </section>

      <Group title="排查问题">
        <Row
          title="日志"
          description={
            diagnostics?.logDir ? (
              <span className="font-mono text-[11px]">
                {diagnostics.logDir}
              </span>
            ) : undefined
          }
        >
          <Button
            variant="outline"
            type="button"
            onClick={() => void runAboutAction("open_log_dir")}
          >
            <FolderOpen /> 打开
          </Button>
        </Row>
        <Row
          title="诊断信息"
          description="版本、快捷键与系统信息，不含任何密钥"
        >
          <Button
            variant="outline"
            type="button"
            onClick={() =>
              void runAboutAction("copy_diagnostics", "诊断信息已复制")
            }
          >
            <Copy /> 复制
          </Button>
        </Row>
      </Group>

      <Group>
        {LINKS.map(([target, label]) => (
          <button
            key={target}
            type="button"
            className="vp-motion-fast flex h-11 w-full items-center justify-between px-4 text-left text-[13px] font-medium transition-colors outline-none hover:bg-white/60 focus-visible:bg-white/60"
            onClick={() => void openProductLink(target)}
          >
            {label}
            <ArrowUpRight
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
          </button>
        ))}
      </Group>
    </>
  );
}
