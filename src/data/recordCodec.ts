import { CATEGORIES } from "../constants";
import type { Category, DoudouRecord, StoredDoudouRecord } from "../types";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function isCategory(value: unknown): value is Category {
  return typeof value === "string" && CATEGORIES.includes(value as Category);
}

function dateString(value: unknown): string | null {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return null;
}

export function cleanTagName(value: string): string {
  return value.trim().replace(/^#+/, "").trim();
}

export function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const tags = value
    .filter((tag): tag is string => typeof tag === "string")
    .map(cleanTagName)
    .filter(Boolean);
  return [...new Set(tags)];
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

export function serializeRecord(record: DoudouRecord): string {
  const tags = record.tags.map(yamlString).join(", ");
  const aiTags = (record.aiTags ?? []).map(yamlString).join(", ");
  const images = (record.images ?? []).map(yamlString).join(", ");
  const frontmatter = [
    "---",
    `id: ${yamlString(record.id)}`,
    `created: ${yamlString(record.created)}`,
    ...(record.updated ? [`updated: ${yamlString(record.updated)}`] : []),
    `category: ${yamlString(record.category)}`,
    `tags: [${tags}]`,
    `ai_tags: [${aiTags}]`,
    `images: [${images}]`,
    "---"
  ].join("\n");
  return `${frontmatter}\n\n${record.content}`;
}

export function extractFrontmatter(markdown: string): {
  yaml: string;
  content: string;
} | null {
  const match = markdown.match(FRONTMATTER_PATTERN);
  if (!match) return null;

  let content = markdown.slice(match[0].length);
  if (content.startsWith("\r\n")) content = content.slice(2);
  else if (content.startsWith("\n")) content = content.slice(1);
  return { yaml: match[1], content };
}

export function recordFromFrontmatter(
  data: unknown,
  content: string,
  path: string
): StoredDoudouRecord | null {
  if (!data || typeof data !== "object") return null;
  const frontmatter = data as Record<string, unknown>;
  const created = dateString(frontmatter.created);
  const updated = frontmatter.updated === undefined
    ? undefined
    : dateString(frontmatter.updated) ?? undefined;

  if (
    typeof frontmatter.id !== "string" ||
    !created ||
    !isCategory(frontmatter.category)
  ) {
    return null;
  }

  return {
    id: frontmatter.id,
    created,
    ...(updated ? { updated } : {}),
    category: frontmatter.category,
    tags: normalizeTags(frontmatter.tags),
    aiTags: normalizeTags(frontmatter.ai_tags),
    images: normalizeImagePaths(frontmatter.images),
    content,
    path
  };
}

export function normalizeImagePaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const paths = value
    .filter((path): path is string => typeof path === "string")
    .map((path) => path.trim().replace(/\\/g, "/"))
    .filter((path) =>
      path.length > 0 &&
      !path.startsWith("/") &&
      !/^[A-Za-z]:\//.test(path) &&
      !/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(path) &&
      !path.split("/").includes("..")
    );
  return [...new Set(paths)];
}
