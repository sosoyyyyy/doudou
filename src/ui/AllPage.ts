import { Component } from "obsidian";
import type { ImageService } from "../attachments/ImageService";
import type { DoudouRepository } from "../data/DoudouRepository";
import type { StoredDoudouRecord } from "../types";
import { GifPreviewSession, isGifPath } from "./gifPreview";
import { allPageGalleryPresentation } from "./imageGallery";
import { attachmentCountText, recordTitle, renderManualTagText } from "./uiHelpers";

export interface AllPageDependencies {
  repository: DoudouRepository;
  imageService: ImageService;
  openRecord: (record: StoredDoudouRecord) => void;
}

const month = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" });
const day = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" });
const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" });

export class AllPage extends Component {
  private readonly gifPreviews = new GifPreviewSession();
  private listEl!: HTMLElement;
  private records: StoredDoudouRecord[] = [];
  private version = 0;
  constructor(private readonly containerEl: HTMLElement, private readonly dependencies: AllPageDependencies) { super(); }
  override onload(): void { this.containerEl.addClass("doudou-all-page"); this.listEl = this.containerEl.createDiv({ cls: "doudou-timeline" }); }
  override onunload(): void { this.gifPreviews.dispose(); this.containerEl.empty(); }
  deactivate(): void { this.gifPreviews.clear(); }
  async refresh(showLoading = false): Promise<void> {
    const version = ++this.version;
    if (showLoading) this.listEl.setText("兜兜努力翻找中...");
    try {
      const records = await this.dependencies.repository.loadAll();
      if (version !== this.version) return;
      this.records = records; this.render();
    } catch (error) { console.error("[doudou] Failed to load timeline", error); this.listEl.setText("记录暂时没有加载出来"); }
  }
  private render(): void {
    this.gifPreviews.clear();
    this.listEl.empty();
    if (this.records.length === 0) {
      this.listEl.createDiv({ cls: "doudou-empty-state doudou-timeline-empty", text: "这里还空空的", attr: { "data-subtitle": "点右上角 ＋ 记下点什么吧" } }); return;
    }
    let monthKey = ""; let dayKey = "";
    for (const record of this.records) {
      const date = new Date(record.created); const nextMonth = `${date.getFullYear()}-${date.getMonth()}`; const nextDay = `${nextMonth}-${date.getDate()}`;
      if (nextMonth !== monthKey) { monthKey = nextMonth; dayKey = ""; this.listEl.createEl("h2", { cls: "doudou-month-heading", text: month.format(date) }); }
      if (nextDay !== dayKey) { dayKey = nextDay; this.listEl.createEl("h3", { cls: "doudou-day-heading", text: day.format(date) }); }
      this.renderCard(record);
    }
  }
  private renderCard(record: StoredDoudouRecord): void {
    const button = this.listEl.createEl("button", { cls: "doudou-journal-card", attr: { type: "button", "aria-label": `打开备忘录：${recordTitle(record)}` } });
    const body = button.createDiv({ cls: "doudou-journal-body" });
    if (record.title?.trim()) body.createDiv({ cls: "doudou-journal-title", text: record.title });
    const attachmentText = attachmentCountText(record);
    const preview = body.createDiv({ cls: "doudou-journal-preview" });
    if (record.content.trim()) renderManualTagText(preview, record.content);
    else preview.setText((record.images?.length ?? 0) > 0 ? "图片记录" : attachmentText ? `附件记录 · ${attachmentText} 个文件` : "空白记录");
    body.createDiv({ cls: "doudou-journal-meta", text: `${time.format(new Date(record.created))} · ${record.folder}` });
    if (attachmentText && record.content.trim()) body.createDiv({ cls: "doudou-card-attachment-count", text: attachmentText });
    const presentation = allPageGalleryPresentation(record.images ?? []);
    if (presentation.paths.length > 0) {
      const gallery = button.createDiv({ cls: "doudou-journal-gallery" });
      for (const [index, path] of presentation.paths.entries()) {
        const item = gallery.createDiv({ cls: "doudou-journal-gallery-item" });
        const src = this.dependencies.imageService.resourcePath(path);
        if (src) {
          const gif = isGifPath(path);
          const image = item.createEl("img", { cls: "doudou-journal-gallery-image", attr: { ...(gif ? {} : { src }), alt: "" } });
          if (gif) this.gifPreviews.applyStored(image, item, path, this.dependencies.imageService, src);
        }
        else item.createDiv({ cls: "doudou-image-missing", text: "图片缺失" });
        if (index === 8 && presentation.overflowCount > 0) item.createDiv({ cls: "doudou-journal-gallery-more", text: `+${presentation.overflowCount}` });
      }
    }
    button.addEventListener("click", () => this.dependencies.openRecord(record));
  }
}
