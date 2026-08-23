import assert from "node:assert/strict";
import test from "node:test";
import type { Vault } from "obsidian";
import { TFile } from "obsidian";
import { AiTagService } from "../src/ai/AiTagService";
import { AskDoudouService } from "../src/ai/AskDoudouService";
import { DeepSeekError, parseAiTags } from "../src/ai/DeepSeekClient";
import { buildImagePath, ImageService, type ImageFileLike } from "../src/attachments/ImageService";
import { ALL_RECORDS_FOLDER } from "../src/constants";
import { buildRecordPath, DoudouRepository, isDoudouRecordPath, normalizeFolderName } from "../src/data/DoudouRepository";
import { extractFrontmatter, extractManualTags, recordFromFrontmatter, serializeRecord } from "../src/data/recordCodec";
import { collectTagOptions, filterRecords, rankRecordsForQuestion } from "../src/services/recordSearch";
import { RecordService } from "../src/services/RecordService";
import type { StoredDoudouRecord } from "../src/types";
import { metaText, recordTitle, writeClipboardText } from "../src/ui/uiHelpers";
import { findRemotelySaveStartSyncCommand } from "../src/ui/remotelySave";
import {
  imageFilesFromClipboardItems,
  type ClipboardItemLike
} from "../src/ui/imageDraft";

class FakeVault {
  readonly files = new Map<string, { file: TFile; content: string }>(); readonly folders = new Set<string>(); failNextModify = false; failNextRename = false;
  getMarkdownFiles(): TFile[] { return [...this.files.values()].map((entry) => entry.file); }
  getAllLoadedFiles(): Array<TFile | { path: string }> { return [...this.files.values()].map((entry) => entry.file).concat([...this.folders].map((path) => ({ path })) as TFile[]); }
  getAbstractFileByPath(path: string): TFile | { path: string } | null { return this.files.get(path)?.file ?? (this.folders.has(path) ? { path } : null); }
  async createFolder(path: string): Promise<void> { this.folders.add(path); }
  async create(path: string, content: string): Promise<TFile> { const file = new TFile(path); this.files.set(path, { file, content }); return file; }
  async createBinary(path: string, content: ArrayBuffer): Promise<TFile> { return this.create(path, `binary:${content.byteLength}`); }
  async cachedRead(file: TFile): Promise<string> { const entry = this.files.get(file.path); if (!entry) throw new Error("Missing fake file"); return entry.content; }
  async modify(file: TFile, content: string): Promise<void> { if (this.failNextModify) { this.failNextModify = false; throw new Error("modify failed"); } this.files.set(file.path, { file, content }); }
  async rename(item: TFile | { path: string }, path: string): Promise<void> {
    if (this.failNextRename) { this.failNextRename = false; throw new Error("rename failed"); }
    if (item instanceof TFile) { const entry = this.files.get(item.path); if (!entry || this.files.has(path)) throw new Error("rename failed"); this.files.delete(item.path); item.path = path; this.files.set(path, entry); return; }
    this.folders.delete(item.path); this.folders.add(path);
  }
  async trash(item: TFile | { path: string }): Promise<void> { if (item instanceof TFile) this.files.delete(item.path); else this.folders.delete(item.path); }
  getResourcePath(file: TFile): string { return `app://vault/${file.path}`; }
}

function stored(overrides: Partial<StoredDoudouRecord> = {}): StoredDoudouRecord { return { id: "id-1", title: "猫咪日记", content: "今天记录一只猫 #日记", created: "2026-08-17T08:00:00.000Z", folder: "生活", tags: ["日记"], path: "兜兜/生活/2026/08/record.md", images: [], ...overrides }; }
function fakeImage(name: string, type: string, bytes = 4): ImageFileLike { return { name, type, arrayBuffer: async () => new ArrayBuffer(bytes) }; }
function clipboardItem(
  kind: string,
  type: string,
  file: File | null,
  throws = false
): ClipboardItemLike {
  return {
    kind,
    type,
    getAsFile: () => {
      if (throws) throw new Error("clipboard denied");
      return file;
    }
  };
}

test("manual hashtags support Chinese, English, numbers, mixed text and deduplicate", () => {
  assert.deepEqual(extractManualTags("#摘抄\n测试 #淘宝 \n#淘宝 #定价\n#UI #v04 #测试123 #无畏契约"), ["摘抄", "淘宝", "定价", "UI", "v04", "测试123", "无畏契约"]);
  assert.deepEqual(extractManualTags("C#语言 # #正常"), ["正常"]);
});

test("clipboard text does not produce pending image files", () => {
  assert.deepEqual(imageFilesFromClipboardItems([
    clipboardItem("string", "text/plain", null)
  ]), []);
});

test("clipboard image/png produces one image file", () => {
  const png = { name: "image.png", type: "image/png" } as File;
  assert.deepEqual(imageFilesFromClipboardItems([
    clipboardItem("file", "image/png", png)
  ]), [png]);
});

test("clipboard supports multiple image files", () => {
  const png = { name: "one.png", type: "image/png" } as File;
  const jpeg = { name: "two.jpg", type: "image/jpeg" } as File;
  assert.deepEqual(imageFilesFromClipboardItems([
    clipboardItem("file", "image/png", png),
    clipboardItem("file", "image/jpeg", jpeg)
  ]), [png, jpeg]);
});

test("clipboard ignores non-image file items", () => {
  const pdf = { name: "document.pdf", type: "application/pdf" } as File;
  assert.deepEqual(imageFilesFromClipboardItems([
    clipboardItem("file", "application/pdf", pdf)
  ]), []);
});

test("clipboard ignores null and inaccessible image items without throwing", () => {
  assert.deepEqual(imageFilesFromClipboardItems([
    clipboardItem("file", "image/png", null),
    clipboardItem("file", "image/webp", null, true)
  ]), []);
  assert.deepEqual(imageFilesFromClipboardItems(undefined), []);
});

test("new codec writes folder, title and extracted tags while keeping body hashtags", () => {
  const markdown = serializeRecord(stored()); const extracted = extractFrontmatter(markdown); assert.ok(extracted); assert.equal(extracted.content, stored().content); assert.match(extracted.yaml, /title: "猫咪日记"/); assert.match(extracted.yaml, /folder: "生活"/); assert.doesNotMatch(extracted.yaml, /category:/);
});

test("frontmatter prefers folder and falls back to old category", () => {
  const modern = recordFromFrontmatter({ id: "new", created: "2026-08-16T09:00:00.000Z", folder: "喵布小铺", category: "工作", title: "定价", tags: [] }, "正文", "兜兜/喵布小铺/2026/08/a.md"); assert.equal(modern?.folder, "喵布小铺"); assert.equal(modern?.title, "定价");
  const old = recordFromFrontmatter({ id: "old", created: "2026-08-16T09:00:00.000Z", category: "生活", tags: ["#待办"] }, "旧正文", "兜兜/2026/08/old.md"); assert.equal(old?.folder, "生活"); assert.deepEqual(old?.tags, ["待办"]);
});

test("folder validation accepts Chinese and English and rejects virtual or unsafe names", () => {
  assert.equal(normalizeFolderName(" 喵布小铺 "), "喵布小铺"); assert.equal(normalizeFolderName("Ideas"), "Ideas"); assert.throws(() => normalizeFolderName(ALL_RECORDS_FOLDER)); assert.throws(() => normalizeFolderName("a/b")); assert.throws(() => normalizeFolderName("assets"));
});

test("record paths use arbitrary folders and virtual all-records creates no path", () => {
  assert.equal(buildRecordPath("喵布小铺", "2026-08-17T08:00:00", "a.md"), "兜兜/喵布小铺/2026/08/a.md"); assert.equal(buildRecordPath("Ideas", "2026-08-17T08:00:00", "a.md"), "兜兜/Ideas/2026/08/a.md"); assert.throws(() => buildRecordPath(ALL_RECORDS_FOLDER, "2026-08-17", "a.md"));
});

test("record path scanning reads custom and legacy records but excludes assets", () => {
  assert.equal(isDoudouRecordPath("兜兜/游戏/2026/08/a.md"), true); assert.equal(isDoudouRecordPath("兜兜/2025/12/legacy.md"), true); assert.equal(isDoudouRecordPath("兜兜/assets/2026/08/a.md"), false); assert.equal(isDoudouRecordPath("兜兜/readme.md"), false);
});

test("repository creates, searches and lists custom folders", async () => {
  const vault = new FakeVault(); const repository = new DoudouRepository(vault as unknown as Vault); await repository.createFolder("喵布小铺"); const record = repository.createRecord("7cm 立牌 #淘宝 #定价", "喵布小铺", "立牌价格"); const created = await repository.save(record); assert.match(created.path, /^兜兜\/喵布小铺\/\d{4}\/\d{2}\//); assert.deepEqual(created.tags, ["淘宝", "定价"]); assert.deepEqual(await repository.listFolders(), [{ name: "喵布小铺", count: 1 }]);
});

test("moving a record changes Markdown folder but never image paths", async () => {
  const vault = new FakeVault(); const repository = new DoudouRepository(vault as unknown as Vault); const original = await repository.save({ ...repository.createRecord("正文", "生活"), images: ["兜兜/assets/2026/08/keep.jpg"] }); const name = original.path.split("/").at(-1)!; const moved = await repository.update(original, { title: "新标题", content: "修改 #标签", folder: "工作", images: original.images }); assert.equal(moved.path, buildRecordPath("工作", original.created, name)); assert.deepEqual(moved.images, original.images); assert.deepEqual(moved.tags, ["标签"]); assert.equal(vault.files.size, 1);
});

test("editing legacy migrates only that Markdown without duplicates", async () => {
  const vault = new FakeVault(); const legacyPath = "兜兜/2026/08/legacy.md"; await vault.create(legacyPath, serializeRecord(stored({ path: legacyPath }))); const repository = new DoudouRepository(vault as unknown as Vault); const legacy = (await repository.loadAll())[0]; const moved = await repository.update(legacy, { title: legacy.title, content: legacy.content, folder: legacy.folder, images: legacy.images }); assert.equal(moved.path, "兜兜/生活/2026/08/legacy.md"); assert.equal(vault.files.size, 1); assert.equal(vault.files.has(legacyPath), false);
});

test("path conflicts leave original Markdown unchanged", async () => {
  const vault = new FakeVault(); const repository = new DoudouRepository(vault as unknown as Vault); const original = await repository.save(repository.createRecord("正文", "生活")); const target = buildRecordPath("工作", original.created, original.path.split("/").at(-1)!); await vault.create(target, serializeRecord(stored({ id: "other", path: target, folder: "工作" }))); await assert.rejects(() => repository.update(original, { content: "变化", folder: "工作", images: [] })); assert.equal(vault.files.has(original.path), true);
});

test("failed moved write rolls back original path and content", async () => {
  const vault = new FakeVault(); const repository = new DoudouRepository(vault as unknown as Vault); const original = await repository.save(repository.createRecord("原文", "生活")); const before = vault.files.get(original.path)?.content; vault.failNextModify = true; await assert.rejects(() => repository.update(original, { content: "不保留", folder: "副业", images: [] })); assert.equal(vault.files.has(original.path), true); assert.equal(vault.files.get(original.path)?.content, before);
});

test("folder rename updates record paths, filenames, frontmatter and images", async () => {
  const vault = new FakeVault(); const repository = new DoudouRepository(vault as unknown as Vault); const original = await repository.save({ ...repository.createRecord("正文", "生活"), images: ["兜兜/assets/2026/08/x.jpg"] }); const fileName = original.path.split("/").at(-1); await repository.renameFolder("生活", "日常"); repository.invalidateCache(); const renamed = (await repository.loadAll())[0]; assert.equal(renamed.folder, "日常"); assert.equal(renamed.path.split("/").at(-1), fileName); assert.deepEqual(renamed.images, original.images);
});

test("empty folders can be deleted while non-empty folders are protected", async () => {
  const vault = new FakeVault(); const repository = new DoudouRepository(vault as unknown as Vault); await repository.createFolder("空文件夹"); await repository.deleteFolder("空文件夹"); assert.equal(vault.folders.has("兜兜/空文件夹"), false); await repository.save(repository.createRecord("正文", "生活")); await assert.rejects(() => repository.deleteFolder("生活"), /not empty/);
});

test("search covers title, content, tags, ai_tags and folder without exposing ai tags", () => {
  const records = [stored({ title: "亚克力定价", content: "准备卖 13.9 #淘宝", folder: "喵布小铺", tags: ["淘宝"], aiTags: ["周边商品"] })];
  for (const query of ["亚克力", "13.9", "#淘宝", "周边商品", "喵布小铺"]) assert.equal(filterRecords(records, { query, tags: new Set() }).length, 1);
  assert.equal(metaText(records[0]), "喵布小铺 · #淘宝"); assert.deepEqual(collectTagOptions(records).map((item) => item.name), ["淘宝"]);
});

test("question ranking uses title, folder and hidden AI tags", () => {
  const result = rankRecordsForQuestion([stored({ title: "亚克力立牌", folder: "喵布小铺", aiTags: ["商品定价"] })], "立牌定价", ["商品定价"], 10); assert.equal(result.length, 1);
});

test("record title falls back to first non-empty line then image record", () => {
  assert.equal(recordTitle(stored()), "猫咪日记"); assert.equal(recordTitle(stored({ title: undefined, content: "\n第一行\n第二行" })), "第一行"); assert.equal(recordTitle(stored({ title: undefined, content: "" })), "图片记录");
});

test("AI tag validation keeps manual and hidden tags separate", () => {
  assert.deepEqual(parseAiTags('{"tags":["#注意力","注意力","手动","手机使用"]}', ["手动"]), ["注意力", "手机使用"]);
});

test("AI failure never mutates saved Markdown", async () => {
  let updates = 0; const service = new AiTagService({ updateAiTags: async () => { updates++; return stored(); } }, () => ({ generateAiTags: async () => { throw new DeepSeekError("network"); } }), () => true); assert.equal(await service.enrich(stored()), false); assert.equal(updates, 0);
});

test("AskDoudou still retrieves via hidden tags and does not persist answers", async () => {
  let loads = 0; const service = new AskDoudouService({ loadAll: async () => { loads++; return [stored({ aiTags: ["商品定价"] })]; } }, () => ({ expandKeywords: async () => ["商品定价"], answerQuestion: async () => "准备卖 13.9。" })); const result = await service.ask("最后准备卖多少钱？"); assert.equal(result.answer, "准备卖 13.9。"); assert.equal(result.sources.length, 1); assert.equal(loads, 1);
});

test("image service preserves Vault-relative asset layout and unique paths", async () => {
  const vault = new FakeVault(); const images = new ImageService(vault as unknown as Vault); const created = "2026-08-17T12:00:00"; assert.equal(buildImagePath("record", created, 0, "jpg"), "兜兜/assets/2026/08/record-01.jpg"); const first = await images.saveImages("record", created, [fakeImage("a.jpg", "image/jpeg")]); const second = await images.saveImages("record", created, [fakeImage("b.jpg", "image/jpeg")]); assert.equal(first[0], "兜兜/assets/2026/08/record-01.jpg"); assert.equal(second[0], "兜兜/assets/2026/08/record-01-2.jpg");
});

test("editing removes old images only after Markdown update succeeds", async () => {
  const vault = new FakeVault(); const images = new ImageService(vault as unknown as Vault); const old = "兜兜/assets/2026/08/old.jpg"; await vault.createBinary(old, new ArrayBuffer(2)); let passed: string[] = []; const service = new RecordService({ update: async (record: StoredDoudouRecord, changes: { images?: string[] }) => { passed = changes.images ?? []; return { ...record, images: passed }; } } as never, images); await service.update(stored({ images: [old] }), { content: "正文", folder: "生活" }, [], [old]); assert.deepEqual(passed, []); assert.equal(vault.files.has(old), false);
});

test("failed Markdown creation cleans newly saved images", async () => {
  const vault = new FakeVault(); const service = new RecordService({ save: async () => { throw new Error("failed"); } } as never, new ImageService(vault as unknown as Vault)); await assert.rejects(() => service.create(stored(), [fakeImage("a.png", "image/png")])); assert.equal(vault.files.size, 0);
});

test("deleting a record trashes its Markdown and bound images", async () => {
  const vault = new FakeVault(); const path = "兜兜/assets/2026/08/a.png"; await vault.createBinary(path, new ArrayBuffer(2)); let deleted = false; const service = new RecordService({ delete: async () => { deleted = true; } } as never, new ImageService(vault as unknown as Vault)); await service.delete(stored({ images: [path] })); assert.equal(deleted, true); assert.equal(vault.files.has(path), false);
});

test("clipboard preserves full text exactly", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator"); const copied: string[] = []; Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async (text: string) => { copied.push(text); } } } }); try { await writeClipboardText("第一段\n\n#标签"); assert.deepEqual(copied, ["第一段\n\n#标签"]); } finally { if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor); }
});

test("Remotely Save lookup selects only its start-sync command", () => {
  assert.equal(findRemotelySaveStartSyncCommand([{ id: "other:start-sync", name: "Other Start sync" }, { id: "remotely-save:start-sync", name: "Remotely Save: Start sync" }]), "remotely-save:start-sync");
});
