import assert from "node:assert/strict";
import test from "node:test";
import type { Vault } from "obsidian";
import { TFile } from "obsidian";
import { AiTagService } from "../src/ai/AiTagService";
import { AskDoudouService } from "../src/ai/AskDoudouService";
import { DeepSeekError, parseAiTags } from "../src/ai/DeepSeekClient";
import {
  buildImagePath,
  ImageService,
  type ImageFileLike
} from "../src/attachments/ImageService";
import {
  buildRecordPath,
  DoudouRepository
} from "../src/data/DoudouRepository";
import {
  extractFrontmatter,
  recordFromFrontmatter,
  serializeRecord
} from "../src/data/recordCodec";
import {
  collectTagOptions,
  filterRecords
} from "../src/services/recordSearch";
import { RecordService } from "../src/services/RecordService";
import type { StoredDoudouRecord } from "../src/types";
import { metaText, writeClipboardText } from "../src/ui/uiHelpers";
import { findRemotelySaveStartSyncCommand } from "../src/ui/remotelySave";

class FakeVault {
  readonly files = new Map<string, { file: TFile; content: string }>();
  readonly folders = new Set<string>();
  failNextModify = false;
  failNextRename = false;

  getMarkdownFiles(): TFile[] {
    return [...this.files.values()].map((entry) => entry.file);
  }

  getAbstractFileByPath(path: string): TFile | object | null {
    return this.files.get(path)?.file ?? (this.folders.has(path) ? {} : null);
  }

  async createFolder(path: string): Promise<void> {
    this.folders.add(path);
  }

  async create(path: string, content: string): Promise<TFile> {
    const file = new TFile(path);
    this.files.set(path, { file, content });
    return file;
  }

  async createBinary(path: string, content: ArrayBuffer): Promise<TFile> {
    const file = new TFile(path);
    this.files.set(path, { file, content: `binary:${content.byteLength}` });
    return file;
  }

  async cachedRead(file: TFile): Promise<string> {
    const entry = this.files.get(file.path);
    if (!entry) throw new Error("Missing fake file");
    return entry.content;
  }

  async modify(file: TFile, content: string): Promise<void> {
    if (this.failNextModify) {
      this.failNextModify = false;
      throw new Error("Fake modify failure");
    }
    this.files.set(file.path, { file, content });
  }

  async rename(file: TFile, path: string): Promise<void> {
    if (this.failNextRename) {
      this.failNextRename = false;
      throw new Error("Fake rename failure");
    }
    const entry = this.files.get(file.path);
    if (!entry) throw new Error("Missing fake file");
    if (this.files.has(path)) throw new Error("Target already exists");
    this.files.delete(file.path);
    file.path = path;
    this.files.set(path, entry);
  }

  async trash(file: TFile): Promise<void> {
    this.files.delete(file.path);
  }

  getResourcePath(file: TFile): string {
    return `app://vault/${file.path}`;
  }
}

function stored(overrides: Partial<StoredDoudouRecord> = {}): StoredDoudouRecord {
  return {
    id: "id-1",
    content: "今天记录一只猫",
    created: "2026-08-17T08:00:00.000Z",
    category: "生活",
    tags: ["日记", "猫"],
    path: "兜兜/2026/08/record.md",
    ...overrides
  };
}

test("Markdown codec preserves content and supports legacy records without updated", () => {
  const original = stored({ content: "\n保留开头和结尾\n" });
  const markdown = serializeRecord(original);
  const extracted = extractFrontmatter(markdown);
  assert.ok(extracted);
  assert.equal(extracted.content, original.content);

  const legacy = recordFromFrontmatter({
    id: "legacy",
    created: "2026-08-16T09:00:00.000Z",
    category: "工作",
    tags: ["#待办", "待办", " 会议 "]
  }, "旧记录正文", "兜兜/2026/08/legacy.md");
  assert.ok(legacy);
  assert.equal(legacy.updated, undefined);
  assert.deepEqual(legacy.tags, ["待办", "会议"]);
  assert.deepEqual(legacy.images, []);
  assert.deepEqual(legacy.aiTags, []);
});

test("Markdown codec round-trips images, hidden AI tags and updated", () => {
  const record = stored({
    updated: "2026-08-17T10:00:00.000Z",
    images: [
      "兜兜/assets/2026/08/id-1-01.jpg",
      "兜兜/assets/2026/08/id-1-02.webp"
    ],
    aiTags: ["注意力", "手机使用"]
  });
  const markdown = serializeRecord(record);
  const extracted = extractFrontmatter(markdown);
  assert.ok(extracted);
  assert.match(extracted.yaml, /ai_tags: \["注意力", "手机使用"\]/);
  assert.match(extracted.yaml, /images: \["兜兜\/assets\/2026\/08\/id-1-01.jpg"/);
  const parsed = recordFromFrontmatter({
    id: record.id,
    created: record.created,
    updated: record.updated,
    category: record.category,
    tags: record.tags,
    ai_tags: record.aiTags,
    images: record.images
  }, record.content, record.path);
  assert.deepEqual(parsed?.images, record.images);
  assert.deepEqual(parsed?.aiTags, record.aiTags);
  assert.equal(parsed?.updated, record.updated);
});

test("repository creates, reads, updates and trashes the same Markdown record", async () => {
  const fakeVault = new FakeVault();
  const repository = new DoudouRepository(fakeVault as unknown as Vault);
  const draft = repository.createRecord("原始正文", "生活", ["#日记", "日记"]);
  const created = await repository.save(draft);

  assert.equal(fakeVault.files.size, 1);
  assert.equal(created.tags.length, 1);
  assert.match(created.path, /^兜兜\/生活\/\d{4}\/\d{2}\//);
  assert.ok(repository.isDoudouPath(created.path));
  assert.equal((await repository.loadAll())[0].content, "原始正文");

  const updated = await repository.update(created, {
    content: "修改后的正文",
    category: "工作",
    tags: ["待办"]
  });
  assert.equal(updated.id, created.id);
  assert.equal(updated.created, created.created);
  assert.ok(updated.updated);
  assert.equal(updated.path, buildRecordPath("工作", created.created, created.path.split("/").at(-1)!));
  assert.equal(fakeVault.files.has(created.path), false);
  assert.equal(fakeVault.files.has(updated.path), true);
  assert.equal(fakeVault.files.size, 1);
  assert.match([...fakeVault.files.values()][0].content, /updated:/);

  repository.invalidateCache();
  const reread = (await repository.loadAll())[0];
  assert.equal(reread.content, "修改后的正文");
  assert.equal(reread.category, "工作");
  await repository.delete(reread);
  assert.equal(fakeVault.files.size, 0);
  assert.deepEqual(await repository.loadAll(), []);
  assert.equal(repository.isDoudouPath("其他项目/record.md"), false);
});

test("repository creates records inside each fixed category folder", async () => {
  for (const category of ["生活", "工作", "副业"] as const) {
    const fakeVault = new FakeVault();
    const repository = new DoudouRepository(fakeVault as unknown as Vault);
    const created = await repository.save(repository.createRecord("分类测试", category, []));
    assert.match(created.path, new RegExp(`^兜兜/${category}/\\d{4}/\\d{2}/`));
  }
});

test("category edits move Markdown while preserving identity, filename and images", async () => {
  const fakeVault = new FakeVault();
  const repository = new DoudouRepository(fakeVault as unknown as Vault);
  const original = await repository.save({
    ...repository.createRecord("原始正文", "生活", ["日记"]),
    images: ["兜兜/assets/2026/08/keep-me.jpg"]
  });
  const fileName = original.path.split("/").at(-1);
  const updated = await repository.update(original, {
    content: "修改正文",
    category: "副业",
    tags: ["灵感"],
    images: original.images
  });

  assert.equal(updated.id, original.id);
  assert.equal(updated.created, original.created);
  assert.equal(updated.path.split("/").at(-1), fileName);
  assert.match(updated.path, /^兜兜\/副业\/\d{4}\/\d{2}\//);
  assert.deepEqual(updated.images, original.images);
  assert.equal(fakeVault.files.has(original.path), false);
  assert.equal(fakeVault.files.size, 1);
});

test("editing a legacy record migrates only that record to its category folder", async () => {
  const fakeVault = new FakeVault();
  const legacyPath = "兜兜/2026/08/legacy.md";
  await fakeVault.create(legacyPath, serializeRecord(stored({ path: legacyPath })));
  const repository = new DoudouRepository(fakeVault as unknown as Vault);
  const legacy = (await repository.loadAll())[0];
  const migrated = await repository.update(legacy, {
    content: legacy.content,
    category: legacy.category,
    tags: legacy.tags,
    images: legacy.images
  });

  assert.equal(migrated.path, "兜兜/生活/2026/08/legacy.md");
  assert.equal(fakeVault.files.has(legacyPath), false);
  assert.equal(fakeVault.files.has(migrated.path), true);
});

test("failed category writes restore the legacy path and original Markdown", async () => {
  const fakeVault = new FakeVault();
  const legacyPath = "兜兜/2026/08/rollback.md";
  const originalMarkdown = serializeRecord(stored({ path: legacyPath }));
  await fakeVault.create(legacyPath, originalMarkdown);
  const repository = new DoudouRepository(fakeVault as unknown as Vault);
  const legacy = (await repository.loadAll())[0];
  fakeVault.failNextModify = true;

  await assert.rejects(() => repository.update(legacy, {
    content: "不应保留的修改",
    category: "工作",
    tags: [],
    images: legacy.images
  }));

  assert.equal(fakeVault.files.size, 1);
  assert.equal(fakeVault.files.has(legacyPath), true);
  assert.equal(fakeVault.files.has("兜兜/工作/2026/08/rollback.md"), false);
  assert.equal(fakeVault.files.get(legacyPath)?.content, originalMarkdown);
});

test("failed category moves leave the original file unchanged", async () => {
  const fakeVault = new FakeVault();
  const originalPath = "兜兜/生活/2026/08/rename-failure.md";
  const originalMarkdown = serializeRecord(stored({ path: originalPath }));
  await fakeVault.create(originalPath, originalMarkdown);
  const repository = new DoudouRepository(fakeVault as unknown as Vault);
  const record = (await repository.loadAll())[0];
  fakeVault.failNextRename = true;

  await assert.rejects(() => repository.update(record, {
    content: "不应保存",
    category: "副业",
    tags: [],
    images: record.images
  }));

  assert.equal(fakeVault.files.size, 1);
  assert.equal(fakeVault.files.has(originalPath), true);
  assert.equal(fakeVault.files.get(originalPath)?.content, originalMarkdown);
});

test("repository reads first-version block tags and limits recent chat history", async () => {
  const fakeVault = new FakeVault();
  const legacy = [
    "---",
    "id: legacy",
    "created: 2026-08-15T07:00:00.000Z",
    "category: 生活",
    "tags:",
    "- 日记",
    "---",
    "",
    "旧版正文"
  ].join("\n");
  await fakeVault.create("兜兜/2026/08/legacy.md", legacy);
  const repository = new DoudouRepository(fakeVault as unknown as Vault);
  const records = await repository.loadRecent(1);
  assert.equal(records.length, 1);
  assert.equal(records[0].content, "旧版正文");
  assert.deepEqual(records[0].tags, ["日记"]);
});

test("repository excludes assets and non-record paths while reading legacy and category records", async () => {
  const fakeVault = new FakeVault();
  const markdown = serializeRecord(stored());
  await fakeVault.create("兜兜/生活/2026/08/life.md", markdown);
  await fakeVault.create("兜兜/工作/2026/08/work.md", markdown.replace('id: \"id-1\"', 'id: \"work\"'));
  await fakeVault.create("兜兜/副业/2026/08/side.md", markdown.replace('id: \"id-1\"', 'id: \"side\"'));
  await fakeVault.create("兜兜/2025/12/legacy.md", markdown.replace('id: \"id-1\"', 'id: \"legacy\"'));
  await fakeVault.create("兜兜/assets/2026/08/not-a-record.md", markdown);
  await fakeVault.create("兜兜/其他/2026/08/not-a-record.md", markdown);
  await fakeVault.create("兜兜/readme.md", markdown);

  const records = await new DoudouRepository(fakeVault as unknown as Vault).loadAll();
  assert.deepEqual(records.map((record) => record.id).sort(), ["id-1", "legacy", "side", "work"]);
});

test("search reads all category folders and still matches hidden AI tags", async () => {
  const fakeVault = new FakeVault();
  const fixtures = [
    stored({ id: "life", category: "生活", path: "兜兜/生活/2026/08/life.md" }),
    stored({ id: "work", category: "工作", content: "项目计划", path: "兜兜/工作/2026/08/work.md" }),
    stored({ id: "side", category: "副业", aiTags: ["创作灵感"], path: "兜兜/副业/2026/08/side.md" })
  ];
  for (const fixture of fixtures) {
    await fakeVault.create(fixture.path, serializeRecord(fixture));
  }
  const records = await new DoudouRepository(fakeVault as unknown as Vault).loadAll();
  assert.equal(records.length, 3);
  assert.deepEqual(filterRecords(records, {
    query: "项目",
    category: "工作",
    tags: new Set()
  }).map((record) => record.id), ["work"]);
  assert.deepEqual(filterRecords(records, {
    query: "创作灵感",
    category: "全部",
    tags: new Set()
  }).map((record) => record.id), ["side"]);
});

test("search combines category, tags and body keywords in memory", () => {
  const records = [
    stored(),
    stored({
      id: "id-2",
      content: "准备明天的会议",
      category: "工作",
      tags: ["待办", "会议"],
      path: "兜兜/2026/08/work.md"
    }),
    stored({
      id: "id-3",
      content: "副业灵感",
      category: "副业",
      tags: ["灵感"],
      path: "兜兜/2026/08/side.md"
    })
  ];

  const result = filterRecords(records, {
    query: "#会议",
    category: "工作",
    tags: new Set(["待办"])
  });
  assert.deepEqual(result.map((record) => record.id), ["id-2"]);
  assert.deepEqual(
    collectTagOptions(records).map((option) => option.name).sort(),
    ["会议", "待办", "日记", "灵感", "猫"].sort()
  );
});

test("search matches hidden AI tags without exposing them in UI metadata or tag options", () => {
  const record = stored({
    content: "正文没有目标词",
    tags: ["日记"],
    aiTags: ["注意力"]
  });
  const result = filterRecords([record], {
    query: "注意力",
    category: "全部",
    tags: new Set()
  });
  assert.equal(result.length, 1);
  assert.equal(metaText(record), "生活 · #日记");
  assert.deepEqual(collectTagOptions([record]).map((option) => option.name), ["日记"]);
});

test("clipboard copying preserves full record text exactly", async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const copied: string[] = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        writeText: async (text: string) => { copied.push(text); }
      }
    }
  });
  try {
    const content = "第一段中文\n\nSecond paragraph 🙂 #原文标签";
    await writeClipboardText(content);
    assert.deepEqual(copied, [content]);
  } finally {
    if (originalNavigator) {
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    } else {
      delete (globalThis as { navigator?: Navigator }).navigator;
    }
  }
});

test("Remotely Save lookup selects only its start sync command", () => {
  const commandId = findRemotelySaveStartSyncCommand([
    { id: "other-sync:start-sync", name: "Other Sync: Start sync" },
    { id: "remotely-save:sync-on-save", name: "Remotely Save: Sync on save" },
    { id: "remotely-save:start-sync", name: "Remotely Save: Start sync" }
  ]);
  assert.equal(commandId, "remotely-save:start-sync");
  assert.equal(findRemotelySaveStartSyncCommand([
    { id: "remotely-save:manual", name: "Remotely Save：开始同步" }
  ]), "remotely-save:manual");
  assert.equal(findRemotelySaveStartSyncCommand([
    { id: "other-sync:start-sync", name: "Other Sync: Start sync" },
    { id: "remotely-save:sync-on-save", name: "Remotely Save: Sync on save" }
  ]), null);
});

test("AI tag JSON validation cleans, deduplicates and limits tags", () => {
  const values = [
    "#注意力", "注意力", "手机使用", "生活", "手动",
    "时间管理", "使用习惯", "小红书", "专注", "屏幕时间", "习惯追踪",
    "这是一个超过二十四个字符所以必须被过滤掉的非常非常长标签"
  ];
  const tags = parseAiTags(JSON.stringify({ tags: values }), ["手动"]);
  assert.deepEqual(tags, [
    "注意力", "手机使用", "时间管理", "使用习惯",
    "小红书", "专注", "屏幕时间", "习惯追踪"
  ]);
  assert.deepEqual(parseAiTags('{"tags":[]}', []), []);
  assert.throws(() => parseAiTags("not json", []), DeepSeekError);
});

test("AI tag failure leaves the existing record untouched", async () => {
  let updateCount = 0;
  const service = new AiTagService(
    { updateAiTags: async () => { updateCount += 1; return stored(); } },
    () => ({
      generateAiTags: async () => { throw new DeepSeekError("network"); }
    }),
    () => true
  );
  const result = await service.enrich(stored({ aiTags: ["旧标签"] }));
  assert.equal(result, false);
  assert.equal(updateCount, 0);
});

function fakeImage(name: string, type: string, bytes = 4): ImageFileLike {
  return {
    name,
    type,
    arrayBuffer: async () => new ArrayBuffer(bytes)
  };
}

test("image service builds Vault-relative unique paths", async () => {
  const fakeVault = new FakeVault();
  const images = new ImageService(fakeVault as unknown as Vault);
  const created = "2026-08-17T12:00:00";
  assert.equal(
    buildImagePath("record-id", created, 0, "jpg"),
    "兜兜/assets/2026/08/record-id-01.jpg"
  );
  const first = await images.saveImages("record-id", created, [fakeImage("one.jpg", "image/jpeg")]);
  const second = await images.saveImages("record-id", created, [fakeImage("two.jpg", "image/jpeg")]);
  assert.equal(first[0], "兜兜/assets/2026/08/record-id-01.jpg");
  assert.equal(second[0], "兜兜/assets/2026/08/record-id-01-2.jpg");
});

test("record creation cleans new attachments when Markdown save fails", async () => {
  const fakeVault = new FakeVault();
  const images = new ImageService(fakeVault as unknown as Vault);
  const repository = {
    save: async () => { throw new Error("Markdown failed"); }
  };
  const service = new RecordService(repository as never, images);
  await assert.rejects(() => service.create(
    stored(),
    [fakeImage("one.png", "image/png"), fakeImage("two.webp", "image/webp")]
  ));
  assert.equal(fakeVault.files.size, 0);
});

test("record editing removes only saved image paths after Markdown update", async () => {
  const fakeVault = new FakeVault();
  const images = new ImageService(fakeVault as unknown as Vault);
  const oldPath = "兜兜/assets/2026/08/id-1-01.jpg";
  await fakeVault.createBinary(oldPath, new ArrayBuffer(2));
  let savedImages: string[] = [];
  const repository = {
    update: async (record: StoredDoudouRecord, changes: { images?: string[] }) => {
      savedImages = changes.images ?? [];
      return { ...record, images: savedImages };
    }
  };
  const service = new RecordService(repository as never, images);
  await service.update(
    stored({ images: [oldPath] }),
    { content: "保留正文", category: "生活", tags: [] },
    [],
    [oldPath]
  );
  assert.deepEqual(savedImages, []);
  assert.equal(fakeVault.files.has(oldPath), false);
});

test("record deletion trashes bound images and ignores missing attachments", async () => {
  const fakeVault = new FakeVault();
  const images = new ImageService(fakeVault as unknown as Vault);
  const existing = "兜兜/assets/2026/08/id-1-01.png";
  await fakeVault.createBinary(existing, new ArrayBuffer(2));
  let markdownDeleted = false;
  const repository = {
    delete: async () => { markdownDeleted = true; }
  };
  const service = new RecordService(repository as never, images);
  await service.delete(stored({
    images: [existing, "兜兜/assets/2026/08/already-missing.png"]
  }));
  assert.equal(markdownDeleted, true);
  assert.equal(fakeVault.files.has(existing), false);
});

test("ask service expands keywords, falls back locally and never mutates records", async () => {
  const records = [stored({ content: "最近总是不自觉刷手机" })];
  let answerCalls = 0;
  const repository = { loadAll: async () => records };
  const success = new AskDoudouService(repository, () => ({
    expandKeywords: async () => ["手机使用"],
    answerQuestion: async (_question, sources) => {
      answerCalls += 1;
      assert.equal(sources.length, 1);
      return "找到一条关于刷手机的记录。";
    }
  }));
  const answered = await success.ask("我记过少刷手机吗？");
  assert.equal(answered.sources.length, 1);
  assert.equal(answerCalls, 1);

  const fallback = new AskDoudouService(repository, () => ({
    expandKeywords: async () => { throw new Error("expand failed"); },
    answerQuestion: async () => "通过本地问题词找到了。"
  }));
  assert.equal((await fallback.ask("有没有刷手机记录？")).sources.length, 1);

  const noMatch = new AskDoudouService(repository, () => ({
    expandKeywords: async () => [],
    answerQuestion: async () => { throw new Error("must not be called"); }
  }));
  const empty = await noMatch.ask("完全无关的火箭发动机型号？");
  assert.equal(empty.noMatches, true);
  assert.equal(empty.sources.length, 0);
});

test("ask answer failures remain transient errors", async () => {
  const service = new AskDoudouService(
    { loadAll: async () => [stored({ aiTags: ["注意力"] })] },
    () => ({
      expandKeywords: async () => ["注意力"],
      answerQuestion: async () => { throw new DeepSeekError("service"); }
    })
  );
  await assert.rejects(() => service.ask("注意力"), DeepSeekError);
});
