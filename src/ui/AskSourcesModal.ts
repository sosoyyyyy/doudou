import { App, Modal } from "obsidian";
import type { StoredDoudouRecord } from "../types";
import { formatDateTime, metaText, previewText } from "./uiHelpers";

export class AskSourcesModal extends Modal {
  constructor(
    app: App,
    private readonly sources: readonly StoredDoudouRecord[],
    private readonly openRecord: (record: StoredDoudouRecord) => void
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass("doudou-modal", "doudou-sources-modal");
    this.contentEl.addClass("doudou-modal-content");
    this.contentEl.createEl("h2", {
      cls: "doudou-modal-title",
      text: `回答依据 · ${this.sources.length}`
    });
    const list = this.contentEl.createDiv({ cls: "doudou-source-list" });
    for (const record of this.sources) {
      const button = list.createEl("button", {
        cls: "doudou-source-item",
        attr: { type: "button" }
      });
      button.createDiv({ cls: "doudou-source-meta", text: metaText(record) });
      button.createDiv({ cls: "doudou-source-preview", text: previewText(record.content) || "图片记录" });
      button.createDiv({ cls: "doudou-source-time", text: formatDateTime(record.created) });
      button.addEventListener("click", () => {
        this.close();
        this.openRecord(record);
      });
    }
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
