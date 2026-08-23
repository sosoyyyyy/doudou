import { ItemView, Platform, setIcon, WorkspaceLeaf, type App } from "obsidian";
import type { AiTagService } from "../ai/AiTagService";
import type { AskDoudouService } from "../ai/AskDoudouService";
import type { ImageService } from "../attachments/ImageService";
import type { FileService } from "../attachments/FileService";
import { DOUDOU_VIEW_TYPE, VAULT_REFRESH_DEBOUNCE_MS } from "../constants";
import type { DoudouRepository } from "../data/DoudouRepository";
import type { RecordService } from "../services/RecordService";
import type { DoudouPage, StoredDoudouRecord } from "../types";
import { AllPage } from "./AllPage";
import { LibraryPage } from "./LibraryPage";
import { RecordPage } from "./RecordPage";
import { findRemotelySaveStartSyncCommand, type RegisteredCommand } from "./remotelySave";
import { AskDoudouModal, FolderManagerModal } from "./ToolModals";

export interface DoudouViewDependencies {
  repository: DoudouRepository;
  recordService: RecordService;
  imageService: ImageService;
  fileService: FileService;
  aiTagService: AiTagService;
  askService: AskDoudouService;
  openSettings: () => void;
}
interface CommandRegistry { listCommands(): RegisteredCommand[]; executeCommandById(commandId: string): boolean | void; }
type AppWithCommands = App & { commands?: Partial<CommandRegistry> };

export class DoudouView extends ItemView {
  private rootEl!: HTMLElement; private mainShellEl!: HTMLElement; private allContainerEl!: HTMLElement; private libraryContainerEl!: HTMLElement; private recordContainerEl!: HTMLElement;
  private allTabEl!: HTMLButtonElement; private libraryTabEl!: HTMLButtonElement; private allPage!: AllPage; private libraryPage!: LibraryPage; private recordPage!: RecordPage; private activePage: DoudouPage = "all"; private showingRecord = false; private refreshTimer: number | null = null;
  constructor(leaf: WorkspaceLeaf, private readonly dependencies: DoudouViewDependencies) { super(leaf); }
  getViewType(): string { return DOUDOU_VIEW_TYPE; } getDisplayText(): string { return "兜兜"; } getIcon(): string { return "notebook-pen"; }
  override async onOpen(): Promise<void> { this.contentEl.empty(); this.contentEl.addClass("doudou-host"); this.build(); this.registerRefresh(); this.registerViewport(); await this.allPage.refresh(true); }
  override async onClose(): Promise<void> { if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer); this.contentEl.removeClass("doudou-host"); this.contentEl.empty(); }
  private build(): void {
    this.rootEl = this.contentEl.createDiv({ cls: "doudou-view" }); this.mainShellEl = this.rootEl.createDiv({ cls: "doudou-main-shell" }); const header = this.mainShellEl.createEl("header", { cls: "doudou-header" }); header.createDiv({ cls: "doudou-brand", text: "兜兜" });
    const navigation = header.createDiv({ cls: "doudou-page-tabs", attr: { role: "tablist" } }); this.allTabEl = navigation.createEl("button", { cls: "doudou-page-tab doudou-is-selected", text: "全部", attr: { type: "button" } }); this.libraryTabEl = navigation.createEl("button", { cls: "doudou-page-tab", text: "资料", attr: { type: "button" } }); this.allTabEl.addEventListener("click", () => void this.switchPage("all")); this.libraryTabEl.addEventListener("click", () => void this.switchPage("library"));
    const tools = header.createDiv({ cls: "doudou-header-tools" }); const add = tools.createEl("button", { cls: "doudou-header-tool", text: "+", attr: { type: "button", "aria-label": "新建备忘录" } }); add.addEventListener("click", () => void this.newRecord()); const ask = tools.createEl("button", { cls: "doudou-header-tool doudou-ai-tool", text: "兜", attr: { type: "button", "aria-label": "问兜兜" } }); ask.addEventListener("click", () => new AskDoudouModal(this.app, this.dependencies.askService, (record) => this.openRecord(record), this.dependencies.openSettings).open());
    const sync = tools.createEl("button", { cls: "doudou-header-tool", attr: { type: "button", "aria-label": "使用 Remotely Save 同步" } }); setIcon(sync, "refresh-cw"); sync.addEventListener("click", () => this.sync(sync));
    const pages = this.mainShellEl.createDiv({ cls: "doudou-pages" }); this.allContainerEl = pages.createDiv({ cls: "doudou-page" }); this.libraryContainerEl = pages.createDiv({ cls: "doudou-page doudou-is-hidden" }); this.recordContainerEl = this.rootEl.createDiv({ cls: "doudou-page doudou-is-hidden" });
    this.allPage = this.addChild(new AllPage(this.allContainerEl, { repository: this.dependencies.repository, imageService: this.dependencies.imageService, openRecord: (record) => this.openRecord(record) }));
    this.libraryPage = this.addChild(new LibraryPage(this.libraryContainerEl, { repository: this.dependencies.repository, imageService: this.dependencies.imageService, openRecord: (record) => this.openRecord(record), manageFolder: (folder) => new FolderManagerModal(this.app, this.dependencies.repository, folder, async () => this.refreshAll()).open() }));
    this.recordPage = this.addChild(new RecordPage(this.app, this.recordContainerEl, this.dependencies, () => this.closeRecord(), async () => this.refreshAll()));
  }
  private async switchPage(page: DoudouPage): Promise<void> { if (this.showingRecord) this.closeRecord(); this.activePage = page; const all = page === "all"; this.allContainerEl.toggleClass("doudou-is-hidden", !all); this.libraryContainerEl.toggleClass("doudou-is-hidden", all); this.allTabEl.toggleClass("doudou-is-selected", all); this.libraryTabEl.toggleClass("doudou-is-selected", !all); this.dependencies.repository.invalidateCache(); if (all) await this.allPage.refresh(false); else await this.libraryPage.activate(); }
  private openRecord(record: StoredDoudouRecord): void { this.showingRecord = true; this.mainShellEl.addClass("doudou-is-hidden"); this.recordContainerEl.removeClass("doudou-is-hidden"); this.recordPage.open(record); }
  private closeRecord(): void { this.showingRecord = false; this.recordContainerEl.addClass("doudou-is-hidden"); this.mainShellEl.removeClass("doudou-is-hidden"); void this.refreshAll(); }
  private async newRecord(): Promise<void> { this.showingRecord = true; this.mainShellEl.addClass("doudou-is-hidden"); this.recordContainerEl.removeClass("doudou-is-hidden"); await this.recordPage.create(this.activePage === "library" ? this.libraryPage.currentFolderName() : undefined); }
  private async refreshAll(): Promise<void> { this.dependencies.repository.invalidateCache(); await Promise.all([this.allPage.refresh(false), this.libraryPage.refresh(false)]); }
  private sync(button: HTMLButtonElement): void { const registry = (this.app as AppWithCommands).commands as CommandRegistry | undefined; if (!registry) return; const id = findRemotelySaveStartSyncCommand(registry.listCommands()); if (!id) return; button.disabled = true; button.addClass("doudou-is-sync-triggered"); try { registry.executeCommandById(id); } finally { window.setTimeout(() => { button.disabled = false; button.removeClass("doudou-is-sync-triggered"); }, 700); } }
  private registerRefresh(): void { const schedule = (path: string, oldPath?: string): void => { if (!this.dependencies.repository.isDoudouPath(path) && (!oldPath || !this.dependencies.repository.isDoudouPath(oldPath))) return; this.dependencies.repository.invalidateCache(); if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer); this.refreshTimer = window.setTimeout(() => { this.refreshTimer = null; void this.refreshAll(); }, VAULT_REFRESH_DEBOUNCE_MS); }; this.registerEvent(this.app.vault.on("create", (file) => schedule(file.path))); this.registerEvent(this.app.vault.on("modify", (file) => schedule(file.path))); this.registerEvent(this.app.vault.on("delete", (file) => schedule(file.path))); this.registerEvent(this.app.vault.on("rename", (file, oldPath) => schedule(file.path, oldPath))); }
  private registerViewport(): void { const viewport = window.visualViewport; if (!viewport) return; const sync = (): void => { const top = this.rootEl.getBoundingClientRect().top; this.rootEl.style.setProperty("--doudou-visual-viewport-height", `${Math.max(0, viewport.offsetTop + viewport.height - top)}px`); this.rootEl.toggleClass("doudou-keyboard-open", Platform.isMobileApp && window.innerHeight - viewport.height > 120); }; viewport.addEventListener("resize", sync); viewport.addEventListener("scroll", sync); this.register(() => { viewport.removeEventListener("resize", sync); viewport.removeEventListener("scroll", sync); }); sync(); }
}
