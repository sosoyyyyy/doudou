import { ItemView, setIcon, WorkspaceLeaf } from "obsidian";
import {
  DOUDOU_VIEW_TYPE,
  VAULT_REFRESH_DEBOUNCE_MS
} from "../constants";
import type { DoudouPage, StoredDoudouRecord } from "../types";
import { ChatPage, type ChatPageDependencies } from "./ChatPage";
import { LibraryPage, type LibraryPageDependencies } from "./LibraryPage";
import { RecordDetailModal } from "./RecordDetailModal";

export interface DoudouViewDependencies
  extends Omit<ChatPageDependencies, "openRecord">, LibraryPageDependencies {}

export class DoudouView extends ItemView {
  private rootEl!: HTMLElement;
  private chatContainerEl!: HTMLElement;
  private libraryContainerEl!: HTMLElement;
  private chatTabEl!: HTMLButtonElement;
  private libraryTabEl!: HTMLButtonElement;
  private chatPage!: ChatPage;
  private libraryPage!: LibraryPage;
  private activePage: DoudouPage = "chat";
  private vaultRefreshTimer: number | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly dependencies: DoudouViewDependencies
  ) {
    super(leaf);
  }

  getViewType(): string {
    return DOUDOU_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "兜兜";
  }

  getIcon(): string {
    return "message-circle";
  }

  override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("doudou-host");
    this.buildShell();
    this.registerViewportHandling();
    this.registerDataRefreshEvents();
    await this.chatPage.refresh(true);
  }

  override async onClose(): Promise<void> {
    if (this.vaultRefreshTimer !== null) {
      window.clearTimeout(this.vaultRefreshTimer);
      this.vaultRefreshTimer = null;
    }
    this.contentEl.removeClass("doudou-host");
    this.contentEl.empty();
  }

  private buildShell(): void {
    this.rootEl = this.contentEl.createDiv({ cls: "doudou-view" });
    const header = this.rootEl.createEl("header", { cls: "doudou-header" });
    const navigation = header.createDiv({
      cls: "doudou-page-tabs",
      attr: { role: "tablist", "aria-label": "兜兜页面" }
    });
    this.chatTabEl = navigation.createEl("button", {
      cls: "doudou-page-tab doudou-is-selected",
      text: "💬 对话",
      attr: {
        type: "button",
        role: "tab",
        "aria-selected": "true"
      }
    });
    this.libraryTabEl = navigation.createEl("button", {
      cls: "doudou-page-tab",
      text: "📚 资料",
      attr: {
        type: "button",
        role: "tab",
        "aria-selected": "false"
      }
    });
    this.registerDomEvent(this.chatTabEl, "click", () => void this.switchPage("chat"));
    this.registerDomEvent(this.libraryTabEl, "click", () => void this.switchPage("library"));

    const refresh = header.createEl("button", {
      cls: "doudou-refresh-button",
      attr: { type: "button", "aria-label": "刷新兜兜资料", title: "刷新" }
    });
    setIcon(refresh, "refresh-cw");
    this.registerDomEvent(refresh, "click", () => void this.refreshActivePage(true));

    const pages = this.rootEl.createDiv({ cls: "doudou-pages" });
    this.chatContainerEl = pages.createDiv({
      cls: "doudou-page",
      attr: { role: "tabpanel" }
    });
    this.libraryContainerEl = pages.createDiv({
      cls: "doudou-page doudou-is-hidden",
      attr: { role: "tabpanel" }
    });

    this.chatPage = this.addChild(new ChatPage(
      this.app,
      this.chatContainerEl,
      {
        ...this.dependencies,
        openRecord: (record) => this.openRecord(record)
      },
      () => void this.switchPage("library")
    ));
    this.libraryPage = this.addChild(new LibraryPage(
      this.app,
      this.libraryContainerEl,
      this.dependencies
    ));
  }

  private async switchPage(page: DoudouPage): Promise<void> {
    this.activePage = page;
    const isChat = page === "chat";
    this.chatContainerEl.toggleClass("doudou-is-hidden", !isChat);
    this.libraryContainerEl.toggleClass("doudou-is-hidden", isChat);
    this.chatTabEl.toggleClass("doudou-is-selected", isChat);
    this.libraryTabEl.toggleClass("doudou-is-selected", !isChat);
    this.chatTabEl.setAttr("aria-selected", String(isChat));
    this.libraryTabEl.setAttr("aria-selected", String(!isChat));
    this.dependencies.repository.invalidateCache();
    await this.refreshActivePage(false);
  }

  private openRecord(record: StoredDoudouRecord): void {
    new RecordDetailModal(
      this.app,
      this.dependencies,
      record,
      async () => {
        this.dependencies.repository.invalidateCache();
        await Promise.all([
          this.chatPage.refresh(false),
          this.libraryPage.refresh(false)
        ]);
      }
    ).open();
  }

  private async refreshActivePage(manual: boolean): Promise<void> {
    this.dependencies.repository.invalidateCache();
    if (this.activePage === "chat") {
      await this.chatPage.refresh(manual);
    } else {
      await this.libraryPage.activate();
    }
  }

  private registerDataRefreshEvents(): void {
    const scheduleIfRelevant = (path: string, previousPath?: string): void => {
      if (
        !this.dependencies.repository.isDoudouPath(path) &&
        (!previousPath || !this.dependencies.repository.isDoudouPath(previousPath))
      ) {
        return;
      }
      this.dependencies.repository.invalidateCache();
      if (this.vaultRefreshTimer !== null) {
        window.clearTimeout(this.vaultRefreshTimer);
      }
      this.vaultRefreshTimer = window.setTimeout(() => {
        this.vaultRefreshTimer = null;
        void Promise.all([
          this.chatPage.refresh(false),
          this.libraryPage.refresh(false)
        ]);
      }, VAULT_REFRESH_DEBOUNCE_MS);
    };

    this.registerEvent(this.app.vault.on("create", (file) => {
      scheduleIfRelevant(file.path);
    }));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      scheduleIfRelevant(file.path);
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      scheduleIfRelevant(file.path);
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      scheduleIfRelevant(file.path, oldPath);
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      if (leaf === this.leaf) void this.refreshActivePage(false);
    }));
  }

  private registerViewportHandling(): void {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const syncViewport = (): void => {
      const rootTop = this.rootEl.getBoundingClientRect().top;
      const visibleBottom = viewport.offsetTop + viewport.height;
      const availableHeight = Math.max(0, visibleBottom - rootTop);
      this.rootEl.style.setProperty(
        "--doudou-visual-viewport-height",
        `${availableHeight}px`
      );
      if (this.activePage === "chat") this.chatPage.handleViewportChange();
    };

    viewport.addEventListener("resize", syncViewport);
    viewport.addEventListener("scroll", syncViewport);
    this.register(() => {
      viewport.removeEventListener("resize", syncViewport);
      viewport.removeEventListener("scroll", syncViewport);
    });
    syncViewport();
  }
}
