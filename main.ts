import { Plugin, WorkspaceLeaf } from "obsidian";
import { AiTagService } from "./src/ai/AiTagService";
import { AskDoudouService } from "./src/ai/AskDoudouService";
import { DeepSeekClient, DeepSeekError } from "./src/ai/DeepSeekClient";
import { ImageService } from "./src/attachments/ImageService";
import { FileService } from "./src/attachments/FileService";
import { DOUDOU_VIEW_TYPE } from "./src/constants";
import { DoudouRepository } from "./src/data/DoudouRepository";
import { RecordService } from "./src/services/RecordService";
import { FolderService } from "./src/services/FolderService";
import { VaultFolderOrderStore } from "./src/services/VaultFolderOrderStore";
import { DoudouSettingTab } from "./src/settings/DoudouSettingTab";
import { DEFAULT_SETTINGS, normalizeSettings } from "./src/settings/settings";
import type { DoudouSettings } from "./src/types";
import { DoudouView } from "./src/ui/DoudouView";

interface AppWithSettings {
  setting?: {
    open(): void;
    openTabById(id: string): void;
  };
}

export default class DoudouPlugin extends Plugin {
  settings: DoudouSettings = { ...DEFAULT_SETTINGS };

  private async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(DOUDOU_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf(true);
      await leaf.setViewState({ type: DOUDOU_VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  override async onload(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
    const repository = new DoudouRepository(this.app.vault);
    const imageService = new ImageService(this.app.vault);
    const fileService = new FileService(this.app.vault);
    const recordService = new RecordService(repository, imageService, fileService);
    const folderService = new FolderService(
      repository,
      new VaultFolderOrderStore(this.app.vault),
      () => this.settings.folderOrder,
      async () => {
        if (this.settings.folderOrder.length === 0) return;
        this.settings.folderOrder = [];
        await this.saveSettings();
      }
    );
    const clientProvider = (): DeepSeekClient | null => this.createDeepSeekClient();
    const aiTagService = new AiTagService(
      repository,
      clientProvider,
      () => this.settings.autoAiTags
    );
    const askService = new AskDoudouService(repository, clientProvider);

    this.registerView(
      DOUDOU_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new DoudouView(leaf, {
        repository,
        folderService,
        recordService,
        imageService,
        fileService,
        aiTagService,
        askService,
        openSettings: () => this.openSettings()
      })
    );
    this.addSettingTab(new DoudouSettingTab(this));

    this.addRibbonIcon("message-circle", "打开兜兜", () => {
      void this.activateView();
    });
    this.addCommand({
      id: "open-doudou",
      name: "打开兜兜",
      callback: () => void this.activateView()
    });
    this.addCommand({
      id: "open-doudou-settings",
      name: "打开兜兜设置",
      callback: () => this.openSettings()
    });
  }

  override onunload(): void {
    this.app.workspace.detachLeavesOfType(DOUDOU_VIEW_TYPE);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async testDeepSeekConnection(): Promise<void> {
    const client = this.createDeepSeekClient();
    if (!client) {
      throw new DeepSeekError("missing-key");
    }
    await client.testConnection();
  }

  openSettings(): void {
    const setting = (this.app as typeof this.app & AppWithSettings).setting;
    if (!setting) return;
    setting.open();
    setting.openTabById(this.manifest.id);
  }

  private createDeepSeekClient(): DeepSeekClient | null {
    const apiKey = this.settings.deepSeekApiKey.trim();
    if (!apiKey) return null;
    return new DeepSeekClient(apiKey, this.settings.deepSeekModel);
  }
}
