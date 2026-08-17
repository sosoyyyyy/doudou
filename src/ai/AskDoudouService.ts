import { ASK_CANDIDATE_LIMIT } from "../constants";
import type { DoudouRepository } from "../data/DoudouRepository";
import { rankRecordsForQuestion } from "../services/recordSearch";
import type { AskResult, StoredDoudouRecord } from "../types";
import { DeepSeekError } from "./DeepSeekClient";

export interface AskClient {
  expandKeywords(question: string): Promise<string[]>;
  answerQuestion(
    question: string,
    records: readonly StoredDoudouRecord[]
  ): Promise<string>;
}

export class AskDoudouService {
  constructor(
    private readonly repository: Pick<DoudouRepository, "loadAll">,
    private readonly clientProvider: () => AskClient | null
  ) {}

  async ask(question: string): Promise<AskResult> {
    const client = this.clientProvider();
    if (!client) throw new DeepSeekError("missing-key");

    let keywords: string[] = [];
    try {
      keywords = await client.expandKeywords(question);
    } catch {
      // Keyword expansion is optional; local retrieval still uses the question.
    }

    const records = await this.repository.loadAll();
    const sources = rankRecordsForQuestion(
      records,
      question,
      keywords,
      ASK_CANDIDATE_LIMIT
    ).map((candidate) => candidate.record);
    if (sources.length === 0) {
      return {
        answer: "兜兜翻了一圈，没有找到相关记录诶",
        sources: [],
        noMatches: true
      };
    }

    const answer = await client.answerQuestion(question, sources);
    return { answer, sources, noMatches: false };
  }
}
