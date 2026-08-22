import { App, Component, Platform, setIcon } from "obsidian";
import type { AiTagService } from "../ai/AiTagService";
import type { AskDoudouService } from "../ai/AskDoudouService";
import { deepSeekErrorMessage } from "../ai/DeepSeekClient";
import { imageExtension, type ImageService } from "../attachments/ImageService";
import { CATEGORIES, RECENT_RECORD_LIMIT } from "../constants";
import type { DoudouRepository } from "../data/DoudouRepository";
import { collectTagOptions } from "../services/recordSearch";
import type { RecordService } from "../services/RecordService";
import type {
  Category,
  DoudouRecord,
  StoredDoudouRecord
} from "../types";
import { AskSourcesModal } from "./AskSourcesModal";
import { renderStoredImages } from "./ImagePreviewModal";
import {
  createPendingImages,
  releasePendingImages,
  type PendingImage
} from "./imageDraft";
import { MobileTagPicker } from "./MobileTagPicker";
import { TagPickerModal } from "./TagPickerModal";
import { metaText } from "./uiHelpers";

type SaveState = "saving" | "success" | "error";
type AskState = "loading" | "success" | "error";

interface SessionStatus {
  record: DoudouRecord | StoredDoudouRecord;
  state: SaveState;
  pendingImages: PendingImage[];
}

interface AskSession {
  requestId: string;
  question: string;
  created: string;
  state: AskState;
  answer?: string;
  sources: StoredDoudouRecord[];
  errorMessage?: string;
}

export interface ChatPageDependencies {
  repository: DoudouRepository;
  recordService: RecordService;
  imageService: ImageService;
  aiTagService: AiTagService;
  askService: AskDoudouService;
  openSettings: () => void;
  openRecord: (record: StoredDoudouRecord) => void;
}

export class ChatPage extends Component {
  private messagesEl!: HTMLElement;
  private textareaEl!: HTMLTextAreaElement;
  private hintEl!: HTMLElement;
  private selectedTagsEl!: HTMLElement;
  private pendingImagesEl!: HTMLElement;
  private categoryRowEl!: HTMLElement;
  private imageButtonEl!: HTMLButtonElement;
  private tagButtonEl!: HTMLButtonElement;
  private askButtonEl!: HTMLButtonElement;
  private askModeEl!: HTMLElement;
  private fileInputEl!: HTMLInputElement;
  private selectedCategory: Category | null = null;
  private selectedTags: string[] = [];
  private pendingImages: PendingImage[] = [];
  private askMode = false;
  private categoryButtons = new Map<Category, HTMLButtonElement>();
  private records: StoredDoudouRecord[] = [];
  private sessionStatuses = new Map<string, SessionStatus>();
  private askSessions = new Map<string, AskSession>();
  private totalRecords = 0;
  private refreshVersion = 0;
  private tagPickerRequestVersion = 0;
  private mobileTagPicker: MobileTagPicker | null = null;
  private nearBottom = true;

  constructor(
    private readonly app: App,
    private readonly containerEl: HTMLElement,
    private readonly overlayHostEl: HTMLElement,
    private readonly dependencies: ChatPageDependencies,
    private readonly openLibrary: () => void
  ) {
    super();
  }

  override onload(): void {
    this.buildLayout();
  }

  override onunload(): void {
    this.closeTagPicker();
    releasePendingImages(this.pendingImages);
    for (const status of this.sessionStatuses.values()) {
      releasePendingImages(status.pendingImages);
    }
    this.containerEl.empty();
  }

  closeTagPicker(): void {
    this.tagPickerRequestVersion++;
    this.mobileTagPicker?.close();
    this.mobileTagPicker = null;
  }

  async refresh(scrollAfter = false): Promise<void> {
    const version = ++this.refreshVersion;
    const wasNearBottom = this.nearBottom;
    try {
      const allRecords = await this.dependencies.repository.loadAll();
      if (version !== this.refreshVersion) return;
      this.totalRecords = allRecords.length;
      this.records = allRecords.slice(0, RECENT_RECORD_LIMIT).reverse();
      const existingById = new Map(allRecords.map((record) => [record.id, record]));
      for (const [id, status] of this.sessionStatuses) {
        if (status.state === "success") {
          const current = existingById.get(id);
          if (current) status.record = current;
          else this.sessionStatuses.delete(id);
        }
      }
      this.renderMessages();
      if (scrollAfter || wasNearBottom) this.scrollToBottom(false);
    } catch (error) {
      console.error("[doudou] Failed to load recent records", error);
      this.messagesEl.empty();
      this.messagesEl.createDiv({
        cls: "doudou-chat-empty",
        text: "最近记录暂时没有加载出来"
      });
    }
  }

  handleViewportChange(): void {
    if (document.activeElement === this.textareaEl && this.nearBottom) {
      this.scrollToBottom(false);
    }
  }

  private buildLayout(): void {
    this.containerEl.addClass("doudou-chat-page");
    this.messagesEl = this.containerEl.createDiv({
      cls: "doudou-messages",
      attr: { "aria-live": "polite", "aria-label": "最近记录" }
    });
    this.messagesEl.createDiv({
      cls: "doudou-chat-loading",
      text: "兜兜努力翻找中..."
    });
    this.registerDomEvent(this.messagesEl, "scroll", () => {
      const distance = this.messagesEl.scrollHeight -
        this.messagesEl.scrollTop -
        this.messagesEl.clientHeight;
      this.nearBottom = distance < 72;
    }, { passive: true });

    const composer = this.containerEl.createEl("section", {
      cls: "doudou-composer",
      attr: { "aria-label": "输入区" }
    });
    const composerInner = composer.createDiv({ cls: "doudou-composer-inner" });

    this.askModeEl = composerInner.createDiv({
      cls: "doudou-ask-mode doudou-is-hidden"
    });
    const askLabel = this.askModeEl.createDiv({ cls: "doudou-ask-mode-label" });
    const askIcon = askLabel.createSpan({ cls: "doudou-ask-mode-icon" });
    setIcon(askIcon, "sparkles");
    askLabel.createSpan({ text: "问兜兜" });
    const cancelAsk = this.askModeEl.createEl("button", {
      cls: "doudou-ask-cancel",
      text: "取消",
      attr: { type: "button" }
    });
    this.registerDomEvent(cancelAsk, "click", () => this.setAskMode(false));

    this.pendingImagesEl = composerInner.createDiv({
      cls: "doudou-pending-images doudou-is-hidden",
      attr: { "aria-label": "待发送图片" }
    });

    this.categoryRowEl = composerInner.createDiv({ cls: "doudou-category-row" });
    for (const category of CATEGORIES) {
      const button = this.categoryRowEl.createEl("button", {
        cls: "doudou-category-button",
        text: category,
        attr: { type: "button", "aria-pressed": "false" }
      });
      this.categoryButtons.set(category, button);
      this.registerDomEvent(button, "click", () => this.selectCategory(category));
    }

    this.selectedTagsEl = composerInner.createDiv({
      cls: "doudou-selected-tags doudou-is-hidden",
      attr: { "aria-label": "已选标签" }
    });

    const inputShell = composerInner.createDiv({ cls: "doudou-input-shell" });
    this.fileInputEl = inputShell.createEl("input", {
      cls: "doudou-file-input",
      attr: {
        type: "file",
        accept: "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.heic,.heif",
        multiple: "true",
        "aria-hidden": "true"
      }
    });
    this.registerDomEvent(this.fileInputEl, "change", () => this.selectImages());

    this.imageButtonEl = inputShell.createEl("button", {
      cls: "doudou-icon-button",
      attr: { type: "button", "aria-label": "选择图片" }
    });
    setIcon(this.imageButtonEl, "image-plus");
    this.registerDomEvent(this.imageButtonEl, "click", () => this.fileInputEl.click());

    this.textareaEl = inputShell.createEl("textarea", {
      cls: "doudou-textarea",
      attr: {
        rows: "1",
        placeholder: "写点什么……",
        "aria-label": "记录正文"
      }
    });
    this.registerDomEvent(this.textareaEl, "input", () => {
      this.resizeTextarea();
      this.clearHint();
    });
    this.registerDomEvent(this.textareaEl, "keydown", (event) => {
      if (!event.isComposing && event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void this.handleSend();
      }
    });

    this.tagButtonEl = inputShell.createEl("button", {
      cls: "doudou-icon-button",
      text: "#",
      attr: { type: "button", "aria-label": "选择自由标签" }
    });
    this.registerDomEvent(this.tagButtonEl, "click", () => void this.openTagPicker());

    this.askButtonEl = inputShell.createEl("button", {
      cls: "doudou-icon-button",
      attr: { type: "button", "aria-label": "下一条问兜兜" }
    });
    setIcon(this.askButtonEl, "sparkles");
    this.registerDomEvent(this.askButtonEl, "click", () => this.setAskMode(true));

    const sendButton = inputShell.createEl("button", {
      cls: "doudou-send-button",
      attr: { type: "button", "aria-label": "发送" }
    });
    setIcon(sendButton, "send-horizontal");
    this.registerDomEvent(sendButton, "click", () => void this.handleSend());

    this.hintEl = composerInner.createDiv({
      cls: "doudou-hint",
      attr: { role: "status" }
    });
  }

  private renderMessages(): void {
    this.messagesEl.empty();
    const recordById = new Map<string, DoudouRecord | StoredDoudouRecord>();
    for (const record of this.records) recordById.set(record.id, record);
    for (const status of this.sessionStatuses.values()) {
      if (!recordById.has(status.record.id)) recordById.set(status.record.id, status.record);
    }
    const timeline = [
      ...[...recordById.values()].map((record) => ({
        kind: "record" as const,
        created: record.created,
        record
      })),
      ...[...this.askSessions.values()].map((ask) => ({
        kind: "ask" as const,
        created: ask.created,
        ask
      }))
    ].sort((a, b) => a.created.localeCompare(b.created));

    if (this.totalRecords > RECENT_RECORD_LIMIT) {
      const earlier = this.messagesEl.createEl("button", {
        cls: "doudou-earlier-button",
        text: "查看更早记录",
        attr: { type: "button" }
      });
      earlier.addEventListener("click", this.openLibrary);
    }
    if (timeline.length === 0) {
      this.messagesEl.createDiv({
        cls: "doudou-chat-empty",
        text: "还没有东西，先往兜兜里放一条吧"
      });
      return;
    }

    const stream = this.messagesEl.createDiv({ cls: "doudou-message-stream" });
    for (const item of timeline) {
      if (item.kind === "record") {
        const status = this.sessionStatuses.get(item.record.id);
        this.renderUserRecord(stream, item.record, status?.pendingImages ?? []);
        if (status) this.renderSaveStatus(stream, status);
      } else {
        this.renderAskSession(stream, item.ask);
      }
    }
  }

  private renderUserRecord(
    container: HTMLElement,
    record: DoudouRecord,
    pendingImages: readonly PendingImage[]
  ): void {
    const row = container.createDiv({
      cls: "doudou-message-row doudou-message-row-user"
    });
    const bubble = row.createDiv({ cls: "doudou-bubble doudou-user-bubble" });
    if (pendingImages.length > 0) this.renderTransientImages(bubble, pendingImages);
    else if ((record.images ?? []).length > 0) {
      renderStoredImages(
        this.app,
        bubble,
        this.dependencies.imageService,
        record.images ?? [],
        4
      );
    }
    if (record.content) bubble.createDiv({ cls: "doudou-bubble-text", text: record.content });
    row.createDiv({ cls: "doudou-message-meta", text: metaText(record) });
  }

  private renderSaveStatus(container: HTMLElement, status: SessionStatus): void {
    const row = this.createSystemRow(container);
    const text = status.state === "saving"
      ? "兜兜正在收好..."
      : status.state === "success"
        ? "收好啦 ✓"
        : "这条没接住";
    const bubble = row.stack.createDiv({
      cls: `doudou-bubble doudou-system-bubble doudou-is-${status.state}`,
      text
    });
    if (status.state === "success") {
      bubble.createDiv({ cls: "doudou-status-meta", text: metaText(status.record) });
    } else if (status.state === "error") {
      const retry = row.stack.createEl("button", {
        cls: "doudou-retry-button",
        text: "重新保存",
        attr: { type: "button" }
      });
      retry.addEventListener("click", () => void this.persist(status));
    }
  }

  private renderAskSession(container: HTMLElement, ask: AskSession): void {
    const questionRow = container.createDiv({
      cls: "doudou-message-row doudou-message-row-user"
    });
    questionRow.createDiv({
      cls: "doudou-bubble doudou-user-bubble doudou-question-bubble",
      text: ask.question
    });

    const row = this.createSystemRow(container);
    const bubble = row.stack.createDiv({
      cls: `doudou-bubble doudou-system-bubble doudou-ask-answer doudou-is-${ask.state}`,
      text: ask.state === "loading"
        ? "兜兜努力翻找中..."
        : ask.state === "success"
          ? ask.answer ?? ""
          : ask.errorMessage ?? "兜兜暂时翻不到，再试一次吧"
    });
    if (ask.state === "success" && ask.sources.length > 0) {
      const sources = bubble.createEl("button", {
        cls: "doudou-ask-sources",
        text: `查看依据 · ${ask.sources.length}`,
        attr: { type: "button" }
      });
      sources.addEventListener("click", () => {
        new AskSourcesModal(
          this.app,
          ask.sources,
          this.dependencies.openRecord
        ).open();
      });
    }
    if (ask.state === "error") {
      const retry = row.stack.createEl("button", {
        cls: "doudou-retry-button",
        text: "再试一次",
        attr: { type: "button" }
      });
      retry.addEventListener("click", () => void this.runAsk(ask));
      if (ask.errorMessage === "还没有设置 DeepSeek API Key") {
        const settings = row.stack.createEl("button", {
          cls: "doudou-settings-link",
          text: "打开兜兜设置",
          attr: { type: "button" }
        });
        settings.addEventListener("click", this.dependencies.openSettings);
      }
    }
  }

  private createSystemRow(container: HTMLElement): { stack: HTMLElement } {
    const row = container.createDiv({
      cls: "doudou-message-row doudou-message-row-system"
    });
    row.createDiv({ cls: "doudou-avatar", text: "兜" });
    return { stack: row.createDiv({ cls: "doudou-system-stack" }) };
  }

  private async handleSend(): Promise<void> {
    if (this.askMode) {
      await this.sendQuestion();
      return;
    }
    const content = this.textareaEl.value;
    if (!this.selectedCategory) {
      this.showHint("先告诉兜兜要放进哪里呀");
      return;
    }
    if (!content.trim() && this.pendingImages.length === 0) {
      this.showHint("写点什么或选一张图片吧");
      return;
    }

    const record = this.dependencies.repository.createRecord(
      content,
      this.selectedCategory,
      this.selectedTags
    );
    const transferredImages = this.pendingImages;
    this.pendingImages = [];
    const status: SessionStatus = {
      record,
      state: "saving",
      pendingImages: transferredImages
    };
    this.sessionStatuses.set(record.id, status);
    this.pruneSessionStatuses();
    this.resetNormalDraft();
    this.renderMessages();
    this.scrollToBottom(true);
    await this.persist(status);
  }

  private async persist(status: SessionStatus): Promise<void> {
    status.state = "saving";
    this.renderMessages();
    this.scrollToBottom(false);
    let savedForAi: StoredDoudouRecord | null = null;
    try {
      const stored = await this.dependencies.recordService.create(
        status.record,
        status.pendingImages.map((image) => image.file)
      );
      releasePendingImages(status.pendingImages);
      status.pendingImages = [];
      status.record = stored;
      status.state = "success";
      this.records = [
        ...this.records.filter((existing) => existing.id !== stored.id),
        stored
      ].sort((a, b) => a.created.localeCompare(b.created));
      savedForAi = stored;
    } catch (error) {
      console.error("[doudou] Failed to save record", error);
      status.state = "error";
    }
    this.renderMessages();
    this.scrollToBottom(true);
    if (savedForAi) void this.dependencies.aiTagService.enrich(savedForAi);
  }

  private async sendQuestion(): Promise<void> {
    const question = this.textareaEl.value.trim();
    if (!question) {
      this.showHint("写下想问兜兜的问题吧");
      return;
    }
    const requestId = globalThis.crypto?.randomUUID?.() ??
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    const ask: AskSession = {
      requestId,
      question,
      created: new Date().toISOString(),
      state: "loading",
      sources: []
    };
    this.askSessions.set(requestId, ask);
    this.textareaEl.value = "";
    this.resizeTextarea();
    this.setAskMode(false);
    this.renderMessages();
    this.scrollToBottom(true);
    await this.runAsk(ask);
  }

  private async runAsk(ask: AskSession): Promise<void> {
    ask.state = "loading";
    ask.answer = undefined;
    ask.errorMessage = undefined;
    this.renderMessages();
    try {
      const result = await this.dependencies.askService.ask(ask.question);
      ask.state = "success";
      ask.answer = result.answer;
      ask.sources = result.sources;
    } catch (error) {
      ask.state = "error";
      ask.errorMessage = deepSeekErrorMessage(error);
    }
    this.renderMessages();
    if (this.nearBottom) this.scrollToBottom(true);
  }

  private selectImages(): void {
    const files = Array.from(this.fileInputEl.files ?? []);
    this.fileInputEl.value = "";
    const supported = files.filter((file) => imageExtension(file) !== null);
    if (supported.length !== files.length) this.showHint("有图片格式暂不支持");
    this.pendingImages.push(...createPendingImages(supported));
    this.renderPendingImages();
  }

  private renderPendingImages(): void {
    this.pendingImagesEl.empty();
    const visible = !this.askMode && this.pendingImages.length > 0;
    this.pendingImagesEl.toggleClass("doudou-is-hidden", !visible);
    for (const image of this.pendingImages) {
      const tile = this.pendingImagesEl.createDiv({ cls: "doudou-pending-image" });
      tile.createEl("img", {
        cls: "doudou-pending-image-thumb",
        attr: { src: image.previewUrl, alt: image.file.name }
      });
      const remove = tile.createEl("button", {
        cls: "doudou-pending-image-remove",
        text: "×",
        attr: { type: "button", "aria-label": `移除图片 ${image.file.name}` }
      });
      remove.addEventListener("click", () => {
        URL.revokeObjectURL(image.previewUrl);
        this.pendingImages = this.pendingImages.filter((item) => item.id !== image.id);
        this.renderPendingImages();
      });
    }
  }

  private renderTransientImages(
    container: HTMLElement,
    images: readonly PendingImage[]
  ): void {
    const grid = container.createDiv({
      cls: `doudou-image-grid doudou-image-grid-${Math.min(images.length, 4)}`
    });
    for (const image of images.slice(0, 4)) {
      grid.createEl("img", {
        cls: "doudou-image-thumbnail",
        attr: { src: image.previewUrl, alt: image.file.name }
      });
    }
  }

  private setAskMode(enabled: boolean): void {
    this.askMode = enabled;
    this.askModeEl.toggleClass("doudou-is-hidden", !enabled);
    this.categoryRowEl.toggleClass("doudou-is-hidden", enabled);
    this.selectedTagsEl.toggleClass(
      "doudou-is-hidden",
      enabled || this.selectedTags.length === 0
    );
    this.imageButtonEl.toggleClass("doudou-is-hidden", enabled);
    this.tagButtonEl.toggleClass("doudou-is-hidden", enabled);
    this.askButtonEl.toggleClass("doudou-is-hidden", enabled);
    this.textareaEl.placeholder = enabled
      ? "问问兜兜以前记过什么……"
      : "写点什么……";
    this.textareaEl.setAttr("aria-label", enabled ? "问兜兜" : "记录正文");
    this.renderPendingImages();
    this.clearHint();
  }

  private async openTagPicker(): Promise<void> {
    const requestVersion = ++this.tagPickerRequestVersion;
    try {
      const options = collectTagOptions(await this.dependencies.repository.loadAll());
      if (requestVersion !== this.tagPickerRequestVersion) return;
      if (Platform.isMobileApp) {
        this.mobileTagPicker?.close();
        const picker = new MobileTagPicker(
          this.overlayHostEl,
          options,
          this.selectedTags,
          (tags) => {
            this.selectedTags = tags;
            this.renderSelectedTags();
          },
          () => {
            if (this.mobileTagPicker === picker) this.mobileTagPicker = null;
          }
        );
        this.mobileTagPicker = picker;
        picker.open();
        return;
      }
      new TagPickerModal(this.app, options, this.selectedTags, (tags) => {
        this.selectedTags = tags;
        this.renderSelectedTags();
      }).open();
    } catch (error) {
      console.error("[doudou] Failed to load tags", error);
      this.showHint("标签暂时没有加载出来");
    }
  }

  private renderSelectedTags(): void {
    this.selectedTagsEl.empty();
    this.selectedTagsEl.toggleClass(
      "doudou-is-hidden",
      this.askMode || this.selectedTags.length === 0
    );
    for (const tag of this.selectedTags) {
      const chip = this.selectedTagsEl.createEl("button", {
        cls: "doudou-tag-chip",
        text: `#${tag} ×`,
        attr: { type: "button", "aria-label": `移除标签 ${tag}` }
      });
      chip.addEventListener("click", () => {
        this.selectedTags = this.selectedTags.filter((value) => value !== tag);
        this.renderSelectedTags();
      });
    }
  }

  private selectCategory(category: Category): void {
    this.selectedCategory = category;
    for (const [value, button] of this.categoryButtons) {
      const selected = value === category;
      button.toggleClass("doudou-is-selected", selected);
      button.setAttr("aria-pressed", String(selected));
    }
    this.clearHint();
  }

  private resetNormalDraft(): void {
    this.textareaEl.value = "";
    this.selectedTags = [];
    this.renderSelectedTags();
    this.renderPendingImages();
    this.resizeTextarea();
    this.clearHint();
  }

  private pruneSessionStatuses(): void {
    while (this.sessionStatuses.size > RECENT_RECORD_LIMIT) {
      const oldest = this.sessionStatuses.keys().next().value as string | undefined;
      if (!oldest) return;
      const status = this.sessionStatuses.get(oldest);
      if (status) releasePendingImages(status.pendingImages);
      this.sessionStatuses.delete(oldest);
    }
  }

  private resizeTextarea(): void {
    this.textareaEl.style.height = "auto";
    this.textareaEl.style.height = `${Math.min(this.textareaEl.scrollHeight, 132)}px`;
  }

  private showHint(text: string): void {
    this.hintEl.setText(text);
    this.hintEl.addClass("doudou-is-visible");
  }

  private clearHint(): void {
    this.hintEl.empty();
    this.hintEl.removeClass("doudou-is-visible");
  }

  private scrollToBottom(smooth: boolean): void {
    requestAnimationFrame(() => {
      this.messagesEl.scrollTo({
        top: this.messagesEl.scrollHeight,
        behavior: smooth ? "smooth" : "auto"
      });
      this.nearBottom = true;
    });
  }
}
