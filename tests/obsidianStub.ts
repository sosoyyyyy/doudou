export class TFile {
  constructor(public path: string) {}
}

export class Vault {}

class FakeMenuItem {
  setTitle(): this { return this; }
  setIcon(): this { return this; }
  onClick(): this { return this; }
}

export let shownMenuCount = 0;
export function resetShownMenuCount(): void { shownMenuCount = 0; }

export class Menu {
  addItem(callback: (item: FakeMenuItem) => void): this { callback(new FakeMenuItem()); return this; }
  showAtMouseEvent(): this { shownMenuCount += 1; return this; }
  showAtPosition(): this { shownMenuCount += 1; return this; }
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

export function setIcon(element: HTMLElement, icon: string): void {
  element.setAttribute("data-icon", icon);
}

export class Modal {
  readonly containerEl: HTMLElement;
  readonly modalEl: HTMLElement;
  readonly titleEl: HTMLElement;
  readonly contentEl: HTMLElement;
  private opened = false;

  constructor(readonly app: unknown) {
    this.containerEl = document.createElement("div");
    this.containerEl.className = "modal-container";
    const background = document.createElement("div");
    background.className = "modal-bg";
    this.modalEl = document.createElement("div");
    this.modalEl.className = "modal";
    const nativeClose = document.createElement("button");
    nativeClose.className = "modal-close-button";
    nativeClose.addEventListener("click", () => this.close());
    this.titleEl = document.createElement("div");
    this.titleEl.className = "modal-title";
    this.contentEl = document.createElement("div");
    this.contentEl.className = "modal-content";
    this.modalEl.append(nativeClose, this.titleEl, this.contentEl);
    this.containerEl.append(background, this.modalEl);
  }

  open(): void {
    if (this.opened) return;
    this.opened = true;
    document.body.appendChild(this.containerEl);
    this.onOpen();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.onClose();
    this.containerEl.remove();
  }

  onOpen(): void {}
  onClose(): void {}
}

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
