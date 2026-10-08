# Kun 借鉴项 · 首轮功能/界面/交互对比（2026-10-08）

对象：`pi参考项目/Kun-master`（Kun，Electron + React + TypeScript，v0.3.10）
基准：本仓 PI NEXT（Next.js + pi SDK）
目的：回答「Kun 有什么、我有什么、缺的能不能拿、先拿哪个」。

---

## 0 · 三条口径（先说清楚，避免白干）

### 0.1 许可证：**只能借语义与形状，不能抄代码**

`pi参考项目/Kun-master/LICENSE` 是 **PolyForm Noncommercial 1.0.0**
（`Required Notice: Copyright (c) 2026 xingyu`），商业使用 / SaaS / 转售 / 集成进商业产品
都要单独书面授权；本仓是 GPL-3.0 分叉。**逐字搬运它的源码会把本仓拖进许可冲突。**
本文件里每一档都只写「借什么语义」，不写「抄哪个文件」。

### 0.2 形态差：Kun 是 Electron 单运行时，本仓是同源 Next.js

Kun 的链路是 `Renderer → preload → main → kun serve(HTTP/SSE)`，agent 循环在独立
`kun/` 包里（`kun/src/loop/agent-loop.ts`）。本仓的循环走 pi SDK，server 与 UI 同源。
→ 凡是「引擎」类能力（Graph 调度、Rooms 服务端、Workflow 执行器）在本仓都要**重写**，
不能照搬；凡是**纯前端 DOM/状态**类能力（面板、看板、画布、编辑器 UI）才是**形状可抄**。

### 0.3 三档可移植性

| 档 | 含义 | 本仓成本 |
|---|---|---|
| **形状可抄** | 纯前端组件 + 状态，接本仓数据即可 | 小-中 |
| **需重写** | 能力要，但实现绑死在它的运行时/服务端 | 中-大 |
| **不可移植** | 依赖 Electron 原生 / 自研沙箱 / 进程模型 | 不做或降级 |

---

## 1 · 功能空白：Kun 有、本仓完全没有（按价值排序）

### 1.1 ★ Design 画布（AI 生成界面 + 实时预览 + 版本 + Design→Code）

| | Kun | 本仓 |
|---|---|---|
| 形态 | Code 工作台内的设计任务类型：右栏描述 → agent 写**单文件 HTML** → 中间 `<webview>` 实时渲染 → 每轮快照成版本 → 一键「Implement in code」交回编码 agent | 无 |
| 代码 | `components/design/`（40+ 组件）、`design/`（100+ 模块）、`docs/DESIGN_MODE.md`、`DESIGN_MODE_PLAN.md` | — |
| 关键实现 | 产物落 `.kun-design/<id>/v<N>.html`；`design-html-quality.ts` 静态质检；`design-system` 从 DESIGN.md 读 token 并渲染 specimen；`DesignGraphView` 支持 `kind: 'graph'` 变体 | — |

**为什么值得拿**：这是 Kun 唯一「在编码 agent 里长出设计↔代码闭环」的东西，
直接服务本仓已有的画板体系（`design/v5/`）。且**画布 + 版本 + 质检**全是纯前端，
可以照形状搭；只有 agent 写文件的循环要走本仓的 `lib/rpc-manager.ts`。
判定 **形状可抄 + 部分需重写**。优先级 **P0**。

### 1.2 ★ Hooks 体系（6 阶段工具/生命周期拦截）

| | Kun | 本仓 |
|---|---|---|
| 阶段 | `PreToolUse` / `PostToolUse` / prompt 注入 / 生命周期 等 6 个；外部命令协议对齐 Claude Code（stdin JSON、退出码 2 阻断、stdout JSON 结果） | 无（`grep PreToolUse` 在 `lib/` 零命中） |
| 配置 | `{dataDir}/config.json` 顶层 `hooks` 数组，改完即生效 | — |
| 内置示例 | `kun/src/hooks/builtins/design-quality-hook.ts`：`PostToolUse` 上对任意前端路径跑设计质检 | — |

**为什么值得拿**：本仓的审批/计划/todo 都是「注册成工具的扩展」
（`lib/approval-extension.ts` 等），但**没有任何「用户在配置里插一段自己的钩子」的入口**。
这是本仓最便宜的扩展点：一个 `~/.pi/agent/hooks.json` + 在 `lib/rpc-manager.ts`
的工具执行处包一层，就能让用户自己拦 `bash`、自己注入 prompt。
判定 **需重写（协议语义可借）**。优先级 **P1**。

### 1.3 Graph 模式（Lead 建任务图 + 受限子代理调度 + 监工验收）

- Kun：`docs/graph-mode.md` —— Lead agent 把需求编译成**校验过的任务图**，后台调度
  受限子代理，Lead 只在重要事件唤醒时监督/纠偏/统一交付；`components/graph/`
  有 Run Canvas、Node Inspector、Supervision Banner、Agents/Learning 视图。
- 本仓：有 `lib/subagent-extension.ts`（`Agent`/`get_subagent_result`/`steer_subagent`）
  和 `lib/task-graph` 概念，但**没有图编排的调度器，也没有可视化**。
- 判定 **引擎需重写、可视化形状可抄**。若只做「把已有 todo/plan 进度画成时间线/图」，
  成本可控（本仓 `docs/zcode-gap-plan-v3` 已把同类项列为 P3）。优先级 **P2**。

### 1.4 Rooms 多 Agent 协作空间

- Kun：`docs/rooms.md` + `components/rooms/`（30+ 组件）—— 私聊/群聊、成员团队、
  @ 提及、提案卡（固定约定/请求执行/加成员，只有人可采纳）、执行任务在**独立 git
  worktree** 里跑、Reviewer 评审、约定版本冻结。
- 本仓：无（`grep rooms` 在 `lib`/`components` 零命中）。
- 判定 **服务端需重写、UI 形状可抄**。这是个大件，且和本仓「单人工作台」定位冲突较大。
  优先级 **P3（先不做，除非要做多 agent 协作）**。

### 1.5 Workflow 可视化编排器

- Kun：`components/workflow/` —— 节点画布，20+ 节点类型：触发（manual/schedule/webhook）、
  AI（agent/生成图/参数抽取）、流程（条件/switch/分类/过滤/合并/**loop**/人工审批）、
  数据（set-fields/template/json/code/sort/limit/aggregate）、动作（http/子工作流/delay/output）。
  Loop 节点是「目标 + 循环体 + 停止条件 + maxIterations」的无人值守迭代
  （`docs/workflow-loop.md`）。
- 本仓：只有 `components/fork/AutomationPanel.tsx`（定时任务），无编排。
- 判定 **执行器需重写**；**节点画布的 UI 形状可抄**（本仓已有 `@xyflow/react` 依赖）。
  优先级 **P2**（「Loop」这一条单独看价值很高：把「再试一次」写成规则）。

### 1.6 Project Board 看板

- Kun：`components/project-board/` —— 列/卡/拖拽、卡片详情对话框、归档、多选工具条。
- 本仓：无看板。判定 **形状可抄**。优先级 **P2**（轻，但和「会话工作台」定位关系弱）。

### 1.7 对话轨迹 Trajectory 面板（模型请求级账本）

- Kun：`docs/conversation-trajectory.md` —— 中心区切「对话 / 轨迹」，含
  Duration/Turns/Calls 工具条、50px 时序总览（序列/耗时双模式）、事件/内容双栏账本、
  Turn 折叠、虚拟化、时间线范围选择+滚轮缩放、System/Request/Tool 分型检查器、
  Prompt Diff。
- 本仓：`components/TraceFrame.tsx` 是「把 pi 导出的完整历史 HTML 塞进 iframe」，
  **没有请求级时序/用量/重试的账本**。本仓 `lib/turn-observability.ts`、
  `lib/turn-stats.ts` 已有数据源。
- 判定 **形状可抄（数据本仓已有）**。优先级 **P1** —— 这是本仓「可观察」叙事最缺的一环。

### 1.8 知识库挂载（无向量索引）

- Kun：`docs/knowledge-bases.md` —— 把 Work 工作区**只读**挂到 Code 线程当知识库，
  用 PageIndex 式结构索引（不用 embedding/向量库），三个只读工具访问；
  最多 8 个不重叠根；线程运行中禁止改挂载；与「额外工作区」（扩权）严格区分。
- 本仓：无。判定 **索引需重写、UI 形状可抄**。优先级 **P2**。

### 1.9 图表渲染（受治理的 ChartSpec）

- Kun：`docs/conversation-charts.md` —— agent 调 `render_chart` 传版本化 `ChartSpec`，
  runtime 校验后才持久化，桌面端再校验后才渲染（不是模型自由写前端代码）。
- 本仓：只有 `components/fork/usage-charts.tsx`（用量图），**没有通用图表工具**。
  判定 **形状可抄**。优先级 **P2**。

### 1.10 其它单点空白

| 能力 | Kun 证据 | 本仓 | 判定 / 优先级 |
|---|---|---|---|
| 语音输入（dictation） | `components/chat/use-voice-dictation.ts`、`VoiceRecordingStrip.tsx` | 无（`grep getUserMedia` 零命中） | 形状可抄 / P2 |
| 朗读（TTS speak） | `AssistantSpeakButton.tsx`、`lib/speak-*`、`settings-section-speak` | 无 | 形状可抄 / P2 |
| 侧边会话（顺便问一句，并行流） | `SideConversationPanel.tsx`、`SideConversationTimeline.tsx`，独立 SSE 与 busy | 无 | 需重写 / P1（价值高） |
| 提供商配额面板 | `ProviderQuotaPanel.tsx`、`routes/provider-quotas.ts` | 有 `app/api/provider-usage/query` 但无面板 | 形状可抄 / P1 |
| 目标（goal）+ 计时 | `use-goal-elapsed.ts`、`goal-turn-coordinator.ts` | 无（`grep goal` 仅 2 命中） | 需重写 / P2 |
| 上下文容量浮窗（环） | `ContextCapacityPopover.tsx`、`lib/context-capacity.ts` | 有 `ContextBudgetSettingsBlock`，无会话内环 | 形状可抄 / P1 |
| Paper 论文库模式 | `components/paper/`（12 组件）、`docs/work-paper-*.md` | 无 | 需重写 / P3 |
| Agent Perspective（子代理视角） | `AgentPerspectivePanel.tsx` + 轨迹视图 | 有 `AgentSessionPanel`，深度低 | 形状可抄 / P2 |
| SDD 草稿编辑器 | `components/sdd/` | 无 | 需重写 / P3 |

---

## 2 · 已有功能的加强点（交互 / 布局）

### 2.1 右栏：从「固定四面板」到「多页签导轨 + 扩展贡献点」★

- Kun：`BUILTIN_RIGHT_PANEL_IDS` 有 **15 个内置页签**
  （plan / changes / browser / terminal / files / file / side-conversations / sdd-ai /
  canvas / subagents / mcp-skills / provider-quotas / agent-perspective / graph / remote），
  且每个 id 都能被 `extension:<ns>/<name>` 顶替
  （`extensions/contribution-ids.ts`、`contribution-registry.ts`）。
  页签可开可关、可折叠、可恢复（`code-right-tabs-state.ts`，含旧 id 归一化、fail closed）。
- 本仓：`components/ExplorerPanel / TerminalPanel / BrowserPanel / GitGraphTab` 是**固定四面板**。
- **建议**：把右栏改成「可增删页签的导轨」，页签 id 走稳定标识 + 旧值归一化
  （这条 Kun 的写法很成熟，值得借形状）。这直接决定后面所有新面板（轨迹、配额、
  侧边会话）能不能不抢布局。优先级 **P0（这是所有面板类借鉴的前置）**。

### 2.2 设置分节

- Kun：`SettingsRouteSection` 有 **25 个分节**（含 design / imageGeneration /
  mediaGeneration / memory / permissions / skill / mcp / laboratory / archives /
  worktree / storage / dataMigration / easterEgg …），且「深链目标」单独放一个
  `settings-route-sections.ts` 小模块（加一节只动一处）。
- 本仓：`SettingsPanel.tsx` 分节较少，且设置是整页 + 弹窗双宿主。
- **建议**：借「深链 section 类型独立成模块」这一条；分节本身按本仓功能补，不必对齐数量。

### 2.3 悬浮 composer 全家桶

- Kun：`components/chat/FloatingComposer*.tsx` 拆成 30+ 个文件（附件、模型选择、
  审批面板、队列徽标、slash 菜单、上下文容量、todo 进度、图进度、执行策略选择器…），
  每个关注点一个文件。
- 本仓：`ChatInput.tsx` + `ComposerContextStrip.tsx` + `ModelSelector.tsx`。
- **建议**：借**拆分方式**（一个关注点一个组件 + 一个 `*-logic.ts` 纯函数），
  而不是借功能。本仓 composer 已经偏大，这条对可维护性有价值。

### 2.4 会话列表与侧栏

- Kun：`SidebarProjectRows / SidebarProjectExpansionControl / sidebar-project-drag-actions /
  sidebar-order / sidebar-collapse` 等把「项目树 + 拖拽 + 折叠 + 展开窗口 + 自动滚动」
  拆成一堆小模块；`SidebarActivityIndicator`、`SidebarAttentionPanel`（需要你注意的会话）。
- 本仓：`SessionSidebar.tsx`（虚拟列表行高已用 `useSessionRowHeight` 实测，见 AGENTS.md）。
- **建议**：借 `SidebarAttentionPanel` 的**形态**（把「运行中/等你处理/失败」聚成一栏），
  本仓已有 `lib/session-unread.ts`、`/api/agent/running`，接得上。优先级 **P2**。

### 2.5 交互机制对照

| 机制 | Kun | 本仓 | 结论 |
|---|---|---|---|
| 审批 | `routes/approvals.ts` + `FloatingComposerApprovalPanel` | `lib/approval-policy.ts` + 审批卡 | **已有，互有胜负**；借它的「审批面板常驻 composer 内」形态 |
| 计划 | `components/plan/`（PlanPanel、AutoPlanBuild、ScheduledBuild） | `lib/plan-mode*.ts` + 计划文档卡 | 已有；Kun 的「自动建计划 + 计划定时构建」是新点 |
| Todo | `FloatingComposerTodoProgress` | `lib/todo-extension.ts` + todo chips | 已有；借「进度进 composer」 |
| 队列 | `FloatingComposerQueuedMessages` + 队列徽标 | 消息队列可逐条编辑 | 已有，本仓更深 |
| 命令面板 | `palette/CommandPaletteOverlay.tsx` | `components/fork/CommandPalette.tsx` | 已有 |

---

## 3 · 页面设计 / 布局 / 设计规范

### 3.1 ★ DESIGN.md 作为机器可读 token 契约

- Kun 根目录 `DESIGN.md` 有 **YAML frontmatter**（palette / typography / spacing /
  radius / elevation / motion / z-index / icons / components / a11y / dont），
  正文拆成 `docs/design/*.md` 章节；用 `@google/design.md` 包做校验
  （`design/design-md/design-md-adapter.ts`，512 KiB 上限、frontmatter 必须闭合、
  渲染内置 specimen 板）。
- 本仓：`design/v5/tokens.css` + `app/design/tokens.css` 有 token，但**没有一份
  「设计 agent 可读的契约文件」**。
- **建议**：借**「DESIGN.md = frontmatter token + 章节正文 + 校验」这个形态**。
  它让设计 agent（Stitch/Figma 类）能直接吃 token，也让设计评审有唯一事实源。
  优先级 **P1**。

### 3.2 Tailwind 语义 token 层

- Kun：`tailwind.config.js` 把颜色全部映射到 `--ds-*`（`ds.ink/muted/faint/card/
  elevated/subtle/hover/border/success/danger/diff-added/diff-removed/skill/userbubble`），
  radius 用语义名（`control/card/pill`），shadow 用 `composer/shell/panel`。
  并明确注释：**共享控件走中性宿主语言，语义色只留给状态**。
  另一个细节：`accent.tint` 用 `color-mix(... <alpha-value> ...)` 解决 Tailwind 3.4
  下 `bg-accent/10` 对 `var()` 静默失效的问题。
- 本仓：v5 token 体系已有，可对照补「diff/skill/userbubble」这类语义槽位。
- **建议**：借这两条**具体做法**（语义色只给状态；`color-mix` 支持透明度修饰符）。

### 3.3 信息架构：三足 + 画布

- Kun：Code（chat）/ Work（write）/ Rooms 三个平级工作区 + Design 作为 Code 内的
  任务类型 + Graph 作为按回合选择的编排策略。`AppRoute` =
  `'chat' | 'write' | 'rooms' | 'design' | 'settings' | 'plugins' | 'extensions' |
  'claw' | 'board' | 'schedule' | 'workflow'`（`store/chat-store-types.ts:219`）。
- 本仓：单工作台 + 文件/终端/浏览器/Git 页签。
- **建议**：本仓不必照搬三足，但「**一个 route 联合类型 + 一个路由归一化函数**
  （`workbench-route.ts`，未知值 fail closed 回 chat）」这个写法值得借。

### 3.4 i18n 规模

- Kun：`locales/` = **en / hi / ja / ko / ru / th / zh** 七语言，且每个语言按域拆 json
  （`common/command-palette.json` 等）。
- 本仓：en / zh-CN / zh-TW 三语言（`lib/i18n/messages/`）。
- **建议**：不急扩语言；借「**按域拆文件**」这一点（本仓 messages 单文件已偏大）。

### 3.5 UI 插件 / 形象工坊（声明式皮肤）

- Kun：`docs/UI_PLUGINS.md` —— 一个 UI 插件 = `manifest.json` + 图片，**纯声明式，
  零可执行代码**（不执行插件里的 JS/HTML/CSS/SVG），宿主按固定槽位生成 CSS 注入。
- 本仓：`components/ThemeSkinStudio.tsx` + `lib/theme-skins.ts` 有皮肤体系。
- **建议**：借**「皮肤只声明、不执行」的安全边界**这条口径。优先级 **P3**。

---

## 4 · 不建议做

| 项 | 原因 |
|---|---|
| 照抄 Kun 源码 | PolyForm Noncommercial，与本仓 GPL-3.0 冲突（§0.1） |
| Electron 单运行时 + 本地 HTTP/SSE | 本仓是同源 Next.js，换过去是重写不是借鉴（§0.2） |
| CUA / 原生模拟器 / 桌面自动化 | 依赖桌面壳与权限模型，本仓浏览器形态拿不到（与 `docs/feature-matrix-zcode-aether` 的结论一致） |
| Graph / Rooms / Workflow **引擎** | 绑死它的服务端调度器，只能借 UI 形状 |
| 对齐而造数据 | 沿用本仓既有克制：没有数据源就不画（`lib/turn-observability.ts` 已有明示） |

---

## 5 · 优先级汇总

| 优先级 | 事项 | 档 | 前置 |
|---|---|---|---|
| **P0-1** | 右栏改「可增删页签导轨 + 稳定 id + 旧值归一化」 | 形状可抄 | — |
| **P0-2** | Design 画布（HTML 原型 + 实时预览 + 版本 + 质检） | 形状可抄/部分重写 | P0-1 |
| **P1-1** | Hooks 体系（用户可配的工具/prompt 拦截） | 需重写 | — |
| **P1-2** | 对话轨迹面板（请求级账本 + 时序） | 形状可抄 | P0-1 |
| **P1-3** | DESIGN.md 契约文件（frontmatter token + 校验） | 形状可抄 | — |
| **P1-4** | 侧边会话（并行顺便问一句） | 需重写 | P0-1 |
| **P1-5** | 提供商配额面板 / 上下文容量环 | 形状可抄 | P0-1 |
| **P2-1** | Loop 节点语义（目标+循环体+停止条件） | 需重写 | — |
| **P2-2** | 图表工具（受治理 ChartSpec） | 形状可抄 | — |
| **P2-3** | 知识库挂载（无向量索引） | 需重写 | — |
| **P2-4** | 侧栏「需要你注意」聚合栏 | 形状可抄 | — |
| **P2-5** | 语音输入 / 朗读 | 形状可抄 | — |
| **P3** | Graph 可视化 / Rooms / Paper / Project Board / Workflow UI | 形状可抄 | 定位确认 |

---

## 6 · 与既有台账的关系

- `docs/feature-matrix-zcode-aether-2026-10-04.md`：ZCode/Aether 对比（命令面板、
  插件商店、扩展插槽、设备预览）。本文件**不重开**这些项。
- `docs/proma-borrowing-plan-2026-10-02.md`：Proma 对比（审批、权限模式、计划、
  回退、探索分支、委派）。本文件**不重开**这些项。
- 本文件的**增量**是：Design 画布、Hooks、Graph、Rooms、Workflow、Project Board、
  轨迹面板、知识库、ChartSpec、右栏页签导轨、DESIGN.md 契约。
