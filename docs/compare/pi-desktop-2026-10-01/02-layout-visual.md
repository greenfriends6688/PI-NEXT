# 布局 / 视觉 / 设计系统对比（本仓库 ↔ PI-Desktop 0.16.0-beta.1）

分析日期：2026-10-01
本文只管**布局骨架 + 视觉系统**，不管功能与交互手感。
纪律来源：`design/pi-web-design/DESIGN-SPEC.md`、`design/pi-web-design/DIVERGENCE.md`、`docs/design-skin-swap-plan-2026-09-29.md`。
三条不可抄约束（数据模型 / 进程模型 / 设计系统不混）见 `FACTS.md`，本文所有建议均已按其过滤。

---

## 0 · 结论先行

1. **他们的三栏比我们的窄一个数量级，而且是真约束，不是默认值。** 他们侧栏 240–520（默认 275）、工作面板 244→按剩余空间（默认 360）、聊天列 760（可拖 560–），并且把 **450px 主列地板** 写成常量 `MAIN_PANE_MIN_WIDTH`（`lib/work-panel-resize.ts:16`），侧栏在预算不够时**自动让位/自动折叠**（`lib/work-panel-resize.ts:92-131`、`lib/sidebar-resize.ts:51-78`）。我们的对应数字是 220–480（默认 280）、面板 300–1200（默认 420 / 树文档并排要 760），主列地板 420（`lib/panel-layout.ts:7-26,64`）。**我们的面板默认 760 是被"树 + 文档并排"逼出来的**，他们不需要——他们的文件 tab 是单列的（`styles/work-panel.css:740-760` + `components/workpanel/FilesTab.tsx:405`）。这是本轮最值钱的一条结构差异。
2. **他们的密度来自"内容自撑 + 字阶缩放"，我们的密度被虚拟化钉死。** 他们的会话行 `min-height: 28px`（`styles/sidebar-threads.css:9`），行高随 `--leading-row: calc(18px * var(--font-scale))` 走；我们的会话行是**固定** `48 / 58px` 的虚拟化常量（`components/SessionSidebar.tsx:36-38`），连带 `lib/ui-density.ts:11` 自己承认密度开关**碰不到侧栏列表**。这是我们密度体系里最大的一个洞。
3. **他们把"折叠判据"做成了纯 CSS 容器查询，我们做成了 React state。** `styles/composer.css:50` 声明 `container-type: inline-size`，然后在 `responsive.css:46/57/63` 与 `composer.css:671/686/698` 上写了 5 档 `@container`。我们对应的是一个 ResizeObserver + `useState` 阈值 700（`components/ChatInput.tsx:239,966-975`）。他们的做法**不触发重渲染**，我们的会。这条可以低成本搬。
4. **他们的设置是一个整页，我们是一个 560px 的模态。** 他们的设置 `hidden` + `inert` 掉整个壳、切到 `settings-mode`（`features/app/AppShell.tsx:110-114,310-314`），左导航 275px 常驻、**分组 + 可搜索**（`features/settings/SettingsPage.tsx:315-336`）。我们的 `SETTINGS_SECTION_VALUES` 10 项、**扁平、不可搜索**（`lib/settings-navigation.ts:1-16`），容器是 `.pw-modal`（`components/SettingsPanel.tsx:1038`）。DIVERGENCE U-1 记的"设置页呼吸节奏不是画板那一回事"多半就是这个根因。
5. **他们的视觉系统是 10 档圆角 / 13 档字号 / 5 档字重 / 零强调色；我们是 3 档圆角 / 5 档字号 / 2 档字重 / 单一强调色。** 这是**刻意的品牌选择**（他们刻意对齐 Codex 单色灰），不要抄。但其中**两件事解决了我们真实的痛点**：①`--font-scale`（0.8–1.5，步长 0.025）让字号可缩放且能流进行高；②半径/字号由**门禁强制**（`scripts/check-style-tokens.mjs` 拒绝裸字面量），我们的门禁只查"我们的 `pw-*` 有没有被第二处定义"。
6. **他们的画板体系不存在。** 视觉真值是 1432 行散文规范（`docs/spec/04-ux/07-ui-design-system.md`）+ 一个 token lint；我们有 30 张 HTML 画板 + 49 份几何对位 spec + 五道门禁。**他们的任何视觉决策都不能"照抄进产品"，只能先决定要不要进画板。** 见第 7 节。

---

## 1 · 整体布局骨架

### 1.1 逐个量

| 维度 | 他们 | 我们 | 证据 | 置信度 |
|---|---|---|---|---|
| 侧栏默认宽 | **275px** | **280px** | `pi参考项目/PI-Desktop-main/apps/desktop/src/lib/sidebar-preferences.ts:46-48`；`lib/panel-layout.ts:7` | [已验证] |
| 侧栏最小/最大 | **240 / 520**，拖到 <**160px 直接折叠**（保留首选宽）；指针/键盘步进 16，双击回默认 | 220 / 480，键盘步进 12（Shift 32） | `lib/sidebar-resize.ts:10,16,38,47-49`；`lib/sidebar-preferences.ts:46-48`；`hooks/useResizablePanel.ts:200`；`lib/panel-layout.ts:8-9` | [已验证] |
| 侧栏宽度上限来源 | 纯 CSS 视口夹取：`clamp(240px, 275px, min(520px, calc(100vw - 320px)))` + JS 预算双保险 `sidebarWidthBudget()` | 纯 JS `getSidebarMaxWidth(viewport, panelOpen, panelWidth)` | `styles/tokens.css:154`；`lib/sidebar-resize.ts:51-78`；`lib/panel-layout.ts:69-83` | [已验证] |
| 侧栏折叠态 | **宽度归零**，整个 `<Sidebar>` 卸载（`!sidebarCollapsed \|\| sidebarExiting ? … : null`），**没有图标导轨** | 保留 **52px 图标导轨** `.pw-rail` | `features/app/AppShell.tsx:112-124`；`styles/chrome.css:355-380`（keyframe 到 width:0）；`components/AppShell.tsx:2577`；`design/pi-web-design/assets/tokens.css:144` | [已验证] |
| 导轨（他们有没有） | CSS 里**有** `.sidebar-rail { width:56px }`（`styles/chrome.css:419-425`），但**没有任何 TSX 渲染它**（全仓 `grep sidebar-rail` 只命中 CSS + `electron/main/bootstrap/window.ts:1090` 的探测分支） | 画板 02 帧 C 有，spec `scripts/board-specs/02-sidebar-rail.mjs` 守着 | 同左 | [已验证] |
| 工作面板默认/最小 | **360 / 244**；**无上限**，上限 = 剩余预算（宽窗可以一路长到主列只剩 450） | 420（只有树）/ 760（树+文档并排）；300–1200 | `lib/work-panel-resize.ts:4-5,34-40`；`lib/panel-layout.ts:20-22,52-58` | [已验证] |
| 主列硬地板 | **450px**（`MAIN_PANE_MIN_WIDTH`，注释写明由 composer 工具栏展开行反推，取代 ADR 0226 的 515px）；重开侧栏目标 460 | 420（`DESKTOP_CHAT_MIN_WIDTH`） | `lib/work-panel-resize.ts:16-17`；`lib/panel-layout.ts:25` | [已验证] |
| 三栏预算不够时 | **侧栏先让**：面板封顶 → 仍不够则 `shouldCollapseSidebar` → `autoCollapseSidebar` | 只 reclamp 两侧宽度，**不自动折叠侧栏** | `lib/work-panel-resize.ts:92-131`；`features/app/useAppShellRuntime.tsx:59-62,115-122`；`components/AppShell.tsx:379-381` + `hooks/useResizablePanel.ts:195-197` | [已验证] |
| 面板"最大化" | 有：`workPanelMaximized` 时 **MainChat 根本不渲染**，面板吃满除侧栏外的全部宽度 | **无**（`grep maximize components/AppShell.tsx` 0 命中） | `features/app/AppShell.tsx:126-150,259-273`；`lib/work-panel-resize.ts:100-111` | [已验证] |
| 聊天内容列宽 | 默认 **760**，可拖 **560 起**，双侧各一条 12px 命中区（rest 态 2×40px 胶囊，拖拽时 2×56px） | 800 定宽（`--chat-max`），可调 640–2000（`hooks/useChatAppearance.ts:5-7`） | `packages/shared/src/chat-content-width.ts:9-10`；`styles/chat-shell.css:48,423-500`；`components/ConversationWidthHandles.tsx:36-48` | [已验证] |
| 顶栏高 | **46px**（`--ds-toolbar-height`），且同时是工作面板头高 | **36px**（`--topbar-height`） | `styles/tokens.css:159`；`styles/work-panel.css:132`；`design/pi-web-design/assets/tokens.css:147` | [已验证] |
| 面板头 / 标签条 | 头 46 + 标签条 32 + tab 高 **28**、min-w 92 / max-w 180、圆角 10、gap 6、拖拽排序有 2px 插入指示条 | 标签条直接是 `.pw-tabs`（gap 2 / 发丝底线），tab 高 **26**、圆角 4 4 0 0、字号 11px | `styles/work-panel.css:132,184-201,202-215,225-244`；`design/pi-web-design/assets/board.css:568-575` | [已验证] |
| 工作区角色对调 | **无** | **有**（`workspaceSwapped`，grid-area 互换，永不重挂） | `app/globals.css:1928-1935`；`components/AppShell.tsx:2582` | [已验证] |
| 面板列布局 | **单列**：文件 tab = 树在上 / 查看器在下（`.work-panel-main { flex-direction:column }` + `.file-tree { flex:1 }`） | **双列**：树 248 + 查看器并排，<560 退回单列、560–759 退到 200 树 | `styles/work-panel.css:70-79,740-760`；`components/workpanel/FilesTab.tsx:405`；`lib/panel-layout.ts:38-39`；`app/fork-ui.css:433-449` | [已验证] |

### 1.2 断点行为（两边都不一样，而且我们内部还有第四个数字）

| | 他们 | 我们 |
|---|---|---|
| 声明处 | 只有 `@container`（组件自身宽度），**几乎没有视口断点**；`styles/responsive.css` 里唯一的视口查询是 `@media (max-width:720px)` 给插件页工具条 | 三个视口 hook（≤640 / ≤480 / ≤1024，`hooks/useIsMobile.ts:6,9,18`）+ 三个 media query（641 / 960 / 3200 见 `app/globals.css:1805,1913,1986`） |
| 面板分栏起点 | 无（面板永远是单列） | **960px**（`lib/panel-layout.ts:2`、`app/globals.css:1913`） |
| 合规性 | — | ⚠️ `DESIGN-SPEC.md` §4 断点表只承认 1024 / 640 / 480 三条，并写明"断点数值直接抄 hooks/useIsMobile.ts 的三条 media query，不允许在画板里另取整"。**960 是第四个、没有进 token 表也没有进画板 60 的数字。** [已验证] |

> 判断：960 不是笔误（它有 `SPLIT_PANEL_MIN_WIDTH` 的独立语义），但它是**未登记的第四档**。要么把它写进画板 60 的断点表并落成 `--break-*` token，要么把它并回 1024。这条属于画板纪律范畴，不是他们的功劳。

### 1.3 workpanel 概念差异（真正的结构差）

| | 他们 | 我们 |
|---|---|---|
| 面板里能开什么 | `new`（空白启动页）/ `review`（diff）/ `file` / `plugin`（插件视图）/ `subagent`（子代理转录）五类，**插件可贡献新 tab** | 文件 / 终端 / 浏览器 / git-graph / 会话分支，单一 `Tab` 类型 + `kind` 联合（`components/TabBar.tsx:16-26`） |
| tab 的归属 | **按会话**：`Record<sessionId, WorkPanelContext>`，切会话时面板恢复成那个会话自己的 tab 集（`lib/work-panel-tabs.ts:39-60`） | **工作区全局**：`useState<Tab[]>` 一份，tab 上只挂一个 `sourceSessionId` 标记（`components/AppShell.tsx:628`、`TabBar.tsx:22`） |
| 新增动作 | 头里没有下拉：`+` **直接开一张真的空白 tab**，工具选择在那张 tab 的 body 里（`docs/spec/04-ux/07-ui-design-system.md:570-576`、`styles/work-panel.css:470-540`） | 顶栏已有"更多控件"折叠菜单 |

---

## 2 · 页面 / 视图模型

| | 他们 | 我们 |
|---|---|---|
| 模型 | **pages + 会话内 workpanel tabs**：`page: "chat" \| "scheduled" \| "plugins" \| "settings"`（`stores/app-state.ts:183`） | **tab**：`TabBar`（文件/终端/浏览器/git-graph）+ 设置模态，无 page 概念 |
| 导航历史 | **有 `navStack`**，上限 50 条，含 `page + sessionId`，支持 back/forward（`stores/slices/interaction-slice.ts:62-90`） | 无。我们切会话/切文件都不可回退 |
| 设置的容器 | **整页**：`app-chat-shell` 被 `hidden` + `inert`，壳类加 `settings-mode`（`features/app/AppShell.tsx:110-114,309-314`）；左导航 `--ds-settings-nav-width: 275px` 常驻 | **模态** `.pw-modal`（`components/SettingsPanel.tsx:1033-1062`，`--modal-w: 560px`） |
| 设置导航 | 14 个 tab、**4 个分组 + 顶部搜索框 + 空态**（`features/settings/SettingsPage.tsx:296-336`） | 10 个、扁平、无搜索（`lib/settings-navigation.ts:1-16`） |
| 设置分区内容 | 条件渲染，**同一时刻只挂一个 tab**（`SettingsPage.tsx:412-581`） | 12 分节也是条件渲染（`components/SettingsPanel.tsx`） |
| 会话窗保活 | 每个访问过的会话保一个 pane，靠 `position:absolute + visibility:hidden + content-visibility:hidden` **保住滚动位置**（`styles/chat-shell.css:88-99`、`ChatSurface.tsx:196-203`） | 无（`grep retainedSessionIds components/` 0 命中） |
| 路由切换的过渡 | `route-surface` + `RoutePending`，`prefers-reduced-motion` 有专门条目（`styles/responsive.css:107-118`） | 不适用 |

> 判断：**navStack（50 条、含 sessionId）是本节最值得搬的一条**——它解决的是我们真实存在的痛点（切换文件/会话后没有退路），且纯前端 localStorage，不碰数据模型。他们的 page/tab 二元模型我们**不需要**（我们有角色对调 + 更强的右栏内容），不抄。

---

## 3 · 侧栏

### 3.1 结构

| 项 | 他们 | 我们 | 证据 |
|---|---|---|---|
| 分段 | 品牌头 / **置顶会话** / **临时会话** / **项目** / 页脚（设置·日志·版本 chip） | 品牌头 / 新建任务 / `项目·聊天` 分段控件 / 搜索 / 列表 / 页脚 | `components/Sidebar.tsx:2296-2500`；`components/SessionSidebar.tsx:1605-1725` |
| 段标题的右键菜单 | 有（`openSectionMenu`，`Sidebar.tsx:2357-2364,2431-2439`） | 无 | 同左 |
| 项目行 | 名称 + pin 点 + active 点 + `⋯` 菜单（归档/重命名/移除/打开文件夹） | 同类（`SessionSidebar.tsx:495-590`） | — |
| 项目可拖拽排序 | 有（`lib/sidebar-project-reorder.ts`、`is-drop-before/after`） | 有（`useProjectDrag`，`SessionSidebar.tsx:447-500`） | — |
| **会话可拖拽排序** | **有**：自定义 MIME `application/x-pi-desktop-session`（`Sidebar.tsx:107`）+ `SessionMeta.order`（`lib/sidebar-preferences.ts:20-26`）+ `SessionSort = "manual"`（`lib/sidebar-preferences.ts:158-163`） | **无**：会话只有 pinned/archived，无 `order`（`lib/session-flags.ts:5-9,29-31`） | — |
| 每组默认渲染条数 | **10 条** + "load more"（`Sidebar.tsx:17,1808,1840`） | 全量虚拟化（`SessionSidebar.tsx:83-90`） | — |
| 组内滚动上限 | pinned `min(233px, 30vh)`、临时会话 `146px`（`styles/sidebar-threads.css:272,301`） | 不限，靠虚拟化 | — |
| 折叠状态持久化 | `ProjectMeta.collapsed` + `openProjectPaths[]` 一起存（`lib/sidebar-preferences.ts:33-42`） | 跟随选中项目自动展开，无持久化（`SessionSidebar.tsx:1451`） | — |
| 归档的形态 | **不占区块**，是会话区的一个 `menuitemcheckbox` 开关（`Sidebar.tsx:2065-2067`），归档行 `opacity:.68`（`styles/sessions.css:325-328`） | 项目有归档区（默认折叠），**会话归档一律去「设置 → 归档历史」**（`SessionSidebar.tsx:2084-2085`） | — |
| 空态 | 每段各有 `sidebar-session-empty` 文字态（`Sidebar.tsx:1992,2425`） | 有（`.pw-empty` / 空态首屏） | — |
| 折叠搜索 | **无搜索框**（项目区只有右键菜单 + `+`） | 搜索是**状态**，默认收起（`SessionSidebar.tsx:680-711`） | — |

> 判断：他们侧栏最值得看的一条是 **"归档 = 一个开关"而不是"一个区块"**。我们的项目归档区是默认折叠的常驻区块（`SessionSidebar.tsx:662`），在项目多的时候它跟置顶区、项目区争夺同一条竖列。但**这是我们的既有产品决策**（`lib/project-flags.ts` + `ProjectArchivePanel` 都在），收益不足以动结构，记为"不建议"。

### 3.2 会话行的状态标记（两侧正好相反，且都有道理）

| | 他们 | 我们 |
|---|---|---|
| 位置 | **左侧**：`position:absolute; left:4px; top:50%`，12×12（`styles/sessions.css:330-335`） | **右侧**：`N 条消息` 之后；DESIGN-SPEC §2.6 明文写"会话行左侧不放任何状态标记"（`design/pi-web-design/assets/board.css:165-213`） |
| 行高 | **恒定 28px**，状态是绝对定位覆盖，不改布局 | **48 → 58** 随状态变化（`.pw-session.running/.awaiting { height:58px }`），并要求虚拟化算两套行偏移（`SessionSidebar.tsx:60-75`） |
| 未读/运行 | `running` 用一个 2px 高伪元素，`permission` 同（`sessions.css:344-357`） | 1px 底线 + 96px 扫掠线 + 6px 圆点（`board.css:180-205`） |

> 判断：**左侧 vs 右侧不改**（两侧都是刻意选择，我们的 §2.6 有完整理由）。但"48→58 变行高"这条**解决的是我们的真实痛点**：状态一变整列重排 + 虚拟化偏移要单独算，是 `SessionSidebar.tsx:60-75` 那套 `rowOffsets` 存在的唯一原因。见建议 #3。

---

## 4 · 信息密度与排版（token 对照表 · 全部读自定义处）

### 4.1 字阶

| 档位 | 我们（`app/design/tokens.css:105-112`） | 他们（`apps/desktop/src/styles/tokens.css:322-336`） |
|---|---|---|
| 最小 | `--text-meta: 11px` | `--text-3xs: 10.5px`（`styles/tokens.css:352`） |
| | — | `--text-xs: 11px` / `--text-xs-plus: 11.5px` |
| | — | `--text-sm: 12px` / `--text-sm-plus: 12.5px` |
| | `--text-secondary: 12px` | （同上） |
| | `--text-mono: 12.5px` | `--text-md: 13px` / `--text-md-plus: 13.5px` |
| 正文 | `--text-body: **13px**` | `--text-base: **14px**` |
| | — | `--text-base-plus: 15px` |
| 标题 | `--text-title: 15px` | `--text-lg: 16px` / `--text-lg-plus: 18px` |
| 空态大字 | `--text-display: 20px` | `--text-xl: 20px` / `--text-2xl: 28px`（页面标题 `page-title` 用它，`styles/theme-overrides.css:14-20`） |
| 档数 | **5**（+等宽 1） | **13**（含 5 个半档 `*-plus`） |
| 用户可缩放 | ❌ 无全局缩放；只有转录列字号（`hooks/useChatAppearance.ts:5-7,43-52`，且 `snapUserTextSize` 强制吸附到 5 档） | ✅ `--font-scale` **0.8–1.5，步长 0.025**，预设 0.85/1/1.15/1.25（`packages/shared/src/font-size.ts:10-19`），**乘到整个 `--text-*` 坡度与 `--leading-row`** |

行高：我们 2 档（`--lh-body:1.5` / `--lh-control:1.35`，`tokens.css:113-114`）；他们 11 档（`1 / 1.15 / 1.2 / 1.25 / 1.3 / 1.35 / 1.4 / 1.45 / 1.5 / 1.55 / 1.6`，`styles/tokens.css:372-384`）。
字重：我们 2 档 400/500（DESIGN-SPEC §1.5）；他们 5 档 400/500/**520**/**560**/600（`styles/tokens.css:366-371`）。
字距：我们无（DESIGN-SPEC §1.6 未收）；他们 4 档 −0.03 / −0.02 / 0 / +0.02em（`styles/tokens.css:386-389`）。

### 4.2 圆角 / 间距 / 控件高

| | 我们 | 他们 |
|---|---|---|
| 圆角 | **3 / 4 / 6**（+ pill），"不出现 8 以上"（`tokens.css:96-99`，DESIGN-SPEC §1.3） | **4 / 6 / 8 / 10 / 12 / 14 / 16 / 18 / 20 / 24**（+ 9999 / 50%），10 档（`styles/tokens.css:334-345`） |
| 间距 | 4px 网格 `--s1…s6 = 4/8/12/16/24/32`（`tokens.css:90-96`） | 无统一间距坡度，实际值散布（`gap:2/5/6/8/10/12/16/20`） |
| 控件高 | **22 / 24 / 28 / 32 / 36**（`tokens.css:126-131`） | `--ds-control-size: 28`（方形图标钮，`styles/tokens.css:162`）；输入框是**公式** `calc(18px + var(--text-base) * var(--leading-body))` = 14×1.45+18 ≈ **38.3px**，注释说明"所以缩放字号时它跟着走"（`styles/tokens.css:163-171`） |
| 图标 | 16px 网格 / 14px 小 / 描边 1.5（`tokens.css:132-135`） | 无描边 token；图标盒 15px（`styles/work-panel.css:723-733` 注释"锁 15px，行不跳"） |
| 阴影 | **2 个**：popover `0 4px 12px rgba(28,28,35,.10)` / modal `0 12px 32px …, 0 2px 8px …`（`tokens.css:90-91`） | 3 个 + 1 条描边：dialog `0 16px 48px rgba(0,0,0,.55)`（`:147`）、composer `0 3px 7.5px #0000000a, 0 0 20px #0000000d`（`:152`）、`--ds-elevation-stroke: 0 0 0 .5px …`（`:150`） |
| 滚动条 | 桌 **8px** / 移动 6px（`design/pi-web-design/assets/board.css:488`、DESIGN-SPEC §4 移动端硬约定） | **全局 6px，无轨道，静默**（`docs/spec/04-ux/07-ui-design-system.md:492-500`） |

### 4.3 组件级密度（同一部位并排）

| 部位 | 他们 | 我们 |
|---|---|---|
| 会话行 | `min-height:28`，`padding:5px 6px 5px 20`，标题 13px / `line-height: var(--leading-row)`（`sidebar-threads.css:9,25-40`） | `height:var(--row-height)=48`，`padding:0 8`，标题 13px + **第二行 11px 元信息**（`board.css:165-177`） |
| 侧栏普通行 | `min-height:28`，圆角 10（`sidebar-threads.css:8-11`） | `.pw-row height:30`，圆角 4（`board.css:137-139`） |
| 面板树行 | `padding:3px 0 3px 0`，字号 12，圆角 6（`styles/work-panel.css:747-763`） | `.pw-trow height:var(--tree-row)=24`，字号 12，圆角 4（`board.css:579`） |
| 面板标签 | 高 28 / min-w 92 / max-w 180 / 圆角 10（`work-panel.css:202-215`） | 高 26 / 无 min-max / 圆角 4 4 0 0（`board.css:569-573`） |
| 用户气泡 | `max-content` + `max-width:100%`，`padding:10px 15px`，圆角 18 / 右下 8，字号 **14px** / 行高 **1.55**（`styles/chat-shell.css:15-26`） | `max-width:78%`，`padding:8px 12px`，圆角 **6**（四边一样），字号 13 / 1.5（`board.css:267-271`） |
| Composer 外壳 | 圆角 **24**，**无描边**，只靠 `0 3px 7.5px + 0 0 20px` 抬起（D297，`styles/tokens.css:152`、`composer.css:162-173`） | 圆角 **6**，**有 1px 描边 + `--shadow-popover`**（`board.css:516-520`） |
| Composer 输入 | `min-height: 3lh; max-height: 7lh`（≈61–142px），外层 wrap `min-height:44`（`composer.css:187-194,270-274`） | `.pw-composer-top min-height:46` + 芯片行 + `.pw-composer-bar`（`board.css:516-522`） |
| 设置左侧导航 | **275px** 常驻列（`styles/tokens.css:155-157`） | 在 560px 模态里分一半 → 内容列 ~250px（DIVERGENCE 189 记的 `.pw-tab` 440px 拉满整行就是这个根因） |

### 4.4 密度开关的真实状态（我们的洞）

- 我们有 `useUiDensity`（compact 0.85 / standard 1 / comfortable 1.15，`lib/ui-density.ts:16-24`），但**明确不覆盖侧栏会话列表**，原因写在文件头：列表虚拟化在固定 `SESSION_LIST_ITEM_HEIGHT` 上（`lib/ui-density.ts:8-12`、`SessionSidebar.tsx:36`）。
- 我们的字号缩放只有转录列一路（`hooks/useChatAppearance.ts:5-7,43-52`），**顶栏、侧栏、设置都不跟着变**。
- 他们把这两件事合成一个 `--font-scale`，且因为行高是 `min-height` + `line-height: var(--leading-row)`（`sidebar-threads.css:9,39`）所以**行高会跟着缩放**，不需要改虚拟化。

> 这是 §4 里唯一一条我判定"值得进画板"的（见建议 #3）。

---

## 5 · 主题

| 项 | 他们 | 我们 | 证据 |
|---|---|---|---|
| 内置档位 | `system / light / dark` 三档，**没有别的**（`packages/shared/src/theme.ts:41-44`） | light/dark/auto（历史另有 Mist/Rose/Pine + 皮肤工作室，`DESIGN-SPEC` DIVERGENCE A-1） | — |
| 插件主题 | ✅ `ThemePreference = \`plugin:${pluginId}:${themeId}\``，插件贡献 `contributes.scenicThemes`（**1–12 张卡**，必须带 `previewAsset`，`packages/plugin-sdk/src/index.ts:1777-1795`），设置页 `ThemeRow` 把插件主题列在分隔线之后（`components/settings/ThemeRow.tsx:5,62-70`） | ❌ 无（我们的插件是 pi package，语义不同） | — |
| 壁纸 / 背景图层 | ✅ 三个层：`.app-scenic-backdrop` 固定底层（`styles/base.css:183-188`）+ `--ds-bg-sidebar-image`（`styles/tokens.css:42-47`）+ macOS 原生 vibrancy 上叠一层 tint/sheen（`styles/chrome.css:435-452`）。插件主题还能调 **backdrop blur**（`PluginScenicThemesDestination.tsx:49,84-102`） | ✅ 有壁纸（`hooks/useWallpaper.ts`、`app/wallpaper.css` 250 行）+ 侧栏半透明 | — |
| 强调色 | **零色相强调**：`--ds-accent: var(--gray-0)`（暗，`styles/tokens.css:103`）/ `#1a1c1f`（亮，`:252`）。语义色三枚 + 一枚 purple（暗 `:142-146`、亮 `:279-283`） | 单一强调 `#5566d8` + 4 语义 + 5 色相上限（DESIGN-SPEC §1.1） | — |
| 字体族可换 | ✅ `FontFamilyRow`，只列**已安装系统字体**，每条 stack 强制追加 CJK 回退 `"PingFang SC","Hiragino Sans GB","Microsoft YaHei"`（`lib/fonts.ts:14,39`） | `useUiFont` | — |
| 密度档位 | ❌ 无独立密度档；密度由 `--font-scale` 隐式承担 | ✅ 三档但**只覆盖部分表面** | — |
| 分隔方式 | **D297：页内表面一律不画描边**，结构靠三层色调 + 间距（`docs/spec/04-ux/07-ui-design-system.md:572-574`、`styles/tokens.css:97-101` 的 `--ds-tile/tile-hover/tile-deep`） | 1px 发丝线为主（DESIGN-SPEC §1.2 明文"不用阴影分层"） | — |

> 判断：**彩色图标 / 更大圆角 / 零强调色 = 刻意的品牌选择，不建议改**（他们在 `tokens.css:11-13` 自己写着 "Accent is neutral gray-scale (not blue) so chrome, markdown, and plugins stay monochrome"，这是设计意图不是疏漏）。
> 但 **scenic theme 这套"背景图层 token 化"（`--ds-bg-sidebar-image` / `--ds-bg-sidebar` 分开）值得进画板**：他们把"颜色"和"图片图层"拆成两个变量，于是 macOS 原生材质、插件壁纸、纯色三件事共用一套变量。我们现在壁纸是 `app/wallpaper.css` 里一整套覆盖（250 行），语义没分层。这条解决的是我们真实的"换壁纸要改很多处"痛点。

---

## 6 · 特殊视图

| 视图 | 他们 | 我们 | 判断 |
|---|---|---|---|
| 启动 splash | `StartupSplash`：64px BrandLogo + 名称 + tagline + 进度条（`components/StartupSplash.tsx:12-30`）；macOS 用玻璃材质不画不透明底（`styles/chrome.css:431-434`） | 无 | **可做**：PWA 首屏现在没有"正在启动"的可视反馈。低成本，见建议 #7 |
| 启动失败 | `StartupRecovery`，五相位 + 已等待时长 + 重试（`features/app/AppShell.tsx:88-99`、`components/StartupRecovery.tsx`） | 有路由级错误页（画板 61） | 已有对应物 |
| 空态首屏 | **mascot 100px GIF + H1（标题里内嵌项目切换器）+ onboarding 清单**，**没有起始提示卡**（`components/ChatSurface.tsx:154-190`） | 40px 占位 mark + H2 + **2×2 四张起始卡**（`board.css:474-486`） | 起始卡是我们的选择，**不改**；mascot 见下 |
| Onboarding | `OnboardingChecklist`：5 步（加供应商/存密钥/开项目/发第一条/装插件），每步直接 `setPage/setSettingsTab` 深链，全做完或手动 dismiss 才消失（`components/OnboardingChecklist.tsx:6-63`） | ❌ 无 | **值得进画板**：我们零会话起步只有静态三卡（画板 01 帧 D），没有"引导下一步" |
| 项目切换器（空态内嵌） | `HomeProjectSwitcher`，384 行，行内切换（`components/HomeProjectSwitcher.tsx`） | 有（顶栏 workspace chip） | 已有 |
| 更新横幅 | `UpdateBanner`：只有"可安装/下载中/手动模式有新版本"三种才出现，其余静默；带 release notes 折叠列表（`components/UpdateBanner.tsx:42-60`） | 有更新五态（画板 56） | 已有 |
| 通知中心 | `NotificationCenter` 395 行：全部/未读两档过滤，**收件箱只显示 `kind !== "task.completed"`**（`lib/notification-inbox.ts:12-17`） | 只有 toast（`pw-toast`，≤3 条 6s） | 值得评估，但偏功能，画板成本高 → 见建议 #9 |
| 后端故障横幅 | `backend-banner` + `archMismatch` 两条常驻状态条（`features/app/AppShell.tsx:180-222`） | ❌ | Electron 壳场景才需要，**不建议** |
| 品牌标记 | `BrandLogo` 双主题 PNG + MutationObserver 跟随 `data-theme`（`components/BrandLogo.tsx:7-27`）；规范写死 侧栏 20/18、splash 64、**composer 提示行不带品牌图标**（`docs/spec/04-ux/07-ui-design-system.md:126-131`） | 多色渐变 logo + 字标，浅色用图/深色用文字（DIVERGENCE A-2 / T-187） | 已有，且我们的是所有者裁定的品牌资产 |
| mascot（100px 动图） | ✅ 8 帧挥手 GIF，`prefers-reduced-motion` 下换成静帧 PNG、**尺寸槽不变**（`styles/chat-shell.css:731-760`） | ❌ | **不建议抄**：DESIGN-SPEC §3 禁一切图片素材进画板，我们没有"帧动画资产"这条流水线。若要做只能进 `brand/`，不进画板 → 不建议 |

---

## 7 · 画板体系本身（他们没有的东西，以及他们的哪些视觉决策值得进画板）

### 7.1 两套真值体系的对比

| | 我们 | 他们 |
|---|---|---|
| 视觉真值载体 | 30 张 HTML 画板（1440×900 / 800×内容 / 1200×800）+ 390 行 `DESIGN-SPEC.md` | **没有画板**。1432 行散文规范 `docs/spec/04-ux/07-ui-design-system.md`（含 markdown 里的 token 表） |
| 几何门禁 | **49 份** `scripts/board-specs/*.mjs` + `board-diff-all.mjs` + `verify-against-boards.mjs`（真 Chrome 逐帧对 `getBoundingClientRect`） | ❌ 无。**只有 token lint**：`scripts/check-style-tokens.mjs` 扫全部 `.css/.tsx`，拒绝非 `var()` 的 `font-size/font-weight/line-height/letter-spacing/border-radius` 与 `text-[…]/rounded-[…]` 任意值 |
| 其他门禁 | `check-style-literals` / `check-motion-tokens` / `check-icons` / `check-boards` / `check-align` / `check-contrast` | `style-surface-tokens.mjs`（禁裸 hex / color 函数）、`check-architecture.mjs` |
| 双写检测 | ✅ 画板里用到的每个 `pw-*` 必须在 `board.css` 有定义（`scripts/check-icons.mjs` + `check-boards.mjs`） | ✅ 同类（token lint） |

> 结论：**画板体系是我们相对他们的结构性优势，本轮没有任何一条建议是"降低门禁"。** 他们唯一比我们强的地方是"规范也用门禁执行"这一点，而这一条我们其实已经有了（`check-style-literals` + `style-literal-baseline.json`）。

### 7.2 他们的视觉决策里，哪些值得进画板

判据：**是否解决我们一个已经写在 DIVERGENCE / 计划里的真实痛点**。不满足的一律不写进画板。

| 候选 | 解决我们的什么痛点 | 建议 |
|---|---|---|
| **单列工作面板**（树在上、查看器在下） | 我们面板默认 760、被"并排"逼的（`lib/panel-layout.ts:52-58`），1440 屏上侧栏 280 + 面板 760 = 聊天只剩 400 | ✅ **值得进画板**（重画板 30）。这是本轮价值最高的结构建议 |
| **`--font-scale` 全局缩放 + 行高内容自撑** | 我们的密度开关碰不到侧栏（`lib/ui-density.ts:8-12`）、字号缩放只覆盖转录列 | ✅ **值得进画板**（改画板 02 + 01 帧 A，并解决虚拟化常量） |
| **容器查询做折叠判据** | 我们用 ResizeObserver + state（`ChatInput.tsx:966-975`），每次跨档触发重渲；换肤计划 §5 已把这条列为陷阱 | ✅ **值得进画板**（画板 20/60 的断点表加一列"容器判据"） |
| **主列 450px 硬地板 + 侧栏先让 + 面板自动折叠** | 我们只 reclamp 不折叠（`AppShell.tsx:379-381`），窗口变窄时聊天被压到 420 以下 | ✅ **值得进画板**（画板 01 帧 C + 60 断点表） |
| **面板"最大化"（MainChat 不渲染）** | 我们面板最大 1200（`panel-layout.ts:22`），没有"我要专心看这个文件/这个 diff"的形态 | 🟡 **可选**。价值中，但会新增一个状态类 → 画板 31 要加一帧 |
| **背景图层与颜色分层**（`--ds-bg-sidebar-image` vs `--ds-bg-sidebar`） | 我们壁纸是一整套覆盖（`app/wallpaper.css` 250 行） | 🟡 **值得进画板**（画板 47 壁纸选择器），但要先确认不与"禁图片素材"冲突 |
| **设置整页 + 分组导航 + 搜索** | 我们 10 项扁平 + 560 模态，DIVERGENCE U-1 记的排版问题多半源于此 | ✅ **值得进画板**（重画板 40 + 62） |
| **会话行左侧状态点 / 28px 恒定行高** | 我们的 48→58 会引发行重排 | 🟡 **只抄"行高恒定"**，"左侧状态点"是他们的选择，不抄 |
| 10 档圆角 / 13 档字阶 / 5 档字重 / 零强调色 | —— | ❌ **不建议**。刻意的品牌选择（`styles/tokens.css:11-13` 自述） |
| composer 圆角 24 + 只用阴影抬起 | —— | ❌ **不建议**。DESIGN-SPEC §1.2 硬约束"不用阴影分层"；且我们带强调色，24px 圆角会读成一块大底色 |
| 折叠侧栏不留导轨（宽度归零） | —— | ❌ **不建议**。我们的导轨占列是有意的（`AppShell.tsx:2577` 注释、spec `02-sidebar-rail.mjs`），且它给了 logo / 新建 / 设置三个常驻入口 |
| 面板标签 min-w 92 / max-w 180 | —— | ❌ **不建议**。我们的溢出折叠成「…」菜单（`TabBar.tsx:165,337`）已经解决了窄面板的标签挤压，且 180 上限会让长文件名更难读 |
| mascot GIF / 启动 splash 的品牌化 | —— | splash ✅ 低成本可做；mascot ❌ 不建议（见 §6） |
| 通知中心 | 我们只有 toast | ❌ 本轮不建议（偏功能，画板成本高） |

---

## 8 · 建议动作

| # | 动作 | 类型 | 价值 | 代价 | 依赖 | 落点文件 |
|---|---|---|---|---|---|---|
| 1 | **右栏改单列**：树在上、查看器在下（`flex-direction: column`），树行高封顶 `146px / min(233px,30vh)` 后内部滚动。取消"并排 760"这一约束，面板默认宽随之从 760 降到 ~420 | 补齐（重画板） | **高** —— 1440 屏上侧栏 280 + 面板 760 只剩 400 给聊天；单列后面板可回到 420，聊天回到 680+。且直接删掉 `EXPLORER_COLUMN_MIN_PANEL_WIDTH` 与"开文档自动加宽到 760+60"这套补丁 | **L** —— 画板 30/31/52 重画 + `FileExplorer`/`ExplorerPanel`/`FileViewer` 三件 DOM 改结构 + 49 份 spec 里涉及面板的重新对位（`30-files-panel.mjs`、`31-*`、`52-*`） | 先做画板（纪律：新形态必须先在画板出现） | 画板：`30-files-panel.html`、`31-terminal-browser-git.html`、`52-file-viewer-modes.html`；产品：`components/FileExplorer.tsx`、`components/ExplorerPanel.tsx`、`lib/panel-layout.ts`、`app/fork-ui.css:433-449`；台账 `DIVERGENCE.md` 新增一条 |
| 2 | **三栏预算改"侧栏先让"**：引入 `MAIN_PANE_MIN_WIDTH = 450` 常量，面板封顶后仍不够则**自动折叠侧栏**（记一个"预算不足折叠"标记，用户手动展开时改从面板借空间，而不是从聊天借） | 补齐 | **中高** —— 窗口变窄时现在聊天被压到 420 以下且侧栏不动 | **M** —— `lib/panel-layout.ts` 加预算函数 + `AppShell.tsx:379-381` 的 reclamp 改成带 auto-collapse 的版本 + 画板 01 帧 C / 60 断点表各加一帧 | #1（面板默认宽变了才看得出差别） | `lib/panel-layout.ts`、`components/AppShell.tsx`、`design/pi-web-design/30-files-panel.html` 帧 C、`60-mobile-pwa.html` 断点表 |
| 3 | **会话行行高改为内容自撑**：`height: var(--row-height)` → `min-height`，运行/等待态不再撑到 58 而改为行内追加 1px 底线 + 右侧标记；同时把虚拟化从"两套常量"改成"测量 + 单一套 + 偏移表"（参照 `sidebar-threads.css:9,39` 的做法），使 `lib/ui-density.ts` 的密度开关**能覆盖侧栏** | 补齐（画板） | **中高** —— ①状态一变整列重排的问题消失；②密度开关覆盖到信息密度最高的那块表面 | **L** —— 画板 02 会话行五帧重画；`SessionSidebar.tsx:36-90` 的虚拟化重写（有回归风险，需实测滚动）；`board-specs/02-sidebar-rail.mjs` 与 `01-workbench-a.mjs` 重新对位 | 无 | 画板：`02-sidebar-topbar.html`、`design/pi-web-design/assets/board.css:165-213`；产品：`components/SessionSidebar.tsx:36-90,2095-2110`、`lib/ui-density.ts:8-12` |
| 4 | **折叠判据从 React state 改成 CSS 容器查询**：在 composer / 文件树 / 设置内容区宿主上声明 `container-type: inline-size`，用 `@container` 的 3–5 档替换 `useIsNarrowControls`（`ChatInput.tsx:239,966-975`）与 `.pw-inline` 的 gap 压缩（画板 8 → 产品 2/3，见 DIVERGENCE 189） | 移植交互 | **中** —— 跨档不再触发重渲；且右栏单列后容器宽与视口宽彻底解耦，这条是 #1 的前置条件 | **M** —— `components/ChatInput.tsx` 去 state、glue CSS；画板 20/21/60 的断点表加"容器判据"一列 | #1 | `components/ChatInput.tsx`、`app/globals.css`、`app/fork-ui.css`；画板 `20-composer.html`、`60-mobile-pwa.html` |
| 5 | **登记/收编第四个断点 960**：`SPLIT_PANEL_MIN_WIDTH = 960` 不在 DESIGN-SPEC §4 的三档里。#1 完成后面板不再需要分栏阈值，960 可直接删；#1 之前则必须写进画板 60 断点表并落成 `--break-split` token | 补齐 | **中** —— 这是纪律缺口，不是视觉缺口；DESIGN-SPEC 明文禁止画板另取断点 | **S** —— 删一个常量 + 改 `app/globals.css:1913,1986`；或写进画板 + token 表 | #1 | `lib/panel-layout.ts:2`、`app/globals.css:1913`、`design/pi-web-design/60-mobile-pwa.html`、`assets/tokens.css` |
| 6 | **设置改整页**：从 560px 模态换成"壳外整页 + 275px 常驻导航"，导航加分组 + 搜索（10 项 → 2 组）。解决 DIVERGENCE U-1 记的 6 处接线偏离（`.pw-field` gap / label 132px / `.pw-tab` 440px 拉满…）——它们多半是"560 模态里塞 12 分节"的代偿 | 补齐（重画板） | **中** —— 一次性解决 U-1 的根因；但会动 `SettingsPanel` 的所有分节组件（12 个） | **XL** —— 画板 40–47 + 62 全部重画；24 份设置对位 spec（`4x-4*`、`62-*`）全部重对；分节组件全部改宿主 | 无（但建议在 #1 之后、其它 UI 批次之前做，因为它会重设所有"内容区宽度"基准） | 画板 `40`–`47`、`62-settings-layout.html`；产品 `components/SettingsPanel.tsx:1033-1062`、`app/settings.css`、`lib/settings-navigation.ts`、`scripts/board-specs/4x-*` `62-*` |
| 7 | **启动 splash（PWA 首屏）**：加一张画板帧（画板 61 或新帧）：logo + 名称 + 进度条 + "已等待 N 秒"（对应我们的 `useStartupWatchdog` 路径）。不抄玻璃材质（那是 macOS 原生能力） | 新增功能（画板） | **中低** —— 现在首屏无反馈，用户会以为白屏 | **S** —— 一帧画板 + 一个组件；移动端断点表里登记 | 无 | 画板 `61-system-states.html`；产品：新建启动态组件 + `app/layout.tsx` |
| 8 | **背景图层与颜色分层**：`--ds-bg-sidebar`（颜色）与 `--ds-bg-sidebar-image`（`<image>`，可为渐变/图）拆成两个变量，壁纸选择器只写后者。语义来源见 `styles/tokens.css:34-46` | 补齐（画板） | **中低** —— 让"换壁纸"从改一整套 CSS 变成改一个变量 | **M** —— `app/wallpaper.css`（250 行）重构 + `useWallpaper`；画板 47 壁纸帧 | 注意 §3 "禁图片素材"：壁壁纸选择器帧仍用 CSS 色块占位（画板简化已在 DIVERGENCE B-9 登记），只把**变量分层**进画板 | 画板 `47-skin-studio.html`；产品 `app/wallpaper.css`、`hooks/useWallpaper.ts` |
| 9 | **通知中心**（全部/未读 + 只收件箱不收完成）：先只评估，**本轮不动**。我们只有 toast（≤3 条 6s 自收），长任务失败无处可查 | 不建议（本轮） | 中（但属功能 agent 的活） | **L**（含持久化来源问题：真源是 pi 的 jsonl，不能建库） | 与功能 agent 边界 | — |
| 10 | **会话手动排序**（`order` + `manual` 排序档）：他们的 `SessionMeta.order` + `SessionSort:"manual"` 落在 `pi.desktop.sidebarPreferences`，纯 localStorage | 不建议（画板层面） | 中 | M | 属功能 agent；但 #3 改虚拟化时会顺带碰到排序逻辑 | `components/SessionSidebar.tsx`、`lib/session-flags.ts` |
| 11 | **画板侧零动作确认**：10 档圆角 / 13 档字阶 / 零强调色 / 24px composer 圆角 / 折叠不留导轨 / 面板标签 min-max —— 六项一律**不抄、不进画板** | 不建议 | —— | —— | 每项的理由已写进 §7.2 | 在 `DIVERGENCE.md` 补一条登记，免得下一轮再议 | `design/pi-web-design/DIVERGENCE.md` |

---

## 附录 · 上一轮 `PD-01…PD-22` 的落地核对（一行带过，不进正文）

对照 `docs/pi-desktop-borrowing-plan-2026-09-24.md` §5/§8，并按 FACTS 要求用 grep 抽验：**PD-01、02、03、04(未开工)、05(未开工)、06–22 全部已落地或按文档裁定完成**。抽验证据：`lib/file-viewer-state.ts` 已无 `"diff"`（grep `"diff"` 计数 2，为 normalize 兼容路径）、`components/MarkdownFileEditor.tsx` 已不存在、`hooks/useIsMobile.ts` 三档齐备（`AppShell.tsx` / `ChatInput.tsx` 各 2 处引用）、`lib/project-flags.ts` 与 `lib/import/{sessions,models,skills,mcp}.ts` 齐备、`components/ModelsConfig.tsx` 含 14 处上下文窗口/预设相关实现。**本轮正文不含任何 PD 项。**