import { normalizePath, parseYaml, TFile, Vault } from "obsidian";
import {
  CATEGORIES,
  DOUDOU_ASSETS_FOLDER,
  DOUDOU_DATA_FOLDER
} from "../constants";
import type {
  Category,
  DoudouRecord,
  StoredDoudouRecord
} from "../types";
import {
  extractFrontmatter,
  normalizeImagePaths,
  normalizeTags,
  recordFromFrontmatter,
  serializeRecord
} from "./recordCodec";

export interface RecordChanges {
  content: string;
  category: Category;
  tags: string[];
  images?: string[];
}

export function buildRecordFolder(category: Category, created: string): string {
  const date = new Date(created);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return normalizePath(`${DOUDOU_DATA_FOLDER}/${category}/${year}/${month}`);
}

export function buildRecordPath(
  category: Category,
  created: string,
  fileName: string
): string {
  return normalizePath(`${buildRecordFolder(category, created)}/${fileName}`);
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
  if (CATEGORIES.includes(topLevel as Category)) return relativeParts.length >= 4;
  return /^\d{4}$/.test(topLevel) && relativeParts.length >= 3;
}

export class DoudouRepository {
  private allRecordsCache: Promise<StoredDoudouRecord[]> | null = null;

  constructor(private readonly vault: Vault) {}

  createRecord(content: string, category: Category, tags: string[]): DoudouRecord {
    const created = new Date();
    const randomPart = globalThis.crypto?.randomUUID?.() ??
      Math.random().toString(36).slice(2, 12);

    return {
      id: `${created.getTime().toString(36)}-${randomPart}`,
      content,
      created: created.toISOString(),
      category,
      tags: normalizeTags(tags)
    };
  }

  async save(record: DoudouRecord): Promise<StoredDoudouRecord> {
    const folder = buildRecordFolder(record.category, record.created);
    await this.ensureFolder(folder);

    const path = normalizePath(`${folder}/${this.fileNameFor(record)}`);
    const existing = this.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      const parsed = await this.readFile(existing);
      this.invalidateCache();
      return parsed ?? { ...record, path };
    }

    await this.vault.create(path, serializeRecord(record));
    this.invalidateCache();
    return { ...record, path };
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
      changes.category,
      current?.created ?? record.created,
      fileName
    );
    const updatedRecord: StoredDoudouRecord = {
      ...(current ?? record),
      content: changes.content,
      category: changes.category,
      tags: normalizeTags(changes.tags),
      images: normalizeImagePaths(changes.images ?? current?.images ?? record.images ?? []),
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
