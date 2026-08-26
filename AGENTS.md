# doudou 项目长期协作规则

## 项目边界与隔离

1. 兜兜仓库仍然是默认项目开发边界，禁止主动扫描、搜索或读取其他项目及本机资源。
2. 但用户通过当前任务、当前会话或 Codex 附件机制明确提供的附件属于合法任务输入，即使实际路径位于项目根目录之外，也允许读取，包括 `.codex/attachments/` 临时目录中的文件。
3. 用户明确指定要求读取的某个项目外文件也允许读取。
4. 此授权只针对明确提供或指定的具体文件，不允许因此扫描附件所在目录、其他目录、其他项目、`.env`、API Key、secret 或无关私人文件。
5. 如发现明显属于其他项目且并非用户明确提供或指定的 remote、文件或配置，停止开发并报告；不得读取或复用其他项目的 API Key，也不自动迁移旧资料库数据。

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

## 三端 UI 与宿主样式

1. 所有界面修改默认同时考虑 Windows、iOS、Android，以及 Obsidian Desktop / Mobile 的宿主样式差异。
2. 兜兜自己的关键 `button`、`input`、`textarea`、`select`、卡片和滚动容器必须在 `.doudou-view` 作用域下使用足够明确的选择器，并显式约束宿主可能注入的尺寸、padding、line-height、overflow、white-space、appearance 与 display。
3. 不使用无作用域的全局控件选择器，不依赖 hover，不强制隐藏 Obsidian Mobile 自带工具栏，不用 `wheel` 事件手动模拟滚动。
4. 移动端必须保留 safe-area、Visual Viewport、触摸滚动、键盘适配、足够点击区域，并避免横向溢出。

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
3. 全部页按文字、meta、图片区排序，最多预览前 9 张；完整备忘录单图按原始比例预览，双图两列，三张及以上统一三列并显示全部图片。所有裁切仅用于缩略图，点击后仍完整显示原图。
4. 编辑取消不删除原图；只有 Markdown 保存成功后才移除被删图片。删除记录时 Markdown 与绑定图片进入 Obsidian 回收站。
5. 图片复制、分享、下载必须通过 Vault API 读取原始二进制；不得从裁切预览导出，不得使用 Node `fs`、设备绝对路径或未经用户触发的后台导出。

## 普通文件附件

1. 普通文件使用独立 `files` frontmatter 字段，与 `images` 分离，但物理存储继续共用 `兜兜/assets/YYYY/MM/`；不得自动拆分或迁移 assets 目录。
2. 文件只通过 Obsidian Vault API 保存、打开和回收，不解析 PDF、Office、压缩包、音视频内容，也不将文件内容发送给 AI。
3. 新选文件先停留在 UI pending 状态；取消不写 Vault，保存成功后才回收被移除的旧文件。删除记录必须处理 Markdown、images 和 files。
4. 修改 folder 只移动 Markdown，不移动 images 或 files；文件名可参与本地检索，二进制内容不参与搜索。

## AI 与 API Key

1. DeepSeek API 只能读取兜兜自己的插件设置；真实 API Key 不得进入源码、Markdown、README、日志、错误信息或 Git。
2. Markdown 保存永远优先于 AI hidden tags；AI 异步失败不得影响已经保存的真实记录。
3. 问兜兜不写入 Markdown、不建立聊天历史或数据库，回答只能基于真实记录，找不到依据时必须明确说明。
4. 旧 AI 回答不得作为后续资料来源；来源记录统一打开新版完整备忘录页面。
