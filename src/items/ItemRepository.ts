import { TFile, type Vault } from "obsidian";
import { decodeStore, ITEMS_PATH, ITEMS_ROOT, type ItemStore } from "./model";

/** A single shared instance serializes all UI/service writes. Vault.process rereads the latest file. */
export class ItemRepository {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly vault: Vault) {}
  async read(): Promise<ItemStore> {
    const file = this.vault.getAbstractFileByPath(ITEMS_PATH);
    if (!file) return { schemaVersion: 1, items: [], importedKeys: [] };
    if (!(file instanceof TFile)) throw new Error("小物库数据路径被文件夹占用");
    return decodeStore(await this.vault.read(file));
  }
  async ensureFolder(path: string): Promise<void> {
    let current = "";
    for (const part of path.split("/")) {
      current = current ? `${current}/${part}` : part;
      if (!this.vault.getAbstractFileByPath(current)) {
        try { await this.vault.createFolder(current); }
        catch (error) { if (!this.vault.getAbstractFileByPath(current)) throw error; }
      }
    }
  }
  change<T>(update: (store: ItemStore) => T): Promise<T> {
    const operation = this.queue.then(async () => {
      await this.ensureFolder(ITEMS_ROOT);
      let file = this.vault.getAbstractFileByPath(ITEMS_PATH);
      if (!file) file = await this.vault.create(ITEMS_PATH, JSON.stringify({ schemaVersion: 1, items: [], importedKeys: [] }));
      if (!(file instanceof TFile)) throw new Error("小物库数据路径被占用");
      let result!: T;
      await this.vault.process(file, (text) => {
        const store = decodeStore(text); result = update(store);
        const serialized = JSON.stringify(store, null, 2); decodeStore(serialized); return serialized;
      });
      return result;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
}
