import assert from "node:assert/strict";
import { File as NodeFile } from "node:buffer";
import test from "node:test";
import type { Vault } from "obsidian";
import { TFile } from "obsidian";
import { AiTagService } from "../src/ai/AiTagService";
import { AskDoudouService } from "../src/ai/AskDoudouService";
import { DeepSeekError, parseAiTags } from "../src/ai/DeepSeekClient";
import { buildImagePath, imageMimeType, ImageService, isDoudouImagePath, type ImageFileLike } from "../src/attachments/ImageService";
import {
  buildFilePath,
  FileService,
  MAX_ATTACHMENT_BYTES,
  sanitizeAttachmentName,
  type AttachmentFileLike
} from "../src/attachments/FileService";
import { ALL_RECORDS_FOLDER } from "../src/constants";
import { buildRecordPath, DoudouRepository, isDoudouRecordPath, normalizeFolderName } from "../src/data/DoudouRepository";
import { extractFrontmatter, extractManualTags, recordFromFrontmatter, serializeRecord } from "../src/data/recordCodec";
import { collectTagOptions, filterRecords, rankRecordsForQuestion } from "../src/services/recordSearch";
import { RecordService } from "../src/services/RecordService";
import type { StoredDoudouRecord } from "../src/types";
import { libraryCardContent, metaText, recordTitle, writeClipboardText } from "../src/ui/uiHelpers";
import { findRemotelySaveStartSyncCommand } from "../src/ui/remotelySave";
import {
  imageFilesFromClipboardItems,
  type ClipboardItemLike
} from "../src/ui/imageDraft";
import { createPendingFiles, hasSavableRecordDraft } from "../src/ui/fileDraft";
import {
  canShareImageFile,
  copyImageFileToClipboard,
  imageSharePayload,
  shouldCopyImageShortcut
} from "../src/ui/imageActions";
import { allPageGalleryPresentation, galleryMode, recordPageGalleryPresentation } from "../src/ui/imageGallery";
import {
  buildImageSavePlan,
  moveImageItem,
  resolveImageOrder,
  type EditableImageItem
} from "../src/ui/imageReorder";

if (typeof globalThis.File === "undefined") {
  Object.defineProperty(globalThis, "File", { configurable: true, value: NodeFile });
}

class FakeVault {
  readonly files = new Map<string, { file: TFile; content: string }>(); readonly binaries = new Map<string, ArrayBuffer>(); readonly folders = new Set<string>(); failNextModify = false; failNextRename = false;
  getMarkdownFiles(): TFile[] { return [...this.files.values()].map((entry) => entry.file); }
  getAllLoadedFiles(): Array<TFile | { path: string }> { return [...this.files.values()].map((entry) => entry.file).concat([...this.folders].map((path) => ({ path })) as TFile[]); }
  getAbstractFileByPath(path: string): TFile | { path: string } | null { return this.files.get(path)?.file ?? (this.folders.has(path) ? { path } : null); }
  async createFolder(path: string): Promise<void> { this.folders.add(path); }
  async create(path: string, content: string): Promise<TFile> { const file = new TFile(path); this.files.set(path, { file, content }); return file; }
  async createBinary(path: string, content: ArrayBuffer): Promise<TFile> { const file = await this.create(path, `binary:${content.byteLength}`); this.binaries.set(path, content.slice(0)); return file; }
  async readBinary(file: TFile): Promise<ArrayBuffer> { const content = this.binaries.get(file.path); if (!content) throw new Error("Missing fake binary"); return content.slice(0); }
  async cachedRead(file: TFile): Promise<string> { const entry = this.files.get(file.path); if (!entry) throw new Error("Missing fake file"); return entry.content; }
  async modify(file: TFile, content: string): Promise<void> { if (this.failNextModify) { this.failNextModify = false; throw new Error("modify failed"); } this.files.set(file.path, { file, content }); }
  async rename(item: TFile | { path: string }, path: string): Promise<void> {
    if (this.failNextRename) { this.failNextRename = false; throw new Error("rename failed"); }
    if (item instanceof TFile) { const oldPath = item.path; const entry = this.files.get(oldPath); if (!entry || this.files.has(path)) throw new Error("rename failed"); this.files.delete(oldPath); const binary = this.binaries.get(oldPath); this.binaries.delete(oldPath); item.path = path; this.files.set(path, entry); if (binary) this.binaries.set(path, binary); return; }
    this.folders.delete(item.path); this.folders.add(path);
  }
  async trash(item: TFile | { path: string }): Promise<void> { if (item instanceof TFile) { this.files.delete(item.path); this.binaries.delete(item.path); } else this.folders.delete(item.path); }
  getResourcePath(file: TFile): string { return `app://vault/${file.path}`; }
}

function stored(overrides: Partial<StoredDoudouRecord> = {}): StoredDoudouRecord { return { id: "id-1", title: "猫咪日记", content: "今天记录一只猫 #日记", created: "2026-08-17T08:00:00.000Z", folder: "生活", tags: ["日记"], path: "兜兜/生活/2026/08/record.md", images: [], files: [], ...overrides }; }
function fakeImage(name: string, type: string, bytes = 4): ImageFileLike { return { name, type, arrayBuffer: async () => new ArrayBuffer(bytes) }; }
function fakeAttachment(name: string, type: string, bytes = 12): AttachmentFileLike { return { name, type, size: bytes, arrayBuffer: async () => new ArrayBuffer(bytes) }; }
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

test("file codec round-trips multiple files and deduplicates safe Vault paths", () => {
  const record = stored({
    files: [
      "兜兜/assets/2026/08/id-file-01-报价表.xlsx",
      "兜兜/assets/2026/08/id-file-02-说明.pdf"
    ]
  });
  const markdown = serializeRecord(record);
  const extracted = extractFrontmatter(markdown);
  assert.ok(extracted);
  assert.match(extracted.yaml, /files: \["兜兜\/assets\/2026\/08\/id-file-01-报价表.xlsx"/);
  const parsed = recordFromFrontmatter({
    id: record.id,
    created: record.created,
    folder: record.folder,
    tags: [],
    files: [
      ...record.files!,
      record.files![0],
      "../outside.pdf",
      "C:/absolute.pdf",
      "其他目录/无关文件.pdf",
      "https://example.com/file.pdf"
    ]
  }, record.content, record.path);
  assert.deepEqual(parsed?.files, record.files);
});

test("old frontmatter without files parses files as an empty array", () => {
  const parsed = recordFromFrontmatter({
    id: "legacy-no-files",
    created: "2026-08-17T08:00:00.000Z",
    category: "生活",
    images: []
  }, "旧记录", "兜兜/2026/08/legacy.md");
  assert.deepEqual(parsed?.files, []);
});

test("file paths keep a safe recognizable original name in the shared assets folder", () => {
  assert.equal(sanitizeAttachmentName("../报:价*表?.xlsx"), "报-价-表-.xlsx");
  assert.equal(
    buildFilePath("record-id", "2026-08-17T08:00:00", 0, "报价表.xlsx"),
    "兜兜/assets/2026/08/record-id-file-01-报价表.xlsx"
  );
  assert.doesNotMatch(
    buildFilePath("../unsafe/id", "2026-08-17T08:00:00", 0, "../../secret.pdf"),
    /\.\.|\\/
  );
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

test("moving a record changes Markdown folder but never attachment paths", async () => {
  const vault = new FakeVault(); const repository = new DoudouRepository(vault as unknown as Vault); const original = await repository.save({ ...repository.createRecord("正文", "生活"), images: ["兜兜/assets/2026/08/keep.jpg"], files: ["兜兜/assets/2026/08/keep.pdf"] }); const name = original.path.split("/").at(-1)!; const moved = await repository.update(original, { title: "新标题", content: "修改 #标签", folder: "工作", images: original.images, files: original.files }); assert.equal(moved.path, buildRecordPath("工作", original.created, name)); assert.deepEqual(moved.images, original.images); assert.deepEqual(moved.files, original.files); assert.deepEqual(moved.tags, ["标签"]); assert.equal(vault.files.size, 1);
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
  const records = [stored({ title: "亚克力定价", content: "准备卖 13.9 #淘宝", folder: "喵布小铺", tags: ["淘宝"], aiTags: ["周边商品"], files: ["兜兜/assets/2026/08/id-file-01-2026报价表.xlsx"] })];
  for (const query of ["亚克力", "13.9", "#淘宝", "周边商品", "喵布小铺", "报价表"]) assert.equal(filterRecords(records, { query, tags: new Set() }).length, 1);
  assert.equal(filterRecords(records, { query: "assets", tags: new Set() }).length, 0);
  assert.equal(metaText(records[0]), "喵布小铺 · #淘宝"); assert.deepEqual(collectTagOptions(records).map((item) => item.name), ["淘宝"]);
});

test("question ranking uses title, folder and hidden AI tags", () => {
  const result = rankRecordsForQuestion([stored({ title: "亚克力立牌", folder: "喵布小铺", aiTags: ["商品定价"] })], "立牌定价", ["商品定价"], 10); assert.equal(result.length, 1);
});

test("record title falls back to first non-empty line then image record", () => {
  assert.equal(recordTitle(stored()), "猫咪日记"); assert.equal(recordTitle(stored({ title: undefined, content: "\n第一行\n第二行" })), "第一行"); assert.equal(recordTitle(stored({ title: undefined, content: "", images: ["兜兜/assets/photo.png"] })), "图片记录"); assert.equal(recordTitle(stored({ title: undefined, content: "", files: ["兜兜/assets/file.pdf"] })), "附件记录");
});

test("library cards render only explicit titles and never repeat fallback content", () => {
  assert.deepEqual(libraryCardContent(stored({ title: "标题", content: "正文内容" })), { title: "标题", preview: "正文内容" });
  assert.deepEqual(libraryCardContent(stored({ title: "", content: "测试 #测试" })), { title: null, preview: "测试 #测试" });
  assert.deepEqual(libraryCardContent(stored({ title: undefined, content: "", images: ["兜兜/assets/photo.png"] })), { title: null, preview: "图片记录" });
  assert.deepEqual(libraryCardContent(stored({ title: undefined, content: "", files: ["兜兜/assets/file.pdf"] })), { title: null, preview: "附件记录" });
  assert.deepEqual(libraryCardContent(stored({ title: "只有标题", content: "" })), { title: "只有标题", preview: null });
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

test("gallery mode uses only none, single, double and uniform grid", () => {
  const expectations = new Map<number, string>([[0, "none"], [1, "single"], [2, "double"], [3, "grid"], [4, "grid"], [9, "grid"], [10, "grid"], [21, "grid"]]);
  for (const [count, mode] of expectations) assert.equal(galleryMode(count), mode);
});

test("all-page gallery previews at most nine images with the correct remainder", () => {
  for (const count of [1, 2, 3, 6, 9]) {
    const paths = Array.from({ length: count }, (_, index) => `image-${index + 1}`);
    const presentation = allPageGalleryPresentation(paths);
    assert.equal(presentation.paths.length, count);
    assert.equal(presentation.overflowCount, 0);
    assert.deepEqual(presentation.paths, paths);
  }
  for (const [count, overflow] of [[10, 1], [21, 12]]) {
    const paths = Array.from({ length: count }, (_, index) => `image-${index + 1}`);
    const presentation = allPageGalleryPresentation(paths);
    assert.equal(presentation.paths.length, 9);
    assert.equal(presentation.overflowCount, overflow);
    assert.deepEqual(presentation.paths, paths.slice(0, 9));
  }
});

test("record-page gallery renders every image in its original order", () => {
  for (const count of [1, 2, 3, 6, 9, 10, 21]) {
    const paths = Array.from({ length: count }, (_, index) => `image-${index + 1}`);
    const presentation = recordPageGalleryPresentation(paths);
    assert.equal(presentation.paths.length, count);
    assert.equal(presentation.overflowCount, 0);
    assert.deepEqual(presentation.paths, paths);
  }
});

test("image reorder moves items without mutating the edit-session source", () => {
  const source = ["stored-a", "pending-b", "stored-c"];
  assert.deepEqual(moveImageItem(source, 0, 2), ["pending-b", "stored-c", "stored-a"]);
  assert.deepEqual(moveImageItem([1, 2, 3], 2, 0), [3, 1, 2]);
  assert.deepEqual(moveImageItem([1, 2, 3], 0, 2), [2, 3, 1]);
  assert.deepEqual(moveImageItem(source, 1, 1), source);
  assert.deepEqual(source, ["stored-a", "pending-b", "stored-c"]);
  assert.deepEqual(moveImageItem(source, -1, 2), source);
  assert.deepEqual(moveImageItem(source, 1, 30), source);
  const twentyOne = Array.from({ length: 21 }, (_, index) => index + 1);
  assert.deepEqual(moveImageItem(twentyOne, 20, 0), [21, ...twentyOne.slice(0, 20)]);
});

test("mixed stored and pending image order resolves to final Vault paths", () => {
  const items: EditableImageItem[] = [
    { kind: "stored", id: "old-a", path: "兜兜/assets/2026/08/old-a.jpg" },
    { kind: "pending", id: "new-b" },
    { kind: "stored", id: "old-c", path: "兜兜/assets/2026/08/old-c.jpg" },
    { kind: "pending", id: "new-d" }
  ];
  const plan = buildImageSavePlan(items);
  assert.deepEqual(plan.pendingIds, ["new-b", "new-d"]);
  assert.deepEqual(resolveImageOrder(plan.order, [
    "兜兜/assets/2026/08/new-b.jpg",
    "兜兜/assets/2026/08/new-d.jpg"
  ]), [
    "兜兜/assets/2026/08/old-a.jpg",
    "兜兜/assets/2026/08/new-b.jpg",
    "兜兜/assets/2026/08/old-c.jpg",
    "兜兜/assets/2026/08/new-d.jpg"
  ]);
});

test("image order rejects a pending slot that was not saved", () => {
  assert.throws(() => resolveImageOrder([{ kind: "pending", index: 0 }], []), /missing pending image/);
});

test("delete add and reorder keeps the intended mixed image sequence", () => {
  let items: EditableImageItem[] = [
    { kind: "stored", id: "stored-1", path: "old-1.jpg" },
    { kind: "stored", id: "stored-2", path: "old-2.jpg" },
    { kind: "stored", id: "stored-3", path: "old-3.jpg" }
  ];
  items = moveImageItem(items, 2, 0);
  items = items.filter((item) => item.id !== "stored-1");
  items.push({ kind: "pending", id: "picker-4" }, { kind: "pending", id: "paste-5" });
  items = moveImageItem(items, 3, 0);
  const plan = buildImageSavePlan(items);
  assert.deepEqual(plan.pendingIds, ["paste-5", "picker-4"]);
  assert.deepEqual(resolveImageOrder(plan.order, ["paste-5.jpg", "picker-4.jpg"]), [
    "paste-5.jpg", "old-3.jpg", "old-2.jpg", "picker-4.jpg"
  ]);
});

test("pasted pending image appends and can be moved before stored images", () => {
  let items: EditableImageItem[] = [
    { kind: "stored", id: "stored-1", path: "old-1.jpg" },
    { kind: "stored", id: "stored-2", path: "old-2.jpg" }
  ];
  items.push({ kind: "pending", id: "paste-3" });
  assert.equal(items.at(-1)?.id, "paste-3");
  items = moveImageItem(items, 2, 0);
  const plan = buildImageSavePlan(items);
  assert.deepEqual(resolveImageOrder(plan.order, ["paste-3.jpg"]), ["paste-3.jpg", "old-1.jpg", "old-2.jpg"]);
});

test("image export reads the original Vault binary with a safe name and MIME", async () => {
  const vault = new FakeVault();
  const path = "兜兜/assets/2026/08/record-01.webp";
  await vault.createBinary(path, new Uint8Array([1, 2, 3, 4]).buffer);
  const file = await new ImageService(vault as unknown as Vault).readAsFile(path);
  assert.equal(file.name, "record-01.webp");
  assert.equal(file.type, "image/webp");
  assert.deepEqual([...new Uint8Array(await file.arrayBuffer())], [1, 2, 3, 4]);
  assert.equal(imageMimeType("photo.JPG"), "image/jpeg");
  assert.equal(imageMimeType("animation.gif"), "image/gif");
  assert.equal(isDoudouImagePath(path), true);
});

test("image export rejects paths outside assets, unsafe paths and missing files", async () => {
  const vault = new FakeVault();
  const images = new ImageService(vault as unknown as Vault);
  assert.equal(isDoudouImagePath("其他目录/photo.png"), false);
  assert.equal(isDoudouImagePath("兜兜/assets/../secret.png"), false);
  assert.equal(isDoudouImagePath("/兜兜/assets/2026/08/photo.png"), false);
  assert.equal(isDoudouImagePath("C:/Vault/兜兜/assets/photo.png"), false);
  assert.equal(isDoudouImagePath("兜兜/assets/2026/08/file.pdf"), false);
  await assert.rejects(() => images.readAsFile("其他目录/photo.png"));
  await assert.rejects(() => images.readAsFile("兜兜/assets/2026/08/missing.png"));
});

test("share capability and payload require real file-sharing support", () => {
  const file = { name: "record-01.gif", type: "image/gif" } as File;
  assert.deepEqual(imageSharePayload(file), { files: [file], title: "record-01.gif" });
  assert.equal(canShareImageFile(file, {}), false);
  assert.equal(canShareImageFile(file, { share: async () => {}, canShare: () => true }), true);
  assert.equal(canShareImageFile(file, { share: async () => {}, canShare: () => false }), false);
});

test("image clipboard keeps original bytes and rejects unsupported MIME", async () => {
  const file = new File([new Uint8Array([7, 8])], "record-01.png", { type: "image/png" });
  let written: ClipboardItems | null = null;
  class FakeClipboardItem {
    static supports(type: string): boolean { return type === "image/png"; }
    constructor(readonly items: Record<string, Blob>) {}
  }
  await copyImageFileToClipboard(file, { write: async (items) => { written = items; } }, FakeClipboardItem as unknown as typeof ClipboardItem);
  assert.equal(written?.length, 1);
  await assert.rejects(() => copyImageFileToClipboard(
    new File([new Uint8Array([1])], "photo.heic", { type: "image/heic" }),
    { write: async () => {} },
    FakeClipboardItem as unknown as typeof ClipboardItem
  ), /clipboard-format-unsupported/);
});

test("image Ctrl+C only activates in an unambiguous viewer context", () => {
  const shortcut = { key: "c", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false };
  assert.equal(shouldCopyImageShortcut(shortcut, false, false), true);
  assert.equal(shouldCopyImageShortcut(shortcut, true, false), false);
  assert.equal(shouldCopyImageShortcut(shortcut, false, true), false);
  assert.equal(shouldCopyImageShortcut({ ...shortcut, key: "v" }, false, false), false);
});

test("editing removes old images only after Markdown update succeeds", async () => {
  const vault = new FakeVault(); const images = new ImageService(vault as unknown as Vault); const old = "兜兜/assets/2026/08/old.jpg"; await vault.createBinary(old, new ArrayBuffer(2)); let passed: string[] = []; const service = new RecordService({ update: async (record: StoredDoudouRecord, changes: { images?: string[] }) => { passed = changes.images ?? []; return { ...record, images: passed }; } } as never, images, new FileService(vault as unknown as Vault)); await service.update(stored({ images: [old] }), { content: "正文", folder: "生活" }, [], [old]); assert.deepEqual(passed, []); assert.equal(vault.files.has(old), false);
});

test("record update persists stored and pending images in the mixed editor order", async () => {
  const vault = new FakeVault();
  const oldA = "兜兜/assets/2026/08/old-a.jpg";
  const oldB = "兜兜/assets/2026/08/old-b.jpg";
  await vault.createBinary(oldA, new ArrayBuffer(2));
  await vault.createBinary(oldB, new ArrayBuffer(2));
  let savedOrder: string[] = [];
  const service = new RecordService(
    { update: async (record: StoredDoudouRecord, changes: { images?: string[] }) => {
      savedOrder = changes.images ?? [];
      return { ...record, images: savedOrder };
    } } as never,
    new ImageService(vault as unknown as Vault),
    new FileService(vault as unknown as Vault)
  );
  const updated = await service.update(
    stored({ images: [oldA, oldB] }),
    { content: "正文", folder: "生活" },
    [fakeImage("new-x.png", "image/png"), fakeImage("new-y.webp", "image/webp")],
    [],
    [],
    [],
    [
      { kind: "stored", path: oldA },
      { kind: "pending", index: 0 },
      { kind: "stored", path: oldB },
      { kind: "pending", index: 1 }
    ]
  );
  assert.equal(savedOrder[0], oldA);
  assert.match(savedOrder[1] ?? "", /id-1-03\.png$/);
  assert.equal(savedOrder[2], oldB);
  assert.match(savedOrder[3] ?? "", /id-1-04\.webp$/);
  assert.deepEqual(updated.images, savedOrder);
});

test("failed mixed-order Markdown update keeps old image order and cleans new assets", async () => {
  const vault = new FakeVault();
  const oldA = "兜兜/assets/2026/08/old-a.jpg";
  const oldB = "兜兜/assets/2026/08/old-b.jpg";
  await vault.createBinary(oldA, new ArrayBuffer(2));
  await vault.createBinary(oldB, new ArrayBuffer(2));
  const original = stored({ images: [oldA, oldB] });
  const service = new RecordService(
    { update: async () => { throw new Error("Markdown failed"); } } as never,
    new ImageService(vault as unknown as Vault),
    new FileService(vault as unknown as Vault)
  );
  await assert.rejects(() => service.update(
    original,
    { content: "正文", folder: "生活" },
    [fakeImage("new.png", "image/png")],
    [],
    [],
    [],
    [
      { kind: "stored", path: oldB },
      { kind: "pending", index: 0 },
      { kind: "stored", path: oldA }
    ]
  ));
  assert.deepEqual(original.images, [oldA, oldB]);
  assert.equal(vault.files.has(oldA), true);
  assert.equal(vault.files.has(oldB), true);
  assert.equal([...vault.files.keys()].some((path) => path.endsWith("new.png")), false);
});

test("failed Markdown creation cleans newly saved images", async () => {
  const vault = new FakeVault(); const service = new RecordService({ save: async () => { throw new Error("failed"); } } as never, new ImageService(vault as unknown as Vault), new FileService(vault as unknown as Vault)); await assert.rejects(() => service.create(stored(), [fakeImage("a.png", "image/png")])); assert.equal(vault.files.size, 0);
});

test("deleting a record trashes its Markdown, images and ordinary files", async () => {
  const vault = new FakeVault(); const imagePath = "兜兜/assets/2026/08/a.png"; const filePath = "兜兜/assets/2026/08/a-file-01-报价表.xlsx"; await vault.createBinary(imagePath, new ArrayBuffer(2)); await vault.createBinary(filePath, new ArrayBuffer(3)); let deleted = false; const service = new RecordService({ delete: async () => { deleted = true; } } as never, new ImageService(vault as unknown as Vault), new FileService(vault as unknown as Vault)); await service.delete(stored({ images: [imagePath], files: [filePath] })); assert.equal(deleted, true); assert.equal(vault.files.has(imagePath), false); assert.equal(vault.files.has(filePath), false);
});

test("record service creates a pure-file record without writing before save", async () => {
  const vault = new FakeVault();
  const repository = new DoudouRepository(vault as unknown as Vault);
  const service = new RecordService(
    repository,
    new ImageService(vault as unknown as Vault),
    new FileService(vault as unknown as Vault)
  );
  const draftFile = fakeAttachment("报价表.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const pending = createPendingFiles([draftFile as File]);
  assert.equal(vault.files.size, 0);
  const created = await service.create(
    repository.createRecord("", "工作"),
    [],
    pending.map((item) => item.file)
  );
  assert.equal(created.files?.length, 1);
  assert.match(created.files?.[0] ?? "", /-file-01-报价表\.xlsx$/);
});

test("record service creates a record containing both image and ordinary file", async () => {
  const vault = new FakeVault();
  const repository = new DoudouRepository(vault as unknown as Vault);
  const service = new RecordService(repository, new ImageService(vault as unknown as Vault), new FileService(vault as unknown as Vault));
  const created = await service.create(
    repository.createRecord("图文附件", "生活"),
    [fakeImage("photo.png", "image/png")],
    [fakeAttachment("说明.pdf", "application/pdf")]
  );
  assert.equal(created.images?.length, 1);
  assert.equal(created.files?.length, 1);
});

test("record updates add and remove files only after Markdown succeeds", async () => {
  const vault = new FakeVault();
  const repository = new DoudouRepository(vault as unknown as Vault);
  const service = new RecordService(repository, new ImageService(vault as unknown as Vault), new FileService(vault as unknown as Vault));
  const original = await service.create(repository.createRecord("正文", "生活"), [], [fakeAttachment("旧文件.txt", "text/plain")]);
  const oldPath = original.files?.[0] ?? "";
  const updated = await service.update(original, { content: "正文", folder: "工作" }, [], [], [fakeAttachment("新文件.pdf", "application/pdf")], [oldPath]);
  assert.equal(updated.files?.length, 1);
  assert.match(updated.files?.[0] ?? "", /新文件\.pdf$/);
  assert.equal(vault.files.has(oldPath), false);
  assert.match(updated.path, /^兜兜\/工作\//);
  assert.match(updated.files?.[0] ?? "", /^兜兜\/assets\//);
});

test("failed record update keeps old file and cleans only newly created file", async () => {
  const vault = new FakeVault();
  const oldPath = "兜兜/assets/2026/08/id-file-01-old.txt";
  await vault.createBinary(oldPath, new ArrayBuffer(2));
  const service = new RecordService(
    { update: async () => { throw new Error("Markdown failed"); } } as never,
    new ImageService(vault as unknown as Vault),
    new FileService(vault as unknown as Vault)
  );
  await assert.rejects(() => service.update(
    stored({ files: [oldPath] }),
    { content: "正文", folder: "生活" },
    [],
    [],
    [fakeAttachment("new.pdf", "application/pdf")],
    [oldPath]
  ));
  assert.equal(vault.files.has(oldPath), true);
  assert.equal([...vault.files.keys()].some((path) => path.endsWith("new.pdf")), false);
});

test("failed Markdown create cleans both new images and new files", async () => {
  const vault = new FakeVault();
  const service = new RecordService(
    { save: async () => { throw new Error("Markdown failed"); } } as never,
    new ImageService(vault as unknown as Vault),
    new FileService(vault as unknown as Vault)
  );
  await assert.rejects(() => service.create(
    stored(),
    [fakeImage("photo.png", "image/png")],
    [fakeAttachment("document.pdf", "application/pdf")]
  ));
  assert.equal(vault.files.size, 0);
});

test("file service rejects attachments larger than 50 MB without leaving files", async () => {
  const vault = new FakeVault();
  const files = new FileService(vault as unknown as Vault);
  await assert.rejects(() => files.saveFiles("id", "2026-08-17T08:00:00", [
    fakeAttachment("huge.zip", "application/zip", MAX_ATTACHMENT_BYTES + 1)
  ]));
  assert.equal(vault.files.size, 0);
});

test("savable draft accepts title, pure file, image plus file and text plus file", () => {
  assert.equal(hasSavableRecordDraft("", "", 0, 1), true);
  assert.equal(hasSavableRecordDraft("", "", 1, 1), true);
  assert.equal(hasSavableRecordDraft("", "正文", 0, 1), true);
  assert.equal(hasSavableRecordDraft("只有标题", "", 0, 0), true);
  assert.equal(hasSavableRecordDraft("", "", 0, 0), false);
});

test("clipboard preserves full text exactly", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator"); const copied: string[] = []; Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async (text: string) => { copied.push(text); } } } }); try { await writeClipboardText("第一段\n\n#标签"); assert.deepEqual(copied, ["第一段\n\n#标签"]); } finally { if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor); }
});

test("Remotely Save lookup selects only its start-sync command", () => {
  assert.equal(findRemotelySaveStartSyncCommand([{ id: "other:start-sync", name: "Other Start sync" }, { id: "remotely-save:start-sync", name: "Remotely Save: Start sync" }]), "remotely-save:start-sync");
});
