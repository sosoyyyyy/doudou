import { normalizePath, TFile, Vault } from "obsidian";
import { DOUDOU_DATA_FOLDER, DOUDOU_SHARED_CONFIG_PATH } from "../constants";
import type { FolderOrderStore } from "./FolderService";

interface SharedDoudouConfig {
  folderOrder: string[];
}

function readStoredOrder(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((name): name is string => typeof name === "string");
}

export function parseSharedDoudouConfig(content: string): SharedDoudouConfig {
  try {
    const parsed = JSON.parse(content) as { folderOrder?: unknown };
    return { folderOrder: readStoredOrder(parsed?.folderOrder) };
  } catch {
    return { folderOrder: [] };
  }
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

function serializeSharedDoudouConfig(folderOrder: readonly string[]): string {
  return `${JSON.stringify({ folderOrder }, null, 2)}\n`;
}

export class VaultFolderOrderStore implements FolderOrderStore {
  constructor(private readonly vault: Vault) {}

  async read(): Promise<string[] | null> {
    const file = this.vault.getAbstractFileByPath(normalizePath(DOUDOU_SHARED_CONFIG_PATH));
    if (!(file instanceof TFile)) return null;
    return parseSharedDoudouConfig(await this.vault.cachedRead(file)).folderOrder;
  }

  async write(folderOrder: readonly string[]): Promise<boolean> {
    const path = normalizePath(DOUDOU_SHARED_CONFIG_PATH);
    const existing = this.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      const current = parseSharedDoudouConfig(await this.vault.cachedRead(existing)).folderOrder;
      if (sameOrder(current, folderOrder)) return false;
      await this.vault.modify(existing, serializeSharedDoudouConfig(folderOrder));
      return true;
    }
    if (existing) throw new Error("Shared doudou config path is not a file");

    const root = normalizePath(DOUDOU_DATA_FOLDER);
    if (!this.vault.getAbstractFileByPath(root)) {
      try { await this.vault.createFolder(root); }
      catch (error) { if (!this.vault.getAbstractFileByPath(root)) throw error; }
    }
    try {
      await this.vault.create(path, serializeSharedDoudouConfig(folderOrder));
      return true;
    } catch (error) {
      const raced = this.vault.getAbstractFileByPath(path);
      if (!(raced instanceof TFile)) throw error;
      const current = parseSharedDoudouConfig(await this.vault.cachedRead(raced)).folderOrder;
      if (sameOrder(current, folderOrder)) return false;
      await this.vault.modify(raced, serializeSharedDoudouConfig(folderOrder));
      return true;
    }
  }
}
