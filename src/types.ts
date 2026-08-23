export interface DoudouRecord {
  id: string;
  title?: string;
  content: string;
  created: string;
  updated?: string;
  folder: string;
  tags: string[];
  aiTags?: string[];
  images?: string[];
  files?: string[];
}

export interface StoredDoudouRecord extends DoudouRecord {
  path: string;
}

export type DoudouPage = "all" | "library";

export interface LibraryFilters {
  query: string;
  folder?: string;
  tags: ReadonlySet<string>;
}

export interface FolderSummary {
  name: string;
  count: number;
}

export interface TagOption {
  name: string;
  count: number;
  lastUsed: string;
}

export type DeepSeekModel = "deepseek-v4-flash" | "deepseek-v4-pro";

export interface DoudouSettings {
  deepSeekApiKey: string;
  deepSeekModel: DeepSeekModel;
  autoAiTags: boolean;
  folderOrder: string[];
}

export interface AskSource {
  record: StoredDoudouRecord;
  score: number;
}

export interface AskResult {
  answer: string;
  sources: StoredDoudouRecord[];
  noMatches: boolean;
}
