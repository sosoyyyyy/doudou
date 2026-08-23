import type { DoudouRepository } from "../data/DoudouRepository";
import type { FolderSummary } from "../types";

export interface FolderOrderStore {
  read(): Promise<string[] | null>;
  write(folderOrder: readonly string[]): Promise<boolean>;
}

export function normalizeFolderOrder(
  actualFolders: readonly string[],
  savedOrder: readonly string[]
): string[] {
  const actual = [...new Set(actualFolders)];
  const actualSet = new Set(actual);
  const result: string[] = [];
  const seen = new Set<string>();

  for (const name of savedOrder) {
    if (actualSet.has(name) && !seen.has(name)) {
      result.push(name);
      seen.add(name);
    }
  }
  for (const name of actual) {
    if (!seen.has(name)) {
      result.push(name);
      seen.add(name);
    }
  }
  return result;
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

export class FolderService {
  constructor(
    private readonly repository: DoudouRepository,
    private readonly orderStore: FolderOrderStore,
    private readonly readLegacyOrder: () => readonly string[] = () => [],
    private readonly clearLegacyOrder: () => Promise<void> = async () => {}
  ) {}

  async listFolders(): Promise<FolderSummary[]> {
    const actual = await this.repository.listFolders();
    const sharedOrder = await this.orderStore.read();
    const order = normalizeFolderOrder(
      actual.map((folder) => folder.name),
      sharedOrder ?? this.readLegacyOrder()
    );
    if (sharedOrder === null || !sameOrder(order, sharedOrder)) {
      await this.orderStore.write(order);
    }
    await this.clearLegacyOrder();
    const byName = new Map(actual.map((folder) => [folder.name, folder]));
    return order.map((name) => byName.get(name)).filter((folder): folder is FolderSummary => Boolean(folder));
  }

  async folderNames(): Promise<string[]> {
    return (await this.listFolders()).map((folder) => folder.name);
  }

  async setOrder(requestedOrder: readonly string[]): Promise<string[]> {
    const actual = await this.repository.listFolders();
    const order = normalizeFolderOrder(actual.map((folder) => folder.name), requestedOrder);
    await this.orderStore.write(order);
    await this.clearLegacyOrder();
    return order;
  }

  async createFolder(name: string): Promise<void> {
    await this.repository.createFolder(name);
    await this.listFolders();
  }

  async renameFolder(previousName: string, nextName: string): Promise<void> {
    const sharedOrder = await this.orderStore.read();
    await this.repository.renameFolder(previousName, nextName);
    const saved = (sharedOrder ?? this.readLegacyOrder()).map((name) =>
      name === previousName ? nextName.trim() : name
    );
    const actual = await this.repository.listFolders();
    await this.orderStore.write(normalizeFolderOrder(actual.map((folder) => folder.name), saved));
    await this.clearLegacyOrder();
  }

  async deleteFolder(name: string): Promise<void> {
    const sharedOrder = await this.orderStore.read();
    await this.repository.deleteFolder(name);
    const actual = await this.repository.listFolders();
    const saved = (sharedOrder ?? this.readLegacyOrder()).filter((folder) => folder !== name);
    await this.orderStore.write(normalizeFolderOrder(actual.map((folder) => folder.name), saved));
    await this.clearLegacyOrder();
  }
}
