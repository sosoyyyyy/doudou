import type { ImageFileLike, ImageService } from "../attachments/ImageService";
import type {
  DoudouRepository,
  RecordChanges
} from "../data/DoudouRepository";
import type { DoudouRecord, StoredDoudouRecord } from "../types";

export class RecordService {
  constructor(
    private readonly repository: DoudouRepository,
    private readonly images: ImageService
  ) {}

  async create(
    record: DoudouRecord,
    imageFiles: readonly ImageFileLike[]
  ): Promise<StoredDoudouRecord> {
    const imagePaths = await this.images.saveImages(
      record.id,
      record.created,
      imageFiles
    );
    try {
      return await this.repository.save({ ...record, images: imagePaths });
    } catch (error) {
      await this.images.trashPaths(imagePaths);
      throw error;
    }
  }

  async update(
    record: StoredDoudouRecord,
    changes: Omit<RecordChanges, "images">,
    newImages: readonly ImageFileLike[],
    removedImagePaths: readonly string[]
  ): Promise<StoredDoudouRecord> {
    const removed = new Set(removedImagePaths);
    const retained = (record.images ?? []).filter((path) => !removed.has(path));
    const created = await this.images.saveImages(
      record.id,
      record.created,
      newImages,
      (record.images ?? []).length
    );
    try {
      const updated = await this.repository.update(record, {
        ...changes,
        images: [...retained, ...created]
      });
      await this.images.trashPaths(removedImagePaths);
      return updated;
    } catch (error) {
      await this.images.trashPaths(created);
      throw error;
    }
  }

  async delete(record: StoredDoudouRecord): Promise<void> {
    await this.repository.delete(record);
    await this.images.trashPaths(record.images ?? []);
  }
}
