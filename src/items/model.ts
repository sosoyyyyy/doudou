export const ITEMS_ROOT = "兜兜/小物库";
export const ITEMS_PATH = `${ITEMS_ROOT}/items.json`;
export const ITEM_ASSETS = `${ITEMS_ROOT}/assets`;
export interface Item {
  id: string; kind: "single" | "stock"; name: string; notes: string; photos: string[];
  purchased?: string; price?: number; status: "active" | "retired"; retired?: string;
  quantity: number; revision: number; created: string; updated: string; importKey?: string;
}
export interface ItemStore { schemaVersion: 1; items: Item[]; importedKeys: string[] }
export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function validateItem(item: Item): void {
  if (!item || typeof item.id !== "string" || !item.id || typeof item.name !== "string" || !item.name.trim() || typeof item.notes !== "string" || !["single", "stock"].includes(item.kind) || !["active", "retired"].includes(item.status)) throw new Error("请填写物品名称并选择有效类型和状态");
  if (!Number.isSafeInteger(item.quantity) || item.quantity < 0 || !Number.isSafeInteger(item.revision) || item.revision < 0) throw new Error("数量必须是非负整数");
  if (typeof item.created !== "string" || typeof item.updated !== "string" || !Number.isFinite(Date.parse(item.created)) || !Number.isFinite(Date.parse(item.updated))) throw new Error("物品时间戳无效");
  if (item.price !== undefined && (!Number.isFinite(item.price) || item.price < 0)) throw new Error("购买价格必须是非负数字");
  for (const date of [item.purchased, item.retired]) if (date !== undefined && !validDate(date)) throw new Error("日期格式不正确");
  if (item.purchased && item.retired && item.retired < item.purchased) throw new Error("退役日期不能早于购买日期");
  if (!Array.isArray(item.photos) || item.photos.some(p => typeof p !== "string" || !p.startsWith(`${ITEM_ASSETS}/`) || p.includes("..") || p.includes("\\"))) throw new Error("照片路径不属于小物库");
}
export function decodeStore(text: string): ItemStore {
  const store = JSON.parse(text) as ItemStore;
  if (store.schemaVersion !== 1 || !Array.isArray(store.items) || !Array.isArray(store.importedKeys) || store.importedKeys.some(k => typeof k !== "string")) throw new Error("小物库数据格式无法识别，已停止写入");
  store.items.forEach(validateItem);
  if (new Set(store.items.map(i => i.id)).size !== store.items.length) throw new Error("小物库存在重复编号，已停止写入");
  return store;
}
export function blankItem(): Item {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), kind: "single", name: "", notes: "", photos: [], status: "active", quantity: 1, revision: 0, created: now, updated: now };
}
export function itemMetrics(item: Item, today = new Date()): { days?: number; daily?: number } {
  const end = item.status === "retired" ? item.retired : `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  if (item.kind !== "single" || !item.purchased || !end || end < item.purchased) return {};
  const days = Math.max(1, Math.round((Date.parse(end) - Date.parse(item.purchased)) / 86400000));
  return { days, daily: item.price === undefined ? undefined : item.price / days };
}
export function matchesItem(item: Item, query: string): boolean { return `${item.name}\n${item.notes}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()); }
