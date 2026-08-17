import { App, Modal } from "obsidian";
import { cleanTagName } from "../data/recordCodec";
import type { TagOption } from "../types";

export class TagPickerModal extends Modal {
  private selected: string[];
  private options: TagOption[];
  private optionListEl!: HTMLElement;
  private selectedEl!: HTMLElement;
  private newTagRowEl!: HTMLElement;
  private newTagInputEl!: HTMLInputElement;

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
      this.newTagInputEl.focus();
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
  }

  override onClose(): void {
    this.contentEl.empty();
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
