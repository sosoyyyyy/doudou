export type Category = "生活" | "工作" | "副业";

export interface DoudouRecord {
  id: string;
  content: string;
  created: string;
  updated?: string;
  category: Category;
  tags: string[];
  aiTags?: string[];
  images?: string[];
}

export interface StoredDoudouRecord extends DoudouRecord {
  path: string;
}

export type DoudouPage = "chat" | "library";

export type CategoryFilter = Category | "全部";

export interface LibraryFilters {
  query: string;
  category: CategoryFilter;
  tags: ReadonlySet<string>;
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
