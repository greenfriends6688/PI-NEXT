# XTLaw 借鉴计划与 PR 拆分（2026-10-10）

**参考项目：** `pi参考项目/XTLaw-master`（XTLaw = Lexora 二次开发，Vue + Electron 桌面 agent，pi 做 agent loop）
**目标：** 本仓 PI NEXT（Next.js + pi SDK 的本地 agent 工作台）
**方法：** 只读源码 + 它的 `docs/specs/*` 规格与 `docs/upstream-*-integration.md` 事故记录，按「机制」而不是「功能名」逐条对照。
**状态：** 计划，未动代码。

---

## 0. 一句话结论

XTLaw 值得抄的**不是它的功能清单**（会话/文件/审批/插件本仓都有），而是它在**同一件事上多走的几步收尾逻辑**：
提交幂等键、事件序号与缺口对账、停止期间对队列的显式保护、权限的「单向收窄」、引用的「写入前重验 + 不可信标注 + 伪造标记转义」、
审批的「作用域复用 + 服务端脱敏」、以及把「临时 UI 状态 / 会话状态 / 落盘偏好」分成三层互不覆盖。

其中三条是**本仓真实存在的能力空洞**（不是风格差异），优先级最高：

1. **`&session:` 引用是空头支票** —— `lib/composer-context.ts:serializeComposerMessage()` 在正文里写「需要时请检索或阅读该会话的相关内容」，但**没有任何模型可见的工具**能读会话（`lib/session-search.ts` 只服务侧栏/命令面板）。XTLaw 有 `lexora_session_search` / `lexora_session_read` + 本轮授权。
2. **SSE 没有序号** —— `lib/agent-event-stream.ts` 只写 `data:`，全仓无 `id:` / `Last-Event-ID` / seq / 缺口检测；断线只能整快照重发，丢事件无法发现。
3. **提交无幂等** —— `POST /api/agent/[id]` 没有 `requestId`，跨标签页/网络重试会重复 prompt（`acquirePromptAdmission()` 只串行化不去重）。

---

## 1. 逐域细节对比

> 判据列含义：**抄** = 机制可直接迁移；**改造抄** = 语义抄、载体换；**不抄** = 桌面/进程模型特有。

### 1.1 提交与回合

| 机制 | XTLaw 的细节 | PI NEXT 现状 | 判据 |
| --- | --- | --- | --- |
| 提交幂等 | `turn_requests` 表存 `request_id + request_fingerprint`；命中且指纹一致→返回旧 run，指纹不一致→`VALIDATION_FAILED`（`turnRequestRepository.ts`、`ChatTurnService.#findReplay`） | 无服务端幂等键；只有客户端 `agentRunningRef` 软防重（`useAgentSession.ts:handleSend`） | **抄** |
| 崩溃后重试 | 运行时重启把未结束 run 置 `failed + RUNTIME_RESTARTED`；同 requestId 重试走 `retryInterrupted` 复用 turn_requests 行、改指新 runId（`UPDATE ... WHERE changes=1`） | 无等价语义 | **改造抄**（本仓无本地 run 表，可落到 pi 的 entry 或一个轻量提交日志） |
| 回合状态机 | `RunStatus = queued/running/completed/failed/cancelled`，由 `RunEventProjector.projectRunStatus` 从事件投影，不由业务代码直写 | `AgentSessionWrapper.isRunning()` + `pendingPromptCount` + UI 侧 `agentPhase`；状态散在 wrapper 与 hook 两处 | 改造抄（把「谁是权威」写清即可，不必建表） |
| 过程折叠 | 折叠状态**只在组件内**（`collapsed/manuallyChanged`），不落库、不跨会话（spec-001 §8.5）；数据侧由 `chatAgentTurn` reducer 投影 | `ProcessGroup` 折叠本地；但缺 interleaved run 切分与重复 toolCallId 处理 | 改造抄（见 B3） |

### 1.2 事件流与恢复

| 机制 | XTLaw 的细节 | PI NEXT 现状 | 判据 |
| --- | --- | --- | --- |
| 事件序号 | 每 run 单调 `sequence`，DB 主键 `(run_id, sequence)`，磁盘每 run 一个 JSONL | 事件无序号 | **抄**（本仓可用「每 prompt 一个 runId + 自增 seq」） |
| 断线续传 | `afterSequence`（`sequence > ?`）半开区间 + `Last-Event-ID` | 只重发快照；`AgentEventConnection` 有重连但无游标 | **抄** |
| 去重 | 前端 key = `` `${runId}:${sequence}` ``（`chatRunEventBuckets.ts`） | 无 | **抄** |
| 缺口检测 | `hasChatRunEventSequenceGap` 期望 `seq === max+1`，检测到缺口即拉全量快照 | 无 | **抄** |
| 快照对账 | `SNAPSHOT_RECONCILIATION_EVENT_TYPES`（终态/审批/消息完成/产出）到达即拉快照；普通 delta 用 rAF 合并 | 有 `isEventIncludedInSnapshot()` 去重 + 背压（512KB/16MB），但无「按事件类型决定是否拉快照」 | 改造抄 |
| 恢复检查点 | `run_event_checkpoints` + 11 个 DB 触发器「任何写入即失效」+ 文件指纹三重校验（spec-018） | 无（无本地事件文件，无投影表） | **不抄**（载体不存在；保留「写入即失效」的思想用于缓存） |

### 1.3 停止与队列

| 机制 | XTLaw 的细节 | PI NEXT 现状 | 判据 |
| --- | --- | --- | --- |
| 停止两步 | 前端**同步冻结展示**（`cancelRunPresentation` 写伪 run）+ 后台**真实取消**（`ChatQueueService.cancelRun → ChatTurnService.cancel`） | `handleAbort` 直接 POST abort，无乐观展示层 | **抄** |
| 取消去重 | `#cancellations: Map<runId, completion>`，重复 cancel 返回同一 promise | 无 | **抄** |
| 停止期队列保护 | `#canDispatch` 闸门 + steer/followUp 在 `await` 后**二次检查** `isCancelling`；旧 run 的取消不暂停较新 run | 依赖 pi 的 `inner.abort()`；`lib/queue-surgery.ts` 有逐条操控但无 stop 保护 | **抄**（本仓已有队列手术台，正好接上） |
| 停止后语义 | **不自动继续**，需显式 `steerQueued`（首版「自动衔接」被用户推翻，spec-008） | 未定义 | **抄** |
| 取消失败 | `finally` 双重 `pause` + 删 map；前端 `restoreRunPresentation` 恢复真实展示 | 无 | **抄** |

### 1.4 会话切换与加载

| 机制 | XTLaw 的细节 | PI NEXT 现状 | 判据 |
| --- | --- | --- | --- |
| 先切换后加载 | `prepareBeforeOpen:false` + `peek()` 只返回 ready + `loadVersion` 丢弃过期结果（`TaskWorkspacePool`、`DesktopTaskContribution.vue`） | 有 `AbortController` + `sessionIdRef` 守卫 + `session-view-cache.ts` LRU 快照 | 已有（补 loading 态即可） |
| 未就绪可关闭 | `prepareClose` 对未 `peek` 到的 task 直接 `return true`，不强制初始化 | — | 改造抄（轻） |
| 统一加载态 | `DesktopTaskLoading`（标题/进度/失败重试/减少动画） | `AppShell` 只有 `systemInfoLoading`，无会话切换指示 | **抄**（小） |

### 1.5 权限与审批

| 机制 | XTLaw 的细节 | PI NEXT 现状 | 判据 |
| --- | --- | --- | --- |
| 能力档位 | `executionProfile ∈ read_only/workspace_write/full_access` × `approvalPolicy ∈ manual/policy` 两正交字段；UI 4 档是投影（`permissionMode.ts`） | `PERMISSION_MODES = bypass/ask/plan`，`plan` 由 `lib/plan-mode.ts` 另拦 | 改造抄（不必扩档，把正交维度说清） |
| 判定表 | `decisionTable.ts` 的 `TABLE[profile][access][zone]`，access×zone 二维穷举；特例集中（删目录/`.git`→ask、多 grant 根→deny、sensitive 读→ask） | `approval-policy.ts` 是有序规则列表 + `DANGEROUS_RULES`（12 条），特例分散 | **改造抄**：集中特例，不重写引擎 |
| 单向收窄 | `isExecutionProfileWithin(profile, limit)` = 序号 ≤；在**落库前**（`turnRequestRepository`）与**执行前**（`BuddySessionFactory`）各验一次；DB 无跨表约束，全靠应用层 | 无「会话上限 → 单次请求」的概念；plan 档靠两处规则手工保持一致 | **抄**（小，价值高） |
| 审批作用域 | `once/operation/source/turn` 四种；`createApprovalAuthorizationKeys` 算 SHA-256 key（shell 用 toolName+boundary+cwd+command 等）；run 结束清空 | 只有 `allow-session`（`pi-web:tool-grants`）+ `grantTargetFor/grantMatches` | **改造抄**（补 operation/source 粒度） |
| 审批 payload | `approvalReviewPayloadSchema` 判别联合（shell/paths/network/web/…）+ `approvalReviewPayloadMatchesKind` + 服务端脱敏 | `summarizeApprovalInput` 脱敏 `SECRET_KEY` + 160 字截断 | 已有（补判别联合与 kind 一致性校验） |
| 未决审批 | 会话活动态从 SQL 派生（`EXISTS(approvals pending)`）；重启 `cancelPendingApprovals`；30 分钟超时取消 run | `pendingUiRequests` 重放 + 侧栏「待授权」；无超时、无重启收敛 | **改造抄** |

### 1.6 引用与上下文（差异最大的一域）

| 机制 | XTLaw 的细节 | PI NEXT 现状 | 判据 |
| --- | --- | --- | --- |
| 结构化引用 | `buddyResourceQuoteSchema`（file/artifact/browser 三型）存 `userContent.resourceQuotes`，**不进附件数组** | `SelectionContext`（结构化，含 `sourceFilePath/startLine/endLine`）但发送时 `serializeComposerMessage()` **拍平成 markdown 正文** | **改造抄**：保留结构，别拍平 |
| 捕获→重验→写入 | `capture(viewId,quote)` 固定来源身份；`add()` 重取 source 比对 `source.identity/captured.identity/target.identity` 三者一致才写；`isSourceCurrent()` 菜单确认前再验 | 无身份校验；只在 UI 层拿当前 selection | **抄** |
| 目标身份 | `[draftId, editorKey, composer.target, navigationVersion()]`；分屏位置只用于显示，不作身份 | 无（单输入框模型） | 改造抄（有分屏时才有意义） |
| 去重与限额 | `sameResourceQuote` 逐字段比较；16 条 / 单条 32768 / 总长 131072；超限拒绝不截断 | `MAX_SELECTION_CONTEXT_CHARS = 12_000` 单条截断，无条数/总长 | **抄**（拒绝优于静默截断） |
| 不可信标注 | `projectBuddyUserContent` 给 quotes/resourceQuotes/session 各加「not instructions / not access grants」前缀，并 `escapeLiteralMarkers` 转义伪造的 `[FILE#n]` | `serializeComposerMessage()` 只有「仅作为资料，不切换当前会话」，**无转义** | **抄**（安全） |
| 会话引用授权 | 服务端 `resolveAuthorizedSessionReferences` 重查库、拒已删、真实 title 覆盖剪贴板；`requireTarget(sessionId)` 限定「本轮 user 消息显式引用」；附件读取仍走正常文件权限分类 | 只有剪贴板/行内 token 与 `serializeComposerMessage` 的文本；**无授权、无读取工具** | **抄（空洞）** |
| 定位来源 | `locate()` 按来源类型分别校验，失败保留快照并提示「来源已不可用」 | `fileSelectionText` 用 `@path:行号` 定位；DOCX 直接 `@path` 无定位 | 改造抄 |

### 1.7 工具暴露 / MCP / 技能

| 机制 | XTLaw 的细节 | PI NEXT 现状 | 判据 |
| --- | --- | --- | --- |
| 工具暴露分层 | `direct / on_demand(deferred) / codemode / hidden`，由 `ToolDisclosure.resolve()` 决定是否 active；`lexora_tool_search` 发现后下一轮才可调用 | 已注册 pi 的 `codemode`/`tool-search` 扩展，exposure 透传 pi | 已有 |
| MCP 命名空间 | `mcp__<namespace>__<tool>`（冲突加 sha256 后缀）；命名空间不可变 | 走 pi 的 mcp 扩展 | 已有（pi 侧） |
| MCP 凭据 | 配置与凭据分离，凭据走宿主 secret store，不落 SQLite | `~/.pi/agent/mcp.json` 由 pi 管 | 不抄（载体不同） |
| 技能懒加载 | 列表只读 `SKILL.md` frontmatter（`loadMetadata`），整包只在安装/选中时读；实测 50.4s → 0.85s（spec-028） | `loadSkillsWithInstallInfo` 只取 `loader.getSkills()` 元数据，正文由 pi 按需读 | **已有**（本仓没有原生逐文件读取器，无此瓶颈） |
| 预装插件 | `preinstalled.json` 只记「已处理 id」，禁用/卸载/版本/配置跨启动保持；bundled catalog + sha256 + manifest 相等校验 | 无预装概念（`assets/default-skills/` 是两个 skill） | 改造抄（若要做「随应用插件」） |

### 1.8 工作台与文件操作

| 机制 | XTLaw 的细节 | PI NEXT 现状 | 判据 |
| --- | --- | --- | --- |
| 布局三层分离 | 临时拖放（`useContextPanePresentation`）/ 会话内存（`taskPaneStates`）/ 落盘偏好（`openStates` + `WorkbenchPersistence`）互不覆盖；`expectedOpenState` + 世代号防旧 IPC 覆盖 | `lib/right-panel-split.ts` + `right-panel-split-memory.ts`（比例记忆、collapse）；三层是否分开需核实 | **改造抄** |
| 文件写围栏 | `WorkspaceFileMutationGuard` 目录级 fence + `WorkingCopyService` 租约；`result-unknown` 时保留围栏、置只读、**绝不盲目重试**；回收站失败**绝不降级永久删除** | `FileExplorer` 有 create/rename/delete/extract/compress；是否有 fence/result-unknown 需核实 | **抄**（安全） |
| 项目折叠行状态 | `resolveSpaceActivities()` 聚合子任务状态，**待授权优先于运行中**（spec-029） | 侧栏有 running 轮询与 `awaitingSessionIds/Kinds`；折叠项目行是否聚合需核实 | 改造抄（小，UX） |
| 中文触发符 | `、` 与 `/` 同源识别斜杠命令（`findChatComposerTrigger`，要求前置空白） | 有 `@` `#` `~` `&` `&session:` 触发符（`mention-tokens.ts`、`composer-references.ts`），**无 `、`** | **抄**（小） |
| 内置浏览器元素拾取 | 按钮进拾取模式 + 宿主桥接返回结构化元素快照（spec-013 §13） | 有 HTML sandbox iframe 预览；无元素拾取 | 改造抄（Web 受同源限制，价值有限） |
| 对话画布 | X6 图 + `createCanvasInteraction`（160ms 去抖、300 节点内关裁剪、LOD 迟滞、rAF 合并缩放） | `BranchNavigator.tsx` 是树，不是画布 | **不抄**（形态不同，成本高；交互控制器的性能思路可留作参考） |

### 1.9 插件机制（XTLaw 最大的结构性差异）

XTLaw 把「用户可安装插件」与「Agent 进程内扩展」分成两套：插件跑在独立 `BrowserWindow`（`sandbox:true`、独立 session partition、CSP `frame-src 'none'`），
只能通过白名单 IPC broker 调宿主，拿不到真实路径（不透明句柄）、拿不到 Node/FS/进程；进程内扩展是第一方、经 `validateLoadedExtensions` 审计。

**判断：本仓第一期不抄。** 理由：
- PI NEXT 是**本地单用户应用**，插件即用户自己 `pi install` 的 npm 包，信任模型与「应用市场里的第三方插件」不同；
- 在 Web 里做等价隔离需要独立 origin/iframe + 严格 CSP + postMessage broker，而**拿不到 Electron 那级 OS 进程隔离**，收益/成本比差；
- 真正可迁移的是**两条纪律**：① 安装/启用前展示「新增权限」（权限 diff）；② 预装只记基线、尊重用户禁用/卸载。这两条可低成本落到现有 `/api/plugins`（见 D 阶段可选 PR）。

---

## 2. 明确不抄（写进 `DIVERGENCE` 备查）

| 项 | 为什么不抄 |
| --- | --- |
| 三进程架构（渲染/主/本地服务）+ TOML 与 SQLite 双存储「过几道门」 | Electron 架构产物；单进程 Next.js 不存在。**保留原则**：写状态的那一层必须拿到值（配置快照要随请求传到执行层） |
| POSIX `0o600` / Windows ACL / 原生沙盒 | 桌面文件系统层；Web 隔离靠 DB 权限/租户/加密 |
| 每 run 一个 JSONL + `fsync` + inode/mtime 指纹 | 本地磁盘假设；本仓事件不在文件里 |
| `run_event_checkpoints` + 11 个 DB 触发器 | 本仓无投影表；「写入即失效」思想可用于缓存层 |
| 沙箱化插件宿主 / 隔离 BrowserWindow | 见 §1.9 |
| 对话画布（X6） | 形态不同（本仓是分支树）；成本高 |
| 原生回收站 / `shell.openPath` / Guest 浏览器输入拦截 | Web 无对应能力 |
| MCP 凭据宿主 secret store | pi 已管 `mcp.json` |

---

## 3. PR 拆分

> 约定：每个 PR = 一个意图、可独立 revert、自带 `.test.mjs`、新能力优先进新文件，上游文件只留接线并标 `fork:<slug>`。
> 落地时补 `docs/patches/NNNN-<name>.md`（从 0062 起编号）。

### 阶段 A — 会话与流可靠性（P0，先做）

#### A1 `fork:event-seq` — 事件流序号 + 断线续传 + 缺口对账
- **目标：** 每条事件带 `runId + seq`；SSE 写 `id:` 行；重连用 `Last-Event-ID`（或 `?afterSeq=`) 续传；前端按 `runId:seq` 去重、检出缺口即拉快照。
- **为什么：** 本仓断线只能整快照重发，丢事件不可发现（多标签页/半开连接下是真问题）。
- **改动面：** `lib/agent-event-stream.ts`（写 `id:`/接 `afterSeq`）、`lib/agent-event-connection.ts`（记游标）、`hooks/useAgentSession.ts`（去重 + 缺口触发 `reconcileAgentState`）、新 `lib/event-sequence.ts`（纯函数 + 测试）。
- **DoD：** 单测覆盖「乱序/重复/缺口/续传边界」；浏览器实测断网重连后消息不重不漏；`tsc` / `lint` / `npm test` 绿。
- **风险：** 与现有 `isEventIncludedInSnapshot()` 去重叠加，需明确「快照优先还是 seq 优先」；先写清规则再改。

#### A2 `fork:submit-idempotency` — 提交幂等键
- **目标：** `POST /api/agent/[id]` 接受 `requestId + fingerprint`；同 requestId 命中且指纹一致→返回既有 run，不一致→409；客户端重试/多标签页复用同一 requestId。
- **为什么：** 现在只有客户端软防重，跨标签页或网络重试会重复 prompt。
- **改动面：** 新 `lib/submit-idempotency.ts`（内存 + 可选落 pi custom entry）、`app/api/agent/[id]/route.ts`、`lib/agent-client.ts`、`hooks/useAgentSession.ts`。
- **DoD：** 单测覆盖「同 requestId 重复提交只建一次」「指纹冲突 409」「进程内去重窗口」；浏览器双击/断网重发实测。
- **依赖：** 无。

#### A3 `fork:stop-queue-guard` — 停止语义：取消去重 + 队列保护 + 显式继续
- **目标：** ① 同一 run 的重复 cancel 合并；② 停止期间暂停 dispatch/steer/followUp，`await` 后二次检查；③ 停止**不自动继续**，需显式「继续队列」；④ 取消失败释放保护并恢复展示；⑤ 旧 run 的 cancel 不影响新 run。
- **为什么：** spec-008 记录的真实事故（用户停止后发的新消息被意外自动执行；取消失败锁死队列；连点）。
- **改动面：** `lib/rpc-manager.ts`（`case "abort"` 前后加闸门）、新 `lib/stop-guard.ts`（去重 Map + 闸门纯逻辑）、`lib/queue-surgery.ts`（复用）、`hooks/useAgentSession.ts`（乐观展示 + 恢复）、`ChatWindow.tsx`（继续队列入口）。
- **DoD：** 单测覆盖 spec-008 全部用例（去重/暂停/二次检查/失败释放/旧 run 不影响新 run/不自动继续）；浏览器实测「停止→立即发消息→确认不自动跑→点继续才跑」。
- **依赖：** 与 A1 无强耦合；建议在 A1 之后（都动事件路径）。

### 阶段 B — 上下文引用（P1，产品差异最大）

#### B1 `fork:session-reference-tools` — 让 `&session:` 真的可读（含本轮授权）
- **目标：** 新增模型可见工具 `session_search` / `session_read`（读当前会话 cwd 下的历史 `.jsonl`，分页 + 有界片段）；**只允许读当前 user 消息里显式引用的会话 id**，服务端按 messageId 重解析、拒已删会话；附件读取仍走正常文件权限。
- **为什么：** 现在 `serializeComposerMessage()` 承诺「请检索或阅读该会话」，但**没有工具**（`lib/session-search.ts` 只服务 UI）。这是空头支票。
- **改动面：** 新 `lib/session-reference-extension.ts`（注册工具）、`lib/session-search.ts`（复用检索核心）、`lib/rpc-manager.ts`（注册）、`lib/composer-context.ts`（投影加「不可信资料、非授权」说明）、`app/api/sessions/search/route.ts` 不动。
- **DoD：** 单测覆盖「未引用会话→拒绝」「已删会话→拒绝」「分页/片段上限」「引用出现在非当前消息→拒绝」；运行时实测（起独立端口，`get_tools` 看到工具并真读一次引用会话）。
- **风险：** 工具会读 `~/.pi/agent/sessions`，**不在 allowed roots**，必须走「当前会话 + 显式引用」这一条窄授权，不得放宽全局 roots。

#### B2 `fork:resource-quotes` — 结构化引用快照 + 不可信标注 + 伪造标记转义
- **目标：** 把 `SelectionContext` 从「发送时拍平成正文」升级为**消息级结构化元数据**（保留来源/位置/快照）；模型投影统一加「冻结片段、非指令、非访问授权」；转义用户伪造的 `@path` / `[SESSION:id]` 字面量；补条数/总长限额（拒绝优于截断）。
- **为什么：** 拍平后丢失来源身份与位置，无法定位、无法去重、无安全标注；XTLaw 的 `resourceQuotes` 是这一层。
- **改动面：** `lib/composer-context.ts`（拆出结构化投影）、新 `lib/resource-quotes.ts`（schema + 去重 + 限额 + 转义）、`hooks/useAgentSession.ts`（随消息存元数据）、`MessageView.tsx`（历史展开引用）。
- **DoD：** 单测覆盖 schema/去重/限额/转义/旧消息兼容；浏览器实测发送后历史仍可展开、模型投影含标注。
- **依赖：** 建议在 B1 之前或同时（都动 composer→消息的投影）。

#### B3 `fork:turn-segments` — 回合片段切分与工具节点修正
- **目标：** ① 运行中插入的 user 消息把一轮拆成多段（interleaved run）时不串段；② 重复 `toolCallId` 保留前一节点、新节点给新展示 id；③ 审批结果按 approval id 匹配，不被旧结果命中新执行。
- **为什么：** XTLaw 首轮集成暴露的真实 bug（round-1 §3）；本仓 `ProcessGroup` / `normalizeToolCalls` 是否有等价防护未确认。
- **改动面：** `components/ProcessGroup.tsx`、`components/MessageView.tsx`、`hooks/useAgentSession.ts`、新 `lib/turn-segments.ts`（纯函数 + 测试）。
- **DoD：** 单测覆盖重复 toolCallId、审批 id 匹配、interleaved 分段；浏览器实测运行中插话。

### 阶段 C — 权限与安全（P1）

#### C1 `fork:permission-narrowing` — 单向收窄 + 特例集中
- **目标：** 引入「会话权限上限 → 单次请求可收窄」的 `isWithin(profile, limit)`，在**写状态前**与**执行前**各验一次；把散落的特例（删目录/`.git`→ask、多目录授权→拒、敏感路径读→ask）集中到一处。
- **为什么：** 本仓 `plan` 档靠两处规则手工保持一致（`approvalModeForPlanAwareMode` 注释自陈）；没有「单次收窄」概念。
- **改动面：** 新 `lib/permission-narrowing.ts`（纯函数）、`lib/approval-policy.ts`（特例集中）、`lib/plan-mode.ts`（接入收窄）、`lib/rpc-manager.ts`（执行前复验）。
- **DoD：** 单测覆盖各档位判定表与收窄矩阵；确保既有 12 条 `DANGEROUS_RULES` 行为不回退。

#### C2 `fork:approval-scopes` — 审批作用域 + 服务端脱敏 + 判别联合
- **目标：** 在现有 `allow-session` 之上补 `operation`（同一操作）/`source`（同一来源）粒度；审批 payload 按类型判别联合（命令/路径/网络/…），构造时脱敏（现在只有 `SECRET_KEY` + 截断）。
- **为什么：** XTLaw 的 `reuseScopes` + `createApprovalAuthorizationKeys` 能减少重复弹卡，同时脱敏发生在服务端而非渲染时。
- **改动面：** `lib/approval-policy.ts`、`lib/approval-extension.ts`、新 `lib/approval-scopes.ts`、`ChatWindow.tsx`（卡片按类型渲染）。
- **DoD：** 单测覆盖作用域匹配与不越级复用、脱敏覆盖；浏览器实测三类卡片。

#### C3 `fork:approval-recovery` — 未决审批收敛（超时 + 重启清理）
- **目标：** 未决审批有明确状态（侧栏已有一半）、超时（如 30 分钟）取消对应 run、进程重启后把遗留 pending 置 cancelled；活动态从状态派生而非内存。
- **为什么：** 现在 `pendingUiRequests` 只在 SSE 重连时重放，服务重启会丢 waiter 且不收敛。
- **改动面：** `lib/rpc-manager.ts`、`app/api/agent/running/route.ts`、`hooks/useAgentSession.ts`。
- **DoD：** 单测覆盖超时/重启收敛；浏览器实测杀掉进程重启后不再「永久等待」。

### 阶段 D — 工作台与文件（P2，按需）

#### D1 `fork:file-mutation-guard` — 文件写操作围栏 + result-unknown
- **目标：** 重命名/删除/压缩前拿目录级 fence；结果不确定（超时/连接断）时**保留保护、置只读、绝不盲目重试**；回收站失败**绝不降级永久删除**。
- **为什么：** XTLaw 的 `WorkspaceFileMutationGuard` + `result-unknown` 是防「检查后到执行前状态变了」和「误报回滚」的。
- **改动面：** `app/api/files/[...path]/route.ts`、新 `lib/file-mutation-guard.ts`、`components/FileExplorer.tsx`。
- **DoD：** 单测覆盖并发重命名/目标已存在/超时；浏览器实测。

#### D2 `fork:layout-layers` — 面板布局三层分离 + 世代号
- **目标：** 明确「临时拖放 / 会话内存 / 落盘偏好」三层互不覆盖；用世代号防止旧 IPC 请求覆盖新偏好。
- **为什么：** XTLaw spec-013 §13.6 记录「首次发送 draft→task 时旧收起请求覆盖新展开偏好」的真实事故。
- **改动面：** `lib/right-panel-split.ts`、`lib/right-panel-split-memory.ts`、`components/AppShell.tsx`。
- **DoD：** 单测覆盖「临时状态不落盘」「旧请求不覆盖新偏好」。

#### D3 `fork:session-switch-loading` — 会话切换加载态（小）
- **目标：** 切换会话时显示统一加载指示（复用 `session-view-cache` 命中则秒显、未命中显示 loading/失败重试）。
- **改动面：** `components/AppShell.tsx`、`components/ChatWindow.tsx`。
- **DoD：** 浏览器实测慢会话切换不再「像没生效」。

#### D4 `fork:project-row-status` — 项目折叠行状态聚合（小）
- **目标：** 折叠的项目/分组行显示子任务聚合状态：**待授权优先于运行中**，不显示数量，不占宽度（绝对定位），尊重减少动画。
- **为什么：** XTLaw spec-029 已验收的小 UX；本仓侧栏已有 running 轮询与 `awaitingSessionIds/Kinds`，差聚合。
- **改动面：** `components/SessionSidebar.tsx`、新 `lib/project-row-activity.ts`（纯函数 + 测试）。
- **DoD：** 单测覆盖「授权优先/运行中/都无」；浏览器截图。

#### D5 `fork:cn-slash-trigger` — 中文顿号 `、` 触发斜杠命令（小）
- **目标：** `、` 与 `/` 同源识别命令触发（要求触发符前为行首或空白，避免正文中间误触发）。
- **改动面：** `components/ChatInput.tsx`、`lib/composer-references.ts` 或 `mention-trigger-guard.ts`、新纯函数测试。
- **DoD：** 单测覆盖边界（`1、2` 不触发）；浏览器实测中文输入法下可触发。

### 阶段 E — 登记不做（文档）

#### E1 `docs(xtlaw): DIVERGENCE 登记`
- 把 §2 的「不抄」清单 + §1.9 的插件沙箱判断写进 `design/v5/DIVERGENCE.md` 或 `docs/patches/README.md`，附 XTLaw 侧证据路径，避免下次重复评估。

---

## 4. 建议顺序与依赖

```
A2 ──┐
     ├─→ A1 ─→ A3
     └────────┘
B2 ─→ B1 ─→ B3
C1 ─→ C2 ─→ C3
D1 … D5（互相独立，可穿插；D2 依赖 AppShell，建议单独）
E1 最后
```

**先做：** A2（最小、收益明确）→ A1 → A3 → B2 → B1。
**可穿插的小 PR：** D3 / D4 / D5（各半天级，适合做批次之间的过渡）。
**需要先核实再动手：** D1（本仓是否已有 fence）、D2（三层是否已分）、B3（本仓是否已有重复 toolCallId 防护）。

---

## 5. 总验收

- 每个 PR：`npx tsc --noEmit` → `npm run lint` → `npm test` 全绿，补 `docs/patches/NNNN-*.md`。
- 动到 UI：跑 `npm run check:design`；动到画板几何：跑 `npm run verify:boards`（或 `:seeded`）。
- 新增模型可见工具（B1）：**必须做运行时验证**（起独立端口，`POST {"type":"get_tools"}` 确认真在工具表里，并按 AGENTS.md「一方扩展的注册 ≠ 模型看得见」一节留证）。
- 涉及安全边界（B1 / C1 / C2 / D1）：单测必须包含「拒绝路径」，且不得放宽 `isPathWithinRoots()` 这一唯一实现。

---

## 6. 参考证据索引（XTLaw 侧）

| 主题 | 路径 |
| --- | --- |
| 提交幂等 / 回合 | `apps/buddy/service/src/storage/turnRequestRepository.ts`、`service/src/chat/ChatTurnService.ts` |
| 事件恢复 | `service/src/events/RunEventRecovery.ts`、`RunEventLog.ts`、`RunEventStore.ts`；`docs/specs/feature-018-*.md` |
| 停止 | `service/src/chat/ChatQueueService.ts`；`docs/specs/feature-008-*.md`；`docs/upstream-round-1-integration.md` |
| 会话切换 | `apps/buddy/src/app/workbench/TaskWorkspacePool.ts`；`docs/specs/feature-009-*.md` |
| 权限 | `shared/permissions/*`、`service/src/permissions/decisionTable.ts`、`PermissionEngine.ts`；`docs/specs/feature-005-*.md` |
| 审批 | `service/src/approvals/*`、`shared/permissions/approvalApi.ts` |
| 引用 | `docs/specs/feature-013-*.md`、`feature-003-*.md`；`src/shared/ui/selection/workbenchSelectionReferences.ts` |
| 文件操作 | `docs/specs/feature-019-*.md`；`apps/buddy/platform/extensions/...` |
| 布局 | `docs/specs/feature-014-*.md`、`feature-010-*.md`、`feature-002-*.md` |
| 插件/技能/MCP | `docs/specs/feature-012/016/028-*.md`；`platform/extensions/ExtensionService.ts` |
| 事故记录 | `docs/upstream-round-1-integration.md`、`docs/upstream-remaining-integration.md`、`docs/bugs/*.md` |
