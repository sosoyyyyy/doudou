import { App, Modal, Platform, setIcon } from "obsidian";
import type { AskDoudouService } from "../ai/AskDoudouService";
import { deepSeekErrorMessage } from "../ai/DeepSeekClient";
import type { FolderService } from "../services/FolderService";
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
  constructor(app: App, private readonly folders: FolderService, private readonly existing: string | undefined, private readonly onChanged: () => Promise<void>) { super(app); }
  override onOpen(): void {
    this.modalEl.addClass("doudou-modal", "doudou-folder-modal"); this.contentEl.addClass("doudou-modal-content"); this.contentEl.createEl("h2", { text: this.existing ? "管理文件夹" : "新建文件夹" });
    const input = this.contentEl.createEl("input", { attr: { type: "text", placeholder: "文件夹名称", "aria-label": "文件夹名称" } }); input.value = this.existing ?? ""; const status = this.contentEl.createDiv({ cls: "doudou-modal-status", attr: { role: "status" } });
    const actions = this.contentEl.createDiv({ cls: "doudou-modal-actions" });
    if (this.existing) { const remove = actions.createEl("button", { cls: "doudou-danger-ghost-button", text: "删除", attr: { type: "button" } }); remove.addEventListener("click", async () => { try { await this.folders.deleteFolder(this.existing!); await this.onChanged(); this.close(); } catch { status.setText("请先移动或删除文件夹中的备忘录。"); } }); }
    const cancel = actions.createEl("button", { cls: "doudou-secondary-button", text: "取消", attr: { type: "button" } }); cancel.addEventListener("click", () => this.close());
    const save = actions.createEl("button", { cls: "doudou-primary-button", text: "保存", attr: { type: "button" } }); save.addEventListener("click", async () => { try { if (this.existing) await this.folders.renameFolder(this.existing, input.value); else await this.folders.createFolder(input.value); await this.onChanged(); this.close(); } catch { status.setText("这个名称不能使用，或文件夹已经存在"); } });
  }
  override onClose(): void { this.contentEl.empty(); }
}

export function moveFolderName(names: readonly string[], from: number, to: number): string[] {
  if (from < 0 || to < 0 || from >= names.length || to >= names.length || from === to) return [...names];
  const next = [...names]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); return next;
}

export class FolderOrderModal extends Modal {
  private names: string[] = [];
  private listEl!: HTMLElement;
  private activePointerCleanup: (() => void) | null = null;
  constructor(app: App, private readonly folders: FolderService, private readonly onChanged: () => Promise<void>) { super(app); }

  override onOpen(): void {
    this.modalEl.addClass("doudou-modal", "doudou-folder-order-modal"); this.contentEl.addClass("doudou-modal-content"); this.contentEl.createEl("h2", { text: "调整顺序" });
    this.contentEl.createDiv({ cls: "doudou-folder-order-hint", text: "长按并拖动文件夹；桌面端也可直接拖拽。" }); this.listEl = this.contentEl.createDiv({ cls: "doudou-folder-order-list" });
    const status = this.contentEl.createDiv({ cls: "doudou-modal-status", attr: { role: "status" } }); const actions = this.contentEl.createDiv({ cls: "doudou-modal-actions" });
    const cancel = actions.createEl("button", { cls: "doudou-secondary-button", text: "取消", attr: { type: "button" } }); const save = actions.createEl("button", { cls: "doudou-primary-button", text: "保存", attr: { type: "button" } });
    cancel.addEventListener("click", () => this.close()); save.addEventListener("click", async () => { save.disabled = true; cancel.disabled = true; status.setText("正在保存..."); try { this.names = await this.folders.setOrder(this.names); await this.onChanged(); this.close(); } catch { status.setText("顺序暂时没有保存成功"); save.disabled = false; cancel.disabled = false; } });
    void this.load(status, save);
  }
  override onClose(): void { this.activePointerCleanup?.(); this.contentEl.empty(); }

  private async load(status: HTMLElement, save: HTMLButtonElement): Promise<void> {
    save.disabled = true; status.setText("正在读取文件夹...");
    try { this.names = await this.folders.folderNames(); this.paint(); status.setText(this.names.length === 0 ? "当前没有可排序的资料文件夹" : ""); save.disabled = this.names.length === 0; }
    catch { status.setText("文件夹暂时没有加载出来"); }
  }
  private moveByName(source: string, target: string): void { const from = this.names.indexOf(source); const to = this.names.indexOf(target); if (from < 0 || to < 0 || from === to) return; this.names = moveFolderName(this.names, from, to); this.paint(); }
  private clearDropTargets(): void { this.listEl.querySelectorAll(".doudou-is-drop-target").forEach((item) => item.removeClass("doudou-is-drop-target")); }

  private paint(): void {
    this.activePointerCleanup?.(); this.listEl.empty();
    for (const [index, name] of this.names.entries()) {
      let dragStartedFromControl = false; const row = this.listEl.createDiv({ cls: "doudou-folder-order-item", attr: { "data-folder-name": name } }); row.draggable = Platform.isDesktopApp;
      const handle = row.createSpan({ cls: "doudou-folder-drag-handle", attr: { "aria-hidden": "true" } }); setIcon(handle, "grip-vertical"); row.createSpan({ cls: "doudou-folder-order-name", text: name });
      const controls = row.createDiv({ cls: "doudou-folder-order-controls" }); const up = controls.createEl("button", { attr: { type: "button", "aria-label": `向前移动 ${name}` } }); setIcon(up, "chevron-up"); up.disabled = index === 0; const down = controls.createEl("button", { attr: { type: "button", "aria-label": `向后移动 ${name}` } }); setIcon(down, "chevron-down"); down.disabled = index === this.names.length - 1;
      up.addEventListener("click", () => { this.names = moveFolderName(this.names, index, index - 1); this.paint(); }); down.addEventListener("click", () => { this.names = moveFolderName(this.names, index, index + 1); this.paint(); });
      row.addEventListener("dragstart", (event) => { if (!Platform.isDesktopApp || dragStartedFromControl) { event.preventDefault(); return; } row.addClass("doudou-is-dragging"); event.dataTransfer?.setData("text/plain", name); if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"; });
      row.addEventListener("dragend", () => { row.removeClass("doudou-is-dragging"); this.clearDropTargets(); }); row.addEventListener("dragover", (event) => { if (Platform.isDesktopApp) { event.preventDefault(); row.addClass("doudou-is-drop-target"); } }); row.addEventListener("dragleave", () => row.removeClass("doudou-is-drop-target")); row.addEventListener("drop", (event) => { event.preventDefault(); const source = event.dataTransfer?.getData("text/plain"); if (source) this.moveByName(source, name); });
      row.addEventListener("pointerdown", (event) => { dragStartedFromControl = Boolean((event.target as Element | null)?.closest("button")); this.startLongPress(event, row, name); }); row.addEventListener("pointerup", () => { window.setTimeout(() => { dragStartedFromControl = false; }, 0); }); row.addEventListener("pointercancel", () => { dragStartedFromControl = false; });
    }
  }

  private startLongPress(event: PointerEvent, row: HTMLElement, source: string): void {
    if (!Platform.isMobileApp || (event.target as Element | null)?.closest("button")) return; this.activePointerCleanup?.();
    const pointerId = event.pointerId; const startX = event.clientX; const startY = event.clientY; let active = false; let target = source;
    const timer = window.setTimeout(() => { active = true; row.addClass("doudou-is-dragging"); this.listEl.addClass("doudou-is-reordering"); row.setPointerCapture?.(pointerId); }, 380);
    const cleanup = (): void => { window.clearTimeout(timer); this.clearDropTargets(); row.removeClass("doudou-is-dragging"); this.listEl.removeClass("doudou-is-reordering"); document.removeEventListener("pointermove", onMove); document.removeEventListener("pointerup", onEnd); document.removeEventListener("pointercancel", onCancel); if (this.activePointerCleanup === cleanup) this.activePointerCleanup = null; };
    const onMove = (move: PointerEvent): void => { if (move.pointerId !== pointerId) return; if (!active) { if (Math.hypot(move.clientX - startX, move.clientY - startY) > 10) cleanup(); return; } move.preventDefault(); const candidate = document.elementFromPoint(move.clientX, move.clientY)?.closest<HTMLElement>(".doudou-folder-order-item"); const next = candidate?.dataset.folderName; if (!next || next === target) return; target = next; this.clearDropTargets(); if (target !== source) candidate.addClass("doudou-is-drop-target"); };
    const onEnd = (up: PointerEvent): void => { if (up.pointerId !== pointerId) return; if (active) { up.preventDefault(); const finalTarget = target; cleanup(); this.moveByName(source, finalTarget); } else cleanup(); }; const onCancel = (cancel: PointerEvent): void => { if (cancel.pointerId === pointerId) cleanup(); };
    document.addEventListener("pointermove", onMove, { passive: false }); document.addEventListener("pointerup", onEnd); document.addEventListener("pointercancel", onCancel); this.activePointerCleanup = cleanup;
  }
}
