import { useSettings } from "@/components/settings/controller";
import { Group, Row } from "@/components/settings/kit";
import { Switch } from "@/components/ui/switch";

export function GeneralPage() {
  const { isSettingChanged, settings, updateSetting } = useSettings();

  return (
    <Group title="启动">
      <Row
        title="开机时启动"
        description="登录系统后在托盘中待命"
        changed={isSettingChanged("launchAtStartup")}
      >
        <Switch
          checked={settings.launchAtStartup}
          onCheckedChange={(checked) => {
            updateSetting("launchAtStartup", checked);
          }}
          aria-label="开机时启动"
        />
      </Row>
      <Row
        title="启动时打开此窗口"
        description="关闭窗口后，VoicePaste 仍在系统托盘中运行"
        changed={isSettingChanged("openSettingsOnStartup")}
      >
        <Switch
          checked={settings.openSettingsOnStartup}
          onCheckedChange={(checked) => {
            updateSetting("openSettingsOnStartup", checked);
          }}
          aria-label="启动时打开此窗口"
        />
      </Row>
    </Group>
  );
}
