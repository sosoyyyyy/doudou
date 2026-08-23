import type { ImageFileLike, ImageService } from "../attachments/ImageService";
import type { AttachmentFileLike, FileService } from "../attachments/FileService";
import type {
  DoudouRepository,
  RecordChanges
} from "../data/DoudouRepository";
import type { DoudouRecord, StoredDoudouRecord } from "../types";
import { resolveImageOrder, type ImageOrderItem } from "../ui/imageReorder";

export class RecordService {
  constructor(
    private readonly repository: DoudouRepository,
    private readonly images: ImageService,
    private readonly files: FileService
  ) {}

  async create(
    record: DoudouRecord,
    imageFiles: readonly ImageFileLike[],
    attachmentFiles: readonly AttachmentFileLike[] = []
  ): Promise<StoredDoudouRecord> {
    const imagePaths = await this.images.saveImages(
      record.id,
      record.created,
      imageFiles
    );
    let filePaths: string[] = [];
    try {
      filePaths = await this.files.saveFiles(record.id, record.created, attachmentFiles);
      return await this.repository.save({
        ...record,
        images: imagePaths,
        files: filePaths
      });
    } catch (error) {
      await this.images.trashPaths(imagePaths);
      await this.files.trashPaths(filePaths);
      throw error;
    }
  }

  async update(
    record: StoredDoudouRecord,
    changes: Omit<RecordChanges, "images" | "files">,
    newImages: readonly ImageFileLike[],
    removedImagePaths: readonly string[],
    newFiles: readonly AttachmentFileLike[] = [],
    removedFilePaths: readonly string[] = [],
    imageOrder?: readonly ImageOrderItem[]
  ): Promise<StoredDoudouRecord> {
    const removed = new Set(removedImagePaths);
    const retained = (record.images ?? []).filter((path) => !removed.has(path));
    const created = await this.images.saveImages(
      record.id,
      record.created,
      newImages,
      (record.images ?? []).length
    );
    const removedFiles = new Set(removedFilePaths);
    const retainedFiles = (record.files ?? []).filter((path) => !removedFiles.has(path));
    let createdFiles: string[] = [];
    try {
      createdFiles = await this.files.saveFiles(
        record.id,
        record.created,
        newFiles,
        (record.files ?? []).length
      );
      const updated = await this.repository.update(record, {
        ...changes,
        images: imageOrder
          ? resolveImageOrder(imageOrder, created)
          : [...retained, ...created],
        files: [...retainedFiles, ...createdFiles]
      });
      await this.images.trashPaths(removedImagePaths);
      await this.files.trashPaths(removedFilePaths);
      return updated;
    } catch (error) {
      await this.images.trashPaths(created);
      await this.files.trashPaths(createdFiles);
      throw error;
    }
  }

  async delete(record: StoredDoudouRecord): Promise<void> {
    await this.repository.delete(record);
    await this.images.trashPaths(record.images ?? []);
    await this.files.trashPaths(record.files ?? []);
  }
}
