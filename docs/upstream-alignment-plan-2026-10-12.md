# 上游对齐落地计划（fork ↔ agegr/pi-web）· 第三轮

日期：2026-10-12 · 审计基线：本 fork `main` @ `ee36c84a`（0.10.0-beta.3）· 上游 **`v0.12.0`** @ `894e1a28`
上一轮：[`upstream-alignment-plan-2026-10-09.md`](./upstream-alignment-plan-2026-10-09.md)（基线 v0.11.0，已收尾）
纪律：[`upstream-merge-policy.md`](./upstream-merge-policy.md)（T0/T1/T2 + `fork:<slug>` + audit leak 只降不升）
上游 tarball：`/Users/yingjing/Downloads/pi-web-main`（package.json `version: 0.12.0`）

---

## 0. 一页结论

上游从上一轮基线 **`v0.11.0`** 推进到 **`v0.12.0`**，跨 **v0.11.1 + v0.12.0** 两个版本，
共 **68 个非 merge commit / 301 个改动文件**（65 新增 / 24 删除 / 212 修改）：

| 版本 | 主题 |
| --- | --- |
| **v0.11.1** | 侧栏重画（文件区并入会话列表）+ 5 条新 CLI 命令 + 子代理面板标签 + CSV 表格 + 一批聊天/子代理修复 |
| **v0.12.0** | 删除项目全部会话 + 新标签页打开会话 + 子代理连 MCP / `:level` + 终端 Termux 键 + 一批流式/列表/高亮性能优化 |

1. **地基已经到位**：`next 16.3.8`、`pi SDK 1.1.0`（上一轮 PR-1/PR-3 已升）。本轮**没有**依赖升级，全是能力/性能/修复。
2. **本仓形态分叉区仍是侧栏 / MCP / 聊天渲染**。这三处的上游 DOM（`SessionTree.tsx`、`app/sidebar.css`、`McpConfig.tsx`、`ChatMinimap.module.css`）**不要照抄**，只补**能力**（见 §2、§4）。
3. **真缺口里最值得先做的**：
   - **数据/一致性**：会话列表不再携带每条会话完整首条消息（大目录 3.2 MB → 385 KB，`#1176`）；每次运行结束只重建一次列表（`#1177`）。
   - **子代理**：profile 的 `mcp: on` / `codemode:` / `model:provider/model:high` 三类 frontmatter 本仓**完全没解析**；`session_start` 注册的工具子代理拿不到（`#883`）。其中 `resourceBoolean` 类语义 bug 优先级最高。
   - **侧栏/会话**：删除项目全部会话（`#1182`）、新标签页打开（`#1169`）、已删会话链接不再落到别的会话（`#1180`）。
   - **性能**：流式只重渲染正在生成的回复（`#1191`）、Prism 语言按需加载（`#1183`）。
4. **明确不做**：侧栏「会话 \| 文件」整套 DOM 重画、`app/sidebar.css` / `sidebar-menu.css`、上游 `McpConfig.tsx` 详情面板重排、`demo/`、`components/ChatMinimap.module.css`、`lib/delimited-table.ts`（本仓已有等价 `lib/csv-preview.ts`）、`lib/highlight-queue.ts`（本仓已有 `lib/code-highlight-schedule.ts`）、`lib/markdown-blocks.ts`（本仓已有 `lib/markdown-incremental.ts`）—— 见 §2。

**工作量**：约 **14 个 PR**，合计约 **20–28 人日**。其中 P0 级 2 条（列表载荷 + 子代理语义 bug），其余按用户可感知度排。

---

## 1. 事实基线（已核验）

| 项 | 本 fork | 上游 `v0.12.0` |
| --- | --- | --- |
| HEAD | `ee36c84a`（0.10.0-beta.3） | `894e1a28` |
| 上一轮对齐基线 | v0.11.0（2026-10-09） | — |
| 本轮增量 | — | **68 commit / 301 文件** |
| next | **16.3.8** ✅ | 16.3.8 |
| pi SDK | **1.1.0** ✅ | 1.1.0 |
| 侧栏 | V5 自绘（`SessionSidebar.tsx` + `lib/session-groups.ts`） | `SessionTree.tsx` + `app/sidebar.css` + `lib/session-tree.ts` |
| 会话 UI 状态 | localStorage（`session-flags.ts` / `project-flags.ts` / `project-prefs.ts`） | 服务端 `~/.pi/agent/pi-web-session-state.json` + `/api/sessions/ui-state` |
| MCP 面板 | 自绘 `components/fork/Mcp*.tsx` + `PluginsConfig.tsx` | `components/McpConfig.tsx` |
| audit leak | **56**（merge surface 367 / marker 216 / reviewed 7） | — |

> leak 只能降不能升。本计划完成后应 ≤ 56。

---

## 2. 已具备 / 不适用（**不要再抄一遍**）

| 上游项 | 依据 | fork 现状 |
| --- | --- | --- |
| 侧栏「文件 · N」在会话列表下方（桌面） | `3fe257f2` | **N-A**：本仓文件区在右栏（`AppShell.tsx:4113`），可拖动/可折叠已有（`:548`/`:4012`） |
| 侧栏 28px 行 / 折叠归档动效 / 文件区键位顺序 | `02532c30` `4fa6799a` `cae62012` | **N-A**：V5 画板 02 持有行指标与动效（`.d-sess` / `.m-row`） |
| 项目分组重命名 | `ee78105d` | **HAVE**：`SessionSidebar.tsx:435-455` + `lib/project-prefs.ts:57-61` |
| 压缩摘要默认折叠 | `47d8b9a4` | **HAVE**：`MessageView.tsx:2570-2576`（`fork:pr15-compaction`） |
| 附件按钮接受任意文件 | `3f6baa90` | **HAVE**：`ChatInput.tsx:4439-4444` 无 `accept`（比上游更宽） |
| 单行提示在卡内居中 | `d850be1e` | **HAVE**：`.d-toast`（`design/v5/web/system.css:555`） |
| 流式 markdown 按块增量解析 | `a952ed50` | **HAVE**：`lib/markdown-incremental.ts` + `MarkdownBody.tsx:454-470` |
| 长历史代码块空闲分批上色 | `b2b6a45b` | **HAVE**：`lib/code-highlight-schedule.ts` + `MermaidBlock.tsx:347-403` |
| CSV / TSV 表格预览 | `f87afbbe` | **HAVE**：`lib/csv-preview.ts` + `components/fork/CsvPreview.tsx`（`FileViewer.tsx:3083`） |
| MCP 服务器详情「每个事实只说一次」 | `e8b0236b` | **N-A**：本仓详情在 `components/fork/McpConfig.tsx` + `PluginsConfig.tsx:1163-1300`，无重复行 |
| `demo/` 演示站、`app/sidebar*.css`、上游测试删减 | `f364bc3f` 等 | 不做（内部产品 / 形态分叉 / 测试各自一份） |

**形态分叉、禁止照抄的上游文件**（改了要留 `fork:` 标记，别整文件覆盖）：
`components/SessionTree.tsx`、`app/sidebar.css`、`app/sidebar-menu.css`、`lib/session-tree.ts`、`lib/sidebar-actions.ts`、`lib/sidebar-prefs.ts`、`components/McpConfig.tsx`、`components/McpSignIn.tsx`、`components/mcp-config-helpers.ts`、`components/NewSessionContextBar.tsx`、`components/ProjectWorktreePicker.tsx`、`components/ChatMinimap.module.css`、`lib/delimited-table.ts`、`lib/highlight-queue.ts`、`lib/markdown-blocks.ts`。

---

## 3. 逐项对比（真缺口）

判定口径：**HAVE**=已有等价能力；**PARTIAL**=有但缺一半；**MISSING**=没有；**N-A**=形态分叉不适用。
证据列为本仓实际读到的 `文件:行`。

### 3.1 侧栏 / 会话

| # | 能力 | 上游依据 | 状态 | 证据 | 量 |
| --- | --- | --- | --- | --- | --- |
| S1 | 删除项目全部会话（含置顶/归档，运行中保留） | `c8182b18` `#1182` | **PARTIAL** | 菜单无删除全部：`SessionSidebar.tsx:535-645`；无 `app/api/sessions/delete/route.ts` / `lib/session-delete.ts`；`ProjectArchivePanel.tsx:190-215` 只逐行删归档 | M |
| S2 | 侧栏会话标题 = 真链接，中键/Ctrl 点开新标签页 + 行菜单「在新标签页打开」 | `d9adb386` `#1169` | **MISSING** | 行是 `<button>`：`SessionSidebar.tsx:3080-3102`；无 `lib/session-links.ts` | M |
| S3 | 指向已删会话的链接 → 新建会话页 + 提示，不落到别的会话 | `e83280ed` `#1180` | **MISSING** | `AppShell.tsx:1411` → `lib/workspace-restore.ts:47-53` 返回 `"newest"`，覆盖了 `AppShell.tsx:1768-1770` | S |
| S4 | 折叠分组丢弃它的「显示更多」窗口 | `0066d5f9` | **MISSING** | 折叠路径 `SessionSidebar.tsx:2223-2233` / `:1764` / `:1769` 只 `setExpandedProjects`，不清 `setMoreShown` | S |
| S5 | 点「显示更多」后选中最后一条不再露出更旧的会话 | `51dda7c5` | **MISSING** | `lib/sidebar-bulk.ts:95-113` 是按预算而非按位置；点击加固定 `SHOW_MORE_STEP`（`SessionSidebar.tsx:1868`） | M |
| S6 | 停在扩展对话框的会话显示为「等待输入」 | `89d7141b` `#1145` | **PARTIAL** | `lib/rpc-manager.ts:421-430` 运行中直接返回 false；`lib/extension-ui-queue.ts` 无 `isBlockingExtensionUiRequest` | S |
| S7 | 自动发现外部写入的会话文件，不用手动刷新 | `8e602ca5` `#1100` | **MISSING** | `lib/session-reader.ts:413-415` 无成员检查；`lib/session-list-scanner.ts` 无 `checkSessionMembership` | S/M |
| S8 | 回到工作区恢复打开的文件标签 | `d69b33e7` `#1107` | **MISSING** | `components/file-tab-state.ts` 无 `switchFileWorkspace`/park；`AppShell.tsx:1404` 直接 `setFileTabs([])` | M |
| S9 | 文件树按项目记住展开的目录 | `3fe257f2` | **MISSING** | `FileExplorer.tsx:1860-1862` cwd 变即重置；`FileTreeSnapshot`（`:71-77`）不含展开路径 | S |
| S10 | 每次运行结束只重建一次列表 | `b73fdebc` `#1177` | **PARTIAL** | `SessionSidebar.tsx:1028` / `:1143` 都传 `force=true` | S |
| S11 | 会话列表行不再带完整首条消息 | `a952ed50` `#1176` | **MISSING** | `lib/session-reader.ts:225-227` 直接用 `scanned.firstMessage`；无 `catalogFirstMessage`/上限 | S |
| S12 | 子代理关系只随文件变化重读 + 会话视图缓存只算一次大小 | `b2b6a45b` `#1181` | **PARTIAL** | `lib/session-reader.ts:188-204` 无 `WeakMap`；`lib/session-view-cache.ts:51-59` 每次重算 `snapshotBytes` | S |
| S13 | 运行中写文件、窗口获焦时文件树自动刷新 | `4ad8aa31` `#1153` | **PARTIAL** | 运行中写文件已有（`FileExplorer.tsx:1906-1925` SSE）；**缺** `window` `focus` 监听 | S |
| S14 | 会话 UI 状态存服务端（置顶/归档/顺序/别名 + revision 合并 + 跨端同步） | `lib/session-ui-state*.ts` + `/api/sessions/ui-state` | **MISSING** | 无 `lib/session-ui-state.ts`；全在 localStorage：`lib/session-flags.ts:24-25`、`lib/project-flags.ts:24-25`、`lib/project-prefs.ts:17` | L |

### 3.2 子代理

| # | 能力 | 上游依据 | 状态 | 证据 | 量 |
| --- | --- | --- | --- | --- | --- |
| A1 | profile `mcp: on` → 子代理连 `mcp.json`；只读子代理只跑只读 MCP 工具 | `68f04ef3` `#1187` | **MISSING** | `lib/subagents.ts` 无 `mcp` 记号；`lib/mcp-read-only-policy.ts` 无 `createSubagentMcpPolicyExtension`；无 `lib/builtin-extensions.ts` | L |
| A2 | profile `codemode:` 可选开启 | `81cc2856` `#1097` | **MISSING** | `lib/subagents.ts` 无 `codemode`；`components/AgentsConfig.tsx` 无开关 | L |
| A3 | `session_start` 注册的扩展工具子代理可调（`#883`） | `0db6734c` `#1115` | **MISSING** | 无 `SDK_BUILTIN_TOOLS`/`subagentToolOptions`；`lib/subagent-runtime.ts:347` 传死名单 `tools: activeTools` | M |
| A4 | profile 决定 spawn 参数（model 猜的 `max_turns`/`thinking`/`inherit_context` 不再覆盖） | `fb6df881` `#1138` | **PARTIAL** | `lib/subagent-runtime.ts:228-238` 仍 `request.* ?? profile.*`；`lib/subagent-extension.ts:210-215` 仍暴露三参 | S |
| A5 | profile/模型串 `provider/model:high` 的 `:level` 后缀 + Agent 说明列出思考级别 | `445b58cd` `#1189` | **MISSING** | `lib/subagent-runtime.ts:169-180` `parseSubagentModel()` 不切 `:level`；`lib/subagent-extension.ts:100` 无 `Thinking:` 行 | S |
| A6 | 右侧面板只读查看子代理对话 | `311a9016` `#1129` | **PARTIAL** | 入口在 `MessageView.tsx:1845-1853` 但 `onClick` 是主聊天切会话；无 `SubagentViewer.tsx` / `agentTabs`；后端 `context` 路由已支持 `tail`/`before` | M |
| A7 | 已删工作树从它分叉的仓库回答 | `f9a370e0` `#1137` | **PARTIAL** | `lib/worktree.ts:86` 只认 `<repoRoot>/.git`；无 `repoRootFromCommonDir` | S |
| A8 | 裸克隆的工作树归到该克隆下 | `11c2aa2c` `#1116` | **MISSING** | `lib/worktree.ts:159` 直接 `dirname(commonDir)`，无 bare 判定 | S/M |

> A1/A2/A3 共用一块地基：上游把这些工厂放在 `lib/builtin-extensions.ts`（本仓没有）。**先落地该模块，再补三个字段**，否则三处各自复制一遍。

### 3.3 聊天渲染 / 文件

| # | 能力 | 上游依据 | 状态 | 证据 | 量 |
| --- | --- | --- | --- | --- | --- |
| C1 | 自定义消息从标题处折叠 | `574cbba1` `#1133` | **MISSING** | `MessageView.tsx:2700-2720` 标题是死 `<div>`，只有页脚可折 | S |
| C2 | 出错结束的回合保留展开的「处理详情」 | `f47c38a2` `#1124` | **MISSING** | `ChatWindow.tsx:2638` `defaultExpanded={!finalAnswerMessage}`，无 `collapsesProcessDetails` | S |
| C3 | 不再重复加载同一页历史 | `d474ce23` `#1149` | **MISSING** | `ChatWindow.tsx:1233-1262` 只防并发，无 `requestedCursorRef` 去重 | S |
| C4 | 停止按钮不挡压缩出现的位置 | `0a38de9f` `#1131` | **MISSING** | `ChatInput.tsx` 无 `isRunEndStrayClick`/`runEndedAtRef` | S |
| C5 | 扩展通知里的终端二维码保持完整 | `e7415ea9` `#1120` | **MISSING** | `ChatWindow.tsx:3115-3117` 纯文本渲染；无 `lib/notice-text.ts` | S |
| C6 | `display:false` 自定义消息不显示 + 以 pi-subagents 完成通知锚定回合 | `f0bc371c` `#1110` | **PARTIAL** | `lib/message-display.ts:11-19` 只认 `pi-web:subagent-notification`；`MessageView.tsx:2694` 刻意把隐藏消息折叠显示 | S |
| C7 | 切会话后重试条 / 上下文占比 / t·s / 历史窗口保持 | `5fd1e674` `#1114` | **PARTIAL** | 有 `retryInfo`/`contextUsage`（`useAgentSession.ts:413-416`）；速度是挂载期 ref（`ChatWindow.tsx:1895-1908`），无 `earlierTurnCount` | M |
| C8 | 小地图轮次从会话第一轮编号 | `5220b88f` `#1151` | **MISSING** | `ChatMinimap.tsx:9-15` 无 `turnsBefore`；`useAgentSession.ts` 无 `earlierTurnCount` | S/M |
| C9 | 小地图锁定开关（关掉悬停预览） | `50486b31` `#1128` | **MISSING** | `ChatMinimap.tsx:497-513` 悬停必预览；无 `lib/minimap-preview-lock.ts` | S |
| C10 | 已删项目文件夹 / Chat only 扩展模型的错误更清楚 | `20b688ce` `#1119` | **MISSING** | `app/api/project-trust/route.ts:24` 只回 `{error}`，无 `reason` 码；i18n 缺键 | S/M |
| C11 | 两位数有序列表序号不被裁 | `8347ea5c` | **MISSING** | `MarkdownBody.tsx` 无 `ol` 渲染器；`design/v5/web/system.css:304` 固定 `padding-left` | S |
| C12 | 保留 `obsidian://` / `vscode://` / `zoommtg://` 等桌面应用链接 | `5af2e04e` `#1118` | **MISSING** | `lib/markdown.ts:24-33` 只放行 `file` | S |
| C13 | HTML > 256 KB 也能完整预览 | `93b3aba5` `#1155` | **MISSING** | `FileViewer.tsx:2158` `hasPreview = !data?.truncated && …`，无 `HTML_PREVIEW_MAX_BYTES` | M |
| C14 | 每个片段只重渲染正在生成的回复（不是整页） | `e8d91efd` `#1191` | **MISSING** | `useAgentSession.ts:399` `useReducer` → 整树读 `streamState`；无 `useStreamingSelector`；`lib/tool-call-expansion.ts` 缺 | L |
| C15 | 自定义面板按键不再重渲染所有回答 | `06991071` `#1121` | **MISSING** | `ChatWindow.tsx:2544-2560` 每次渲染重建 `withAssistantBlocks(...)` 副本；无 `lib/turn-views.ts` | M |
| C16 | Prism 语言按需加载（不再随首屏/懒块带全量） | `046bc67e` `#1183` | **PARTIAL** | `AsyncCodeHighlighter.tsx:6-18` 懒加载但仍是**全量** Prism 构建；无 `lib/prism-languages.ts` | M |

> C14 / C15 是**纯性能重构**，对着本仓分叉的渲染器做，风险高于收益，建议**最后做**、可单独 revert。C16 局部（换 highlighter 入口）价值/风险比最好。

### 3.4 模型 / MCP / 基础设施 / 终端 / 音频

| # | 能力 | 上游依据 | 状态 | 证据 | 量 |
| --- | --- | --- | --- | --- | --- |
| M1 | 显示 Kimi For Coding 用量额度 | `1a560533` `#1113` | **MISSING** | `lib/provider-usage-ids.ts:1-11` 无 `kimi-coding`；`lib/provider-usage.ts:46-70` 无端点/归一化 | M |
| M2 | 「获取模型」保留能力元数据（`reasoning` / `thinkingLevelMap`） | `b6318bed` `#1112` | **PARTIAL** | `lib/model-discovery.ts:60-68` 有 `contextWindow`/`maxTokens`/`input`，缺推理字段 | S/M |
| M3 | 模型按 pi 的 `/model` 顺序列出，不按名字 | `a3a158a0` `#1111` | **MISSING** | `ModelSelector.tsx:58-63` `compareModelOptions` 按名排序；`app/api/models/route.ts:22-25` 同 | S |
| M4 | 运行中 / 压缩中拒绝扩展 `ctx.reload()` | `e4933102` `#1172` `#1173` | **PARTIAL** | `lib/rpc-manager.ts:1385-1401` `case "reload"` 与 `:2078-2088` 扩展 reload 都无守卫 | S |
| M5 | 完成提示音：空闲挂起音频上下文 | `7a416ce8` `#1178` | **MISSING** | `hooks/useAudio.ts:55-95` 无 `scheduleIdleSuspend` | S/M |
| M6 | 运行期间保持上下文运行；resume > 3s 的提示音丢弃 | `d1529d04` `#1185` | **MISSING** | `hooks/useAudio.ts:76-95` resume 后直接播，无 `holdAudio`/超时 | M |
| M7 | 竖屏触屏终端 Termux 风格额外键（含 CTRL/ALT 单次修饰） | `68353265` `#1166` | **PARTIAL** | `components/pwa/TerminalKeybarMobile.tsx:33-45` 只有 9 个固定键，无修饰键/Home/End/PgUp/PgDn | M |
| M8 | 手机软键盘弹出一行后输入不再永久失效 | `3ff7e1d7` `#1160` | **MISSING** | `app/api/terminal/[id]/route.ts:33-36` 拒绝 `rows < 2`；`TerminalPanel.tsx` `onResize` 不夹取 → 客户端置 `disableStdin` | S |
| M9 | 服务端启动即导入 pi SDK，不等第一个请求 | `6425d0d2` `#1117` | **MISSING** | `instrumentation-node.ts:11-13` 只 `configureHttpDispatcher()` | S |
| M10 | Tailwind 源扫描不进入 `.claude` 工作树 | `67421824` | **MISSING** | `app/globals.css:1-5` 只有 `@import "tailwindcss"` | S |
| M11 | 安装为 PWA 后应用名运行时配置 | `2adb1855` `#1148` | **MISSING** | `app/manifest.ts:6-7` 写死 `"PI NEXT"`；`app/layout.tsx:89-90,110-112` 同 | S |
| M12 | 设置里的 `httpIdleTimeoutMs` 也作用于 Web UI | `650d7a34` `#1127` | **MISSING** | `lib/http-dispatcher.ts` 无读取；`instrumentation-node.ts:13` 无参调用（写死 300s） | S/M |
| M13 | 工具结果图片不再在事件流里重复发送 | `#1176` | **MISSING** | `lib/agent-event-wire.ts:73-109` 原样回 `message_start`；`agent-event-stream.ts` 注释说 base64 发 3 次 | S |

> 本仓没有 `tailwind.config.ts`（Tailwind v4），M10 等价物是 `app/globals.css` 里加一行 `@source not "../.claude";`。

### 3.5 CLI

| # | 能力 | 上游依据 | 状态 | 证据 | 量 |
| --- | --- | --- | --- | --- | --- |
| L1 | `pi-web version / update / status / stop / open` 五个命令 | `f98c0881` `#1154` | **MISSING** | `bin/` 无 `pi-web-commands.js` / `pi-web-update.js` / `run-records.js` / `browser-opener.js`；`bin/pi-web-options.js:5-13` 无子命令 | L |
| L2 | Windows 上 status/open/update/stop 不再以 `0xC0000409` 退出 | `5abdee35` `#1179` | **N-A** | 本仓没有这些命令可退；**L1 做完后**必须一起带 `exitWhenIdle` 修 | S |

> L1 是**全表最大单项**：本仓 `bin/pi-web.js` 已带 fork 专属的 `lan-supervisor` / `rotate-preview-secrets`，上游四模块必须**围绕**它们合并，不能覆盖。L2 与 L1 同一 PR，否则等于埋了个 Windows 崩溃。

---

## 4. PR 拆分（按依赖顺序，逐个可独立评审）

每 PR 一条分支，从 `main` 切，完成后合回 `main`。**每 PR 只做一件事**，可独立 revert。
每个 PR 描述带 `接触面：T<n> · <文件数> · slug=fork:<slug> · audit leak 56 → ≤56`。

### PR-0 · 基线清理（0.5h，无代码）
- 确认 `git status --porcelain` 干净、`npm test` 全绿、`npm run prod` 能起。
- **DoD**：脏树落 commit；基线可复现。

### PR-1 · 基础设施小项（S，6 项）
- M9 SDK 启动预导入（`instrumentation-node.ts`）
- M10 Tailwind 排除 `.claude`（`app/globals.css`）
- M11 PWA 应用名运行时配置（`app/manifest.ts` / `app/layout.tsx` / `bin/pi-web-options.js` 帮助文本）
- M12 `httpIdleTimeoutMs` 作用于 Web UI（`lib/http-dispatcher.ts` 复用 `lib/regular-file.ts` + `instrumentation-node.ts`）
- M13 SSE 图片回显去重（`lib/agent-event-wire.ts`）
- M4 运行中/压缩中拒绝 `ctx.reload()`（`lib/rpc-manager.ts:1385` / `:2078`）
- **上游依据**：`6425d0d2` `67421824` `2adb1855` `650d7a34` `#1176` `e4933102`
- **DoD**：每条补单测；SSE 单测断言非 assistant `message_start` 只带 `{role}`；reload 守卫单测。
- **接触面**：T1 · 6 个上游文件 / 8 处 · slug=`fork:infra-parity`

### PR-2 · 侧栏 / 会话交互补齐（M，拆 2a/2b）
- **2a 交互**：S1 删除项目全部会话（新 `lib/session-delete.ts` + `app/api/sessions/delete/route.ts` + 菜单项）、S2 新标签页打开（新 `lib/session-links.ts` + 标题改 `<a>` + 行菜单）、S3 已删会话链接（`AppShell.tsx` 加 `linkedSessionId` + 跳过 workspace 恢复）、S4 折叠丢弃显示更多、S5 按位置计算 `visibleFamilies`、S6 等待输入（`lib/extension-ui-queue.ts` 加 `isBlockingExtensionUiRequest` + `lib/rpc-manager.ts:421-430` 改 `isAwaitingInput`）、S7 外部会话发现（`lib/session-list-scanner.ts` 加成员检查）、S8 文件标签 park/恢复（`components/file-tab-state.ts` + `AppShell.tsx`）
- **2b 列表性能**：S10 去掉 `force`、S11 `catalogFirstMessage`（上限 + skill 展开转命令）、S12 `WeakMap` 关系缓存 + 视图尺寸记忆、S13 文件树 `focus` 重取
- **上游依据**：`c8182b18` `d9adb386` `e83280ed` `0066d5f9` `51dda7c5` `89d7141b` `8e602ca5` `d69b33e7` `b73fdebc` `a952ed50` `b2b6a45b` `4ad8aa31`
- **注意**：全部按**能力**补，`components/SessionTree.tsx` / `app/sidebar.css` 一个字不抄。
- **DoD**：单测（删除保留运行中、命名、成员检查、载荷上限）；两个浏览器验证新标签页与删除确认（默认聚焦「取消」，回车不删）。
- **接触面**：T1 为主 + T0 新文件 · slug=`fork:sidebar-parity`

### PR-3 · 侧栏状态服务端化（L）
- 新增 `~/.pi/agent/pi-web-session-state.json` + `lib/session-ui-state.ts` / `lib/session-ui-state-shared.ts` + `app/api/sessions/ui-state/route.ts`；把 `session-flags.ts` / `project-flags.ts` / `project-prefs.ts` / `session-groups.ts` 的 localStorage 迁到服务端 + revision 合并；`app/api/agent/running/route.ts` 带 `sessionUiStateRevision`。
- **上游依据**：`lib/session-ui-state*`（v0.11.0 已引入，本仓未做）
- **DoD**：单测（迁移 / 合并 / 冲突）；两窗口验证置顶/归档/顺序同步。
- **接触面**：T0 为主 + T1 少量接线 · slug=`fork:session-state`

### PR-4 · 子代理 A（小，3 项）
- A4 profile 决定 spawn 参数（去掉 Agent 工具的 `thinkingLevel`/`max_turns`/`inherit_context` 覆盖，只读 profile）
- A5 `provider/model:high` 后缀（扩 `parseSubagentModel`）+ Agent 说明加 `Thinking:` 行
- A6 右侧面板只读查看子代理（新 `components/SubagentViewer.tsx` + `components/subagent-viewer-state.ts` + `AppShell` `agentTabs` + `MessageView` 按钮改 `onOpenSubagent`）
- **上游依据**：`fb6df881` `445b58cd` `311a9016`
- **注意**：本仓有 `lib/subagent-thinking.ts` 归一化，保留；只去掉请求级覆盖。
- **DoD**：单测（后缀解析、profile 权威、viewer 状态合并）+ 真跑一个带 `model: provider/model:high` 的 profile。
- **接触面**：T1 · `lib/subagent-runtime.ts` / `lib/subagent-extension.ts` / `components/AppShell.tsx` / `components/MessageView.tsx` · slug=`fork:subagent-parity`

### PR-5 · 子代理 B（builtin-extensions 地基，L，3 项）
- 先落地 `lib/builtin-extensions.ts`（本仓没有，A1/A2/A3 共用）
- A3 `session_start` 注册的工具子代理可调（`SDK_BUILTIN_TOOLS` + `subagentToolOptions` + snapshot `allExtensionTools`）
- A2 profile `codemode:`（新 `createSubagentCodemodeExtension`）
- A1 profile `mcp: on`（`createSubagentMcpExtensions` + `prepareChildMcp` + `lib/mcp-read-only-policy.ts` 加 `createSubagentMcpPolicyExtension` + `lib/rpc-manager.ts` `prepareMcpForRun`）
- **上游依据**：`0db6734c` `81cc2856` `68f04ef3`
- **DoD**：单测（白名单只加载列出的、只读子代理拦非只读 MCP 工具、`mcp: off` 不连）；真跑一个 `mcp: on` 的 profile。
- **接触面**：T1 · `lib/subagents.ts` / `lib/subagent-runtime.ts` / `lib/rpc-manager.ts` / `lib/mcp-read-only-policy.ts` · slug=`fork:subagent-builtin-ext`

### PR-6 · 聊天渲染小改（S×N，可合并评审、分开 commit）
- C1 自定义消息标题折叠、C2 出错保留处理详情、C3 历史去重、C4 停止按钮让位、C5 `lib/notice-text.ts` + 通知渲染、C6 `display:false` 隐藏 + 锚点补 `subagent-notification`、C7 切会话后重试/占比/速度/历史窗口（新 `lib/stream-token-rate.ts` + `earlierTurnCount`）、C8 小地图轮次编号、C9 小地图锁定（新 `lib/minimap-preview-lock.ts`）、C10 错误 reason 码 + i18n、C11 两位数序号、C12 桌面应用链接
- **上游依据**：`574cbba1` `f47c38a2` `d474ce23` `0a38de9f` `e7415ea9` `f0bc371c` `5fd1e674` `5220b88f` `50486b31` `20b688ce` `8347ea5c` `5af2e04e`
- **注意**：C6 本仓刻意把隐藏消息折叠显示 —— 保留该分叉，只补锚点。
- **DoD**：每条补单测；改样式跑 `check:design` + `verify:boards`。
- **接触面**：T1 · slug=`fork:chat-polish`

### PR-7 · 渲染性能（L，纯重构，最后做、可单独 revert）
- C16 Prism 按需（`lib/prism-languages.ts` + `hooks/usePrismLanguages.ts` + `AsyncCodeHighlighter.tsx` 换入口）
- C15 `lib/turn-views.ts` 缓存 answer/process/writtenFiles
- C14 外部 `StreamingStore` + `hooks/useStreamingSelector.ts` + `lib/tool-call-expansion.ts`
- **上游依据**：`046bc67e` `06991071` `e8d91efd`
- **DoD**：先补 perf 回归（重渲染计数）再改；全量测试绿；真实长会话冒烟。
- **接触面**：T1 · `hooks/useAgentSession.ts` / `components/ChatWindow.tsx` / `components/MessageView.tsx` · slug=`fork:render-perf`

### PR-8 · 文件（M，3 项）
- C13 HTML > 256 KB 完整预览（`FileViewer.tsx` + `lib/file-preview-support.ts`）
- S9 文件树按项目记住展开目录（新 `lib/file-tree-expansion.ts` + `FileExplorer.tsx`）
- （S13 已在 PR-2b）
- **上游依据**：`93b3aba5` `3fe257f2`
- **DoD**：单测（展开记忆键、HTML 阈值）；大 HTML 真机预览。
- **接触面**：T1 · slug=`fork:file-parity`

### PR-9 · 模型（S，3 项）
- M1 Kimi For Coding 用量额度（`lib/provider-usage-ids.ts` + `lib/provider-usage.ts`）
- M2 保留能力元数据（`lib/model-discovery.ts` + `ModelsConfig.tsx` 落库）
- M3 按 pi `/model` 顺序（`lib/model-scope.ts` 加 `orderSelectorModels` + 去掉两处按名排序）
- **上游依据**：`1a560533` `b6318bed` `a3a158a0`
- **DoD**：单测（端点、字段提取、顺序）。
- **接触面**：T1 · slug=`fork:model-parity`

### PR-10 · 终端（M，2 项）
- M7 Termux 额外键（新 `lib/terminal-extra-keys.ts` + `components/TerminalExtraKeys.tsx` + `TerminalPanel.tsx` 手机分支）
- M8 软键盘收窄后输入不失效（`app/api/terminal/[id]/route.ts` 接受 `rows>=1` + 客户端夹取）
- **上游依据**：`68353265` `3ff7e1d7`
- **DoD**：单测（修饰键一次性、键位映射）；真机/模拟器竖屏验证。
- **接触面**：T1 · slug=`fork:terminal-parity`

### PR-11 · 音频（M，2 项）
- M5 空闲挂起音频上下文；M6 运行期间保持 + resume>3s 丢弃（`hooks/useAudio.ts` + `hooks/useAgentSession.ts` 运行生命周期调 `holdAudio`）
- **上游依据**：`7a416ce8` `d1529d04`
- **注意**：本仓 `useAudio` 有 `lib/sound-presets.ts` 预设层，**保留**，只补挂起/保持/超时结构。
- **DoD**：单测（挂起/恢复/超时丢弃）。
- **接触面**：T1 · `hooks/useAudio.ts` / `hooks/useAgentSession.ts` · slug=`fork:audio-parity`

### PR-12 · CLI（L，2 项）
- L1 五命令（新 `bin/pi-web-commands.js` / `bin/pi-web-update.js` / `bin/run-records.js` / `bin/browser-opener.js` + 改 `bin/pi-web.js` / `bin/pi-web-options.js`）
- L2 `exitWhenIdle`（Windows `0xC0000409` 修）
- **注意**：围绕本仓 `lan-supervisor` / `rotate-preview-secrets` 合并，**不覆盖** `bin/pi-web.js`。
- **DoD**：`lib/pi-web-cli-commands.test.mjs` 等价单测；三平台（mac/win/linux）手工跑 `version`/`status`。
- **接触面**：T1 · `bin/pi-web.js` / `bin/pi-web-options.js` · slug=`fork:cli-commands`

### PR-13 · 工作树（S，2 项）
- A7 已删工作树从分叉仓库回答（`lib/worktree.ts` 加 `repoRootFromCommonDir` + 放宽 `isRepo`）
- A8 裸克隆工作树归到克隆下（`lib/worktree.ts:159` 用 `repoRootFromCommonDir`）
- **上游依据**：`f9a370e0` `11c2aa2c`
- **DoD**：单测（bare / `.git`-file / 普通仓库三态）。
- **接触面**：T1 · `lib/worktree.ts` · slug=`fork:worktree-parity`

---

## 5. 建议顺序与里程碑

```
PR-0 清理 ──┬─► PR-1 基础设施小项        （无依赖，先做）
            ├─► PR-2 侧栏/会话（2a→2b）  （无依赖）
            ├─► PR-4 子代理 A            （无依赖）
            ├─► PR-6 聊天小改            （无依赖）
            ├─► PR-9 模型 / PR-10 终端 / PR-11 音频 / PR-13 工作树（均无依赖）
            └─► PR-12 CLI                （独立，但工作量大）

PR-4 ──► PR-5 子代理 B（builtin-extensions 地基）
PR-2 ──► PR-3 侧栏状态服务端化（localStorage 迁服务端，L）
PR-6 ──► PR-7 渲染性能（重构，最后做）
PR-2 ──► PR-8 文件（S9 依赖 PR-2 的 FileExplorer 改动面）
```

- **M0（先做）**：PR-0 + PR-1 —— 全是 S 级、互不依赖，一天内可合。
- **M1（用户可感知）**：PR-2（侧栏/会话）+ PR-6（聊天小改）+ PR-9/10/11/13。
- **M2（子代理）**：PR-4 → PR-5。
- **M3（基础设施）**：PR-3（服务端状态）+ PR-8（文件）。
- **M4（大件）**：PR-12（CLI）+ PR-7（渲染性能重构）。

---

## 6. 每个 PR 的统一门禁

```bash
export PATH="/usr/local/bin:$PATH"   # 本机 bash 默认 PATH 无 node
node_modules/.bin/tsc --noEmit      # 0
npm test                             # 全绿（新增逻辑必须有单测）
npm run lint                         # 0 error
npm run check:design                 # 改了 UI 必跑
npm run check:contrast               # 改了任何前景/背景色
node docs/upstream-merge-audit.mjs   # leak 只允许降（现 56）
npm run prod                         # 构建 + 起服 + 浏览器冒烟
```

---

## 7. 风险与未尽事项

1. **子代理三字段（A1/A2/A3）是语义 bug，不是缺功能**：`resourceBoolean` 把 `mcp:` / `codemode:` 当布尔/全加载，等于「用户写了白名单，实际全开」——优先级高于观感类小改。A1 还牵涉安全（只读子代理必须拦非只读 MCP 工具）。
2. **PR-7 是全盘最大风险**：对着本仓分叉的渲染器做流式存储重构，回归面在 `useAgentSession` + `ChatWindow` + `MessageView`。先补重渲染计数回归，允许单独 revert。
3. **PR-12 CLI 最容易被漏**：本仓 `bin/pi-web.js` 已带 `lan-supervisor` / `rotate-preview-secrets`，上游四模块必须围绕合并；L2 的 Windows 修必须与 L1 同 PR。
4. **侧栏是形态分叉区**：`SessionTree.tsx` / `app/sidebar.css` / `lib/session-tree.ts` **一个字不抄**；只按能力补，`verify:boards` 会量 V5。
5. **PR-3（服务端状态）是 L 级基础设施**：三份 localStorage 迁服务端 + revision 合并，单独一轮；不做则跨端同步永远缺。
6. **上游仍在推进**：`v0.12.0` 是 2026-10-12 的提交，执行前重新 `git fetch agegr --tags` 对一次。
7. **本文件的审计快照**：2026-10-12。上游再发版就重跑，不要在本文件上直接改数字。
8. **审计证据口径**：本表状态由四个并行子代理逐文件读取本仓代码得出；标注 `unverified` 的项（如部分行号）以实际执行时的代码为准。

---

## 8. 执行状态（2026-10-12 首轮）

**已合入 main（15 个提交）**：`ee36c84a..3c559512`

| PR | 内容 | 状态 |
| --- | --- | --- |
| — | 计划审计完成（68 commit / 301 文件 → 14 PR） | ✅ |
| PR-0 | 基线清理（+ 让 lint 门禁真正可跑：排除 vendored 资产 + memo sections，583 错 → 0 错） | ✅ |
| PR-1 | 基础设施小项（SDK 预导入 / Tailwind .claude / PWA 名 / httpIdleTimeoutMs / SSE 图片去重 / reload 守卫） | ✅ |
| PR-2 | 侧栏/会话（2a 删除全部/新标签页/已删链接/显示更多/等待输入/外部发现 + 2b 列表与文件树性能） | ✅（S8 文件标签 park/恢复 未做） |
| PR-3 | 侧栏状态服务端化（session-ui-state，L） | ⬜ 未做 |
| PR-4 | 子代理 A（profile 决定 spawn 参数 + model:level 后缀） | ✅（A6 右侧面板查看器 未做） |
| PR-5 | 子代理 B（builtin-extensions 地基 + codemode + mcp:on + session_start 工具，L） | ⬜ 未做 |
| PR-6 | 聊天小改（C2 处理详情 / C3 历史去重 / C5 二维码 / C6 隐藏消息 / C11 序号 / C12 桌面链接） | ✅ 部分（C1 自定义消息标题折叠 / C4 停止按钮让位 / C7 切会话状态 / C8 小地图编号 / C9 小地图锁定 / C10 错误提示 未做） |
| PR-7 | 渲染性能（Prism 按需 / turn-views / 流式 store，L） | ⬜ 未做 |
| PR-8 | 文件（HTML > 256KB 预览 + 文件树按项目记住展开目录） | ✅ |
| PR-9 | 模型（Kimi 用量 / 能力元数据 / `/model` 顺序） | ✅ |
| PR-10 | 终端（Termux 额外键 + 软键盘输入保活） | ✅ |
| PR-11 | 音频（空闲挂起 + 运行期间保持） | ✅ |
| PR-12 | CLI（5 命令 + Windows 修复，L） | ⬜ 未做 |
| PR-13 | 工作树（裸克隆归组 + 已删工作树回退） | ✅ |

**验收数据**
- `tsc --noEmit` **0 错**
- `npm test` **3949 pass / 0 fail / 8 skipped**
- `npm run build`（next build --webpack）**成功**
- `npm run check:styles` / `check:icons` **绿**；`npm run lint` **0 error**（此前 583 error，见 PR-0）

**本轮未做（附理由）**

| 项 | 为什么没做 |
| --- | --- |
| PR-3 侧栏状态服务端化 | L 级基础设施：三份 localStorage 迁服务端 + revision 合并，单独一轮 |
| PR-5 子代理 B（builtin-extensions / codemode / mcp:on / session_start 工具） | L 级：先落 `lib/builtin-extensions.ts` 地基，再补三个 frontmatter 字段，需真实会话验证 |
| PR-7 渲染性能（流式 store / turn-views / Prism 按需） | L 级纯重构，对着本仓分叉的渲染器做，回归面大，建议单独一轮并配重渲染计数回归 |
| PR-12 CLI 五命令 | L 级：本仓 `bin/pi-web.js` 已带 lan-supervisor / rotate-preview-secrets，上游四模块须围绕合并 |
| PR-4 A6 子代理查看器标签 | M 级 UI 新增（`SubagentViewer.tsx` + AppShell `agentTabs` + MessageView 入口） |
| PR-6 剩余小项（C1/C4/C7/C8/C9/C10） | S 级，可与下一轮一起做 |
| PR-2 S8 文件标签 park/恢复 | M 级：`file-tab-state.ts` + AppShell 切换逻辑 |

