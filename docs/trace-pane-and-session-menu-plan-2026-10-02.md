# 调用轨迹（右栏版完整历史）+ 会话动作菜单（借鉴 ZCode）

日期：2026-10-02　状态：**已实现并浏览器实测**（`components/TraceFrame.tsx` + `components/fork/SessionActionsMenu.tsx`）
关联：`docs/zcode-comparison-2026-09-21.md` ZC-13、`docs/zcode-pr-plan-2026-09-21.md` §ZC-13

## 0. 最终形态（两次用户裁定之后）

1. **「调用轨迹」= 完整历史那一页，只换位置 + 加全屏**（2026-10-02 第二次裁定，推翻了先前的仿 ZCode 面板）：
   同源 iframe 装 `GET /api/sessions/<id>/export?inline=1`，装进右栏单例 `trace` tab；页头两枚钮：刷新、全屏（Esc 退出）。
   为此只对 `inline=1` 放宽嵌帧（CSP `frame-ancestors 'self'` + `X-Frame-Options: SAMEORIGIN`），下载仍 `DENY`。
   pi 导出的那页自带侧栏树、搜索、五档过滤（Default/No-tools/User/Labeled/All）、可拖宽侧栏、thinking/tools 开关、
   JSONL 下载、Date/Models/Messages/Tool Calls/Tokens/Cost 汇总 —— 所以**不再另写一套转录渲染**。
2. **入口不动**：顶栏那枚原「完整历史」图标钮（位置 / 图标 / `data-mobile-toolbar-action="history"` 不动）打开这个 tab。
3. **会话动作 ⋯ 菜单**（图 2 的形态）：置顶 / 重命名会话 / 归档 / 标记为未读 ‖ 在访达中打开 / 复制路径 /
   复制会话文件路径 / 复制会话 ID / 前往配置 ‖ 调用轨迹 / 导出为 HTML / 导出为 Markdown。
4. **读数与动作分开**：上下文环浮窗只留读数，路径类动作全进 ⋯ 菜单。

### 被删掉的东西（记一笔，免得再写一遍）

先前按第一版计划写的 `components/TracePane.tsx`（仿 ZCode 的逐调用卡片 + 五档角色开关 + 面板内搜索）
与 `lib/trace-calls.ts`（会话 → 调用投影）**已整体删除**：用户裁定要的是导出页本身，平行实现即死代码。
搜索能力没丢 —— 导出页自带侧栏搜索框；`lib/conversation-find.ts` 继续服务聊天里的 ⌘F。

### 没做的两项（pi 里没有对应物）

ZCode 的**复制日志路径**（pi 不写会话日志）与**反馈问题**（本仓没有反馈中心）。要落点需要先有这两样东西。

## 1. ZCode 侧调研（照抄对象）

| 能力 | 文件 | 要点 |
|---|---|---|
| 入口 | `packages/ui/src/TaskActionMenuContent.tsx:150-170` | 任务 ⋯ 菜单里的「查看调用轨迹」，独立分隔线，放在复制类动作之后 |
| 面板壳 | `packages/ui/src/ModelTrajectoryPane.tsx` | 头（标题 + 摘要行「N 次调用 · totalTokens tok · models」+ 图标行：搜索 / 角色开关 / 全展开全收起 / 打开源目录 / 刷新 / 关闭）→ 1px 分隔 → 时间线 |
| 一次调用 = 一张卡 | `ModelTrajectoryPaneParts.tsx:35-115` | sticky 摘要行：`序号(01)` + 来源徽标 + finishReason 徽标 + 右侧 `IN n · OUT n · 24.8s · 时钟`；下面「输入」section（system/user/toolResult，隔行底色）与「输出」section（思考/文本/每个 toolCall 一行） |
| 行形态 | `ModelTrajectoryExpandableMessage.tsx` | 左列等宽大写角色标签（`ModelTrajectoryRoleStyles.ts` 着色），折叠时一行 mono 预览 + 工具名/id 徽章 + 右侧「展开」钮；展开后正文 + 复制钮 |
| **筛选** | `ModelTrajectoryExpansionMenu.tsx` + `ModelTrajectoryExpansion.ts` | 一个 gear 按钮下的下拉，六个 Switch：系统提示词 / 用户消息 / 思考过程 / 助手消息 / 工具调用 / 工具结果。语义是**按角色批量展开/收起**（默认全开）；每行手动状态存 `overrides`，用 `version` 做「命令版本 vs 本地状态」仲裁 |
| 全部展开 | `Pane.tsx:70-95` | `Maximize2/Minimize2` 一键，`handleToggleAll` 递增 version 并清空 overrides |
| 搜索 | `ModelTrajectorySearch.ts`（183 行）+ `SearchBar` | **模型级索引**（不是 DOM），命中带 `expansionKey` → 切命中时自动展开该行 + 高亮 + 滚动；条上有命中计数 + ↑↓ |
| 虚拟化 | `ModelTrajectoryTimeline.tsx` | `@tanstack/react-virtual` |
| 数据源 | `packages/services/src/zcode-agent/modelTrajectory.ts` | 读 `~/.zcode/cli/model-io`，是**真的 wire 记录**：request.messages / response.text / reasoningText / toolCalls / usage / startedAt / durationMs |

## 2. 本仓现状

* 「完整历史」= `components/AppShell.tsx:1737` `handleViewFullHistory()` → `window.open(/api/sessions/<id>/export?inline=1)`；顶栏 history 图标钮 `AppShell.tsx:2082-2105`；侧栏行菜单里也有一份（`SessionRowContextMenuBridge.tsx:66`）。
* 顶栏浮层宿主已有：`activeTopPanel: "agents"|"branches"|"system"|"tools"`（`AppShell.tsx:463`），`SystemPromptPanel` / `ToolDefinitionsPanel` 就是「`pw-pop` 头 + 滚动体」形态（画板 22）。
* **右栏 pane 已有先例**：`components/fork/ExplorationPane.tsx`（fork:proma-05）—— 右栏只读 tab、fetch `/api/sessions/<id>/context`、用 `MessageView` 渲染、用画板 54 的 `.pw-panel / .pw-panel-head / .pw-panel-body / .pw-list`。
* **搜索底座已有**：`lib/conversation-find.ts`（模型级索引，字段含 `thinking / toolName / toolInput / toolResult`）+ `components/fork/ConversationFindBar.tsx` + ChatWindow 的高亮/滚动（`data-entry-id` 锚点 + `searchBlock` 展开通路）。
* 会话信息 = `components/SessionStatsBar.tsx` 的 `SessionStatsDetails`，挂在输入框上下文环浮窗（`ChatInput.tsx:2967`）：会话信息（名称/会话文件/ID/活跃时长/项目目录/Git 分支，带复制钮）· 消息计数 · Token。
* 可复用：`lib/session-flags`（置顶/归档）、`lib/clipboard` 的 `copyText`、`components/ContextMenu.tsx`（`checked` / `feedbackLabel` / 一级 `submenu`）、`components/fork/PathActions.tsx`（reveal/open，走 `/api/files/reveal`）。
* 没有 `@tanstack/react-virtual`，**不打算加**。
* `history.label` 这个 i18n 键目前全仓无人用（死键）。

## 3. 关键判断

1. **不需要新埋点。** ZC-13 当年的 spike 问的是「SDK 是否给出这一轮实际发给模型的完整 request」——**不给**（tools schema 与 system prompt 只能另外从活的状态取，就是 `SystemPromptPanel` + `ToolDefinitionsPanel` 那条「快照」退化路）。但**会话文件本身就是调用记录**：每条 assistant 条目带 `thinking` / `text` / `toolCall` / `usage` / `model` / `completedAt`，它前面的 user / toolResult 条目就是这一轮的输入。所以「按调用分组 + 输入/输出两段 + 逐行角色标签 + 逐调用 token/耗时」**纯投影可得**，零新代码管线。
2. 因此面板要**如实命名**「调用轨迹」，并在头部注明它是会话记录投影（不是 wire 抓包）；不伪造 wire 级保真度（不显示 system prompt / tools 的每轮实际序列化）。
3. **宿主选右栏 tab**，不选顶栏浮层：ZCode 的轨迹本来就是右侧 pane；轨迹卡需要宽度（sticky 头 + 宽正文），顶栏浮层默认 320、最宽 860 且锚在工具条上；右栏已有 `ExplorationPane` + `panelTabs` + TabBar 整套先例，还能「边看主线边看轨迹」。
4. **不抄虚拟化**：本仓没有 react-virtual，且默认折叠态只渲染一行预览（正文不进 DOM）；先按 `tail=1000` 全量投影，实测某个会话卡了再加。`# ponytail:` 上限就是 1000 次调用 + 一条「只显示最近 N 次」提示。
5. **搜索不重写**：ZCode 那 183 行索引与 `ConversationFindBar` 功能重叠，本仓 `lib/conversation-find.ts` 已经覆盖 thinking / 工具名 / 工具入参 / 工具输出，直接接。

## 4. 实现要点

| 决策 | 取值 | 理由 |
|---|---|---|
| 宿主 | 右栏 tab `kind:"trace"`（TabBar + TabOverview 的 kind 并集各加一项） | 与 git-graph / changes 同一套单例机制 |
| 入口 | 顶栏原「完整历史」图标钮就地改为打开该 tab | 用户裁定：入口位置不动 |
| 内容 | 同源 iframe → `/api/sessions/<id>/export?inline=1` | 导出页已有树 / 搜索 / 过滤 / 可展开输出 |
| 嵌帧许可 | 仅 `inline=1`：`frame-ancestors 'self'` + `X-Frame-Options: SAMEORIGIN`；attachment 仍 `'none'` + `DENY` | 放宽面只给「同源 + inline」这一种 |
| 刷新 | `nonce` 变一次重载 iframe；切回 tab 时重载一次 | iframe 不会自己更新（新回合已落盘） |
| 全屏 | `position: fixed; inset: 0; z-index: 1000` 覆盖窗口，Esc 退出，退出钮 autofocus | 窄右栏看长轨迹不够用 |
| 搜索 / 筛选 | 由导出页自带，**本仓不重复实现** | 一件事一个入口 |
| 菜单 | 既有 `ContextMenuProvider`（键盘导航 / 越界翻转 / `feedbackLabel` 都是现成的） | 不再画一个下拉 |
| 未读标记 | 抽成 `lib/session-unread.ts`（localStorage + 自定义事件 + `useSyncExternalStore`），与 `lib/session-flags.ts` 同形状 | 原来只活在 `SessionSidebar` 的 `useState` 里，菜单点不到 |
| 系统动作失败 | AppShell 里一条 3 秒的 `.pw-toast` | reveal 失败必须有地方报 |
| i18n | `trace.*` 只留 title / refresh / fullscreen / exitFullscreen 四条；先前面板用的 24 条已删 | 死键是债 |

## 5. 验证

* `tsc --noEmit` / `npm run lint`（无新增）/ `npm run check:design`（0 新增字面量，基线 3→1）/ `npm test`（2879 全过）。
* 浏览器实测（Chrome，1440×900）：顶栏钮 → 右栏出现 trace tab，iframe 内 5 档过滤按钮、364 个消息节点、侧栏搜索框；
  全屏铺满 1440×900；Esc 退出；`console` 零报错。
* 测试：`components/TraceFrame.test.mjs`（嵌帧 URL / 只有 inline 放宽 CSP / 全屏与 Esc / 切回重载）、
  `components/AppShell.session-stats.test.mjs`（读数与动作分开 + 菜单条目）、`components/SessionSidebar.test.mjs`（未读改走共享 store）。

## 6. 明确不做

* 不改导出的 HTML（那份是 pi CLI 生成 + 我们打字符串补丁，往里注入筛选/搜索等于和生成器打架）；导出降级为菜单里的「分享」入口。
* 不引入 react-virtual / 任何新依赖。
* 不做 wire 级保真（每轮真实 system prompt / tools 序列化）：SDK 不给，就不假装。
* 不给 reveal 端点开口子去 reveal 会话文件。

## 7. 风险

* **双份 DOM**：trace tab 开着时同一批消息渲染两遍。缓解：默认折叠、预览行不挂 MessageView、上限 1000 次调用。实测卡了再上虚拟化。
* **思考块惰性加载**：`MessageView` 展开 thinking 会打一次 `/api/sessions/<id>/entries/<id>/thinking`；轨迹里批量展开思考会打一批请求。可接受（同一个展开语义），但要在面板头写明。
* **源码断言式测试**：`AppShell.session-stats.test.mjs` 等是 regex 断言，S5 必然要改，改的时候按「钉意图不钉写法」。