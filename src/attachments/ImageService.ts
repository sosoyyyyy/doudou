import { normalizePath, TFile, Vault } from "obsidian";
import { DOUDOU_ASSETS_FOLDER } from "../constants";

export interface ImageFileLike {
  name: string;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

const SUPPORTED_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "webp", "gif", "heic", "heif"
]);

const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif"
};

export function imageExtension(file: Pick<ImageFileLike, "name" | "type">): string | null {
  const candidate = file.name.split(".").pop()?.toLocaleLowerCase() ?? "";
  if (SUPPORTED_EXTENSIONS.has(candidate)) return candidate;
  return MIME_EXTENSIONS[file.type.toLocaleLowerCase()] ?? null;
}

export function buildImagePath(
  recordId: string,
  created: string,
  index: number,
  extension: string
): string {
  const date = new Date(created);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const sequence = String(index + 1).padStart(2, "0");
  return normalizePath(
    `${DOUDOU_ASSETS_FOLDER}/${year}/${month}/${recordId}-${sequence}.${extension}`
  );
}

export class ImageService {
  constructor(private readonly vault: Vault) {}

  async saveImages(
    recordId: string,
    created: string,
    files: readonly ImageFileLike[],
    startIndex = 0
  ): Promise<string[]> {
    if (files.length === 0) return [];
    const createdPaths: string[] = [];
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const extension = imageExtension(file);
        if (!extension) throw new Error("Unsupported image format");
        const preferred = buildImagePath(recordId, created, startIndex + index, extension);
        const path = this.uniquePath(preferred);
        await this.ensureFolder(path.substring(0, path.lastIndexOf("/")));
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

  resourcePath(path: string): string | null {
    const file = this.vault.getAbstractFileByPath(normalizePath(path));
    return file instanceof TFile ? this.vault.getResourcePath(file) : null;
  }

  private uniquePath(preferred: string): string {
    if (!this.vault.getAbstractFileByPath(preferred)) return preferred;
    const dot = preferred.lastIndexOf(".");
    const stem = dot >= 0 ? preferred.slice(0, dot) : preferred;
    const extension = dot >= 0 ? preferred.slice(dot) : "";
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
