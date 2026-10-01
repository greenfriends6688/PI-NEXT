# 功能面对比（feature parity）：PI NEXT 0.1.6 ⟷ PI-Desktop 0.16.0-beta.1

分析日期：2026-10-01
基准：本仓库 `/Users/yingjing/Desktop/pi-codex`（下称**我们**）
对象：`pi参考项目/PI-Desktop-main`（下称**他们**）
范围：**只管功能/能力**。视觉、交互手感、PR 评审由别的 agent 负责。
遵守 FACTS.md 三条不可抄约束（数据模型 / 进程模型 / 设计系统）；本文只在「建议动作」里标注哪些方案需要绕开这三条。

**实现位置图例**（移植代价差别巨大，全表通用）：

| 标记 | 含义 |
| --- | --- |
| `R` | Rust（`crates/host-core`，SQLite 真源 + tokio sidecar） |
| `TH` | 对方 TS 宿主（`apps/desktop/electron/main/**`，Node + 系统 API） |
| `TR` | 对方 TS 渲染层（`apps/desktop/src/**`，React） |
| `PKG` | 对方共享/运行时包（`packages/*`，含他们**自研**的 agent-runtime） |
| `O` | 我们（Next.js Route Handler = `app/api/**`，进程内 pi SDK） |
| `OC` | 我们客户端（`components/*`、`lib/*`、`hooks/*`） |

> 关键结构性事实：他们的 `packages/agent-runtime`（137 个源文件）是**他们重写了一遍 pi**。凡是只存在于那个包里的能力（compaction 回退策略、checkpoint 世代、ask 工具的运行时侧），对我们**不可移植**——我们用的是官方 pi SDK。凡是落在 `host-core` + renderer 的能力，才是本文的候选。
> `[已验证]` / `[单侧]` / `[推断]` 标记同 FACTS.md。

---

## 0. 上一轮 `docs/pi-desktop-borrowing-plan-2026-09-24.md` 的 PD-01…PD-22 状态核对

用 grep 在当前代码里逐条验证（不只信文档）：

| PD | 主题 | 现状 | 证据（我们侧） |
| --- | --- | --- | --- |
| PD-01/02 | 文件查看器三态常驻 + diff memo | ✅ 已落地 | `docs/pi-desktop-borrowing-plan-2026-09-24.md` §8 交付记录 + `components/FileViewer.tsx` 现有测试 |
| PD-22 | 文件查看器两态化（源码/预览，diff 入口驱动） | ✅ 已落地 | 同上 |
| PD-03/04/05 | git diff 懒取 / 行窗口化 / AppShell 重渲 | ⏳ 部分（PR-03 未开工） | 文档 §5 PR-03 行 |
| PD-06…PD-10 | PWA 平板档位、溢出、顶栏 | ✅ 已落地 | 文档 §8 |
| PD-11…PD-14 | 项目级归档标志 / 索引页 / 接线 / 导入后恢复 | ✅ 已落地 | `lib/project-flags.ts:1`、`components/ProjectArchivePanel.tsx`、`lib/import/groups.ts` |
| PD-15/16/17 | 导入扫描层 / 落盘层 / 设置页 | ✅ 已落地 | `lib/import/{sessions,models,skills,mcp}.ts`、`components/ImportPanel.tsx` |
| PD-18…PD-21 | 模型快填 chips / 来源标记 / `samplingParams` / 校验 | ✅ 已落地 | `components/ModelsConfig.tsx:925`（`LimitChips`）、`:914`（「跟随目录」注释）、`samplingParams` 出现 22 处 |

**结论：上一轮 22 条里 19 条已落地、1 条部分、0 条漏。** 本轮**不重复报告**导入 / 项目归档 / 模型高级参数 / 文件查看器 / PWA 布局这五条线。正文只写「那一轮之后新增的」与「那一轮没看的维度」。

---

## 1. 总览：按 6 个维度的落点

| 维度 | 我们 | 他们 | 净差距 |
| --- | --- | --- | --- |
| 1 会话管理 | 归档/置顶/重命名/删除/会话内 find/全文搜索/导出 HTML/fork/分支导航/统计 | 同上 + **持久全文索引（FTS）**、会话跨项目移动、会话 hover 预览卡、**评审快照** | 我们**弱 1 项**（搜索）、**缺 2 项**（移动、评审快照） |
| 2 项目管理 | 项目=会话 cwd 派生 + 本地归档标志 + worktree 分组 | 项目实体 + 多 root 项目组 + **项目指令/记忆编辑器** + 级联删除 | 我们**缺 2 项**（指令/记忆编辑器），项目实体是上一轮已裁定不做 |
| 3 Agent 运行时 | 子代理（Agent/get_subagent_result/steer_subagent）、plan 模式、todo 工具、审批扩展、MCP、技能、插件 | 同上 + **ask 工具**、计划审批条、todo 崩溃恢复、工具预算、审计日志 | 我们**缺 2 项**（ask 工具、审计日志）；其余对齐 |
| 4 输入输出 | 图片附件 / 工具结果图片 / 图片预览灯箱 / 代码高亮 / diff 词级 / todo / 工具卡折叠 / 权限卡 | 同上 + **图像生成工具 + 画廊 + 下载 + 模型绑定** | 我们**缺 1 项**（图像生成） |
| 5 集成 | git/worktree、终端、浏览器面板、app-update、Web Push、导入 | 同上 + **定时任务**、**config sync（多设备）**、**SSH 远程主机 + RACP**、**通知收件箱**、**快捷启动清单**、**网络代理** | 我们**缺 4 项**，其中 3 项代价可控 |
| 6 设置面 | 供应商/凭据、模型高级参数、主题皮肤、字体、快捷键、语言、i18n(3)、用量查询、导入 | 同上 + 供应商**多账号**、按项目**启用作用域**、**远程主机**、**config sync**、**语音**、MCP/插件**市场目录**、**快捷键/语言页** | 我们**缺 4 项**（其中多账号/作用域是 SDK 限制） |

---

## 2. ① 我们完全没有的能力

按「高价值 + 中等代价」排序。每条给出他们侧证据（含实现位置）、我们侧证据（为什么是 0）、以及搬过来的形状。

### 2.1 功能类

| # | 能力 | 他们侧证据（实现位置） | 我们侧证据 | 形状 / 代价 | 置信度 |
| --- | --- | --- | --- | --- | --- |
| A1 | **定时任务**：hourly/daily/weekly 调度，绑工作区 + 权限模式 + provider/model/thinking | `crates/host-core/src/scheduled.rs:18`（`ScheduledTask`）、`scheduled/{automation,timing,project}.rs`、`apps/desktop/electron/main/runtime/scheduled-runner.ts`（**R + TH**）、`features/scheduled/*.tsx` + `pages/ScheduledPage.tsx`（**TR**） | `app/api/` 下无任何 scheduled 路由；`lib/` 无 scheduled 模块（`grep -rn "scheduled" lib app components` 只命中 `lib/stream-update-scheduler.ts:69` 的 `cancelScheduledWork`） | 调度器必须落在**常驻进程**：`electron/main.js` 有托盘且 `window-all-closed` 不退出（`electron/main.js:365,553`），所以**桌面版可做**；Web/PWA 形态做不了。任务记录只能 `localStorage`（约束①）。代价 **M** | [已验证] |
| A2 | **语音输入**（听写 + 实时通话） | `packages/voice-runtime/src/*`（1030 行 Node，`model-manager.ts:12` 用 transcribe-cpp 本地跑 whisper）、`apps/desktop/electron/main/voice-service.ts`（**TH/PKG**）、`features/voice/**`（30 文件，含 `live/` 实时通话）、`features/settings/voice/LiveVoiceSettings.tsx`（**TR**） | 全仓无 `voice` 文件（`ls lib \| grep -i voice` 空；`grep -rln voice components` 空） | 他们的实现**不可照抄**（依赖 Electron IPC + 原生模块）。我们走浏览器路线：`MediaRecorder` + 一个 `/api/voice/transcribe` Route Handler 转发到任意 OpenAI 兼容 `/audio/transcriptions`，实时通话先不做。代价 **S–M**，价值高（移动端 PWA 场景收益最大） | [已验证] |
| A3 | **应用内指令 / 项目记忆编辑器** | `features/settings/agent-sections.tsx:14`（`AgentInstructionsSection`，读写全局指令文件）、`components/ProjectInstructionsDialog.tsx`、`components/ProjectMemoryDialog.tsx`（结构化条目记忆）、Rust 侧 `config_sync/domains.rs:24` `MAX_INSTRUCTION_BYTES = 32*1024`（**TR + R**） | `components/SystemPromptPanel.tsx:11` 注释明写「**只读**正文」；全仓 `grep -rn "AGENTS.md" lib components app` 无任何写入路径 | pi 自己的 context 文件发现顺序是 `AGENTS.override.md → AGENTS.md → AGENTS.MD → CLAUDE.md → CLAUDE.MD`（`node_modules/@earendil-works/pi-coding-agent/dist/core/resource-loader.js`，`loadContextFileFromDir`），所以编辑器 = 写这些文件，**完全 pi 原生**，不需要自建存储。项目记忆是他们的 SQLite 表，我们要么映射到 `<project>/.pi/` 下的文件，要么第一版只做指令不做记忆。代价 **S**（指令）/ **M**（记忆） | [已验证] |
| A4 | **MCP 官方市场目录** | `packages/shared/src/mcp-registry.ts:345` `DEFAULT_MARKET_SOURCE = https://registry.modelcontextprotocol.io/v0/servers`、`components/settings/McpMarketPanel.tsx`（分类/图标/一键安装，**TR**）、`apps/desktop/electron/main/user-mcp.ts`（**TH**） | `components/fork/McpConfig.tsx` 全文 **129 行**，只有「手填 + 从别家导入」；`lib/mcp-discovery.ts:16` 注释确认只有「读别的工具的配置」 | 目录是**公开官方 API**，不是他们的私有索引，可以直接消费。`/api/mcp/catalog` 一个 Route Handler + 一个市场面板即可。代价 **S**，价值中 | [已验证] |
| A5 | **插件市场浏览** | `crates/host-core/src/plugins/marketplace.rs:11` `OFFICIAL_CHANNEL_CATALOG_URL = https://plugins.aiuo.net/catalog.json`（+ 两个镜像）、`marketplace/catalog.rs`、`features/plugins/MarketplacePanel.tsx`（**R + TR**） | `components/PluginsConfig.tsx:47` 只有一个输入框，正则匹配 `$ pi install <source>`（`:1522` `installPlugin`） | 浏览 UI 可搬，**目录内容不能搬**（是他们社区的 catalog）。要么指向可配置 URL，要么接 pi 自己的包源。代价 **M**，价值中 | [已验证] |
| A6 | **技能 / 子代理应用内创作**（含作用域） | `crates/host-core/src/user_skills.rs:30`（`UserSkillRecord`，带 `level`/`projectPath`/`scope`）、`user_subagents.rs`、`agent_capabilities.rs`（765 行）、`components/settings/SkillEditorSheet.tsx:149`、`AgentSkillsPage.tsx:67`（**R + TR**） | `components/SkillsConfig.tsx:805` 只有「列表 / 开关 / 检查更新 / 安装」；无编辑器。`components/AgentsConfig.tsx` 能改 agent profile，但没有新建/删除/作用域 | 写 `SKILL.md` 与 `~/.pi/agent/agents/*.md` 都是 pi 已认的路径，**合法**；但「按项目启用作用域」需要我们自己过滤 pi 加载的技能（pi 无此字段），要么落成「装到项目目录 `.agents/skills`」这种可执行语义，要么不做。代价 **S**（编辑器）/ **M**（作用域） | [已验证] |
| A7 | **通知收件箱**（可读历史） | `crates/host-core/src/notifications.rs:43` `insert_for_terminal_turn`（终态 turn 与通知同事务）、`components/NotificationCenter.tsx`（395 行，全部/未读筛选、清空、跳会话，**R + TR**） | `lib/browser-notifications.ts` + `lib/notification-prefs.ts` 只负责**瞬时投递**（native → SW → window），没有任何持久化 | 纯展示数据 → `localStorage` 列表（约束①天然满足），S 代价。注意别重复造设置面板：偏好已经在 `notification-prefs.ts`。价值中 | [已验证] |
| A8 | **快捷启动清单 / 首启恢复** | `components/OnboardingChecklist.tsx`（125 行，5 步清单 + 深链到设置/项目/插件）、`StartupRecovery.tsx`、`StartupSplash.tsx`（**TH + TR**） | 无 onboarding 相关文件（`ls lib components \| grep -i onboarding` 空） | 步骤状态可落 `localStorage`；数据齐了（我们已有 `/api/auth/providers`、`/api/models`、`/api/worktrees`）。代价 **S**，价值中（提升首次成功率） | [已验证] |
| A9 | **网络代理设置**（system / direct / custom + bypass） | `crates/host-core/src/network_proxy.rs:7` `ProxyMode`、`:24` `DEFAULT_BYPASS`（回环 + 私网段）、`network_policy.rs`（http 明文策略）、`components/settings/NetworkProxySection.tsx`（**R + TR**） | 无。`lib/request-security.ts:109` 只是注释里提到「代理在前面」 | 我们所有出网都走 Node 进程：`lib/http-dispatcher.ts` 已是统一出口，装一个 `undici.EnvHttpProxyAgent` 即可；bypass 列表直接抄 `network_proxy.rs:24` 的语义（回环 + 私网，避免把本地模型服务器/MCP 端点吞掉）。代价 **S**，价值中（国内网络环境刚需） | [已验证] |
| A10 | **从 git URL 克隆出新项目** | `apps/desktop/electron/main/git-clone.ts`（10 分钟超时 + 端点策略）、`apps/desktop/src/lib/git-clone-url.ts`、`components/HomeProjectSwitcher.tsx:73`（首页项目切换器里直接克隆）（**TH + TR**） | `app/api/git/` 只有 `branch/diff/log/status`；`grep -rn clone lib components app` 只命中 `lib/draft-store.ts:28` 的 `cloneDraft` | 我们已有全套 git 工具链（`lib/git-changes.ts`、`lib/worktree.ts`）和 `allowFileRoot()`，克隆就是一次带超时的 `git clone` + 落点授权。代价 **S**，价值中 | [已验证] |
| A11 | **图像生成**（自带工具 + 模型绑定 + 画廊 + 下载） | `packages/agent-runtime/src/image-generation/tool.ts`、`packages/shared/src/image-generation.ts:21` `imageGenerationBindings`、`components/settings/ImageGenerationModelRow.tsx`、`features/chat/transcript/GeneratedImages.tsx` + `GeneratedImageViewer.tsx` + `generated-image-download.ts`（**PKG + TR**） | 只能**看**模型返回的图：`lib/tool-result-images.ts` + `components/MessageView.tsx:1609` `ResultImages`。`grep -rn "image_generation\|imageGen" lib components app` 无结果 | 工具侧在我们这里就是 `pi.registerTool`（参考 `lib/todo-extension.ts:58` 的写法），设置侧一张「生成模型」选择卡；画廊/下载我们已经有一半（`ResultImages` + `ImagePreview`）。代价 **S–M**，价值中 | [已验证] |
| A12 | **Ask 工具**（agent 用结构化问题问用户：单选/多选/自定义） | `packages/agent-runtime/src/runtime.ts:5428` `normalizeAskQuestions`、`packages/shared/src/asktool.test.ts`（输出序列化契约）、`components/AskToolCard.tsx`（233 行，逐题草稿 + 自定义项）（**PKG + TR**） | 我们注册的宿主工具有三个：`lib/subagent-extension.ts:154,249,288`（`Agent`/`get_subagent_result`/`steer_subagent`）与 `lib/todo-extension.ts:59`（`todo`）；**没有 ask** | 我们的 `extension_ui_request` 通道已经通了（`lib/rpc-manager.ts:1743` `ui.select`/`confirm`，渲染侧 `select/confirm/input/editor` 都已消费），单选版 ask ≈ 一个 150 行的扩展；多选要自己渲染一张卡。代价 **S**，价值中高（少一轮猜错） | [已验证] |
| A13 | **提示词增强**（可编辑模板 + 指定改写模型） | `features/settings/prompt-enhancement-card.tsx`（用户模板 + `EnhancementModelCard` + 改写模型/思考级别）、composer 上的 Enhance 动作（**TR**，改写请求落到他们 runtime） | `grep -rn "enhance" lib components` 无结果；`components/SystemPromptPanel.tsx:11` 明确「系统提示词刻意不可编辑」 | 我们照抄他们那条纪律：**只让用户改 user template，系统提示词保持内置**。模板存 `localStorage`，改写动作在当前会话里发一次隐藏 prompt。代价 **S–M**，价值中 | [已验证] |
| A14 | **审计日志** | `crates/host-core/src/audit.rs:7` `append` / `append_tx`（安全相关状态变更与审计记录同事务）、`:28` 附近有正则脱敏 | 无 | 追加式日志不违反约束①，但价值取决于是否有对外合规诉求；判定低优先 | [已验证] |
| A15 | **会话内 Release Notes / 更新日志** | `components/ReleaseNotesDialog.tsx`、`packages/shared/src/changelog.ts:934`（中文全文）、`features/settings/update-preference.ts` | 有更新检测（`lib/app-update.ts:5` GitHub releases）但无「更新了什么」的展示面 | 一份 `docs/CHANGELOG.md` + 一个 md 弹窗。代价 **S**，价值低中 | [已验证] |

### 2.2 架构级（不建议现在做，列出来是为了让「不做」有依据）

| # | 能力 | 他们侧证据 | 为什么我们不做 |
| --- | --- | --- | --- |
| X1 | **SSH 远程主机 + RACP 远程控制协议** | `components/settings/RemoteHostsPage.tsx`（449 行）、`packages/shared/src/racp.ts:1`、`protocol.ts:211` `remoteHostBootstrap`、`apps/pi-host` 整个 app | 我们是**单机单进程 Web 应用**，没有第二个 host 可以被控制；要做等于先把本仓变成可部署服务再写协议。XL，且与我们的产品形态冲突 |
| X2 | **config sync（多设备 WebDAV 同步）** | `crates/host-core/src/config_sync/`（13 个文件：`crypto.rs` AES-GCM vault、`transport.rs` ETag 条件写、`merge.rs` 三方合并、`domains.rs:22-33` 十个域）、`features/settings/config-sync-{preferences,progress,error}.ts`、`components/settings/ConfigSyncPage.tsx` | 值得排期但**必须按我们的形状重写**：真源是 pi 的 `settings.json`/`auth.json`，同步=同步这些文件，凭据还得单独加密通道；不能引入第二套配置存储（约束①）。代价 **L** |

---

## 3. ② 我们有，但更弱的

| # | 能力 | 他们 | 我们 | 差距的性质 | 置信度 |
| --- | --- | --- | --- | --- | --- |
| B1 | **会话全文搜索** | `crates/host-core/src/session_search.rs:57` `search()`：FTS5 预筛 + `pi_search_contains` 自定义函数兜底非 ASCII（`:31-51`）+ `SearchPage { hits, next_offset }` **分页**（`:30-34`） | `app/api/sessions/search/route.ts:4` → `lib/session-search.ts:31` `searchSessionContents()`：**逐文件流式读**，硬上限 `MAX_FILES=2000 / MAX_RESULTS=50 / TIME_BUDGET_MS=4000`（`lib/session-search.ts:10-14`），命中 50 条就 `truncated:true` | 我们**已经在维护一个持久索引**（`lib/session-list-scanner.ts:292` `pi-web-session-index.json`，实测 553KB，含 `firstMessage` 文本），但只存**元数据**不存正文；同时候选索引 `lib/pi-session-index.ts:67` `ensurePiSessionsIndex()` 在 `app/api/sessions/route.ts:24` 每次列表都起，可它的产物（`~/.pi/agent/sessions-index.sqlite`）**搜索路径完全没读**（`grep -rn "searchSessionContents" app` 只有 search 路由） | [已验证] |
| B2 | **插件管理** | `features/plugins/MarketplacePanel.tsx` + `PluginDetailSheet.tsx`（368 行，权限徽标/分类/详情）+ `InstalledPluginsPanel.tsx` + `install-progress.ts`（队列化安装）+ `plugins/permissions.rs` | `components/PluginsConfig.tsx`（2001 行）：装/卸/更新/启停 + 安装位置展示，**入口是手打 `pi install <source>`**（`:47`） | 缺的是「发现」与「信息量」，不是「管理动作」 | [已验证] |
| B3 | **评审（Review）** | `crates/host-core/src/review.rs:1-6`：「证据在**工具执行时**捕获，而不是从一个会变的工作树重建」；`components/workpanel/ReviewTab.tsx` | `components/TurnWrittenFiles.tsx` 只列本轮写过的**文件名**（无增删行数，注释里明说画板没有这个数据），diff 一律现算（`lib/git-changes.ts`） | 他们的方案要「写工具执行时留快照」——我们可以在 Route Handler 里对 `write`/`edit` 工具结果做同样的事（工具结果里有 diff），比他们便宜；但仍属中等代价 | [已验证] |
| B4 | **会话 hover 预览卡** | `features/sessions/SessionHoverCard.tsx` + `useSessionHoverCard.ts` + `sessionPreview()`（悬停即预览最近内容/运行态/分支） | `components/SessionSidebar.tsx:2307` 只有 `hovered` 布尔（用于显行动作钮） | 体验类，价值中低，代价 S | [已验证] |
| B5 | **会话跨项目移动** | `crates/host-core/src/sessions.rs:1852` `move_session_project()` + `apps/desktop/src/components/Sidebar.tsx:1513`（拖会话行到项目上） | `app/api/sessions/[id]/route.ts:182-206` 的 PATCH **只接受 `name`**（重命名）；侧栏只有项目行可拖（`components/SessionSidebar.tsx:447` `useProjectDrag`） | pi 的会话按 cwd 分目录存放（`~/.pi/agent/sessions/<encoded-cwd>/*.jsonl`），移动 = 搬文件 + 改 header cwd + 失效三处缓存（`lib/session-path.ts` / session-list / session-manager）。代价 S–M | [已验证] |
| B6 | **子代理 / 计划的崩溃恢复** | `features/chat/todos/session-todos-recovery.ts` + `useSessionTodosRecovery.ts`、Electron 侧 `runtime/event-persistence.ts`（事件先落盘再渲染，崩了能重放） | 我们 todo 状态从 transcript 反解（`lib/todo-state.ts` + `components/ChatWindow.tsx:1722`），刷新后自然恢复；消息层面无「落盘重放」层 | todo 维度我们其实**等价**（反解 > 重放）；消息重放层对我们价值不大（单进程无常驻崩溃窗口）。判定：**不必补** | [已验证] |
| B7 | **多语言覆盖** | `packages/i18n` + `changelog-{de,es,fr,ko,pt-BR,ru,tr}.ts`（≥10 语种） | `lib/i18n/messages/{en,zh-CN,zh-TW}.ts` | 三语 vs 十语。价值低、代价持续（每加一个 key 乘 N）。**不建议追** | [已验证] |

---

## 4. ③ 他们有，我们**刻意不做 / 做不到**

| # | 能力 | 他们侧证据 | 我们侧「为什么」 | 判定 | 置信度 |
| --- | --- | --- | --- | --- | --- |
| C1 | **同一供应商多账号 OAuth** | `crates/host-core/src/providers/credentials.rs`（`config_oauth_account_label` 等）、`components/settings/useVendorAccounts.ts`（同一 vendor 下多条账号行 + 序号）、`VendorAccountDialog.tsx`、`features/settings/agent-sections.tsx` 注释引 ADR 0098 | `AGENTS.md`「Auth and model config」明写：**`auth.json` 每个 provider 只有一条凭据**，`ModelRuntime.logout()` 删的就是那一条；`lib/provider-credential-store.ts` 是它的薄封装 | **做不到（SDK 限制）**，不是不想做。多账号要改 pi SDK | [已验证] |
| C2 | **自建加密凭据库** | `crates/host-core/src/secrets.rs:20` `SecretStore::open`（机器密钥 + AES-256-GCM）、`config_sync/crypto.rs`（同步用 vault） | 真源是 `~/.pi/agent/auth.json`（约束①）。我们再造一份加密凭据库 = **第二个真源**，一旦 SDK 改格式就静默失联 | **刻意不做** | [已验证] |
| C3 | **工具并发预算 / 准入闸** | `crates/host-core/src/tool_budget.rs:6-13`（in-flight 上限：tools 16 / shell 4 / reads 8 / mutations 2 / per-session 4，排队 30s） | 这是 **sidecar 架构的补丁**：他们的 Rust 进程并发跑工具，需要闸。我们的工具在**同一个 Node 进程**里跑（约束②），加闸 = 给整个 Web 服务排队 | **刻意不做** | [已验证] |
| C4 | **跨会话插件投递账本**（session collaboration） | `crates/host-core/src/session_collaboration/`（7 文件，幂等键、权限上限、turn 结算）、`features/sessions/session-collaboration-{reader,view}.ts` | 幂等 + 事务账本 = SQLite（约束①）；而且它的价值来自「插件生态 + 远程 host 投递」，我们两者都没有 | **刻意不做**（等真有插件生态再谈） | [已验证] |
| C5 | **per-session scratch 目录** | `crates/host-core/src/scratch.rs:1-8`（工具产生的临时文件放 `<data>/scratch/<session>/`，启动清扫） | 要改的是**工具写入路径**，而 `write`/`edit` 由 pi SDK 拥有；我们改不了工具落点 | **做不到（SDK 限制）** | [已验证] |
| C6 | **自研 runtime 的 compaction 回退 / checkpoint 世代** | `packages/shared/src/context-compaction.ts`（`retained_tail` 回退、`fresh_window` 策略、generation 计数）、`packages/agent-runtime/src/compaction-*.ts` | 那是**他们重写 pi** 的产物。我们用官方 SDK 的 compaction，并已按新旧两套事件名对齐（`AGENTS.md`「Compaction SSE events」） | **刻意不做**（重写 SDK 不可能） | [已验证] |
| C7 | **Windows 全局热键兜底**（Alt+Space 被系统占用） | `crates/host-core/src/keyboard.rs:1-12`（`WH_KEYBOARD_LL` 低级钩子，专治 Windows `RegisterHotKey` 冲突） | 纯 Windows/Electron 平台问题；我们的快捷键是浏览器 `keydown`（`hooks/useKeyboardShortcuts.ts`），冲突时用户换键即可 | **不做** | [已验证] |

> 顺带一条**反向差异**（他们没有我们有，列出以免被误抄）：**会话导出 HTML** 是我们的（`app/api/sessions/[id]/export`，且把递归树助手改写成迭代版防深栈溢出）；他们 `grep -rln "exportSession" crates apps` 无命中。移植时不要为了「对齐」把它删掉。

---

## 5. 建议动作

价值/代价判定依据写在最后一列。**代价**按「新增文件数 × 是否触碰既有热路径 × 是否需要新进程」估。

| # | 动作 | 类型 | 价值 | 代价 | 依赖 | 落点文件 | 判定理由 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Ask 工具**（结构化提问，单选起手） | 新增功能 | 高 | S | 复用现有 `extension_ui_request` 通道 | 新增 `lib/ask-tool-extension.ts`（照 `lib/todo-extension.ts:58` 的 `pi.registerTool` 写法）+ `components/AskToolCard.tsx` + `lib/i18n/messages/*.ts` | agent 猜错一整轮的成本远高于写一个 150 行工具；UI 通道已通，只差卡片 |
| 2 | **应用内指令编辑器**（写 `AGENTS.md` / `CLAUDE.md` / `AGENTS.override.md`） | 新增功能 | 高 | S | 无（pi 已认这些路径） | 新增 `app/api/instructions/route.ts`（GET/PUT，目录候选抄 resource-loader 的 `loadContextFileFromDir` 顺序）+ `components/InstructionsPanel.tsx` + 接进 `components/SettingsPanel.tsx:963-975` 的 sections 数组 | 项目里最常被手改的文件就是它；不新建任何存储，符合约束①；给 32KiB 上限 |
| 3 | **网络代理设置** | 补齐 | 中高 | S | 统一出网口 `lib/http-dispatcher.ts` | 新增 `app/api/settings/network-proxy/route.ts` + `lib/network-proxy.ts`（bypass 语义抄 `network_proxy.rs:24`）+ `components/NetworkProxySection.tsx` | 国内网络环境下这是「能不能用」级别的问题；实现面只有「给 undici 装 agent」这一处 |
| 4 | **MCP 官方市场目录** | 新增功能 | 中高 | S | 外部公开 API | 新增 `app/api/mcp/catalog/route.ts`（拉 + 缓存 + 上限）+ `components/fork/McpMarketPanel.tsx` | 目录是 MCP 官方 registry，不是他们的私有资产；我们已有 MCP 管理面板可挂载 |
| 5 | **git 克隆建项目** | 新增功能 | 中 | S | 已有 git 工具链 + `allowFileRoot()` | 新增 `app/api/git/clone/route.ts`（带超时、进度落日志）+ `components/NewTaskPicker.tsx` 里加入口 + `lib/git-clone-url.ts` | 我们现在只能手动 clone 再切目录；这是 onboarding 链上的一环，和 A8 清单配套 |
| 6 | **会话全文搜索升级**（复用已有索引文件做正文投影） | 补齐 | 中 | M | `lib/session-list-scanner.ts:292` 的持久索引 | `lib/session-search.ts` + `lib/session-list-scanner.ts`（索引里加**有上限**的正文投影，mtime/size 失效）+ `app/api/sessions/search/route.ts`（加分页，替掉 `MAX_RESULTS=50` 截断） | 现状是 4s 线性扫描 + 50 条截断；**先测一次 2000 会话下的真实耗时再动手**，不值就别做。投影必须设硬上限（约束②），且它只是缓存不是真源 |
| 7 | **通知收件箱** | 新增功能 | 中 | S | 复用 `lib/notification-prefs.ts` 的开关 | 新增 `lib/notification-inbox.ts`（localStorage）+ `components/NotificationCenter.tsx` | 「任务完成了但窗口在后台」是高频场景；纯展示数据，不碰存储纪律 |
| 8 | **快捷启动清单** | 新增功能 | 中 | S | 已有 `/api/auth/providers`、`/api/worktrees` | 新增 `components/OnboardingChecklist.tsx` + `lib/onboarding.ts`（localStorage 步骤状态） | 纯增量引导，配合第 5 条一起做；成本几乎全在 UI |
| 9 | **图像生成工具 + 模型绑定** | 新增功能 | 中 | S–M | pi 扩展 API | 新增 `lib/image-generation-extension.ts` + `components/ImageGenerationModelRow.tsx`；复用 `components/MessageView.tsx:1609` 的 `ResultImages` 做画廊 | 画廊/预览我们已有一半；差的是工具与设置。默认关闭，不对不支持的 provider 显示 |
| 10 | **快捷键 / 语言独立设置页** | 补齐 | 中 | S | 已有 `lib/shortcuts.ts` + `hooks/useShortcutBindings.ts` | `components/SettingsPanel.tsx` 增设 section，把 `useShortcutBindings` 的录制 UI 与 `lib/i18n` 语言选择搬进去 | 功能我们都有，只是埋得深；这是**可达性**不是新能力 |
| 11 | **技能 / 子代理应用内编辑器**（先不做作用域） | 新增功能 | 中 | S | 已有 `/api/skills`、`lib/subagents.ts` 的写路径 | 新增 `components/SkillEditorSheet.tsx` + `app/api/skills/route.ts` 扩 POST/PUT | 写 `SKILL.md` 是 pi 原生路径；**作用域先不做**（pi 无此字段，要靠我们自己过滤加载，风险大于收益） |
| 12 | **提示词增强（仅用户模板）** | 新增功能 | 中 | S–M | 当前会话可发隐藏 prompt | 新增 `lib/prompt-enhancement.ts` + composer 动作 | 照抄他们那条纪律：系统提示词保持内置不可编辑（参考 `prompt-enhancement-card.tsx:16-23` 的理由） |
| 13 | **定时任务（桌面版限定）** | 新增功能 | 中 | M | `electron/main.js` 常驻进程 | 新增 `electron/scheduler.js` + `app/api/scheduled/route.ts` + `components/ScheduledPage` 式面板；任务记录 localStorage | 价值真实（夜间日报/定时巡检），但**只在 Electron 形态成立**，Web/PWA 用户拿不到——所以要接受「两种形态能力不同」，别为了统一去引入常驻服务 |
| 14 | **插件市场浏览** | 新增功能 | 中 | M | 需要一个目录来源 | `components/PluginsConfig.tsx` 加「浏览」页 + `app/api/plugins/catalog/route.ts` | **目录内容不能抄**（他们的 catalog 是自己社区的）。要么用户自填 URL，要么等 pi 生态有公共源；否则只是个空壳 |
| 15 | **会话跨项目移动 / hover 预览卡 / Release Notes 弹窗** | 补齐 | 中低 | S | B4/B5/A15 各自的前置 | `app/api/sessions/[id]/route.ts` PATCH 扩 `cwd`；`components/SessionSidebar.tsx` | 三个都是小改动，可打包成一批；移动要注意 pi 的 `<encoded-cwd>` 目录约定 |
| 16 | **config sync（多设备）** | 移植交互 | 中 | L | 需要先决定「同步 pi 的哪些文件」 | 新建 `lib/config-sync/` + `/api/config-sync/*` | 约束①下必须同步**文件**而不是自建条目；凭据要走单独加密通道（C2 说我们不建凭据库，所以这里只能复用 `auth.json` 原文同步 = 高风险，**建议先只同步 skills/subagents/instructions/projects 这类非敏感域**） |
| 17 | **评审快照（Review）** | 补齐 | 中 | M | 工具结果里已有 diff | `app/api/agent/[id]` 事件处理里落快照 + `components/ReviewTab.tsx` | 比他们便宜（他们要从磁盘重建），但要新增一份快照存储，注意上限 |
| 18 | **SSH 远程主机 / RACP** | 不建议 | — | XL | — | — | 与「单机 Web 应用」形态冲突，需要先改产品形态 |
| 19 | **工具并发预算 / 跨会话投递 / 自建加密凭据库 / 多账号 OAuth / scratch 目录** | 不建议 | — | — | — | — | 见 §4 的判定（C1–C5），理由分别是 SDK 限制、架构补丁、或第二真源 |
| 20 | **多语言追平（≥10 语种）** | 不建议 | 低 | 持续 | — | `lib/i18n/messages/` | 每加一个 key 成本乘 N，且收益集中在少数地区 |

### 建议的落地批次

| 批次 | 内容 | 理由 |
| --- | --- | --- |
| **第一批（高价值 + S）** | #1 Ask 工具、#2 指令编辑器、#3 网络代理、#4 MCP 市场 | 四条都不新建存储、不引入新进程、都有现成挂载点；每条独立可回滚 |
| **第二批** | #5 克隆建项目 + #8 快捷启动清单、#7 通知收件箱 | 都是「高频场景的确定性收益」，UI 为主 |
| **第三批（先测量）** | #6 搜索升级、#17 评审快照 | 两条的收益都依赖「现状到底有多痛」，先量再排 |
| **待定** | #9 #11 #12 #13 #14 #15 #16 | 各自有明确前置或形态限制，排进常规需求池 |

---

## 6. 附录

### 6.1 明确**不写进正文**的项（避免重复劳动）

- 导入（会话/模型/技能/MCP 扫描 + 落盘 + 设置页）：上一轮 PD-15/16/17 已交付，本轮 grep 确认 `lib/import/*` + `components/ImportPanel.tsx` 在位，不重复。
- 项目级归档（PD-11/12/13）：已交付（`lib/project-flags.ts`、`components/ProjectArchivePanel.tsx`）。
- 模型高级参数（PD-18…21）：已交付（`components/ModelsConfig.tsx:925` `LimitChips`、`:914` 来源标记注释）。
- 文件查看器两态化（PD-22）与 PWA 布局（PD-06…10）：已交付，属视觉/性能域。
- 会话导出 HTML、todo 渲染、上下文环与缓存命中率、子代理工具卡、终端/浏览器面板/git 图谱、i18n 三语：两侧对等，不列。

### 6.2 未纳入本次对比的域（留给其他 agent）

- 视觉/设计系统（`design/pi-web-design` vs `apps/desktop/src/styles/*`）——受「设计系统不能混」约束。
- 交互手感、动画、快捷键录制体验等。
- 58 个 open PR 的评审与取舍（`pi参考项目/_pr/OPEN.md`）——本文只在能力维度标注了「他们有没有」，未逐 PR 评估。
- `packages/agent-runtime` 内部的运行时能力（自研 pi），除注明外一律视为不可移植。