import assert from "node:assert/strict";
import { File as NodeFile } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import type { Vault } from "obsidian";
import { TFile } from "obsidian";
import { Modal as TestModal, Platform as TestPlatform, resetShownMenuCount, shownMenuCount } from "./obsidianStub";
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
import {
  ALL_RECORDS_FOLDER,
  ALL_RECORDS_FOLDER_LABEL,
  DOUDOU_LEGACY_HIDDEN_CONFIG_PATH,
  DOUDOU_SHARED_CONFIG_PATH,
  RECENT_PAGE_LABEL
} from "../src/constants";
import { buildRecordPath, DoudouRepository, isDoudouRecordPath, normalizeFolderName } from "../src/data/DoudouRepository";
import { extractFrontmatter, extractManualTags, recordFromFrontmatter, serializeRecord } from "../src/data/recordCodec";
import { collectTagOptions, filterRecords, librarySearchFolder, rankRecordsForQuestion } from "../src/services/recordSearch";
import {
  applyManualTagCompletion,
  collectConfirmedManualTagOptions,
  findManualTagInput,
  manualTagSuggestions,
  parseConfirmedManualTagRanges
} from "../src/services/manualTags";
import { RecordService } from "../src/services/RecordService";
import { FolderService, normalizeFolderOrder } from "../src/services/FolderService";
import { parseSharedDoudouConfig, VaultFolderOrderStore } from "../src/services/VaultFolderOrderStore";
import { normalizeSettings } from "../src/settings/settings";
import type { StoredDoudouRecord } from "../src/types";
import { libraryCardContent, metaText, recordTitle, writeClipboardText } from "../src/ui/uiHelpers";
import { findRemotelySaveStartSyncCommand } from "../src/ui/remotelySave";
import { loadFolderOrderState, type FolderOrderLoadState } from "../src/ui/folderOrderState";
import { ImagePreviewModal } from "../src/ui/ImagePreviewModal";
import { GifPreviewSession, isGifFile, isGifPath } from "../src/ui/gifPreview";
import {
  imageFilesFromClipboardItems,
  releasePendingImages,
  retainPendingPreviewUrls,
  type ClipboardItemLike
} from "../src/ui/imageDraft";
import { createPendingFiles, hasSavableRecordDraft } from "../src/ui/fileDraft";
import { createRecordTextareaEditor } from "../src/ui/recordTextareaEditor";
import { registerViewportResizeLayout, type ViewportResizeSource } from "../src/ui/viewportLayout";
import {
  canShareImageFile,
  copyImageFileToClipboard,
  imageSharePayload,
  shouldCopyImageShortcut,
  viewerItemFile
} from "../src/ui/imageActions";
import { allPageGalleryPresentation, galleryMode, recordPageGalleryPresentation } from "../src/ui/imageGallery";
import {
  buildImageSavePlan,
  moveImageItem,
  resolveImageOrder,
  type EditableImageItem
} from "../src/ui/imageReorder";
import {
  clampViewerIndex,
  clampViewerScale,
  currentViewerItem,
  editableViewerItems,
  ImageViewerControlsTimer,
  initialViewerState,
  pendingViewerItem,
  storedViewerItems,
  switchViewerImage
} from "../src/ui/imageViewer";

if (typeof globalThis.File === "undefined") {
  Object.defineProperty(globalThis, "File", { configurable: true, value: NodeFile });
}

const viewerDom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://doudou.test",
  pretendToBeVisual: true
});
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "DOMException", "Event", "MouseEvent", "WheelEvent", "MutationObserver"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: viewerDom.window[key] });
}

interface ObsidianElementOptions {
  cls?: string;
  text?: string;
  attr?: Record<string, string>;
}

function applyElementOptions(element: HTMLElement, options?: ObsidianElementOptions): void {
  if (!options) return;
  if (options.cls) element.className = options.cls;
  if (options.text !== undefined) element.textContent = options.text;
  for (const [name, value] of Object.entries(options.attr ?? {})) element.setAttribute(name, value);
}

Object.assign(viewerDom.window.HTMLElement.prototype, {
  createDiv(this: HTMLElement, options?: ObsidianElementOptions): HTMLDivElement {
    const element = document.createElement("div"); applyElementOptions(element, options); this.appendChild(element); return element;
  },
  createSpan(this: HTMLElement, options?: ObsidianElementOptions): HTMLSpanElement {
    const element = document.createElement("span"); applyElementOptions(element, options); this.appendChild(element); return element;
  },
  createEl(this: HTMLElement, tag: keyof HTMLElementTagNameMap, options?: ObsidianElementOptions): HTMLElement {
    const element = document.createElement(tag); applyElementOptions(element, options); this.appendChild(element); return element;
  },
  addClass(this: HTMLElement, ...classes: string[]): void { this.classList.add(...classes); },
  removeClass(this: HTMLElement, ...classes: string[]): void { this.classList.remove(...classes); },
  toggleClass(this: HTMLElement, classes: string | string[], value: boolean): void {
    for (const name of Array.isArray(classes) ? classes : [classes]) this.classList.toggle(name, value);
  },
  hasClass(this: HTMLElement, name: string): boolean { return this.classList.contains(name); },
  setText(this: HTMLElement, value: string): void { this.textContent = value; },
  appendText(this: HTMLElement, value: string): void { this.appendChild(document.createTextNode(value)); },
  empty(this: HTMLElement): void { this.replaceChildren(); }
});

const pluginCss = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const pluginStyle = document.createElement("style");
pluginStyle.textContent = pluginCss;
document.head.appendChild(pluginStyle);
const libraryPageSource = readFileSync(new URL("../src/ui/LibraryPage.ts", import.meta.url), "utf8");
const recordPageSource = readFileSync(new URL("../src/ui/RecordPage.ts", import.meta.url), "utf8");
const recordTextareaEditorSource = readFileSync(new URL("../src/ui/recordTextareaEditor.ts", import.meta.url), "utf8");
const doudouViewSource = readFileSync(new URL("../src/ui/DoudouView.ts", import.meta.url), "utf8");
const viewportLayoutSource = readFileSync(new URL("../src/ui/viewportLayout.ts", import.meta.url), "utf8");

function cssDeclarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return pluginCss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

function mediaCssDeclarations(media: string, selector: string): string {
  const marker = `@media ${media} {`;
  const start = pluginCss.indexOf(marker);
  if (start < 0) return "";
  let depth = 1;
  let end = start + marker.length;
  while (end < pluginCss.length && depth > 0) {
    if (pluginCss[end] === "{") depth += 1;
    else if (pluginCss[end] === "}") depth -= 1;
    end += 1;
  }
  const block = pluginCss.slice(start + marker.length, end - 1);
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return block.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

function simulateEditorInputWithoutOuterScroll(inputType: string): number {
  const outer = document.createElement("div");
  const form = outer.createDiv();
  const textarea = createRecordTextareaEditor(form, "正文", []);
  document.body.appendChild(outer);
  textarea.focus();
  outer.scrollTop = 72;
  try {
    textarea.dispatchEvent(new viewerDom.window.InputEvent("beforeinput", { bubbles: true, inputType }));
    textarea.dispatchEvent(new viewerDom.window.InputEvent("input", { bubbles: true, inputType }));
    return outer.scrollTop;
  } finally {
    outer.remove();
  }
}

function mockTextareaScrollHeight(
  readHeight: (textarea: HTMLTextAreaElement) => number
): () => void {
  const prototype = viewerDom.window.HTMLTextAreaElement.prototype;
  const original = Object.getOwnPropertyDescriptor(prototype, "scrollHeight");
  Object.defineProperty(prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLTextAreaElement): number { return readHeight(this); }
  });
  return () => {
    if (original) Object.defineProperty(prototype, "scrollHeight", original);
    else delete (prototype as Partial<HTMLTextAreaElement>).scrollHeight;
  };
}

async function countStyleMutations(element: HTMLElement, action: () => void): Promise<number> {
  let count = 0;
  const observer = new MutationObserver((records) => { count += records.length; });
  observer.observe(element, { attributes: true, attributeFilter: ["style"] });
  action();
  await Promise.resolve();
  observer.disconnect();
  return count;
}

function createViewportHarness(initialHeight = 700, rootTop = 80): {
  root: HTMLElement;
  viewport: ViewportResizeSource;
  setHeight: (height: number) => void;
  setOffsetTop: (offsetTop: number) => void;
  dispatch: (type: "resize" | "scroll") => void;
} {
  let height = initialHeight;
  let offsetTop = 0;
  const target = new viewerDom.window.EventTarget();
  Object.defineProperties(target, {
    height: { configurable: true, get: () => height },
    offsetTop: { configurable: true, get: () => offsetTop }
  });
  const root = document.createElement("div");
  root.getBoundingClientRect = () => ({
    top: rootTop,
    bottom: rootTop,
    left: 0,
    right: 320,
    width: 320,
    height: 0,
    x: 0,
    y: rootTop,
    toJSON: () => ({})
  });
  return {
    root,
    viewport: target as ViewportResizeSource,
    setHeight: (value) => { height = value; },
    setOffsetTop: (value) => { offsetTop = value; },
    dispatch: (type) => target.dispatchEvent(new viewerDom.window.Event(type))
  };
}

function pointerEvent(type: string, x: number, y: number, pointerId = 1): PointerEvent {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    clientX: { value: x },
    clientY: { value: y }
  });
  return event as PointerEvent;
}

function touchEvent(
  type: string,
  touches: Array<{ clientX: number; clientY: number }>,
  changedTouches: Array<{ clientX: number; clientY: number }> = []
): TouchEvent {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    touches: { value: touches },
    changedTouches: { value: changedTouches }
  });
  return event as TouchEvent;
}

function viewerImageService(): ImageService {
  return {
    resourcePath: (path: string) => `https://doudou.test/${encodeURIComponent(path)}`,
    readAsFile: async (path: string) => new File([path], path.split("/").at(-1) ?? "image", { type: imageMimeType(path) ?? "image/png" })
  } as ImageService;
}

class FakeVault {
  readonly files = new Map<string, { file: TFile; content: string }>(); readonly binaries = new Map<string, ArrayBuffer>(); readonly folders = new Set<string>(); readonly writeCounts = new Map<string, number>(); failNextModify = false; failNextRename = false;
  readonly adapter = {
    exists: async (path: string): Promise<boolean> => this.files.has(path) || this.folders.has(path),
    read: async (path: string): Promise<string> => { const entry = this.files.get(path); if (!entry) throw new Error("Missing fake file"); return entry.content; }
  };
  getMarkdownFiles(): TFile[] { return [...this.files.values()].map((entry) => entry.file); }
  getAllLoadedFiles(): Array<TFile | { path: string }> { return [...this.files.values()].map((entry) => entry.file).concat([...this.folders].map((path) => ({ path })) as TFile[]); }
  getAbstractFileByPath(path: string): TFile | { path: string } | null { return this.files.get(path)?.file ?? (this.folders.has(path) ? { path } : null); }
  async createFolder(path: string): Promise<void> { this.folders.add(path); }
  async create(path: string, content: string): Promise<TFile> { const file = new TFile(path); this.files.set(path, { file, content }); this.writeCounts.set(path, (this.writeCounts.get(path) ?? 0) + 1); return file; }
  async createBinary(path: string, content: ArrayBuffer): Promise<TFile> { const file = await this.create(path, `binary:${content.byteLength}`); this.binaries.set(path, content.slice(0)); return file; }
  async readBinary(file: TFile): Promise<ArrayBuffer> { const content = this.binaries.get(file.path); if (!content) throw new Error("Missing fake binary"); return content.slice(0); }
  async cachedRead(file: TFile): Promise<string> { const entry = this.files.get(file.path); if (!entry) throw new Error("Missing fake file"); return entry.content; }
  async read(file: TFile): Promise<string> { return this.cachedRead(file); }
  async modify(file: TFile, content: string): Promise<void> { if (this.failNextModify) { this.failNextModify = false; throw new Error("modify failed"); } this.files.set(file.path, { file, content }); this.writeCounts.set(file.path, (this.writeCounts.get(file.path) ?? 0) + 1); }
  async rename(item: TFile | { path: string }, path: string): Promise<void> {
    if (this.failNextRename) { this.failNextRename = false; throw new Error("rename failed"); }
    if (item instanceof TFile) { const oldPath = item.path; const entry = this.files.get(oldPath); if (!entry || this.files.has(path)) throw new Error("rename failed"); this.files.delete(oldPath); const binary = this.binaries.get(oldPath); this.binaries.delete(oldPath); item.path = path; this.files.set(path, entry); if (binary) this.binaries.set(path, binary); return; }
    this.folders.delete(item.path); this.folders.add(path);
  }
  async trash(item: TFile | { path: string }): Promise<void> { if (item instanceof TFile) { this.files.delete(item.path); this.binaries.delete(item.path); } else this.folders.delete(item.path); }
  getResourcePath(file: TFile): string { return `app://vault/${file.path}`; }
  writeCount(path: string): number { return this.writeCounts.get(path) ?? 0; }
}

function stored(overrides: Partial<StoredDoudouRecord> = {}): StoredDoudouRecord { return { id: "id-1", title: "猫咪日记", content: "今天记录一只猫 #日记 ", created: "2026-08-17T08:00:00.000Z", folder: "生活", tags: ["日记"], path: "兜兜/生活/2026/08/record.md", images: [], files: [], ...overrides }; }
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

test("manual hashtags require an ordinary ASCII space and deduplicate", () => {
  assert.deepEqual(extractManualTags("#摘抄 \n测试 #淘宝 \n#淘宝 #定价 \n#UI #v04 #测试123 #无畏契约 "), ["摘抄", "淘宝", "定价", "UI", "v04", "测试123", "无畏契约"]);
  assert.deepEqual(extractManualTags("#未完成\n#逗号， #句号。 #叹号！ #问号？ #顿号、 #tab\t#结尾"), []);
  assert.deepEqual(extractManualTags("# 今天的日记\n## 今天\n今天学了 C#\n#\n#正常 "), ["正常"]);
  assert.deepEqual(parseConfirmedManualTagRanges("前 #标签 后").map(({ name, start, end }) => ({ name, start, end })), [{ name: "标签", start: 2, end: 5 }]);
});

test("manual tag completion replaces only the caret fragment and appends confirmation space", () => {
  const text = "今天 #无 很开心，昨天写了 #日记 ";
  const caret = text.indexOf("无") + 1;
  const input = findManualTagInput(text, caret);
  assert.deepEqual(input, { query: "无", replacementStart: 3, replacementEnd: 6 });
  assert.deepEqual(applyManualTagCompletion(text, input!, "无畏契约"), {
    value: "今天 #无畏契约 很开心，昨天写了 #日记 ",
    selectionStart: 9,
    selectionEnd: 9
  });
  assert.equal(findManualTagInput("# 今天", 2), null);
  assert.equal(findManualTagInput("C#", 2), null);
});

test("manual tag suggestions use confirmed body tags only and never hidden AI tags", () => {
  const records = [
    stored({ id: "new", content: "#无畏契约 #日记 ", tags: ["无畏契约", "日记"], aiTags: ["游戏", "FPS"], updated: "2026-08-20T00:00:00.000Z" }),
    stored({ id: "old", content: "#日记 ", tags: ["日记"], aiTags: ["竞技"], created: "2026-08-10T00:00:00.000Z" }),
    stored({ id: "eof", content: "#未确认", tags: ["未确认"], aiTags: ["情绪"] })
  ];
  const options = collectConfirmedManualTagOptions(records);
  assert.deepEqual(options.map(({ name, count }) => ({ name, count })), [{ name: "日记", count: 2 }, { name: "无畏契约", count: 1 }]);
  assert.deepEqual(manualTagSuggestions(options, "无", new Set()).map((item) => item.name), ["无畏契约"]);
  assert.deepEqual(manualTagSuggestions(options, "", new Set(["无畏契约"])).map((item) => item.name), ["日记"]);
});

test("shared app header keeps a normal-flow flex slot on every page", () => {
  const declarations = cssDeclarations(".doudou-view > .doudou-main-shell > header.doudou-header");
  assert.match(declarations, /position:\s*relative/);
  assert.match(declarations, /inset:\s*auto/);
  assert.match(declarations, /flex:\s*0 0 auto/);
  assert.match(declarations, /height:\s*auto/);
  assert.doesNotMatch(declarations, /position:\s*(?:fixed|absolute)/);
});

test("library card previews use primary text while metadata stays muted", () => {
  assert.match(cssDeclarations(".doudou-compact-preview"), /color:\s*var\(--text-normal\)/);
  assert.match(cssDeclarations(".doudou-journal-meta, .doudou-compact-meta, .doudou-record-meta"), /color:\s*var\(--doudou-muted\)/);
});

test("confirmed manual tags keep their saved-view color while the editor uses visible text", () => {
  const tag = cssDeclarations(".doudou-confirmed-tag");
  assert.match(tag, /color:\s*var\(--doudou-tag-color\)/);
  assert.match(tag, /background:\s*transparent/);
  assert.doesNotMatch(tag, /border|border-radius|padding/);
  const textarea = cssDeclarations(".doudou-view textarea.doudou-editor-content");
  assert.match(textarea, /color:\s*var\(--text-normal\)/);
  assert.match(textarea, /background:\s*var\(--doudou-surface\)/);
  assert.doesNotMatch(textarea, /color:\s*transparent|-webkit-text-fill-color:\s*transparent/);
});

test("folder and record navigation use sticky headers inside their real scroll containers", () => {
  assert.match(cssDeclarations(".doudou-folder-sticky"), /position:\s*sticky/);
  assert.match(cssDeclarations(".doudou-view .doudou-record-header"), /position:\s*sticky/);
  assert.match(cssDeclarations(".doudou-view .doudou-library-body.doudou-is-folder-view"), /padding:/);
  assert.match(cssDeclarations(".doudou-view .doudou-record-page"), /overflow-y:\s*auto/);
});

test("editing header is normal-flow while the reading header remains sticky", () => {
  assert.match(cssDeclarations(".doudou-view .doudou-record-header"), /position:\s*sticky/);
  const editorHeader = cssDeclarations(".doudou-view .doudou-record-header.doudou-editor-header");
  assert.match(editorHeader, /position:\s*relative/);
  assert.match(editorHeader, /top:\s*auto/);
});

test("insertText never writes the outer editor scrollTop", () => {
  assert.equal(simulateEditorInputWithoutOuterScroll("insertText"), 72);
});

test("deleteContentBackward never writes the outer editor scrollTop", () => {
  assert.equal(simulateEditorInputWithoutOuterScroll("deleteContentBackward"), 72);
});

test("insertLineBreak never writes the outer editor scrollTop", () => {
  assert.equal(simulateEditorInputWithoutOuterScroll("insertLineBreak"), 72);
});

test("the per-input iOS outer scroll correction is removed", () => {
  assert.equal(existsSync(new URL("../src/ui/editorScroll.ts", import.meta.url)), false);
  const editorSources = recordPageSource + recordTextareaEditorSource;
  assert.doesNotMatch(editorSources, /stabilizeIosTextarea|beforeinput|requestAnimationFrame|visualViewport/);
  assert.doesNotMatch(editorSources, /scrollTop|scrollIntoView|scrollTo|scrollBy/);
});

test("all platforms share one editor code path", () => {
  assert.doesNotMatch(recordTextareaEditorSource, /Platform|isIosApp|isMobileApp|isDesktopApp/);
  assert.match(recordPageSource, /createRecordTextareaEditor\(form, record\?\.content \?\? "", records,/);
});

test("empty and existing bodies load directly into the visible textarea", () => {
  const emptyForm = document.createElement("div");
  const empty = createRecordTextareaEditor(emptyForm, "", []);
  assert.equal(empty.value, "");
  assert.ok(empty.matches("textarea.doudou-editor-content"));
  assert.equal(emptyForm.querySelector(".doudou-tag-editor-mirror"), null);

  const existingForm = document.createElement("div");
  const existing = createRecordTextareaEditor(existingForm, "已有正文 #生活 ", []);
  assert.equal(existing.value, "已有正文 #生活 ");
  assert.equal(existingForm.querySelector(".doudou-tag-editor-mirror"), null);
});

test("textarea auto-grows during initialization", () => {
  const restore = mockTextareaScrollHeight(() => 238);
  try {
    const form = document.createElement("div");
    const textarea = createRecordTextareaEditor(form, "短正文", []);
    assert.equal(textarea.style.height, "240px");
  } finally {
    restore();
  }
});

test("ordinary input with unchanged content height never writes the real textarea height", async () => {
  const restore = mockTextareaScrollHeight((textarea) => {
    assert.ok(textarea.classList.contains("doudou-textarea-measure"));
    return 498;
  });
  try {
    const form = document.createElement("div");
    const textarea = createRecordTextareaEditor(form, "正文", []);
    assert.equal(textarea.style.height, "500px");
    const mutations = await countStyleMutations(textarea, () => {
      textarea.value += "字";
      textarea.dispatchEvent(new viewerDom.window.InputEvent("input", { bubbles: true, inputType: "insertText" }));
    });
    assert.equal(mutations, 0);
    assert.equal(textarea.style.height, "500px");
    assert.doesNotMatch(recordTextareaEditorSource, /textarea\.style\.height\s*=\s*["']auto["']/);
  } finally {
    restore();
  }
});

test("Enter writes the final increased height exactly once", async () => {
  let height = 498;
  const restore = mockTextareaScrollHeight(() => height);
  try {
    const form = document.createElement("div");
    const textarea = createRecordTextareaEditor(form, "正文", []);
    assert.equal(textarea.style.height, "500px");
    height = 524;
    const mutations = await countStyleMutations(textarea, () => {
      textarea.value += "\n";
      textarea.dispatchEvent(new viewerDom.window.InputEvent("input", { bubbles: true, inputType: "insertLineBreak" }));
    });
    assert.equal(mutations, 1);
    assert.equal(textarea.style.height, "526px");
  } finally {
    restore();
  }
});

test("pasting long text recalculates textarea height", () => {
  let height = 218;
  const restore = mockTextareaScrollHeight(() => height);
  try {
    const form = document.createElement("div");
    const textarea = createRecordTextareaEditor(form, "", []);
    height = 2_398;
    textarea.value = "粘贴的长正文\n".repeat(120);
    textarea.dispatchEvent(new viewerDom.window.InputEvent("input", {
      bubbles: true,
      inputType: "insertFromPaste"
    }));
    assert.equal(textarea.style.height, "2400px");
  } finally {
    restore();
  }
});

test("IME composition keeps the value and auto-grows on completion", () => {
  let height = 218;
  const restore = mockTextareaScrollHeight(() => height);
  try {
    const form = document.createElement("div");
    const textarea = createRecordTextareaEditor(form, "中文", []);
    textarea.dispatchEvent(new viewerDom.window.CompositionEvent("compositionstart", { bubbles: true }));
    height = 308;
    textarea.value = "中文输入完成";
    textarea.dispatchEvent(new viewerDom.window.InputEvent("input", {
      bubbles: true,
      inputType: "insertCompositionText",
      isComposing: true
    }));
    textarea.dispatchEvent(new viewerDom.window.CompositionEvent("compositionend", { bubbles: true }));
    assert.equal(textarea.value, "中文输入完成");
    assert.equal(textarea.style.height, "310px");
  } finally {
    restore();
  }
});

test("deleting a line writes the final reduced height exactly once", async () => {
  let height = 524;
  const restore = mockTextareaScrollHeight(() => height);
  try {
    const form = document.createElement("div");
    const textarea = createRecordTextareaEditor(form, "第一行\n第二行", []);
    assert.equal(textarea.style.height, "526px");
    height = 498;
    textarea.value = "缩短后的正文";
    const mutations = await countStyleMutations(textarea, () => {
      textarea.dispatchEvent(new viewerDom.window.InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
    });
    assert.equal(mutations, 1);
    assert.equal(textarea.style.height, "500px");
  } finally {
    restore();
  }
});

test("tag suggestion completion recalculates textarea height", () => {
  let height = 218;
  const restore = mockTextareaScrollHeight(() => height);
  const record: StoredDoudouRecord = {
    id: "tag-source",
    path: "兜兜/工作/2026/08/tag-source.md",
    content: "#工作 ",
    created: "2026-08-25T00:00:00.000Z",
    folder: "工作",
    tags: ["工作"]
  };
  const form = document.createElement("div");
  document.body.appendChild(form);
  try {
    const textarea = createRecordTextareaEditor(form, "#工", [record]);
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    textarea.focus();
    const suggestion = form.querySelector<HTMLButtonElement>(".doudou-tag-suggestion");
    assert.ok(suggestion);
    height = 258;
    suggestion.click();
    assert.equal(textarea.value, "#工作 ");
    assert.equal(textarea.style.height, "260px");
  } finally {
    form.remove();
    restore();
  }
});

test("hundreds of lines grow without introducing an editor max height", () => {
  const restore = mockTextareaScrollHeight(() => 11_998);
  try {
    const form = document.createElement("div");
    const textarea = createRecordTextareaEditor(form, "长正文\n".repeat(400), []);
    assert.equal(textarea.style.height, "12000px");
    const textareaCss = cssDeclarations(".doudou-view textarea.doudou-editor-content");
    assert.doesNotMatch(textareaCss, /max-height/);
  } finally {
    restore();
  }
});

test("ordinary text input leaves hidden tag suggestions unchanged", async () => {
  const form = document.createElement("div");
  const textarea = createRecordTextareaEditor(form, "普通正文", []);
  const suggestions = form.querySelector<HTMLElement>(".doudou-tag-suggestions");
  assert.ok(suggestions);
  textarea.focus();
  let mutations = 0;
  const observer = new MutationObserver((records) => { mutations += records.length; });
  observer.observe(suggestions, { childList: true, attributes: true });
  textarea.value += "字";
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  textarea.dispatchEvent(new viewerDom.window.InputEvent("input", { bubbles: true, inputType: "insertText" }));
  textarea.dispatchEvent(new viewerDom.window.KeyboardEvent("keyup", { bubbles: true, key: "字" }));
  await Promise.resolve();
  observer.disconnect();
  assert.equal(mutations, 0);
  assert.equal(suggestions.childNodes.length, 0);
  assert.ok(suggestions.classList.contains("doudou-is-hidden"));
});

test("editor contains no mirror or transparent overlay", () => {
  const form = document.createElement("div");
  const textarea = createRecordTextareaEditor(form, "普通正文", []);
  const wrapper = form.querySelector<HTMLElement>(".doudou-textarea-editor");
  assert.ok(wrapper);
  assert.equal(form.querySelector(".doudou-tag-editor-mirror"), null);
  assert.equal(form.querySelector(".doudou-tag-editor-input"), null);
  assert.equal(textarea.value, "普通正文");
  assert.doesNotMatch(recordTextareaEditorSource, /mirror|renderManualTagText/);
  assert.doesNotMatch(pluginCss, /doudou-tag-editor-mirror|doudou-tag-editor-input|color:\s*transparent/);
});

test("measurement textarea stays outside flow and cleanup disconnects width observation", () => {
  const originalResizeObserver = globalThis.ResizeObserver;
  let observed: Element | null = null;
  let disconnected = false;
  let triggerResize: (() => void) | null = null;
  class TestResizeObserver implements ResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      triggerResize = () => callback([], this);
    }
    observe(target: Element): void { observed = target; }
    unobserve(): void { /* No-op test double. */ }
    disconnect(): void { disconnected = true; }
  }
  Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: TestResizeObserver });
  let height = 298;
  const restoreHeight = mockTextareaScrollHeight(() => height);
  const form = document.createElement("div");
  let cleanup: (() => void) | null = null;
  try {
    const textarea = createRecordTextareaEditor(form, "已有长正文", [], (registered) => { cleanup = registered; });
    const measurement = form.querySelector<HTMLTextAreaElement>(".doudou-textarea-measure");
    assert.ok(measurement);
    assert.equal(observed, textarea);
    assert.equal(measurement.getAttribute("aria-hidden"), "true");
    assert.equal(measurement.tabIndex, -1);
    assert.equal(measurement.readOnly, true);
    assert.equal(measurement.offsetHeight, 0);
    const measureCss = cssDeclarations(".doudou-view textarea.doudou-editor-content.doudou-textarea-measure");
    assert.match(measureCss, /position:\s*absolute/);
    assert.match(measureCss, /visibility:\s*hidden/);
    assert.match(measureCss, /pointer-events:\s*none/);
    assert.match(measureCss, /height:\s*0/);
    assert.match(measureCss, /min-height:\s*0/);
    const formScrollHeight = form.scrollHeight;
    measurement.value = "不会参与正常流的测量正文\n".repeat(100);
    assert.equal(form.scrollHeight, formScrollHeight);

    textarea.getBoundingClientRect = () => ({
      top: 0, bottom: 300, left: 0, right: 320, width: 320, height: 300, x: 0, y: 0,
      toJSON: () => ({})
    });
    height = 358;
    triggerResize?.();
    assert.equal(textarea.style.height, "360px");
    assert.equal(measurement.style.width, "320px");
    assert.ok(cleanup);
    cleanup?.();
    assert.equal(disconnected, true);
    assert.equal(form.querySelector(".doudou-textarea-measure"), null);
  } finally {
    cleanup?.();
    restoreHeight();
    Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: originalResizeObserver });
  }
});

test("textarea does not create nested vertical scrolling", () => {
  const textareaCss = cssDeclarations(".doudou-view textarea.doudou-editor-content");
  assert.match(textareaCss, /overflow-y:\s*hidden/);
  assert.match(textareaCss, /resize:\s*none/);
  assert.match(cssDeclarations(".doudou-view .doudou-record-page"), /overflow-y:\s*auto/);
});

test("VisualViewport resize updates the root layout height", () => {
  const harness = createViewportHarness();
  const cleanup = registerViewportResizeLayout(harness.root, harness.viewport, {
    isMobile: true,
    layoutViewportHeight: () => 800
  });
  try {
    assert.equal(harness.root.style.getPropertyValue("--doudou-visual-viewport-height"), "620px");
    harness.setHeight(500);
    harness.dispatch("resize");
    assert.equal(harness.root.style.getPropertyValue("--doudou-visual-viewport-height"), "420px");
  } finally {
    cleanup();
  }
});

test("VisualViewport scroll and offsetTop changes never update root height", () => {
  const harness = createViewportHarness();
  const cleanup = registerViewportResizeLayout(harness.root, harness.viewport, {
    isMobile: true,
    layoutViewportHeight: () => 800
  });
  try {
    const initialHeight = harness.root.style.getPropertyValue("--doudou-visual-viewport-height");
    harness.setOffsetTop(160);
    harness.dispatch("scroll");
    assert.equal(harness.root.style.getPropertyValue("--doudou-visual-viewport-height"), initialHeight);
    assert.doesNotMatch(viewportLayoutSource, /offsetTop|pageTop|addEventListener\("scroll"/);
  } finally {
    cleanup();
  }
});

test("viewport height changes update keyboard-open without caret-pan input", () => {
  const harness = createViewportHarness();
  const cleanup = registerViewportResizeLayout(harness.root, harness.viewport, {
    isMobile: true,
    layoutViewportHeight: () => 800
  });
  try {
    assert.equal(harness.root.classList.contains("doudou-keyboard-open"), false);
    harness.setHeight(600);
    harness.dispatch("resize");
    assert.equal(harness.root.classList.contains("doudou-keyboard-open"), true);
    harness.setHeight(720);
    harness.dispatch("resize");
    assert.equal(harness.root.classList.contains("doudou-keyboard-open"), false);
  } finally {
    cleanup();
  }
});

test("viewport resize listener is removed by cleanup", () => {
  const harness = createViewportHarness();
  const cleanup = registerViewportResizeLayout(harness.root, harness.viewport, {
    isMobile: true,
    layoutViewportHeight: () => 800
  });
  const initialHeight = harness.root.style.getPropertyValue("--doudou-visual-viewport-height");
  cleanup();
  harness.setHeight(400);
  harness.dispatch("resize");
  assert.equal(harness.root.style.getPropertyValue("--doudou-visual-viewport-height"), initialHeight);
});

test("editor input has no path to root viewport height correction", () => {
  assert.doesNotMatch(viewportLayoutSource, /input|beforeinput|textarea|selection|caret/);
  assert.doesNotMatch(doudouViewSource, /addEventListener\("scroll"|offsetTop|pageTop/);
  assert.match(doudouViewSource, /registerViewportResizeLayout/);
});

test("mobile pages avoid duplicate top safe area and clear the host navbar", () => {
  const clearance = cssDeclarations(".is-mobile .doudou-view");
  assert.match(clearance, /--doudou-mobile-navbar-clearance:/);
  assert.match(clearance, /--navbar-height/);
  assert.match(clearance, /--mobile-toolbar-height/);
  assert.match(clearance, /--navbar-bottom-offset/);
  assert.match(clearance, /--safe-area-inset-bottom/);

  const appHeader = cssDeclarations(".is-mobile .doudou-view > .doudou-main-shell > header.doudou-header");
  const recordHeader = cssDeclarations(".is-mobile .doudou-view .doudou-record-header");
  assert.match(appHeader, /padding-top:\s*6px/);
  assert.match(recordHeader, /padding-top:\s*8px/);
  assert.doesNotMatch(appHeader, /safe-area-inset-top/);
  assert.doesNotMatch(recordHeader, /safe-area-inset-top/);

  const scrollingPages = cssDeclarations(".is-mobile .doudou-view .doudou-timeline,\n.is-mobile .doudou-view .doudou-library-body,\n.is-mobile .doudou-view .doudou-record-page");
  assert.match(scrollingPages, /padding-bottom:\s*var\(--doudou-mobile-navbar-clearance\)/);
  assert.match(scrollingPages, /scroll-padding-bottom:\s*var\(--doudou-mobile-navbar-clearance\)/);

  const keyboardOpen = cssDeclarations(".is-mobile .doudou-view.doudou-keyboard-open .doudou-timeline,\n.is-mobile .doudou-view.doudou-keyboard-open .doudou-library-body,\n.is-mobile .doudou-view.doudou-keyboard-open .doudou-record-page");
  assert.match(keyboardOpen, /padding-bottom:\s*16px/);
  assert.match(keyboardOpen, /scroll-padding-bottom:\s*16px/);
});

test("navigation labels change without changing internal page or virtual-folder identity", () => {
  assert.equal(RECENT_PAGE_LABEL, "最近");
  assert.equal(ALL_RECORDS_FOLDER, "全部资料");
  assert.equal(ALL_RECORDS_FOLDER_LABEL, "资料总览");
});

test("library home and overview search globally while a real folder stays scoped", () => {
  assert.equal(librarySearchFolder(null), undefined);
  assert.equal(librarySearchFolder(ALL_RECORDS_FOLDER), undefined);
  assert.equal(librarySearchFolder("摘抄"), "摘抄");
  const records = [
    stored({ id: "life", folder: "日常杂乱", content: "无畏契约", tags: [] }),
    stored({ id: "quote", folder: "摘抄", content: "小说摘抄", tags: [] })
  ];
  assert.deepEqual(filterRecords(records, { query: "无畏契约", folder: librarySearchFolder(null), tags: new Set() }).map((item) => item.id), ["life"]);
  assert.deepEqual(filterRecords(records, { query: "无畏契约", folder: librarySearchFolder("摘抄"), tags: new Set() }), []);
});

test("library home search expands in place instead of navigating to overview", () => {
  const start = libraryPageSource.indexOf("private renderFolders(): void");
  const end = libraryPageSource.indexOf("private renderLibraryHomeContent(): void");
  const renderFoldersSource = libraryPageSource.slice(start, end);
  assert.match(renderFoldersSource, /this\.searchExpanded = true; this\.render\(\)/);
  assert.doesNotMatch(renderFoldersSource, /this\.currentFolder\s*=/);
  assert.match(libraryPageSource, /this\.renderCards\(results, undefined, true\)/);
});

test("folder order modal state loads normal folders through an async service", async () => {
  const states: FolderOrderLoadState[] = [];
  const result = await loadFolderOrderState(async () => ["日常杂乱", "小说", "摘抄"], (state) => states.push(state));
  assert.deepEqual(states.map((state) => state.status), ["loading", "loaded"]);
  assert.deepEqual(result, { status: "loaded", names: ["日常杂乱", "小说", "摘抄"] });
});

test("folder order modal remains loading until the async service resolves", async () => {
  const states: FolderOrderLoadState[] = []; let resolve!: (names: string[]) => void;
  const pending = loadFolderOrderState(() => new Promise<string[]>((done) => { resolve = done; }), (state) => states.push(state));
  assert.deepEqual(states.map((state) => state.status), ["loading"]);
  resolve(["小说", "日记"]); await pending;
  assert.deepEqual(states.map((state) => state.status), ["loading", "loaded"]); assert.deepEqual(states[1]?.names, ["小说", "日记"]);
});

test("folder order modal reports empty only after loading completes", async () => {
  const states: FolderOrderLoadState[] = [];
  const result = await loadFolderOrderState(async () => [], (state) => states.push(state));
  assert.deepEqual(states.map((state) => state.status), ["loading", "loaded"]); assert.deepEqual(result, { status: "loaded", names: [] });
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
  const vault = new FakeVault(); const repository = new DoudouRepository(vault as unknown as Vault); await repository.createFolder("喵布小铺"); const record = repository.createRecord("7cm 立牌 #淘宝 #定价 ", "喵布小铺", "立牌价格"); const created = await repository.save(record); assert.match(created.path, /^兜兜\/喵布小铺\/\d{4}\/\d{2}\//); assert.deepEqual(created.tags, ["淘宝", "定价"]); assert.deepEqual(await repository.listFolders(), [{ name: "喵布小铺", count: 1 }]);
});

test("folder order removes deleted legacy folders and appends new real folders", () => {
  assert.deepEqual(normalizeFolderOrder(["副业", "日记"], ["生活", "副业", "日记"]), ["副业", "日记"]);
  assert.deepEqual(normalizeFolderOrder(["副业", "日记", "小说"], ["副业", "日记"]), ["副业", "日记", "小说"]);
});

test("old settings safely initialize an empty folder order", () => {
  assert.deepEqual(normalizeSettings({ autoAiTags: true }).folderOrder, []);
  assert.deepEqual(normalizeSettings({ folderOrder: [" 日记 ", "日记", 42] }).folderOrder, ["日记"]);
});

test("folder service migrates the old local order into shared Vault config", async () => {
  const vault = new FakeVault(); const repository = new DoudouRepository(vault as unknown as Vault);
  for (const name of ["副业", "日记", "小说"]) await repository.createFolder(name);
  let legacyOrder = ["小说", "日记", "副业"]; let cleared = false;
  const service = new FolderService(repository, new VaultFolderOrderStore(vault as unknown as Vault), () => legacyOrder, async () => { legacyOrder = []; cleared = true; });
  assert.deepEqual(await service.folderNames(), ["小说", "日记", "副业"]);
  const config = vault.files.get(DOUDOU_SHARED_CONFIG_PATH)?.content ?? "";
  assert.deepEqual(parseSharedDoudouConfig(config), { folderOrder: ["小说", "日记", "副业"] });
  assert.equal(cleared, true); assert.deepEqual(legacyOrder, []);
});

test("folder store migrates the v0.5.2 hidden config to the visible Vault path", async () => {
  const vault = new FakeVault(); await vault.createFolder("兜兜"); await vault.create(DOUDOU_LEGACY_HIDDEN_CONFIG_PATH, JSON.stringify({ folderOrder: ["小说", "日记"] }));
  const store = new VaultFolderOrderStore(vault as unknown as Vault);
  assert.deepEqual(await store.read(), ["小说", "日记"]); assert.deepEqual(parseSharedDoudouConfig(vault.files.get(DOUDOU_SHARED_CONFIG_PATH)?.content ?? ""), { folderOrder: ["小说", "日记"] });
});

test("shared Vault order takes priority over stale local settings", async () => {
  const vault = new FakeVault(); const repository = new DoudouRepository(vault as unknown as Vault); for (const name of ["副业", "小说"]) await repository.createFolder(name);
  const store = new VaultFolderOrderStore(vault as unknown as Vault); await store.write(["小说", "副业"]); let legacyOrder = ["副业", "小说"];
  const service = new FolderService(repository, store, () => legacyOrder, async () => { legacyOrder = []; });
  assert.deepEqual(await service.folderNames(), ["小说", "副业"]); assert.deepEqual(legacyOrder, []);
});

test("shared order removes deleted folders, excludes assets and appends new folders", async () => {
  const vault = new FakeVault(); const repository = new DoudouRepository(vault as unknown as Vault); for (const name of ["日常杂乱", "小说", "摘抄"]) await repository.createFolder(name); await vault.createFolder("兜兜/assets");
  const store = new VaultFolderOrderStore(vault as unknown as Vault); await store.write(["日常杂乱", "日记", "小说", "assets"]); const service = new FolderService(repository, store);
  const library = (await service.listFolders()).map((folder) => folder.name); const createSelector = await service.folderNames(); const editSelector = await service.folderNames();
  assert.deepEqual(library, ["日常杂乱", "小说", "摘抄"]); assert.deepEqual(createSelector, library); assert.deepEqual(editSelector, library); assert.deepEqual(await store.read(), library);
});

test("custom shared order persists across service instances", async () => {
  const vault = new FakeVault(); const repository = new DoudouRepository(vault as unknown as Vault); for (const name of ["副业", "日记", "小说"]) await repository.createFolder(name); const store = new VaultFolderOrderStore(vault as unknown as Vault);
  await new FolderService(repository, store).setOrder(["小说", "日记", "副业"]);
  const reopened = new FolderService(repository, store); assert.deepEqual(await reopened.folderNames(), ["小说", "日记", "副业"]);
  const modalState = await loadFolderOrderState(() => reopened.folderNames(), () => {}); assert.deepEqual(modalState, { status: "loaded", names: ["小说", "日记", "副业"] });
});

test("new, deleted and renamed folders update shared order without disturbing positions", async () => {
  const vault = new FakeVault(); const repository = new DoudouRepository(vault as unknown as Vault); for (const name of ["副业", "日记"]) await repository.createFolder(name); const store = new VaultFolderOrderStore(vault as unknown as Vault); await store.write(["日记", "副业"]); const service = new FolderService(repository, store);
  await service.createFolder("小说"); assert.deepEqual(await store.read(), ["日记", "副业", "小说"]);
  await service.renameFolder("副业", "摘抄"); assert.deepEqual(await store.read(), ["日记", "摘抄", "小说"]);
  await service.deleteFolder("日记"); assert.deepEqual(await store.read(), ["摘抄", "小说"]); assert.deepEqual(await service.folderNames(), ["摘抄", "小说"]);
});

test("externally modified shared order is read on refresh without a write loop", async () => {
  const vault = new FakeVault(); const repository = new DoudouRepository(vault as unknown as Vault); for (const name of ["日记", "摘抄", "小说"]) await repository.createFolder(name); const store = new VaultFolderOrderStore(vault as unknown as Vault); await store.write(["小说", "日记", "摘抄"]); const service = new FolderService(repository, store);
  const configFile = vault.getAbstractFileByPath(DOUDOU_SHARED_CONFIG_PATH); assert.ok(configFile instanceof TFile);
  await vault.modify(configFile, JSON.stringify({ folderOrder: ["日记", "摘抄", "小说"] })); const writesAfterExternalSync = vault.writeCount(DOUDOU_SHARED_CONFIG_PATH);
  assert.equal(repository.isDoudouPath(DOUDOU_SHARED_CONFIG_PATH), true); assert.deepEqual(await service.folderNames(), ["日记", "摘抄", "小说"]); assert.equal(vault.writeCount(DOUDOU_SHARED_CONFIG_PATH), writesAfterExternalSync);
  await service.folderNames(); assert.equal(vault.writeCount(DOUDOU_SHARED_CONFIG_PATH), writesAfterExternalSync);
});

test("shared internal config never becomes a record, folder or search result", async () => {
  const vault = new FakeVault(); const repository = new DoudouRepository(vault as unknown as Vault); await repository.createFolder("小说"); const store = new VaultFolderOrderStore(vault as unknown as Vault); await store.write(["小说"]);
  assert.equal(isDoudouRecordPath(DOUDOU_SHARED_CONFIG_PATH), false); assert.deepEqual(await repository.loadAll(), []); assert.deepEqual(await repository.listFolders(), [{ name: "小说", count: 0 }]); assert.deepEqual(filterRecords(await repository.loadAll(), { query: "folderOrder", tags: new Set() }), []);
});

test("moving a record changes Markdown folder but never attachment paths", async () => {
  const vault = new FakeVault(); const repository = new DoudouRepository(vault as unknown as Vault); const original = await repository.save({ ...repository.createRecord("正文", "生活"), images: ["兜兜/assets/2026/08/keep.jpg"], files: ["兜兜/assets/2026/08/keep.pdf"] }); const name = original.path.split("/").at(-1)!; const moved = await repository.update(original, { title: "新标题", content: "修改 #标签 ", folder: "工作", images: original.images, files: original.files }); assert.equal(moved.path, buildRecordPath("工作", original.created, name)); assert.deepEqual(moved.images, original.images); assert.deepEqual(moved.files, original.files); assert.deepEqual(moved.tags, ["标签"]); assert.equal(vault.files.size, 1);
});

test("editing only legacy metadata preserves old manual tags without rewriting body syntax", async () => {
  const vault = new FakeVault();
  const repository = new DoudouRepository(vault as unknown as Vault);
  const legacy = await repository.save({ ...repository.createRecord("旧正文", "生活"), tags: ["旧标签"] });
  const file = vault.files.get(legacy.path)!;
  file.content = serializeRecord({ ...legacy, content: "旧正文 #旧标签", tags: ["旧标签"] });
  repository.invalidateCache();
  const loaded = (await repository.loadAll())[0];
  const updated = await repository.update(loaded, { title: "只改标题", content: loaded.content, folder: loaded.folder, images: loaded.images, files: loaded.files });
  assert.deepEqual(updated.tags, ["旧标签"]);
  assert.equal(updated.content, "旧正文 #旧标签");
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
  const records = [stored({ title: "亚克力定价", content: "准备卖 13.9 #淘宝 ", folder: "喵布小铺", tags: ["淘宝"], aiTags: ["周边商品"], files: ["兜兜/assets/2026/08/id-file-01-2026报价表.xlsx"] })];
  for (const query of ["亚克力", "13.9", "#淘宝", "周边商品", "喵布小铺", "报价表"]) assert.equal(filterRecords(records, { query, tags: new Set() }).length, 1);
  assert.equal(filterRecords(records, { query: "assets", tags: new Set() }).length, 0);
  assert.equal(metaText(records[0]), "喵布小铺 · #淘宝"); assert.deepEqual(collectTagOptions(records).map((item) => item.name), ["淘宝"]);
});

test("question ranking uses title, folder and hidden AI tags", () => {
  const result = rankRecordsForQuestion([stored({ title: "亚克力立牌", folder: "喵布小铺", aiTags: ["商品定价"] })], "立牌定价", ["商品定价"], 10); assert.equal(result.length, 1);
});

test("question ranking still recalls August diary records through hidden AI tags", () => {
  const result = rankRecordsForQuestion([
    stored({ content: "八月的一天", tags: [], aiTags: ["日记"] })
  ], "帮我总结一下八月的日记", [], 10);
  assert.equal(result.length, 1);
  assert.ok(result[0].score > 0);
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

test("viewer opens at the selected image and respects navigation boundaries", () => {
  const items = storedViewerItems(["a.jpg", "b.jpg", "c.jpg"]);
  let state = initialViewerState(1, items.length);
  assert.equal(state.index, 1);
  assert.equal(currentViewerItem(items, state), items[1]);
  state = switchViewerImage(state, -1, items.length);
  assert.equal(state.index, 0);
  assert.equal(switchViewerImage(state, -1, items.length).index, 0);
  state = switchViewerImage(state, 20, items.length);
  assert.equal(state.index, 2);
  assert.equal(switchViewerImage(state, 1, items.length).index, 2);
  assert.equal(initialViewerState(8, 1).index, 0);
  assert.equal(switchViewerImage(initialViewerState(0, 1), 1, 1).index, 0);
});

test("viewer resets zoom and translation whenever the current image changes", () => {
  const state = switchViewerImage({ index: 0, scale: 4, translateX: 120, translateY: -80 }, 1, 3);
  assert.deepEqual(state, { index: 1, scale: 1, translateX: 0, translateY: 0 });
  assert.equal(clampViewerScale(0.1), 1);
  assert.equal(clampViewerScale(9), 5);
  assert.equal(clampViewerScale(2.5), 2.5);
});

test("stored and pending viewer items preserve their original sources and GIF MIME", async () => {
  const storedItems = storedViewerItems(["兜兜/assets/2026/08/animation.gif"]);
  assert.deepEqual(storedItems[0], { kind: "stored", path: "兜兜/assets/2026/08/animation.gif" });
  const file = new File([new Uint8Array([71, 73, 70])], "animation.gif", { type: "image/gif" });
  const pending = pendingViewerItem({ id: "pending-gif", file, previewUrl: "blob:pending-gif" });
  assert.equal(pending.kind, "pending");
  assert.equal(pending.previewUrl, "blob:pending-gif");
  assert.equal(pending.mime, "image/gif");
  assert.equal(await viewerItemFile({} as ImageService, pending), file);
});

test("GIF preview session staticizes stored GIFs, labels them and reuses its memory cache", async () => {
  const root = document.body.createDiv();
  const firstWrap = root.createDiv();
  const secondWrap = root.createDiv();
  const first = firstWrap.createEl("img") as HTMLImageElement;
  const second = secondWrap.createEl("img") as HTMLImageElement;
  let decoded = 0;
  let created = 0;
  const revoked: string[] = [];
  const session = new GifPreviewSession(
    async () => { decoded += 1; return new Blob(["still"], { type: "image/png" }); },
    {
      createObjectURL: () => `blob:still-${++created}`,
      revokeObjectURL: (url) => revoked.push(url)
    }
  );
  const images = {
    readAsFile: async () => new File(["gif"], "motion.gif", { type: "image/gif" })
  } as ImageService;
  assert.equal(session.applyStored(first, firstWrap, "兜兜/assets/2026/08/motion.gif", images, "app://original.gif"), true);
  assert.equal(session.applyStored(second, secondWrap, "兜兜/assets/2026/08/motion.gif", images, "app://original.gif"), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(decoded, 1);
  assert.equal(created, 1);
  assert.equal(first.src, "blob:still-1");
  assert.equal(second.src, "blob:still-1");
  assert.equal(first.dataset.gifPreview, "static");
  assert.equal(firstWrap.querySelector(".doudou-gif-badge")?.textContent, "GIF");
  assert.equal(secondWrap.querySelector(".doudou-gif-badge")?.textContent, "GIF");
  session.dispose();
  assert.deepEqual(revoked, ["blob:still-1"]);
  root.remove();
});

test("GIF preview supports pending files while non-GIF images bypass decoding", async () => {
  const root = document.body.createDiv();
  const pendingWrap = root.createDiv();
  const ordinaryWrap = root.createDiv();
  const pendingImage = pendingWrap.createEl("img") as HTMLImageElement;
  const ordinaryImage = ordinaryWrap.createEl("img", { attr: { src: "app://photo.png" } }) as HTMLImageElement;
  let decoded = 0;
  const session = new GifPreviewSession(
    async () => { decoded += 1; return new Blob(["still"]); },
    { createObjectURL: () => "blob:pending-still", revokeObjectURL: () => undefined }
  );
  const pending = {
    id: "draft-gif",
    file: new File(["gif"], "draft.gif", { type: "image/gif" }),
    previewUrl: "blob:pending-original"
  };
  assert.equal(session.applyPending(pendingImage, pendingWrap, pending), true);
  assert.equal(session.applyStored(ordinaryImage, ordinaryWrap, "兜兜/assets/2026/08/photo.png", {} as ImageService), false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(decoded, 1);
  assert.equal(pendingImage.src, "blob:pending-still");
  assert.equal(pendingWrap.querySelector(".doudou-gif-badge")?.textContent, "GIF");
  assert.equal(ordinaryImage.src, "app://photo.png");
  assert.equal(ordinaryWrap.querySelector(".doudou-gif-badge"), null);
  assert.equal(isGifPath("兜兜/assets/a.GIF"), true);
  assert.equal(isGifFile(new File(["x"], "unknown.bin", { type: "image/gif" })), true);
  assert.equal(isGifPath("兜兜/assets/a.webp"), false);
  session.dispose();
  root.remove();
});

test("every non-viewer thumbnail surface uses the shared GIF preview session", () => {
  const allPage = readFileSync(new URL("../src/ui/AllPage.ts", import.meta.url), "utf8");
  const recordPage = readFileSync(new URL("../src/ui/RecordPage.ts", import.meta.url), "utf8");
  const viewer = readFileSync(new URL("../src/ui/ImagePreviewModal.ts", import.meta.url), "utf8");
  assert.match(allPage, /gifPreviews\.applyStored/);
  assert.match(libraryPageSource, /gifPreviews\.applyStored/);
  assert.match(recordPage, /gifPreviews\.applyStored/);
  assert.match(recordPage, /gifPreviews\.applyPending/);
  assert.doesNotMatch(viewer, /GifPreviewSession|gifPreviews|doudou-gif-badge/);
});

test("GIF preview failure keeps the original source and late decode URLs are revoked after clear", async () => {
  const root = document.body.createDiv();
  const failedWrap = root.createDiv();
  const failedImage = failedWrap.createEl("img") as HTMLImageElement;
  const failed = new GifPreviewSession(async () => { throw new Error("decode failed"); });
  failed.applyStored(failedImage, failedWrap, "兜兜/assets/fallback.gif", {
    readAsFile: async () => new File(["gif"], "fallback.gif", { type: "image/gif" })
  } as ImageService, "app://fallback.gif");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(failedImage.src, "app://fallback.gif");
  assert.equal(failedImage.dataset.gifPreview, "fallback");
  assert.equal(failedWrap.querySelector(".doudou-gif-badge")?.textContent, "GIF");
  failed.dispose();

  let finishDecode: ((blob: Blob) => void) | null = null;
  const revoked: string[] = [];
  const pending = new GifPreviewSession(
    () => new Promise((resolve) => { finishDecode = resolve; }),
    { createObjectURL: () => "blob:late-still", revokeObjectURL: (url) => revoked.push(url) }
  );
  const lateWrap = root.createDiv();
  const lateImage = lateWrap.createEl("img") as HTMLImageElement;
  pending.applyStored(lateImage, lateWrap, "兜兜/assets/late.gif", {
    readAsFile: async () => new File(["gif"], "late.gif", { type: "image/gif" })
  } as ImageService, "app://late.gif");
  await Promise.resolve();
  pending.clear();
  if (!finishDecode) throw new Error("GIF decoder did not start");
  (finishDecode as (blob: Blob) => void)(new Blob(["still"]));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(revoked, ["blob:late-still"]);
  assert.equal(lateImage.getAttribute("src"), null);
  root.remove();
});

test("pending preview URLs stay alive while a viewer retains them", () => {
  const original = URL.revokeObjectURL;
  const revoked: string[] = [];
  URL.revokeObjectURL = (url) => { revoked.push(url); };
  try {
    const file = new File([new Uint8Array([1])], "draft.png", { type: "image/png" });
    const pending = { id: "draft", file, previewUrl: "blob:draft" };
    const releaseViewer = retainPendingPreviewUrls([pending.previewUrl]);
    releasePendingImages([pending]);
    assert.deepEqual(revoked, []);
    releaseViewer();
    assert.deepEqual(revoked, ["blob:draft"]);
  } finally {
    URL.revokeObjectURL = original;
  }
});

test("viewer current action target follows image changes and removal clamps its index", () => {
  const items = storedViewerItems(["first.png", "second.gif", "third.webp"]);
  let state = initialViewerState(0, items.length);
  state = switchViewerImage(state, 1, items.length);
  assert.deepEqual(currentViewerItem(items, state), { kind: "stored", path: "second.gif" });
  const afterPendingRemoval = items.filter((_, index) => index !== 1);
  const clamped = { ...state, index: clampViewerIndex(state.index, afterPendingRemoval.length) };
  assert.deepEqual(currentViewerItem(afterPendingRemoval, clamped), { kind: "stored", path: "third.webp" });
});

test("removing a pending editor image keeps the remaining viewer order and index", () => {
  const first = new File([new Uint8Array([1])], "first.png", { type: "image/png" });
  const removed = new File([new Uint8Array([2])], "removed.png", { type: "image/png" });
  const pending = [
    { id: "first", file: first, previewUrl: "blob:first" },
    { id: "removed", file: removed, previewUrl: "blob:removed" }
  ];
  const editorItems: EditableImageItem[] = [
    { kind: "pending", id: "first" },
    { kind: "pending", id: "removed" },
    { kind: "stored", id: "stored", path: "兜兜/assets/2026/08/last.gif" }
  ];
  const viewerItems = editableViewerItems(
    editorItems.filter((item) => item.id !== "removed"),
    pending.filter((item) => item.id !== "removed")
  );
  assert.equal(viewerItems.length, 2);
  assert.equal(viewerItems[0]?.kind, "pending");
  assert.deepEqual(viewerItems[1], { kind: "stored", path: "兜兜/assets/2026/08/last.gif" });
  assert.equal(initialViewerState(1, viewerItems.length).index, 1);
});

test("viewer controls show initially, hide after inactivity and restart after interaction", () => {
  let scheduled: (() => void) | null = null;
  let scheduledDelay = 0;
  let cancellations = 0;
  const changes: boolean[] = [];
  const timer = new ImageViewerControlsTimer(
    (visible) => changes.push(visible),
    3_000,
    ((callback: () => void, delay?: number) => {
      scheduled = callback;
      scheduledDelay = delay ?? 0;
      return 1;
    }) as typeof setTimeout,
    (() => { cancellations += 1; }) as typeof clearTimeout
  );
  timer.start();
  assert.equal(timer.visible, true);
  assert.equal(scheduledDelay, 3_000);
  assert.ok(scheduled);
  (scheduled as () => void)();
  assert.equal(timer.visible, false);
  assert.deepEqual(changes, [false]);
  timer.show();
  assert.equal(timer.visible, true);
  assert.deepEqual(changes, [false, true]);
  timer.show();
  assert.equal(cancellations, 1);
  timer.stop();
  assert.equal(cancellations, 2);
});

test("desktop viewer DOM buttons, actions, wheel, drag and hidden class use live event paths", async () => {
  TestPlatform.isDesktopApp = true;
  TestPlatform.isMobileApp = false;
  resetShownMenuCount();
  const modal = new ImagePreviewModal(
    {} as never,
    viewerImageService(),
    storedViewerItems([
      "兜兜/assets/2026/08/first.png",
      "兜兜/assets/2026/08/second.gif",
      "兜兜/assets/2026/08/third.webp"
    ]),
    1,
    15
  );
  modal.open();
  try {
    const previous = modal.modalEl.querySelector<HTMLButtonElement>(".doudou-image-viewer-previous");
    const next = modal.modalEl.querySelector<HTMLButtonElement>(".doudou-image-viewer-next");
    const actions = modal.modalEl.querySelector<HTMLButtonElement>(".doudou-image-action-button");
    const frame = modal.modalEl.querySelector<HTMLElement>(".doudou-image-preview-frame");
    assert.ok(previous && next && actions && frame);
    const originalGif = modal.modalEl.querySelector<HTMLImageElement>("img");
    assert.match(originalGif?.alt ?? "", /2$/);
    assert.match(originalGif?.src ?? "", /second\.gif/);
    assert.equal(originalGif?.dataset.gifPreview, undefined);
    assert.equal(modal.modalEl.querySelector(".doudou-gif-badge"), null);
    previous.click();
    assert.match(modal.modalEl.querySelector<HTMLImageElement>("img")?.alt ?? "", /1$/);
    next.click(); next.click();
    assert.match(modal.modalEl.querySelector<HTMLImageElement>("img")?.alt ?? "", /3$/);
    actions.click();
    assert.equal(shownMenuCount, 1);

    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(modal.modalEl.classList.contains("doudou-viewer-controls-hidden"), true);
    frame.dispatchEvent(pointerEvent("pointerdown", 100, 100));
    frame.dispatchEvent(pointerEvent("pointerup", 100, 100));
    assert.equal(modal.modalEl.classList.contains("doudou-viewer-controls-hidden"), false);

    Object.defineProperty(frame, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ width: 600, height: 400, top: 0, left: 0, right: 600, bottom: 400, x: 0, y: 0, toJSON: () => ({}) })
    });
    frame.dispatchEvent(new WheelEvent("wheel", { deltaY: -500, bubbles: true, cancelable: true }));
    let image = modal.modalEl.querySelector<HTMLImageElement>("img");
    assert.match(image?.style.transform ?? "", /scale\((?!1\))/);
    if (!image) throw new Error("viewer image missing");
    Object.defineProperty(image, "clientWidth", { configurable: true, value: 400 });
    Object.defineProperty(image, "clientHeight", { configurable: true, value: 300 });
    frame.dispatchEvent(pointerEvent("pointerdown", 100, 100, 2));
    frame.dispatchEvent(pointerEvent("pointermove", 145, 125, 2));
    frame.dispatchEvent(pointerEvent("pointerup", 145, 125, 2));
    image = modal.modalEl.querySelector<HTMLImageElement>("img");
    assert.doesNotMatch(image?.style.transform ?? "", /translate3d\(0px, 0px/);
  } finally {
    modal.close();
  }
});

test("mobile viewer DOM touch swipe, pinch, pan and custom close use live event paths", () => {
  TestPlatform.isDesktopApp = false;
  TestPlatform.isMobileApp = true;
  const modal = new ImagePreviewModal(
    {} as never,
    viewerImageService(),
    storedViewerItems(["兜兜/assets/2026/08/one.png", "兜兜/assets/2026/08/two.gif"]),
    0,
    50
  );
  modal.open();
  try {
    const frame = modal.modalEl.querySelector<HTMLElement>(".doudou-image-preview-frame");
    const close = modal.modalEl.querySelector<HTMLButtonElement>(".doudou-image-close-button");
    const actions = modal.modalEl.querySelector<HTMLButtonElement>(".doudou-image-action-button");
    assert.ok(frame && close && actions);
    assert.equal(close.getAttribute("data-icon"), "x");
    assert.equal(actions.getAttribute("data-icon"), "share-2");
    Object.defineProperty(frame, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ width: 300, height: 300, top: 0, left: 0, right: 300, bottom: 300, x: 0, y: 0, toJSON: () => ({}) })
    });

    frame.dispatchEvent(touchEvent("touchstart", [{ clientX: 120, clientY: 100 }]));
    frame.dispatchEvent(touchEvent("touchmove", [{ clientX: 30, clientY: 100 }]));
    frame.dispatchEvent(touchEvent("touchend", [], [{ clientX: 30, clientY: 100 }]));
    assert.match(modal.modalEl.querySelector<HTMLImageElement>("img")?.alt ?? "", /2$/);

    let image = modal.modalEl.querySelector<HTMLImageElement>("img");
    if (!image) throw new Error("viewer image missing");
    Object.defineProperty(image, "clientWidth", { configurable: true, value: 200 });
    Object.defineProperty(image, "clientHeight", { configurable: true, value: 200 });
    frame.dispatchEvent(touchEvent("touchstart", [
      { clientX: 80, clientY: 100 }, { clientX: 180, clientY: 100 }
    ]));
    frame.dispatchEvent(touchEvent("touchmove", [
      { clientX: 30, clientY: 100 }, { clientX: 230, clientY: 100 }
    ]));
    frame.dispatchEvent(touchEvent("touchend", [], [{ clientX: 230, clientY: 100 }]));
    image = modal.modalEl.querySelector<HTMLImageElement>("img");
    assert.match(image?.style.transform ?? "", /scale\(2\)/);

    frame.dispatchEvent(touchEvent("touchstart", [{ clientX: 100, clientY: 100 }]));
    frame.dispatchEvent(touchEvent("touchmove", [{ clientX: 135, clientY: 120 }]));
    frame.dispatchEvent(touchEvent("touchend", [], [{ clientX: 135, clientY: 120 }]));
    assert.doesNotMatch(image?.style.transform ?? "", /translate3d\(0px, 0px/);

    close.click();
    assert.equal(document.body.contains(modal.containerEl), false);
  } finally {
    modal.close();
    TestPlatform.isDesktopApp = true;
    TestPlatform.isMobileApp = false;
  }
});

test("viewer CSS exposes one interaction hit layer and safe-area toolbar controls", () => {
  assert.match(cssDeclarations(".doudou-image-preview-modal .modal-close-button"), /display:\s*none\s*!important/);
  assert.match(cssDeclarations(".doudou-image-preview-frame"), /pointer-events:\s*auto/);
  assert.match(cssDeclarations(".doudou-image-preview-stage"), /pointer-events:\s*none/);
  assert.match(cssDeclarations(".doudou-image-preview-toolbar"), /safe-area-inset-top/);
  assert.match(cssDeclarations(".doudou-image-preview-toolbar"), /safe-area-inset-right/);
  assert.match(cssDeclarations(".doudou-modal button.doudou-image-toolbar-button"), /width:\s*40px/);
  assert.doesNotMatch(cssDeclarations(".doudou-image-preview-toolbar"), /pointer-events:\s*none/);
  assert.match(cssDeclarations(".doudou-view .doudou-gif-badge"), /right:\s*5px/);
  assert.match(cssDeclarations(".doudou-view .doudou-gif-badge"), /background:\s*rgb\(0 0 0 \/ 62%\)/);
});

test("mobile viewer fills the viewport without changing desktop sizing or safe-area controls", () => {
  const desktop = cssDeclarations(".doudou-modal.doudou-image-preview-modal");
  const mobile = mediaCssDeclarations("(max-width: 430px)", ".doudou-modal.doudou-image-preview-modal");
  assert.match(desktop, /width:\s*min\(1180px, calc\(100vw - 32px\)\)/);
  assert.match(desktop, /height:\s*min\(92dvh, 920px\)/);
  assert.match(mobile, /width:\s*100vw/);
  assert.match(mobile, /height:\s*100dvh/);
  assert.match(mobile, /min-height:\s*100dvh/);
  assert.match(mobile, /max-width:\s*none/);
  assert.match(mobile, /max-height:\s*none/);
  assert.match(mobile, /margin:\s*0/);
  assert.match(mobile, /border-radius:\s*0/);
  assert.doesNotMatch(mobile, /calc\(100(?:d)?v[wh]\s*-\s*8px\)/);
  assert.match(desktop, /background:\s*rgb\(8 18 32 \/ 96%\)/);
  assert.match(cssDeclarations(".doudou-image-preview-toolbar"), /safe-area-inset-top/);
  assert.match(cssDeclarations(".doudou-image-preview-toolbar"), /safe-area-inset-right/);
});

test("viewer suppresses only its native close and hidden state overrides disabled controls", async () => {
  TestPlatform.isDesktopApp = true;
  TestPlatform.isMobileApp = false;
  const ordinaryModal = new TestModal({});
  ordinaryModal.open();
  try {
    const ordinaryClose = ordinaryModal.containerEl.querySelector<HTMLElement>(".modal-close-button");
    assert.ok(ordinaryClose);
    assert.equal(ordinaryClose.hidden, false);
    assert.notEqual(ordinaryClose.style.getPropertyValue("display"), "none");
  } finally {
    ordinaryModal.close();
  }

  const modal = new ImagePreviewModal(
    {} as never,
    viewerImageService(),
    storedViewerItems(["兜兜/assets/2026/08/first.png", "兜兜/assets/2026/08/last.png"]),
    0,
    15
  );
  modal.open();
  try {
    const close = modal.containerEl.querySelector<HTMLButtonElement>(".doudou-image-close-button");
    const previous = modal.containerEl.querySelector<HTMLButtonElement>(".doudou-image-viewer-previous");
    const next = modal.containerEl.querySelector<HTMLButtonElement>(".doudou-image-viewer-next");
    const frame = modal.containerEl.querySelector<HTMLElement>(".doudou-image-preview-frame");
    assert.ok(close && previous && next && frame);
    const hostClose = modal.containerEl.querySelector<HTMLElement>(".modal-close-button");
    assert.ok(hostClose);
    assert.equal(hostClose.hidden, true);
    assert.equal(hostClose.style.getPropertyValue("display"), "none");
    assert.equal(close.classList.contains("doudou-image-viewer-control"), true);
    assert.equal(close.hidden, false);
    assert.notEqual(close.style.getPropertyValue("display"), "none");
    assert.equal(previous.disabled, true);
    assert.equal(next.disabled, false);

    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(window.getComputedStyle(close).opacity, "0");
    assert.equal(window.getComputedStyle(previous).opacity, "0");
    assert.equal(window.getComputedStyle(next).opacity, "0");
    assert.equal(window.getComputedStyle(previous).pointerEvents, "none");

    frame.dispatchEvent(pointerEvent("pointerdown", 100, 100));
    frame.dispatchEvent(pointerEvent("pointerup", 100, 100));
    assert.equal(window.getComputedStyle(close).opacity, "1");
    assert.equal(previous.matches(":disabled"), true);
    assert.match(cssDeclarations(".doudou-modal button.doudou-image-viewer-nav:disabled"), /opacity:\s*\.22/);
    assert.equal(window.getComputedStyle(next).opacity, "1");

    next.click();
    assert.equal(next.disabled, true);
    assert.equal(next.matches(":disabled"), true);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(window.getComputedStyle(previous).opacity, "0");
    assert.equal(window.getComputedStyle(next).opacity, "0");
  } finally {
    modal.close();
  }
});

test("viewer suppresses asynchronously inserted host close variants and disconnects on close", async () => {
  const modal = new ImagePreviewModal(
    {} as never,
    viewerImageService(),
    storedViewerItems(["兜兜/assets/2026/08/only.png"]),
    0,
    50
  );
  modal.open();
  const root = modal.containerEl;
  const semanticClose = document.createElement("button");
  semanticClose.className = "clickable-icon";
  semanticClose.setAttribute("aria-label", "Close");
  const iconClose = document.createElement("button");
  iconClose.className = "clickable-icon";
  iconClose.setAttribute("data-icon", "x");
  root.append(semanticClose, iconClose);
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  assert.equal(semanticClose.hidden, true);
  assert.equal(iconClose.hidden, true);
  const customClose = root.querySelector<HTMLElement>(".doudou-image-close-button");
  assert.ok(customClose);
  assert.equal(customClose.hidden, false);
  assert.notEqual(customClose.style.getPropertyValue("display"), "none");

  modal.close();
  const afterClose = document.createElement("button");
  afterClose.setAttribute("title", "关闭");
  root.appendChild(afterClose);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(afterClose.hidden, false);
  assert.notEqual(afterClose.style.getPropertyValue("display"), "none");
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

test("GIF export reads the untouched original Vault binary", async () => {
  const vault = new FakeVault();
  const path = "兜兜/assets/2026/08/animation.gif";
  const bytes = new Uint8Array([71, 73, 70, 56, 57, 97, 1, 2, 3]);
  await vault.createBinary(path, bytes.buffer);
  const file = await viewerItemFile(new ImageService(vault as unknown as Vault), { kind: "stored", path });
  assert.equal(file.name, "animation.gif");
  assert.equal(file.type, "image/gif");
  assert.deepEqual([...new Uint8Array(await file.arrayBuffer())], [...bytes]);
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
