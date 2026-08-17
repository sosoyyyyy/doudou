import { requestUrl } from "obsidian";
import {
  AI_TAG_LIMIT,
  AI_TAG_MAX_LENGTH,
  CATEGORIES,
  DEEPSEEK_BASE_URL
} from "../constants";
import { cleanTagName } from "../data/recordCodec";
import type {
  DeepSeekModel,
  DoudouRecord,
  StoredDoudouRecord
} from "../types";

export type DeepSeekErrorKind =
  | "missing-key"
  | "auth"
  | "quota"
  | "network"
  | "service"
  | "invalid-response";

export class DeepSeekError extends Error {
  constructor(readonly kind: DeepSeekErrorKind) {
    super(kind);
    this.name = "DeepSeekError";
  }
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new DeepSeekError("invalid-response");
  }
}

export function parseAiTags(raw: string, manualTags: readonly string[]): string[] {
  const parsed = parseJson(raw);
  if (!parsed || typeof parsed !== "object") throw new DeepSeekError("invalid-response");
  const values = (parsed as { tags?: unknown }).tags;
  if (!Array.isArray(values)) throw new DeepSeekError("invalid-response");
  const excluded = new Set([...manualTags, ...CATEGORIES]);
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const tag = cleanTagName(value);
    if (
      !tag ||
      tag.length > AI_TAG_MAX_LENGTH ||
      excluded.has(tag) ||
      result.includes(tag)
    ) {
      continue;
    }
    result.push(tag);
    if (result.length >= AI_TAG_LIMIT) break;
  }
  return result;
}

export function parseKeywords(raw: string): string[] {
  const parsed = parseJson(raw);
  if (!parsed || typeof parsed !== "object") throw new DeepSeekError("invalid-response");
  const values = (parsed as { keywords?: unknown }).keywords;
  if (!Array.isArray(values)) throw new DeepSeekError("invalid-response");
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const keyword = cleanTagName(value);
    if (!keyword || keyword.length > 32 || result.includes(keyword)) continue;
    result.push(keyword);
    if (result.length >= 10) break;
  }
  return result;
}

export function deepSeekErrorMessage(error: unknown): string {
  if (!(error instanceof DeepSeekError)) return "兜兜暂时翻不到，再试一次吧";
  if (error.kind === "missing-key") return "还没有设置 DeepSeek API Key";
  if (error.kind === "auth") return "DeepSeek API Key 好像不能用了";
  if (error.kind === "quota") return "DeepSeek 余额不足或额度受限";
  if (error.kind === "service") return "DeepSeek 服务暂时不可用";
  return "兜兜暂时翻不到，再试一次吧";
}

export class DeepSeekClient {
  constructor(
    private readonly apiKey: string,
    private readonly model: DeepSeekModel
  ) {}

  async testConnection(): Promise<void> {
    const raw = await this.complete([
      { role: "system", content: "只返回 json 对象，不要解释。" },
      { role: "user", content: "返回 json：{\"ok\":true}" }
    ], true);
    const parsed = parseJson(raw);
    if (!parsed || typeof parsed !== "object") {
      throw new DeepSeekError("invalid-response");
    }
  }

  async generateAiTags(record: DoudouRecord): Promise<string[]> {
    const raw = await this.complete([
      {
        role: "system",
        content: [
          "你为个人资料生成便于搜索的简洁中文隐藏标签。",
          "只返回 json，不要 markdown、解释或完整句子。",
          "返回示例：{\"tags\":[\"手机使用\",\"注意力\"]}。",
          "生成 3 到 8 个标签，不要带 #，不要输出生活、工作、副业，避免重复手动标签。"
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          content: record.content,
          category: record.category,
          tags: record.tags
        })
      }
    ], true);
    return parseAiTags(raw, record.tags);
  }

  async expandKeywords(question: string): Promise<string[]> {
    const raw = await this.complete([
      {
        role: "system",
        content: [
          "为中文个人资料检索扩展少量关键词。",
          "只返回 json，不要解释。",
          "返回示例：{\"keywords\":[\"刷手机\",\"手机使用\",\"注意力\"]}。",
          "最多 10 个简短关键词。"
        ].join("\n")
      },
      { role: "user", content: question }
    ], true);
    return parseKeywords(raw);
  }

  async answerQuestion(
    question: string,
    records: readonly StoredDoudouRecord[]
  ): Promise<string> {
    const sources = records.map((record) => ({
      id: record.id,
      created: record.created,
      category: record.category,
      tags: record.tags,
      content: record.content
    }));
    return this.complete([
      {
        role: "system",
        content: [
          "你是个人资料查找助手兜兜，只能依据用户提供的真实记录回答。",
          "不要使用外部知识补充个人事实，不要编造记录。",
          "证据不足时明确说没有找到相关记录。",
          "回答简洁自然，不寒暄，不询问是否还需要帮助。"
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({ question, records: sources })
      }
    ], false);
  }

  private async complete(messages: ChatMessage[], jsonOutput: boolean): Promise<string> {
    if (!this.apiKey) throw new DeepSeekError("missing-key");
    let response;
    try {
      response = await requestUrl({
        url: `${DEEPSEEK_BASE_URL}/chat/completions`,
        method: "POST",
        contentType: "application/json",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          messages,
          thinking: { type: "disabled" },
          ...(jsonOutput ? { response_format: { type: "json_object" } } : {})
        }),
        throw: false
      });
    } catch {
      throw new DeepSeekError("network");
    }

    if (response.status === 401 || response.status === 403) {
      throw new DeepSeekError("auth");
    }
    if (response.status === 402 || response.status === 429) {
      throw new DeepSeekError("quota");
    }
    if (response.status < 200 || response.status >= 300) {
      throw new DeepSeekError("service");
    }
    const content = (response.json as ChatResponse)?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new DeepSeekError("invalid-response");
    }
    return content.trim();
  }
}
