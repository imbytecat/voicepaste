import { useSettings } from "@/components/settings/controller";
import { Notice } from "@/components/settings/kit";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function SettingsDialogs() {
  const {
    cancelPendingAction,
    pendingAction,
    pendingActionError,
    performAction,
    saving,
  } = useSettings();

  if (!pendingAction) return null;
  const verb = pendingAction === "close" ? "关闭" : "切换";
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) cancelPendingAction();
      }}
    >
      <AlertDialogContent>
        <AlertDialogTitle>保存修改后再{verb}？</AlertDialogTitle>
        <AlertDialogDescription>当前有未保存的设置。</AlertDialogDescription>
        {pendingActionError ? (
          <Notice tone="error">{pendingActionError}</Notice>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button
            variant="ghost"
            className="mr-auto"
            disabled={saving}
            onClick={cancelPendingAction}
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
