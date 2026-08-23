import { normalizePath, TFile, Vault } from "obsidian";
import { DOUDOU_ASSETS_FOLDER } from "../constants";

export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

export interface AttachmentFileLike {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface StoredFileInfo {
  path: string;
  name: string;
  extension: string;
  size: number | null;
  exists: boolean;
}

export function sanitizeAttachmentName(value: string): string {
  const leaf = value.replace(/\\/g, "/").split("/").at(-1) ?? "";
  const cleaned = leaf
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/^\.+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
  return cleaned || "attachment";
}

export function buildFilePath(
  recordId: string,
  created: string,
  index: number,
  originalName: string
): string {
  const date = new Date(created);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const sequence = String(index + 1).padStart(2, "0");
  const safeName = sanitizeAttachmentName(originalName);
  const safeRecordId = recordId.replace(/[^A-Za-z0-9_-]/g, "-")
    .replace(/^-+|-+$/g, "") || "record";
  return normalizePath(
    `${DOUDOU_ASSETS_FOLDER}/${year}/${month}/${safeRecordId}-file-${sequence}-${safeName}`
  );
}

export function attachmentDisplayName(path: string): string {
  const leaf = normalizePath(path).split("/").at(-1) ?? "附件";
  return leaf.match(/-file-\d+-(.+)$/)?.[1] ?? leaf;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export class FileService {
  constructor(private readonly vault: Vault) {}

  async saveFiles(
    recordId: string,
    created: string,
    files: readonly AttachmentFileLike[],
    startIndex = 0
  ): Promise<string[]> {
    const createdPaths: string[] = [];
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        if (file.size > MAX_ATTACHMENT_BYTES) {
          throw new Error(`File exceeds ${MAX_ATTACHMENT_BYTES} bytes`);
        }
        const path = this.uniquePath(buildFilePath(
          recordId,
          created,
          startIndex + index,
          file.name
        ));
        await this.ensureFolder(path.slice(0, path.lastIndexOf("/")));
        await this.vault.createBinary(path, await file.arrayBuffer());
        createdPaths.push(path);
      }
      return createdPaths;
    } catch (error) {
      await this.trashPaths(createdPaths);
      throw error;
    }
  }

  async trashPaths(paths: readonly string[]): Promise<string[]> {
    const failed: string[] = [];
    for (const path of paths) {
      const file = this.vault.getAbstractFileByPath(normalizePath(path));
      if (!(file instanceof TFile)) continue;
      try {
        await this.vault.trash(file, false);
      } catch {
        failed.push(path);
      }
    }
    return failed;
  }

  getFile(path: string): TFile | null {
    const file = this.vault.getAbstractFileByPath(normalizePath(path));
    return file instanceof TFile ? file : null;
  }

  info(path: string): StoredFileInfo {
    const file = this.getFile(path);
    const name = attachmentDisplayName(path);
    const extension = name.includes(".") ? name.split(".").at(-1)?.toLocaleUpperCase() ?? "文件" : "文件";
    return {
      path,
      name,
      extension,
      size: file?.stat?.size ?? null,
      exists: file !== null
    };
  }

  private uniquePath(preferred: string): string {
    if (!this.vault.getAbstractFileByPath(preferred)) return preferred;
    const dot = preferred.lastIndexOf(".");
    const slash = preferred.lastIndexOf("/");
    const hasExtension = dot > slash;
    const stem = hasExtension ? preferred.slice(0, dot) : preferred;
    const extension = hasExtension ? preferred.slice(dot) : "";
    let suffix = 2;
    let candidate = `${stem}-${suffix}${extension}`;
    while (this.vault.getAbstractFileByPath(candidate)) {
      suffix += 1;
      candidate = `${stem}-${suffix}${extension}`;
    }
    return candidate;
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
