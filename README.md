# 兜兜（doudou）0.3.0-beta.1

兜兜是一款聊天式记录的 Obsidian 插件。你像发送消息一样写下内容，兜兜只负责把记录收好并给出简短状态反馈；它不是聊天机器人。

## 当前能力

- 在同一个 View 中切换“对话”和“资料”，两页共享同一套 Markdown 数据。
- 对话页使用轻量聊天输入区输入和发送多行记录，只加载最近 30 条资料。
- 每条记录必须选择且只能选择一个一级分类：生活、工作或副业。
- 一级分类对应 Vault 中真实的中文文件夹；编辑分类时 Markdown 会随之移动。
- 标签弹层动态汇总已有标签，也可以新建、选择和移除自由标签。
- 可选择单张或多张图片，也支持没有正文的纯图片记录。
- 图片保存在 Vault 内，聊天、资料列表和详情均可预览。
- 发送后在同一个左侧状态气泡中展示保存中、成功或失败状态；失败时可重新保存。
- 资料页浏览全部历史，支持正文/标签关键词搜索、一级分类筛选和多标签组合筛选。
- 记录详情支持显式编辑、取消和二次确认删除；删除内容移入 Obsidian 回收站。
- 可选使用 DeepSeek 在真实保存完成后生成不可见的 `ai_tags`，用于本地搜索增强。
- 聊天页的 Sparkles 按钮只让下一次发送进入“问兜兜”，回答基于本地候选记录且不持久化。
- 监听兜兜目录内的创建、修改、删除和重命名事件，并在切页、重新聚焦或手动刷新时读取真实数据。
- Windows、iOS 和 Android 响应式布局，包含安全区、触控尺寸和 Visual Viewport 软键盘适配。

## 数据位置

真实记录保存在当前 Vault 的独立目录：

```text
兜兜/
  生活/
    YYYY/
      MM/
        <记录>.md
  工作/
    YYYY/
      MM/
        <记录>.md
  副业/
    YYYY/
      MM/
        <记录>.md
  assets/
    YYYY/
      MM/
        <图片>
```

每个 Markdown 文件包含结构化 Frontmatter 和未经改写的正文。编辑后增加 `updated`；图片使用 Vault 相对路径；AI 隐藏标签与手动标签严格分离。修改一级分类时只移动 Markdown，图片继续保留在统一的 `兜兜/assets/YYYY/MM/` 中。

早期 Beta 使用的 `兜兜/YYYY/MM/*.md` 会继续被读取，不会在启动时批量迁移；只有实际编辑并保存某条旧记录时，该记录才会迁移到对应分类目录。聊天状态和“问兜兜”问答不会写入文件。

```yaml
---
id: "example-id"
created: "2026-08-17T08:00:00.000Z"
updated: "2026-08-17T09:15:00.000Z"
category: "生活"
tags: ["日记", "灵感"]
ai_tags: ["注意力", "使用习惯"]
images: ["兜兜/assets/2026/08/example-id-01.jpg"]
---
```

## 项目结构

```text
main.ts                         插件入口、View 注册与命令
src/constants.ts                固定分类、目录和 View 常量
src/types.ts                    核心数据类型
src/data/DoudouRepository.ts    Markdown 新增、读取、更新、删除与缓存
src/data/recordCodec.ts         兼容旧格式的 Markdown 编解码
src/attachments/ImageService.ts Vault 图片写入、唯一路径和回收
src/ai/DeepSeekClient.ts        跨平台 DeepSeek 请求与 JSON 校验
src/ai/AiTagService.ts          保存后的隐藏标签任务
src/ai/AskDoudouService.ts      本地候选检索与资料问答
src/services/RecordService.ts   Markdown 与附件事务协调
src/services/recordSearch.ts    内存搜索、问答评分、筛选和标签统计
src/settings/                   兜兜设置和 DeepSeek 配置
src/ui/DoudouView.ts            双页面外壳、刷新事件与 viewport 适配
src/ui/ChatPage.ts              聊天式录入与会话状态
src/ui/LibraryPage.ts           资料列表、搜索与筛选
src/ui/RecordDetailModal.ts     详情、编辑和删除确认
src/ui/TagPickerModal.ts        动态标签选择与新建
src/ui/ImagePreviewModal.ts     Vault 图片预览
styles.css                      仅使用 doudou- 前缀的界面样式
manifest.json                   Obsidian 插件清单
esbuild.config.mjs              构建配置
```

## 本地开发

要求 Node.js 18 或更高版本。

```bash
npm install
npm run typecheck
npm test
npm run build
```

持续构建：

```bash
npm run dev
```

## 在 Obsidian 中加载测试

1. 运行 `npm install` 和 `npm run build`。
2. 在测试 Vault 的 `.obsidian/plugins/` 下创建 `doudou` 目录。
3. 将本项目的 `manifest.json`、`main.js`、`styles.css` 复制到该目录。
4. 在 Obsidian 设置 → 第三方插件中关闭安全模式（如尚未关闭），刷新插件列表并启用“兜兜”。
5. 点击左侧栏的消息图标，或从命令面板执行“打开兜兜”。

建议只使用专门的测试 Vault 进行开发验证。

## 使用 BRAT 安装 Beta

1. 在 Obsidian 社区插件中安装并启用 BRAT。
2. 打开 BRAT，选择 **Add Beta Plugin**。
3. 输入 `https://github.com/sosoyyyyy/doudou`。
4. 安装完成后，在 Obsidian 的第三方插件列表中启用“兜兜”。

Windows 已完成本地测试。iOS 和 Android 以兼容为目标，尚待通过 BRAT 进行真机验证。

## DeepSeek 设置

在 Obsidian 设置 → 兜兜中单独填写 DeepSeek API Key、选择模型并测试连接。默认模型为 `deepseek-v4-flash`，自动隐藏标签默认开启；没有 Key 时静默跳过，不影响真实记录。

所有轻量请求都明确关闭 thinking。`ai_tags` 只参与搜索，绝不会出现在聊天、资料列表、详情、编辑或标签选择器中。

## 隐私与数据

兜兜的 Markdown 资料和图片只保存在用户自己的 Obsidian Vault，不会上传到本 GitHub 仓库。DeepSeek API Key 只保存在兜兜自己的本地插件设置中，也不会上传 GitHub。

## 当前范围

当前版本不包含图片识别、OCR、AI 自动分类、Embedding、向量数据库、外部图床、额外聊天数据库或发布流程。跨设备同步由用户现有的 Vault 同步方案负责。HEIC/HEIF 文件可以保存，但能否直接预览取决于对应平台的 Obsidian WebView。
