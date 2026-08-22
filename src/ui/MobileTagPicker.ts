import { cleanTagName } from "../data/recordCodec";
import type { TagOption } from "../types";

export class MobileTagPicker {
  private selected: string[];
  private options: TagOption[];
  private overlayEl: HTMLElement | null = null;
  private selectedEl!: HTMLElement;
  private optionListEl!: HTMLElement;
  private newTagRowEl!: HTMLElement;
  private newTagInputEl!: HTMLInputElement;
  private cleanups: Array<() => void> = [];

  constructor(
    private readonly hostEl: HTMLElement,
    options: readonly TagOption[],
    selected: readonly string[],
    private readonly onApply: (tags: string[]) => void,
    private readonly onClose: () => void
  ) {
    this.options = [...options];
    this.selected = [...new Set(selected)];
  }

  open(): void {
    if (this.overlayEl) return;

    const overlay = this.hostEl.createDiv({ cls: "doudou-tag-overlay" });
    this.overlayEl = overlay;
    const backdrop = overlay.createDiv({ cls: "doudou-tag-backdrop" });
    const sheet = overlay.createEl("section", {
      cls: "doudou-tag-sheet",
      attr: {
        role: "dialog",
        "aria-modal": "true",
        "aria-label": "选择标签"
      }
    });
    const content = sheet.createDiv({ cls: "doudou-tag-sheet-content" });
    const header = content.createDiv({ cls: "doudou-tag-sheet-header" });
    header.createEl("h2", { cls: "doudou-modal-title", text: "选择标签" });
    const closeButton = header.createEl("button", {
      cls: "doudou-tag-sheet-close",
      text: "×",
      attr: { type: "button", "aria-label": "关闭标签选择器" }
    });

    this.selectedEl = content.createDiv({ cls: "doudou-picker-selected" });
    content.createDiv({
      cls: "doudou-picker-label",
      text: "最近使用 / 已有标签"
    });
    this.optionListEl = content.createDiv({ cls: "doudou-picker-options" });
    this.renderSelected();
    this.renderOptions();

    const createButton = content.createEl("button", {
      cls: "doudou-new-tag-toggle",
      text: "+ 新建标签",
      attr: { type: "button" }
    });
    this.newTagRowEl = content.createDiv({
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

    const actions = content.createDiv({ cls: "doudou-modal-actions" });
    const cancelButton = actions.createEl("button", {
      cls: "doudou-secondary-button",
      text: "取消",
      attr: { type: "button" }
    });
    const doneButton = actions.createEl("button", {
      cls: "doudou-primary-button",
      text: "完成",
      attr: { type: "button" }
    });

    this.listen(backdrop, "click", () => this.close());
    this.listen(closeButton, "click", () => this.close());
    this.listen(cancelButton, "click", () => this.close());
    this.listen(doneButton, "click", () => {
      this.onApply([...this.selected]);
      this.close();
    });
    this.listen(createButton, "click", () => {
      this.newTagRowEl.removeClass("doudou-is-hidden");
      this.newTagInputEl.focus();
      this.newTagInputEl.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    this.listen(addButton, "click", () => this.addNewTag());
    this.listen(this.newTagInputEl, "keydown", (event) => {
      const keyEvent = event as KeyboardEvent;
      if (!keyEvent.isComposing && keyEvent.key === "Enter") {
        keyEvent.preventDefault();
        this.addNewTag();
      }
    });
    this.listen(this.selectedEl, "click", (event) => {
      this.toggleFromEvent(event, this.selectedEl);
    });
    this.listen(this.optionListEl, "click", (event) => {
      this.toggleFromEvent(event, this.optionListEl);
    });
  }

  close(): void {
    const overlay = this.overlayEl;
    if (!overlay) return;

    if (document.activeElement === this.newTagInputEl) this.newTagInputEl.blur();
    for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
    overlay.remove();
    this.overlayEl = null;
    this.onClose();
  }

  private addNewTag(): void {
    const name = cleanTagName(this.newTagInputEl.value);
    if (!name) {
      this.newTagInputEl.focus();
      return;
    }
    if (!this.selected.includes(name)) this.selected.push(name);
    if (!this.options.some((option) => option.name === name)) {
      this.options.unshift({ name, count: 0, lastUsed: "" });
    }
    this.newTagInputEl.value = "";
    this.renderSelected();
    this.renderOptions();
    this.newTagInputEl.focus();
  }

  private toggleFromEvent(event: Event, container: HTMLElement): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>("button[data-tag]");
    if (!button || !container.contains(button)) return;
    const tag = button.dataset.tag;
    if (tag) this.toggleTag(tag);
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
      chip.dataset.tag = tag;
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
      button.dataset.tag = option.name;
    }
  }

  private listen(target: EventTarget, type: string, listener: EventListener): void {
    target.addEventListener(type, listener);
    this.cleanups.push(() => target.removeEventListener(type, listener));
  }
}
