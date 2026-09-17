import { blankItem, validateItem, type Item } from "./model";

/** Explicit local exchange format. No formulas, file paths or embedded photos are imported. */
export function parseItemImport(text: string): Item[] {
  const data = JSON.parse(text);
  if (data.format !== "doudou-items-import-v1" || !Array.isArray(data.items) || data.items.length > 5000) throw new Error("请选择小物库导入 JSON 文件（最多 5000 件）");
  const keys = new Set<string>();
  return data.items.map((row: Record<string, unknown>, index: number) => {
    if (!row || typeof row.key !== "string" || !row.key || keys.has(row.key)) throw new Error(`第 ${index + 1} 项导入编号无效或重复`);
    keys.add(row.key);
    const item: Item = {
      ...blankItem(), importKey: row.key, name: row.name as string, notes: (row.notes ?? "") as string,
      kind: (row.kind ?? "single") as Item["kind"], purchased: row.purchased as string | undefined,
      price: row.price as number | undefined, status: (row.status ?? "active") as Item["status"],
      retired: row.retired as string | undefined, quantity: (row.quantity ?? 1) as number
    };
    try { validateItem(item); } catch (error) { throw new Error(`第 ${index + 1} 项：${(error as Error).message}`); }
    return item;
  });
}
