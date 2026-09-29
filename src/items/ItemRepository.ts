import { Notice, TFile, type Vault } from "obsidian";
import { decodeStore, ITEMS_PATH, ITEMS_ROOT, type ItemStore } from "./model";

/** Shared by every view. No startup writes; v1 is backed up before the first mutation. */
export class ItemRepository {
  private queue: Promise<unknown> = Promise.resolve();
  private seenV2 = false;
  constructor(readonly vault: Vault) {}
  private decode(text: string): ItemStore {
    const store = decodeStore(text);
    if (JSON.parse(text).schemaVersion === 2) this.seenV2 = true;
    else if (this.seenV2) throw new Error("检测到小物库被旧版数据覆盖，请先检查同步冲突，已停止写入");
    return store;
  }
  async read(): Promise<ItemStore> {
    const file = this.vault.getAbstractFileByPath(ITEMS_PATH);
    if (!file) {
      if (this.seenV2) throw new Error("小物库数据文件已消失，请检查同步，已停止写入");
      return { schemaVersion: 2, items: [], importedKeys: [] };
    }
    if (!(file instanceof TFile)) throw new Error("小物库数据路径被文件夹占用");
    return this.decode(await this.vault.read(file));
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
      if (!file) {
        if (this.seenV2) throw new Error("小物库数据文件已消失，已停止写入");
        file = await this.vault.create(ITEMS_PATH, JSON.stringify({ schemaVersion: 2, items: [], importedKeys: [] }));
      }
      if (!(file instanceof TFile)) throw new Error("小物库数据路径被占用");
      const original = await this.vault.read(file);
      this.decode(original);
      const migrating = JSON.parse(original).schemaVersion === 1;
      if (migrating) {
        const backupRoot = `${ITEMS_ROOT}/backups`;
        await this.ensureFolder(backupRoot);
        const backup = await this.vault.create(`${backupRoot}/items-v1-${crypto.randomUUID()}.json`, original);
        if (await this.vault.read(backup) !== original) throw new Error("迁移备份校验失败，原数据未改动");
      }
      let result!: T;
      let serialized = "";
      await this.vault.process(file, text => {
        if (migrating && text !== original) throw new Error("备份后数据发生变化，请重新打开物品后重试，原数据未覆盖");
        const store = this.decode(text);
        result = update(store);
        serialized = JSON.stringify(store, null, 2);
        decodeStore(serialized);
        return serialized;
      });
      this.seenV2 = true;
      // A successful process has committed. Never report a rollback or recycle newly saved photos
      // if a later sync/read fails; retain the committed result and tell the user to refresh.
      try {
        const readback = await this.vault.read(file);
        this.decode(readback);
        if (readback !== serialized) new Notice("物品已保存，随后检测到同步更新，请重新打开核对");
      } catch { new Notice("物品已保存，但回读校验失败，请检查同步或数据文件；备份已保留"); }
      return result;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
}
