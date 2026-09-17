import { validDate, type Item } from "./model";

export type ItemFilter = "all" | "active" | "stock" | "restock" | "history";
export type ItemDisplayState = Exclude<ItemFilter, "all">;
export function itemDisplayState(item: Item): ItemDisplayState {
  if (item.kind === "single") return item.status === "retired" ? "history" : "active";
  if (item.noRestock) return "history";
  return item.quantity === 0 ? "restock" : "stock";
}
export function matchesItemFilter(item: Item, filter: ItemFilter): boolean {
  return filter === "all" || itemDisplayState(item) === filter;
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
