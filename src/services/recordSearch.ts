import type {
  AskSource,
  LibraryFilters,
  StoredDoudouRecord,
  TagOption
} from "../types";

function attachmentFileNames(record: StoredDoudouRecord): string[] {
  return (record.files ?? []).map((path) => path.replace(/\\/g, "/").split("/").at(-1) ?? "");
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function searchTerms(question: string, expanded: readonly string[]): string[] {
  const direct = [question, ...expanded]
    .map(normalized)
    .filter((term) => term.length >= 2);
  const compactChinese = question.replace(/[^\u3400-\u9fff]/g, "");
  const bigrams: string[] = [];
  for (let index = 0; index < compactChinese.length - 1; index += 1) {
    bigrams.push(compactChinese.slice(index, index + 2));
  }
  const words = question
    .toLocaleLowerCase()
    .match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? [];
  return [...new Set([...direct, ...bigrams, ...words])].slice(0, 48);
}

export function rankRecordsForQuestion(
  records: readonly StoredDoudouRecord[],
  question: string,
  expandedKeywords: readonly string[],
  limit: number
): AskSource[] {
  const terms = searchTerms(question, expandedKeywords);
  if (terms.length === 0) return [];

  return records
    .map((record) => {
      const content = normalized(record.content);
      const manualTags = record.tags.map(normalized);
      const aiTags = (record.aiTags ?? []).map(normalized);
      const title = normalized(record.title ?? "");
      const folder = normalized(record.folder);
      const fileNames = attachmentFileNames(record).map(normalized);
      let score = 0;
      for (const term of terms) {
        if (aiTags.some((tag) => tag.includes(term) || term.includes(tag))) score += 9;
        if (manualTags.some((tag) => tag.includes(term) || term.includes(tag))) score += 8;
        if (content.includes(term)) score += term.length >= 4 ? 7 : 3;
        if (title.includes(term)) score += 10;
        if (folder.includes(term)) score += 2;
        if (fileNames.some((file) => file.includes(term))) score += 4;
      }
      return { record, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || b.record.created.localeCompare(a.record.created))
    .slice(0, limit);
}

export function filterRecords(
  records: readonly StoredDoudouRecord[],
  filters: LibraryFilters
): StoredDoudouRecord[] {
  const query = normalized(filters.query);
  return records.filter((record) => {
    if (filters.folder && record.folder !== filters.folder) {
      return false;
    }
    if ([...filters.tags].some((tag) => !record.tags.includes(tag))) {
      return false;
    }
    if (!query) return true;

    const manualTagText = record.tags.flatMap((tag) => [tag, `#${tag}`]).join(" ");
    const hiddenTagText = (record.aiTags ?? []).join(" ");
    const fileNameText = attachmentFileNames(record).join("\n");
    const haystack = `${record.title ?? ""}\n${record.content}\n${record.folder}\n${manualTagText}\n${hiddenTagText}\n${fileNameText}`
      .toLocaleLowerCase();
    return haystack.includes(query);
  });
}

export function collectTagOptions(
  records: readonly StoredDoudouRecord[]
): TagOption[] {
  const statistics = new Map<string, TagOption>();
  for (const record of records) {
    for (const tag of record.tags) {
      const current = statistics.get(tag);
      if (current) {
        current.count += 1;
        if (record.created > current.lastUsed) current.lastUsed = record.created;
      } else {
        statistics.set(tag, { name: tag, count: 1, lastUsed: record.created });
      }
    }
  }

  return [...statistics.values()].sort(
    (a, b) => b.lastUsed.localeCompare(a.lastUsed) ||
      b.count - a.count ||
      a.name.localeCompare(b.name, "zh-CN")
  );
}
