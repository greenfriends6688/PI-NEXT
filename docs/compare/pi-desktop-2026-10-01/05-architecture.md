# 05 · 架构 / 技术栈 / 可移植性

分析日期：2026-10-01
基准：本仓库 `pi-codex`（Next.js 16 + 进程内 pi SDK 0.87.0 + React SPA + 643 行 Electron 壳 + PWA）
对象：`pi参考项目/PI-Desktop-main`（PI-Desktop **0.16.0-beta.1**，Electron main + React renderer + Rust `host-core` + Node `agent-runtime` sidecar + 每插件一进程）

本文只回答一个问题：**他们那些能力是靠什么结构成立的，我们这套结构能不能平移，平移要付什么代价。**
功能层面的对比交给其他 agent；本文的落点是「因为架构不同而做不了 / 要重做」的东西。

---

## 0. 先做的事：`PD-01…PD-22` 复核（grep 实证，不信文档）

上一轮（`docs/pi-desktop-borrowing-plan-2026-09-24.md`）的 22 项落地情况：

| ID | 状态 | 证据（我们侧） |
| --- | --- | --- |
| PD-01 三态常驻 | ✅ | `components/FileViewer.tsx` 中 `mountedStages` 仍存在（5 处命中） |
| PD-02 diff memo | ✅ | `components/FileViewer.tsx:430-431` `useMemo(() => diffLines(patch), [patch])` |
| PD-03 git diff 懒取 | ⚠️ **部分** | `components/FileViewer.tsx:1903` 仍有 `void fetchGitDiff(filePath)`（打开文件即取） |
| PD-04 超长文件行窗口化 | ❌ | `components/FileViewer.tsx` 内无 windowing/virtualize 命中 |
| PD-05 掐掉 AppShell 全树重渲 | ❌ | `components/AppShell.tsx:780` 仍在热路径 `setFileTabs((prev) => saveFileViewerState(...))` |
| PD-06 `useIsCompact` | ✅ | `hooks/useIsMobile.ts:67` |
| PD-07 平板溢出裁剪 | ✅ | `app/fork-ui.css:765` `.chat-input-shell` |
| PD-08 平板侧栏抽屉 | ✅ | `components/AppShell.tsx:362` fork 注释 |
| PD-09 移动顶栏标题 | ✅ | `components/AppShell.tsx` `renderSessionTitle` 4 处 |
| PD-10 composer 高度 | ⛔ 判定不做 | 文档 §8 PD-10（112 CSS px，非 224） |
| PD-11 项目级归档标志 | ✅ | `lib/project-flags.ts:24` `STORAGE_KEY = "pi-project-flags"` |
| PD-12 项目索引页 | ✅ | `components/ProjectArchivePanel.tsx` |
| PD-13 侧栏归档入口 | ✅ | `components/SessionSidebar.tsx` 3 处 `archiveProject/setProjectArchived` |
| PD-14 导入后恢复归档 | ✅ | `components/ImportPanel.tsx:214` `if (projectFlags.archived.includes(key)) restoreProject(key)` |
| PD-15 扫描层 | ✅ | `lib/import/{sessions,models,skills,mcp,index}.ts` + `app/api/import/scan/route.ts` |
| PD-16 落盘层 | ✅ | `lib/import/apply.ts` + `app/api/import/apply/route.ts` |
| PD-17 导入设置页 | ✅ | `components/ImportPanel.tsx` |
| PD-18 预设 chips | ✅ | `components/ModelsConfig.tsx` 3 处 `LimitChips` |
| PD-19 覆盖来源标记 | ✅ | `components/ModelsConfig.tsx` 13 处 `catalogState` |
| PD-20 → `samplingParams` | ✅（换题） | `components/ModelsConfig.tsx` 6 处 `samplingParams` |
| PD-21 保存前校验 | ✅ | `components/ModelsConfig.tsx:1011` `aria-invalid` |
| PD-22 两态化 | ✅ | `lib/file-viewer-state.ts:6` `type FileViewerDisplayMode = "source" \| "preview"` |

**结论**：22 项里 18 项已落地、1 项部分、2 项未做（PD-04/05 属性能收尾，已由上一轮记录，本文不重复）。
**PD-15 顺手做出来的东西，正好是本文第 1 节的判据来源**——`lib/import/` 的五处上限常量就是「我们只有单进程」的既有实践。 `[已验证]`

---

## 1. 进程 / 运行时模型

### 1.1 拓扑对照

他们（`docs/spec/03-runtime/07-process-model.md:5-11`）：

```text
PI-Desktop.app
├── Electron Main        ← 窗口、IPC 扇入扇出、子进程监管、更新
├── Renderer (React UI)  ← 只画 UI
├── Rust host-core       ← DB / 工具 / 权限 / plan_approvals / 插件宿主服务 / secrets
└── Node pi sidecar      ← agent loop、provider 流式、工具调用规划
```

我们（`electron/main.js:132`）：

```text
PI NEXT (Electron)
├── Electron Main        ← 566 行，只做：拉端口、spawn next、托盘、keep-awake、开外链
└── next start (子进程)  ← 47,512 行 components + 42,311 行 lib + 6,916 行 app/api
    ├── 进程内 pi AgentSession × N   （lib/rpc-manager.ts:1923 globalThis.__piSessions）
    ├── 进程内 node-pty 终端 × N      （lib/terminal-manager.ts:29 globalThis.__piWebTerminals）
    ├── 进程内文件索引 / 用量索引 / 会话索引缓存
    └── 全部 app/api/** Route Handler
```

规模差（排除测试文件，实测 `wc -l`）：

| 层 | 他们 | 我们 |
| --- | --- | --- |
| Electron main + preload | **59,999 行** | **643 行** |
| renderer | 83,299 行 | 47,512 行（`components/`） |
| Rust | 64,727 行 | 0 |
| workspace packages | 88,604 行 | 0（只有 42,311 行 `lib/`） |
| 合计 | **≈ 296k** | **≈ 97k** |

**他们的能力密度是「main + Rust 占了 42%」堆出来的；我们 99% 的逻辑在「一个 Node 进程」里。** `[已验证]`

**这不是优劣，是分工不同**：他们把「重活 / 长活 / 需要原生能力」放进 main 与 Rust，把 renderer 削成纯 UI（`07-process-model.md:16-22` 的 ownership 表写得很死：Renderer = "UI only"）。我们没有 main 这一层，于是所有活自动落到 Next 进程——**这才是「进程模型不能抄」的真实含义：不是我们抄不了多进程，是我们没有第二个进程。** `[已验证]`

### 1.2 host ↔ renderer 通信协议（三层，不是 HTTP）

| 层 | 协议 | 证据 |
| --- | --- | --- |
| renderer ↔ main | Electron IPC，频道名 `pi-desktop/<domain>/<action>`，走 preload allowlist | `docs/spec/03-runtime/01-ipc-protocol.md:36-40`、`apps/desktop/electron/preload/index.ts` |
| main ↔ Rust host-core | **stdio NDJSON JSON-RPC**（不是 HTTP，不是 WebSocket） | `packages/host-runtime/src/host-process.ts:1-11`（`readNdjsonLines`、`MAX_HOST_STDIN_LINE_BYTES`）、`:60-80` `class HostProcess` |
| main ↔ Node sidecar | 同上，`AgentSidecar` 复用同一套 stdio 传输 | `apps/desktop/electron/main/agent-sidecar.ts:56-78` |
| 远程（可选） | RACP over loopback WebSocket | `packages/racp/src/ws-binding.ts:54-58`、`packages/shared/src/racp.ts:526-575` |

NDJSON 的具体约束（这些数字是「为什么它比 HTTP 好做」的全部理由）：每条请求 64 MiB 上限（`07-process-model.md:170`）、默认 RPC 超时 130s（`packages/shared/src/rpc-timeouts.ts`）、重启退避 `0.5s→1s→2s`（上限 4s）、2 分钟内最多 3 次（`07-process-model.md:173-175`）。

我们这边是 **HTTP + SSE**：`app/api/agent/[id]/events/route.ts:8-38`（`text/event-stream` + `X-Accel-Buffering: no`），命令走 `POST /api/agent/[id]`（`lib/agent-client.ts:26-32`）。

**结论：协议层不可平移也不必平移。** NDJSON 的价值是「流式双向、无序列化层、能承载任意 payload」，我们的 HTTP+SSE 已经覆盖了 `agent-host` 需要的语义（`packages/agent-host/src/agent-host.ts` 的职责是 turn admission / turn queue / approval broker / event log——这四件事**我们在 `lib/rpc-manager.ts` 里已经全部在做了**，只是它们是进程内对象不是可远程的服务）。 `[已验证]`

### 1.3 哪些能力是靠「多进程」才成立的 —— 逐条判定

| 能力 | 他们靠什么 | 我们能不能做 | 上限 / 代价 |
| --- | --- | --- | --- |
| **工作区文件索引（`@` 菜单）** | main 进程跑 `git ls-files -co --exclude-standard -z`，失败降级为有界 walk，**8000 条上限 / 15s 缓存 / git 4s 超时 / 32 MiB buffer 上限**（`apps/desktop/electron/main/fs-index.ts:17-21,36-64`） | ✅ 已经做了，形态几乎一样 | 我们 `app/api/file-index/route.ts:27-33`：`MAX_FILES 5000` / `GIT_HARD_CAP 200_000` / `CACHE_TTL 10s`，但 **git 超时 10s + `maxBuffer 64 MiB`**（`:67`）比他们宽 2.5× / 2×。**单进程下这是唯一会「把整站卡住」的路径**——`execFileAsync` 不阻塞 event loop，但会占住一个子进程 + 64 MiB 缓冲，且缓存 Map 与会话运行时同进程。建议：把 git 超时降到 4s、buffer 降到 32 MiB，与他们对齐 |
| **keep-awake** | `powerSaveBlocker`（`apps/desktop/electron/main/keep-awake.ts:9-12`） | ✅ 已有，但**只在 Electron 壳里**（`electron/main.js:330-338`，`preload.js:23`） | 浏览器 / PWA 下不存在，我们没有 Chromium 之外的等价物（macOS `caffeinate` 未接）。这是**平台能力缺失，不是架构缺失**——不值得为它改架构 |
| **语音采集** | `audio-backend.ts` 用 `@picovoice/pvrecorder-node` 在 main 采 PCM；`packages/voice-runtime` 里还有 `transcribe-cpp` 本地转写 + `model-downloader.ts` 拉模型；live-voice 有 31 个模块（`apps/desktop/electron/main/live-voice/`） | ⚠️ 理论上 `getUserMedia` 能在浏览器做 | 但他们的一半价值（原生 mic 权限枚举 `systemPreferences.getMediaAccessStatus`、本地 Whisper 模型、与 agent 轮次桥接）在 Web 上做不了。**结论：不做，除非先决定要语音** |
| **大 diff 渲染** | **Rust 在工具执行那一刻就把 diff 算好并落盘**：`review.rs:1-4`「Review evidence is captured at tool execution time instead of being reconstructed from a mutable git working tree」，`MAX_DIFF_LINES 4000 / MAX_DIFF_CELLS 2_000_000 / MAX_SNAPSHOT_BYTES 16 MiB`（`review.rs:19-23`）；渲染端 `ReviewChangeCard.tsx` 只有 167 行，纯函数解析 | ⚠️ **半平移** | 我们没有「工具执行时快照」这个钩子（pi 的 write/edit 结果里没有 before 字节），所以只能像现在一样对 HEAD 现算 diff（`lib/git-changes.ts`）。**能平移的是渲染侧的「硬上限」**：4000 行 / 2M 单元格是我们可以直接抄的数字，不需要他们的 Rust。快照本身要等 pi 的 tool result 支持 |
| **嵌入式预览浏览器** | 单个 `WebContentsView`，渲染端量边界、main 定位、文件目录 watch 触发 live reload（`apps/desktop/electron/main/browser-view.ts:7-19`） | ❌ | Web 上唯一等价物是 `<iframe>`，但拿不到「用户主动浏览 vs agent 写文件」的权限边界。他们的理由是 ADR 0019：user-driven browsing 不应绕开 agent 工具与权限弹窗。我们没有权限弹窗这层，所以 iframe 不是「降级版」，是**没有产品语义** |
| **插件视图** | 每插件一个 `WebContentsView`，按插件持久化 partition，`MAX_LIVE_VIEWS = 4` 保活上限（`apps/desktop/electron/main/plugin-view-host.ts:34-52`） | ❌ | 见 §4 |

**共性结论：上表里 5 个「能平移」的都不需要多进程；4 个「不能平移」的全部是 Electron 原生能力（`WebContentsView` / `powerSaveBlocker` / `systemPreferences` mic / `utilityProcess`），不是 Rust。**换句话说——**「进程模型不能抄」的真实代价，比想象中小得多：主要是插件面板与嵌入式浏览器这两个 UI 形态；文件索引、keep-alive、diff 上限、语音采集里的「转写」部分都不依赖多进程。** `[已验证]`

**真正因为「单进程」而受限的，只有一条，但很硬**：任何长活/重活都在 Web 服务里。上一轮 `lib/import/` 的五处上限就是这条纪律的产物（`lib/import/types.ts` 的 `readJsonFileCapped` 等）。**这一条不需要新做，需要的是把既有上限写进一条 CI 门禁**（见 §7）。

---

## 2. 数据层：他们的 schema 概念 vs 我们的替代方案

### 2.1 他们的 schema 概念（`crates/host-core/src/db/schema.rs`）

`SCHEMA_VERSION = 21`（`crates/host-core/src/db.rs:10`），21 个表/虚拟表。核心概念：

| 概念 | 表 | 行号 | 它解决什么 |
| --- | --- | --- | --- |
| `kv` | `kv(ns, key, value_json, updated_at)` `WITHOUT ROWID` | `schema.rs:31-38` | 名字空间化配置：ns ∈ `app` / `ui` / `cache` / `plugin:<id>` / `projectMemory`（`docs/spec/03-runtime/04-data-storage.md:255-294`） |
| `projects` | `id, path UNIQUE, name, pinned, last_opened_at` | `schema.rs:39-51` | 项目实体（路径去重 + 置顶） |
| `providers` / `models` | 两张表 | `schema.rs:53-83` | 供应商/模型目录缓存 |
| `sessions` | 18 列，含 `last_seq` / `todo_revision` / `deleted_at` / `pinned` | `schema.rs:85-118` | 会话索引 + 软删 |
| `turns` | 一轮一行 + 部分唯一索引「一个会话只能有一个 running turn」 | `schema.rs:141-158` | 轮次与用量 |
| `turn_queue` | 排队 + `idempotency_key` 唯一索引 | `schema.rs:160-184` | Host 拥有的发送队列（**durable**） |
| `messages` | `(session_id, seq)` 唯一 | `schema.rs:180-192` | 消息索引（正文在 `sessions/*.jsonl`） |
| `messages_fts` | **FTS5 虚拟表 + 3 个触发器，trigram 分词** | `schema.rs:194-210` | 全文检索 |
| `session_todo` | 位置/内容/状态/优先级 + 「一个会话只能有一个 in_progress」部分唯一索引 | `schema.rs:5-23` | v21 新增 |
| `plan_approvals` | 22 列 + 4 个索引，含 `execution_state` 队列 | `schema.rs:213-256` | Plan/Goal 审批 + 执行队列 |
| 其余 | `notifications` / `artifacts` / `message_revisions` / `scheduled_tasks` / `task_runs` / `secrets_meta` / `audit_log` / `session_import_origins` | `schema.rs:120-212` | |

文件布局在 `~/.pi-desktop/`（`04-data-storage.md:48-92`）：`pi.sqlite`（WAL）+ `sessions/*.jsonl` + `secrets/` + `config-sync/` + `review-changes/` + `attachments/` + `scratch/` + `logs/` + `crash-dumps/`。

**注意他们的一个关键设计**：DB **不存大 payload**（`04-data-storage.md:86-89`：message 正文在 `sessions/`，附件与超限 tool 输出在磁盘上，按路径/哈希引用）。也就是说他们的 SQLite 本质是「**可重建的索引**」，不是真源。这对我们的替代方案是决定性的。

### 2.2 我们的替代方案（逐条，不说「难」）

**我们已经有三套「派生索引」设施，这才是他们 SQLite 的对应物：**

| 设施 | 位置 | 形态 | 对应他们的 |
| --- | --- | --- | --- |
| 会话索引 | `lib/session-list-scanner.ts:293` `join(getAgentDir(), "pi-web-session-index.json")`，按 `(size, mtimeMs)` 指纹失效（`:38-41`, `:85-95`），逐字段校验后加载（`:301-320`） | `~/.pi/agent/pi-web-session-index.json` | `sessions` 表 |
| 用量索引 | `lib/usage-stats.ts:27` `USAGE_CACHE_FILE_NAME = "pi-web-usage-cache.json"`，同样按 `(size, mtimeMs)` 复用解析结果 | `~/.pi/agent/pi-web-usage-cache.json` | `turns` 表的用量部分 |
| 列表内存缓存 | `lib/session-reader.ts:319` `SESSION_LIST_CACHE_TTL_MS = 30_000` | 进程内 | `kv:cache` |

**逐概念替代方案：**

| 他们的概念 | 我们的替代 | 具体落点 | 判定 |
| --- | --- | --- | --- |
| `projects` 表 | **派生视图**，不建表。项目 = 会话 `cwd` → `projectKey` 去重（`lib/types.ts:380-384` 服务端算的稳定身份）+ 外部来源合并（`lib/recent-projects.ts` 读 5 个产品的 `storage.json` / SQLite） | 已落地（`lib/project-groups.ts` / `lib/session-list-scanner.ts`） | ✅ 不需要新存储 |
| `sessions` 表 | 派生 + 索引文件（见上）。**增量字段用 localStorage**：`lib/session-flags.ts:20` `pi-session-flags`（归档/置顶）、`lib/project-flags.ts:24` `pi-project-flags` | 已有 | ✅ |
| `messages` 表 | 不需要。消息正文在 `.jsonl`，`lib/session-reader.ts`（905 行）按需流式读 | 已有 | ✅ |
| `messages_fts`（FTS5 全文检索） | **必须新建，但只能新建「索引文件」不能新建「数据库」**。可选落点：① 复用 `pi-web-session-index.json` 的模式加一个 `pi-web-fts.json`（分片 + 倒排，trigram 与他们一致）；② 或退一步：只在 `firstMessage` + header 上做前缀/子串过滤（今天的侧栏搜索能做到什么就做什么） | 新增 `lib/search-index.ts` + `app/api/search/route.ts` | ⚠️ **唯一真正的新存储需求**；价值取决于「会话多了以后搜索不够用」的实测 |
| `turns` 表 | **不建**。用量已由 `lib/usage-stats.ts` 从 `.jsonl` 聚合 + 缓存文件解决 | 已有 | ✅ |
| `turn_queue`（durable 队列） | **不建**。我们镜像 pi SDK 自己的两层队列（`lib/rpc-manager.ts:577-596` `_steeringMessages` / `_followUpMessages` / `PendingMessageQueue`），序列化由 `lib/queue-surgery.ts` 管 | 已有 | ✅ 真源是 SDK，抄表会双写 |
| `session_todo` 表（v21 新增） | **明确不抄**。`lib/todo-state.ts:1-10` 写清了理由：todo 状态存在 tool result 的 `details` 里，**分支时随对话一起回卷**——这正是表做不到而 `.jsonl` 能做到的。他们搬到表里换来的是跨会话查询，我们不需要 | 已定 | ⛔ 不建议 |
| `kv:app` | `~/.pi/agent/settings.json`（pi 的 `SettingsManager`，我们在 `app/api/plugins/route.ts:228,347` 已经在用） | 已有 | ✅ |
| `kv:ui` / `kv:projectMemory` / `kv:plugin:<id>` | 前端偏好 → localStorage（**他们自己也这么做**：侧栏组织偏好存 renderer localStorage `pi.desktop.sidebarPreferences`，见 `04-data-storage.md:295-340`）。项目记忆 → 我们的 `lib/workspace-memory.ts` / `/api/memory` | 已有 | ✅ |
| `secrets_meta` | pi 的 `auth.json`（SDK 拥有） | 已有 | ✅ |
| `notifications`（durable inbox） | 我们的 `web-push` + `lib/browser-notifications.ts`（浏览器通知） | 已有，形态不同 | ✅ |
| `scheduled_tasks` / `task_runs` | **我们完全没有**。这是真缺口：定时任务必须落盘（进程会重启），而我们的 `.jsonl` 只属于会话。可行落点：`~/.pi/agent/pi-web-schedules.json`（沿用两个缓存文件的形态），或做成 pi package（`DefaultPackageManager` 那一套） | 新增 | ⚠️ 若做，必须是**独立 JSON 文件**，不是第二套库 |

**一句话**：他们 21 张表里，**我们能用派生视图替代 15 张、明确不抄 3 张（turn_queue / session_todo / projects）、真需要新建存储的只有 1 张（全文检索索引）**、**真需要新建文件形态的只有 2 个（定时任务、计划任务）**。数据层是我们跟得最平的一层。 `[已验证]`

---

## 3. pi SDK 的使用方式【重点】

### 3.1 他们 fork 了 pi —— 三个 `patchedDependencies`

`pnpm-workspace.yaml:53-56`：

```yaml
patchedDependencies:
  '@earendil-works/pi-agent-core@0.99.1': patches/@earendil-works__pi-agent-core@0.99.1.patch
  '@earendil-works/pi-ai@0.99.1': patches/@earendil-works__pi-ai@0.99.1.patch
  '@earendil-works/pi-coding-agent@0.99.1': patches/@earendil-works__pi-coding-agent@0.99.1.patch
```

三张补丁共改 **38 个 dist 文件**。按能力归类：

| 补丁 | 加了什么 | 关键证据 |
| --- | --- | --- |
| `pi-ai`（22 文件，1615 行） | ① **hosted search**：新增 `dist/utils/hosted-search.js`（`HostedSearchContent` / `hostedSearchCitations` / `hostedSearchReplayProjection` / `validateHostedSearchMessages`），并接进 anthropic-messages / openai-responses / openai-codex-responses / azure / mistral / openai-completions 六个 adapter（`+type: "hostedSearch"`、`stream.push({type:"hosted_search_update"})`）<br>② **LocalRequestError**：`dist/utils/local-request-error.js` + `local-request-stream.js`，把「请求在到达 provider 之前就失败」（鉴权、参数校验、网络）与「provider 报错」区分开<br>③ **按 model 的 token 估算**：`estimateMessageTokens(message, model?)`、`estimateContextTokens(context, model?)`（`+export declare function estimateMessageTokens(message: Message, model?: Model<Api>): number`）<br>④ OAuth / codex token-retry backoff | `patches/@earendil-works__pi-ai@0.99.1.patch` 第 6、918-932、943-960、1201-1389 行 |
| `pi-agent-core`（9 文件，392 行） | ① `agent-loop.js` 转发 `hosted_search_update` 事件（`case "hosted_search_update":`），让 UI 逐轮渲染搜索而不是等最终消息<br>② `agent.js` 用 `localRequestErrorDetails(error)` 产出结构化 `errorDetails`<br>③ compaction 全部改走「带 model 的估算」，`pico3/kinds/frames.js` 认识 `hosted_search_update`<br>④ `utils.js` 把 hosted search replay buffer 显式化 | `patches/@earendil-works__pi-agent-core@0.99.1.patch:9-20, 21-47, 269-285` |
| `pi-coding-agent`（7 文件，469 行） | ① `agent-session.js` 的 `estimateMessagesTokens(messages, model)` 全链路透传 model<br>② `compaction/*` 同上<br>③ `core/bug-report.js` | `patches/@earendil-works__pi-coding-agent@0.99.1.patch:5-20` |

**pi 版本也不同**：他们用 **0.99.1**（`apps/desktop/package.json:39-40`），我们用 **0.87.0**（`package.json` dependencies）。

### 3.2 我们能不能用官方 SDK 的公开能力达成同等效果

逐条判定（这一节是本文最重要的结论之一）：

| 他们的能力 | 是否依赖补丁 | 我们的官方 SDK（0.87.0）现状 | 判定 |
| --- | --- | --- | --- |
| **原生联网搜索（provider 侧 web search）** | ✅ **完全依赖补丁**。整个 `hostedSearch` 内容类型、六个 adapter 的解析、事件流都是 patch 出来的，上游 0.87.0 完全没有 | `grep -rl "hostedSearch\|web_search" node_modules/@earendil-works/pi-ai/dist/` → **零命中** | ❌ **不可平移**。上游没有这个概念，我们不能通过配置打开。上一轮把 PD-20 判成「换 `samplingParams`」是对的，但**理由要更新**：不是「我们的 SDK 缺这个键」，是「整个特性是我们 SDK 版本里不存在的」 |
| **按 model 的 token 估算** | ✅ 依赖补丁（`estimate*(message, model)`） | `node_modules/@earendil-works/pi-ai/dist/utils/estimate.d.ts:15-16`：`estimateMessageTokens(message: Message): number` / `estimateContextTokens(context)` —— **无 model 参数** | ⚠️ **半平移**。无 model 意味着估算不知道「hosted search 投影到目标模型后有多大」。但**在 0.87.0 上这件事没有意义**（没有 hosted search）。等 pi 上游把这几张补丁合进去，我们升级即可——**不要自己 backport 补丁**，那会让 `npm install` 变成不可复现 |
| **LocalRequestError（请求未发出 vs provider 报错）** | ✅ 依赖补丁 | 上游无 | ⚠️ **可用公开能力近似**：我们已有 `lib/rpc-manager.ts` 的错误路径（`errorMessage` + `code`）。若要做，正确做法是**在 Route Handler 层加一层错误分类**（`lib/api-types.ts` 的 `{error, code}` 已经是这个形状），而不是 patch SDK |
| **搜索轮次的实时渲染** | ✅ 依赖补丁的事件 | 无 | ❌ 随上一条一起不可平移 |

**他们不是「fork 了 pi 所以能做更多」，而是「他们的产品需要 provider 侧 web search，于是去改了 pi，改动量 ≈ 2500 行 dist diff」。** 这是典型的**不该抄**的方向：它把「一个产品的功能需求」写进了「共享 SDK 的发行版」，意味着他们每次升级 pi 都要重打一遍补丁（`pnpm-workspace.yaml:57-60` 甚至专门把 `resolutionMode: highest` 钉死来避免升级掉补丁版本）。 `[已验证]`

### 3.3 封装层：他们 8,476 行，我们 2,496 行

| | 他们 | 我们 |
| --- | --- | --- |
| 入口 | `packages/agent-runtime/src/runtime.ts` **8,476 行** + `native-pi-session.ts`（用 `createAgentSession`，`native-pi-session.ts:20-35`） | `lib/rpc-manager.ts` **2,496 行**（用 `createAgentSessionServices` / `createAgentSessionFromServices`，`lib/rpc-manager.ts:2,2336,2415`） |
| 额外能力 | subagents / todos / image generation / compaction 诊断 / delegation 历史 / path lock / tool budget / hosted search / 代理中继 | subagents（`lib/subagent-runtime.ts`）/ todos（`lib/todo-extension.ts`）/ 审批策略 / 工具预设 / 思考档 |
| 形态 | **独立进程**（`ELECTRON_RUN_AS_NODE=1` + `--max-old-space-size=2048`，`agent-sidecar.ts:66-72`） | 进程内，`AgentSessionWrapper` 包一层（`lib/rpc-manager.ts:1952,2471`） |
| 保活 | supervisor 监管 + 崩溃分类（`AGENT_SIDECAR_OOM` / `AGENT_SIDECAR_CRASHED`）+ 指数退避重启 | 会话空闲 10 分钟自动关（`lib/rpc-manager.ts:160-181`，`PI_WEB_IDLE_TIMEOUT_MS` 可调，`0` = 关闭） |

**这里有一个必须写进决策记录的架构事实**：他们把 sidecar 限制在 2 GiB 堆（`--max-old-space-size=2048`）并为 OOM 写了专门的错误码与 e2e（`scripts/e2e-supervision.mjs`、`e2e-agent-live.mjs`）；**我们的会话跑在 Next 的默认堆里，没有任何堆上限**。我们 66 个组件的 renderer 也在同一个进程——不是同一个堆（Node vs 浏览器），但**同一个 OS 进程的内存与 GC 压力**。这不是他们独有的问题，但**多会话 + 大 transcript + 大 diff 同时发生时，我们是唯一没有 OOM 隔离的那一个**。 `[已验证]`

---

## 4. 插件体系

### 4.1 两套插件的形状根本不同

| | 他们 | 我们 |
| --- | --- | --- |
| 安装单元 | `.piplug` 包（`crates/host-core/src/plugins/install.rs`）+ marketplace（`crates/host-core/src/plugins/marketplace/catalog.rs`，官方源 `https://plugins.aiuo.net/catalog.json`，见 `plugins/resolve.rs:267`） | pi package，走 `DefaultPackageManager`（`app/api/plugins/route.ts:5-11`），`settings.json` 的 `packages[]` |
| 清单 | `PluginManifestV1`：`id/name/version/main/ui/contributes/permissions/fs/net/entrypoints/activationEvents`（`docs/spec/07-plugins/02-plugin-manifest-schema.md:33-79`） | pi 的 `PackageSource`（string 或 `{source, extensions, skills, prompts, themes}`），`app/api/plugins/route.ts:41-52` |
| 能贡献什么 | `contributes`: commands / agentTools / skills / **agentExtensions** / providers / settings / themes / scenicThemes / windowAppearance / mcpServers / services / bus / **views** / sessionSources / globalShortcuts（同上 `:143-168`） | extensions / skills / prompts / themes（`app/api/plugins/route.ts:31-32` 的 `PluginResourceCounts`、`:102-122` 的 `PluginResourceKind`） |
| SDK | `packages/plugin-sdk/src/index.ts` **2,222 行** + `renderer.ts` 492 + `theme-css.ts` 346 + `fs-policy.ts` / `net-policy.ts` / `mcp-config.ts` | 无（我们直接吃 pi 的 ExtensionAPI） |
| 进程 | 每个插件一个 `utilityProcess`/child，协议 `{t:"init"|"call"|"cancel"|"res"|"event"|"log"}`（`apps/desktop/electron/main/plugin-host-process.mjs:11-20`） | 插件代码**在 Next 进程内**运行（pi extension 由 `createAgentSessionFromServices` 实例化，`lib/rpc-manager.ts:146` 注释） |
| 视图 | `ui.panel`（独立窗口）+ `contributes.views`（`WebContentsView` 内嵌，`manifest-schema.md:193-201`） | 无 |
| 市场 | 远端 catalog + 本地内置兜底 + 签名/更新（`docs/spec/07-plugins/07,08`） | 无（只有 `npx skills add` 装线上技能） |
| 开发 | `plugin-devkit`：`check.ts` 441 / `templates.ts` 547 / `pack.ts` 167 / `publish.ts` 168 | 无 |

### 4.2 判定

**他们的插件体系整体不可移植，但不是「因为架构不同」，是因为它是一个不同的产品概念。** 拆开看：

| 子能力 | 能不能移植 | 理由 |
| --- | --- | --- |
| **agentExtensions 贡献**（`contributes.agentExtensions`，`ExtensionAPI` 模块跑在 agent 侧车里） | ✅ **已经等价** | 这就是 pi 的 extension。我们的插件跑在 `lib/rpc-manager.ts` 里，同一个 ExtensionAPI。**这是两套体系唯一的重叠区，也是唯一「已经在做」的部分** |
| **agentTools / skills / themes** | ✅ 已经等价 | pi extension 本身就能注册工具；skills 与 themes 是 pi package 的一等资源（`app/api/plugins/route.ts:35-40`） |
| **per-plugin 进程隔离 + 权限网关** | ⚠️ 半平移，成本高 | 我们的插件与 Next 进程同生共死（插件崩 = 整站崩）。要隔离只有一条路：把 pi extension 的加载从「进程内 require」换成「子进程 + 协议」，等于自研一套 `plugin-host-process`。**但收益要具体化**：现在有哪个已知插件会崩主进程？没有 → **不建议** |
| **插件视图（`WebContentsView`）** | ❌ | 我们没有 `WebContentsView`。Web 上唯一等价物是 `<iframe sandbox>`，但拿不到：per-plugin 持久化 partition、`net.domains` 出网白名单（`plugin-view-host.ts:20-22` 的 `applyPluginEgressPolicy` / `pluginSessionPartition`）、原生拖文件（`preload/plugin-panel.ts:37-42` 的 `webUtils.getPathForFile`）、窗口控件与主题注入。**这是 Electron 能力缺口，不是设计选择** |
| **marketplace** | ⚠️ 值得单独评估 | 他们是 `.piplug` + 签名 + catalog（`docs/spec/07-plugins/07-plugin-marketplace.md`）。我们目前只有 `npx skills add`。**但 pi 上游有 `DefaultPackageManager`，我们等于已经在用「上游的插件分发」**。做第二套市场 = 与 pi 双轨 |

**结论：继续用 pi 的插件机制。** 唯一值得抄的是**权限可见性**——他们的插件要声明 `permissions` / `fs` 策略 / `net.domains`，且有 `docs/adr/0274-development-plugin-permission-review.md`（开发插件的权限评审）。我们的 `app/api/plugins/check/route.ts` 已经在做「来源可检查性」，可以沿着扩到「装之前先把插件要什么能力显示给用户」。这是**低成本的架构补齐**，不是重做。 `[已验证]`

---

## 5. i18n

| | 他们 | 我们 |
| --- | --- | --- |
| 语言数 | **9 种**：`en / zh-CN / zh-TW / de / es / tr / fr / ko / pt-BR`（`packages/i18n/src/index.ts:36-45`） | **3 种**：`lib/i18n/messages/{en,zh-CN,zh-TW}.ts`（各 1521 行），`lib/i18n/registry.ts:8` |
| 运行时 | `react-i18next` + `useTranslation()`，126 个文件在用 | 自研 `hooks/useI18n.tsx` + `lib/i18n/{registry,format,types}.ts`，无第三方依赖（`docs/i18n.md:1-6` 明确「intentionally kept inside the application」） |
| 目录规模 | `packages/i18n/src/locales/*/index.ts` 2493–2685 行 × 9 = 23,091 行 | 4,561 行 |
| 字符串提取 | **无运行时提取**：`packages/i18n/test/renderer-keys.test.mjs:40-47` 用正则扫描 `apps/desktop/src/**` 里的 `t("…")` 字面量，`:56` 断言「扫出来的 key > 500 条」，然后逐语言断言存在 | 逐组件手写（`components/SettingsUi.test.mjs:10-11` 读 en/zh 源码做定向断言），**没有全局「用了的 key 必须在词表里」的门禁** |
| 词表一致性 | `packages/i18n/test/catalogs.test.mjs`（各语言 vs English）+ `user-facing-copy.test.mjs`（关键文案逐字断言，含 glibc 版本号这种用户可见错误） | `lib/i18n/registry.test.mjs`（只测 locale 解析）+ `format.test.mjs`（只测格式化） |
| 插件侧 | 插件 manifest 有 `i18n: { [locale]: {name, description, safetyNotes} }`（`manifest-schema.md:46-52`），契约语言只有 `en` + `zh-CN`，`zh-TW` 读英文而不是半个 `zh-CN`（ADR 0182） | 无（我们没有插件市场） |

**要不要跟？**

- **不跟语言数。** 9 种语言 × 2500 行 = 22,500 行翻译，我们连 `pt-BR` 都没有维护者。加语言的边际成本对我们是「一次性 1500 行 × N」，对他们是「9 份已经对齐的词表，新增一种只要 2500 行」。**他们的规模是 9 种语言摊薄的，我们只有 3 种，加第 4 种的相对代价更高**。 `[推断，基于两侧词表行数对比]`
- **要跟的是那条门禁。** `renderer-keys.test.mjs` 那条正则扫描 + 逐语言存在性断言，成本约 60 行代码，能钉死「组件里写了 `t("x.y")` 但词表里没有 → CI 红」。**我们今天只有逐组件的定向断言，一个新组件引一个不存在的 key 不会被任何门禁抓住。** 这是本文认为最划算的单点借鉴。 `[已验证]`
- **不跟 react-i18next。** `docs/i18n.md:1-6` 把「不引第三方运行时依赖」写成了设计决定；引入 i18next 会同时改变 bundle 体积、`I18nProvider` 边界和 SSR 行为，收益（复数形式 `key_one/_other`）我们暂时用不上。 `[已验证]`

---

## 6. 配置同步 / 远程主机【重点】

这两块是他们 0.16 里最重的两块新架构，也是**我们最应该明确说「不做」的**。先把事实摆清。

### 6.1 Config Sync：8191 行 Rust 的 WebDAV 同步引擎

`crates/host-core/src/config_sync/` 实测行数：

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `engine.rs` | 1,654 | 同步引擎主体 |
| `transport.rs` | 954 | **WebDAV 传输**（`WebDavConfig` / `ProbeResult`：`conditional_writes` / `append_only` / `missing_object_status`；`ETag`/`If-Match`/`If-None-Match`，`transport.rs:1-10`） |
| `domains_capture.rs` | 820 | 采集各 domain 的当前状态 |
| `apply.rs` | 774 | 把远端合并结果落到本地 |
| `domains.rs` | 741 | **10 个同步域**：`application / providers / mcp / skills / subagents / instructions / projects / plugins / automation / memory`（`domains.rs:24-33`） |
| `handlers.rs` | 621 | RPC 入口 |
| `engine_remote.rs` | 614 | 远端引擎 |
| `merge.rs` | 507 | 三方合并 |
| `coordinator.rs` | 419 | 协调 |
| `crypto.rs` | 358 | vault 加解密 / rewrap |
| `progress.rs` | 285 | 进度 |
| `engine_history.rs` | 433 | 历史 |
| **合计** | **8,191** | |

外加：`config-sync/base.bin` / `pending.bin` 是加密 bundle（`04-data-storage.md:93-101`）、`MAX_REMOTE_OBJECT_BYTES 64 MiB` / `MAX_REMOTE_LIST_ENTRIES 4096`（`transport.rs:9-10`）、网络策略对明文 http 的分级放行（`transport.rs:15-26`：`strict` 拒 http，`relaxed` 仅放行 loopback/`.local`/私网）、`PORTABLE_APPLICATION_FIELDS` 21 个可移植字段白名单（`domains.rs:35-57`）、vault key 与 WebDAV 密码进加密 secret store。e2e：`scripts/e2e-config-sync-multidevice.mjs`（`package.json:47` `test:e2e:config-sync`）。

**为什么这个规模是必然的**：同步 10 个域 × 3 方（本地/远端/基线）合并 × 幂等 × 断点续传 × 加密 × 冲突可见 = 8k 行。**规模不来自功能，来自「域的数量 × 合并语义」。**

**我们能不能做 / 要不要做：**

| 方案 | 代价 | 判定 |
| --- | --- | --- |
| 照抄（8k 行 Rust 等价物 + 加密 vault + WebDAV 客户端） | **XL**（我们没有 Rust；要 TS 等价实现，8k 行 × 我们的迭代速度 ≈ 半年） | ⛔ **不建议**。而且违反不可抄约束 1：同步的 10 个域里有 `providers` / `projects` / `plugins`，**这三个域在我们这边根本不存在实体**，同步它们等于凭空造第二套真源 |
| **只同步「用户可携带的那一小撮」**（我们已有的 `PORTABLE_APPLICATION_FIELDS` 等价物：主题/字号/密度/思考档/工具预设/语言/快捷键，约 10–15 个纯偏好字段） | **S**：一个 `~/.pi/agent/pi-web-portable.json` + 导出/导入两个 Route Handler + 设置页一个按钮 | ⚠️ **可做，收益有限**。这些字段今天已经在 `localStorage`（`lib/theme.ts` / `lib/ui-density.ts` / `lib/tool-preset-preference.ts` / `lib/shortcut-*`）里，本来就跟着浏览器走 |
| **不联网，只做「配置导出/导入一个文件」** | **S**：`GET/POST /api/config-export`，格式就用一份带版本号的 JSON | ✅ **推荐**。这是 90% 的真实需求（「换机器」），成本 1 天，且**不引入第二真源、不引入远端凭据、不引入网络策略** |
| 抄他们的「网络策略对 http 分级放行」这一条 | S | ✅ **值得单独抄**，但它属于我们 `dev:lan` 的安全缺口（见 §6.2），不是同步引擎的事 |

### 6.2 远程主机：SSH 隧道 + RACP 协议栈

| 组成 | 规模 | 证据 |
| --- | --- | --- |
| `apps/desktop/electron/main/remote/` | **3,125 行 / 14 个模块** | `ssh-bootstrap.ts` 421 / `ssh-transport.ts` 520 / `ssh-tunnel.ts` 172 / `pi-host-bootstrap-script.ts` 321 / `remote-backend.ts` 378 / `remote-event-bridge.ts` 274 / `remote-host-registry.ts` 216 … |
| RACP 协议 | `packages/shared/src/racp.ts`（859 行）+ `packages/racp/`（7 文件）+ `packages/agent-host/`（**1,537 行 `agent-host.ts`**） | `RACP_OPERATIONS` **40 个操作**、5 个角色（`viewer/controller/approver/owner/authenticated`，`racp.ts:526-575`）；`RACP_SERVER_REQUESTS` 3 个服务端反向请求（`approval/request`、`input/request`、`tool/execute`）；HTTP 路由映射 16 条（`racp.ts:617-634`） |
| 无头 Host | `apps/pi-host/`（`app.ts` / `cli.ts` / `host-operations.ts` / `credentials.ts` / `terminal.ts`） | 跑在远端机器上、只绑 loopback（`packages/racp/src/ws-binding.ts:54-58` 非 loopback 直接拒） |
| 设置页 | `apps/desktop/src/components/settings/RemoteHostsPage.tsx` 449 行 | 两种加法：`ssh`（自己 bootstrap 安装 + 开端口转发）与 `pair`（URL + 一次性配对 token） |
| 配对认证 | 设备令牌 `pdt1.` / 配对令牌 `ppt1.` 前缀（`racp.ts:585-586`），`connection/pair` 操作 | 令牌存在 main 内部，**渲染端只看到路由键/标签/URL**（`packages/shared/src/types/remote-host.ts:1-8`） |
| e2e | `scripts/e2e-remote-host.mjs`（`package.json:66` `test:e2e:remote-host`） | |

**RACP 的设计原则里有一条对我们极其重要**（`docs/spec/02-architecture/05-remote-agent-control.md:36-46`）：

> 1. **The Agent Host is the source of truth.** A client is a viewer and controller that may disconnect. A running turn is not owned by a browser tab or Electron window.（`05-remote-agent-control.md:40`）

这正是我们**已经天然满足**的：我们的会话真源是 `~/.pi/agent/sessions/*.jsonl` + 进程内 `AgentSession`，**会话不属于浏览器 tab**（`app/api/agent/[id]/events/route.ts:14-26`：SSE 断掉后重连会 `getRpcSession(id)` 或 `startRpcSession(id, ...)` 复活同一个会话）。而他们的桌面版为了做到这件事，需要把「会话所有权」从 renderer 抽出来，做成一个无 Electron 依赖的 `agent-host` 模块（1,537 行），再套一层可远程的 RACP（859 + 7 文件 + 1,537 行）。

**换句话说：远程控制的地基我们已经有了，他们花 5,000 行建的，我们因为「单进程 + 文件真源」免费得到了。** `[已验证]`

**但我们有一个他们没有、而且更严重的问题**：

```
package.json:34  "dev:lan":  "next dev   -H 0.0.0.0 -p 30141"
package.json:37  "start:lan":"next start -H 0.0.0.0 -p 30141"
```

`app/api/**` **没有任何鉴权**（`grep -rn "PI_WEB_TOKEN|x-api-key|Authorization" app/api` → 只有一处无关的文件路径授权检查）。`lib/request-security.ts:148-155` 的 `isApiRequestAllowed` 做的是 **Host 头 + Origin 检查**（防 DNS rebinding / CSRF），**不是身份认证**。

也就是说：**我们今天的「远程主机」是「一个绑在 0.0.0.0 上、任何人可读全部会话与文件、无需任何凭据的 agent 服务」；他们的远程主机是「绑 loopback、必须配对、有 5 级角色、40 个操作逐个授权」**。这不是「我们要不要抄远程主机」的问题，是**我们已有的 LAN 模式需要先补一道门**。 `[已验证]`

**判定与代价：**

| 动作 | 代价 | 价值 | 理由 |
| --- | --- | --- | --- |
| **给 LAN 模式加共享令牌**（`PI_WEB_LAN_TOKEN` env + `proxy.ts` 校验 `Authorization: Bearer`；`start:lan` 启动时若未设则拒绝启动。`proxy.ts:29` 的 matcher 已覆盖 `/api/:path*`，只差一条分支） | **S**（一个 middleware 分支 + 启动检查 + 一条 e2e，约 15 行核心逻辑） | **高** — 我们现在把一个能读全部 `~/.pi` 文件的 agent 无鉴权暴露在局域网（`package.json:34,37`；`lib/request-security.ts:148-155` 只防 rebinding/CSRF，不做身份）。RACP 的 `pdt1.` 设备令牌（`racp.ts:585`）就是这个模式。**RACP 本身 5,000 行，我们不需要它，只需要 15 行** |
| **给 API 分级**（读会话 / 写设置 / 跑 agent 三个权限位，对应 RACP 的 viewer/controller/owner） | **M** | 中 | 今天所有路由是平权的。有了令牌之后这是自然的下一步，但不必一次做全 |
| 远程主机（SSH 隧道 + 无头 Host + RACP） | **XL**（5,000+ 行，且需要先有一个稳定的无头模式） | 低（现阶段） | 我们的定位是本机工作台 + PWA；真要远程，`start:lan` + 令牌 + 一层反向代理（tailscale / cloudflared）就能覆盖 90% 场景，成本 S 级而不是 XL |
| 「会话不属于 tab」这个不变量 | — | — | **已经有了**（`app/api/agent/[id]/events/route.ts:14-26`），但**没有测试钉住它**（见 §7 建议 #5） |

---

## 7. 测试与门禁

| 维度 | 他们 | 我们 |
| --- | --- | --- |
| 单元/契约测试 | `apps/desktop/test/*.test.mjs` **442 个文件** + `packages/*/src/*.test.ts` + `crates/host-core` **600 个 `#[test]`** | `**/*.test.mjs` **301 个文件 / 38,849 行**（components 74 + lib 211 + app 16） |
| e2e | `scripts/e2e-*.mjs` **57 个**（`package.json:19-70` 逐个有 npm script），另有 `scripts/e2e/` 目录 | `e2e/*.mjs` **7 个**（`run.mjs` / `terminal.mjs` / `themes.mjs` / `chat-appearance.mjs` / `extension-dialog.mjs` / `file-panel.mjs` / `file-viewer-modes.mjs`） |
| 架构门禁 | **`scripts/check-architecture.mjs:18-32`**：新 TS 文件 **≤800 行**、Rust **≤1000 行**、`electron/main/index.ts` ≤1500、`stores/app-store.ts` ≤1000 | ❌ 无 |
| 风格门禁 | `scripts/check-style-tokens.mjs`（`lint` = 跑它） | `npm run check:styles` + `check:contrast` + `check:design` + `verify:boards`（设计侧强，结构侧零） |
| 词表门禁 | `packages/i18n/test/renderer-keys.test.mjs`（§5） | ❌ 无全局版 |
| 跨仓一致性 | `check:agent-policy-sync` / `check:marketplace-catalog` / `check:pr-base-main` / `check-release-docs` | ❌ |
| CI | `.github/workflows/ci.yml` + `docs-check.yml` + `linux-package.yml` + `release.yml` + `mirror-to-cnb.yml` + `pr-base.yml` | `.github/workflows/ci.yml`（lint + tsc + test + e2e + themes + design gates） |

### 7.1 我们的门禁漏掉了哪些**架构不变量**

| 不变量 | 他们怎么守 | 我们守了吗 |
| --- | --- | --- |
| **单文件体积** | `check-architecture.mjs:18-32` 硬卡 800/1000 行 | ❌ 我们最大 `components/ChatInput.tsx` **4,096 行**、`ChatWindow.tsx` 3,388、`AppShell.tsx` 3,149、`ModelsConfig.tsx` 2,762、`FileViewer.tsx` 2,758、`SessionSidebar.tsx` 2,577 —— **是他们上限的 5 倍**。他们的最大值是 `Sidebar.tsx` 2,624（也在豁免名单里）。这是我们与他最刺眼的一个结构差 |
| **渲染层不许直接做 IO** | main 独占 DB（`07-process-model.md:27`：host-core owns `pi.sqlite` exclusively）+ `fs-index.ts:10-13` 注释「Served from the main process like the files tab: user-driven browsing must not round-trip agent tools or permission prompts」 | ❌ 无。我们 `app/api/**` 6,916 行全是 IO，`lib/` 42,311 行里 IO 与纯逻辑混在一起（`lib/session-reader.ts` 905 行既解析又读盘又缓存） |
| **import 层不许被客户端组件拉到** | 他们的 main/packages 有明确的 renderer 边界 | ⚠️ 我们踩过：`lib/import/types.ts` 混了契约与 `node:fs` 导致 `next build` 失败（上一轮 §8 记录），修法是拆 `contract.ts`。**这个坑值得变成门禁** |
| **重活必须设上限** | `fs-index.ts:17-21`（8000/15s/4s/32MiB）、`review.rs:19-23`、`racp.ts` 的 1 MiB frame | ⚠️ 我们有上限（`app/api/file-index/route.ts:27-33`）但**没有测试/CI 钉住它**，也没有一个统一的「上限常量登记表」 |
| **插件/外部输入的路径必须在白名单内** | `lib/file-access.ts` 我们有；他们有 `packages/plugin-sdk/src/fs-policy.ts` + `net-policy.ts` | ✅ 我们有 `lib/file-access.ts` / `lib/allowed-roots.ts`，`app/api/file-index/route.ts:120-128` 在用 |
| **会话不属于浏览器 tab** | `agent-host` 的第一条设计原则（`05-remote-agent-control.md:40`）+ `RACP_OPERATIONS` 的 `session/attach` | ❌ 行为上有（`app/api/agent/[id]/events/route.ts:14-26`）但**无测试**。这是一条我们会静默退化掉的性质 |
| **i18n key 必须存在** | `renderer-keys.test.mjs` | ❌ 只有逐组件定向断言 |

**判定：我们的门禁在「设计系统 / 视觉正确性」上远强于他们，在「结构不变量」上几乎为零。** 这正好是本轮该补的方向——不是再加一个视觉断言，而是把「单文件体积」「重活上限」「客户端不许 import node 层」「会话可脱离 tab 复活」「i18n key 存在」这五条钉进 CI。这五条全部可以写成**源码契约测试或静态扫描**，不需要新架构。 `[已验证]`

---

## 8. 打包与发布

| | 他们 | 我们 |
| --- | --- | --- |
| 工具 | electron-builder 26.15.3 + `electron-vite` 4 + 自写 `scripts/build-desktop-release.mjs` | electron-builder 25.1.8 + Next 15/16 静态产物（`package.json` `build` 配置） |
| 目标 | mac（dmg + zip，`hardenedRuntime: true` + `entitlements.mac.plist` + `gatekeeperAssess: false`，`apps/desktop/package.json:141-150`）/ win（nsis + zip + portable，**仅 x64**，`+:194-208`）/ linux（AppImage + RPM，`dist:linux`） | mac（dir + dmg + zip，`x64ArchFiles` 保留 node 原生模块）/ win（nsis + portable）；**无 linux** |
| 二进制 | Rust host-core 交叉编译进 `Resources/bin/`（`apps/desktop/package.json:152-157`），Windows 用 `x86_64-pc-windows-msvc` + `target-feature=+crt-static` 以免依赖 VC++ 运行库（`07-process-model.md:152-154`） | 无额外二进制；`node-pty` 原生模块随包 |
| 额外资源 | `agent-runtime/dist-bundle`（`Resources/agent-runtime/sidecar.js`）、`resources/skills`、`resources/plugins`、tray 图标 | `assets/default-skills`、图标/托盘 PNG（`package.json` `extraResources`） |
| Node 运行时 | **不打包 Node**：sidecar 用 Electron 自己的可执行文件 + `ELECTRON_RUN_AS_NODE=1`（`agent-sidecar.ts:66-72`，解决 D008） | **同样不打包 Node**：Electron 壳用 `process.execPath` 跑 `next` CLI（`electron/main.js:3-5,132`）—— **同一个招，我们已经独立想到了** |
| 自动更新 | electron-updater + Main 拥有的 update controller + 每安装实例一个 `updatePreference`（Automatic/Manual，Windows ZIP 默认 Manual）+ 差分包（`07-process-model.md:310-315`）；`updater.ts` / `update-cache.ts` / `update-policy.ts` / `update-timeout.ts` | **只有「检查新版本」**：`app/api/app-update/route.ts` 轮 GitHub releases API（`LATEST_RELEASE_API`）+ 12h 缓存，**不下载、不安装** |
| 渠道 | GitHub Release + CNB 镜像（`.github/workflows/mirror-to-cnb.yml`） | GitHub Release（`scripts/publish-release.mjs`） |
| CI 发布 | `release.yml` / `linux-package.yml`（Linux glibc 检查 `check-linux-host-glibc.mjs`）/ `docs-check.yml` | 单 `ci.yml`（无发布 workflow） |

**可借鉴的三条**（按性价比）：

1. **自动更新的「两段式」**：`check`（我们已有）+ `install`（缺）。他们的「Manual/Automatic」偏好模型（`07-process-model.md:310-315`）值得抄：Windows ZIP/portable 用户不该被自动替换。**代价 M**：要在 `electron/main.js` 里接 `electron-updater` + 一个 `updatePreference` 持久化。价值中。
2. **Linux 支持**：他们把 Linux 当一等目标，且专门写了 glibc 下限检查（`scripts/check-linux-host-glibc.mjs`；`07-process-model.md:117-119`；UI 里直接说「需要 glibc 2.35+」）。我们零 Linux 产物。**代价 L**（无 Rust 二进制要交叉编译的话，其实只是加一个 electron-builder target + 修 `node-pty` 的 prebuild），价值取决于有没有 Linux 用户。**建议：先问需求，不要先做。**
3. **`asar: false` 的代价他们已经付了**（`apps/desktop/package.json:98-107` 的 files 白名单精细到 `node-addon-api`），我们的 `asar: false` + 巨大的 files 排除列表（`package.json` 里排除了 `pi参考项目/**`、`设计风格/**` 等）说明**我们把整个仓库打进了包**。`pi参考项目/`、`docs/`、`设计风格/` 出现在排除列表里本身就是信号——**打包体积应该有一个门禁**。**代价 S**（一个 `du -sh release/` 的断言），价值中。

---

## 9. 架构能力对照表

| 能力 | 他们靠什么实现 | 我们靠什么 | 能否平移 | 阻塞点 |
| --- | --- | --- | --- | --- |
| **Agent 运行时隔离** | Node sidecar 独立进程（`ELECTRON_RUN_AS_NODE` + `--max-old-space-size=2048`），崩溃分类 OOM/CRASHED，指数退避重启（`agent-sidecar.ts:56-78`；`07-process-model.md:143-155`） | 进程内 `AgentSessionWrapper`（`lib/rpc-manager.ts:1952,2471`），空闲 10 分钟自关（`:160-181`） | ⚠️ 半 | 我们没有第二个 Node 进程可用；把会话移出 Next 需要自研一套 sidecar 协议（≈他们 3,000 行）。**只有当 OOM/串扰真的发生时值得** |
| **Host 进程（DB/工具/权限）** | Rust host-core，stdio NDJSON JSON-RPC，64 MiB 帧上限、130s 默认超时（`host-process.ts:1-11`；`07-process-model.md:170`） | 无独立 host；`lib/rpc-manager.ts` 直接调 SDK 工具 | ⛔ 不 | 我们没有 Rust，Node 单进程无法获得同等故障隔离 |
| **会话 / turn 准入与审批** | `agent-host` 模块 1,537 行（admission / queue / approval broker / event log），Rust 侧 `plan_approvals` 22 列 + 4 索引（`schema.rs:213-256`） | `lib/rpc-manager.ts` 进程内 + `lib/approval-policy.ts`；队列镜像 SDK 的 steering/followUp（`:577-596`） | ✅ 已等价（本地） | — |
| **会话不属于浏览器 tab** | `agent-host` 设计原则第 1 条（`05-remote-agent-control.md:40`） | SSE 断线重连按 id 复活（`app/api/agent/[id]/events/route.ts:14-26`） | ✅ **已等价** | 无门禁守护（见 §7.1） |
| **工作区文件索引** | main 进程 `git ls-files` 8000 条 / 15s / 4s / 32 MiB（`fs-index.ts:17-21`） | Route Handler `git ls-files` 5000 / 10s / 64 MiB（`app/api/file-index/route.ts:27-33,67`） | ✅ 已等价 | 上限比我们宽 2×，需收紧 |
| **全文检索（FTS5）** | `messages_fts` 虚拟表 + trigram + 3 触发器（`schema.rs:194-210`） | 无（FTS 索引 JSON 文件，唯一真正的新存储需求） | ⚠️ 需新建 | 不可抄约束 1：只能是派生索引文件，不能建库 |
| **项目实体** | `projects` 表（`schema.rs:39-51`）+ 项目组（`project_groups.rs` 514 行） | 派生：`projectKey` 去重（`lib/types.ts:380-384`）+ `lib/recent-projects.ts` | ✅ 已等价 | — |
| **归档 / 置顶 / 偏好** | `kv:ui` + renderer localStorage `pi.desktop.sidebarPreferences`（`04-data-storage.md:295-340`） | localStorage `pi-session-flags` / `pi-project-flags`（`lib/session-flags.ts:20`、`lib/project-flags.ts:24`） | ✅ 已等价 | — |
| **Todo 持久化** | v21 新增 `session_todo` 表 + 部分唯一索引（`schema.rs:5-23`） | tool result `details` + 分支回卷（`lib/todo-state.ts:1-10`） | ⛔ **不建议抄** | 表做不到「分支时随对话回卷」，这是我们的优势 |
| **配置同步（多设备）** | 8,191 行 Rust，WebDAV + ETag 条件写 + 加密 vault + 10 个域三方合并（`config_sync/`，`domains.rs:24-33`） | 无 | ⚠️ **只做导出/导入** | 全量同步涉及我们不存在的域（providers/projects/plugins），会造第二真源 |
| **远程主机** | SSH 隧道 + 无头 `pi-host` + RACP（40 操作 / 5 角色 / loopback-only / 设备令牌）= 3,125 + 2,400 行 | 已有 `start:lan`（绑 0.0.0.0，**无鉴权**，`package.json:37`） | ⛔ 不建议抄 | 我们缺的是**鉴权**，不是远程能力；且我们的架构已经是「host 是真源」 |
| **原生联网搜索** | **pi-ai 补丁**：`hostedSearch` 内容类型 + 6 个 adapter + 事件流（`patches/@earendil-works__pi-ai@0.99.1.patch`） | 无（0.87.0 `grep -rl hostedSearch` 零命中） | ⛔ **不可平移** | 上游无此概念；抄 = backport 补丁，会让 `npm install` 不可复现 |
| **按模型的 token 估算** | pi-ai 补丁（`estimate*(x, model?)`）+ agent-core / coding-agent 两张补丁透传 | `estimate.d.ts:15-16` 无 model 参数 | ⚠️ 等上游 | 现在没有意义（无 hosted search） |
| **keep-awake** | Electron `powerSaveBlocker`（`keep-awake.ts:9-12`） | Electron 壳已有（`electron/main.js:330-338`），浏览器/PWA 无 | ✅ 已等价 | PWA 侧无解（平台能力） |
| **语音采集 / 本地转写** | main 采 PCM（pvrecorder）+ `voice-runtime` 本地模型下载 | 无 | ⚠️ 半 | Web 侧缺原生 mic 权限枚举；产品未立项前不做 |
| **Review 快照（工具时 diff）** | Rust 在 write/edit 时算 diff 并落盘 `review-changes/`（`review.rs:1-4,19-23`） | 无（对 HEAD 现算，`lib/git-changes.ts`） | ⚠️ 半 | pi 的 tool result 不含 before 字节；**渲染侧上限（4000 行 / 2M 单元格）可单独抄** |
| **嵌入式预览浏览器** | 单 `WebContentsView` + 目录 watch live reload（`browser-view.ts:7-19`） | 无 | ❌ | Electron 原生能力；`<iframe>` 拿不到权限边界，产品语义不存在 |
| **插件视图** | `ui.panel` 独立窗口 + `contributes.views`（`WebContentsView`，`MAX_LIVE_VIEWS=4`，`plugin-view-host.ts:34-52`） | 无 | ❌ | 同上；且我们没有 Electron main 承载层 |
| **插件工具 / skills / themes / extensions** | plugin-sdk 2,222 行 + 每插件一进程（`plugin-host-process.mjs:11-20`） | pi package + `DefaultPackageManager`（`app/api/plugins/route.ts:5-11`） | ✅ **继续用 pi 的** | 两套体系仅在 ExtensionAPI 上重叠，已等价 |
| **插件市场** | 远端 catalog + `.piplug` + 签名（`plugins/marketplace/catalog.rs`、`07-plugin-marketplace.md`） | 无（`npx skills add`） | ⛔ 不建议 | 与 pi 的 `DefaultPackageManager` 双轨 |
| **i18n 语言数** | 9 种，23,091 行词表（`packages/i18n/src/index.ts:36-45`） | 3 种，4,561 行（`lib/i18n/registry.ts:8`） | ⚠️ 不跟 | 无维护者；边际成本对我们更高 |
| **i18n key 门禁** | 正则扫 `t("…")` + 逐语言存在性（`renderer-keys.test.mjs:37-56`） | 逐组件定向断言 | ✅ **建议抄**（约 60 行） | 无 |
| **架构门禁** | `check-architecture.mjs:18-32`（TS ≤800 / Rust ≤1000 / 主入口 ≤1500） | 无（我们最大 4,096 行） | ✅ **建议抄** | 需要先定基线（存量豁免） |
| **打包** | mac/win/linux + Rust 交叉编译 + electron-updater 自动更新 + GitHub/CNB 双渠道 | mac + win(nsis/portable) + 只检查不安装 | ⚠️ 部分 | Linux 需 `node-pty` prebuild；自动更新需接 `electron-updater` |

---

## 10. 建议动作

价值/代价的判据统一用三条：**① 是不是补一条我们目前会静默退化的不变量；② 是不是补一个今天真实存在的用户路径；③ 代价是否 < 1 周。**

| # | 动作 | 类型 | 价值 | 代价 | 依赖 | 落点文件 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **给 `start:lan` / `dev:lan` 加共享令牌鉴权**：未设 `PI_WEB_LAN_TOKEN` 时 `start:lan` 拒绝启动；中间件校验 `Authorization: Bearer`；补一条 e2e 断言「无令牌 401」 | 补齐（安全） | **高** — 我们现在把一个能读全部 `~/.pi` 的 agent 无鉴权暴露在局域网（`package.json:34,37`；`lib/request-security.ts:148-155` 只防 rebinding 不做身份） | **S**（~150 行 + 一个启动检查）。一个 env var + 一个中间件分支 + 一条测试 | 无 | `proxy.ts`、`package.json`、`e2e/` 新脚本 |
| 2 | **新增架构门禁 `scripts/check-architecture.mjs`**：新 `.ts/.tsx` ≤800 行（存量豁免名单先记一次 baseline），并检查 `lib/i18n/*`、`lib/file-viewer-state.ts` 这类纯逻辑模块不许 import `node:*` | 补齐（门禁） | **高** — 我们最大文件 4,096 行，是他们上限的 5 倍；且「客户端组件拉到 node 层」的坑已经真踩过一次（`lib/import/types.ts` → `next build` 失败） | **S**（脚本 ~120 行 + 一份 baseline JSON）。纯静态扫描，无新依赖 | 无 | `scripts/check-architecture.mjs`、`scripts/`（并入 CI） |
| 3 | **i18n key 全局门禁**：正则扫描 `components/**/*.tsx` 的 `t("…")` 字面量，断言每个 key 在 `en/zh-CN/zh-TW` 三份词表里都存在，并断言扫描到的 key 数量 >300（防扫描器静默失效） | 补齐（门禁） | **高** — 今天一个组件引一个不存在的 key 只有原始 key 显示在 UI 上，没有任何门禁能抓住；他们的同类门禁正是因为「`settings.serviceModels` 曾未翻译」才写的（`renderer-keys.test.mjs:1-11` 注释原话） | **S**（~60 行，与他们的实现同构） | 无 | 新增 `lib/i18n/keys.test.mjs` |
| 4 | **把「重活上限」写成一张表 + 一条测试**：把 `app/api/file-index/route.ts`、`lib/import/*` 里所有上限常量集中登记（`lib/limits.ts`），并为每条上限加「超限时截断而非抛错」的断言；同时把 file-index 的 git 超时 10s→4s、buffer 64 MiB→32 MiB 与他们对齐 | 补齐（门禁+调参） | **中** — 单进程下这是唯一会卡住整个 Web 服务的路径；当前上限比他们宽 2× 且无测试 | **S**（`lib/limits.ts` 纯搬 + 一条 fixture 测试；调参 2 行） | 无 | `lib/limits.ts`、`app/api/file-index/route.ts:27-33,67`、新增测试 |
| 5 | **给「会话不属于浏览器 tab」加契约测试**：断言 `app/api/agent/[id]/events/route.ts` 走 `getRpcSession(id)` / `startRpcSession(id, ...)` 而非按连接创建会话；并加一条 e2e：关掉 SSE 再重连，会话 id 与消息历史不变 | 补齐（门禁） | **中** — 这条性质是我们架构的免费红利（`events/route.ts:14-26`），也是远程控制的地基；他们花 1,537 行 `agent-host` 才建立它。我们不钉住，改代码时会静默退化 | **S**（源码契约测试 ~40 行；e2e 可选） | 无 | `app/api/agent/events-route.test.mjs`（已有同目录测试） |
| 6 | **设置页加「导出/导入配置」**：`GET/POST /api/config-export`，一个带 `version` 的 JSON（主题/字号/密度/思考档/工具预设/语言/快捷键 + 可选模型配置骨架）；不做远端、不做合并 | 新增功能 | **中** — 覆盖「换机器」这个真实需求，成本是 Config Sync 的 1/50；且不引入第二真源 | **S**（~2 个 route + 设置页一个区块） | 无 | 新增 `app/api/config-export/route.ts`、`lib/config-export.ts`、`components/SettingsPanel.tsx` |
| 7 | **插件「装之前先亮权限」**：`/api/plugins/check` 扩展为解析包的 `pi.extensions` 入口，列出它会注册的工具/命令，安装前在 UI 上明示 | 补齐（交互） | **中** — 他们有 `permissions`/`fs`/`net` 三层声明 + ADR 0274 的开发插件权限评审；我们只有来源可检查性。这是**低成本对齐**（不需要 marketplace） | **S/M** | 无 | `app/api/plugins/check/route.ts`、`lib/plugin-updates.ts`、`components/PluginsConfig.tsx` |
| 8 | **自动更新的第二段：下载 + 安装** | 新增功能 | **中** — 我们只有「检查」（`app/api/app-update/route.ts`），用户仍要手动去 Releases | **M** — `electron/main.js` 接 `electron-updater` + `updatePreference` 持久化 + Windows ZIP 默认 Manual 的策略 | 无 | `electron/main.js`、`lib/app-update.ts` |
| 9 | **打包体积门禁**：`release/` 产物大小上限断言 + 把 `pi参考项目/`、`设计风格/`、`docs/` 从 files 排除改成「根本不进包」 | 补齐 | **中** — `package.json` 的 files 排除列表里出现 `pi参考项目/**` 说明整个参考仓库被扫描过 | **S** | 无 | `scripts/verify-desktop-bundle.mjs`、`package.json` |
| 10 | **原生联网搜索：不做** | 不建议 | — | — | — | — |
| 11 | **SQLite / projects / providers / turn_queue / session_todo 表：不抄** | 不建议 | — | — | — | — |
| 12 | **配置同步全量（WebDAV + 10 域）：不做** | 不建议 | — | 同步域里有 3 个我们不存在的实体（providers/projects/plugins），抄 = 造第二真源 | — | — |
| 13 | **远程主机（SSH + RACP）：不做** | 不建议 | — | 我们的 `start:lan` + 令牌 + 反向代理已覆盖 90% 场景；RACP 是 5,000 行 | — | — |
| 14 | **i18n 加到 9 种语言：不跟** | 不建议 | — | 无维护者；我们的词表基数只有他们的 1/5，加第 4 种的相对代价更高 | — | — |
| 15 | **Linux 打包：先问需求，不先做** | 待定 | 取决于有没有 Linux 用户 | **L** — 要修 `node-pty` 的 Linux prebuild，并加一个 target | — | `package.json` `build.linux` |
| 16 | **语音 / 嵌入式预览浏览器 / 插件视图：不建议** | 不建议 | — | 三者都依赖 Electron 原生能力（mic 权限枚举 / `WebContentsView` / per-plugin partition），Web 侧无等价物 | — | — |

---

## 附录 A：本文引用的关键文件（对方侧）

| 主题 | 路径 |
| --- | --- |
| 进程模型 | `docs/spec/03-runtime/07-process-model.md`、`packages/host-runtime/src/host-process.ts`、`apps/desktop/electron/main/agent-sidecar.ts` |
| 数据层 | `crates/host-core/src/db.rs`、`crates/host-core/src/db/schema.rs`、`docs/spec/03-runtime/04-data-storage.md` |
| pi 补丁 | `pnpm-workspace.yaml:53-56`、`patches/*.patch`（3 张，38 个 dist 文件） |
| 插件 | `docs/spec/07-plugins/02-plugin-manifest-schema.md`、`packages/plugin-sdk/src/`、`apps/desktop/electron/main/plugin-{view-host,host-process,panel-host}.ts` |
| i18n | `packages/i18n/src/index.ts`、`packages/i18n/test/` |
| 配置同步 | `crates/host-core/src/config_sync/`（14 文件 / 8,191 行） |
| 远程主机 | `apps/desktop/electron/main/remote/`（14 文件 / 3,125 行）、`packages/shared/src/racp.ts`、`packages/racp/src/ws-binding.ts`、`packages/agent-host/src/agent-host.ts`、`docs/spec/02-architecture/05-remote-agent-control.md` |
| 门禁 | `scripts/check-architecture.mjs`、`scripts/e2e-*.mjs`（57）、`apps/desktop/test/`（442） |
| 打包 | `apps/desktop/package.json:82-220`、`scripts/build-desktop-release.mjs` |
