export const ITEMS_ROOT = "兜兜/小物库";
export const ITEMS_PATH = `${ITEMS_ROOT}/items.json`;
export const ITEM_ASSETS = `${ITEMS_ROOT}/assets`;
export interface UsageRecord { id: string; date: string }
export interface Item {
  id: string; name: string; notes: string; photos: string[];
  purchased?: string; price?: number; status: "active" | "idle" | "retired" | null; retired?: string;
  inventory?: { enabled: boolean; quantity: number; noRestock?: boolean };
  cycle?: { enabled: boolean; intervalDays: number };
  expiresOn?: string;
  usageRecords: UsageRecord[];
  cover?: string; revision: number; created: string; updated: string; importKey?: string;
}
export interface ItemStore { schemaVersion: 2; items: Item[]; importedKeys: string[] }
export function validDate(value: string): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function localDate(today = new Date()): string {
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}
export function dateDays(from: string, to: string): number { return Math.round((Date.parse(to) - Date.parse(from)) / 86400000); }
export function addDays(date: string, days: number): string {
  const result = new Date(Date.parse(date) + days * 86400000);
  if (!Number.isFinite(result.getTime()) || result.getUTCFullYear() > 9999) throw new Error("周期日期超出范围");
  return result.toISOString().slice(0, 10);
}
export function validateUsageDate(date: string): void {
  if (!validDate(date) || date > localDate()) throw new Error("使用日期必须是有效日期，且不能晚于今天");
}
export function validateItem(item: Item): void {
  if (!item || typeof item.id !== "string" || !item.id || typeof item.name !== "string" || !item.name.trim() || typeof item.notes !== "string" || (item.status !== null && !["active", "idle", "retired"].includes(item.status))) throw new Error("请填写物品名称并选择有效状态");
  if (!Number.isSafeInteger(item.revision) || item.revision < 0) throw new Error("物品版本无效");
  if (item.cover !== undefined && (typeof item.cover !== "string" || Array.from(item.cover).length > 1)) throw new Error("封面字只能是一个字符");
  if (typeof item.created !== "string" || typeof item.updated !== "string" || !Number.isFinite(Date.parse(item.created)) || !Number.isFinite(Date.parse(item.updated))) throw new Error("物品时间戳无效");
  if (item.importKey !== undefined && typeof item.importKey !== "string") throw new Error("物品导入标识无效");
  if (item.price !== undefined && (!Number.isFinite(item.price) || item.price < 0)) throw new Error("购买价格必须是非负数字");
  for (const date of [item.purchased, item.retired, item.expiresOn]) if (date !== undefined && !validDate(date)) throw new Error("日期格式不正确");
  if (item.purchased && item.retired && item.retired < item.purchased) throw new Error("退役日期不能早于购买日期");
  if (!Array.isArray(item.photos) || item.photos.some(p => typeof p !== "string" || !p.startsWith(`${ITEM_ASSETS}/`) || p.includes("..") || p.includes("\\"))) throw new Error("照片路径不属于小物库");
  const stock = item.inventory;
  if (stock !== undefined && (!stock || typeof stock.enabled !== "boolean" || !Number.isSafeInteger(stock.quantity) || stock.quantity < 0 || (stock.noRestock !== undefined && typeof stock.noRestock !== "boolean"))) throw new Error("库存数量或补货设置无效");
  if (!Array.isArray(item.usageRecords) || item.usageRecords.some(r => !r || typeof r.id !== "string" || !r.id || !validDate(r.date))) throw new Error("使用记录无效");
  if (new Set(item.usageRecords.map(r => r.id)).size !== item.usageRecords.length || new Set(item.usageRecords.map(r => r.date)).size !== item.usageRecords.length) throw new Error("同一天已有使用记录，请编辑原记录");
  if (item.cycle !== undefined) {
    if (!item.cycle || typeof item.cycle.enabled !== "boolean" || !Number.isSafeInteger(item.cycle.intervalDays) || item.cycle.intervalDays <= 0) throw new Error("使用周期必须是正整数天数");
    if (item.cycle.enabled && !item.usageRecords.length) throw new Error("开启周期需要至少一条使用日期");
    for (const record of item.usageRecords) addDays(record.date, item.cycle.intervalDays);
  }
}
/** Reads validate calendar dates independently of device clock; user writes reject future usage dates. */
export function decodeStore(text: string): ItemStore {
  const raw = JSON.parse(text);
  if (!raw || ![1, 2].includes(raw.schemaVersion) || !Array.isArray(raw.items) || !Array.isArray(raw.importedKeys) || raw.importedKeys.some((k: unknown) => typeof k !== "string")) throw new Error("小物库数据格式无法识别，已停止写入");
  const items: Item[] = raw.items.map((value: Item & { kind?: string; quantity?: number; noRestock?: boolean }) => {
    if (raw.schemaVersion === 2) { validateItem(value); return value; }
    if (!value || !["single", "stock"].includes(value.kind ?? "") || !["active", "idle", "retired"].includes(value.status ?? "") || !Number.isSafeInteger(value.quantity) || value.quantity! < 0 || (value.noRestock !== undefined && typeof value.noRestock !== "boolean")) throw new Error("旧版小物库数据无效，已停止写入");
    const { kind, quantity, noRestock, ...rest } = value;
    const next: Item = { ...rest, status: kind === "stock" ? null : value.status, usageRecords: [], inventory: kind === "stock" ? { enabled: true, quantity: quantity!, ...(noRestock === undefined ? {} : { noRestock }) } : undefined };
    validateItem(next); return next;
  });
  if (new Set(items.map(i => i.id)).size !== items.length) throw new Error("小物库存在重复编号，已停止写入");
  return { ...raw, schemaVersion: 2, items };
}
export function blankItem(): Item {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), name: "", notes: "", photos: [], status: "active", usageRecords: [], revision: 0, created: now, updated: now };
}
export function itemMetrics(item: Item, today = new Date()): { days?: number; daily?: number } {
  const end = item.status === "retired" ? item.retired : localDate(today);
  if (!item.purchased || !end || end < item.purchased) return {};
  const days = Math.max(1, dateDays(item.purchased, end));
  return { days, daily: item.price === undefined ? undefined : item.price / days };
}
export function usageHistory(item: Item): (UsageRecord & { interval?: number })[] {
  const records = [...item.usageRecords].sort((a, b) => b.date.localeCompare(a.date));
  return records.map((r, index) => ({ ...r, interval: records[index + 1] ? dateDays(records[index + 1].date, r.date) : undefined }));
}
export function cycleMetrics(item: Item, today = localDate()): { latest: string; elapsed: number; next: string; remaining: number } | undefined {
  if (!item.cycle?.enabled || !item.usageRecords.length) return undefined;
  const latest = item.usageRecords.reduce((last, r) => r.date > last ? r.date : last, "");
  const next = addDays(latest, item.cycle.intervalDays);
  return { latest, elapsed: dateDays(latest, today), next, remaining: dateDays(today, next) };
}
export function expiryMetrics(item: Item, today = localDate()): { date: string; remaining: number } | undefined {
  return item.expiresOn ? { date: item.expiresOn, remaining: dateDays(today, item.expiresOn) } : undefined;
}
export function matchesItem(item: Item, query: string): boolean { return `${item.name}\n${item.notes}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()); }
