# 兜兜（doudou）0.4.0-beta.1

兜兜是一款带 AI 检索能力的图文备忘录 / 私人资料库 Obsidian 插件。Markdown 是唯一真实数据源；界面围绕“全部负责翻看、资料负责整理和查找、兜负责 AI 检索”组织。

## 当前能力

- “全部”以月份、日期和大卡片组成手记式时间流，显示全部记录。
- “资料”以文件夹为首页；`全部资料`是虚拟系统文件夹，普通文件夹可自由新建、改名、删除。
- 顶部 `＋` 新建备忘录，支持可选标题、正文、多图和所属文件夹。
- 正文中的 `#标签` 会原样保留，并在保存时提取到 `tags`；中文、英文、数字和混合标签均受支持。
- 点击任意卡片或 AI 来源进入同一套完整备忘录页面，默认阅读、图片完整显示，并可编辑、复制全文或删除。
- 顶部“兜”打开临时 AI 检索工具，回答只基于真实记录，不持久化问答。
- 顶部同步按钮继续调用 Remotely Save 的“开始同步”命令。
- 可选 DeepSeek hidden tags 在真实保存完成后异步生成；失败不影响 Markdown 保存。
- Windows、iOS、Android 响应式布局保留 Visual Viewport、安全区与触控适配。

## 数据位置与兼容

```text
兜兜/
  <folder>/
    YYYY/
      MM/
        <记录>.md
  assets/
    YYYY/
      MM/
        <图片>
```

`生活`、`工作`、`副业`现在只是普通的旧默认文件夹。新记录使用自由 `folder`：

```yaml
---
id: "example-id"
title: "可选标题"
created: "2026-08-23T08:00:00.000Z"
updated: "2026-08-23T09:15:00.000Z"
folder: "喵布小铺"
tags: ["淘宝", "定价"]
ai_tags: ["商品定价", "亚克力周边"]
images: ["兜兜/assets/2026/08/example-id-01.jpg"]
---

#淘宝 #定价

7cm 亚克力立牌还是准备卖 13.9。
```

读取时优先使用 `folder`，缺失时兼容旧 `category`。早期 `兜兜/YYYY/MM/*.md` 继续读取且不会在启动时批量迁移；只有用户真正编辑保存时才迁移到指定文件夹。修改文件夹只移动 Markdown，图片路径保持不变。

## 项目结构

```text
main.ts                         插件入口、View 注册与命令
src/data/DoudouRepository.ts    记录与文件夹的新增、读取、移动、删除和缓存
src/data/recordCodec.ts         新旧 Frontmatter 编解码与正文标签提取
src/attachments/ImageService.ts Vault 图片写入、唯一路径和回收
src/services/RecordService.ts   Markdown 与附件事务协调
src/services/recordSearch.ts    title/content/folder/tags/ai_tags 搜索与 AI 候选评分
src/ai/                         DeepSeek、hidden tags 与问兜兜
src/ui/AllPage.ts               手记式全部时间流
src/ui/LibraryPage.ts           文件夹首页、文件夹内容和搜索
src/ui/RecordPage.ts            完整阅读、新建和编辑页面
src/ui/ToolModals.ts            问兜兜与文件夹管理临时工具
styles.css                      移动端优先的蓝白界面
```

## 本地开发

要求 Node.js 18 或更高版本。

```bash
npm install
npm run typecheck
npm test
npm run build
git diff --check
```

## 使用 BRAT 安装 Beta

1. 在 Obsidian 社区插件中安装并启用 BRAT。
2. 选择 **Add Beta Plugin**。
3. 输入 `https://github.com/sosoyyyyy/doudou`。
4. 安装后在第三方插件列表中启用“兜兜”。

Beta Release 必须包含 `main.js`、`manifest.json`、`styles.css`。`0.4.0-beta.x` 用于 Windows、iOS、Android 真机验证；未经明确验收不会发布正式 `0.4.0`。

## 隐私与 AI

Markdown 和图片只保存在用户自己的 Vault。DeepSeek API Key 仅保存在兜兜自己的插件设置中，不会上传到 GitHub。`ai_tags` 只参与本地搜索和问兜兜检索，不在普通 UI 中展示；问答不会写入资料。
