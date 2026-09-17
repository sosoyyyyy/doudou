import { validDate, type Item } from "./model";

export type ItemFilter = "all" | "active" | "stock" | "retired";
export function matchesItemFilter(item: Item, filter: ItemFilter): boolean {
  return filter === "all" || (filter === "stock" ? item.kind === "stock" : item.kind === "single" && item.status === filter);
}
/** UI-only formatting; persisted dates retain the existing ISO date format. */
export function normalizeItemDateInput(value: string): string {
  const text = value.trim();
  return /^\d{8}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}` : text;
}
export function isValidItemDateInput(value: string): boolean {
  const date = normalizeItemDateInput(value);
  return date === "" || validDate(date);
}
