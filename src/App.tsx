import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Overlay } from "./components/Overlay";
import { SettingsRouter } from "./router";

export function App() {
  return isTauri() && getCurrentWindow().label === "overlay" ? <Overlay /> : <SettingsRouter />;
}
