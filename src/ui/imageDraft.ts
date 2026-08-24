export interface PendingImage {
  id: string;
  file: File;
  previewUrl: string;
}

export interface ClipboardItemLike {
  kind: string;
  type: string;
  getAsFile(): File | null;
}

const previewRetainers = new Map<string, number>();
const deferredPreviewReleases = new Set<string>();

export function imageFilesFromClipboardItems(
  items: ArrayLike<ClipboardItemLike> | null | undefined
): File[] {
  if (!items) return [];
  const files: File[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item || item.kind !== "file" || !item.type.toLocaleLowerCase().startsWith("image/")) {
      continue;
    }
    try {
      const file = item.getAsFile();
      if (file) files.push(file);
    } catch {
      // Some mobile WebViews expose a clipboard item but deny reading it.
    }
  }
  return files;
}

export function createPendingImages(files: readonly File[]): PendingImage[] {
  return files.map((file, index) => ({
    id: `${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    file,
    previewUrl: URL.createObjectURL(file)
  }));
}

export function releasePendingImages(images: readonly PendingImage[]): void {
  for (const image of images) {
    if ((previewRetainers.get(image.previewUrl) ?? 0) > 0) deferredPreviewReleases.add(image.previewUrl);
    else URL.revokeObjectURL(image.previewUrl);
  }
}

export function retainPendingPreviewUrls(urls: readonly string[]): () => void {
  for (const url of urls) previewRetainers.set(url, (previewRetainers.get(url) ?? 0) + 1);
  let retained = true;
  return () => {
    if (!retained) return;
    retained = false;
    for (const url of urls) {
      const next = Math.max(0, (previewRetainers.get(url) ?? 1) - 1);
      if (next > 0) previewRetainers.set(url, next);
      else {
        previewRetainers.delete(url);
        if (deferredPreviewReleases.delete(url)) URL.revokeObjectURL(url);
      }
    }
  };
}
