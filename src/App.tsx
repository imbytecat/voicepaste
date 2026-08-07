import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Overlay } from "./components/Overlay";
import { Settings } from "./components/Settings";

export function App() {
  return isTauri() && getCurrentWindow().label === "overlay" ? <Overlay /> : <Settings />;
}
