import { App, Component, setIcon } from "obsidian";
import type { AiTagService } from "../ai/AiTagService";
import type { ImageService } from "../attachments/ImageService";
import { CATEGORIES, SEARCH_DEBOUNCE_MS } from "../constants";
import type { DoudouRepository } from "../data/DoudouRepository";
import type { RecordService } from "../services/RecordService";
import {
  collectTagOptions,
  filterRecords
} from "../services/recordSearch";
import type {
  CategoryFilter,
  StoredDoudouRecord,
  TagOption
} from "../types";
import { RecordDetailModal } from "./RecordDetailModal";
import {
  dateGroupLabel,
  formatTime,
  metaText,
  previewText
} from "./uiHelpers";

export interface LibraryPageDependencies {
  repository: DoudouRepository;
  recordService: RecordService;
  imageService: ImageService;
  aiTagService: AiTagService;
}

export class LibraryPage extends Component {
  private searchInputEl!: HTMLInputElement;
  private categoryEl!: HTMLElement;
  private tagsEl!: HTMLElement;
  private listEl!: HTMLElement;
  private records: StoredDoudouRecord[] = [];
  private tagOptions: TagOption[] = [];
  private query = "";
  private category: CategoryFilter = "全部";
  private selectedTags = new Set<string>();
  private searchTimer: number | null = null;
  private refreshVersion = 0;
  private loaded = false;

  constructor(
    private readonly app: App,
    private readonly containerEl: HTMLElement,
    private readonly dependencies: LibraryPageDependencies
  ) {
    super();
  }

  override onload(): void {
    this.buildLayout();
    this.register(() => {
      if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
    });
  }

  override onunload(): void {
    this.containerEl.empty();
  }

  async activate(): Promise<void> {
    await this.refresh(!this.loaded);
  }

  async refresh(showLoading = false): Promise<void> {
    const version = ++this.refreshVersion;
    if (showLoading) {
      this.listEl.empty();
      this.listEl.createDiv({
        cls: "doudou-library-empty doudou-loading-state",
        text: "兜兜努力翻找中..."
      });
    }

    try {
      const records = await this.dependencies.repository.loadAll();
      if (version !== this.refreshVersion) return;
      this.records = records;
      this.tagOptions = collectTagOptions(records);
      const available = new Set(this.tagOptions.map((option) => option.name));
      this.selectedTags = new Set(
        [...this.selectedTags].filter((tag) => available.has(tag))
      );
      this.loaded = true;
      this.renderCategoryFilters();
      this.renderTagFilters();
      this.renderList();
    } catch (error) {
      console.error("[doudou] Failed to load library", error);
      this.listEl.empty();
      this.listEl.createDiv({
        cls: "doudou-library-empty",
        text: "资料暂时没有加载出来"
      });
    }
  }

  private buildLayout(): void {
    this.containerEl.addClass("doudou-library-page");
    const controls = this.containerEl.createDiv({ cls: "doudou-library-controls" });
    const searchShell = controls.createDiv({ cls: "doudou-search-shell" });
    const icon = searchShell.createSpan({ cls: "doudou-search-icon" });
    setIcon(icon, "search");
    this.searchInputEl = searchShell.createEl("input", {
      cls: "doudou-search-input",
      attr: {
        type: "search",
        placeholder: "搜索兜兜……",
        "aria-label": "搜索兜兜"
      }
    });
    this.registerDomEvent(this.searchInputEl, "input", () => {
      if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => {
        this.query = this.searchInputEl.value;
        this.renderList();
      }, SEARCH_DEBOUNCE_MS);
    });

    this.categoryEl = controls.createDiv({
      cls: "doudou-library-categories",
      attr: { "aria-label": "一级分类筛选" }
    });
    this.tagsEl = controls.createDiv({
      cls: "doudou-library-tags",
      attr: { "aria-label": "标签筛选" }
    });
    this.listEl = this.containerEl.createDiv({
      cls: "doudou-library-list",
      attr: { "aria-live": "polite" }
    });
    this.renderCategoryFilters();
    this.renderTagFilters();
  }

  private renderCategoryFilters(): void {
    this.categoryEl.empty();
    const filters: readonly CategoryFilter[] = ["全部", ...CATEGORIES];
    for (const category of filters) {
      const selected = this.category === category;
      const button = this.categoryEl.createEl("button", {
        cls: `doudou-filter-button${selected ? " doudou-is-selected" : ""}`,
        text: category,
        attr: {
          type: "button",
          "aria-pressed": String(selected)
        }
      });
      button.addEventListener("click", () => {
        this.category = category;
        this.renderCategoryFilters();
        this.renderList();
      });
    }
  }

  private renderTagFilters(): void {
    this.tagsEl.empty();
    this.tagsEl.toggleClass("doudou-is-hidden", this.tagOptions.length === 0);
    for (const option of this.tagOptions) {
      const selected = this.selectedTags.has(option.name);
      const button = this.tagsEl.createEl("button", {
        cls: `doudou-filter-tag${selected ? " doudou-is-selected" : ""}`,
        text: `#${option.name}`,
        attr: { type: "button", "aria-pressed": String(selected) }
      });
      button.addEventListener("click", () => {
        if (this.selectedTags.has(option.name)) this.selectedTags.delete(option.name);
        else this.selectedTags.add(option.name);
        this.renderTagFilters();
        this.renderList();
      });
    }
  }

  private renderList(): void {
    this.listEl.empty();
    if (this.records.length === 0) {
      this.listEl.createDiv({
        cls: "doudou-library-empty doudou-empty-state",
        text: "这里还空空的",
        attr: { "data-subtitle": "去记下点什么吧" }
      });
      return;
    }

    const records = filterRecords(this.records, {
      query: this.query,
      category: this.category,
      tags: this.selectedTags
    });
    if (records.length === 0) {
      this.listEl.createDiv({
        cls: "doudou-library-empty",
        text: "兜兜翻了一圈，没有找到诶"
      });
      return;
    }

    let currentGroup = "";
    for (const record of records) {
      const group = dateGroupLabel(record.created);
      if (group !== currentGroup) {
        currentGroup = group;
        const heading = this.listEl.createDiv({ cls: "doudou-date-heading" });
        heading.createSpan({ text: group });
        heading.createDiv({ cls: "doudou-date-rule" });
      }
      this.renderRecord(record);
    }
  }

  private renderRecord(record: StoredDoudouRecord): void {
    const preview = previewText(record.content) || "图片记录";
    const item = this.listEl.createDiv({ cls: "doudou-library-item" });
    const body = item.createEl("button", {
      cls: "doudou-library-item-body",
      attr: { type: "button", "aria-label": `查看记录：${preview}` }
    });
    const imagePaths = record.images ?? [];
    if (imagePaths.length > 0) {
      const imageWrap = body.createDiv({ cls: "doudou-library-image" });
      const resource = this.dependencies.imageService.resourcePath(imagePaths[0]);
      if (resource) {
        const image = imageWrap.createEl("img", {
          cls: "doudou-library-image-thumb",
          attr: { src: resource, alt: "" }
        });
        image.addEventListener("error", () => {
          image.remove();
          imageWrap.createDiv({ cls: "doudou-image-missing", text: "图片" });
        }, { once: true });
      } else {
        imageWrap.createDiv({ cls: "doudou-image-missing", text: "图片" });
      }
      if (imagePaths.length > 1) {
        imageWrap.createDiv({
          cls: "doudou-library-image-count",
          text: `${imagePaths.length} 张`
        });
      }
    }
    const main = body.createDiv({ cls: "doudou-library-item-main" });
    main.createDiv({ cls: "doudou-library-meta", text: metaText(record) });
    main.createDiv({
      cls: "doudou-library-preview",
      text: preview
    });
    body.createDiv({ cls: "doudou-library-time", text: formatTime(record.created) });
    body.addEventListener("click", () => {
      new RecordDetailModal(
        this.app,
        this.dependencies,
        record,
        async () => this.refresh(false)
      ).open();
    });
    const edit = item.createEl("button", {
      cls: "doudou-library-edit-button",
      attr: { type: "button", "aria-label": `编辑记录：${preview}`, title: "编辑" }
    });
    setIcon(edit, "pencil");
    edit.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      new RecordDetailModal(
        this.app,
        this.dependencies,
        record,
        async () => this.refresh(false),
        "edit"
      ).open();
    });
  }
}
