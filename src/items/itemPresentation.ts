import { cycleMetrics, expiryMetrics, localDate, validDate, type Item } from "./model";
export type ItemFilter = "all" | "active" | "idle" | "stock" | "restock" | "retired" | "nostock";
export function matchesItemFilter(item: Item, filter: ItemFilter): boolean {
  if (filter === "all") return true;
  if (filter === "active" || filter === "idle" || filter === "retired") return item.status === filter;
  const stock = item.inventory;
  if (!stock?.enabled) return false;
  if (filter === "nostock") return stock.noRestock === true;
  if (filter === "stock") return stock.quantity > 0;
  return filter === "restock" && stock.quantity === 0 && stock.noRestock !== true;
}
export function statusLabel(item: Pick<Item, "status">): string { return item.status === null ? "未设状态" : { active: "使用中", idle: "闲置", retired: "已退役" }[item.status]; }
/** Card-only presentation; accepts discontinued without changing the persisted Item schema. */
export function cardStatusLabel(item: {
  status: Item["status"] | "discontinued";
  inventory?: { enabled?: boolean; quantity: number; noRestock?: boolean };
}): string {
  if (item.status === "discontinued") return "不再买";
  const inventory = item.inventory?.enabled !== false ? item.inventory : undefined;
  if (inventory?.noRestock) return "不再买";
  if (inventory && inventory.quantity > 0) return "有库存";
  if (inventory && inventory.quantity === 0) return "待补货";
  return statusLabel({ status: item.status });
}
export function remainingLabel(days: number): string { return days < 0 ? `已超 ${-days} 天` : days === 0 ? "今天到期" : `距下次 ${days} 天`; }
export function reminderItems(items: Item[], today = localDate()): Item[] {
  return items.map(item => ({ item, next: [cycleMetrics(item, today)?.next, expiryMetrics(item, today)?.date].filter((date): date is string => !!date).sort()[0] })).filter(entry => entry.next)
    .sort((a, b) => a.next!.localeCompare(b.next!) || a.item.name.localeCompare(b.item.name, "zh-CN") || a.item.id.localeCompare(b.item.id)).map(entry => entry.item);
}
export function normalizeItemDateInput(value: string): string {
  const text = value.trim();
  return /^\d{8}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}` : text;
}
export function isValidItemDateInput(value: string): boolean { const date = normalizeItemDateInput(value); return date === "" || validDate(date); }
