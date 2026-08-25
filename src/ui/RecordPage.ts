import { App, Component, Notice, Platform, setIcon } from "obsidian";
import type { AiTagService } from "../ai/AiTagService";
import { imageExtension, type ImageService } from "../attachments/ImageService";
import {
  formatFileSize,
  MAX_ATTACHMENT_BYTES,
  type FileService
} from "../attachments/FileService";
import type { DoudouRepository } from "../data/DoudouRepository";
import type { FolderService } from "../services/FolderService";
import type { RecordService } from "../services/RecordService";
import type { StoredDoudouRecord } from "../types";
import {
  applyManualTagCompletion,
  collectConfirmedManualTagOptions,
  extractConfirmedManualTags,
  findManualTagInput,
  manualTagSuggestions
} from "../services/manualTags";
import { ImagePreviewModal } from "./ImagePreviewModal";
import { GifPreviewSession, isGifFile, isGifPath } from "./gifPreview";
import { showImageActionMenuAtEvent } from "./imageActions";
import { recordPageGalleryPresentation } from "./imageGallery";
import { editableViewerItems, storedViewerItems } from "./imageViewer";
import {
  buildImageSavePlan,
  moveImageItem,
  type EditableImageItem
} from "./imageReorder";
import {
  createPendingImages,
  imageFilesFromClipboardItems,
  releasePendingImages,
  type PendingImage
} from "./imageDraft";
import { formatDateTime, renderManualTagText, writeClipboardText } from "./uiHelpers";
import {
  createPendingFiles,
  hasSavableRecordDraft,
  type PendingFile
} from "./fileDraft";
import { stabilizeIosTextareaLineBreaks } from "./editorScroll";

function createManualTagEditor(
  form: HTMLElement,
  initialValue: string,
  records: readonly StoredDoudouRecord[]
): HTMLTextAreaElement {
  const wrapper = form.createDiv({ cls: "doudou-tag-editor" });
  const mirror = wrapper.createDiv({
    cls: "doudou-editor-content doudou-tag-editor-mirror",
    attr: { "aria-hidden": "true" }
  });
  const textarea = wrapper.createEl("textarea", {
    cls: "doudou-editor-content doudou-tag-editor-input",
    attr: {
      placeholder: "记下此刻……\n\n直接输入 #标签",
      "aria-label": "正文",
      rows: "10",
      autocomplete: "off",
      spellcheck: "true"
    }
  });
  textarea.value = initialValue;
  const suggestions = wrapper.createDiv({
    cls: "doudou-tag-suggestions doudou-is-hidden",
    attr: { role: "listbox", "aria-label": "用户标签建议" }
  });
  const options = collectConfirmedManualTagOptions(records);
  let composing = false;

  const syncMirror = (): void => {
    renderManualTagText(mirror, textarea.value);
    if (textarea.value.endsWith("\n")) mirror.appendText("\n");
    mirror.scrollTop = textarea.scrollTop;
    mirror.scrollLeft = textarea.scrollLeft;
  };
  const hideSuggestions = (): void => {
    suggestions.empty();
    suggestions.addClass("doudou-is-hidden");
  };
  const applySuggestion = (name: string): void => {
    const input = findManualTagInput(
      textarea.value,
      textarea.selectionStart,
      textarea.selectionEnd
    );
    if (!input) return;
    const completion = applyManualTagCompletion(textarea.value, input, name);
    textarea.value = completion.value;
    textarea.setSelectionRange(completion.selectionStart, completion.selectionEnd);
    syncMirror();
    hideSuggestions();
    textarea.focus({ preventScroll: true });
  };
  const updateSuggestions = (): void => {
    if (composing || document.activeElement !== textarea) {
      hideSuggestions();
      return;
    }
    const input = findManualTagInput(
      textarea.value,
      textarea.selectionStart,
      textarea.selectionEnd
    );
    if (!input) {
      hideSuggestions();
      return;
    }
    const confirmed = new Set(extractConfirmedManualTags(textarea.value));
    const matches = manualTagSuggestions(options, input.query, confirmed);
    if (matches.length === 0) {
      hideSuggestions();
      return;
    }
    suggestions.empty();
    suggestions.removeClass("doudou-is-hidden");
    for (const option of matches) {
      const button = suggestions.createEl("button", {
        cls: "doudou-tag-suggestion",
        text: `#${option.name}`,
        attr: { type: "button", role: "option" }
      });
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        applySuggestion(option.name);
      });
      button.addEventListener("click", () => applySuggestion(option.name));
    }
  };

  textarea.addEventListener("input", () => {
    syncMirror();
    if (!composing) updateSuggestions();
  });
  textarea.addEventListener("select", updateSuggestions);
  textarea.addEventListener("click", updateSuggestions);
  textarea.addEventListener("keyup", updateSuggestions);
  textarea.addEventListener("scroll", () => {
    mirror.scrollTop = textarea.scrollTop;
    mirror.scrollLeft = textarea.scrollLeft;
  }, { passive: true });
  textarea.addEventListener("compositionstart", () => {
    composing = true;
    hideSuggestions();
  });
  textarea.addEventListener("compositionend", () => {
    composing = false;
    syncMirror();
    updateSuggestions();
  });
  textarea.addEventListener("focus", updateSuggestions);
  textarea.addEventListener("blur", hideSuggestions);
  syncMirror();
  return textarea;
}

export interface RecordPageDependencies {
  repository: DoudouRepository;
  folderService: FolderService;
  recordService: RecordService;
  imageService: ImageService;
  fileService: FileService;
  aiTagService: AiTagService;
}

export class RecordPage extends Component {
  private readonly gifPreviews = new GifPreviewSession();
  private record: StoredDoudouRecord | null = null;
  private pending: PendingImage[] = [];
  private pendingFiles: PendingFile[] = [];
  private defaultFolder: string | undefined;
  private folderSelectEl: HTMLSelectElement | null = null;
  private editorScrollCleanup: (() => void) | null = null;
  constructor(private readonly app: App, private readonly containerEl: HTMLElement, private readonly dependencies: RecordPageDependencies, private readonly goBack: () => void, private readonly changed: () => Promise<void>) { super(); }
  override onload(): void { this.containerEl.addClass("doudou-record-page"); }
  override onunload(): void { this.editorScrollCleanup?.(); this.editorScrollCleanup = null; this.gifPreviews.dispose(); releasePendingImages(this.pending); this.pendingFiles = []; this.containerEl.empty(); }
  deactivate(): void { this.gifPreviews.clear(); }
  open(record: StoredDoudouRecord): void { this.record = record; this.renderRead(); }
  async create(defaultFolder?: string): Promise<void> { this.record = null; this.defaultFolder = defaultFolder; await this.renderEdit(true); }

  async refreshFolders(): Promise<void> {
    const select = this.folderSelectEl;
    if (!select?.isConnected) return;
    const current = select.value;
    const names = await this.dependencies.folderService.folderNames();
    this.populateFolderSelect(select, names, current);
  }

  private renderRead(): void {
    const record = this.record; if (!record) return; this.editorScrollCleanup?.(); this.editorScrollCleanup = null; this.gifPreviews.clear(); this.folderSelectEl = null; this.containerEl.empty();
    const header = this.containerEl.createDiv({ cls: "doudou-record-header" });
    const back = header.createEl("button", { cls: "doudou-back-button", text: "‹ 返回", attr: { type: "button" } }); back.addEventListener("click", this.goBack);
    const tools = header.createDiv({ cls: "doudou-record-tools" });
    const edit = tools.createEl("button", { cls: "doudou-round-tool", attr: { type: "button", "aria-label": "编辑备忘录", title: "编辑" } }); setIcon(edit, "pencil"); edit.addEventListener("click", () => void this.renderEdit(false));
    const more = tools.createEl("button", { cls: "doudou-round-tool", text: "…", attr: { type: "button", "aria-label": "更多操作" } });
    const menu = header.createDiv({ cls: "doudou-record-menu doudou-is-hidden" });
    const copy = menu.createEl("button", { text: "复制全文", attr: { type: "button" } }); copy.addEventListener("click", () => { void writeClipboardText(record.content); menu.addClass("doudou-is-hidden"); });
    const remove = menu.createEl("button", { cls: "doudou-menu-danger", text: "删除", attr: { type: "button" } }); remove.addEventListener("click", async () => { if (!window.confirm("确定删除这条备忘录吗？它会进入 Obsidian 回收站。")) return; await this.dependencies.recordService.delete(record); await this.changed(); this.goBack(); });
    more.addEventListener("click", () => menu.toggleClass("doudou-is-hidden", !menu.hasClass("doudou-is-hidden")));
    const article = this.containerEl.createEl("article", { cls: "doudou-record-article" });
    if (record.title?.trim()) article.createEl("h1", { text: record.title });
    article.createDiv({ cls: "doudou-record-meta", text: `${record.folder} · 创建于 ${formatDateTime(record.created)}${record.updated ? ` · 更新于 ${formatDateTime(record.updated)}` : ""}` });
    if (record.content) renderManualTagText(article.createDiv({ cls: "doudou-record-content" }), record.content);
    if ((record.images ?? []).length > 0) {
      const presentation = recordPageGalleryPresentation(record.images ?? []);
      const viewerItems = storedViewerItems(presentation.paths);
      const gallery = article.createDiv({ cls: "doudou-record-gallery", attr: { "data-count": String(record.images?.length ?? 0) } });
      for (const [index, path] of presentation.paths.entries()) {
        const button = gallery.createEl("button", { cls: "doudou-gallery-item", attr: { type: "button", "aria-label": `查看第 ${index + 1} 张图片` } });
        const src = this.dependencies.imageService.resourcePath(path);
        if (src) {
          const gif = isGifPath(path);
          const image = button.createEl("img", { cls: "doudou-gallery-image", attr: { ...(gif ? {} : { src }), alt: `备忘录图片 ${index + 1}` } });
          if (gif) this.gifPreviews.applyStored(image, button, path, this.dependencies.imageService, src);
        }
        else button.createDiv({ cls: "doudou-image-missing", text: "图片缺失" });
        button.addEventListener("click", () => new ImagePreviewModal(
          this.app,
          this.dependencies.imageService,
          viewerItems,
          index
        ).open());
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
    this.editorScrollCleanup?.(); this.editorScrollCleanup = null; this.gifPreviews.clear(); releasePendingImages(this.pending); this.pending = []; this.pendingFiles = []; this.containerEl.empty();
    const record = this.record;
    const [folders, records] = await Promise.all([
      this.dependencies.folderService.listFolders(),
      this.dependencies.repository.loadAll()
    ]);
    const header = this.containerEl.createDiv({ cls: "doudou-record-header doudou-editor-header" }); header.createEl("h2", { text: isNew ? "新建备忘录" : "编辑备忘录" });
    const actions = header.createDiv({ cls: "doudou-editor-actions" });
    const cancel = actions.createEl("button", { cls: "doudou-secondary-button", text: "取消", attr: { type: "button" } });
    const save = actions.createEl("button", { cls: "doudou-primary-button", text: "保存", attr: { type: "button" } });
    const form = this.containerEl.createDiv({ cls: "doudou-editor" });
    const title = form.createEl("input", { cls: "doudou-title-input", attr: { type: "text", placeholder: "标题（可选）", "aria-label": "标题" } }); title.value = record?.title ?? "";
    const content = createManualTagEditor(form, record?.content ?? "", records);
    if (Platform.isIosApp) this.editorScrollCleanup = stabilizeIosTextareaLineBreaks(content, this.containerEl);
    const imageInput = form.createEl("input", { cls: "doudou-file-input", attr: { type: "file", accept: "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.heic,.heif", multiple: "true" } });
    const images = form.createDiv({ cls: "doudou-editor-images" });
    let editableImages: EditableImageItem[] = (record?.images ?? []).map((path, index) => ({
      kind: "stored",
      id: `stored-${index}-${path}`,
      path
    }));
    const removed = new Set<string>();
    let activePointerCleanup: (() => void) | null = null;
    const moveById = (sourceId: string, targetId: string): void => {
      const from = editableImages.findIndex((item) => item.id === sourceId);
      const to = editableImages.findIndex((item) => item.id === targetId);
      if (from < 0 || to < 0 || from === to) return;
      editableImages = moveImageItem(editableImages, from, to);
      paintImages();
    };
    const startLongPress = (
      event: PointerEvent,
      tile: HTMLElement,
      sourceId: string,
      onActivate: () => void
    ): void => {
      if (!Platform.isMobileApp || (event.target as Element | null)?.closest("button")) return;
      activePointerCleanup?.();
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      let active = false;
      let targetId = sourceId;
      const timer = window.setTimeout(() => {
        active = true;
        onActivate();
        tile.addClass("doudou-is-dragging");
        images.addClass("doudou-is-reordering");
        tile.setPointerCapture?.(pointerId);
      }, 380);
      const clearTargets = (): void => {
        images.querySelectorAll(".doudou-is-drop-target").forEach((item) => item.removeClass("doudou-is-drop-target"));
      };
      const cleanup = (): void => {
        window.clearTimeout(timer);
        clearTargets();
        tile.removeClass("doudou-is-dragging");
        images.removeClass("doudou-is-reordering");
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onEnd);
        document.removeEventListener("pointercancel", onCancel);
        if (activePointerCleanup === cleanup) activePointerCleanup = null;
      };
      const onMove = (pointerEvent: PointerEvent): void => {
        if (pointerEvent.pointerId !== pointerId) return;
        const distance = Math.hypot(pointerEvent.clientX - startX, pointerEvent.clientY - startY);
        if (!active) {
          if (distance > 10) cleanup();
          return;
        }
        pointerEvent.preventDefault();
        const target = document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY)?.closest<HTMLElement>(".doudou-editor-image");
        const nextTargetId = target?.dataset.imageId;
        if (!nextTargetId || nextTargetId === targetId) return;
        targetId = nextTargetId;
        clearTargets();
        if (targetId !== sourceId) target.addClass("doudou-is-drop-target");
      };
      const onEnd = (pointerEvent: PointerEvent): void => {
        if (pointerEvent.pointerId !== pointerId) return;
        if (active) {
          pointerEvent.preventDefault();
          const finalTargetId = targetId;
          cleanup();
          moveById(sourceId, finalTargetId);
        } else cleanup();
      };
      const onCancel = (pointerEvent: PointerEvent): void => {
        if (pointerEvent.pointerId === pointerId) cleanup();
      };
      document.addEventListener("pointermove", onMove, { passive: false });
      document.addEventListener("pointerup", onEnd);
      document.addEventListener("pointercancel", onCancel);
      activePointerCleanup = cleanup;
    };
    const paintImages = (): void => {
      activePointerCleanup?.();
      images.empty();
      for (const [index, item] of editableImages.entries()) {
        let dragStartedFromControl = false;
        let suppressPreviewClick = false;
        const tile = images.createDiv({
          cls: "doudou-editor-image",
          attr: { "data-image-id": item.id, "aria-label": `图片 ${index + 1}` }
        });
        tile.draggable = Platform.isDesktopApp;
        const pending = item.kind === "pending"
          ? this.pending.find((candidate) => candidate.id === item.id)
          : null;
        const src = item.kind === "stored"
          ? this.dependencies.imageService.resourcePath(item.path)
          : pending?.previewUrl ?? null;
        if (src) {
          const gif = item.kind === "stored" ? isGifPath(item.path) : Boolean(pending && isGifFile(pending.file));
          const image = tile.createEl("img", { attr: { ...(gif ? {} : { src }), alt: item.kind === "stored" ? "已有图片" : pending?.file.name ?? "待上传图片", draggable: "false" } });
          if (gif && item.kind === "stored") this.gifPreviews.applyStored(image, tile, item.path, this.dependencies.imageService, src);
          else if (gif && pending) this.gifPreviews.applyPending(image, tile, pending, src);
        }
        else tile.createDiv({ cls: "doudou-image-missing", text: "图片缺失" });
        const orderControls = tile.createDiv({ cls: "doudou-editor-image-order" });
        const backward = orderControls.createEl("button", { cls: "doudou-image-move-button", attr: { type: "button", "aria-label": "向前移动图片", title: "向前移动" } });
        setIcon(backward, "chevron-left"); backward.disabled = index === 0;
        backward.addEventListener("click", () => { editableImages = moveImageItem(editableImages, index, index - 1); paintImages(); });
        const forward = orderControls.createEl("button", { cls: "doudou-image-move-button", attr: { type: "button", "aria-label": "向后移动图片", title: "向后移动" } });
        setIcon(forward, "chevron-right"); forward.disabled = index === editableImages.length - 1;
        forward.addEventListener("click", () => { editableImages = moveImageItem(editableImages, index, index + 1); paintImages(); });
        const removeButton = tile.createEl("button", { cls: "doudou-editor-image-remove", text: "×", attr: { type: "button", "aria-label": "移除图片" } });
        removeButton.addEventListener("click", () => {
          if (item.kind === "stored") removed.add(item.path);
          else if (pending) {
            releasePendingImages([pending]);
            this.pending = this.pending.filter((candidate) => candidate.id !== pending.id);
          }
          editableImages = editableImages.filter((candidate) => candidate.id !== item.id);
          paintImages();
        });
        tile.addEventListener("dragstart", (dragEvent) => {
          if (!Platform.isDesktopApp || dragStartedFromControl) { dragEvent.preventDefault(); return; }
          tile.addClass("doudou-is-dragging");
          suppressPreviewClick = true;
          dragEvent.dataTransfer?.setData("text/plain", item.id);
          if (dragEvent.dataTransfer) dragEvent.dataTransfer.effectAllowed = "move";
        });
        tile.addEventListener("dragend", () => {
          dragStartedFromControl = false;
          tile.removeClass("doudou-is-dragging");
          images.querySelectorAll(".doudou-is-drop-target").forEach((target) => target.removeClass("doudou-is-drop-target"));
        });
        tile.addEventListener("dragover", (dragEvent) => { if (Platform.isDesktopApp) { dragEvent.preventDefault(); tile.addClass("doudou-is-drop-target"); } });
        tile.addEventListener("dragleave", () => tile.removeClass("doudou-is-drop-target"));
        tile.addEventListener("drop", (dragEvent) => {
          dragEvent.preventDefault(); tile.removeClass("doudou-is-drop-target");
          const sourceId = dragEvent.dataTransfer?.getData("text/plain");
          if (sourceId) moveById(sourceId, item.id);
        });
        tile.addEventListener("pointerdown", (pointerEvent) => {
          dragStartedFromControl = Boolean((pointerEvent.target as Element | null)?.closest("button"));
          startLongPress(pointerEvent, tile, item.id, () => { suppressPreviewClick = true; });
        });
        tile.addEventListener("pointerup", () => { window.setTimeout(() => { dragStartedFromControl = false; }, 0); });
        tile.addEventListener("pointercancel", () => { dragStartedFromControl = false; });
        tile.addEventListener("click", (event) => {
          if ((event.target as Element | null)?.closest("button")) return;
          if (suppressPreviewClick) { suppressPreviewClick = false; return; }
          const viewerItems = editableViewerItems(editableImages, this.pending);
          const viewerIndex = viewerItems.findIndex((candidate) => candidate.kind === "stored"
            ? item.kind === "stored" && candidate.path === item.path
            : candidate.id === item.id);
          if (viewerIndex >= 0) new ImagePreviewModal(
            this.app,
            this.dependencies.imageService,
            viewerItems,
            viewerIndex
          ).open();
        });
      }
    };
    paintImages();
    imageInput.addEventListener("change", () => {
      const files = Array.from(imageInput.files ?? []).filter((file) => imageExtension(file) !== null);
      imageInput.value = "";
      const created = createPendingImages(files);
      this.pending.push(...created);
      editableImages.push(...created.map((item) => ({ kind: "pending" as const, id: item.id })));
      paintImages();
    });
    content.addEventListener("paste", (event) => {
      const files = imageFilesFromClipboardItems(event.clipboardData?.items)
        .filter((file) => imageExtension(file) !== null);
      if (files.length === 0) return;
      const created = createPendingImages(files);
      this.pending.push(...created);
      editableImages.push(...created.map((item) => ({ kind: "pending" as const, id: item.id })));
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
    const folderRow = form.createDiv({ cls: "doudou-editor-folder" }); folderRow.createSpan({ text: "文件夹" }); const folder = folderRow.createEl("select", { attr: { "aria-label": "所属文件夹" } }); this.folderSelectEl = folder;
    const names = folders.map((item) => item.name);
    const preferred = record?.folder ?? this.defaultFolder;
    this.populateFolderSelect(folder, names, preferred);
    const status = form.createDiv({ cls: "doudou-editor-status", attr: { role: "status" } });
    cancel.addEventListener("click", () => { releasePendingImages(this.pending); this.pending = []; this.pendingFiles = []; if (record) this.renderRead(); else this.goBack(); });
    save.addEventListener("click", async () => {
      if (!hasSavableRecordDraft(title.value, content.value, editableImages.length, retainedFiles.length + this.pendingFiles.length)) { status.setText("标题、正文、图片和文件不能同时为空"); return; }
      if (!folder.value) { status.setText("请先在资料页新建文件夹"); return; }
      const actualFolders = await this.dependencies.folderService.folderNames();
      if (!actualFolders.includes(folder.value)) { this.populateFolderSelect(folder, actualFolders); status.setText("所选文件夹已不存在，请重新选择"); return; }
      const imagePlan = buildImageSavePlan(editableImages);
      const pendingById = new Map(this.pending.map((item) => [item.id, item]));
      const snapshot = imagePlan.pendingIds.map((id) => pendingById.get(id)).filter((item): item is PendingImage => Boolean(item));
      if (snapshot.length !== imagePlan.pendingIds.length) { status.setText("图片暂时没有准备好，请重新添加"); return; }
      save.disabled = true; cancel.disabled = true; status.setText("正在保存..."); const fileSnapshot = [...this.pendingFiles];
      try {
        if (record) this.record = await this.dependencies.recordService.update(record, { title: title.value, content: content.value, folder: folder.value }, snapshot.map((item) => item.file), [...removed], fileSnapshot.map((item) => item.file), [...removedFiles], imagePlan.order);
        else { const draft = this.dependencies.repository.createRecord(content.value, folder.value, title.value); this.record = await this.dependencies.recordService.create(draft, snapshot.map((item) => item.file), fileSnapshot.map((item) => item.file)); }
        releasePendingImages(snapshot); this.pending = []; this.pendingFiles = []; await this.changed(); this.renderRead(); if (this.record) void this.dependencies.aiTagService.enrich(this.record);
      } catch (error) { console.error("[doudou] Failed to save record", error); status.setText("保存失败，请再试一次"); save.disabled = false; cancel.disabled = false; }
    });
  }

  private populateFolderSelect(select: HTMLSelectElement, names: readonly string[], preferred?: string): void {
    select.empty();
    const selected = preferred && names.includes(preferred) ? preferred : names[0] ?? "";
    if (names.length === 0) select.createEl("option", { text: "请先新建资料文件夹", value: "", attr: { disabled: "true" } });
    for (const name of names) select.createEl("option", { text: name, value: name });
    select.value = selected;
  }
}
