export interface PendingImage {
  id: string;
  file: File;
  previewUrl: string;
}

export function createPendingImages(files: readonly File[]): PendingImage[] {
  return files.map((file, index) => ({
    id: `${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    file,
    previewUrl: URL.createObjectURL(file)
  }));
}

export function releasePendingImages(images: readonly PendingImage[]): void {
  for (const image of images) URL.revokeObjectURL(image.previewUrl);
}
