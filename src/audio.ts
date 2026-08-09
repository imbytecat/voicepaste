import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type MicrophoneDevice = {
  id: string;
  label: string;
};

export class AudioCapture {
  private readonly captureId = crypto.randomUUID();
  private readonly deviceId: string;
  private readonly onLevel: (level: number) => void;
  private readonly onError: (error: string) => void;
  private unlisteners: UnlistenFn[] = [];
  private started = false;
  private startPromise: Promise<void> | null = null;

  constructor(deviceId: string, onLevel: (level: number) => void, onError: (error: string) => void) {
    this.deviceId = deviceId;
    this.onLevel = onLevel;
    this.onError = onError;
  }

  static async devices(): Promise<MicrophoneDevice[]> {
    return isTauri() ? invoke<MicrophoneDevice[]>("list_microphones") : [];
  }

  async start(sessionId: string | null = null): Promise<void> {
    if (this.started || this.startPromise) return this.startPromise ?? Promise.resolve();
    if (!isTauri()) throw new Error("浏览器预览无法使用原生麦克风");
    this.unlisteners = await Promise.all([
      listen<number>("microphone-level", (event) => this.onLevel(event.payload)),
      listen<string>("microphone-error", (event) => this.onError(event.payload)),
    ]);
    this.startPromise = invoke("start_audio_capture", {
      captureId: this.captureId,
      deviceId: this.deviceId,
      sessionId,
    });
    try {
      await this.startPromise;
      this.started = true;
    } catch (error) {
      this.unlisteners.splice(0).forEach((unlisten) => unlisten());
      throw error;
    } finally {
      this.startPromise = null;
    }
  }

  async stop(): Promise<void> {
    if (this.startPromise) await this.startPromise.catch(() => undefined);
    if (!this.started) return;
    this.started = false;
    try {
      await invoke("stop_audio_capture", { captureId: this.captureId });
    } finally {
      this.unlisteners.splice(0).forEach((unlisten) => unlisten());
    }
  }
}
