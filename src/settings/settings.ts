import type { DoudouSettings } from "../types";

export const DEFAULT_SETTINGS: DoudouSettings = {
  deepSeekApiKey: "",
  deepSeekModel: "deepseek-v4-flash",
  autoAiTags: true,
  folderOrder: []
};

export function normalizeSettings(value: unknown): DoudouSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_SETTINGS };
  const data = value as Partial<DoudouSettings>;
  const model = data.deepSeekModel === "deepseek-v4-pro"
    ? "deepseek-v4-pro"
    : "deepseek-v4-flash";
  return {
    deepSeekApiKey: typeof data.deepSeekApiKey === "string"
      ? data.deepSeekApiKey.trim()
      : "",
    deepSeekModel: model,
    autoAiTags: data.autoAiTags !== false,
    folderOrder: Array.isArray(data.folderOrder)
      ? [...new Set(data.folderOrder.filter((name): name is string =>
        typeof name === "string" && name.trim().length > 0
      ).map((name) => name.trim()))]
      : []
  };
}
