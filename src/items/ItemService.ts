import { Notice, TFile } from "obsidian";
import { ItemRepository } from "./ItemRepository";
import { ITEM_ASSETS, validateItem, type Item } from "./model";

export class ItemService {
  constructor(readonly repository: ItemRepository) {}
  async list(): Promise<Item[]> { return (await this.repository.read()).items.sort((a,b) => b.updated.localeCompare(a.updated)); }
  async save(draft: Item, pending: File[] = []): Promise<Item> {
    validateItem(draft);
    const added: string[] = [];
    let removed: string[] = [];
    try {
      if (pending.length) await this.repository.ensureFolder(ITEM_ASSETS);
      for (const file of pending) {
        const ext = file.name.split(".").pop()?.toLowerCase();
        if (!ext || !["jpg", "jpeg", "png", "webp", "gif", "heic", "heif", "avif"].includes(ext)) throw new Error("请选择 JPG、PNG、WebP、GIF、HEIC 或 AVIF 照片");
        const path = `${ITEM_ASSETS}/${crypto.randomUUID()}.${ext}`;
        await this.repository.vault.createBinary(path, await file.arrayBuffer()); added.push(path);
      }
      const saved = await this.repository.change(store => {
        const current = store.items.find(i => i.id === draft.id);
        if ((current?.revision ?? 0) !== draft.revision) throw new Error("物品已被更新，请返回后重新打开编辑");
        if (!current && draft.revision !== 0) throw new Error("物品已删除");
        const next = { ...draft, name: draft.name.trim(), photos: [...draft.photos, ...added], revision: draft.revision + 1, updated: new Date().toISOString() };
        removed = current?.photos.filter(p => !next.photos.includes(p)) ?? [];
        store.items = [...store.items.filter(i => i.id !== next.id), next]; return next;
      });
      await this.recycle(removed); return saved;
    } catch (error) { await this.recycle(added); throw error; }
  }
  async adjust(id: string, delta: 1 | -1): Promise<void> {
    await this.repository.change(store => {
      const item = store.items.find(i => i.id === id);
      if (!item || item.kind !== "stock") throw new Error("库存物品已不存在");
      if (!Number.isSafeInteger(item.quantity + delta) || item.quantity + delta < 0) throw new Error("数量不能小于 0 或超出范围");
      item.quantity += delta; item.revision++; item.updated = new Date().toISOString();
    });
  }
  async delete(item: Item): Promise<void> {
    const photos = await this.repository.change(store => {
      const current = store.items.find(i => i.id === item.id);
      if (!current || current.revision !== item.revision) throw new Error("物品已变化，请重新打开");
      store.items = store.items.filter(i => i.id !== item.id); return current.photos;
    });
    await this.recycle(photos);
  }
  async import(items: Item[]): Promise<number> {
    items.forEach(validateItem);
    return this.repository.change(store => {
      let count = 0;
      for (const item of items) {
        if (!item.importKey || store.importedKeys.includes(item.importKey)) continue;
        store.items.push({ ...item, id: crypto.randomUUID(), revision: 1 }); store.importedKeys.push(item.importKey); count++;
      }
      return count;
    });
  }
  resource(path: string): string {
    const file = this.repository.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? this.repository.vault.getResourcePath(file) : "";
  }
  private async recycle(paths: string[]): Promise<void> {
    if (!paths.length) return;
    try {
      const current = await this.list();
      for (const path of paths) {
        if (current.some(i => i.photos.includes(path))) continue;
        const file = this.repository.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) await this.repository.vault.trash(file, false);
      }
    } catch { new Notice("物品已保存，部分照片未能移入回收站，原文件已保留"); }
  }
}
