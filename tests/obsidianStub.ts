export class TFile {
  constructor(public path: string) {}
}

export class Vault {}

export class Menu {
  addItem(): this { return this; }
  showAtMouseEvent(): this { return this; }
  showAtPosition(): this { return this; }
}

export class Notice {
  constructor(_message: string) {}
}

export const Platform = {
  isDesktopApp: true,
  isMobileApp: false,
  isIosApp: false,
  isAndroidApp: false
};

export async function requestUrl(): Promise<never> {
  throw new Error("Network calls are disabled in tests");
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\//, "");
}

function scalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed.startsWith("\"") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }
  return trimmed;
}

export function parseYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let listKey: string | null = null;

  for (const rawLine of yaml.split(/\r?\n/)) {
    const listMatch = rawLine.match(/^\s*-\s*(.+)$/);
    if (listMatch && listKey) {
      (result[listKey] as unknown[]).push(scalar(listMatch[1]));
      continue;
    }

    const pair = rawLine.match(/^([^:]+):\s*(.*)$/);
    if (!pair) continue;
    const key = pair[1].trim();
    if (!pair[2].trim()) {
      result[key] = [];
      listKey = key;
    } else {
      result[key] = scalar(pair[2]);
      listKey = null;
    }
  }
  return result;
}
