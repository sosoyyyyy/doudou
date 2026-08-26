import { App, Modal } from "obsidian";
import type { TagOption } from "../types";

export class TagFilterModal extends Modal {
  private selected: Set<string>;

  constructor(
    app: App,
    private readonly options: readonly TagOption[],
    selected: ReadonlySet<string>,
    private readonly onChanged: (selected: ReadonlySet<string>) => void
  ) {
    super(app);
    this.selected = new Set(selected);
  }

  override onOpen(): void {
    this.modalEl.addClass("doudou-modal", "doudou-tag-filter-modal");
    this.contentEl.addClass("doudou-modal-content");
    this.contentEl.createEl("h2", { text: "按标签筛选" });
    const list = this.contentEl.createDiv({
      cls: "doudou-tag-filter-list",
      attr: { role: "group", "aria-label": "用户标签" }
    });
    const actions = this.contentEl.createDiv({ cls: "doudou-modal-actions" });
    const clear = actions.createEl("button", {
      cls: "doudou-secondary-button",
      text: "清除筛选",
      attr: { type: "button" }
    });

    const paint = (): void => {
      list.empty();
      if (this.options.length === 0) {
        list.createDiv({ cls: "doudou-tag-filter-empty", text: "还没有可用的标签" });
      }
      for (const option of this.options) {
        const isSelected = this.selected.has(option.name);
        const button = list.createEl("button", {
          cls: `doudou-tag-filter-chip${isSelected ? " doudou-is-selected" : ""}`,
          text: `#${option.name}`,
          attr: {
            type: "button",
            "aria-pressed": String(isSelected)
          }
        });
        button.addEventListener("click", () => {
          if (this.selected.has(option.name)) this.selected.delete(option.name);
          else this.selected.add(option.name);
          this.onChanged(new Set(this.selected));
          paint();
        });
      }
      clear.disabled = this.selected.size === 0;
    };

    clear.addEventListener("click", () => {
      this.selected.clear();
      this.onChanged(new Set());
      paint();
    });
    paint();
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
