export interface PendingFile {
  id: string;
  file: File;
}

export function createPendingFiles(files: readonly File[]): PendingFile[] {
  return files.map((file, index) => ({
    id: `${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    file
  }));
}

export function hasSavableRecordDraft(
  title: string,
  content: string,
  imageCount: number,
  fileCount: number
): boolean {
  return title.trim().length > 0 ||
    content.trim().length > 0 ||
    imageCount > 0 ||
    fileCount > 0;
}
