import { Component, setIcon } from "obsidian";
import type { ImageService } from "../attachments/ImageService";
import {
  ALL_RECORDS_FOLDER,
  ALL_RECORDS_FOLDER_LABEL,
  SEARCH_DEBOUNCE_MS
} from "../constants";
import type { DoudouRepository } from "../data/DoudouRepository";
import type { FolderService } from "../services/FolderService";
import { filterRecords, librarySearchFolder } from "../services/recordSearch";
import type { FolderSummary, StoredDoudouRecord } from "../types";
import { GifPreviewSession, isGifPath } from "./gifPreview";
import { attachmentCountText, formatTime, libraryCardContent, recordTitle, renderManualTagText } from "./uiHelpers";

export interface LibraryPageDependencies {
  repository: DoudouRepository;
  folderService: FolderService;
  imageService: ImageService;
  openRecord: (record: StoredDoudouRecord) => void;
  manageFolder: (folder?: string) => void;
  reorderFolders: () => void;
}

export class LibraryPage extends Component {
  private readonly gifPreviews = new GifPreviewSession();
  private bodyEl!: HTMLElement;
  private records: StoredDoudouRecord[] = [];
  private folders: FolderSummary[] = [];
  private currentFolder: string | null = null;
  private query = "";
  private searchExpanded = false;
  private searchTimer: number | null = null;
  private version = 0;
  constructor(private readonly containerEl: HTMLElement, private readonly dependencies: LibraryPageDependencies) { super(); }
  override onload(): void { this.containerEl.addClass("doudou-library-page"); this.bodyEl = this.containerEl.createDiv({ cls: "doudou-library-body" }); this.register(() => { if (this.searchTimer !== null) window.clearTimeout(this.searchTimer); }); }
  override onunload(): void { this.gifPreviews.dispose(); this.containerEl.empty(); }
  deactivate(): void { this.gifPreviews.clear(); }
  async activate(): Promise<void> { await this.refresh(this.records.length === 0); }
  async refresh(showLoading = false): Promise<void> {
    const version = ++this.version; if (showLoading) this.bodyEl.setText("兜兜努力翻找中...");
    try {
      const [records, folders] = await Promise.all([this.dependencies.repository.loadAll(), this.dependencies.folderService.listFolders()]);
      if (version !== this.version) return; this.records = records; this.folders = folders; this.render();
    } catch (error) { console.error("[doudou] Failed to load library", error); this.bodyEl.setText("资料暂时没有加载出来"); }
  }
  currentFolderName(): string | undefined { return this.currentFolder && this.currentFolder !== ALL_RECORDS_FOLDER ? this.currentFolder : undefined; }
  private render(): void { this.gifPreviews.clear(); this.bodyEl.empty(); this.bodyEl.toggleClass("doudou-is-folder-view", this.currentFolder !== null); if (this.currentFolder === null) this.renderFolders(); else this.renderFolder(); this.bodyEl.createDiv({ cls: "doudou-mobile-bottom-spacer", attr: { "aria-hidden": "true" } }); }
  private renderFolders(): void {
    const header = this.bodyEl.createDiv({ cls: "doudou-library-heading" }); header.createEl("h2", { text: "资料" });
    const search = header.createEl("button", { cls: "doudou-round-tool", attr: { type: "button", "aria-label": "搜索全部资料" } }); setIcon(search, "search");
    search.addEventListener("click", () => { this.searchExpanded = true; this.render(); });
    if (this.searchExpanded) {
      this.renderSearchShell(this.bodyEl, "搜索资料", () => {
        this.query = "";
        this.searchExpanded = false;
        this.render();
      }, () => this.renderLibraryHomeContent());
    }
    this.bodyEl.createDiv({ cls: "doudou-library-home-content" });
    this.renderLibraryHomeContent();
  }
  private renderLibraryHomeContent(): void {
    const content = this.bodyEl.querySelector<HTMLElement>(".doudou-library-home-content");
    if (!content) return;
    content.empty();
    if (this.query.trim()) {
      const results = content.createDiv({ cls: "doudou-compact-list doudou-library-search-results" });
      this.renderCards(results, undefined, true);
      return;
    }
    const list = content.createDiv({ cls: "doudou-folder-list" }); this.folderRow(list, ALL_RECORDS_FOLDER, this.records.length, false, ALL_RECORDS_FOLDER_LABEL);
    for (const folder of this.folders) this.folderRow(list, folder.name, folder.count, true);
    const actions = content.createDiv({ cls: "doudou-folder-actions" });
    const add = actions.createEl("button", { cls: "doudou-new-folder", text: "+ 新建文件夹", attr: { type: "button" } }); add.addEventListener("click", () => this.dependencies.manageFolder());
    const reorder = actions.createEl("button", { cls: "doudou-reorder-folders", text: "调整顺序", attr: { type: "button" } }); reorder.addEventListener("click", this.dependencies.reorderFolders);
  }
  private folderRow(container: HTMLElement, name: string, count: number, editable: boolean, label = name): void {
    const row = container.createDiv({ cls: "doudou-folder-row" }); const open = row.createEl("button", { cls: "doudou-folder-open", attr: { type: "button" } });
    const icon = open.createSpan({ cls: "doudou-folder-icon" }); setIcon(icon, "folder"); open.createSpan({ cls: "doudou-folder-name", text: label }); open.createSpan({ cls: "doudou-folder-count", text: String(count) }); open.createSpan({ cls: "doudou-folder-chevron", text: "›" });
    open.addEventListener("click", () => { this.currentFolder = name; this.query = ""; this.searchExpanded = false; this.render(); });
    if (editable) { const more = row.createEl("button", { cls: "doudou-folder-more", text: "…", attr: { type: "button", "aria-label": `管理文件夹 ${name}` } }); more.addEventListener("click", () => this.dependencies.manageFolder(name)); }
  }
  private renderFolder(): void {
    const sticky = this.bodyEl.createDiv({ cls: "doudou-folder-sticky" });
    const header = sticky.createDiv({ cls: "doudou-folder-header" });
    const back = header.createEl("button", { cls: "doudou-back-button", text: "‹ 资料", attr: { type: "button" } });
    back.addEventListener("click", () => { this.currentFolder = null; this.query = ""; this.searchExpanded = false; this.render(); });
    header.createEl("h2", { text: this.currentFolder === ALL_RECORDS_FOLDER ? ALL_RECORDS_FOLDER_LABEL : this.currentFolder ?? ALL_RECORDS_FOLDER_LABEL });
    const search = header.createEl("button", { cls: "doudou-round-tool", attr: { type: "button", "aria-label": "搜索当前文件夹资料" } });
    setIcon(search, "search");
    search.addEventListener("click", () => { this.searchExpanded = true; this.render(); });
    if (this.searchExpanded) {
      this.renderSearchShell(sticky, "搜索当前文件夹资料", () => {
        this.query = "";
        this.searchExpanded = false;
        this.render();
      }, () => this.renderFolderCards());
    }
    this.bodyEl.createDiv({ cls: "doudou-compact-list" }); this.renderFolderCards();
  }
  private renderSearchShell(container: HTMLElement, placeholder: string, onClose: () => void, onQueryChanged: () => void): void {
    const searchShell = container.createDiv({ cls: "doudou-search-shell doudou-folder-search" });
    const icon = searchShell.createSpan(); setIcon(icon, "search");
    const input = searchShell.createEl("input", { attr: { type: "search", placeholder, "aria-label": placeholder } }); input.value = this.query;
    const close = searchShell.createEl("button", { cls: "doudou-search-close", text: "×", attr: { type: "button", "aria-label": "关闭搜索" } });
    close.addEventListener("click", () => { if (this.searchTimer !== null) window.clearTimeout(this.searchTimer); this.searchTimer = null; onClose(); });
    input.addEventListener("input", () => { if (this.searchTimer !== null) window.clearTimeout(this.searchTimer); this.searchTimer = window.setTimeout(() => { this.query = input.value; onQueryChanged(); }, SEARCH_DEBOUNCE_MS); });
    input.focus({ preventScroll: true });
  }
  private renderFolderCards(): void {
    const list = this.bodyEl.querySelector<HTMLElement>(".doudou-compact-list");
    if (!list) return;
    const folder = librarySearchFolder(this.currentFolder);
    this.renderCards(list, folder, this.currentFolder === ALL_RECORDS_FOLDER);
  }
  private renderCards(list?: HTMLElement, folder?: string, showFolder = false): void {
    const target = list ?? this.bodyEl.querySelector<HTMLElement>(".doudou-compact-list"); if (!target) return; target.empty();
    const records = filterRecords(this.records, { query: this.query, folder, tags: new Set() });
    if (records.length === 0) { target.createDiv({ cls: "doudou-empty-state doudou-library-empty", text: "这里还空空的", attr: { "data-subtitle": "去记下点什么吧" } }); return; }
    for (const record of records) {
      const card = target.createEl("button", { cls: "doudou-compact-card", attr: { type: "button", "aria-label": `打开备忘录：${recordTitle(record)}` } }); const image = record.images?.[0];
      if (image) { const src = this.dependencies.imageService.resourcePath(image); if (src) { const wrap = card.createDiv({ cls: "doudou-compact-image-wrap" }); const gif = isGifPath(image); const preview = wrap.createEl("img", { cls: "doudou-compact-image", attr: { ...(gif ? {} : { src }), alt: "" } }); if (gif) this.gifPreviews.applyStored(preview, wrap, image, this.dependencies.imageService, src); if ((record.images?.length ?? 0) > 1) wrap.createSpan({ cls: "doudou-compact-image-count", text: `${record.images?.length} 张` }); } }
      const attachmentText = attachmentCountText(record); const content = libraryCardContent(record);
      const main = card.createDiv({ cls: "doudou-compact-main" }); if (content.title) main.createDiv({ cls: "doudou-compact-title", text: content.title }); if (content.preview) { const preview = main.createDiv({ cls: "doudou-compact-preview" }); if (record.content.trim()) renderManualTagText(preview, record.content); else preview.setText(content.preview); } main.createDiv({ cls: "doudou-compact-meta", text: `${formatTime(record.created)}${showFolder ? ` · ${record.folder}` : ""}${attachmentText ? ` · ${attachmentText}` : ""}` }); card.addEventListener("click", () => this.dependencies.openRecord(record));
    }
  }
}
