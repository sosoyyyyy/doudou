import { App, Modal, Platform } from "obsidian";
import { cleanTagName } from "../data/recordCodec";
import type { TagOption } from "../types";

const TAG_PICKER_KEYBOARD_THRESHOLD_PX = 120;

export class TagPickerModal extends Modal {
  private selected: string[];
  private options: TagOption[];
  private optionListEl!: HTMLElement;
  private selectedEl!: HTMLElement;
  private newTagRowEl!: HTMLElement;
  private newTagInputEl!: HTMLInputElement;
  private visualViewport: VisualViewport | null = null;
  private syncViewportHandler: (() => void) | null = null;
  private inputVisibilityFrame: number | null = null;
  private viewportBaselineHeight = 0;
  private viewportBaselineWidth = 0;

  constructor(
    app: App,
    options: readonly TagOption[],
    selected: readonly string[],
    private readonly onApply: (tags: string[]) => void
  ) {
    super(app);
    this.options = [...options];
    this.selected = [...new Set(selected)];
  }

  override onOpen(): void {
    this.modalEl.addClass("doudou-modal", "doudou-tag-picker-modal");
    this.contentEl.addClass("doudou-modal-content");
    this.contentEl.createEl("h2", { cls: "doudou-modal-title", text: "选择标签" });

    this.selectedEl = this.contentEl.createDiv({ cls: "doudou-picker-selected" });
    this.contentEl.createDiv({
      cls: "doudou-picker-label",
      text: "最近使用 / 已有标签"
    });
    this.optionListEl = this.contentEl.createDiv({ cls: "doudou-picker-options" });
    this.renderSelected();
    this.renderOptions();

    const createButton = this.contentEl.createEl("button", {
      cls: "doudou-new-tag-toggle",
      text: "+ 新建标签",
      attr: { type: "button" }
    });
    createButton.addEventListener("click", () => {
      this.newTagRowEl.removeClass("doudou-is-hidden");
      this.newTagInputEl.focus({ preventScroll: true });
      this.syncViewportHandler?.();
      this.keepNewTagInputVisible();
    });

    this.newTagRowEl = this.contentEl.createDiv({
      cls: "doudou-new-tag-row doudou-is-hidden"
    });
    this.newTagInputEl = this.newTagRowEl.createEl("input", {
      cls: "doudou-new-tag-input",
      attr: {
        type: "text",
        placeholder: "标签名称",
        "aria-label": "新标签名称"
      }
    });
    const addButton = this.newTagRowEl.createEl("button", {
      cls: "doudou-secondary-button",
      text: "添加",
      attr: { type: "button" }
    });
    const addNewTag = (): void => {
      const name = cleanTagName(this.newTagInputEl.value);
      if (!name) return;
      if (!this.selected.includes(name)) this.selected.push(name);
      if (!this.options.some((option) => option.name === name)) {
        this.options.unshift({ name, count: 0, lastUsed: "" });
      }
      this.newTagInputEl.value = "";
      this.renderSelected();
      this.renderOptions();
    };
    addButton.addEventListener("click", addNewTag);
    this.newTagInputEl.addEventListener("keydown", (event) => {
      if (!event.isComposing && event.key === "Enter") {
        event.preventDefault();
        addNewTag();
      }
    });

    const actions = this.contentEl.createDiv({ cls: "doudou-modal-actions" });
    const cancel = actions.createEl("button", {
      cls: "doudou-secondary-button",
      text: "取消",
      attr: { type: "button" }
    });
    cancel.addEventListener("click", () => this.close());
    const done = actions.createEl("button", {
      cls: "doudou-primary-button",
      text: "完成",
      attr: { type: "button" }
    });
    done.addEventListener("click", () => {
      this.onApply([...this.selected]);
      this.close();
    });

    this.registerMobileViewportHandling();
  }

  override onClose(): void {
    this.unregisterMobileViewportHandling();
    this.contentEl.empty();
  }

  private registerMobileViewportHandling(): void {
    const viewport = window.visualViewport;
    if (!Platform.isMobileApp || !viewport) return;

    this.visualViewport = viewport;
    const syncViewport = (): void => {
      if (
        this.viewportBaselineWidth === 0 ||
        Math.abs(viewport.width - this.viewportBaselineWidth) > 48
      ) {
        this.viewportBaselineWidth = viewport.width;
        this.viewportBaselineHeight = Math.max(
          window.innerHeight,
          document.documentElement.clientHeight,
          viewport.height
        );
      } else {
        this.viewportBaselineHeight = Math.max(
          this.viewportBaselineHeight,
          window.innerHeight,
          document.documentElement.clientHeight,
          viewport.height
        );
      }

      const visibleBottom = viewport.offsetTop + viewport.height;
      const keyboardOffset = Math.max(
        0,
        this.viewportBaselineHeight - visibleBottom
      );
      const keyboardOpen = keyboardOffset >= TAG_PICKER_KEYBOARD_THRESHOLD_PX;
      this.modalEl.style.setProperty(
        "--doudou-tag-picker-viewport-height",
        `${Math.max(240, viewport.height)}px`
      );
      this.modalEl.style.setProperty(
        "--doudou-tag-picker-keyboard-offset",
        `${keyboardOpen ? keyboardOffset : 0}px`
      );
      this.modalEl.toggleClass("doudou-tag-picker-keyboard-open", keyboardOpen);
      if (keyboardOpen && document.activeElement === this.newTagInputEl) {
        this.keepNewTagInputVisible();
      }
    };

    this.syncViewportHandler = syncViewport;
    viewport.addEventListener("resize", syncViewport);
    viewport.addEventListener("scroll", syncViewport);
    syncViewport();
  }

  private unregisterMobileViewportHandling(): void {
    if (this.visualViewport && this.syncViewportHandler) {
      this.visualViewport.removeEventListener("resize", this.syncViewportHandler);
      this.visualViewport.removeEventListener("scroll", this.syncViewportHandler);
    }
    if (this.inputVisibilityFrame !== null) {
      window.cancelAnimationFrame(this.inputVisibilityFrame);
      this.inputVisibilityFrame = null;
    }
    this.visualViewport = null;
    this.syncViewportHandler = null;
    this.viewportBaselineHeight = 0;
    this.viewportBaselineWidth = 0;
    this.modalEl.removeClass("doudou-tag-picker-keyboard-open");
    this.modalEl.style.removeProperty("--doudou-tag-picker-viewport-height");
    this.modalEl.style.removeProperty("--doudou-tag-picker-keyboard-offset");
  }

  private keepNewTagInputVisible(): void {
    if (this.inputVisibilityFrame !== null) {
      window.cancelAnimationFrame(this.inputVisibilityFrame);
    }
    this.inputVisibilityFrame = window.requestAnimationFrame(() => {
      this.inputVisibilityFrame = null;
      if (document.activeElement !== this.newTagInputEl) return;
      this.newTagInputEl.scrollIntoView({
        block: "center",
        inline: "nearest"
      });
    });
  }

  private toggleTag(tag: string): void {
    this.selected = this.selected.includes(tag)
      ? this.selected.filter((value) => value !== tag)
      : [...this.selected, tag];
    this.renderSelected();
    this.renderOptions();
  }

  private renderSelected(): void {
    this.selectedEl.empty();
    if (this.selected.length === 0) {
      this.selectedEl.createSpan({
        cls: "doudou-picker-empty",
        text: "还没有选择标签"
      });
      return;
    }

    for (const tag of this.selected) {
      const chip = this.selectedEl.createEl("button", {
        cls: "doudou-tag-chip doudou-is-selected",
        text: `#${tag} ×`,
        attr: { type: "button", "aria-label": `移除标签 ${tag}` }
      });
      chip.addEventListener("click", () => this.toggleTag(tag));
    }
  }

  private renderOptions(): void {
    this.optionListEl.empty();
    if (this.options.length === 0) {
      this.optionListEl.createSpan({
        cls: "doudou-picker-empty",
        text: "还没有用过标签"
      });
      return;
    }

    for (const option of this.options) {
      const selected = this.selected.includes(option.name);
      const button = this.optionListEl.createEl("button", {
        cls: `doudou-picker-option${selected ? " doudou-is-selected" : ""}`,
        text: `#${option.name}`,
        attr: {
          type: "button",
          "aria-pressed": String(selected),
          title: option.count > 0 ? `使用过 ${option.count} 次` : "新标签"
        }
      });
      button.addEventListener("click", () => this.toggleTag(option.name));
    }
  }
}
