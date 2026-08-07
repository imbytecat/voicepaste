import { WebVoiceProcessor } from "@picovoice/web-voice-processor";

const FRAME_LENGTH = 3200;
let configured = false;

type VoiceEngine = {
  onmessage: (event: MessageEvent) => void;
};

export class AudioCapture {
  private readonly engine: VoiceEngine;
  private started = false;

  private constructor(engine: VoiceEngine) {
    this.engine = engine;
  }

  static async create(onChunk: (pcm: Uint8Array) => void, onLevel: (level: number) => void): Promise<AudioCapture> {
    if (!configured) {
      WebVoiceProcessor.setOptions({
        frameLength: FRAME_LENGTH,
        outputSampleRate: 16_000,
      });
      configured = true;
    }

    const warmEngine: VoiceEngine = { onmessage: () => undefined };
    await WebVoiceProcessor.subscribe(warmEngine);
    await WebVoiceProcessor.unsubscribe(warmEngine);

    const engine: VoiceEngine = {
      onmessage: (event) => {
        if (event.data.command !== "process") return;
        const frame = event.data.inputFrame as Int16Array;
        let energy = 0;
        for (const sample of frame) {
          const normalized = sample / 32_768;
          energy += normalized * normalized;
        }
        onLevel(Math.min(1, Math.sqrt(energy / Math.max(1, frame.length)) * 5));
        const bytes = new Uint8Array(frame.byteLength);
        bytes.set(new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength));
        onChunk(bytes);
      },
    };
    return new AudioCapture(engine);
  }

  async start(): Promise<void> {
    if (this.started) return;
    await WebVoiceProcessor.subscribe(this.engine);
    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    await WebVoiceProcessor.unsubscribe(this.engine);
  }
}
