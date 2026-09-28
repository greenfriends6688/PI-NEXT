# PI-Desktop 逐项对比与借鉴清单（导入 / 项目归档 / 模型高级参数 / 文件查看器性能 / PWA 布局）

分析日期：2026-09-24
基准：本仓库 `pi-codex`（Next.js App Router + 进程内 pi SDK + Electron 打包 + PWA）
对象：`pi参考项目/PI-Desktop-main`（PI-Desktop **0.15.x**，Electron main + Rust `host-core` sidecar + React renderer，321 份 ADR）

> 本文回答一个问题：**照着 PI-Desktop 读一遍代码，它的「导入」「项目归档」「模型高级设置」「文件查看器」到底是怎么做的，哪些能搬、搬到哪个文件、多大代价、会不会撞我们自己的纪律。**
> 落地项在 §3 的 `PD-01…PD-22`，PR 拆分在 §5，PWA 专项在 §6，交付记录在 §8。
> 文件查看器的目标形态（**只保留源码 / 预览两个模式**）在 §2。

---

## 0. 先看清形态差异，别照抄

| 维度 | 本仓库 | PI-Desktop | 对本文的约束 |
| --- | --- | --- | --- |
| 形态 | Next.js Web（浏览器 + PWA + Electron 壳） | 原生桌面三进程 | 它靠「主进程 + Rust sidecar」做的重活，我们只能放在 **Route Handler** 里，且不能阻塞渲染 |
| 数据归属 | **pi SDK 的文件**：`~/.pi/agent/*` 是唯一真源 | 自己的 SQLite（`~/.pi-desktop/pi.sqlite`） | 数据模型不能抄。它能把项目组、归档、记忆写进自己的库；我们只能写 pi 认识的文件 + 自己的 localStorage |
| 撤销/回滚 | 会话 `.jsonl` 可整文件重写（只 `parentSession` 是展示元数据） | SQLite 事务 | 写操作要按「幂等 + 可重复执行」设计 |
| 面板模型 | React SPA，右面板 = 组件树 | 插件视图 = 独立 `WebContentsView` | §1.4 的性能手法里，**「视图保活」我们已经有了**（tab 级），缺的是编辑器那一半 |
| 进程 | 单进程 Node（Next） | 主进程 + sidecar + 插件进程 | 扫描类操作必须显式设上限，否则卡的是整个 Web 服务 |

**结论先行**：四条线索里，**文件查看器性能**和 **PWA 布局**是「我们现在就疼」的，先做；**导入**是最大的新增面，价值最高但工期最长；**项目归档**和**模型高级参数**我们已经有 60–70% 的地基，属于补齐。

---

## 1. 四条线索的现状差距

### 1.1 导入（设置 → 工作区 → 导入）

| 能力 | PI-Desktop | 本仓库 | 差距 |
| --- | --- | --- | --- |
| 扫描别的 Agent 的**会话** | claude / codex / opencode / pi 四源 | ❌ 完全没有 | 全新 |
| 扫描**技能** | `~/.claude/skills/`、`<proj>/.claude/skills/`、`~/.agents/skills/`、`<proj>/.agents/skills/` | ⚠️ 只有 `npx skills add` 装**线上**技能 | 缺本地扫描 |
| 扫描 **MCP** | 7 行来源：Claude Desktop / Claude Code / Cursor 全局+项目 / Codex TOML / OpenCode / ChatGPT(占位) | ❌ 完全没有 | 全新 |
| 扫描**模型/凭据** | 5 源：claude settings / opencode+auth.json / codex TOML / pi models.json / cc-switch SQLite | ❌ 完全没有 | 全新 |
| 扫描**最近项目** | 无（项目来自会话） | ✅ **已有**：`lib/recent-projects.ts`（vscode / zed / claude / codex / opencode 五源，含 SQLite 读取） | **这是现成的地基**，见 PD-12 |
| 设置 UI | 4 个分段 tab，全部常驻，扫描结果跨 tab 保留 | ❌ 无 | 全新 |

**关键发现（可直接复用）**：`lib/recent-projects.ts`（387 行）已经在读 `~/.claude/history.jsonl`、`~/.codex/sessions/**`、Zed/OpenCode 的 SQLite、五个 VS Code 系产品的 `storage.json`，并且已经处理了 `file://` URI 归一化、路径归一化、去重排序、`loadSqlite()` 懒加载。**导入扫描器应当沿用它的路径约定与归一化函数，而不是新写一套。**

### 1.2 项目归档（设置 → 项目归档）

| 能力 | PI-Desktop | 本仓库 | 差距 |
| --- | --- | --- | --- |
| 项目实体 | host 自有 `projects` 表 + `kv` 里的多文件夹「项目组」 | 项目 = 会话 cwd 去重（`lib/project-groups.ts`；`/api/recent-projects`） | 我们**没有项目实体**，只有派生视图 |
| 归档粒度 | **项目级**（`projectMeta[path].archived`，localStorage，纯展示） | **会话级**（`lib/session-flags.ts`，localStorage，纯展示） | 缺项目级 |
| 归档页 | 设置 → 项目归档：列表 + 就地展开的检查器，分 `置顶 / 项目 / 已归档` 三段 | ✅ 设置 → 归档历史（`components/ArchivedSessionsPanel.tsx`，会话级、按项目分组） | 缺项目级索引与检查器 |
| 删除语义 | 级联删会话 + 删记忆，**绝不动磁盘目录**；运行中的会话拒绝删（1008） | 无项目级删除 | 缺（且必须沿用「不动磁盘」纪律） |
| 多文件夹项目 | 一组 root + 主 root + 每个 root 的会话归属 | 有 worktree 分组（`lib/worktree.ts`），无多 root | 不强求，worktree 已覆盖主要痛点 |
| 指令链 | 全局 → 文件系统链 → 组指令 → 记忆（每层带标签 + 32KiB 上限） | `AGENTS.md` 项目路由（`/api/project-trust`） | 不在本轮 |

**复用点**：`SessionSidebar` 已经有「项目行 + 归档区默认折叠 + 右键取消归档」的完整交互，`ArchivedSessionsPanel` 已经有「按项目分组 + 显示归档时间 + 恢复」的实现。项目级归档应当是**同一套 localStorage 纪律 + 同一套 UI 语言的向上提炼**，不是新体系。

### 1.3 模型高级参数（`components/ModelsConfig.tsx`，2547 行）

| 能力 | PI-Desktop | 本仓库 | 差距 |
| --- | --- | --- | --- |
| 上下文窗口 / 最大输出 | ✅ + **预设 chips**（128k/256k/312k/500k/1M、4k/8k/16k/32k/128k） | ✅ 只有自由数字输入（`ModelsConfig.tsx:1387-1394`） | 缺快填 |
| 覆盖来源标记 | ✅ `contextWindowSource: "catalog" \| "user"`，UI 有「跟随目录」提示 | ❌ 无 | 缺 |
| 模型别名 | ✅ `alias ≤ 60 字符`（ADR 0192） | ✅ `name` 字段已存在（pi 的等价物） | 已够用 |
| 思考级别 | ✅ 7 档勾选 + 默认档 | ✅ `reasoning` + `thinkingLevelMap` | 语义不同（它是 capability 列表，我们是线映射），**已够用** |
| 三态能力覆盖 | ✅ `supportsImages/supportsDocuments: true\|false\|null` | ✅ `input: ["image"]` | 已够用 |
| 原生联网搜索 | ✅ `nativeWebSearch`（仅 responses / anthropic_messages 生效） | ❌ 无 | **真实缺口** |
| Header 编辑 | ✅ 键值行 + 预设 + JSON 导入导出 + 保留字屏蔽（ADR 0178） | ✅ `HeaderListEditor`（`ModelsConfig.tsx:867`） | 已够用 |
| 保存前校验 | ✅ 客户端 + host 双层（URL、别名长度、header 长度/保留字） | ⚠️ 部分 | 缺校验反馈 |
| 高级面板组织 | ✅ 每模型一个 `Advanced` 折叠，首行默认展开 | ✅ `model-advanced-settings` 折叠（`ModelsConfig.tsx:1435-1467`） | 已够用 |
| 定价 | ✅ 解析 models.dev 全量 cost（含 200k 分层） | ✅ `models-config/catalog` 已拉 models.dev 预设 | 已够用 |

**结论：模型这块我们已经有 70%。** 真正要补的只有三件：**预设 chips**（PD-16）、**覆盖来源标记**（PD-17）、`nativeWebSearch`（PD-18），外加一次**校验反馈**（PD-19）。不要重写这个弹窗。

### 1.4 文件查看器：切换预览/源码/Diff 为什么卡

> ⚠️ **先纠正一个前提**：PI-Desktop 的文件查看器**没有 diff 模式**。 它的模式是 `source`（CodeMirror 编辑器）/ `markdown` / `table`（CSV）/ `tree`（JSON）—— 见 `pi.file-manager/manifest.json` 与 `README.md:12-19`。 Diff 在**另一个界面**（Review 页 / 聊天里的变更卡片），而且是 **Rust 在工具写入时预先算好的**（`crates/host-core/src/review.rs:1-6`：「Review evidence is captured at tool execution time instead of being reconstructed from a mutable git working tree」），渲染端只做纯函数解析 + 折叠展开。 所以「它切换快」不能直接套到我们的三态切换上，但**原理可以**，见下。

#### 实测数据（本机，2026-09-24）

```
components/SessionSidebar.tsx   3022 行 129KB → Prism 分词 159ms, 18616 token span + 3022 行 span
components/FileViewer.tsx       2847 行 107KB → Prism 分词 126ms, 16481 token span + 2847 行 span
app/globals.css                 3081 行  85KB → Prism 分词  31ms,  8457 token span + 3081 行 span
parseUnifiedPatch + diffIntraline（378 组改动 / 3022 行 patch）→ 4.3ms
```

#### 根因

最初以为是「三元链卸载重挂」这一族（下面第 1–5 条），但 **CDP 采样 + 分阶段 DOM 计时把真正的头号原因推翻了**，见第 6 条。

1. **三态是三元链，不是并存** —— `components/FileViewer.tsx:2731-2813`，`diff / html / markdown 编辑器 / markdown 预览 / CSV 预览 / 不支持卡片 / 轻量源码 / 高亮源码` 里**同一时刻只挂载一个**。`displayMode` 一变就是「卸载 + 重挂」。
2. **重挂 = 挂载期缓存清零** —— `MarkdownFilePreview` 的 `useMemo(..., [content])`（`MarkdownFilePreview.tsx:114-116`）随挂载存亡，切走就没。
3. **回到源码要重新 Prism** —— `highlightedSource` 的 `useMemo`（`FileViewer.tsx:2250-2260`）保住了元素对象，但组件实例已卸载，`LazyFileSourceView` 重挂就会重跑 Prism（>1000 行走 `SOURCE_HIGHLIGHT_MAX_LINES = 1_000` 的轻量路径，但 1000 行以内正好是最常见的情况）。
4. **`DiffView` 每次渲染都重算 diff** —— `FileViewer.tsx:415-417`：`const diff = diffLines(patch);` 直接写在函数体里，没有 `useMemo`。
5. **git diff 是「打开文件就取」而不是「打开 diff 才取」** —— `FileViewer.tsx:1929-1931` 每个文件挂载都 `fetchGitDiff`，watch 的 `synchronize()`（`:1901`）每次文件变化再取一次；而 `getGitFileDiff()`（`lib/git-changes.ts:294`）每次**起一个 git 进程 + 完整读一遍文件**。

6. ⚠️ **真正的头号原因：`.md` 的预览态根本不是 `MarkdownFilePreview`，而是 ProseMirror 富文本编辑器。**

   旧代码（`FileViewer.tsx:1990`）：
   ```js
   const liveEditing = … && ((isMarkdown && ext === "md" && mode === "preview")
                                || (isCodeText && mode === "source"));
   ```
   `liveEditing` 挂在三元链**上半部**，优先级高于三个 stage。于是进预览 → 挂载 `MarkdownFileEditor` → `EditorState.create({ doc: codec.parse(整篇) })`（`MarkdownFileEditor.tsx:247`）；切到源码 → `liveEditing` 变假 → **整个编辑器卸载**；切回预览 → **重建整个 ProseMirror 文档**。

   实测（`AGENTS.md`，27KB / 318 行）：**每一次**进预览都是 **~1700ms 的主线程阻塞**，warm 与 cold 一模一样——因为每次都真的在重建。这解释了为什么第一版 keep-alive 完全没效果：**保活的那条链根本没被走到**。

   这条也是 §2 要改成两态的直接依据。

#### 修完之后的实测（同一套脚本，本机）

```
                 修复前        修复后
cold Preview     1708ms   →    262ms
warm Preview     1717ms   →    217ms
warm Source       283ms   →    217 / 133ms
warm Diff         183ms   →    150 / 233ms
源 stage DOM    切走就丢   →   常驻（318 行 `.file-source-line` 始终在 DOM 里）
git diff 请求    2/次切模式 →   2/整个会话
```

剩下 ~180–230ms 已无单一热点：CDP 采样里占比最高的是 `getBoundingClientRect`（~12%，选词/定位的回调链）加 react-dom 对 FileViewer + AppShell 子树的调和。继续压需要动 AppShell 的 state 边界（切模式时 `saveFileViewerState → setFileTabs` 会让整棵 AppShell 重渲），即 PD-05。

**但 §2 的两态化会把这条链整个删掉**——预览态不再是编辑器，重建 ProseMirror 这条路不存在了。

#### PI-Desktop 真正值得抄的四条

1. **一个编辑器实例，模式之间只切&#x20;**`display:none` —— 插件 bundle 里 `k9` 组件：CodeMirror 在 `useEffect(..., [])` 里建**一次**；预览开启时 `cmHost.style.display = "none"`，回到源码只调一次 `view.requestMeasure()`。**永不卸载、永不重建。**

2. **文档用&#x20;**`loadToken`**&#x20;认身份，只装载一次** —— `hasDoc !== file.loadToken && setDocument(...)`。dirty / saving / 主题变化导致的 re-render 不会重装文档。

3. **预览文本取自编辑器当前缓冲，不是重新读盘** —— 切模式不产生任何 IO。

4. **解析结果按 text 值 memo + 分页/硬上限** —— CSV `useMemo(parseCsv(text))` + 1000 行/页，JSON 树默认 2 层 / 每节点 100 键 / 字符串 160 字符截断。**它没有虚拟列表、没有 Worker、没有 WASM**——快是用「上限 + 内存里留着」买来的。

***

## 2. 文件查看器：只保留两个模式（源码编辑 / 预览）

### 2.1 为什么是两态

现状是三个并列模式（`source | preview | diff`），实际上这是**两个正交的东西被塞进了同一个切换器**：

| | 它真正是什么 | 生命周期 |
| --- | --- | --- |
| 源码 / 预览 | **同一份文件的两种看法**（编辑 vs 阅读） | 跟着「用户此刻在做什么」来回切 |
| Diff | **一次针对 HEAD 的对比查询** | 由入口决定（Git 变更面板 / Git 图谱），不是一种「看法」 |

把 Diff 当第三个 tab 有三个代价：① 切换器变三态，每次都要多扫一眼；② `diff` 按钮的可见性依赖 `hasGitDiff`——**要先发一次 git 请求才知道该不该显示它**，于是「打开文件」被绑上了一个 git 进程；③ 已删除的文件（`isDeletedDiff`）只剩 diff 一个模式，切换器长度变成 1，形状不一致。

参考实现就是两态：`pi.file-manager/README.md:13` ——「打开 `.md` / `.markdown` / `.mdx` 时，工具栏出现**「编辑 / 预览」**切换」，diff 在另一个界面（Review 页，且是写入时预先算好的）。

### 2.2 目标形态

```
┌─ 工具栏 ─────────────────────────────────────────────────────┐
│ components/FileViewer.tsx   tsx · 2847 lines · 107 KB        │
│                        [ 源码 │ 预览 ]          ⤢  @  ↓      │  ← 两态 seg control
└──────────────────────────────────────────────────────────────┘

源码 = CodeMirror 6（`CodeFileEditor`）—— **唯一写入口**
预览 = 只读渲染：markdown → `MarkdownFilePreview`；html → iframe；csv/tsv → `CsvPreview`

从 Git 变更面板 / Git 图谱进来时（含已删除的文件）：
┌─ 正在对比 HEAD ──────────────────────────────── [返回源码] ─┐
│ <DiffView patch={…} />                                        │
└───────────────────────────────────────────────────────────────┘
```

### 2.3 两个模式各自的表面（含两处行为变化）

| 文件类型 | 源码 | 预览 |
| --- | --- | --- |
| `.ts/.tsx/.js/.jsx/.json/.css/.html/…` | `CodeFileEditor`（同现状） | 无 → 切换器不出现 |
| `.md` | `CodeFileEditor`（**行为变化：现在是只读 Prism 视图**） | `MarkdownFilePreview`（**行为变化：现在是 ProseMirror 富文本编辑器**） |
| `.html` | `CodeFileEditor` | iframe |
| `.csv/.tsv` | `CodeFileEditor` | `CsvPreview` |

两处行为变化的共同点是**把「编辑」集中到源码模式、把「预览」还原成只读**。三个直接好处：

1. **干掉本周最疼的性能问题**。`.md` 的预览态现在是 ProseMirror 富文本编辑器，每次进入都要 `EditorState.create({ doc: codec.parse(整篇) })`——27KB 实测 **\~1.7s**。预览变成只读渲染后，这条路径整个不存在。

2. **只剩一个写入口**。两个编辑器同时挂在同一文件的挂载树上时，「谁拥有文档 / 谁负责保存 / 外部改动先通知谁」会变成一个需要仔细设计的并发问题：两个 `useTextFile` 实例各自 watch（SSE）+ 各自 debounce save，会互相触发外部改动、来回打架。只留一个编辑器，这个问题不存在。

3. `.md`**&#x20;的源码模式终于能编辑了**。现在 `isCodeText = isEditableTextPath(path) && !isMarkdown`，所以 `.md` 的源码模式是**只读**的——想改一行字必须进「预览」用所见即所得。而所见即所得改代码块、表格、长列表本来就别扭。

代价：**去掉所见即所得编辑**。要保留的话见 §2.8。

### 2.4 Diff 怎么保留（三个入口一个都不能丢）

现存 diff 入口有 3 处，两态化时必须逐一接住：

| 入口 | 位置 | 现状 |
| --- | --- | --- |
| Git 变更面板点文件 | `components/FileExplorer.tsx:839` | `onOpenFile(…, { modeHint: "diff" })` |
| Git 图谱点提交里的文件 | `components/AppShell.tsx:3111` | `onOpenFile(…, { modeHint: "diff" })` |
| 已删除的文件 | `FileViewer.tsx` 的 `isDeletedDiff` | `displayModes = ["diff"]` |

新模型：**diff 不是模式，是入口带进来的一个「对比视图」**，用一个独立 prop 驱动（如 `diffTarget: { kind: "head" } | null`），渲染在源码/预览之上，带一条返回横幅，不占切换器。

* 点「返回源码」→ 清掉 `diffTarget` → 回到源码模式。

* **已删除的文件没有内容可编辑**：此时源码模式渲染「文件已删除」空态（而不是切换器消失、面板空白），diff 视图默认打开。

* `viewerState.displayMode` 不再持久化 `"diff"`（见 §2.6）。

### 2.5 状态与类型契约

```ts
// lib/file-viewer-state.ts
- export type FileViewerDisplayMode = "source" | "preview" | "diff";
+ export type FileViewerDisplayMode = "source" | "preview";
```

**不重命名&#x20;**`"source"`。这个值是**按 tab 持久化**的（`components/file-tab-state.ts` → `viewerState.displayMode` → workspace restore），为了「源码」这个名字去改一个持久化的枚举值，只会换来一次没必要的迁移。文案改在 `DISPLAY_MODE_LABELS` 里就够。

配套：
* `normalizeDisplayMode(value)`：历史值 `"diff"` → `"source"`（并让调用方打开 diff 视图）。

* `initialDisplayMode` / `modeHint` 的 `"diff"` 走 `diffTarget`，联合类型收窄成 `"preview"`。

### 2.6 兼容与迁移

* **旧 tab 状态**：`FileViewerState.displayMode === "diff"` 是已落盘的数据。读到它 → 按 `"source"` 渲染 + 打开该文件的 diff 视图。用户看到的效果与升级前一致。

* `modeHint`：`AppShell.tsx:1357,1371,1418,3111`、`FileExplorer.tsx:704,839`、`ExplorerPanel.tsx:96` 的类型与调用点要一起改。

* **契约测试**：`components/FileViewer.state.test.mjs:48-49`（`displayMode: requestedInitialDisplayMode`、`viewerStateRef.current.displayMode = …`）与 `components/FileViewer.test.mjs` 的模式断言都会跟着变。

### 2.7 代码影响清单

**必改**

| 文件 | 改什么 |
| --- | --- |
| `lib/file-viewer-state.ts` | 联合类型去掉 `"diff"`；加 `normalizeDisplayMode()` |
| `components/FileViewer.tsx` | `DISPLAY_MODE_LABELS` 去掉 Diff；`mountedStages` 收成两态；`useMarkdownEditor` 整条分支删掉、预览接 `MarkdownFilePreview`；`hasGitDiff` / `isDeletedDiff` 改由 `diffTarget` 驱动；新增 diff 返回横幅与「文件已删除」空态 |
| `components/AppShell.tsx` | `modeHint` 类型与传参：`"diff"` → `diffTarget`（4 处） |
| `components/FileExplorer.tsx` | 同上（Git 变更面板，2 处） |
| `components/ExplorerPanel.tsx` | 同上（props 类型） |
| `components/FileViewer.test.mjs`、`components/FileViewer.state.test.mjs` | 模式相关的契约断言 |
| `e2e/file-viewer-modes.mjs` | 两态版本：只断言「源码 / 预览」两个按钮；diff 走入口断言 |

**删除**

| 文件 / 位置 | 为什么 |
| --- | --- |
| `components/MarkdownFileEditor.tsx`（505 行） | 预览不再所见即所得 |
| `components/MarkdownEditorBoundary.tsx` | 只服务于上面那个 dynamic chunk |
| `components/markdown-editor.css` | 同上 |
| `components/FileViewer.tsx` 的 `isEditing` 整条链：textarea、`saveMarkdown`、`handleEditorKeyDown`、`draftContent`、`draftDirty`、`EDIT_MAX_BYTES` | **本来就是死代码**：`setIsEditing(true)` 在全仓不存在 |
| `lib/markdown-editor.ts` 里只有 WYSIWYG 用的导出（`markdownSchema`、`markdownChanges`、`MarkdownCodec` 的 parse/serialize 部分） | 跟随编辑器一起走；`markdownBlockLineRange` 之类的纯函数先确认还有没有别的调用方 |
| `hooks/useMarkdownFile.ts` 的 `useMarkdownFile` 别名（1 行） | `export const useMarkdownFile = useTextFile;`，`useTextFile` 保留 |
| i18n 里只给编辑器用的键（`files.markdownConflict` / `KeepLocal` / `UseExternal` / `Retry` / `SaveFailed` / `editorUnavailable` / `editorReload`） | 顺手清

**必须保留（别误删）**

* `MarkdownFilePreview`**&#x20;的行号映射**。它的 `data-source-line` / `data-source-start-line` / `data-source-end-line` 由组件内部的 `rehypeSourceLineSpans` 插件自己产出（`MarkdownFilePreview.tsx:50-110`），**不依赖** WYSIWYG 编辑器。所以「预览里选一段 → 引用到对话（L12-L15）」这条链路完整保留——这是最容易误判的一处。

* `CodeFileEditor`**&#x20;的位置定位 API**（`MarkdownEditorLocationApi` / `revealLocation` / `setLocation`：`CodeFileEditor.tsx:216,295`），源码模式的行定位靠它。

* **源码模式的「选中 → 引用到对话（带行号）」会换一条实现**。现在它靠 DOM 里的 `.file-source-line[data-line-number]`（`FileViewer.tsx:150-207` 的 `getSelectedSourceLineRange`）。换 CodeMirror 之后这些 DOM 没了，**但功能不会断**：`CodeFileEditor` 自己实现了 `onSelectionChange`，吐出的 `MarkdownEditorSelection`（`MarkdownFileEditor.tsx:21-27`）带 `text / startLine / endLine / top / left`，连「选区结束在行首就不算这一行」的边界规则都跟 DOM 版一致（`CodeFileEditor.tsx:193-197`）；`FileViewer` 在 `liveEditing` 为真时走编辑器这条分支、跳过 DOM 那条（`supportsDomSelection`）。**实现时不要给 markdown 源码模式硬套&#x20;**`.file-source-line`**。**

* `useTextFile`：两个编辑器共用同一个 hook（`useMarkdownFile` 只是它的别名），所以同步/冲突/保存逻辑一行都不用动。

**两个类型要搬家**

`MarkdownEditorLocationTarget` / `MarkdownEditorLocationApi` / `MarkdownEditorSelection` 现在从 `MarkdownFileEditor.tsx` 导出（`MarkdownFileEditor.tsx:29-38`），而 `CodeFileEditor.tsx:35-38` 与 `FileViewer.tsx:37` 都 import 它。删文件前先挪到 `lib/file-editor-types.ts`，否则会变成一次「先编译不过再修」的连锁。

### 2.8 备选：如果所见即所得必须保留

那就得接受两个编辑器同时挂载，并明确**文档所有权**：同一时刻只有一个编辑器是「属主」（可写、跑 watch、负责 save），另一个只读；切模式时把属主的 buffer 交接过去。参考实现走的是更彻底的版本——`previewText = 编辑器的 live buffer`（`pi.file-manager` 的 `k9` 组件），**同一时刻只有一个 buffer**。

**不要**让两个 `useTextFile` 实例各自 watch + 各自 debounce save：会互相触发外部改动、来回打架，而且难复现。

这条比方案 A 贵得多，且那 1.7s 会以「交接」的形式换个地方回来。

### 2.9 验收

1. `npm run test:fileviewer` 改成两态版：只有「源码 / 预览」两个按钮、只有一个 stage 可见、diff 由入口驱动。
2. 新增契约断言：`FileViewerDisplayMode` 不含 `"diff"`；`FileViewer.tsx` 不再 import `MarkdownFileEditor` / `MarkdownEditorBoundary`。
3. 手工三条入口：Git 变更面板点文件 → diff → 返回源码；Git 图谱点文件 → 同上；删掉一个已跟踪文件再打开 → diff + 「文件已删除」空态。
4. `.md` 在源码模式改一行 → 保存 → 切预览立刻反映；反向（在预览里改）不再存在。
5. `.md` 源码模式有 markdown 高亮（需加 `@codemirror/lang-markdown`；不加也能编辑，只是纯文本着色）。当前安装的只有 `lang-css / lang-html / lang-javascript / lang-json`。
6. 回归：预览里选一段 → 「引用到对话」带出正确行号。
7. `npm test`（2179）、`tsc --noEmit`、`lint` 全绿。

### 2.10 拆哪一刀

单独一个 PR，因为它同时动了**类型契约、三个入口、两个模式的渲染**，和性能收尾混在一起会难以回滚。再切成两刀：

- **PR-02a（先合，机械改动）**：类型收窄 + `diffTarget` 接线 + 三个入口迁移 + 兼容历史 `"diff"` 值 + 契约测试。切换器变两态，**渲染表面暂不动**（`.md` 的源码仍是只读 Prism、预览仍是 ProseMirror）。这一刀可以独立回滚。
- **PR-02b（后合，行为变化）**：`.md` 源码接 `CodeFileEditor`、预览接 `MarkdownFilePreview`，删掉 ProseMirror 整条链与那批死代码。

***

## 3. 借鉴清单（PD-01…PD-22）

### 阶段 P0 —— 文件查看器性能

| ID | 做什么 | 改哪里 | 代价 | 风险 |
| --- | --- | --- | --- | --- |
| **PD-01** | **三态常驻**：`source` / `preview` / `diff` 各自只**首次访问时挂载一次**，之后用 `hidden` 切换 | `components/FileViewer.tsx` 内容区 | 中 | ✅ 见 §8，已交付 |
| **PD-02** | **`DiffView` 结果 memo**：`diffLines(patch)` 与上下文折叠 → `useMemo` | `components/FileViewer.tsx:415-460` | 小 | ✅ 见 §8，已交付 |
| **PD-22** | **文件查看器两态化**：只留「源码 / 预览」，diff 改成入口驱动的对比视图。完整设计（含三个 diff 入口、类型契约、删除清单、拆刀）在 **§2** | 见 §2.7 | **大** | 见 §2.3 / §2.8；这条同时决定 PD-03 的形态 |
| **PD-03** | **git diff 懒取 + 进程内缓存**：不在文件挂载时取；按 `(cwd, path, mtime, size)` 做短期缓存；watch 变化只失效不预取。**两态化之后这件事几乎自动完成**——diff 由入口打开，不再需要「先发一个 git 请求来判断 diff 按钮该不该显示」 | `components/FileViewer.tsx:1825-1931`、`lib/git-changes.ts` | 小 | 依赖 PD-22 先落地 |
| **PD-04** | **超长文件行窗口化**：源码视图按可视区 ± 缓冲渲染行（只对 >2000 行的文件启用） | `components/FileViewer.tsx` + 新增 hook | 中 | 破坏「按行选词 → 引用行号」的 DOM 选择链路，必须保留 `data-line-number` 契约 |
| **PD-05** | **掐掉 AppShell 的全树重渲**：切模式时 `onStateChange → saveFileViewerState → setFileTabs` 会让整棵 AppShell 重渲；实测切一次剩下的 ~200ms 主要在这里（CDP 采样里 `getBoundingClientRect` ~12% + react-dom 调和） | `components/AppShell.tsx:707`、`components/file-tab-state.ts` | 中 | 持久化 tab 状态是 workspace restore 依赖的，不能简单删掉，只能挪出热路径 |

### 阶段 P1 —— PWA 布局

| ID | 做什么 | 改哪里 | 代价 | 风险 |
| --- | --- | --- | --- | --- |
| **PD-06** | **补 641–1024px 平板档位**：`useIsMobile`（`hooks/useIsMobile.ts`）之外增加 `useIsCompact()`；composer 工具栏在 compact 下把「思考级别 / 工具预设 / provider 控件」收进「更多控件」 | `hooks/useIsMobile.ts`、`components/ChatInput.tsx`（45 处 `isMobile`） | 中 | `MobilePwaLayout.test.mjs` 是源码契约测试，会跟着改 |
| **PD-07** | **消除平板横向溢出**：`chat-input-toolbar` 子行宽 365px 塞在 432px 列里（实测 right=878 / vw=768，108 个元素越界）。给 composer 外层 `overflow-x: clip` + 工具栏 `flex-wrap` / `min-width: 0` | `app/globals.css`、`app/fork-ui.css` | 小 | 不能改成 `overflow-x: auto`——会引入一个横向滚动条，更乱 |
| **PD-08** | **平板默认收起侧栏**：≥1024 才常驻 dock；641–1024 默认抽屉 | `components/AppShell.tsx`（`sidebarOpen` 初始化 `:333-342`） | 小 | 记住用户上一次选择，别每次硬覆盖 |
| **PD-09** | **移动顶栏信息补全**：当前 393px 顶栏只有 3 个图标、无会话标题、无 tab 切换，且有一个渲染成豆腐块的坏图标 | `components/AppShell.tsx:1916-2330` | 中 | 顶栏高度与 `env(safe-area-inset-top)` 的既有约束不能破 |
| **PD-10** | **composer 高度收敛**：手机上空输入框占 224 CSS px，偏高 | `components/ChatInput.tsx` | 小 | 与自动增高逻辑共存 |

### 阶段 P2 —— 项目归档

| ID | 做什么 | 改哪里 | 代价 | 风险 |
| --- | --- | --- | --- | --- |
| **PD-11** | **项目级归档标志**：新增 `pi-project-flags`（localStorage，跨标签页同步），结构与 `lib/session-flags.ts` 同构：`{ archived: string[], archivedAt: Record<string,string> }`，键为归一化后的项目根路径 | 新增 `lib/project-flags.ts`，仿 `lib/session-flags.ts` | 小 | **路径归一化必须是共享且唯一的**（分隔符、尾斜杠、Windows 大小写）——PI-Desktop 在这里踩过 element-id 碰撞的真 bug（`ProjectArchiveIndex.tsx:15-21`）。复用 `lib/paths.ts` 的 `samePath()` |
| **PD-12** | **项目索引页**（设置 → 数据 → 项目）：分 `置顶 / 项目 / 已归档` 三段；行内显示会话数、最近活动、是否当前工作区；点击选中、就地展开检查器（会话列表 + 打开/新建任务/归档/恢复） | 新增 `components/ProjectArchivePanel.tsx`，接线进 `components/SettingsPanel.tsx` + `lib/settings-navigation.ts` | 中 | 数据源要合并：`lib/recent-projects.ts`（外部来源）+ `lib/project-groups.ts`（会话派生）+ 当前工作区。PI-Desktop 的四源合并（ADR 0251）就是这个结构 |
| **PD-13** | **项目归档/恢复接线**：侧栏项目行的右键菜单加「归档项目 / 恢复」；归档的项目从侧栏隐藏、进入归档页；若归档的是当前工作区，先切到备选再归档 | `components/SessionSidebar.tsx`、`components/ArchivedSessionsPanel.tsx` | 小 | 归档是**纯展示**，绝不能动 `.jsonl`、不能动磁盘目录 |
| **PD-14** | **导入后自动恢复归档**（可选，依赖 PD-13）：导入会话后，把新出现的项目路径从归档态恢复 | `lib/project-flags.ts` + 导入结果处理 | 小 | 只恢复**本次新增**的路径，不做全量刷新 |

> **不抄的部分**：PI-Desktop 的项目级**删除**（级联删会话 + 删记忆）。我们这里没有项目实体，级联删除的语义与「会话是用户的、不可见但仍在」这条纪律冲突。# 建议单独立项讨论，不塞进这个 PR。

### 阶段 P3 —— 导入

| ID | 做什么 | 改哪里 | 代价 | 风险 |
| --- | --- | --- | --- | --- |
| **PD-15** | **扫描层**：新增 `POST /api/import/scan`，`kind: sessions \| models \| skills \| mcp`，四类各自独立、并行、**每一项都设上限**。复用 `lib/recent-projects.ts` 的路径约定与归一化 | 新增 `lib/import/`（`types.ts` / `sessions.ts` / `models.ts` / `skills.ts` / `mcp.ts`）+ `app/api/import/scan/route.ts` | **大** | 上限必须写死在常量里：PI-Desktop 在 865 个文件 / 2.6GB 上把主进程卡了 8 秒才加的上限（`codex.ts:159-162`）。我们的服务端是单进程 Node，卡的是整个 Web 服务 |
| **PD-16** | **落盘层**：新增 `POST /api/import/apply`，收到的是**候选 key 列表**，服务端从扫描缓存里反查真实路径（**渲染端不能注入任意路径**），逐项执行并分桶 `imported / skipped / failed` | 新增 `app/api/import/apply/route.ts`；落盘复用现有路由：会话→`lib/session-reader.ts` 写 `.jsonl`，模型→`/api/models-config`，技能→`~/.agents/skills/`，MCP→`/api/mcp` | **大** | 三条纪律：① **幂等 id**（`import-<source>-<externalId>`，重复导入出 `skipped`）；② **凭据不出服务端**（只回 `hasSecret: boolean`）；③ 一项失败不中断整批 |
| **PD-17** | **导入设置页**：`kind` 分段 tab（四段全部常驻，切换不丢扫描结果）、按来源分组、组级/全选、结果 toast | 新增 `components/ImportPanel.tsx` + `lib/import-groups.ts`(客户端纯函数) + i18n + `lib/settings-navigation.ts` | 中 | 扫描是**显式动作**，绝不自动跑（PI-Desktop ADR 0179 D007 明确禁止启动时自动导入） |

**四类扫描的来源与落点**（这是 PD-15/16 的实现契约）：

| 类别 | 来源 | 落点 |
| --- | --- | --- |
| 会话 | `~/.claude/projects/**/*.jsonl`、`~/.codex/sessions/**/*.jsonl`、`~/.local/share/opencode/storage/`、`~/.pi/agent/sessions/**/*.jsonl` | `~/.pi/agent/sessions/<encoded-cwd>/<ts>_<uuid>.jsonl` |
| 模型 | `~/.claude/settings.json`、`~/.codex/config.toml`、`~/.config/opencode/opencode.json` + `auth.json`、`~/.pi/agent/models.json` | `~/.pi/agent/models.json`（走 `PUT /api/models-config`） |
| 技能 | `~/.claude/skills/`、`~/.agents/skills/`、`<proj>/.claude/skills/`、`<proj>/.agents/skills/` | `~/.agents/skills/<id>/` 或 `<id>.md`；项目级落在 `<proj>/.agents/skills/`（需项目已信任） |
| MCP | Claude Desktop / Claude Code（`~/.claude.json` + `~/.claude/settings.json` 合并）/ Cursor 全局+项目 / Codex TOML / OpenCode | `~/.pi/agent/mcp.json` 或 `<cwd>/.pi/mcp.json` 的 `mcpServers` map（走 `POST /api/mcp`） |

### 阶段 P4 —— 模型高级参数

| ID | 做什么 | 改哪里 | 代价 | 风险 |
| --- | --- | --- | --- | --- |
| **PD-18** | **快填预设 chips**：上下文窗口 `128k/256k/512k/1M`、最大输出 `4k/8k/16k/32k/64k`，来源优先 models.dev 目录（`/api/models-config/catalog` 已有），点一下填数 | `components/ModelsConfig.tsx:1387-1394` | 小 | 点 chip 等同手填数字，不新增「来源」语义（PD-19 才加） |
| **PD-19** | **覆盖来源标记**：数字与目录值一致 → 显示「跟随目录」；被改过 → 显示「已手动覆盖」+ 一键还原 | `components/ModelsConfig.tsx` | 小 | 只做**展示**，不写 `contextWindowSource` 字段（pi 的 `models.json` 没有这个键，凭空加会被 SDK 忽略，属于假功能） |
| **PD-20** | **`nativeWebSearch` 开关** | `components/ModelsConfig.tsx` 的 `ModelEntry`（`:110-124`）+ 高级面板 | 小 | 仅对支持它的 provider 生效；UI 要有说明，别让人以为随便开都有用 |
| **PD-21** | **保存前校验反馈**：baseUrl 合法性、别名/名称非空、上下文窗口与最大输出的数值关系、header 保留字 | `components/ModelsConfig.tsx` | 小 | 校验只挡「明显写错」，不做「帮你决定」 |

***

## 4. 不抄的清单

| 不抄 | 原因 |
| --- | --- |
| PI-Desktop 的 SQLite 项目/供应商/会话表 | 我们的真源是 pi 的文件与设置，引入第二套库会产生双写与漂移 |
| 项目级**级联删除** | 与本仓库「会话不可见但仍是用户的」纪律冲突（见 `lib/session-flags.ts` 顶部注释） |
| 多文件夹项目组 | worktree 分组已覆盖主要场景；多 root 会牵动文件访问白名单，风险远大于收益 |
| 项目级「记忆 / 指令」编辑 | 我们是 `AGENTS.md` 文件链，编辑入口应当是文件本身，不是第二份可编辑副本 |
| 模型级 `contextWindowSource` 持久化 | pi 的 `models.json` 没有这个键，写进去是空转 |
| 插件/扩展的「导入 pi 扩展」流程 | 我们的插件体系是 pi package，语义完全不同 |
| 无上限的扫描 | 见 PD-15 的风险栏 |

***

## 5. PR 拆分

依赖关系：`PR-01 → PR-02a → PR-02b`；`PR-03` 依赖 `PR-02b`；`PR-04 → PR-05`；`PR-06 → PR-07`；`PR-08 → PR-09 → PR-10`；`PR-11` 独立。

| PR | 标题 | 内容 | 依赖 | 验收 |
| --- | --- | --- | --- | --- |
| **PR-01** | `perf(fileviewer): 三态常驻（含两个实时编辑器）+ diff memo` | PD-01 PD-02 | — | ✅ **已交付**。`npm run test:fileviewer`：9 次切换全过；Preview 1717ms → 217ms；源 stage 常驻；`npm test` 2179/2179 |
| **PR-02a** | `refactor(fileviewer): 模式收成两态，diff 改为入口驱动的对比视图` | PD-22（§2.10 第一刀） | PR-01 | ✅ **已交付**。`npm run test:fileviewer`：切换器恰为 `[Source, Preview]`；对比覆盖层开/关 130/113ms；`npm test` 2182/2182 |
| **PR-02b** | `refactor(fileviewer): 预览只读化 + 删掉 ProseMirror 那条链` | PD-22（§2.10 第二刀） | PR-02a | ✅ **已交付**。`npm run test:fileviewer` 新增两条实证：`.md` 源码可编辑且落盘、预览只读且不显示旧快照；`MarkdownFileEditor.tsx` 与 `lib/markdown-editor.ts` 已删；`npm test` 2177/2177 |
| **PR-03** | `perf(fileviewer): 掐掉 AppShell 全树重渲 + git diff 懒取 + 超长文件行窗口化` | PD-05 PD-03 PD-04 | PR-02b | ⏳ **未开工**。PD-03 已被 PR-02a 顺手削掉一半（diff 不再参与模式切换），但「打开文件就发一次 git diff」还在；PD-05/PD-04 原样 |
| **PR-04** | `fix(pwa): 平板档位 + composer 横向溢出` | PD-06 PD-07 PD-08 | — | ✅ **已交付**（与 PR-05 合并落地）。393/768/834/1280/1700 五档：`docScrollWidth === innerWidth`、`.chat-input-toolbar` 溢出 0 | iPad Mini（768×1024）越界元素数 108 → 0；`document.scrollWidth === innerWidth` |
| **PR-05** | `fix(pwa): 移动顶栏信息与高度收敛` | PD-09 PD-10 | PR-04 | ✅ **已交付**（PD-10 判定不需要做，见 §8）。393px 顶栏显示会话标题、右面板图标语义可辨 | iPhone 14 Pro（393px）顶栏显示会话标题 + tab 切换；右面板开关图标语义可辨；空输入框高度不高于现状（112px） |
| **PR-06** | `feat(projects): 项目级归档标志 + 归档索引页` | PD-11 PD-12 | — | ✅ **已交付**。实测往返：侧栏 ⋯→归档 → 行消失 + 标志落盘 → 归档页「已归档」列出（88 个对话 · 归档时间）→ 恢复 → 行回来。键用服务端 `projectKey`，不做路径归一化 |
| **PR-07** | `feat(projects): 侧栏归档入口 + 导入后恢复` | PD-13 PD-14 | PR-06 | ✅ **已交付**（侧栏入口合在 PR-06，PD-14 合在 PR-10） |
| **PR-08** | `feat(import): 扫描层（四类来源 + 上限 + 并行）` | PD-15 | — | ✅ **已交付**（11 个新文件、37 个测试）。五处上限各有实测证明；四类各有一个「植入假密钥、断言不出现在结果里」的测试 | 单测：每个来源一个有上限的 fixture 不超时；损坏/缺失文件返回空而不是抛错；扫描 1000 个会话 < 3s |
| **PR-09** | `feat(import): 落盘层（幂等 + 分桶 + 凭据不出服务端）` | PD-16 | PR-08 | ✅ **已交付**（14 个测试，全套 2239 绿）。**凭据一律不复制**（见 §8） | 单测：重复导入同一批 → 全 `skipped`；渲染端传未知 key → 该条 `failed` 而非写盘；响应体不含任何密钥原文 |
| **PR-10** | `feat(import): 设置页导入界面` | PD-17 + PD-14 | PR-09 | ✅ **已交付**。实测：四段 tab 常驻、不点扫描不发请求、真实扫描 104 个技能按来源分成两组、选中 1 个导入 → `导入 0 · 跳过 1 · 失败 0`（零写入地验证了幂等与整条链路） |
| **PR-11** | `feat(models): 高级参数补齐（预设 / 来源标记 / samplingParams / 校验）` | PD-18 PD-19 PD-21 + PD-20′ | — | ✅ **已交付**（PD-20 换成 `samplingParams`，见 §8：本仓 SDK 里根本没有 `nativeWebSearch`）。`tsc` 干净、2214 测试全绿；**浏览器未实证**——设置弹窗的三段选择器没点通 | 预设 chip 写入正确数值；与目录一致显示「跟随目录」；`nativeWebSearch` 只在支持它的 provider 上可勾；非法 baseUrl 保存被拦 |

**建议执行顺序**：`PR-02a → PR-02b`（你指定的两态化，也是把 1.7s 那条路彻底铲掉的一刀）→ `PR-03`（性能收尾）→ `PR-04 → PR-05`（PWA，用户天天看得见）→ `PR-11`（最便宜，半天）→ `PR-06 → PR-07` → `PR-08 → PR-09 → PR-10`（最长）。

## 6. PWA 布局专项（实测 + 归因）

### 6.1 实测数据

| 视口 | 结论 |
| --- | --- |
| iPhone 14 Pro（393×660 CSS px） | `scrollWidth === innerWidth`（无溢出）。但顶栏只有「☰ ⋯ ▢」三个按钮——**没有会话标题、没有 tab 切换**（标题块被 `{!isMobile && ...}` 整个排除，`AppShell.tsx:2639`）。第三个是右面板开关，画的是一个空矩形 + 分隔线（`AppShell.tsx:2726-2728`），在 44px 高的栏里读起来像一个没加载出来的占位块。composer 空输入时高 **112 CSS px**（含状态条与成本条）。 |
| iPad Mini（768×1024 CSS px） | **108 个元素越界**。`div.chat-input-toolbar` 内一行宽 365 CSS px 的元素被放在列宽 432px 的 composer 内，实际右边界到 **878px**（视口 768）。父级 `fieldset` 的 `scrollWidth 578 > clientWidth 432`，且 `overflow-x: visible`，所以溢出**直接透传到页面**。 |

### 6.2 归因

1. **composer 工具栏不收缩**：模型名 chip、思考级别、工具预设、provider 控件都是 `nowrap` + 不收缩，在 641–1024px 宽度区间没有任何降级策略。`useIsNarrowMobile` 的断点是 **≤480px**（`hooks/useIsMobile.ts:8`），**641–1024 这一段完全没有档位**——而 iPad 正好落在里面。

2. **溢出靠&#x20;**`overflow: visible`**&#x20;泄漏**：没有任何容器做裁剪，所以越界元素直接跑出视口。

3. **平板默认 dock 侧栏**：侧栏常驻占掉 288px（768px 视口的 37.5%），把主区挤到 432px，进一步加剧第 1 条。

4. **移动顶栏只剩导航按钮**：移动端为省宽度把标题与 tab 都去掉了（`AppShell.tsx:2639` 的 `{!isMobile && ...}`），但用户最需要知道的就是「我在哪个会话」。实测 `data-mobile-toolbar-file` 只有 28px 宽，393px 宽的顶栏里只放了三个图标，**大部分宽度空着**。

### 6.3 方案要点

* 新增 `useIsCompact()`（641–1024px），composer 工具栏在 compact 下把次级控件合并到一个「更多控件」按钮——**复用已有的&#x20;**`mobileToolbarMoreOpen`**&#x20;模式**，不是新发明。

* 裁剪用 `overflow-x: clip`（不是 `auto`——不要引入横向滚动条）。

* 侧栏默认策略：`< 1024px` 抽屉、`≥ 1024px` dock，并记住用户上次的选择。

* 移动顶栏把「会话标题」放在第一位（可截断），tab 切换降级为标题下的分段控件或进入 ⋯ 菜单——桌面的 `topBarSessionTitle` 本身就是「标题即会话切换器」，移动端只是被 `{!isMobile}` 挡住了，**接线基本现成**。

### 6.4 门禁

沿用现有的源码契约测试（`components/MobilePwaLayout.test.mjs`），并**新增一条真实视口的回归脚本**：在 393 / 768 / 1024 / 1440 四个宽度断言 `document.scrollWidth <= window.innerWidth + 1`、无元素越界、composer 高度上限。源码契约测试只能证明「代码长这样」，证明不了「没溢出」——这次的 108 个越界元素就是漏网证据。

---

## 7. 回归门禁

1. **性能**：文件查看器三态往返计时脚本（PR-01 交付），阈值写进脚本本身。
2. **布局**：四档视口的溢出断言（PR-03 交付）。
3. **扫描**：每个导入来源一个有上限的 fixture + 一个超时上限断言（PR-07 交付）。
4. **幂等**：导入落盘重复执行的 `skipped` 断言（PR-08 交付）。
5. **既有门禁**：`node_modules/.bin/tsc --noEmit`、`npm run lint`、`node docs/codex-skin/check-contrast.mjs`（改颜色时）。
6. **记账**：所有改动按仓库既有约定打 `fork:` 标记，并在 `docs/codex-skin/delta.md` 登记（`docs/patches/README.md` 的约定）。

---

## 8. 交付记录

### PR-10（已完成，2026-09-24）导入设置页 + PD-14

改动：
* `lib/import/groups.ts`**（新）** — 纯分组/选择逻辑（`groupCandidates` / `groupSelectionState` / `toggleGroupSelection` / `toggleAllSelection` / `summarizeResults`），放在组件外是为了「什么会被导入」这件事能脱离 DOM 测。

* `components/ImportPanel.tsx`**（新）** — 四段 tab（对话/模型/技能/MCP），**四个面板同时挂载、只切&#x20;**`hidden`（切 tab 不丢扫描结果，也不偷偷再扫一次）。每段：扫描按钮、（会话独有的）按来源/按项目切换、全选（三态 indeterminate）、导入所选、来源诊断行（**没找到的来源也要列出来**，否则空列表看起来像坏了）、按来源分组、每组全选、行级复选框。结果走 `ConfigFooter status`。

* `lib/settings-navigation.ts` + `components/SettingsPanel.tsx` — 新增 `import` 段与图标。

* i18n ×3 — 25 个键。

* 测试：`lib/import/groups.test.mjs`（9 条）。

**PD-14（导入后恢复归档项目）落在&#x20;**`apply()`**&#x20;里**：导入会话前先取一次项目 key 集合，导入后再取一次，只把**新增**且处于归档态的那些 `restoreProject()`。不做全量刷新，也不碰本来就存在的项目。

**开工时踩到两个真 bug，都值得记：**

1. `node:fs/promises`**&#x20;泄进客户端包，**`next build`**&#x20;直接失败。** `lib/import/types.ts` 把「wire 契约」和「文件系统助手」放在同一个文件里，客户端组件为了拿 `IMPORT_KINDS` 这个**值**就 import 了它，于是 webpack 报 `UnhandledSchemeError: Reading from "node:fs/promises" is not handled by plugins`。修法是把契约拆出来：`lib/import/contract.ts`（零 node 依赖）+ `lib/import/types.ts`（只放三个文件助手，并 `export * from "./contract"` 保持既有 import 不变）。契约与 IO 本来就不该同文件 —— 这次是构建器替我指出来了。 （顺带：`groups.ts` 与 `ImportPanel.tsx` 现在都从 `contract` 引，改回 `types` 会立刻再炸一次构建。）

2. **结果提示被自己的刷新吃掉了。** `apply()` 先 `setKind({status: result})` 再 `await scan(kind)`，而 `scan()` 一进来就 `status: null` —— 于是用户永远看不到「导入 N / 跳过 N / 失败 N」。改成一件事做完再说：先 `await scan(kind)`（刷新列表，失效的 id 不该再出现在选项里），**然后**写 status。这个是浏览器验证抓出来的，单测看不见。

实测（prod，真实数据，**零写入**）：

```
1. tabs            : ["对话","模型","技能","MCP 服务器"]
2. idle hint shown : true          ← 不点扫描不发任何请求
3. after scan      : groupLabels ["Agents 76","Claude Code 28"]
                     rows 88 · 已选 0 / 104
4. after selecting : 已选 1 / 104
5. import result   : 导入 0 · 跳过 1 · 失败 0
```

第 5 步是**刻意选的**：`browser-cdp` 这个技能在 `~/.claude/skills` 和 `~/.agents/skills` 里都有，所以服务端必然判 `skipped` —— 用一次必然幂等的导入同时验证了「路由通了」「分桶对」「幂等成立」，而且**磁盘一个字节都没动**（`ls ~/.agents/skills` 前后都是 77 项）。

顺手修的显示问题：技能描述常常是一整段（frontmatter 的 description 直接拿来当副标题），行会横着冲出面板，列表看起来像坏了。改成名称最长 38% 截断、描述占剩余空间并截断。

### PR-06 / PR-07（已完成，2026-09-24）项目归档

改动：
* `lib/project-flags.ts`**（新）** — `{ archived: string[], archivedAt: Record<string,string> }`，localStorage + 跨标签页同步，与 `lib/session-flags.ts` 同一套纪律（`pi-project-flags` / `pi-project-flags-change`、`parse` 逐字段校验、`useSyncExternalStore`）。对外是 `setProjectArchived` / `toggleProjectArchived` / `partitionProjects` / `filterArchivedProjects` / `useProjectFlags`。

* `components/ProjectArchivePanel.tsx`**（新）** — 设置 → 项目归档。两段（项目 / 已归档），每行：项目名、会话数、最近活动、归档时间、归档/恢复按钮；点行就地展开检查器，列出该项目最近 20 个会话（点进会话用既有的 `onOpenSession`）。沿用 `ArchivedSessionsPanel` 的 CSS 词表（`fork-settings-block` / `settings-archived-*`），**没有新增一行样式**。

* `components/SessionSidebar.tsx` — 项目行 ⋯ 菜单加「归档项目 / 恢复项目」；项目列表套上 `filterArchivedProjects`，**当前选中的项目永远保留**（否则归档掉自己站的那一行就看不出在哪了）。

* `lib/settings-navigation.ts` + `components/SettingsPanel.tsx` — 新增 `projects` 段与图标。

* i18n ×3 — 12 个键。

* 测试：`lib/project-flags.test.mjs`（6 条，含「坏数据不抛」「两段合起来等于原列表」「空归档保持顺序」）+ `components/ProjectArchivePanel.test.mjs`（5 条源码契约：**永不 DELETE**、身份来自服务端而非浏览器端拼路径、保留选中项、菜单项存在、可从设置进入）。

**一个直接把 PI-Desktop 的坑绕过去的决定**：归档键用 `SessionInfo.projectKey` —— 服务端 `projectIdentityKey(projectRoot)` 算出来的、Windows 下大小写与分隔符都不敏感的身份。参考实现用「浏览器端归一化后的路径」做键，结果两次拼写撞成同一个 element id（它自己的注释记着这个 bug）。而 `projectKey` 是侧栏**本来就**在用的分组身份，所以「一个归档项目」天然就等于侧栏的一行，worktree 也算在同一行里。我这个 store 因此**一行路径归一化都不用写**，测试里还专门钉了一条「大小写不同视为不同键」来固定这个契约。

**两段而不是参考项目的三段**：它那三段里的「置顶」是**项目级**置顶，我们只有会话级置顶。为凑形状去加一个没人要的标志不合适，所以只做 项目 / 已归档。

实测（prod，真实往返，跑完把标志恢复干净）：

```
1. 侧栏 ⋯ → 归档项目
   flags           : {"archived":["/Users/yingjing/Desktop/pi-codex"],"archivedAt":{…}}
   侧栏里还在吗     : 0        ← 行消失
2. 设置 → 项目归档
   分段            : ["项目","已归档"]
   已归档那一行     : pi-codex  88 个对话 · 21秒钟前 · 3秒钟前归档  [恢复]
3. 点「恢复」
   flags           : {"archived":[],"archivedAt":{}}
   侧栏里回来了吗   : 1
```

**踩到的唯一一个坑是我的验证脚本，不是代码**：`button:has-text("归档项目")` 能匹配到元素但点不中——菜单项是 `<button role="menuitem">`，得用 `[role="menuitem"]:has-text(...)`。第一轮我因此误判成「功能没生效」，加了一轮 `localStorage` 时间线才看清标志其实在 100ms 内就写好了。

**未做**：PD-14（导入后自动恢复归档的项目）依赖 PR-10 的导入 UI，留到那时一起做。

### PR-09（已完成，2026-09-24）导入落盘层

子代理完成。新文件：`lib/import/apply.ts`、`app/api/import/apply/route.ts`、`lib/import/apply.test.mjs`（14 条）、`lib/mcp-config-file.ts`（共享的 mcp.json 读写）。改了两个既有文件：`lib/import/sessions.ts`（导出 `readSessionTranscript`，与扫描器共用同一个行解析器）、`app/api/mcp/route.ts`（改用共享 lib，不再在路由里放读写函数）。

**凭据处理的决定：一律不复制。** 模型 provider 只写 `name/baseUrl/api/models`，MCP server 只写 `command/args` 或 `url/disabled`；目标里已存在的条目（连同它的密钥）原样保留。用户凭扫描结果里的 `hasSecret` 知道「这个源有密钥」，在目标 UI 里自己重填。理由是这个决定让任何代码路径都**不可能**把密钥回显出去，也和扫描层「no key leaves this module」的边界一致。

我独立核验过这条声明落在代码里而不只是报告里：
```
$ grep -n "apiKey\|api_key\|headers\|env\|token\|secret" lib/import/apply.ts
11: * Model providers are written without `apiKey`/`headers` and MCP servers
12: * without `env`/`headers`; the user re-enters secrets in the destination UI.
```
只有那两行注释。写入函数本体：`modelProviderEntry` 产出 `{name, baseUrl?, api?, models}`，`mcpServerEntry` 产出 `{command, args?, url?, disabled?}`。

它顺手处理掉的两个既有隐患，值得记一笔：
1. `lib/models-config-store.ts`**&#x20;的&#x20;**`readModelsConfig`**&#x20;遇到损坏 JSON 会静默返回&#x20;**`{providers:{}}` —— 落盘层如果复用它，就会把一份坏掉的 `models.json` 覆盖成空。它改用扫描器的 `readJsonFileCapped` 先判损坏（拒绝写），只保留 `writeModelsConfig` 当写入端。

2. MCP 的读写函数原来只活在 `app/api/mcp/route.ts` 里，落盘层需要同一份逻辑但**不能路由 import 路由**，所以抽成了 `lib/mcp-config-file.ts`；顺带把写入改成原子 + 权限 `0600`。

实测：
```
$ node_modules/.bin/tsc --noEmit                     → clean
$ npx eslint lib/import app/api/import lib/mcp-config-file.ts app/api/mcp/route.ts  → 0 error 0 warning
$ node --experimental-strip-types --test lib/import/apply.test.mjs   → 14/14
$ 全套                                               → 2239/2239
```
活体检查（重建后的 prod）：
```
$ curl -s "…/api/mcp?cwd=…"                → {"servers":[{"name":"tender",…}]}     ← 共享 lib 的重构没打破 MCP
$ curl -s -X POST …/api/import/scan -d '{"kind":"skills"}'
   → sources: claude 28 + agents 76；candidates[…]
```
扫描层在**真实文件系统**上命中 28 个 claude 技能 + 76 个 agents 技能。

**未做**：并发批次之间没有锁（两个同时进行的批次可能在 JSON 配置上 last-writer-wins）。批次内是单次 read-modify-write 且幂等，所以只有并发导入同一个 kind 才可能撞上。

### PR-04 / PR-05（已完成，2026-09-24）PWA 布局

改动：
* `hooks/useIsMobile.ts` — 新增 `useIsCompact()`（`max-width: 1024px`，**包含**手机档）。原来 641–1024px 这一段**完全没有档位**，直接落到桌面布局，而桌面布局里 composer 的控制条是一整行不换行的固定宽度 chip。

* `components/ChatInput.tsx` — `narrowControls = useIsCompact()`，只用它决定「内联还是收进按钮」这四件事：工具栏的 `grid` 布局、spacer、「更多控件」触发按钮、控制条本身（`display` / 绝对定位 / `gap`）与标签可见性、弹出层对齐方向；**padding/width 这些触控尺寸相关的仍按&#x20;**`isMobile`，因为那是触摸目标大小的问题，不是行放不放得下的问题。

* `components/AppShell.tsx` — 641–1024px 侧栏默认收成抽屉（docked 288px 在 768px 上是 38% 视口）；顶栏标题抽成 `renderSessionTitle()`，桌面头部与手机工具栏共用，手机因此终于有会话身份；右面板开关图标补了两条内容线（原来一个空矩形在 44px 栏里读起来像加载占位）。

* `components/ProviderIcon.tsx` — `DefaultModelIcon` 的八根引脚在 composer 的 11px 尺寸下糊成一团，`size >= 16` 才画。

* `app/fork-ui.css` — `.chat-input-shell { overflow-x: clip }` + `.chat-input-toolbar > * { min-width: 0 }` 作安全网（用 `clip` 不用 `auto`：横向滚动条比裁掉一个 chip 更像 bug）。

实测（prod，五档）：

```
              docScrollW  toolbar 溢出  顶栏标题         composer 高
393px (SE)       393           0        「询问 pi 助手…」      112
768px (iPad)     768           0        同上                    76
834px            834           0        同上                    76
1280px          1280           0        同上                    80
1700px          1700           0        同上                    80
```

**PD-10（composer 高度收敛）判定不做**：我最初读图量到「224px」是设备像素，CSS 像素其实是 112px（含状态条与成本条），并不偏高。没有要修的。

**一个诚实的边界**：`getBoundingClientRect().right > viewport` 这个计数在修完后 iPad 仍是 93、桌面仍是 76 —— 但那是**故意画在视口外的抽屉/浮层**（`docScrollWidth === innerWidth` 全部成立，composer 行溢出为 0）。真正有意义的指标是「文档不横向滚动」＋「composer 行不溢出」，两个都归零了。第一版门禁用元素计数会误报，已改用后两个。

### PR-11（已完成，2026-09-24）模型高级参数

改动（全在 `components/ModelsConfig.tsx` + i18n）：
* **PD-18 快填 chips** — 上下文窗口 `128k/256k/512k/1M`、最大输出 `4k/8k/16k/32k/64k`。`LimitChips` 组件，与目录一致的档位加 accent 描边。

* **PD-19 覆盖来源标记** — 只在**本次编辑真的查过目录**时出现（`catalogState` 是 per-model 的，`handleCatalogFill` 按 `model.id` 查），没查到就只显示阶梯、不假装知道「跟随目录」是什么。给的是「用目录值 / 跟随目录 / 已覆盖」三个状态。

* **PD-20′ 换成&#x20;**`samplingParams`**（真参数）** — 见下。

* **PD-21 校验** — `maxTokens > contextWindow` 时在字段下方给一条 warning。不做「帮你决定」式的自动修正。

**PD-20 的&#x20;**`nativeWebSearch`**&#x20;我判定为假功能，没有做。** 证据：
```
$ grep -rn nativeWebSearch node_modules/@earendil-works/pi-coding-agent/
(无输出)
```
本仓 `ModelDefinitionSchema`（`dist/core/model-config.d.ts`）里模型支持的键是 `id / name / api / baseUrl / reasoning / thinkingLevelMap / input / inputLimits / cost / promptCache / contextWindow / maxTokens / samplingParams / headers / compat`。 参考项目的 `nativeWebSearch` 属于**它自己**的 provider 表，不是 pi 的 `models.json`。写进 `models.json` 会被忽略——正是我在 §4 里拒绝 `contextWindowSource` 的同一条理由，所以按同一条标准处理。

顺带发现 schema 里**有一个我们完全没暴露的真键**：`samplingParams`（任意请求参数，temperature / top\_p / …）。它在 bundle 里是 `samplingParams: override.samplingParams ? {...model.samplingParams, ...override.samplingParams} : model.samplingParams`，确实会并进请求。所以 PD-20 改成暴露它：一个小 JSON 编辑器（用 JSON 而不是键值行，因为**字符串化的数字会改掉类型**，而 `samplingParams` 的值类型不受限）。未编辑时显示规范化 JSON，失焦时校验并提交，非法时 `aria-invalid` + 就地报错。

**验证边界**：`tsc` 干净、2214 个测试全绿、lint 无 error。但**没有在浏览器里实证**——设置弹窗是「provider / model / 详情」三段选择器，我用 `[role="dialog"]`、`.models-sidebar-indented-item` 两套选择器都没点通模型行。这几项是纯增量 UI（只是把已有的 `model.contextWindow` 等字段旁边多渲染几个按钮），没有其它功能依赖它们，所以风险低，但它是**类型契约级验证，不是实证**。

### PR-08（已完成，2026-09-24）导入扫描层

11 个新文件、37 个测试，全部由子代理完成，**没有改动任何既有文件**：

```
lib/import/types.ts              契约 + 带上限的异步 IO 助手
lib/import/sessions.ts           claude / codex / opencode / pi 四源
lib/import/models.ts             claude / codex / opencode / pi 配置（含一个 TOML 子集解析器）
lib/import/skills.ts             ~/.claude/skills + ~/.agents/skills
lib/import/mcp.ts                Claude Desktop / Claude Code / Cursor / Codex / opencode
lib/import/index.ts              scanImports(kind, options)
app/api/import/scan/route.ts     POST { kind, cwd? }
+ 4 个 .test.mjs
```

上限是**按来源**设的（一个膨胀的产品归档不会饿死其它来源）：会话 400 文件/源、>2 MiB 只采样 256 KiB 头 + 64 KiB 尾；models / mcp / skills 各 200 候选/源；skills 只读 128 KiB frontmatter。五处上限各有一条实测证明（如 405 个 fixture → 400 候选 + `truncated: true`）。

一个子代理自己发现并处理掉的隐患值得记一笔：`sources[].error` 如果直接放 V8 的 JSON 报错，报错文本会**把出错位置的原文引出来**——也就是会把植入的假密钥带进结果。所以它改用固定标签（`"malformed JSON"` / `"file too large"`），并有测试盯着。

### PR-02b（已完成，2026-09-24）

改动：
* `lib/file-editor-types.ts`（新）— `MarkdownEditorSelection` / `MarkdownEditorLocationTarget` / `MarkdownEditorLocationApi` 从 `MarkdownFileEditor.tsx` 搬过来。不先搬就会变成「先编译不过再修」的连锁。

* `components/FileViewer.tsx` — 删掉 `useMarkdownEditor` 这条分支与两个 dynamic import；预览态永远是只读渲染；`isCodeText` 的 `&& !isMarkdown` 排除去掉，`.md` 因此获得可编辑的源码视图；顺手删掉**本来就是死代码**的 `isEditing` 整条链（textarea、`saveMarkdown`、`handleEditorKeyDown`、`draftContent`、`draftDirty`、`saveState`、`saveError`、`cancelEdit`、`editingRef`、`editReturnModeRef`、`EDIT_MAX_BYTES`，共约 90 行）。

* `components/CodeFileEditor.tsx` — 新增 `onContentSaved`，在**保存完成的那一刻**把缓冲交给 viewer。

* `app/globals.css` — `.markdown-sync-notice` / `.markdown-conflict` 从 `markdown-editor.css` 搬进来（它们一直是 `CodeFileEditor` 的，但那个文件只在 WYSIWYG chunk 里加载，所以纯代码文件的同步提示本来是无样式的）；删掉 textarea 与 saved/save-error 的死规则。

* 删除：`components/MarkdownFileEditor.tsx`（505 行）、`components/MarkdownEditorBoundary.tsx`、`components/markdown-editor.css`、`lib/markdown-editor.ts`、`lib/markdown-editor.test.mjs`（6 个测试，测的就是 ProseMirror codec）。

* `hooks/useMarkdownFile.ts` — 删掉 `useMarkdownFile` 别名（就是 `useTextFile` 的别名）。文件名没改：为改个名去动一次 import 不值得。

* **依赖** — 8 个 `prosemirror-*` 全部移除（`package.json` -11 行，`package-lock.json` -128 行）。只被删掉的那个编辑器用。

* i18n（en / zh-CN / zh-TW）— 删掉 7 个只给编辑器用的键。

**开工时踩到、也顺手修掉的一个回归**：预览态现在渲染 `data.content`，而 Source 里的编辑走的是编辑器自己的 buffer——viewer 的 watch 循环在 `liveEditingRef` 为真时**故意跳过** `fetchContent`，所以编辑完切到预览会看到**编辑前**的快照。`onContentSaved` 就是为这个加的：保存完成时把缓冲交给 viewer，不重新拉接口、不闪。这条是真被 e2e 门禁抓出来的（第一版 probe 就红在这）。

实测（prod，同一套脚本）：

```
opened AGENTS.md — markdown · 318 lines · 27.0 KB
stages: {"sourceLines":0,"sourceEditors":1,"sourceSurface":1,"stages":2,"hiddenStages":1,"visibleStages":1,"previewEditors":0}
ok   cold Source 261 / cold Preview 185        ok  warm Source 165 / 99
ok   warm Preview 136 / 150                    ok  open compare 147 / close compare 143
ok   markdown source edit saved to disk
ok   preview renders the saved buffer read-only
```

`sourceLines: 0` 是预期的——源码态现在是 CodeMirror（`.cm-content`），不再有 Prism 的逐行 span。门禁的断言也跟着从「数行 span」改成「源码界面是 contenteditable 的 CodeMirror」＋「预览里一个编辑器都没有」。

### PR-02a（已完成，2026-09-24）

改动：
* `lib/file-viewer-state.ts` — `FileViewerDisplayMode` 收成 `"source" | "preview"`；新增 `normalizeDisplayMode()`，历史值 `"diff"` 与任何非法值都回落 `"source"`（tab 状态是持久化的，不能让旧值进入组件状态——那会一个 stage 都渲染不出来）；`FileViewerState` 增加 `diffOpen?: boolean`。

* `lib/right-tabs-memory.ts` — 第二层持久化。`sanitizeViewerState` 把旧的 `"diff"` **翻译**而不是拒绝：该 tab 保住位置、模式回落 source、对比覆盖层打开（`wasLegacyDiffMode()`）。

* `components/FileViewer.tsx` — `displayModes` 只剩两项；`effectiveDisplayMode` 不再被 `isDeletedDiff` 改写成 `"diff"`；删掉两个「切到/切回 diff」的副作用（`autoDiffAppliedRef` 一并删）；新增 `updateDiffOpen()`，对比是盖在 stage 之上的覆盖层（`hidden={diffOpen || …}`，**遮蔽而不卸载**）；工具栏多一个 `.file-viewer-diff-toggle` 动作按钮（不属于 seg control，只在真有对比可看时出现）；已删除的文件在没有内容可渲染时给一条 `files.deletedNotice` 提示；选词/定位/换行三处守卫都加了 `!diffOpen`。

* `components/file-tab-state.ts` — `modeHint: "diff"` 不再写 `displayMode`，改为把 `viewerState.diffOpen` 置真并 bump revision（复用预览提示那一套）；已经开着的时候是 no-op。

* `app/globals.css` — `.file-viewer-diff-toggle` / `.file-viewer-diff-overlay` / `.file-viewer-diff-banner`（sticky）/ `.file-viewer-deleted-notice`。

* i18n（en / zh-CN / zh-TW）— `files.compareHead` / `files.backToSource` / `files.deletedNotice`。

* `[data-file-stage]` 标记 — 两个 stage 的包裹 div 加了这个属性，e2e 才能把「stage」和「覆盖层」分开数（原来按 `> div` 数会把覆盖层算成可见 stage）。

实测（prod，同一套脚本）：

```
opened AGENTS.md — markdown · 318 lines · 27.0 KB
stages: {"sourceLines":318,"stages":2,"hiddenStages":1,"visibleStages":1}
ok   cold Source      168ms      ok   warm Source      133 / 84ms
ok   cold Preview     163ms      ok   warm Preview     100 / 133ms
ok   open compare     130ms      ok   close compare   113ms
git diff requests during the run: 2
```

三条入口：工具栏按钮与 Git 变更面板都已在真实浏览器里验证（面板点 AGENTS.md → 覆盖层打开、800 个 diff 元素、横幅「与 HEAD 对比 / 返回源码」，stage 全部被遮蔽但没卸载）。**Git 图谱入口与「已删除的文件」提示只由契约测试覆盖**，没有实证——本机工作区没有已删除的已跟踪文件，不想为了测试去动用户的仓库。

### PR-01（已完成，2026-09-24）

改动：
* `components/FileViewer.tsx` — `mountedStages` 记录已访问的 stage，首次访问才挂载、之后常驻，`hidden` 切换；`DiffView` 的 `diffLines` 与上下文折叠改成 `useMemo`；`liveEditing` 从「优先级高于三态的模式」改成「Preview / Source 两个 stage 各自的表面」。

* `components/MarkdownFileEditor.tsx` / `components/CodeFileEditor.tsx` — 新增 `active` prop，重新可见时重新 measure（ProseMirror 无 `requestMeasure`，用一个空事务触发；CodeMirror 用 `view.requestMeasure()`）。

* `components/FileViewer.test.mjs` — 把「切走就不算 lightweight 行」的旧契约换成新契约：源码 fallback 对每个 stage 都产出、三个 stage 同时只有一个可见、两个实时编辑器带 `active`。

* `e2e/file-viewer-modes.mjs` + `npm run test:fileviewer` — 真实浏览器里的切换计时与保活断言（源码契约测试证明不了布局）。

**与 §2 的关系**：PR-01 保留了三个 stage（`source` / `preview` / `diff`），是达成两态化之前的中间态。PR-02b 落完之后 `mountedStages` 只剩两项、`MarkdownFileEditor` 那条链被删掉，`useMarkdownEditor` / `editorEligible` 这些为「编辑器进 stage」而加的接线也会一起删掉——换句话说 PR-01 的 `mountedStages` 机制在两态化之后仍然有用（源码 ↔ 预览仍然需要保活），但它服务的表面积会小一半。

一个顺带发现（未处理，单独立项）：`FileViewer.tsx` 里的 `isEditing` 状态**永远不会变成 true**（`setIsEditing(true)` 在全仓不存在），所以 `file-markdown-editor-shell` 那段 textarea、`saveMarkdown`、`handleEditorKeyDown`、`draftDirty` 都是死代码。删它能让这个文件少 \~80 行。

***

***

## 9. 剩余工作

**已完成 9 批**（PR-01 / 02a / 02b / 04 / 05 / 06+07 / 08 / 09 / 10 / 11），**只剩 PR-03 性能收尾**：

| PR | 做什么 | 为什么还没做 |
| --- | --- | --- |
| **PR-03** | ① 掐掉切模式时 AppShell 的全树重渲（**实测剩下 ~200ms 的主要来源**，CDP 采样里 `getBoundingClientRect` ~12% + react-dom 调和）；② git diff 懒取 + 按 `(cwd, path, mtime, size)` 缓存（现在仍是「打开文件就发一次」——门禁每轮都打印 `git diff requests: 2`，这是个现成的回归指标）；③ >2000 行文件的源码行窗口化 | 需要动 AppShell 的 state 边界，比前面几刀风险高，值得单独一个 PR 慢慢做。**这是唯一剩下的性能项**，其它三块（两态化、PWA、模型）都收口了 |

两条**已经判定不做**的：

* **PD-20 的&#x20;**`nativeWebSearch` —— 本仓 pi SDK 里不存在这个键（见 §8 PR-11）。它是参考项目自己的 provider 字段。

* **PD-19 的&#x20;**`contextWindowSource`**&#x20;持久化** —— 同上，`models.json` 没有这个键。UI 上的「跟随目录 / 已覆盖」只做展示。

一个**观察但未处理**的既有问题（与本轮无关）：

- `FileViewer.tsx` 的 `isEditing` 死代码在 PR-02b 已经删掉了，但 `hooks/useMarkdownFile.ts` 这个文件名现在名不副实——它只提供 `useTextFile`。改名的收益是零（要动 import），所以留着。
- iPhone 上 composer 里模型名与左侧 `+` 之间有一段空隙、名字看起来偏中——**这是既有的**（改之前的截图就是这样），不是本轮引入的，而且行本身不再溢出。要修的话是 `ModelSelector` 内部的 `flex: 1` 标签在窄列下的表现，属于另一件事。

---

## 10. 2026-09-24 第二轮：用户反馈的六个 bug

来自一次真实使用反馈，全部实测定位、实测验证。

| 症状 | 根因（实测） | 修法 | 验证 |
| --- | --- | --- | --- |
| 「**归档历史 / 项目归档 / 导入** 页面错乱、无法滑动」 | `.settings-dialog-main` 是 `overflow: hidden`，而 `.settings-section-host` 是 `height: 100%` 且**没有自己的滚动**。自带分栏滚动的面板（模型、插件）看不出来，纯块状面板超出部分被**直接裁掉且没有滚动条** | `.settings-section-host { overflow-y: auto }` 一行 | 导入页 `scrollable: true`、`canScrollToBottom: true` |
| 「**整个弹窗小了**」 | 弹窗固定 1080px / 84vh，里面还是 184px 导航 + 内容两栏 | `min(1400px, 100vw - 32px)` / 88vh | 实测 1400×880 |
| 「**项目归档栏目没必要**，已经有归档历史了」 | 两个导航项对应同一件事的两个粒度（项目 / 会话），看起来像两套互不相干的归档 | 合并成一页：`归档历史` 页里先渲染 `ProjectArchivePanel` 再渲染 `ArchivedSessionsPanel`，删掉 `projects` 导航项与图标。侧栏 ⋯ 的归档/恢复入口保留 | 导航 13 项、无 `projects`；归档页同时含两段 |
| 「**导入布局乱，没有按 agent 分类**」 | `~/.agents/skills` 既是**目的地**又被当成**来源**扫描 —— 这台机器上 104 个候选里 76 个是用户自己的技能，只可能 `skipped`。列表的大半是噪音，所以看不出分组 | 技能扫描只留外来源；目的地仍作为**来源诊断**上报（`error: "destination"` → UI 显示「已在你这边——这里是导入的落点」）。测试同步改成钉住新契约 | 会话页分组变成 **`pi 150` / `Codex 52` / `Claude Code 44`**（真实数据），诊断行含「OpenCode: 未找到」 |
| 「**文件树面板宽度初始化窄了**」 | 默认宽度 `min(vw*0.36, 560)`，而树列容器查询在 560–759 只给树 200px —— 面板永远落在「树很窄」那一档 | `getDefaultRightPanelWidth` 改成向**树列舒适宽度 760** 靠（`min(vw*0.5, 760, 视口能承受的上限)`），上限受聊天区最小宽度约束 | 1600px 视口实测 **759px**（was 384/560）；1024→380、1280→560、1440→720、1600+→760 |
| 「**模型浮窗距离那么远**」 | `openAbove = spaceAbove > spaceBelow`，而 composer 就在视口底部 → **永远朝上开**，且 `maxHeight` 取整个上方空间（可达 60vh），弹层一直顶到屏幕顶部 | 只在下方确实放不下（<260px）时才朝上；`maxHeight` 下限抬到 180 | 弹层底边与触发按钮间距 **6px**（was 最多 60vh），且完全在视口内 |

另外顺手换掉了品牌 logo（`public/pi-agent-logo.svg` ← 用户给的矢量文件）。新 logo 是 169×208 的竖向图形，原来按 22×22 正方形渲染会被压扁，改成固定高度 22、宽度按比例。

**三条没有做的，以及为什么**（都需要你确认口径再动手）：

1. `magic-context`**&#x20;替换记忆** —— 那个仓库 122 MB / 2196 stars，是一整套「自我管理的上下文记忆」系统（TypeScript 服务 + 存储 + 自己的生命周期），**不是能直接替掉&#x20;**`~/.pi/agent/memory`**&#x20;的格式替换**。要动的话得先定：是把它作为一个 pi 扩展接进来、还是把它的记忆模型搬到我们的 `记忆` 设置页、还是当成一个外部 MCP/服务？三者工作量差一个量级。

2. `pi-rewind` —— 9 KB 的极小项目，描述是「Rewind your pi session without git initialization」。按描述它最接近我们**已有的**「会话内分支 + `navigate_tree` + BranchNavigator」（回到某条消息之前）或**文件查看器的 diff**。需要你说是想让它在哪一步起作用（会话回滚？文件回滚？还是两者一起做快照）。

3. **刷新模型只能到 30（实际 34）** —— 只查到部分证据：`models.json` 里**没有任何 providers**，所以 opencode-go 是 pi 的**内置目录**（`models.generated.js`，42 条）；`/api/models-config/discover` 对我们自己的 provider 才生效，对内置 provider 会返回「Base URL is required」（我实测过）。`parseDiscoveredModels` 只按 id 去重、**没有任何上限**。所以「30」不是我们的截断。需要你说是哪个界面、点的哪个按钮（模型设置里的「从目录填入」？还是模型选择器里的列表？），以及那 34 个里缺的是哪几个。


---

## 11. magic-context 评估结论（2026-09-24）

**结论：它是 pi 扩展，我们兼容，可以装 —— 但它替换的是「压缩」，不是「记忆页」那么简单。**

### 兼容性（实测）

```
我们的 pi             0.87.0
@cortexkit/pi-magic-context 0.42.6
  peerDependencies    @earendil-works/pi-coding-agent >=0.80.2   ← 满足
  pi.extensions       ["./dist/index.js"]                        ← 就是 pi 扩展
```

MIT，2196 stars，v0.42.6，189 个 release，最后一次提交就是今天。它自称「coding agent 的
海马体」，核心是**用后台 historian 取代宿主的 compaction**，并在同一趟里把项目事实抽成
分层记忆。

### 与我们已有功能的重叠

| 我们的功能 | 它的对应 | 判断 |
| --- | --- | --- |
| **压缩上下文**（按钮 + `isCompacting` + 自动压缩） | historian 分级 compartment + 缓存稳定的 m[0]/m[1] | **真正的 drop-in**。它的设计前提就是「宿主别再自己压」——装它就要把我们的压缩路径关掉，否则两套同时改历史 |
| **记忆**（`/api/memory` + `pi-web-memory.json` + 记忆设置页） | SQLite：5 类记忆 + 按 `normalized_hash` 去重 + TTL + 嵌入 + dreamer 维护 + 4k token 贪心注入 | **能力被完全覆盖，但不能直接换**。它存在 `~/.local/share/cortexkit/magic-context/context.db`，我们读的是自己的 JSON。要展示就得写它的 DB reader —— 而它 schema 已经到 v90、有「版本不匹配就拒绝打开」的围栏，pre-1.0 迭代极快，**跟着它读库风险很高** |
| **会话搜索** / 用量 | `ctx_search`：一次查询覆盖记忆 + 原始消息（FTS5）+ git commit + notes + primers，向量 + FTS 回退 | 重叠，但它的检索是给**模型**用的（工具调用），我们的搜索是给人用的 UI。可以不合并 |

### 诚实的边界

1. **没有 API、没有可 import 的库**。只有宿主插件 + CLI + 一个 Tauri 面板。所以「接入」的
   唯一形态是**当 pi 扩展装进来**，不是调用它。
2. **MCP 那条路不可用**：只在 Rust 模块里，依赖仓库外的私有 path 依赖（`../commons`、
   `../subconscious`），它自己的文档写着「发布未实现、公共 CI 构建不了」。
3. **首用会下载约 90 MB 的 ONNX 嵌入模型**（transformers.js + `onnxruntime-web` pinned 到一个
   2026 dev build）。它还有 QuickJS 沙箱等一堆依赖。
4. **它自己的 known-issues 里有真 regression**：historian 失败、OpenCode2 卡住、
   `importance` 字段从未被写入（所以那个排序实际退化成 id 序）。
5. **一次装进来的不是「一个功能」，是它整套世界观**：它会同时接管压缩、记忆、检索。
   我们的记忆页、压缩按钮、记忆文件都会变成并行的第二套真相。

### 建议的下一步（未执行）

**先试，再改。** 用我们已有的插件页把它作为全局 pi package 装一次，在一个会话里跑一天，
看三件事：① 压缩还卡不卡（我们关心的其实是这个）；② `context.db` 里积了什么；
③ 我们的记忆页/压缩按钮要不要关。

**不要**现在就去写它的 DB reader —— 跟着一个 pre-1.0、schema v90 的库读数据，比我们自己
实现那 5 类记忆贵得多。等它 1.0 或至少 schema 围栏松动了再说。
