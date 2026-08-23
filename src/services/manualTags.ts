import type { StoredDoudouRecord, TagOption } from "../types";

const TAG_CHARACTER = /[\p{L}\p{N}_-]/u;
const TAG_BOUNDARY = /[\s，。！？、；：,.!?;:()（）\[\]【】{}“”‘’]/u;
const CONFIRMED_TAG_PATTERN = /(^|[\s，。！？、；：,.!?;:()（）\[\]【】{}“”‘’])#([\p{L}\p{N}_-]+)(?= )/gu;

export interface ManualTagRange {
  name: string;
  start: number;
  end: number;
}

export interface ManualTagInput {
  query: string;
  replacementStart: number;
  replacementEnd: number;
}

export interface ManualTagCompletion {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export function parseConfirmedManualTagRanges(content: string): ManualTagRange[] {
  const ranges: ManualTagRange[] = [];
  for (const match of content.matchAll(CONFIRMED_TAG_PATTERN)) {
    const boundary = match[1] ?? "";
    const name = match[2];
    const start = (match.index ?? 0) + boundary.length;
    ranges.push({ name, start, end: start + name.length + 1 });
  }
  return ranges;
}

export function extractConfirmedManualTags(content: string): string[] {
  return [...new Set(parseConfirmedManualTagRanges(content).map((range) => range.name))];
}

export function findManualTagInput(
  content: string,
  selectionStart: number,
  selectionEnd = selectionStart
): ManualTagInput | null {
  if (selectionStart !== selectionEnd || selectionStart < 0 || selectionStart > content.length) {
    return null;
  }

  let hash = selectionStart - 1;
  while (hash >= 0 && TAG_CHARACTER.test(content[hash])) hash -= 1;
  if (hash < 0 || content[hash] !== "#") return null;
  if (hash > 0 && !TAG_BOUNDARY.test(content[hash - 1])) return null;

  let replacementEnd = selectionStart;
  while (replacementEnd < content.length && TAG_CHARACTER.test(content[replacementEnd])) {
    replacementEnd += 1;
  }
  if (content[replacementEnd] === " ") replacementEnd += 1;
  return {
    query: content.slice(hash + 1, selectionStart),
    replacementStart: hash,
    replacementEnd
  };
}

export function applyManualTagCompletion(
  content: string,
  input: ManualTagInput,
  tagName: string
): ManualTagCompletion {
  const inserted = `#${tagName} `;
  const value = content.slice(0, input.replacementStart) + inserted +
    content.slice(input.replacementEnd);
  const selection = input.replacementStart + inserted.length;
  return { value, selectionStart: selection, selectionEnd: selection };
}

export function collectConfirmedManualTagOptions(
  records: readonly StoredDoudouRecord[]
): TagOption[] {
  const statistics = new Map<string, TagOption>();
  for (const record of records) {
    const usedAt = record.updated ?? record.created;
    for (const range of parseConfirmedManualTagRanges(record.content)) {
      const current = statistics.get(range.name);
      if (current) {
        current.count += 1;
        if (usedAt > current.lastUsed) current.lastUsed = usedAt;
      } else {
        statistics.set(range.name, { name: range.name, count: 1, lastUsed: usedAt });
      }
    }
  }
  return [...statistics.values()].sort(
    (a, b) => b.lastUsed.localeCompare(a.lastUsed) ||
      b.count - a.count ||
      a.name.localeCompare(b.name, "zh-CN")
  );
}

export function manualTagSuggestions(
  options: readonly TagOption[],
  query: string,
  confirmedInDraft: ReadonlySet<string>,
  limit = 8
): TagOption[] {
  const normalizedQuery = query.toLocaleLowerCase();
  return options
    .filter((option) => !confirmedInDraft.has(option.name))
    .map((option) => {
      const name = option.name.toLocaleLowerCase();
      const matchRank = normalizedQuery.length === 0
        ? 0
        : name.startsWith(normalizedQuery)
          ? 0
          : name.includes(normalizedQuery)
            ? 1
            : 2;
      return { option, matchRank };
    })
    .filter(({ matchRank }) => matchRank < 2)
    .sort((a, b) => a.matchRank - b.matchRank)
    .slice(0, limit)
    .map(({ option }) => option);
}
