# doudou 项目长期协作规则

## 项目边界与隔离

1. `doudou`（兜兜）是独立的 Obsidian 插件项目，当前项目根目录是唯一项目边界。
2. 不得扫描、读取、修改、引用、复用或依赖边界外其他项目的仓库、源码、配置、`.env`、API Key、数据、插件目录、Release、Actions 或构建产物。
3. 如发现明显属于其他项目的 remote、文件或配置，停止开发并报告。不得读取或复用其他项目的 API Key，也不自动迁移旧资料库数据。

## Git 与发布

1. 修改完成后先执行完整本地检查，至少包括 `npm run typecheck`、`npm test`、`npm run build`、`git diff --check`。
2. 检查全部通过后，允许提交、推送并发布 GitHub beta prerelease，供 BRAT 在 Windows、iOS、Android 真机测试；用户不再手动复制插件文件。
3. beta 可连续迭代，但不得未经用户实际测试并明确确认就发布正式版本。
4. 发布前确认 `manifest.json`、`package.json`、`versions.json`、tag 与 Release 版本一致，并上传 BRAT 所需的 `main.js`、`manifest.json`、`styles.css`。
5. 不创建 PR，沿用当前仓库既有直接发布流程；发布失败时先核实 commit、tag、Release 和 assets 状态，不重复创建。

## 产品与数据原则

1. 兜兜定位为带 AI 检索能力的图文备忘录 / 私人资料库，不再以聊天气泡作为主要界面。
2. “全部”是手记式时间流，负责翻看；“资料”是文件夹体系，负责整理和查找；顶部“兜”是临时 AI 检索工具。
3. Markdown 文件是真实数据源。“全部”和“资料”只渲染同一批记录，不建立聊天数据库、时间流缓存文件或第二份 UI 数据源。
4. 默认功能克制、移动端优先，并将 UI、数据存储、服务与类型分离。

## 文件夹与资料目录

1. 用户可自由创建、改名和删除文件夹；`生活`、`工作`、`副业`只是旧默认文件夹，不再是固定分类。
2. 新记录路径固定为 `兜兜/<folder>/YYYY/MM/*.md`。`全部资料`是虚拟系统文件夹，不创建真实目录。
3. 图片始终位于 `兜兜/assets/YYYY/MM/`，不随 folder 改变；修改 folder 只通过 Obsidian Vault API 安全移动 Markdown。
4. Repository 必须兼容读取 `兜兜/YYYY/MM/*.md` legacy 记录，不在启动时迁移；只有用户实际编辑保存时才迁移到指定 folder。
5. 读取 frontmatter 时优先 `folder`，缺失时兼容旧 `category`；用户实际保存后写新版 `folder`。
6. 扫描排除 `兜兜/assets/`，只解析真实 `.md` 记录。移动失败不得删除原文件或遗留重复文件。
7. 非空文件夹禁止直接删除；不得自动批量删除或移动其中记录。

## 标签

1. 手动标签来自正文中显式输入的 `#标签`；正文保留原文，保存时同步提取并去重写入 `tags`。
2. AI 隐藏标签写入 `ai_tags`，与 `tags` 严格分离。
3. `ai_tags` 永远不出现在全部页、资料页、文件夹页、卡片、完整备忘录、编辑页、手动标签或筛选 UI，但允许参与本地搜索和问兜兜检索。

## 图片

1. 图片是 Vault 内真实资料的一部分，不使用外部图床或 Base64，不保存设备绝对路径。
2. 图片只通过 Obsidian Vault API 管理，不使用 Node `fs`，确保 Windows、iOS、Android 兼容。
3. 全部页可使用裁切大预览，文件夹页使用裁切小缩略图；完整备忘录默认按原始宽高比完整显示，不裁切。
4. 编辑取消不删除原图；只有 Markdown 保存成功后才移除被删图片。删除记录时 Markdown 与绑定图片进入 Obsidian 回收站。

## AI 与 API Key

1. DeepSeek API 只能读取兜兜自己的插件设置；真实 API Key 不得进入源码、Markdown、README、日志、错误信息或 Git。
2. Markdown 保存永远优先于 AI hidden tags；AI 异步失败不得影响已经保存的真实记录。
3. 问兜兜不写入 Markdown、不建立聊天历史或数据库，回答只能基于真实记录，找不到依据时必须明确说明。
4. 旧 AI 回答不得作为后续资料来源；来源记录统一打开新版完整备忘录页面。
