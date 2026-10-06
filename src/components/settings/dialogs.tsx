import { useSettings } from "@/components/settings/controller";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { hotwordDiff } from "@/hotwords";

function WordDiff({ added, removed }: { added: string[]; removed: string[] }) {
  return (
    <dl className="max-h-48 space-y-2 overflow-auto rounded-lg bg-muted px-3 py-2.5 text-[12px] leading-4.5">
      <div>
        <dt className="font-medium text-foreground">新增 {added.length} 个</dt>
        <dd className="text-muted-foreground">{added.join("、") || "无"}</dd>
      </div>
      <div>
        <dt className="font-medium text-foreground">
          移除 {removed.length} 个
        </dt>
        <dd className="text-muted-foreground">{removed.join("、") || "无"}</dd>
      </div>
    </dl>
  );
}

const DIALOG_FOOTER = "flex flex-wrap justify-end gap-2 pt-1";

export function SettingsDialogs() {
  const {
    applyHotwords,
    cloudHotwords,
    hotwordConflict,
    hotwordConflictReturnFocusRef,
    pendingAction,
    pendingHotwordApply,
    performAction,
    resolveHotwordConflict,
    saving,
    setHotwordConflict,
    setPendingAction,
    setPendingHotwordApply,
  } = useSettings();

  if (pendingAction) {
    const verb = pendingAction === "close" ? "关闭" : "切换";
    return (
      <AlertDialog
        open
        onOpenChange={(open) => {
          if (!open && !saving) setPendingAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>保存修改后再{verb}？</AlertDialogTitle>
          <AlertDialogDescription>
            当前有未保存的设置。词库草稿只会存到本机，不会上传。
          </AlertDialogDescription>
          <div className={DIALOG_FOOTER}>
            <Button
              variant="ghost"
              className="mr-auto"
              disabled={saving}
              onClick={() => {
                setPendingAction(null);
              }}
            >
              取消
            </Button>
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => void performAction(pendingAction, false)}
            >
              不保存
            </Button>
            <Button
              disabled={saving}
              onClick={() => void performAction(pendingAction, true)}
            >
              保存并{verb}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  if (hotwordConflict) {
    const { onlyCloud, onlyLocal } = hotwordDiff(
      hotwordConflict.words,
      hotwordConflict.cloudHotwords
    );
    return (
      <AlertDialog
        open
        onOpenChange={(open) => {
          if (!open) setHotwordConflict(null);
        }}
      >
        <AlertDialogContent
          finalFocus={hotwordConflictReturnFocusRef}
          className="max-h-[85vh] overflow-y-auto"
        >
          <AlertDialogTitle>云端词表与本机不一致</AlertDialogTitle>
          <AlertDialogDescription>
            可以先把云端改动合并进本机草稿（不会上传），或直接用本机词表覆盖云端。
          </AlertDialogDescription>
          <dl className="max-h-48 space-y-2 overflow-auto rounded-lg bg-muted px-3 py-2.5 text-[12px] leading-4.5">
            <div>
              <dt className="font-medium text-foreground">
                仅云端有 {onlyCloud.length} 个
              </dt>
              <dd className="text-muted-foreground">
                {onlyCloud.join("、") || "无"}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">
                仅本机有 {onlyLocal.length} 个
              </dt>
              <dd className="text-muted-foreground">
                {onlyLocal.join("、") || "无"}
              </dd>
            </div>
          </dl>
          <div className={DIALOG_FOOTER}>
            <AlertDialogCancel variant="ghost" className="mr-auto">
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              variant="outline"
              onClick={() => {
                resolveHotwordConflict(false);
              }}
            >
              用本机覆盖云端
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                resolveHotwordConflict(true);
              }}
            >
              合并到本机草稿
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  if (pendingHotwordApply) {
    const { onlyCloud, onlyLocal } = hotwordDiff(
      pendingHotwordApply.words,
      cloudHotwords
    );
    const overwrite = pendingHotwordApply.reviewToken !== null;
    return (
      <AlertDialog
        open
        onOpenChange={(open) => {
          if (!open) setPendingHotwordApply(null);
        }}
      >
        <AlertDialogContent className="max-h-[85vh] overflow-y-auto">
          <AlertDialogTitle>
            {overwrite ? "用本机词表覆盖云端？" : "应用到火山引擎？"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            将更新当前 Key 下由 VoicePaste 管理的词表。
            {pendingHotwordApply.words.length === 0
              ? "词表为空，云端词表会被删除。"
              : ""}
            {overwrite
              ? "提交前会再次核对云端，但其他设备同时修改仍可能被覆盖。"
              : ""}
          </AlertDialogDescription>
          <WordDiff added={onlyLocal} removed={onlyCloud} />
          <div className={DIALOG_FOOTER}>
            <AlertDialogCancel variant="ghost">取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const pending = pendingHotwordApply;
                setPendingHotwordApply(null);
                void applyHotwords(pending.words, pending.reviewToken);
              }}
            >
              确认应用
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return null;
}
