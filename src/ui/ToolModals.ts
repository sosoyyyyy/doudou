import { App, Modal } from "obsidian";
import type { AskDoudouService } from "../ai/AskDoudouService";
import { deepSeekErrorMessage } from "../ai/DeepSeekClient";
import type { DoudouRepository } from "../data/DoudouRepository";
import type { StoredDoudouRecord } from "../types";
import { recordTitle } from "./uiHelpers";

export class AskDoudouModal extends Modal {
  constructor(app: App, private readonly service: AskDoudouService, private readonly openRecord: (record: StoredDoudouRecord) => void, private readonly openSettings: () => void) { super(app); }
  override onOpen(): void {
    this.modalEl.addClass("doudou-modal", "doudou-ask-tool-modal"); this.contentEl.addClass("doudou-modal-content"); this.contentEl.createEl("h2", { text: "问兜兜" });
    const input = this.contentEl.createEl("textarea", { attr: { rows: "4", placeholder: "我之前记过……", "aria-label": "想问兜兜的问题" } });
    const answer = this.contentEl.createDiv({ cls: "doudou-ask-tool-answer", attr: { role: "status" } }); const sources = this.contentEl.createDiv({ cls: "doudou-ask-tool-sources" });
    const actions = this.contentEl.createDiv({ cls: "doudou-modal-actions" }); const settings = actions.createEl("button", { cls: "doudou-secondary-button", text: "AI 设置", attr: { type: "button" } }); settings.addEventListener("click", this.openSettings);
    const ask = actions.createEl("button", { cls: "doudou-primary-button", text: "查找", attr: { type: "button" } }); ask.addEventListener("click", async () => {
      const question = input.value.trim(); if (!question) return; ask.disabled = true; answer.setText("兜兜正在翻找..."); sources.empty();
      try { const result = await this.service.ask(question); answer.setText(result.answer); if (result.sources.length) { sources.createDiv({ cls: "doudou-field-label", text: "依据来源" }); for (const record of result.sources) { const button = sources.createEl("button", { cls: "doudou-source-item", text: recordTitle(record), attr: { type: "button" } }); button.addEventListener("click", () => { this.close(); this.openRecord(record); }); } } }
      catch (error) { answer.setText(deepSeekErrorMessage(error)); } finally { ask.disabled = false; }
    });
  }
  override onClose(): void { this.contentEl.empty(); }
}

export class FolderManagerModal extends Modal {
  constructor(app: App, private readonly repository: DoudouRepository, private readonly existing: string | undefined, private readonly onChanged: () => Promise<void>) { super(app); }
  override onOpen(): void {
    this.modalEl.addClass("doudou-modal", "doudou-folder-modal"); this.contentEl.addClass("doudou-modal-content"); this.contentEl.createEl("h2", { text: this.existing ? "管理文件夹" : "新建文件夹" });
    const input = this.contentEl.createEl("input", { attr: { type: "text", placeholder: "文件夹名称", "aria-label": "文件夹名称" } }); input.value = this.existing ?? ""; const status = this.contentEl.createDiv({ cls: "doudou-modal-status", attr: { role: "status" } });
    const actions = this.contentEl.createDiv({ cls: "doudou-modal-actions" });
    if (this.existing) { const remove = actions.createEl("button", { cls: "doudou-danger-ghost-button", text: "删除", attr: { type: "button" } }); remove.addEventListener("click", async () => { try { await this.repository.deleteFolder(this.existing!); await this.onChanged(); this.close(); } catch { status.setText("请先移动或删除文件夹中的备忘录。"); } }); }
    const cancel = actions.createEl("button", { cls: "doudou-secondary-button", text: "取消", attr: { type: "button" } }); cancel.addEventListener("click", () => this.close());
    const save = actions.createEl("button", { cls: "doudou-primary-button", text: "保存", attr: { type: "button" } }); save.addEventListener("click", async () => { try { if (this.existing) await this.repository.renameFolder(this.existing, input.value); else await this.repository.createFolder(input.value); await this.onChanged(); this.close(); } catch { status.setText("这个名称不能使用，或文件夹已经存在"); } });
  }
  override onClose(): void { this.contentEl.empty(); }
}
