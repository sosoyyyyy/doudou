import type { DoudouRepository } from "../data/DoudouRepository";
import type { FolderSummary } from "../types";

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
    private readonly readSavedOrder: () => readonly string[],
    private readonly writeSavedOrder: (folderOrder: string[]) => Promise<void>
  ) {}

  async listFolders(): Promise<FolderSummary[]> {
    const actual = await this.repository.listFolders();
    const order = normalizeFolderOrder(actual.map((folder) => folder.name), this.readSavedOrder());
    if (!sameOrder(order, this.readSavedOrder())) await this.writeSavedOrder(order);
    const byName = new Map(actual.map((folder) => [folder.name, folder]));
    return order.map((name) => byName.get(name)).filter((folder): folder is FolderSummary => Boolean(folder));
  }

  async folderNames(): Promise<string[]> {
    return (await this.listFolders()).map((folder) => folder.name);
  }

  async setOrder(requestedOrder: readonly string[]): Promise<string[]> {
    const actual = await this.repository.listFolders();
    const order = normalizeFolderOrder(actual.map((folder) => folder.name), requestedOrder);
    await this.writeSavedOrder(order);
    return order;
  }

  async createFolder(name: string): Promise<void> {
    await this.repository.createFolder(name);
    await this.listFolders();
  }

  async renameFolder(previousName: string, nextName: string): Promise<void> {
    await this.repository.renameFolder(previousName, nextName);
    const saved = this.readSavedOrder().map((name) => name === previousName ? nextName.trim() : name);
    const actual = await this.repository.listFolders();
    await this.writeSavedOrder(normalizeFolderOrder(actual.map((folder) => folder.name), saved));
  }

  async deleteFolder(name: string): Promise<void> {
    await this.repository.deleteFolder(name);
    const actual = await this.repository.listFolders();
    const saved = this.readSavedOrder().filter((folder) => folder !== name);
    await this.writeSavedOrder(normalizeFolderOrder(actual.map((folder) => folder.name), saved));
  }
}
