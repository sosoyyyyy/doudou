import { App, Component, setIcon } from "obsidian";
import type { AiTagService } from "../ai/AiTagService";
import { imageExtension, type ImageService } from "../attachments/ImageService";
import { DEFAULT_FOLDER } from "../constants";
import type { DoudouRepository } from "../data/DoudouRepository";
import type { RecordService } from "../services/RecordService";
import type { StoredDoudouRecord } from "../types";
import { ImagePreviewModal } from "./ImagePreviewModal";
import { createPendingImages, releasePendingImages, type PendingImage } from "./imageDraft";
import { formatDateTime, writeClipboardText } from "./uiHelpers";

export interface RecordPageDependencies {
  repository: DoudouRepository;
  recordService: RecordService;
  imageService: ImageService;
  aiTagService: AiTagService;
}

export class RecordPage extends Component {
  private record: StoredDoudouRecord | null = null;
  private pending: PendingImage[] = [];
  private defaultFolder = DEFAULT_FOLDER;
  constructor(private readonly app: App, private readonly containerEl: HTMLElement, private readonly dependencies: RecordPageDependencies, private readonly goBack: () => void, private readonly changed: () => Promise<void>) { super(); }
  override onload(): void { this.containerEl.addClass("doudou-record-page"); }
  override onunload(): void { releasePendingImages(this.pending); this.containerEl.empty(); }
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
    for (const path of record.images ?? []) {
      const src = this.dependencies.imageService.resourcePath(path); if (!src) continue;
      const image = article.createEl("img", { cls: "doudou-record-full-image", attr: { src, alt: "备忘录图片" } }); image.addEventListener("click", () => new ImagePreviewModal(this.app, this.dependencies.imageService, path).open());
    }
    if (record.content) article.createDiv({ cls: "doudou-record-content", text: record.content });
  }

  private async renderEdit(isNew: boolean): Promise<void> {
    releasePendingImages(this.pending); this.pending = []; this.containerEl.empty();
    const record = this.record; const folders = await this.dependencies.repository.listFolders();
    const header = this.containerEl.createDiv({ cls: "doudou-record-header" }); header.createEl("h2", { text: isNew ? "新建备忘录" : "编辑备忘录" });
    const form = this.containerEl.createDiv({ cls: "doudou-editor" });
    const title = form.createEl("input", { cls: "doudou-title-input", attr: { type: "text", placeholder: "标题（可选）", "aria-label": "标题" } }); title.value = record?.title ?? "";
    const content = form.createEl("textarea", { cls: "doudou-editor-content", attr: { placeholder: "记下此刻……\n\n直接输入 #标签", "aria-label": "正文", rows: "10" } }); content.value = record?.content ?? "";
    const folderRow = form.createDiv({ cls: "doudou-editor-folder" }); folderRow.createSpan({ text: "文件夹" }); const folder = folderRow.createEl("select", { attr: { "aria-label": "所属文件夹" } });
    const names = [...new Set([record?.folder ?? this.defaultFolder, ...folders.map((item) => item.name)])]; for (const name of names) folder.createEl("option", { text: name, value: name }); folder.value = record?.folder ?? this.defaultFolder;
    const fileInput = form.createEl("input", { cls: "doudou-file-input", attr: { type: "file", accept: "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.heic,.heif", multiple: "true" } });
    const images = form.createDiv({ cls: "doudou-editor-images" }); let retained = [...(record?.images ?? [])]; const removed = new Set<string>();
    const paintImages = (): void => { images.empty();
      for (const path of retained) { const tile = images.createDiv({ cls: "doudou-editor-image" }); const src = this.dependencies.imageService.resourcePath(path); if (src) tile.createEl("img", { attr: { src, alt: "已有图片" } }); const button = tile.createEl("button", { text: "×", attr: { type: "button", "aria-label": "移除图片" } }); button.addEventListener("click", () => { retained = retained.filter((item) => item !== path); removed.add(path); paintImages(); }); }
      for (const pending of this.pending) { const tile = images.createDiv({ cls: "doudou-editor-image" }); tile.createEl("img", { attr: { src: pending.previewUrl, alt: pending.file.name } }); const button = tile.createEl("button", { text: "×", attr: { type: "button", "aria-label": "移除图片" } }); button.addEventListener("click", () => { URL.revokeObjectURL(pending.previewUrl); this.pending = this.pending.filter((item) => item.id !== pending.id); paintImages(); }); }
    }; paintImages();
    fileInput.addEventListener("change", () => { const files = Array.from(fileInput.files ?? []).filter((file) => imageExtension(file) !== null); fileInput.value = ""; this.pending.push(...createPendingImages(files)); paintImages(); });
    const status = form.createDiv({ cls: "doudou-editor-status", attr: { role: "status" } }); const actions = form.createDiv({ cls: "doudou-editor-actions" });
    const cancel = actions.createEl("button", { cls: "doudou-secondary-button", text: "取消", attr: { type: "button" } }); cancel.addEventListener("click", () => { releasePendingImages(this.pending); this.pending = []; if (record) this.renderRead(); else this.goBack(); });
    const save = actions.createEl("button", { cls: "doudou-primary-button", text: "保存", attr: { type: "button" } }); save.addEventListener("click", async () => {
      if (!content.value.trim() && retained.length === 0 && this.pending.length === 0) { status.setText("正文和图片不能同时为空"); return; }
      save.disabled = true; cancel.disabled = true; status.setText("正在保存..."); const snapshot = [...this.pending];
      try {
        if (record) this.record = await this.dependencies.recordService.update(record, { title: title.value, content: content.value, folder: folder.value }, snapshot.map((item) => item.file), [...removed]);
        else { const draft = this.dependencies.repository.createRecord(content.value, folder.value, title.value); this.record = await this.dependencies.recordService.create(draft, snapshot.map((item) => item.file)); }
        releasePendingImages(snapshot); this.pending = []; await this.changed(); this.renderRead(); if (this.record) void this.dependencies.aiTagService.enrich(this.record);
      } catch (error) { console.error("[doudou] Failed to save record", error); status.setText("保存失败，请再试一次"); save.disabled = false; cancel.disabled = false; }
    });
  }
}
