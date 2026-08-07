export type AppSettings = {
  apiKey: string;
  resourceId: string;
  shortcut: string;
  hotwords: string[];
};

export type AsrEvent = {
  kind: "partial" | "final" | "completed" | "copied" | "error";
  text?: string;
  message?: string;
};

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: "",
  resourceId: "volc.seedasr.sauc.duration",
  shortcut: "CommandOrControl+Shift+Space",
  hotwords: [],
};
