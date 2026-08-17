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

export function metaText(record: DoudouRecord): string {
  const tagText = record.tags.map((tag) => `#${tag}`).join(" ");
  return tagText ? `${record.category} · ${tagText}` : record.category;
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
