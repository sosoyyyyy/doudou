import { App, Modal, setIcon } from "obsidian";
import type { AiTagService } from "../ai/AiTagService";
import { imageExtension, type ImageService } from "../attachments/ImageService";
import { CATEGORIES } from "../constants";
import type { DoudouRepository } from "../data/DoudouRepository";
import { collectTagOptions } from "../services/recordSearch";
import type { RecordService } from "../services/RecordService";
import type { Category, StoredDoudouRecord } from "../types";
import { renderStoredImages } from "./ImagePreviewModal";
import {
  createPendingImages,
  releasePendingImages,
  type PendingImage
} from "./imageDraft";
import { TagPickerModal } from "./TagPickerModal";
import { formatDateTime, metaText } from "./uiHelpers";

export interface RecordDetailDependencies {
  repository: DoudouRepository;
  recordService: RecordService;
  imageService: ImageService;
  aiTagService: AiTagService;
}

export type RecordDetailMode = "display" | "edit";

class ConfirmDeleteModal extends Modal {
  constructor(app: App, private readonly onConfirm: () => Promise<void>) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass("doudou-modal", "doudou-confirm-modal");
    this.contentEl.addClass("doudou-modal-content");
    this.contentEl.createEl("h2", {
      cls: "doudou-modal-title",
      text: "删除这条记录？"
    });
    this.contentEl.createEl("p", {
      cls: "doudou-confirm-copy",
      text: "记录和绑定图片会移到 Obsidian 回收站。"
    });
    const status = this.contentEl.createDiv({ cls: "doudou-modal-status" });
    const actions = this.contentEl.createDiv({ cls: "doudou-modal-actions" });
    const cancel = actions.createEl("button", {
      cls: "doudou-secondary-button",
      text: "取消",
      attr: { type: "button" }
    });
    cancel.addEventListener("click", () => this.close());
    const confirm = actions.createEl("button", {
      cls: "doudou-danger-button",
      text: "删除",
      attr: { type: "button" }
    });
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      cancel.disabled = true;
      status.setText("正在删除...");
      try {
        await this.onConfirm();
        this.close();
      } catch (error) {
        console.error("[doudou] Failed to delete record", error);
        status.setText("删除失败，请再试一次");
        confirm.disabled = false;
        cancel.disabled = false;
      }
    });
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

export class RecordDetailModal extends Modal {
  private editPendingImages: PendingImage[] = [];

  constructor(
    app: App,
    private readonly dependencies: RecordDetailDependencies,
    private record: StoredDoudouRecord,
    private readonly onChanged: () => Promise<void>,
    private readonly initialMode: RecordDetailMode = "display"
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass("doudou-modal", "doudou-detail-modal");
    this.contentEl.addClass("doudou-modal-content");
    if (this.initialMode === "edit") this.renderEdit();
    else this.renderDisplay();
  }

  override onClose(): void {
    this.releaseEditPreviews();
    this.contentEl.empty();
  }

  private renderDisplay(): void {
    this.releaseEditPreviews();
    this.contentEl.empty();
    this.contentEl.createEl("h2", { cls: "doudou-modal-title", text: "记录详情" });
    this.contentEl.createDiv({ cls: "doudou-detail-meta", text: metaText(this.record) });
    this.contentEl.createDiv({
      cls: "doudou-detail-time",
      text: `创建于 ${formatDateTime(this.record.created)}`
    });
    if (this.record.updated) {
      this.contentEl.createDiv({
        cls: "doudou-detail-time",
        text: `更新于 ${formatDateTime(this.record.updated)}`
      });
    }
    if ((this.record.images ?? []).length > 0) {
      const images = this.contentEl.createDiv({ cls: "doudou-detail-images" });
      renderStoredImages(
        this.app,
        images,
        this.dependencies.imageService,
        this.record.images ?? []
      );
    }
    if (this.record.content) {
      this.contentEl.createDiv({
        cls: "doudou-detail-content",
        text: this.record.content
      });
    }

    const actions = this.contentEl.createDiv({ cls: "doudou-modal-actions" });
    const edit = actions.createEl("button", {
      cls: "doudou-primary-button",
      text: "编辑",
      attr: { type: "button" }
    });
    edit.addEventListener("click", () => this.renderEdit());
    const remove = actions.createEl("button", {
      cls: "doudou-danger-ghost-button",
      text: "删除",
      attr: { type: "button" }
    });
    remove.addEventListener("click", () => this.confirmDelete());
  }

  private renderEdit(): void {
    this.releaseEditPreviews();
    this.contentEl.empty();
    this.contentEl.createEl("h2", { cls: "doudou-modal-title", text: "编辑记录" });
    let draftCategory: Category = this.record.category;
    let draftTags = [...this.record.tags];
    let retainedImages = [...(this.record.images ?? [])];
    const removedImages = new Set<string>();

    const textarea = this.contentEl.createEl("textarea", {
      cls: "doudou-edit-textarea",
      attr: { rows: "8", "aria-label": "记录正文" }
    });
    textarea.value = this.record.content;

    this.contentEl.createDiv({ cls: "doudou-field-label", text: "图片" });
    const imageControls = this.contentEl.createDiv({ cls: "doudou-edit-images" });
    const fileInput = imageControls.createEl("input", {
      cls: "doudou-file-input",
      attr: {
        type: "file",
        accept: "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.heic,.heif",
        multiple: "true",
        "aria-hidden": "true"
      }
    });
    const imageList = imageControls.createDiv({ cls: "doudou-edit-image-list" });
    const renderImages = (): void => {
      imageList.empty();
      for (const path of retainedImages) {
        const tile = imageList.createDiv({ cls: "doudou-edit-image-tile" });
        const resource = this.dependencies.imageService.resourcePath(path);
        if (resource) {
          tile.createEl("img", {
            cls: "doudou-pending-image-thumb",
            attr: { src: resource, alt: "已有图片" }
          });
        } else {
          tile.createDiv({ cls: "doudou-image-missing", text: "图片缺失" });
        }
        const remove = tile.createEl("button", {
          cls: "doudou-pending-image-remove",
          text: "×",
          attr: { type: "button", "aria-label": "移除这张图片" }
        });
        remove.addEventListener("click", () => {
          retainedImages = retainedImages.filter((item) => item !== path);
          removedImages.add(path);
          renderImages();
        });
      }
      for (const pending of this.editPendingImages) {
        const tile = imageList.createDiv({ cls: "doudou-edit-image-tile" });
        tile.createEl("img", {
          cls: "doudou-pending-image-thumb",
          attr: { src: pending.previewUrl, alt: pending.file.name }
        });
        const remove = tile.createEl("button", {
          cls: "doudou-pending-image-remove",
          text: "×",
          attr: { type: "button", "aria-label": `移除图片 ${pending.file.name}` }
        });
        remove.addEventListener("click", () => {
          URL.revokeObjectURL(pending.previewUrl);
          this.editPendingImages = this.editPendingImages.filter(
            (item) => item.id !== pending.id
          );
          renderImages();
        });
      }
      const add = imageList.createEl("button", {
        cls: "doudou-edit-image-add",
        attr: { type: "button", "aria-label": "增加图片" }
      });
      setIcon(add, "image-plus");
      add.createSpan({ text: "增加图片" });
      add.addEventListener("click", () => fileInput.click());
    };
    fileInput.addEventListener("change", () => {
      const files = Array.from(fileInput.files ?? []).filter(
        (file) => imageExtension(file) !== null
      );
      fileInput.value = "";
      this.editPendingImages.push(...createPendingImages(files));
      renderImages();
    });
    renderImages();

    this.contentEl.createDiv({ cls: "doudou-field-label", text: "放进哪里" });
    const categoryRow = this.contentEl.createDiv({ cls: "doudou-edit-categories" });
    const categoryButtons = new Map<Category, HTMLButtonElement>();
    const syncCategories = (): void => {
      for (const [category, button] of categoryButtons) {
        const selected = category === draftCategory;
        button.toggleClass("doudou-is-selected", selected);
        button.setAttr("aria-pressed", String(selected));
      }
    };
    for (const category of CATEGORIES) {
      const button = categoryRow.createEl("button", {
        cls: "doudou-category-button",
        text: category,
        attr: { type: "button", "aria-pressed": "false" }
      });
      categoryButtons.set(category, button);
      button.addEventListener("click", () => {
        draftCategory = category;
        syncCategories();
      });
    }
    syncCategories();

    this.contentEl.createDiv({ cls: "doudou-field-label", text: "自由标签" });
    const tagControls = this.contentEl.createDiv({ cls: "doudou-edit-tags" });
    const renderTags = (): void => {
      tagControls.empty();
      for (const tag of draftTags) {
        const chip = tagControls.createEl("button", {
          cls: "doudou-tag-chip",
          text: `#${tag} ×`,
          attr: { type: "button", "aria-label": `移除标签 ${tag}` }
        });
        chip.addEventListener("click", () => {
          draftTags = draftTags.filter((value) => value !== tag);
          renderTags();
        });
      }
      const choose = tagControls.createEl("button", {
        cls: "doudou-add-tag-inline",
        text: "+ 选择标签",
        attr: { type: "button" }
      });
      choose.addEventListener("click", () => void openTagPicker());
    };
    const openTagPicker = async (): Promise<void> => {
      try {
        const options = collectTagOptions(await this.dependencies.repository.loadAll());
        new TagPickerModal(this.app, options, draftTags, (tags) => {
          draftTags = tags;
          renderTags();
        }).open();
      } catch (error) {
        console.error("[doudou] Failed to load tags for editing", error);
      }
    };
    renderTags();

    const status = this.contentEl.createDiv({
      cls: "doudou-modal-status",
      attr: { role: "status" }
    });
    const actions = this.contentEl.createDiv({ cls: "doudou-modal-actions" });
    const cancel = actions.createEl("button", {
      cls: "doudou-secondary-button",
      text: "取消",
      attr: { type: "button" }
    });
    cancel.addEventListener("click", () => this.renderDisplay());
    const save = actions.createEl("button", {
      cls: "doudou-primary-button",
      text: "保存",
      attr: { type: "button" }
    });
    save.addEventListener("click", async () => {
      if (!textarea.value.trim() && retainedImages.length === 0 && this.editPendingImages.length === 0) {
        status.setText("正文和图片不能同时为空");
        return;
      }
      save.disabled = true;
      cancel.disabled = true;
      status.setText("正在保存...");
      const pendingSnapshot = [...this.editPendingImages];
      try {
        this.record = await this.dependencies.recordService.update(
          this.record,
          {
            content: textarea.value,
            category: draftCategory,
            tags: draftTags
          },
          pendingSnapshot.map((image) => image.file),
          [...removedImages]
        );
        releasePendingImages(pendingSnapshot);
        this.editPendingImages = [];
        await this.onChanged();
        this.renderDisplay();
        void this.dependencies.aiTagService.enrich(this.record);
      } catch (error) {
        console.error("[doudou] Failed to update record", error);
        status.setText("保存失败，请再试一次");
        save.disabled = false;
        cancel.disabled = false;
      }
    });
  }

  private confirmDelete(): void {
    new ConfirmDeleteModal(this.app, async () => {
      await this.dependencies.recordService.delete(this.record);
      await this.onChanged();
      this.close();
    }).open();
  }

  private releaseEditPreviews(): void {
    releasePendingImages(this.editPendingImages);
    this.editPendingImages = [];
  }
}
