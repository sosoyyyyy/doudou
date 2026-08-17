import type { DoudouRepository } from "../data/DoudouRepository";
import type { StoredDoudouRecord } from "../types";
export interface AiTagClient {
  generateAiTags(record: StoredDoudouRecord): Promise<string[]>;
}

export class AiTagService {
  private generations = new Map<string, number>();

  constructor(
    private readonly repository: Pick<DoudouRepository, "updateAiTags">,
    private readonly clientProvider: () => AiTagClient | null,
    private readonly isEnabled: () => boolean
  ) {}

  async enrich(record: StoredDoudouRecord): Promise<boolean> {
    if (!this.isEnabled() || !record.content.trim()) return false;
    const client = this.clientProvider();
    if (!client) return false;
    const generation = (this.generations.get(record.id) ?? 0) + 1;
    this.generations.set(record.id, generation);
    try {
      const tags = await client.generateAiTags(record);
      if (this.generations.get(record.id) !== generation) return false;
      // Only a successful AI response replaces old hidden tags. Failures retain them.
      await this.repository.updateAiTags(record, tags);
      return true;
    } catch {
      return false;
    } finally {
      if (this.generations.get(record.id) === generation) {
        this.generations.delete(record.id);
      }
    }
  }
}
