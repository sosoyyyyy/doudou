import { App, Component, Notice, Platform, setIcon } from "obsidian";
import type { AiTagService } from "../ai/AiTagService";
import { imageExtension, type ImageService } from "../attachments/ImageService";
import {
  formatFileSize,
  MAX_ATTACHMENT_BYTES,
  type FileService
} from "../attachments/FileService";
import { DEFAULT_FOLDER } from "../constants";
import type { DoudouRepository } from "../data/DoudouRepository";
import type { RecordService } from "../services/RecordService";
import type { StoredDoudouRecord } from "../types";
import { ImagePreviewModal } from "./ImagePreviewModal";
import { showImageActionMenuAtEvent } from "./imageActions";
import { recordPageGalleryPresentation } from "./imageGallery";
import {
  createPendingImages,
  imageFilesFromClipboardItems,
  releasePendingImages,
  type PendingImage
} from "./imageDraft";
import { formatDateTime, writeClipboardText } from "./uiHelpers";
import {
  createPendingFiles,
  hasSavableRecordDraft,
  type PendingFile
} from "./fileDraft";

export interface RecordPageDependencies {
  repository: DoudouRepository;
  recordService: RecordService;
  imageService: ImageService;
  fileService: FileService;
  aiTagService: AiTagService;
}

export class RecordPage extends Component {
  private record: StoredDoudouRecord | null = null;
  private pending: PendingImage[] = [];
  private pendingFiles: PendingFile[] = [];
  private defaultFolder = DEFAULT_FOLDER;
  constructor(private readonly app: App, private readonly containerEl: HTMLElement, private readonly dependencies: RecordPageDependencies, private readonly goBack: () => void, private readonly changed: () => Promise<void>) { super(); }
  override onload(): void { this.containerEl.addClass("doudou-record-page"); }
  override onunload(): void { releasePendingImages(this.pending); this.pendingFiles = []; this.containerEl.empty(); }
  open(record: StoredDoudouRecord): void { this.record = record; this.renderRead(); }
  async create(defaultFolder?: string): Promise<void> { this.record = null; this.defaultFolder = defaultFolder ?? DEFAULT_FOLDER; await this.renderEdit(true); }

  private renderRead(): void {
    const record = this.record; if (!record) return; this.containerEl.empty();
    const header = this.containerEl.createDiv({ cls: "doudou-record-header" });
    const back = header.createEl("button", { cls: "doudou-back-button", text: "‹ 返回", attr: { type: "button" } }); back.addEventListener("click", this.goBack);
    const tools = header.createDiv({ cls: "doudou-record-tools" });
    const edit = tools.createEl("button", { cls: "doudou-round-tool", attr: { type: "button", "aria-label": "编辑备忘录", title: "编辑" } }); setIcon(edit, "pencil"); edit.addEventListener("click", () => void this.renderEdit(false));
    const more = tools.createEl("button", { cls: "doudou-round-tool", text: "…", attr: { type: "button", "aria-label": "更多操作" } });
    const menu = this.containerEl.createDiv({ cls: "doudou-record-menu doudou-is-hidden" });
    const copy = menu.createEl("button", { text: "复制全文", attr: { type: "button" } }); copy.addEventListener("click", () => { void writeClipboardText(record.content); menu.addClass("doudou-is-hidden"); });
    const remove = menu.createEl("button", { cls: "doudou-menu-danger", text: "删除", attr: { type: "button" } }); remove.addEventListener("click", async () => { if (!window.confirm("确定删除这条备忘录吗？它会进入 Obsidian 回收站。")) return; await this.dependencies.recordService.delete(record); await this.changed(); this.goBack(); });
    more.addEventListener("click", () => menu.toggleClass("doudou-is-hidden", !menu.hasClass("doudou-is-hidden")));
    const article = this.containerEl.createEl("article", { cls: "doudou-record-article" });
    if (record.title?.trim()) article.createEl("h1", { text: record.title });
    article.createDiv({ cls: "doudou-record-meta", text: `${record.folder} · 创建于 ${formatDateTime(record.created)}${record.updated ? ` · 更新于 ${formatDateTime(record.updated)}` : ""}` });
    if (record.content) article.createDiv({ cls: "doudou-record-content", text: record.content });
    if ((record.images ?? []).length > 0) {
      const presentation = recordPageGalleryPresentation(record.images ?? []);
      const gallery = article.createDiv({ cls: `doudou-record-gallery doudou-gallery-layout-${presentation.mode}`, attr: { "data-count": String(record.images?.length ?? 0) } });
      for (const [index, path] of presentation.paths.entries()) {
        const button = gallery.createEl("button", { cls: "doudou-gallery-item", attr: { type: "button", "aria-label": `查看第 ${index + 1} 张图片` } });
        const src = this.dependencies.imageService.resourcePath(path);
        if (src) button.createEl("img", { cls: "doudou-gallery-image", attr: { src, alt: `备忘录图片 ${index + 1}` } });
        else button.createDiv({ cls: "doudou-image-missing", text: "图片缺失" });
        button.addEventListener("click", () => new ImagePreviewModal(this.app, this.dependencies.imageService, path).open());
        button.addEventListener("contextmenu", (event) => {
          if (!Platform.isDesktopApp) return;
          event.preventDefault();
          showImageActionMenuAtEvent(this.app, this.dependencies.imageService, path, event);
        });
      }
    }
    if ((record.files ?? []).length > 0) {
      const section = article.createEl("section", { cls: "doudou-record-files" });
      section.createEl("h2", { text: "附件" });
      const list = section.createDiv({ cls: "doudou-record-file-list" });
      for (const path of record.files ?? []) this.renderStoredFile(list, path, false);
    }
  }

  private renderStoredFile(
    container: HTMLElement,
    path: string,
    editable: boolean,
    onRemove?: () => void
  ): void {
    const info = this.dependencies.fileService.info(path);
    const card = editable
      ? container.createDiv({ cls: "doudou-file-card" })
      : container.createEl("button", {
        cls: "doudou-file-card doudou-file-card-open",
        attr: { type: "button", "aria-label": `打开附件 ${info.name}` }
      });
    const icon = card.createSpan({ cls: "doudou-file-card-icon" });
    setIcon(icon, "file");
    const main = card.createDiv({ cls: "doudou-file-card-main" });
    main.createDiv({ cls: "doudou-file-card-name", text: info.name });
    main.createDiv({
      cls: "doudou-file-card-meta",
      text: `${info.extension}${info.size === null ? "" : ` · ${formatFileSize(info.size)}`}${info.exists ? "" : " · 文件缺失"}`
    });
    if (editable && onRemove) {
      const remove = card.createEl("button", {
        cls: "doudou-file-card-remove",
        text: "×",
        attr: { type: "button", "aria-label": `移除附件 ${info.name}` }
      });
      remove.addEventListener("click", onRemove);
    } else {
      card.addEventListener("click", () => void this.openStoredFile(path));
      card.createSpan({ cls: "doudou-file-card-chevron", text: "›" });
    }
  }

  private async openStoredFile(path: string): Promise<void> {
    const file = this.dependencies.fileService.getFile(path);
    if (!file) {
      new Notice("这个附件暂时找不到了");
      return;
    }
    try {
      await this.app.workspace.getLeaf(true).openFile(file);
    } catch {
      new Notice("Obsidian 暂时无法预览这个文件，可在文件管理器中打开");
    }
  }

  private async renderEdit(isNew: boolean): Promise<void> {
    releasePendingImages(this.pending); this.pending = []; this.pendingFiles = []; this.containerEl.empty();
    const record = this.record; const folders = await this.dependencies.repository.listFolders();
    const header = this.containerEl.createDiv({ cls: "doudou-record-header doudou-editor-header" }); header.createEl("h2", { text: isNew ? "新建备忘录" : "编辑备忘录" });
    const actions = header.createDiv({ cls: "doudou-editor-actions" });
    const cancel = actions.createEl("button", { cls: "doudou-secondary-button", text: "取消", attr: { type: "button" } });
    const save = actions.createEl("button", { cls: "doudou-primary-button", text: "保存", attr: { type: "button" } });
    const form = this.containerEl.createDiv({ cls: "doudou-editor" });
    const title = form.createEl("input", { cls: "doudou-title-input", attr: { type: "text", placeholder: "标题（可选）", "aria-label": "标题" } }); title.value = record?.title ?? "";
    const content = form.createEl("textarea", { cls: "doudou-editor-content", attr: { placeholder: "记下此刻……\n\n直接输入 #标签", "aria-label": "正文", rows: "10" } }); content.value = record?.content ?? "";
    const imageInput = form.createEl("input", { cls: "doudou-file-input", attr: { type: "file", accept: "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.heic,.heif", multiple: "true" } });
    const images = form.createDiv({ cls: "doudou-editor-images" }); let retained = [...(record?.images ?? [])]; const removed = new Set<string>();
    const paintImages = (): void => { images.empty();
      for (const path of retained) { const tile = images.createDiv({ cls: "doudou-editor-image" }); const src = this.dependencies.imageService.resourcePath(path); if (src) tile.createEl("img", { attr: { src, alt: "已有图片" } }); const button = tile.createEl("button", { text: "×", attr: { type: "button", "aria-label": "移除图片" } }); button.addEventListener("click", () => { retained = retained.filter((item) => item !== path); removed.add(path); paintImages(); }); }
      for (const pending of this.pending) { const tile = images.createDiv({ cls: "doudou-editor-image" }); tile.createEl("img", { attr: { src: pending.previewUrl, alt: pending.file.name } }); const button = tile.createEl("button", { text: "×", attr: { type: "button", "aria-label": "移除图片" } }); button.addEventListener("click", () => { URL.revokeObjectURL(pending.previewUrl); this.pending = this.pending.filter((item) => item.id !== pending.id); paintImages(); }); }
    }; paintImages();
    imageInput.addEventListener("change", () => { const files = Array.from(imageInput.files ?? []).filter((file) => imageExtension(file) !== null); imageInput.value = ""; this.pending.push(...createPendingImages(files)); paintImages(); });
    content.addEventListener("paste", (event) => {
      const files = imageFilesFromClipboardItems(event.clipboardData?.items)
        .filter((file) => imageExtension(file) !== null);
      if (files.length === 0) return;
      this.pending.push(...createPendingImages(files));
      paintImages();
      if (!event.clipboardData?.getData("text/plain")) event.preventDefault();
    });
    const attachmentInput = form.createEl("input", { cls: "doudou-file-input", attr: { type: "file", multiple: "true", "aria-label": "选择普通文件附件" } });
    const attachmentActions = form.createDiv({ cls: "doudou-attachment-actions" });
    const addImage = attachmentActions.createEl("button", { cls: "doudou-add-image-button", attr: { type: "button", "aria-label": "添加图片" } });
    setIcon(addImage, "image-plus"); addImage.createSpan({ text: "添加图片" }); addImage.addEventListener("click", () => imageInput.click());
    const addFile = attachmentActions.createEl("button", { cls: "doudou-add-file-button", attr: { type: "button", "aria-label": "添加普通文件" } });
    setIcon(addFile, "paperclip"); addFile.createSpan({ text: "添加文件" }); addFile.addEventListener("click", () => attachmentInput.click());
    const fileArea = form.createDiv({ cls: "doudou-editor-files" });
    let retainedFiles = [...(record?.files ?? [])];
    const removedFiles = new Set<string>();
    const paintFiles = (): void => {
      fileArea.empty();
      for (const path of retainedFiles) {
        this.renderStoredFile(fileArea, path, true, () => {
          retainedFiles = retainedFiles.filter((item) => item !== path);
          removedFiles.add(path);
          paintFiles();
        });
      }
      for (const pending of this.pendingFiles) {
        const card = fileArea.createDiv({ cls: "doudou-file-card" });
        const icon = card.createSpan({ cls: "doudou-file-card-icon" });
        setIcon(icon, "file-plus");
        const main = card.createDiv({ cls: "doudou-file-card-main" });
        main.createDiv({ cls: "doudou-file-card-name", text: pending.file.name });
        const extension = pending.file.name.includes(".")
          ? pending.file.name.split(".").at(-1)?.toLocaleUpperCase() ?? "文件"
          : "文件";
        main.createDiv({ cls: "doudou-file-card-meta", text: `${extension} · ${formatFileSize(pending.file.size)}` });
        const remove = card.createEl("button", { cls: "doudou-file-card-remove", text: "×", attr: { type: "button", "aria-label": `移除附件 ${pending.file.name}` } });
        remove.addEventListener("click", () => { this.pendingFiles = this.pendingFiles.filter((item) => item.id !== pending.id); paintFiles(); });
      }
    };
    paintFiles();
    attachmentInput.addEventListener("change", () => {
      const selected = Array.from(attachmentInput.files ?? []);
      attachmentInput.value = "";
      const oversized = selected.filter((file) => file.size > MAX_ATTACHMENT_BYTES);
      const accepted = selected.filter((file) => file.size <= MAX_ATTACHMENT_BYTES);
      if (oversized.length > 0) {
        status.setText(`单个附件不能超过 ${formatFileSize(MAX_ATTACHMENT_BYTES)}`);
      }
      this.pendingFiles.push(...createPendingFiles(accepted));
      paintFiles();
    });
    const folderRow = form.createDiv({ cls: "doudou-editor-folder" }); folderRow.createSpan({ text: "文件夹" }); const folder = folderRow.createEl("select", { attr: { "aria-label": "所属文件夹" } });
    const names = [...new Set([record?.folder ?? this.defaultFolder, ...folders.map((item) => item.name)])]; for (const name of names) folder.createEl("option", { text: name, value: name }); folder.value = record?.folder ?? this.defaultFolder;
    const status = form.createDiv({ cls: "doudou-editor-status", attr: { role: "status" } });
    cancel.addEventListener("click", () => { releasePendingImages(this.pending); this.pending = []; this.pendingFiles = []; if (record) this.renderRead(); else this.goBack(); });
    save.addEventListener("click", async () => {
      if (!hasSavableRecordDraft(title.value, content.value, retained.length + this.pending.length, retainedFiles.length + this.pendingFiles.length)) { status.setText("标题、正文、图片和文件不能同时为空"); return; }
      save.disabled = true; cancel.disabled = true; status.setText("正在保存..."); const snapshot = [...this.pending]; const fileSnapshot = [...this.pendingFiles];
      try {
        if (record) this.record = await this.dependencies.recordService.update(record, { title: title.value, content: content.value, folder: folder.value }, snapshot.map((item) => item.file), [...removed], fileSnapshot.map((item) => item.file), [...removedFiles]);
        else { const draft = this.dependencies.repository.createRecord(content.value, folder.value, title.value); this.record = await this.dependencies.recordService.create(draft, snapshot.map((item) => item.file), fileSnapshot.map((item) => item.file)); }
        releasePendingImages(snapshot); this.pending = []; this.pendingFiles = []; await this.changed(); this.renderRead(); if (this.record) void this.dependencies.aiTagService.enrich(this.record);
      } catch (error) { console.error("[doudou] Failed to save record", error); status.setText("保存失败，请再试一次"); save.disabled = false; cancel.disabled = false; }
    });
  }
}
