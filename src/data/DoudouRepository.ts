import { normalizePath, parseYaml, TFile, Vault } from "obsidian";
import {
  ALL_RECORDS_FOLDER,
  DOUDOU_ASSETS_FOLDER,
  DOUDOU_DATA_FOLDER
} from "../constants";
import type {
  DoudouRecord,
  FolderSummary,
  StoredDoudouRecord
} from "../types";
import {
  extractManualTags,
  extractFrontmatter,
  normalizeAssetPaths,
  normalizeImagePaths,
  normalizeTags,
  recordFromFrontmatter,
  serializeRecord
} from "./recordCodec";

export interface RecordChanges {
  title?: string;
  content: string;
  folder: string;
  images?: string[];
  files?: string[];
}

export function normalizeFolderName(value: string): string {
  const name = value.trim();
  if (
    !name || name === ALL_RECORDS_FOLDER || name.toLocaleLowerCase() === "assets" ||
    /[\\/:*?"<>|]/.test(name) || name === "." || name === ".." ||
    /^\d{4}$/.test(name)
  ) throw new Error("Invalid folder name");
  return name;
}

export function buildRecordFolder(folder: string, created: string): string {
  const safeFolder = normalizeFolderName(folder);
  const date = new Date(created);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return normalizePath(`${DOUDOU_DATA_FOLDER}/${safeFolder}/${year}/${month}`);
}

export function buildRecordPath(
  folder: string,
  created: string,
  fileName: string
): string {
  return normalizePath(`${buildRecordFolder(folder, created)}/${fileName}`);
}

export function isDoudouRecordPath(path: string): boolean {
  const normalized = normalizePath(path);
  const rootPrefix = `${normalizePath(DOUDOU_DATA_FOLDER)}/`;
  const assetsPrefix = `${normalizePath(DOUDOU_ASSETS_FOLDER)}/`;
  if (
    !normalized.startsWith(rootPrefix) ||
    normalized.startsWith(assetsPrefix) ||
    !normalized.toLocaleLowerCase().endsWith(".md")
  ) {
    return false;
  }

  const relativeParts = normalized.slice(rootPrefix.length).split("/");
  const topLevel = relativeParts[0];
  if (/^\d{4}$/.test(topLevel)) return relativeParts.length >= 3;
  return relativeParts.length >= 4;
}

export class DoudouRepository {
  private allRecordsCache: Promise<StoredDoudouRecord[]> | null = null;

  constructor(private readonly vault: Vault) {}

  createRecord(content: string, folder: string, title?: string): DoudouRecord {
    const created = new Date();
    const randomPart = globalThis.crypto?.randomUUID?.() ??
      Math.random().toString(36).slice(2, 12);

    return {
      id: `${created.getTime().toString(36)}-${randomPart}`,
      content,
      created: created.toISOString(),
      ...(title?.trim() ? { title: title.trim() } : {}),
      folder: normalizeFolderName(folder),
      tags: extractManualTags(content)
    };
  }

  async save(record: DoudouRecord): Promise<StoredDoudouRecord> {
    const normalizedRecord: DoudouRecord = {
      ...record,
      folder: normalizeFolderName(record.folder),
      tags: extractManualTags(record.content),
      images: normalizeImagePaths(record.images ?? []),
      files: normalizeAssetPaths(record.files ?? [])
    };
    const folder = buildRecordFolder(normalizedRecord.folder, normalizedRecord.created);
    await this.ensureFolder(folder);

    const path = normalizePath(`${folder}/${this.fileNameFor(normalizedRecord)}`);
    const existing = this.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      const parsed = await this.readFile(existing);
      this.invalidateCache();
      return parsed ?? { ...normalizedRecord, path };
    }

    await this.vault.create(path, serializeRecord(normalizedRecord));
    this.invalidateCache();
    return { ...normalizedRecord, path };
  }

  async update(
    record: StoredDoudouRecord,
    changes: RecordChanges
  ): Promise<StoredDoudouRecord> {
    const file = this.vault.getAbstractFileByPath(record.path);
    if (!(file instanceof TFile)) throw new Error("Record file no longer exists");
    const originalMarkdown = await this.vault.cachedRead(file);
    const current = await this.readFile(file);

    const originalPath = normalizePath(record.path);
    const fileName = originalPath.slice(originalPath.lastIndexOf("/") + 1);
    const targetPath = buildRecordPath(
      changes.folder,
      current?.created ?? record.created,
      fileName
    );
    const updatedRecord: StoredDoudouRecord = {
      ...(current ?? record),
      ...(changes.title?.trim() ? { title: changes.title.trim() } : { title: undefined }),
      content: changes.content,
      folder: normalizeFolderName(changes.folder),
      tags: extractManualTags(changes.content),
      images: normalizeImagePaths(changes.images ?? current?.images ?? record.images ?? []),
      files: normalizeAssetPaths(changes.files ?? current?.files ?? record.files ?? []),
      updated: new Date().toISOString(),
      path: targetPath
    };

    if (targetPath !== originalPath) {
      const collision = this.vault.getAbstractFileByPath(targetPath);
      if (collision) throw new Error("A record already exists at the target path");
      await this.ensureFolder(targetPath.slice(0, targetPath.lastIndexOf("/")));
      await this.vault.rename(file, targetPath);
    }

    try {
      await this.vault.modify(file, serializeRecord(updatedRecord));
    } catch (error) {
      if (targetPath !== originalPath) {
        try {
          await this.vault.modify(file, originalMarkdown);
          await this.vault.rename(file, originalPath);
        } catch {
          throw new Error("Record update failed and could not be rolled back", {
            cause: error
          });
        }
      }
      throw error;
    }
    this.invalidateCache();
    return updatedRecord;
  }

  async delete(record: StoredDoudouRecord): Promise<void> {
    const file = this.vault.getAbstractFileByPath(record.path);
    if (!(file instanceof TFile)) throw new Error("Record file no longer exists");
    await this.vault.trash(file, false);
    this.invalidateCache();
  }

  async updateAiTags(
    record: StoredDoudouRecord,
    aiTags: string[]
  ): Promise<StoredDoudouRecord> {
    const file = this.vault.getAbstractFileByPath(record.path);
    if (!(file instanceof TFile)) throw new Error("Record file no longer exists");
    const current = await this.readFile(file);
    if (!current) throw new Error("Record file is not readable");

    const updatedRecord: StoredDoudouRecord = {
      ...current,
      aiTags: normalizeTags(aiTags)
    };
    await this.vault.modify(file, serializeRecord(updatedRecord));
    this.invalidateCache();
    return updatedRecord;
  }

  async loadRecent(limit: number): Promise<StoredDoudouRecord[]> {
    const records = await this.loadAll();
    return records.slice(0, limit).reverse();
  }

  async loadAll(): Promise<StoredDoudouRecord[]> {
    if (!this.allRecordsCache) this.allRecordsCache = this.readAll();
    return this.allRecordsCache;
  }

  async listFolders(): Promise<FolderSummary[]> {
    const records = await this.loadAll();
    const counts = new Map<string, number>();
    for (const record of records) counts.set(record.folder, (counts.get(record.folder) ?? 0) + 1);
    const loadedFiles = (this.vault as Vault & { getAllLoadedFiles?: () => Array<{ path: string }> })
      .getAllLoadedFiles?.() ?? [];
    const rootPrefix = `${normalizePath(DOUDOU_DATA_FOLDER)}/`;
    const actualFolders = new Set<string>();
    for (const item of loadedFiles) {
      if (item instanceof TFile) continue;
      const normalized = normalizePath(item.path);
      if (!normalized.startsWith(rootPrefix)) continue;
      const relative = normalized.slice(rootPrefix.length);
      if (
        !relative || relative.includes("/") ||
        relative.toLocaleLowerCase() === "assets" ||
        relative === ALL_RECORDS_FOLDER || /^\d{4}$/.test(relative)
      ) continue;
      actualFolders.add(relative);
    }
    return [...actualFolders].map((name) => ({ name, count: counts.get(name) ?? 0 })).sort((a, b) =>
      a.name.localeCompare(b.name, "zh-CN")
    );
  }

  async createFolder(name: string): Promise<void> {
    const folder = normalizeFolderName(name);
    await this.ensureFolder(normalizePath(`${DOUDOU_DATA_FOLDER}/${folder}`));
  }

  async renameFolder(previousName: string, nextName: string): Promise<void> {
    const previous = normalizeFolderName(previousName);
    const next = normalizeFolderName(nextName);
    if (previous === next) return;
    const targetRoot = normalizePath(`${DOUDOU_DATA_FOLDER}/${next}`);
    if (this.vault.getAbstractFileByPath(targetRoot)) throw new Error("Folder already exists");
    const records = (await this.loadAll()).filter((record) => record.folder === previous);
    if (records.length === 0) {
      const source = this.vault.getAbstractFileByPath(normalizePath(`${DOUDOU_DATA_FOLDER}/${previous}`));
      if (!source) throw new Error("Folder no longer exists");
      await this.vault.rename(source, targetRoot);
      this.invalidateCache();
      return;
    }
    for (const record of records) {
      await this.update(record, {
        title: record.title,
        content: record.content,
        folder: next,
        images: record.images,
        files: record.files
      });
    }
    const oldRoot = this.vault.getAbstractFileByPath(
      normalizePath(`${DOUDOU_DATA_FOLDER}/${previous}`)
    );
    if (oldRoot) await this.vault.trash(oldRoot, false);
    this.invalidateCache();
  }

  async deleteFolder(name: string): Promise<void> {
    const folder = normalizeFolderName(name);
    if ((await this.loadAll()).some((record) => record.folder === folder)) {
      throw new Error("Folder is not empty");
    }
    const item = this.vault.getAbstractFileByPath(normalizePath(`${DOUDOU_DATA_FOLDER}/${folder}`));
    if (item) await this.vault.trash(item, false);
    this.invalidateCache();
  }

  invalidateCache(): void {
    this.allRecordsCache = null;
  }

  isDoudouPath(path: string): boolean {
    const normalized = normalizePath(path);
    const root = normalizePath(DOUDOU_DATA_FOLDER);
    return normalized === root || normalized.startsWith(`${root}/`);
  }

  private async readAll(): Promise<StoredDoudouRecord[]> {
    const files = this.vault
      .getMarkdownFiles()
      .filter((file) => isDoudouRecordPath(file.path));
    const records = await Promise.all(files.map((file) => this.readFile(file)));

    return records
      .filter((record): record is StoredDoudouRecord => record !== null)
      .sort((a, b) => b.created.localeCompare(a.created));
  }

  private async readFile(file: TFile): Promise<StoredDoudouRecord | null> {
    try {
      const extracted = extractFrontmatter(await this.vault.cachedRead(file));
      if (!extracted) return null;
      return recordFromFrontmatter(
        parseYaml(extracted.yaml),
        extracted.content,
        file.path
      );
    } catch {
      return null;
    }
  }

  private fileNameFor(record: DoudouRecord): string {
    const date = new Date(record.created);
    const stamp = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
      "-",
      String(date.getHours()).padStart(2, "0"),
      String(date.getMinutes()).padStart(2, "0"),
      String(date.getSeconds()).padStart(2, "0")
    ].join("");
    return `${stamp}-${record.id}.md`;
  }

  private async ensureFolder(path: string): Promise<void> {
    const parts = normalizePath(path).split("/");
    let current = "";

    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.vault.getAbstractFileByPath(current)) {
        try {
          await this.vault.createFolder(current);
        } catch (error) {
          if (!this.vault.getAbstractFileByPath(current)) throw error;
        }
      }
    }
  }
}
