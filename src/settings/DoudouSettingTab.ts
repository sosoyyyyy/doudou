import { PluginSettingTab, Setting } from "obsidian";
import type DoudouPlugin from "../../main";
import { deepSeekErrorMessage } from "../ai/DeepSeekClient";

export class DoudouSettingTab extends PluginSettingTab {
  constructor(private readonly doudouPlugin: DoudouPlugin) {
    super(doudouPlugin.app, doudouPlugin);
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("doudou-settings");
    containerEl.createEl("h2", { text: "兜兜" });
    containerEl.createEl("h3", { text: "DeepSeek" });

    new Setting(containerEl)
      .setName("DeepSeek API Key")
      .setDesc("只保存在兜兜自己的插件设置中，不写入资料 Markdown。")
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.autocomplete = "off";
        text
          .setPlaceholder("sk-••••••••••")
          .setValue(this.doudouPlugin.settings.deepSeekApiKey)
          .onChange(async (value) => {
            this.doudouPlugin.settings.deepSeekApiKey = value.trim();
            await this.doudouPlugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("模型")
      .setDesc("轻量标签与资料问答使用的 DeepSeek 模型。")
      .addDropdown((dropdown) => dropdown
        .addOption("deepseek-v4-flash", "DeepSeek V4 Flash")
        .addOption("deepseek-v4-pro", "DeepSeek V4 Pro")
        .setValue(this.doudouPlugin.settings.deepSeekModel)
        .onChange(async (value) => {
          this.doudouPlugin.settings.deepSeekModel = value === "deepseek-v4-pro"
            ? "deepseek-v4-pro"
            : "deepseek-v4-flash";
          await this.doudouPlugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("自动生成 AI 隐藏标签")
      .setDesc("真实记录保存完成后在后台生成；失败不会影响记录。")
      .addToggle((toggle) => toggle
        .setValue(this.doudouPlugin.settings.autoAiTags)
        .onChange(async (value) => {
          this.doudouPlugin.settings.autoAiTags = value;
          await this.doudouPlugin.saveSettings();
        }));

    const testStatus = containerEl.createDiv({
      cls: "doudou-settings-status",
      attr: { role: "status" }
    });
    new Setting(containerEl)
      .setName("测试 DeepSeek 连接")
      .setDesc("发送一次最小请求验证当前 Key 和模型。")
      .addButton((button) => button
        .setButtonText("测试连接")
        .onClick(async () => {
          button.setDisabled(true);
          testStatus.setText("正在连接...");
          try {
            await this.doudouPlugin.testDeepSeekConnection();
            testStatus.setText("连接成功");
          } catch (error) {
            testStatus.setText(deepSeekErrorMessage(error));
          } finally {
            button.setDisabled(false);
          }
        }));
  }
}
