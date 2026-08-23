import type { DoudouRecord } from "../types";

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit"
});

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "long",
  day: "numeric",
  weekday: "short"
});

const copyFeedbackTimers = new WeakMap<HTMLButtonElement, number>();

export function metaText(record: DoudouRecord): string {
  const tagText = record.tags.map((tag) => `#${tag}`).join(" ");
  return tagText ? `${record.folder} · ${tagText}` : record.folder;
}

export function recordTitle(record: DoudouRecord): string {
  if (record.title?.trim()) return record.title.trim();
  const firstLine = record.content.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (firstLine) return firstLine;
  if ((record.images?.length ?? 0) > 0) return "图片记录";
  if ((record.files?.length ?? 0) > 0) return "附件记录";
  return "空白记录";
}

export function attachmentCountText(record: DoudouRecord): string {
  const count = record.files?.length ?? 0;
  return count > 0 ? `📎 ${count}` : "";
}

export function formatDateTime(value: string): string {
  return dateTimeFormatter.format(new Date(value));
}

export function formatTime(value: string): string {
  return timeFormatter.format(new Date(value));
}

function sameLocalDate(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

export function dateGroupLabel(value: string, now = new Date()): string {
  const date = new Date(value);
  if (sameLocalDate(date, now)) return "今天";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameLocalDate(date, yesterday)) return "昨天";
  return dateFormatter.format(date);
}

export function previewText(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

export async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through for WebViews where the Clipboard API exists but is unavailable.
    }
  }

  const textarea = document.createElement("textarea");
  const activeElement = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.position = "fixed";
  textarea.style.inset = "0 auto auto -9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  try {
    if (!document.execCommand("copy")) throw new Error("Copy command failed");
  } finally {
    textarea.remove();
    activeElement?.focus({ preventScroll: true });
  }
}

export function bindCopyButton(
  button: HTMLButtonElement,
  text: string,
  setButtonIcon: (element: HTMLElement, icon: string) => void
): void {
  setButtonIcon(button, "copy");
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (button.disabled) return;

    button.disabled = true;
    void writeClipboardText(text).then(() => {
      showCopyFeedback(button, "已复制", "check", setButtonIcon);
    }).catch(() => {
      showCopyFeedback(button, "复制失败", "triangle-alert", setButtonIcon);
    }).finally(() => {
      button.disabled = false;
    });
  });
}

function showCopyFeedback(
  button: HTMLButtonElement,
  message: string,
  icon: string,
  setButtonIcon: (element: HTMLElement, icon: string) => void
): void {
  const originalLabel = button.getAttribute("aria-label") ?? "复制全文";
  button.dataset.copyFeedback = message;
  button.setAttribute("aria-label", message);
  button.addClass("doudou-is-feedback-visible");
  setButtonIcon(button, icon);
  const previousTimer = copyFeedbackTimers.get(button);
  if (previousTimer !== undefined) window.clearTimeout(previousTimer);
  const timer = window.setTimeout(() => {
    button.removeClass("doudou-is-feedback-visible");
    delete button.dataset.copyFeedback;
    button.setAttribute("aria-label", originalLabel);
    setButtonIcon(button, "copy");
    copyFeedbackTimers.delete(button);
  }, 1400);
  copyFeedbackTimers.set(button, timer);
}
