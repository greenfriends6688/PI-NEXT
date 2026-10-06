# PI NEXT - Development Notes

## Quick Start

**日常使用（快）**：

```bash
npm run prod        # 清 dev 缓存 → next build → next start，端口 30141
```

生产模式是预编译的：接口实测比 dev 快约 10 倍，切会话平均 142ms
（dev 下同一路径的关键接口要 2-4 秒，因为 dev 每条路由首次访问都要现编）。
日常使用、演示、给别人看，一律用 `npm run prod`。

**改代码（dev）**：

```bash
npm run dev:clean   # 清生产缓存 → next dev，端口 30141
```

Typecheck: `node_modules/.bin/tsc --noEmit`  
Lint: `npm run lint`  
查看当前 `.next` 属于哪种模式：`npm run mode:status`

**dev 与生产构建共用&#x20;**`.next`**，两者产物不兼容**，直接混用会报 `Failed to compile` 或浏览器里 `Module ... factory is not available` 的假故障。 `prod` / `dev:clean` 会在启动前自动把不匹配的缓存挪到系统临时目录， 所以来回切换请走这两个命令，不要直接 `npm run build` 再 `npm run dev`。

### Dev server troubleshooting

- Before starting a server, run `lsof -nP -iTCP:30141 -sTCP:LISTEN` and reuse the existing Pi Web process when it is healthy. A second `next dev` for the same checkout cannot use a different port as a workaround because both processes contend for `.next/dev/lock`.
- A browser-only `Module ... factory is not available` overlay usually means that tab has a stale Turbopack/HMR graph; it does not prove the server or source is broken. First call the browser's explicit reload action, then compare the current server log and a direct HTTP/API request.
- Restart only after the failure reproduces from a fresh page and the server-side checks also fail. Stop the exact dev process gracefully, move `.next` into a `mktemp -d` backup, and restart with `npm run dev:clean`.
- Do not use `next dev --webpack` as a fallback. This repository's development graph can fail on `undici` imports such as `node:console`; development is expected to use Turbopack.
- Next.js may append a generated `BEGIN:nextjs-agent-rules` block to `AGENTS.md` when `next dev` starts. Treat that as generated tooling output, verify it with `git status`, and do not include it in an unrelated feature commit.

### 为什么 dev 模式感觉「超级慢」

dev 模式（Turbopack）每条路由**首次**访问都要现场编译，实测单次 10-15 秒；
且 Next 默认 `reactStrictMode: true`，dev 下 effect 会被双调用，
切一次会话会并发轰出 **15 个 API 请求**（含重复的 `/api/sessions/<id>`），
在 Node 单线程上互相排队，实测最慢的接口要 3.9 秒。
生产构建下同一操作只剩 **3-5 个请求、最慢 106ms、平均 142ms**。

如果觉得慢，先确认自己在哪种模式（`npm run mode:status`），不要急着优化代码。

---

## Architecture

```
Browser                Next.js Server              AgentSession (in-process)
  │                        │                               │
  ├─ GET /api/sessions ────▶ reads ~/.pi/agent/sessions/   │
  ├─ GET /api/sessions/[id] reads .jsonl file directly     │
  ├─ GET /api/agent/running ───────▶ running id snapshot   │
  │                        │                               │
  ├─ send message ─────────▶ POST /api/agent/[id]          │
  │                        │   startRpcSession() ─────────▶│ createAgentSession()
  │                        │   session.send(cmd) ─────────▶│ session.prompt()
  │                        │                               │
  ├─ SSE connect ──────────▶ GET /api/agent/[id]/events    │
  │                        │   session.onEvent() ◀─────────│ session.subscribe()
  │◀── data: {...} ─────────│                               │
```

**Session browsing** (read-only): reads `.jsonl` files through SDK `SessionManager` helpers and `lib/session-reader.ts` — no AgentSession created.  
**Sending a message**: `startRpcSession()` in `lib/rpc-manager.ts` creates an AgentSession in-process.

---

## File Map

```
app/api/
  sessions/route.ts               GET  list all sessions
  sessions/[id]/route.ts          GET/PATCH/DELETE session
  sessions/[id]/context/route.ts  GET ?leafId= — context for a specific leaf
  sessions/[id]/export/route.ts   GET exported HTML for a session
  agent/new/route.ts              POST { cwd, message, toolNames?, provider?, modelId? }
  agent/[id]/route.ts             GET state | POST any command
  agent/[id]/events/route.ts      GET SSE stream
  agent/running/route.ts          GET currently-running session ids
  auth/api-key/[provider]/route.ts POST/DELETE provider API key storage
  auth/login/[provider]/route.ts  GET OAuth/device-code SSE | POST manual code
  auth/logout/[provider]/route.ts POST OAuth logout
  auth/providers/route.ts         GET OAuth and API-key provider lists
  cwd/validate/route.ts           POST validate/select a cwd
  default-cwd/route.ts            POST create ~/pi-cwd-YYYYMMDD
  files/[...path]/route.ts        GET file contents for viewer; POST file
                                  mutations (write/rename/delete/mkdir/touch/
                                  extract/compress) for the file explorer
  home/route.ts                   GET user home directory
  models/route.ts                 GET { models, modelList, defaultModel }
  models-config/route.ts          GET/PUT — read/write ~/.pi/agent/models.json
  models-config/catalog/route.ts  GET models.dev pricing presets
  models-config/discover/route.ts POST fetch a configured provider's upstream model list
  models-config/test/route.ts     POST test a configured model/provider
  plugins/route.ts                GET/POST package plugin management
  skills/route.ts                 GET/PATCH loaded skills and disable-model-invocation
  skills/install/route.ts         POST install skills through npx skills add
  skills/search/route.ts          GET/POST skills.sh search
  subagents/settings/route.ts     GET/PUT built-in subagent feature setting
  lan/access/route.ts             GET/PUT LAN access on/off + status (first GET mints the token)
  lan/pair/generate/route.ts      POST mint a 6-digit LAN pairing code (this machine)
  lan/pair/redeem/route.ts        POST exchange a pairing code for the LAN cookie
                                  (the only auth-exempt path)
  im-bridge/route.ts              GET/PUT/POST IM push targets (masked list / replace / test send)
  bot-channel/route.ts            GET/POST chat-bot channels (specs + configure | start | stop)
  worktrees/route.ts              GET/POST/DELETE git worktrees

lib/
  lan-access.ts        fork:lan-access — the only LAN gate (app-owned token, read-only derivation)
  lan-supervisor.cjs   fork:lan-access — 盯着配置让「启动」真生效（CJS，两个启动器共用一份）
  chat-channel-shared.ts fork:bot-channel — 渠道清单与逐条可行性（客户端安全）
  chat-channel.ts      fork:bot-channel — 渠道配置与 ready 判定（服务端）
  telegram-channel.ts  fork:bot-channel — 唯一真跑通的入站：Telegram 长轮询、白名单、回程
  lan-pair.ts          fork:lan-access — 6-digit pair codes (globalThis singleton) + LAN URL list
  qrcode.ts            fork:lan-pair-qr — vendored from MusePi (MIT): ISO/IEC 18004 encoder, zero deps
  qr-image.ts          fork:lan-pair-qr — QR → bitmap with the quiet zone the scanner needs
  im-bridge.ts         fork:im-bridge — signing, payload builders, sending, ~/.pi/agent/im-bridge.json
  im-extension.ts      fork:im-bridge — the im_send tool
  subagent-mail.ts     fork:agent-mail — in-process agent↔agent mailbox
  agent-client.ts      typed fetch helper for /api/agent commands
  draft-store.ts       local draft persistence helpers
  file-access.ts       allowed file roots for /api/files and worktrees
  file-paths.ts        client/server path encoding helpers
  file-tree-visibility.ts  which entries the file tree lists: git check-ignore, name-list fallback
  linked-directory.ts   directory links out of the roots: listing marker + one-off operator approval
  markdown.ts          shared markdown helpers
  gfm-autolink-email-loader.cjs  bundler loader: remark-gfm's email regex without a lookbehind literal (#753)
  npx.ts               npx runner used by skill install
  pi-types.ts          local structural types for pi SDK objects
  rpc-manager.ts      AgentSessionWrapper + registry + startRpcSession
  session-reader.ts   SessionManager wrappers + path cache + buildSessionContext adapter
  subagent-settings.ts  read/write ~/.pi/agent/agents/settings.json
  tool-presets.ts     PRESET_NONE/READ_ONLY/DEFAULT/FULL + getPresetFromTools()
  tool-preset-preference.ts  browser-persisted default for fresh sessions
  types.ts            shared TypeScript types
  session-unread.ts   fork:trace-menu — 未读会话 id 的共享 store（侧栏画点、菜单写）
  normalize.ts        normalizeToolCalls() — field name mismatch between file format and our types
  worktree.ts         project/worktree resolution and git worktree operations

components/
  AppShell.tsx        layout + URL state + tab management
  SessionSidebar.tsx  session tree + FileExplorer
  ChatWindow.tsx      chat composition + completion sound wrapper
  ChatInput.tsx       input bar + model/thinking/tools/compact controls
  MessageView.tsx     renders one message (user/assistant/toolCall/toolResult)
  BranchNavigator.tsx in-session branch switcher
  ChatMinimap.tsx     scroll minimap alongside the message list
  MarkdownBody.tsx    markdown renderer
  ModelsConfig.tsx    modal for editing models.json (opened from sidebar bottom)
  AgentsConfig.tsx    built-in subagent toggle + agent profile editor
  PluginsConfig.tsx   modal for installed package plugins
  SkillsConfig.tsx    modal for loaded/search/installable skills
  FileExplorer.tsx    file tree inside sidebar
  FileIcons.tsx       file icon helpers
  FileViewer.tsx      file content in a tab
  TabBar.tsx          tab bar (Chat + open file tabs)
  TraceFrame.tsx     fork:trace-frame — 调用轨迹（右栏单例 tab：完整历史导出页 + 全屏）
  fork/SessionActionsMenu.tsx  fork:trace-menu — 顶栏 ⋯ 会话动作菜单

hooks/
  useAgentSession.ts  messages + streaming + SSE + fork/navigate/reconciliation logic
  useAudio.ts         completion sound + browser AudioContext unlock
  useDragDrop.ts      shared drag/drop state
  useIsMobile.ts      responsive breakpoint hook
  useTheme.ts         theme state

fork 补丁台账（相对上游 pi-web 的功能改动，合并上游后照此重打）
  docs/patches/README.md          约定 + 索引；每个补丁一份 .md 说明 + 一份 .patch
  docs/patches/0001-chat-workspace.md  独立聊天工作区（不在项目中的对话）
  lib/chat-workspace.ts / app/api/chat-workspace/route.ts  该补丁主体；
  grep -rn "fork:chat-workspace" 可列出它在上游文件里的全部接线点
```

---

## Key Design Decisions & Traps

### AgentSession lifecycle (`lib/rpc-manager.ts`)
- One `AgentSessionWrapper` per session id, keyed in `globalThis.__piSessions`
- `globalThis` survives Next.js hot-reload; plain module-level Map does not
- Idle timeout: 10 minutes. Concurrent `startRpcSession()` calls share a single start Promise (`globalThis.__piStartLocks`)
- **Idle reclamation only asks `lib/session-liveness.ts`**, which is the single seam every
  busy-signal flows through: a liveness provider (a visible session holds a lease and is
  therefore never reclaimed) **plus** `hasActiveSessionLivenessProvider()` and
  `hasDelegatedWork()` from `lib/delegated-work.ts`. A session whose background sub-agent
  run is `starting | queued | running` counts as **busy** — otherwise the 10-minute timer
  reaps the parent while the child is still going and `get_subagent_result` polls forever.
  Register a new busy-signal through `lib/session-liveness.ts`, never by editing the
  reclamation line: explicit shutdown and run-time replacement take priority over it, and
  a read that fails or returns an unexpected shape answers "no delegated work" instead of
  throwing. The process-wide `__piSubagentRuns` registry (`Symbol.for`) is the source of
  truth for that signal, not artifact mtimes — our session model has no such files.

### Fork must destroy the wrapper immediately
`AgentSession.fork()` **mutates the wrapper's inner state in-place** — after fork, `inner.sessionId` is the *new* session's id. If the wrapper stays alive in the registry under the old id, the next request gets the already-forked state and subsequent forks produce a corrupt `parentSession` chain.

**We never call it.** `send("fork")` opens a **separate `SessionManager`** on the source file and copies the path with `createBranchedSession()`, so `this.inner` is untouched and the chain cannot corrupt (`lib/rpc-manager.test.mjs` locks this: two forks off one wrapper both point `parentSession` at the source file). An **idle** source is still shut down after the fork — the browser moved to the child, and dropping the wrapper is what guarantees the next request for the old id reloads a clean `AgentSession` from the original file.

**A running source keeps its run** (upstream `19774b8`, #1023): the copy needs only *finished* entries, which pi appends synchronously in-process, so the file already holds them. Only a running `!` shell command refuses a fork. The wrapper survives, the run finishes, and the session is reaped by the idle timer like any other.

### In-session branching stays locked mid-run
One `.jsonl` has exactly one leaf, and the running agent appends under it — so `navigate_tree` refuses while the session is running (only `get_state` and friends are allowed through). "Edit from here" must therefore prefill the composer and branch **when the message is sent** (upstream `7303179`, #1009); navigating on click persists a leaf move the user never committed to, and a reload then shows the conversation cut off.

### Two kinds of branching — don't confuse them
- **Fork** ("New session" on user message): creates a new independent `.jsonl` file. Shown as a child in the sidebar tree via `parentSession` header field.
- **In-session branch** ("Edit from here" / BranchNavigator): calls `navigate_tree` within the same file. Multiple entries share the same `parentId`. Switching between them calls `/api/sessions/[id]/context?leafId=`.

### Session files can be fully rewritten
`parentSession` in the header is **display metadata only** — has zero effect on chat content. Safe to `writeFileSync` the entire file (pi does this itself during migrations). Used when cascade-reparenting children on delete.

### Document preview selection
- The DOCX preview is a same-origin sandboxed iframe, so its text selection never reaches the parent document's `selectionchange`. `DocumentViewer` reads `iframe.contentDocument.getSelection()` straight from the frame and anchors `FileSelectionQuotePopover` (shared with the text viewer) to the frame's own coordinates; the selection is quoted with `startLine: 0`, which `fileSelectionText()` serializes as an unlocated `@path` snapshot. PDF previews use the browser's built-in viewer and cannot support this.

### 虚拟列表的行高只有一个真值：真行自己的盒高（fork:session-row-overlap）

会话列表是**绝对定位的固定行距窗口化**。行距一旦短过行的真实盒高，行盒只画到行距、文字画到盒高 —— 每一行的元信息都压在下一行的标题上（用户 2026-10-05 截图）。写死的数字必然再漂：v1 `.pw-session` 是 48，v5 `.d-sess` 已经是 52.6，PWA `.m-row` 更到 85。

- `SESSION_LIST_ITEM_HEIGHT` 现在**只是首帧兜底**，真值由 `useSessionRowHeight(listScrollRef)` 在 `useLayoutEffect` 里量第一枚行（绘制前重排，看不到跳）。窗口与偏移都吃这同一个数。
- 行高因此必须**与状态无关**：行尾控件（折叠箭头 `d-iconbtn` 28 / hover 四枚动作 24）原本留在流里，会把 `.d-sess-m` 从 17.7 顶到 24 或 28，行高在 52.6 / 58.9 / 62.9 之间跳，悬停一枚就叠一次。`app/design/v5-forms.css` 里预留了元信息格的高度（`.d-sess-m` 28 / `.m-row-m` 36）把它钉死。
- 高行（运行中 / 等你处理）那套偏移分支已删：v5 的徽标只比普通行高 0.3px，`Math.ceil` 后落进同一档。**再加高度分支前先想清楚是不是又让行高变成状态相关了。**

### ToolCall field normalization
Pi stores toolCall blocks as `{type:"toolCall", id, name, arguments}` but `ToolCallContent` uses `{toolCallId, toolName, input}`. `normalizeToolCalls()` in `lib/normalize.ts` handles this — called in both `session-reader.ts` (file load) and `handleAgentEvent` in `hooks/useAgentSession.ts` (streaming).

### New session tool preset
Tool names are passed at session creation (`POST /api/agent/new` -> `toolNames[]`) and persisted in versioned `pi-web:tool-selection` custom entries. No entry means a legacy session and keeps Pi's default behavior; an empty array means Chat only. Chat only resolves before services are created, loads no extensions/skills/prompts/themes, and replaces Pi's base prompt with the ordered contents of Pi's discovered context files. Crossing the Chat-only boundary rebuilds the wrapper; changing between nonempty presets updates it in place. Subagents persist their active tools plus profile-level skill and extension loading switches in `resourceSnapshot`; loaded extensions cannot expose the reserved `Agent`, `get_subagent_result`, or `steer_subagent` tools to a subagent. See `docs/adr/0002-chat-only-tool-selection.md`.

The last preset explicitly selected by the user is stored in browser `localStorage` and initializes fresh-session composers only. Existing sessions never trust that preference; they use their live `get_tools` state or pi's default when no wrapper exists.

**Tool exposure (pi >= 0.99).** Every tool reports an `exposure`: pi activates `direct` and `model-only` tools on registration, leaves `codemode` and `deferred` tools undeclared until something names them, and ignores `hidden` (withdrawn) tools in `setActiveToolsByName()`. `withExtensionTools()` therefore carries over only the first two when it applies a preset, and `get_tools` leaves hidden tools out. `ToolInfo.exposure` stays optional in `lib/pi-types.ts` (`ToolExposure` is spelled out locally — 0.87 does not export the name) and a missing value means `direct`. The pi CLI prepends its built-in `mcp`, `codemode`, `tool-search` and `llama.cpp` extensions from a module the SDK does not export, so pi-web sessions load none of them. `defaultTools` may hold `+name` / `-name` modifiers: read the resolved list through `SettingsManager.getDefaultTools()`, and `lib/powershell-settings.ts` resolves the raw global list with the same rule before it edits it, since appending a plain name to a modifier-only list would drop pi's default tools.

**Prompt disposition (pi >= 0.99).** `AgentSessionLike.prompt()` takes the SDK's own `PromptOptions`; never re-declare it locally. `preflightResult` receives `"handled" | "queued" | "started"` instead of a boolean, and a rejected prompt never calls it — it only rejects the returned promise. Every accepted value is truthy, so the wrapper's `if (disposition) acceptPreflight()` means the same thing as the old `if (success)`. `steer()` / `followUp()` resolve to `"handled" | "queued"`; pi-web ignores both and reads the queue from `getQueue()`.

### Model defaults for new sessions
`GET /api/models` returns `defaultModel` read from `~/.pi/agent/settings.json`. `ChatWindow` pre-selects this on mount for new sessions. Explicit browser model/thinking selections are applied atomically during AgentSession construction, then `lib/startup-preferences.ts` persists their effective values without replaying `set_model`/`set_thinking_level`; implicit `enabledModels` fallbacks and thinking pins are not persisted.

### Model switch while a turn is running (fork:proma-37-deferred-model)
Running a turn and picking another model must **not** interrupt it: `set_model` is never sent while `isStreaming`. The selection is recorded as a pending model (`decideModelSelection` → `defer`) and applied by **replaying `handleModelChange` after the turn ends** — no timer of its own. The apply point is `settleTurn()`, which wraps the existing `settleUiStage()` funnel that `prompt_done`, `agent_settled` and the no-SSE `finishPromptWithoutStream` fallback already share; that is what makes it idempotent per run. `pendingFlushDecision` is the gate that finally takes the pending away: if a new run started, the session vanished, or a switch is already in flight, the pending is **kept** for the next turn end rather than dropped. Switching sessions clears the queue, but `null → real id` (`promoteNewSession`) deliberately does not — that is the same session before its id exists, so a new session's first turn keeps its queue. The composer shows a `.pw-chip accent` next to the model selector (`clock` icon); the selector itself keeps showing the model of the **running** turn. Pure logic lives in `lib/pending-model.ts`.

### `enabledModels` scoping
The `enabledModels` setting uses pi's `--models` syntax: minimatch globs against `provider/modelId` or a bare `modelId`, fuzzy matching for non-glob patterns, and an optional `:thinkingLevel` suffix. Never compare those patterns as literal strings — `lib/model-scope.ts` delegates to the SDK's `resolveModelScopeWithDiagnostics()` so pi-web and the TUI agree on the visible model list, and falls back to all available models when patterns resolve to nothing. `startRpcSession()` resolves that scope before creating an AgentSession and passes the selected initial model, thinking pin, and SDK-native `scopedModels` atomically; `GET /api/models` reuses the helper only for selector data, `thinkingLevelPins`, and `modelScopeWarnings` display.

### SSE reconnect on page refresh mid-stream
On `ChatWindow` mount, `GET /api/agent/[id]` is called. If `state.isStreaming === true`, SSE is reconnected automatically. `thinkingLevel` and `isCompacting` are also synced from this response.

### Compaction SSE events
Newer pi emits `compaction_start` / `compaction_end`; older versions emitted `auto_compaction_start` / `auto_compaction_end`. `handleAgentEvent` accepts both sets to keep `isCompacting` in sync. Manual compact is a blocking POST — the button stays disabled until the response returns.

### Running state polling + reconciliation
- The sidebar polls `/api/agent/running` every 2.5 seconds while the tab is visible and pauses polling in background tabs. The session-list response remains the initial fallback.
- `useAgentSession` treats per-session SSE as primary for chat events and opens it before each prompt. `prompt_done` completes the current UI stage and notification immediately, but the idle SSE stays open for a 30-second grace window and is reused by the next prompt. `agent_start` cancels that close timer; `agent_settled` finishes extension-injected runs that have no wrapper-level `prompt_done` and starts a fresh grace window. Do not close on the first `agent_end`: retries, compaction, and extension-queued messages can continue the same logical prompt.
- While a run is active, `useAgentSession` periodically calls `GET /api/agent/[id]` and also reconciles on `visibilitychange`/`online`. This fixes missed terminal events from background tabs or half-open connections.
- Prompt runs use a monotonic run id; late SSE or slow reconciliation responses from an old run must be ignored so they cannot resurrect stale streaming bubbles.

### Worktrees and project grouping
- `lib/worktree.ts` resolves linked worktree top-levels back to the main repo `projectRoot`; `listAllSessions()` attaches that to each `SessionInfo` so all worktrees for one repo are grouped together in the sidebar.
- Worktree operations are served by `/api/worktrees` and guarded by the same allowed-root rules as `/api/files`.
- New worktrees are created under `<repoRoot>-worktrees/<sanitized-branch>`. Existing branches are reused; otherwise `git worktree add -b` creates the branch.
- Removing a dirty worktree returns `409` with `{ dirty: true }` so the UI can ask before retrying with `force`.
- Sessions whose cwd points at a removed worktree are inferred back into the main project instead of becoming a phantom project row.
- git prints POSIX-style absolute paths even on Windows, so every path read out of git goes through `toNativePath()` (`lib/paths.ts`) before it is compared or returned. Compare paths with `samePath()`, never `===` — raw equality made `isTopLevel` permanently false on Windows and hid the worktree switcher entirely. Branch names are not paths and must keep their forward slashes. Browser code cannot apply Node path rules, so `/api/worktrees` resolves `currentWorktreePath` server-side; the sidebar must use that identity for highlighting and removal fallback.

### File access allow-list
- `/api/files` is intentionally not a general filesystem browser. Allowed roots come from session cwds, their resolved project roots, `~/pi-cwd-*`, and roots explicitly added with `allowFileRoot()`.
- `/api/cwd/validate`, `/api/default-cwd`, and `/api/worktrees` call `allowFileRoot()` when they make a new location browsable.
- `/api/files/...?sessionId=` also reads (never lists) a file outside the roots when that exact path appears in the session, so a chat link to it opens (`lib/session-file-references-core.ts`). Three things never count: transcript system messages (they carry every tool schema), `context_edit` replacements (the UI never shows them, and they often restate a tool result), and the result text of any tool other than pi's coding tools and the subagent tools — MCP and extension results relay text a remote party controls, so any string in it would become readable. Such a result still authorizes its `details.fullOutputPath` and the arguments of the coding-tool calls it made through `ctx.executeTool()` (`nestedCalls`); arguments of its nested MCP calls do not count, because a script hands one MCP result to the next call without the model reading it. User and assistant messages, the model's own tool call arguments (MCP calls included) and the other entries count as before. Tools are matched by name, so keep `CODING_TOOL_NAMES` in step with `lib/rpc-manager.ts`.
- Allowed roots are stored slash-normalized, but that is a Set-key convention, not a correctness requirement: `isPathWithinRoots()` (`lib/path-security.ts`, the single implementation behind `isFilePathAllowed()`) re-resolves and case-folds both sides, so either path form authorizes correctly. Keep that one implementation — it is the security boundary.

### File tree visibility (fork:file-tree-visibility, 上游 #1014 / 13bc2b0)
- 列表里「不显示什么」由 Git 决定，可见性**不是**授权：被隐藏的条目照样能按路径读到（`/api/files` 只按 allowed root 授权，从不看这个模块）。
- `lib/file-tree-visibility.ts` 先用一次 `git check-ignore --no-index --stdin`（全部条目名走 stdin，NUL 分隔，不经 shell，所以空格 / 中文 / 引号 / `-` 开头的名字都不会被当成参数或路径魔法），再用一次 `git ls-files --cached` 找出哪些被忽略的名字底下**有跟踪文件**——忽略对跟踪内容不生效，所以被跟踪的 `build/` 照常显示，被忽略目录里被 force-add 的文件也显示。
- **不要让 check-ignore 读索引**（不要去掉 `--no-index`）：它每个名字扫一遍索引，20 万文件的仓里 1000 条目的目录要 2.4s，然后就在 5s 超时上退回名字表。名字一律以 `./name` 送进 check-ignore（pathspec 魔法 `:(...)` 会让**整批**报错），送进 ls-files 时带 `--literal-pathspecs`（否则 `*.log`、`[id]` 会 glob 命中被跟踪的 `app.log`、`i`）。
- 两次调用都带 `-c core.fsmonitor=false`：读索引会执行「用户刚展开的那个仓」里配的 fsmonitor 钩子。名字表（`node_modules`/`dist`/`build`…）只在 Git 看不见时兜底——work tree 外、git 缺失 / 失败 / 超时，以及目录本身被忽略且底下无跟踪文件（否则 dotfiles 仓忽略 `*` 时临时目录会列成空）。
- 列表因此要**等 git**（每次判定 ≤5s，超时即降级）。`getFileTreeVisibility()` 接请求自己的 `signal`：浏览器中途离开就杀掉 git，不让它白等满 5s。同一个（目录 + 条目名集合）在途共用一次判定、结果缓存 1s——文件树每次目录变更都会重取所有已展开的目录，不合并就会 fork 出一串 git 进程；缓存键含条目名，所以新增条目立刻重判。
- `/api/file-index` 的 readdir 兜底复用同一个 `isHiddenOutsideGit()`，不再各留一份名字表（那条路由的 git 分支本来就走 `ls-files --exclude-standard`，注释里「Git-tracked repos rely on .gitignore」说的就是它自己）。

### 项目之外的符号链接目录（fork:linked-directory，上游 #1018 / 687af27）
- 克隆的仓库里常有指向项目外的符号链接目录。边界不动：**仓库内容不得自己放宽 roots**（否则一条提交的软链就能让 `~/.ssh`、`/` 变得可读）。这类链接照常列出来，但带 `outsideLinkTarget`（目标还包着项目或主目录时再加 `outsideLinkEncloses`）。
- 唯一的通路是操作员在文件树里点一次「允许浏览」→ `POST ?type=allow-link`（等价于他在目录选择器里选中那个目录，`/api/cwd/validate` 同等级）。`lib/linked-directory.ts` 把这一圈全部钉死：
  · 链接必须**直接**坐在解析后仍在 roots 内的目录里 —— 穿过另一条没放行的链接到达的，403；
  · `lstat` 必须是 symlink（Windows junction 也算）且目标是目录，否则 400/404；
  · 请求带的是**列表当时展示给操作员的那个目标**，realpath 变了就 409（界面提示刷新），不授权没人看过的目录；
  · 只 `allowFileRoot()` 这一个目标，不放宽全局 roots，进程重启即失效；每条链接各是一次独立的选择。
- 授权边界因此**只能一次性、绑定 realpath**。`hasParentDirectorySegment()`（`lib/path-security.ts`）在 `isExistingPathWithinRoots()` 里拒绝任何 `..` 分段：Node 的 `realpathSync` 先消 `..` 再跟链接，文件系统反过来，`root/link/..` 字典序上等于 `root`（授权通过）实际却打开链接目标旁边那一格。这条覆盖所有拿 cwd / 文件路径做授权的路由，fail closed。
- 界面用画板已有的 `.pw-perm` / `.pw-perm-title` / `.pw-perm-body` / `.pw-perm-acts` + `.pw-btn primary sm`（已登记在 board.css，画板 01 / 12 / 60 在用），**不新增 `.pw-*` 类**；包住项目/主目录时先 `.pw-alert` 警告再 `window.confirm`（与删除确认同一套交互）。目录展开失败也不再被吞掉，原因显示在该行下面。

### 调用轨迹与会话动作菜单（fork:trace-frame / fork:trace-menu）

用户 2026-10-02 定的两块形态，方案与取舍写在 `docs/trace-pane-and-session-menu-plan-2026-10-02.md`：

* **「调用轨迹」就是「完整历史」那一页，只是换了位置**（用户第二次裁定，推翻了先前的仿 ZCode 面板）：`components/TraceFrame.tsx` 用**同源 iframe** 装 `GET /api/sessions/<id>/export?inline=1`，装进右栏那个单例 `trace` tab。pi 自己导出的那页已经有侧栏树、搜索、五档过滤（Default / No-tools / User / Labeled / All）、可拖宽侧栏、可展开的工具输出 —— **不再另写一套转录渲染**。为此 `app/api/sessions/[id]/export/route.ts` 只对 `inline=1` 放宽嵌帧（CSP `frame-ancestors 'self'` + `X-Frame-Options: SAMEORIGIN`），**下载仍 `DENY`**。页头只加两枚钮：刷新（`nonce` 变一次重载 iframe）与全屏（`position: fixed; inset: 0` 铺满窗口，Esc 退出）。
* **入口不动**：顶栏那枚原「完整历史」图标钮（位置 / 图标 / `data-mobile-toolbar-action="history"`）打开这个 tab。导出 HTML / Markdown 在 ⋯ 菜单与侧栏行菜单里。
* **会话动作 ⋯ 菜单**（`components/fork/SessionActionsMenu.tsx`，走既有 `ContextMenuProvider`）：置顶 / 重命名 / 归档 / 标记未读 ‖ 在访达中打开 / 复制路径 / 复制会话文件路径 / 复制会话 ID / 前往配置 ‖ 调用轨迹 / 导出 HTML / 导出 Markdown。**重命名**=顶栏标题原地变输入框（`PATCH /api/sessions/<id]` + `refreshKey`）；**标记为未读**靠 `lib/session-unread.ts`（未读标记原来是 `SessionSidebar` 私有的 `useState`，外部点不到，抽成和 `lib/session-flags.ts` 同形状的 store）；**在访达中打开**走 `/api/files/reveal` 开**项目目录**（会话文件在 `~/.pi/agent/sessions` 下，不在 allowed roots，所以不 reveal 它），失败由 AppShell 里那条 3 秒的 `.pw-toast` 报出来。pi 没有的两个（ZCode 的「复制日志路径」「反馈问题」）不做。
* **「读数」与「动作」分开**：`SessionStatsDetails`（上下文环浮窗）只留读数（名称 / 活跃时长 / 消息计数 / Token / 费用 / 上下文 / 命中率），路径类动作全在 ⋯ 菜单里，同一件事只留一个入口。

### 手机与推送（fork:phone-push + fork:bot-channel + fork:im-bridge）

形态两次裁定，后者覆盖前者：先（2026-10-03 上午）参照 MusePi 的 `CollabDialog`（`pi参考项目/MusePi-main/packages/desktop-app/src/components/CollabDialog.tsx`）定了「一个分节，左栏扫码连接、右栏聊天 Bot」；同日用户拿 ZCode 参考项目（`pi参考项目/ZCode-main`）的 `WebRemoteControlDialog` 截图把形态拍细——**两栏卡**：左栏「手机扫码连接」（状态卡：状态名 + 「已就绪」徽标 + 停止钮，分隔线下是「无法扫码」兜底动作，下方虚线框里大二维码，`qrImage` 调用处 `scale: 8`），右栏「使用 Bot Channel」只摆**干净入口卡**（第三轮裁定，对照同一天的第二张截图：品牌 logo + 名字 + 站点角标 + 一句「从XX打开这个工作区」+ 「去 Bot Channels 配置」文字链 `.fork-linkbtn`，无状态点/缺项数/启停钮）；「机器人管理」与各卡链接打开**二级弹窗**（`components/fork/BotChannelsDialog.tsx`，对照 ZCode 的 `BotsDialog`：`.fork-bot-dialog*` 壳在 fork-ui.css，左列表=六渠道+推送入口、右详情=扫码/凭证/投递/启停分节卡，推送目标 `ImBridgeBody` 收进弹窗）。偏离与登记见 `DIVERGENCE.md` AG 节。

* **能直接迁移的只有形状，代码全部重写**。他们那套 = 自研 collab relay（明文 7654 + 自签 TLS 7655，`0.0.0.0`）+ 链接里拼 32B 房间密钥 + AES-256-GCM 信封 + 一个**无鉴权的 8301** 端口专门解析 6 位码。本仓是同源 HTTP，抄它等于自己写反向代理并顺手开一个裸奔端口，所以只抄语义：token 决定是否上网卡 / 6 位码换 cookie / 只读与完整两种链接。
* **令牌是应用自己生成的**（`lib/lan-access.ts` → `~/.pi/agent/lan-access.json`，0600），**第一次打开「手机与推送」即视为同意并现生成** —— 这是「打开就有二维码」的落点。启动器（`bin/lan-supervisor.cjs`，`npm run prod` 与 `bin/pi-web.js` 共用一份）盯着那份配置，**off→on / on→off 会自动重启子进程**，所以「启动/停止」是真开关，不用敲任何参数。
  · 换令牌**不自动重启**（会打断在跑的会话），只提示下次启动生效。
  · 换令牌 = 作废所有已发链接、已种 cookie 与只读链接。
* **绑网卡是启动器决定的，进程内改不了** —— 这是与 MusePi 唯一的结构性差别（他们 relay 由 daemon 另开 socket，才能「点一下立刻生效」），所以走父进程重启，三道护栏：去抖 500ms、同方向最多 3 次、每次打日志。`scripts/next-mode.mjs` 也必须接上（`npm run prod` 是日常入口，第一版漏了它导致日常入口下点了没反应）。
* **不变量**：(1) 没有令牌 / 令牌形状不对 / 文件坏了 → **只绑 loopback**（fail closed，绝不退回裸奔）；(2) `0.0.0.0` 不算 loopback；(3) 闸门只读 `Host`；(4) 换令牌时唯一免登录可达的路径仍是 `/api/lan/pair/redeem`，它自带失败节流（30 次/5 分钟）。
* **二维码是 vendor 的**：`lib/qrcode.ts` 逐字取自 MusePi 的 `packages/collab-proto/src/qrcode.ts`（MIT）。他们的测试向量**与 `qrcode` 参考库逐字节对拍并用 jsQR 真解过**，本仓 `lib/qrcode.test.mjs` 原样沿用 —— 所以这份 vendor 代码的可用性是「对拍过」，不是「看起来对」。静区在 `lib/qr-image.ts`（那里测得到），组件只涂 canvas。
* **入站渠道三条真跑通**（2026-10-03 起）：**Telegram**（`lib/telegram-channel.ts`，长轮询、零依赖）、**微信**（`lib/weixin-channel.ts`，挂在微信自家 **iLink bot 平台** `ilinkai.weixin.qq.com/ilink/bot`——扫码 `get_bot_qrcode?bot_type=3` 拿 bot_token，`getupdates` 长轮询收、`sendmessage` 发，零新依赖；这推翻了早先「个人微信没有任何官方 bot API」的结论）、**飞书/Lark**（`lib/feishu-channel.ts`，注册走 `accounts.feishu.cn/oauth/v1/app/registration` 的 device-flow 三步一键建应用——**不用预建应用**，收消息走官方 `@larksuiteoapi/node-sdk` 的 WSClient（在 runner 里**动态 import**，浏览器依赖图看不到），发消息走 REST `tenant_access_token`（缓存 90 分钟）+ `im/v1/messages`）。三者的协议全部**逐字对拍 ZCode 参考仓**（`pi参考项目/ZCode-main/packages/services/src/bots/`），协议纯函数（状态归一化、帧解析、请求形状）各有 `.test.mjs` 用 fetch 桩锁住。Discord 仍要 `ws` 进 dependencies；企业微信只有公网回调，不做。
* **扫码注册的在途会话**在 `lib/chat-channel-register.ts`（globalThis registry，同渠道一场、过期即废；`register-begin` / `register-poll` / `register-cancel` 三个动作挂在 `/api/bot-channel`）。二维码内容串由前端 `components/fork/QrCanvas.tsx` 画（与配对码共用一套涂格子代码，静区在 `lib/qr-image.ts`）。
* **白名单语义（扫码渠道）**：凭证只有扫码换来的 token，平台侧无签名校验——所以防线在本仓：**首个发信人自动绑定**（runner 把人 push 进内存白名单并回欢迎语，route 落盘），之后白名单外一律忽略；显式配了 allowFrom 就完全按名单来。微信的「首条消息只激活不进 prompt」同 ZCode。
* **微信游标**：`getupdates` 的不透明 `get_updates_buf` 落在 `~/.pi/agent/chat-channels-state.json`（0600，与凭证分开——丢了最多重放一批，凭证丢了要重扫码）；**每批处理完才推进**。`message_type === 2` 是自己的回显，必须丢弃，否则自问自答死循环。
* **渠道品牌 logo 是 vendor 的 PNG**（`public/channel-icons/`，取自 ZCode-main 的 `channel-icons`；lark 与 feishu 共用一张），`components/fork/ChannelIcon.tsx` 渲染、没有资源的渠道回落 lucide 名。这是对「图标一律 lucide」的**已登记偏离**（DIVERGENCE AG 节），别当成要修的漂移。
* **白名单默认空 = 谁都不许**：拿到机器人令牌的人不该顺手就能用你的模型额度和文件权限开 agent。
* **出站推送**（`im_send`，`lib/im-bridge.ts`）：飞书 / 企业微信 / 钉钉 / Slack / Telegram + 自建 webhook 五家同构（都是 POST 一个 JSON），认不出平台落 `custom` 原样 POST。
  · **飞书与钉钉的加签是镜像的**：飞书 key=`ts\nsecret`/message 为空/**秒**/字段在 **body**；钉钉 key=`secret`/message=`ms\nsecret`/**毫秒**/字段在 **query**/base64 后再 URL 编码。因此是两个具名函数，**不许合并**。
  · **企业微信群机器人没有加签**（官方页只有 IP 白名单），`needsImSecret()` 只有 feishu + dingtalk。长度上限只写文档写明的。
  · 凭证边界：URL 与 secret 都是凭证；配置 `~/.pi/agent/im-bridge.json`（0600）；`GET /api/im-bridge` 与 `im_send action=list` **只回 host + 掩码**；编辑时**字段缺失 = 沿用已存值**。
* **客户端与服务端必须拆开**：设置页是 `"use client"`，只能 import `lib/im-bridge-shared.ts` 与 `lib/chat-channel-shared.ts`；`lib/im-bridge.ts` / `lib/chat-channel.ts` 里的 `node:fs` + pi SDK 一碰客户端依赖图，`lib/client-graph-purity.test.mjs` 就红。
* **入口**：设置里的「手机与推送」分节，外加侧栏底栏版本徽章左边那枚手机钮（同一个分节，快捷入口）。导轨几何是画板 02 登记过的，所以手机钮是底栏里的**兄弟**而不是第五枚导轨按钮。

### 移动端壳与同步（fork:mobile-shell，2026-10-06）

形态与决策全文在 `docs/mobile-shell-plan-2026-10-05.md`（D1–D6），远程地址操作指南在
`docs/mobile-remote-setup.md`，iOS 自签在 `docs/ios-free-signing.md`。这里记不变量：

* **壳是独立子项目 `mobile/`**：自带 package.json（@capacitor 8.5.2 系），主仓
  tsconfig / eslint / 构建图**全部排除它**；主仓侧只有「服务器对端」的新文件
  （`app/api/sync/**`、`app/api/presence/**`、lib 少量新文件），不往 agent 逻辑里掺行。
  为什么不叫 `app/`：那是 Next.js 路由目录。
* **`server.url` 两种模式**：打包时 `PINEXT_SERVER_URL` 烘焙稳定地址（推荐 Tailscale
  `http://100.x.y.z:30141`，host-only cookie 配对一次永久有效）；不设则走跳板页
  （`mobile/webDir/index.html`，localStorage 记地址 + getUserMedia/jsQR 扫桌面二维码）。
  **quick tunnel 的随机域名不可用**（域名一变 cookie 全失配，D3）。
* **跨源裁定**：壳的本地页（capacitor://localhost）fetch 服务器是跨站、SameSite cookie
  不带 —— **所有服务器抓取都在远端源（PWA）做**，经 Capacitor Filesystem 插件写进
  `Directory.Data`；本地页 `mirror.html` 只经桥读文件。Filesystem/LocalNotifications/
  Badge/App 全部走 `nativePluginCall`/`nativeCallback` 低层通道，主仓零 @capacitor 依赖。
* **同步协议 = 字节游标**：`.jsonl` append-only，`/api/sync/manifest` 给
  (sizeBytes, mtimeMs) 版本对，`/api/sync/session/[id]/entries?offset=` 增量；
  **offset > size = 文件被整写**（级联改父/pi 迁移）→ `reset:true` 全量重发；
  游标只落完整换行（UTF-8 多字节安全，见 `lib/session-sync.ts`）。离线阅读载体是
  缓存的 `export?inline=1` 自包含 HTML（jsonl 是 Phase 2 上推与本地渲染的权威）。
* **通知两层**：壳内走原生本地通知（WebView 没有 Web Push subscription；App 进程
  活着才响，被杀场景走 IM 桥）；Web Push（浏览器 PWA）发不发由
  `lib/notification-plan.ts` 的**在场裁决**决定 —— 判据是用户最近 180s 内有无**交互**
  （不是「标签页活着」），有交互就不推（未读点/完成音已是在场提醒）。
* **Android 安全区**：WebView 的 `env(safe-area-inset-*)` 不生效（三份独立证据），
  全仓收拢成 `globals.css :root` 的 `--safe-*`，壳里由 `InsetsPlugin.java`（状态栏/
  导航栏 insets → dp）经 `applyShellInsets()` 覆盖。`MainActivity.java` 的两个坑：
  `registerPlugin` 必须先于 `super.onCreate()`；edge-to-edge 要在
  `onWindowFocusChanged` 里**再断言一次**（Android 12+ SplashScreen 会恢复 decor-fit）。
* **browser-notifications 必须零相对导入**：普通 `node --test` 解析器跟不了扩展名省略
  的相对导入（本仓测试直接 strip-types 跑 TS）。壳的通知层用注册式接入
  （`setMobileNotifyProvider`），不许改成 import 式。
* **自建中继（出门访问）**：中继 = `relay/deno/relay.ts`（Deno Deploy 单文件，`RELAY_TOKEN` 注册鉴权，
  只做字节搬运、不落盘、不做应用层鉴权）；Mac 拨号端 = `lib/relay-dialer.ts`（进程内随
  instrumentation 自启，配置 `~/.pi/agent/relay-link.json` 0600）。**三条不变量**：① Mac 主动拨出，
  家里设备永不监听公网；② Host 重写成中继 host + `x-forwarded-proto`，并把 host 运行时追加进
  `PI_WEB_ALLOWED_HOSTS`（名单每请求现读，免重启）——同源校验靠 `isProxyRewrittenSameOrigin`；
  ③ 拨号端向上游取 `accept-encoding: identity` 并剥掉响应的编码类头——undici 自动解压 body 但保留
  `content-encoding` 头，原样转发会让手机侧对明文再解压一次（冒烟实测卡死）。全链路冒烟：
  `npm run relay:smoke`（deno 起中继→真拨号→JSON/HTML 流式/带 body POST/断开 502）。
  部署步骤见 `relay/README.md`。
* **Phase 2（未做）**：手机独立 runtime（Android proot+Alpine+node+pi，借鉴 Aether 的
  集成形状；GPL-3.0 代码不可抄，APK 挂 Release 分发需附 GPL 组件源码指引）、
  `POST /api/sync/session/[id]/append` 上推回流、本地渲染层。

### agent↔agent 通信（fork:agent-mail）

`lib/subagent-mail.ts` 是进程内信箱（`send` / `peek` / `drain` / `waitFor`，每箱 50 封 FIFO），`lib/subagent-runtime.ts` 的 `deliver()` 负责唤醒活着的会话（`sendCustomMessage` + `deliverAs:"followUp"`），工具面是**一个** `agent_mail`（`action: send | inbox | wait`，`to: "parent" | "all" | <id>`）。三个已有工具只能「父 → 子」，这一个把方向补全（子→父 / 子→兄弟 / 父→全体）。

* **`agent_mail` 刻意不进 `SUBAGENT_CONTROL_TOOL_NAMES`**：那个名单是「不许再委派」的控制工具（spawn 时被 `excludeTools` 排除，也进不了 profile 工具白名单）；它是同伴工具，`withSubagentExtensionTools()` 会把它并进每个子代理的工具集 —— 那正是它存在的意义。
* 信箱**先落**再 `deliver()`：会话当下不可用（已结束 / 被回收）时信也不丢，`inbox` / `wait` 照样读得到，返回值如实说明「kept in the mailbox」。
* 它**不进** `lib/session-file-references-core.ts` 的受信工具名单：信箱是旁路通道，不给它新增「消息里提到的路径可被读」的授权面。

### Plugins and skills
- `/api/plugins` uses pi's `SettingsManager` + `DefaultPackageManager` for global/project package install, remove, update, enable, and disable. Disabling writes empty `extensions/skills/prompts/themes` arrays for that package entry.
- `/api/skills` uses `DefaultResourceLoader` so settings paths, package skills, and project `.agents/skills` are listed the same way the runtime sees them.
- Skill toggling edits only the `disable-model-invocation` frontmatter key on the target `SKILL.md`; keep that surgical so user formatting survives.
- `/api/skills/install` shells through `npx skills add ... --agent pi`; project installs run with the selected cwd.

### 一方扩展的注册 ≠ 模型看得见（fork:proma-37~53 的共同教训）

`extensionFactories` 里注册了扩展，**编译过、单测绿、画板对位过，都不能证明模型用得上这些工具**。

本仓的一方扩展形状是 `{ name, hidden: true, factory }`：`hidden: true` 意味着工具
**不自动进 `get_tools`**，要靠会话创建时的 `toolNames[]` 过档（`withExtensionTools()`，
`lib/rpc-manager.ts`），而 model-only 曝光由 pi 在 prompt 期决定。**中间任何一环没对上，
模型就是看不见** —— 而这在编译期和单测里都是绿的。

唯一的验证方式是运行时：

```bash
# 起一个独立端口的服务（别抢主仓 30141）
ln -sfn <repo>/node_modules node_modules
node_modules/.bin/next build --webpack && node_modules/.bin/next start -p 30247
# 拿一个真实会话 id，问它要工具清单
curl -s -X POST -H 'content-type: application/json' -d '{"type":"get_tools"}' \
  http://127.0.0.1:30247/api/agent/<sessionId>
```

`data` **直接是工具数组**（不是 `{tools:[...]}`）。2026-10-02 用这招实测确认
browser 10 + terminal 4 + document 11 = 25 个工具在运行时全部真的露给了模型。

**推论**：新增一方扩展的 DoD 里，「工厂函数形状」的单测不够，必须补一条运行时验证；
CI 里如果跑不了，就把工具名清单写进 `SHORTCUT_COMMANDS` 那样的可读表里，至少让人能一眼核对。

### 产品能力不许降级成 skill（fork:proma-00-skill-policy）

参考项目 Proma 的 17 个内置 skill 里，`automation` / `in-app-browser` / `agent-collaboration` / `knowledge-maintenance` / `writing-plans` / `docx` / `pdf` / `xlsx` / `pptx` 这九条**在 Proma 全是一方代码 + 注册给模型的真实工具**（22 个 `Browser*`、11 个委派工具、7 个 automation 工具、`file-preview-service.ts`），skill 只是挂在工具上面的一层提示词。**照抄目录 = 把产品功能降级成「模型可能想起来读、也可能不读的 markdown」**，五条后果同时发生：

- **不保证发生** —— 工具注册了就一定在模型面前；skill 靠模型自己想起来加载。
- **界面里看不见** —— 用 skill 只是消息流里一条 tool call，没有状态、没有进度、没有可点的入口。
- **拦不住** —— `tool_call` 审批引擎（`lib/approval-policy.ts`）拦的是**工具**，不是 skill；skill 里写着的 Bash 照样直接跑。
- **没法度量** —— 没有工具名就没有 token 统计、没有 session 列表旁证。
- **模型换了就失效** —— 提示词工程的产物绑死在特定模型的行为上。

**动手前先分类**，别先想「写个 skill 多快」：
- 要读写文件 / 调 API / 起进程 / **改状态** ⇒ **工具**（`lib/<name>-extension.ts` 一方扩展），skill 最多当使用说明
- 要用户**看到、点到、审批** ⇒ **工具 + UI**，skill 无权替代
- 纯知识 / 纯写作 / 纯方法论**且不碰任何状态** ⇒ 才轮得到 skill；用户自己领域的内容（标书、小说）也**不进** `assets/default-skills/`

**本仓现状不用改，这就是要保持的形态。** 有状态的能力已经全是工具：`lib/subagent-extension.ts`（`Agent` / `get_subagent_result` / `steer_subagent`）、`lib/todo-extension.ts`（`todo`）、`lib/approval-extension.ts`、`lib/plan-mode-extension.ts` —— 都在 `lib/rpc-manager.ts:2417` 的 `extensionFactories` 里注册，工具名进 `get_tools` 清单、并随会话创建时的 `toolNames[]` 过档（`withExtensionTools()`，`lib/rpc-manager.ts:243`），所以可拦、可统计、有 UI。`assets/default-skills/` 只有 `guizang-ppt-skill`（靠 CLI 工具链出片）和 `skill-creator`（只产 markdown）两个，**都通过判定，保持现状、不要再加**（许可表与升级方式见 `assets/default-skills/README.md`，真实资产门禁在 `lib/default-skills.test.mjs`）。新增能力的落点是 `lib/<name>-extension.ts` + 一行注册 + `.test.mjs`，不是新的 skill 目录。

**新增任何能力先答三问**（写进 PR 描述，答不出「是」不许合）：
1. 这个能力改状态吗？ → 改 ⇒ 必须有**工具名**（可拦、可统计、可审批）
2. 用户能从界面看到它发生吗？ → 看得到 ⇒ 必须有 **UI 组件**，不能只有消息流里一条 tool call
3. 它是提示词还是代码？ → 提示词 ⇒ 证明它**不碰任何状态**，且不是某条已有工具的使用说明

完整判定表与逐条依据见 `docs/proma-borrowing-plan-2026-10-02.md` §0.4。

### Built-in subagents
- The global `builtInEnabled` switch is persisted in `~/.pi/agent/agents/settings.json` and defaults to `false` when the file or field is absent. Malformed settings fail closed; atomic updates preserve unknown fields.
- The inline built-in extension factory is always present so reloading an existing wrapper can apply setting changes, but it registers no tools while disabled. After changing the switch, the user must explicitly reload the current session.
- When enabled, only a recognized legacy `pi-subagents` extension that registers any reserved tool (`Agent`, `get_subagent_result`, or `steer_subagent`) is removed. Unrelated extensions remain loaded, and resolved conflict diagnostics are discarded.
- Runtime `Agent` dispatch checks the setting again so a stale tool call cannot start a subagent after the feature is switched off.
- See `docs/adr/0003-built-in-subagent-toggle.md` for the precedence and persistence rationale.
- Agent profile files (`~/.pi/agent/agents/*.md`, project `.pi/agents/*.md`) are shared with other runtimes, so a save round-trips the frontmatter keys this app does not own (`name`, `allowed_subagents`, `exclude_extensions`, `disallowed_tools`, …) and carries foreign `ext:` tool selectors through. Managed keys are exactly `description`, `display_name`, `tools`, `load_skills`, `load_extensions`, `enabled`, `inherit_context`, `run_in_background`, `model`, `thinking`, `max_turns`.
- The `skills` / `extensions` spellings pi-subagents reads are seeded on first save and kept in step while they are booleans; a hand-authored whitelist such as `extensions: pi-advisor-flow` is never rewritten, and the two flags fall back to those aliases when `load_skills` / `load_extensions` are absent.
- An `ext:<name>` selector is resolved against names derived from the loaded extensions (parent directory, file basename, and for package resources the npm source name plus that name without its scope), not by string equality on what the profile says (`lib/subagents.ts`). A name claimed by more than one *source* is not addressable, `local` / `auto` are never names, and matching takes the longest name — so an alias or an npm scope spelling cannot slip past the `disallowed_tools` deny list, which resolves against the very same names. The parse-time filter in `parseProfileFile()` only normalizes spellings; `disallowedExtensionTools` carries the raw deny selectors to `selectSubagentExtensionTools()` at spawn time, where the loaded extensions supply the real tool names.

### MCP 运行时（fork:pr11-mcp + fork:mcp-primitives，上游 85f9cb1 + 上游 `docs/adr/0006-mcp-and-code-mode.md`）
- **配置面已换成 pi 1.0 官方原语**（`1e4dbac0`）：`lib/mcp-config-file.ts` 的读/写/删/改走 `loadMcpConfig` / `add|update|removeMcpServerConfig`，外面仍包着自己的不变量（同目录 0600 staging + `renameSync`；解析失败只回 `malformed JSON`，绝不让 V8 的 parser 文本回显文件内容）；`lib/mcp-validator.ts` 改调 `validateMcpServerConfig`（**不再真连握手**，socket / legacy SSE 被拒，校验失败 400 不写）；`lib/mcp-auth-command.ts` 走 pi 的 `/mcp login` + `signInMcpServer` / `McpOAuthCredentialStore`。`app/api/mcp/route.ts` 是浏览器唯一入口，**响应形状与状态码一个都没变**，只把内部换成转发。
- `lib/mcp-discovery.ts` **保留**：从 Claude Code / Codex / Cursor / VS Code 的配置里发现已配 server 并合并，是 pi 完全没有的能力，换掉 = 删功能。
- pi 的内置 `mcp` 扩展**包不导出**：SDK 根只给 `createMcpExtension` 工厂，连接类 `McpServerConnection`、stdio transport、`mcp.json` 编辑器、OAuth 助手都是内部件。`lib/pi-sdk-internals.ts` 按 file URL 从**本进程跑的那份 SDK** 加载它们（否则 `instanceof` 对不上，server 的 stderr 会丢），并在三处拒绝重复副本：`PI_PACKAGE_DIR`、realpath 不一致、第二份 SDK / 第二份 pi-mcp。`globalThis` 缓存，一个进程只加载一次。
- `lib/mcp-transport.ts` 是 env 清洗：stdio server 继承的是 `process.env`（含 `PI_WEB_PASSWORD`），SDK 默认 transport 原样传；本仓 `inheritEnv: false` + 洗过的环境（`PORT` / `NODE_ENV` / `NEXT_*` 由 `lib/project-command-env.ts` 洗，`PI_WEB_PASSWORD` 在 mcp 文件里自己洗，等 G7 裁定后两处应合并），引用 `PI_WEB_PASSWORD` 的条目一律拒。**任何情况都不回退到 SDK 默认 transport**。
- 接线在 `lib/rpc-manager.ts` 的 `extensionFactories`：`...mcpBuiltinExtensionEntries()`，名字必须是 CLI 的 `mcp`，`DefaultResourceLoader` 才按 `builtin:mcp` 解析（实测 0.99.1 下 `loader.getExtensions().extensions[0].path === "builtin:mcp"`）。SDK 不具备 MCP 时返回空数组并打一行日志；本仓现在是 1.0.0，走真身那一条。
- **运行时已通电**（`42f96a70`），ADR 0006 的两个坑这样处置：
  · **fan-out**：`createMcpSessionLivenessGate` 复用空闲回收那一份 session-liveness 租约 —— 只有浏览器真的在看这个会话（SSE 租约）才放行；`get_tools` / 自动命名 / SSE 预热建出来的 wrapper 一个进程都不起。等待有 10 分钟上限（与默认空闲回收同档）、timer unref、可被 dispose 中止。
  · **stop**：`startupWaitMs: 0` 绕开 `before_agent_start` 那段「最多等 10s 且不认 abort」的等待；`tool_call` 侧的等待用 SDK 自带的 `ctx.signal`。
  · **env**：见上一条。
  · **exposure 原样透传**（fork:mcp-native-exposure，2026-10-02）：pi **1.0** 已公开导出 `createCodemodeExtension` / `createToolSearchExtension`（`dist/index.d.ts:29,33`），本仓在 `extensionFactories` 里把它们与 `mcp` 一起注册（`mcpDiscoveryExtensionEntries()`，名字取 CLI 的 `codemode` / `tool-search`）。两枚工具**注册但不激活**，由 mcp 扩展在「真有 server 用到该曝光」时自己打开（`extensions/mcp/index.js:352-378`，按工具形状探测，不依赖注册名）。因此 exposure 语义回到 pi 原生：默认 `codemode`（工具不进模型工具表，脚本里 `searchTools()` 找）、`deferred` 走 `tool_search`、`hidden` 撤回。**降级逻辑没有删，只是变成按能力选**：SDK 拿不到这两个导出时 `loadConfig` 仍把 `codemode`/`deferred` 落成 `direct`（见 `normalizeMcpConfigForPiWeb` 的 `nativeExposure`）。这些都是运行时适配，**不落盘、不改用户的 `mcp.json`**。
  · **`/mcp` 已经能用**（同一次发现）：mcp 扩展自己 `pi.registerCommand("mcp", …)`（登录 / 登出 / 重连 / 开关 / 改 exposure），本仓加载它即带上了这个命令。
  · **`updateConfig` 接管落盘**（fork:mcp-auto-reload / P0-3）：`/mcp` 改 `enabled`/`exposure` 时不再由 pi 直接改文件，走本仓的 0600 + staging 原子写（`lib/mcp-config-file.ts` 的 `applyMcpServerPatch`，由 `rpc-manager.ts` 注入以避开循环 import）。`scope === "extension"` 的 server 按 pi 的约定不落盘。
  · **改完配置自动重载会话**（fork:mcp-auto-reload / P0-2）：`/api/mcp` 六个写动作与连接目录都调 `requestMcpReload(cwd)`（global 改动 = 所有会话，项目级只影响本工作区）；**空闲的立即 `AgentSession.reload()`，正在跑的只登记、等 `finishPrompt()` 再重载**（中途 reload 会换掉工具表、打断 turn）。结果 `{reloaded, deferred}` 回给浏览器给一行反馈。
  · 仍然**没有** per-prompt 的 `McpHost`：连接在浏览器会话打开期间常驻，靠 wrapper 空闲回收关闭。
- 远程部署仍要单独处理：OAuth 回调只听 `127.0.0.1`；`.pi/mcp.json` 靠目录信任继承；除 host-only 名单外的宿主环境变量仍会传给子进程。
- 契约测试 `lib/pi-sdk-internals.test.mjs` + `lib/mcp-transport.test.mjs`：SDK 不具备 MCP 时**跳过并打印原因**（`t.skip`）；SDK 1.0.0 下实测 **29 条 0 skipped**。跑法：`node --experimental-strip-types --test "lib/pi-sdk-internals.test.mjs" "lib/mcp-transport.test.mjs"`。

### Auth and model config
- `ModelsConfig` combines models from `~/.pi/agent/models.json` with provider auth status from pi's `AuthStorage`/`ModelRegistry`.
- Provider listing is capability-driven, never id-driven: `lib/provider-listing.ts` decides membership from `auth.apiKey.login` / `auth.oauth` plus the stored credential type, so dual-auth providers (anthropic and github-copilot today — which providers declare both changes between SDK releases, so never assume it from an id) appear exactly once and never fall through both lists (#309). `lib/provider-listing-runtime.ts` adapts `ModelRuntime` to those pure helpers.
- auth.json holds **one** credential per provider and `ModelRuntime.logout()` deletes whichever it is. The delete routes therefore use `removeStoredCredentialIfType()` to compare and delete under the same file lock used by pi's auth storage. `ModelsConfig` also refreshes *both* provider lists after any auth change — refreshing one leaves a dual-auth provider rendered twice.
- OAuth/device-code/manual-code flows are streamed by `GET /api/auth/login/[provider]`; manual code responses POST back with a short-lived token stored in `globalThis.__piLoginCallbacks`.
- API-key routes store and remove keys through `AuthStorage`. Status endpoints must never return the raw key.
- The model test route is `app/api/models-config/test/route.ts`; `app/api/models/test/` is not a real route.

### Completion sound
- `hooks/useAudio.ts` stores the toggle in `localStorage` as `pi-sound-enabled` and reuses one `AudioContext`.
- Browser autoplay policy means sound must be unlocked from a user gesture; `ChatInput` calls the unlock hook from interactive controls, and `ChatWindow` plays the tone from `onAgentEnd`.

### Exported session HTML
- `/api/sessions/[id]/export` delegates to pi's export helper, then patches recursive tree helpers in the generated HTML to iterative versions so very deep linear sessions do not overflow the browser call stack.

### 旧 Safari / iOS 16.2（#753）

`/` 完全在客户端渲染，所以**一个浏览器解析不了的 script chunk 就是白屏**，而不是某个功能坏掉。三处都要修：

- **不许写 RegExp lookbehind**（`(?<=` / `(?<!`）：Safari 16.4 以下解析不了，一个正则**字面量**解析不了就是整个 chunk 的 SyntaxError。改法是 sticky(`y`) 扫描 + 在起点处自己判边界：`lib/markdown.ts` 的 `replaceNotPrecededBy()`、`lib/mention-tokens.ts` 的 `tokenizeMentions()`、`lib/step-categorizer.ts` 的命令切分都是这个路子。`lib/no-regex-lookbehind.test.mjs` 全仓扫描守着这条（注释与 loader 除外）；测试里可以把 lookbehind 版本当**参照实现**留着对比，Node 能解析。
- **依赖里的 lookbehind 换不掉**：SWC 不能降级 lookbehind，而 `mdast-util-gfm-autolink-literal@2.0.1`（remark-gfm 依赖）的 email 正则就带一个（上游明确不改）。`lib/gfm-autolink-email-loader.cjs` 把该字面量替换成运行时 `new RegExp(...)`（失败再退回 2.0.0 的无 lookbehind 版），在 `next.config.mjs` 的 `turbopack.rules` 与 `webpack()` **两边**都注册（dev 走 Turbopack、`npm run build` 走 webpack；只挂一边时 Next 16 会让 `next dev` 直接退出）。上游正则一变，loader 就抛错让构建失败。
- **`static {}` 块**：Next 16 默认按 Safari 16.4 编译，`next/dist/client/components/error-boundary.js` 里就有一个 `static{`，16.2 会报 “Unexpected token '{'”。`package.json` 的 `browserslist` 把 safari / ios_saf 降到 16.2 让 SWC 降级它；**其余条目保持 Next 默认值**（`node_modules/next/dist/shared/lib/modern-browserslist-target.js`）。其它 node_modules 保留各自发布的语法，所以 mermaid 与 `@mermaid-js/parser`（懒加载图表 chunk 里约 270 个 static 块）写进 `transpilePackages`。

验证手段：loader 的 transform 函数直接跑单测（断言输出里剩下的 `(?<=` 只在 `new RegExp("…")` 的字符串里），比跑一次 build 更直接。**真机 Safari / iOS 16.2 与 Playwright WebKit 尚未验证**。

### 桌面端打包（macOS 通用包 / Windows 安装包）

* **通用包**：`electron-builder --mac dir --universal` 先各打一份 x64/arm64 再 lipo 合并。 合并必须声明 `build.mac.x64ArchFiles = "**/Resources/app/node_modules/**"`：node\_modules 里 平台预编译产物（node-pty/esbuild/pi-tui 的 `.node` 与 `spawn-helper`）在两架构包里字节相同， 不声明会直接报 `same in both x64 and arm64 builds` 并中止。

* `mac.files`**&#x20;/&#x20;**`win.files`**&#x20;是替换而不是叠加主文件匹配器**：写了等于通用 `files` 全部失效 （表现：docs、参考项目被一起打进包，甚至因断链符号链接报 ENOENT）。平台级差异只能写进通用 `files`。

* `.gitignore`**&#x20;不参与打包**：`设计风格/`(66M)、`pi-codex-release/`(43M)、`pi-web-pr-inbox/` 必须在 `build.files` 里显式排除，否则每个包装进 113M 垃圾。

* `next.config.mjs`**&#x20;不能改回&#x20;**`.ts`：TS 配置会让 `next start` 运行时需要 `@next/swc-*`，而 npm 只装 构建机架构那份 → Intel/Windows 包启动时联网下载（离线直接挂）。保持 mjs 后可整包剪掉（-40M）。 剪掉 `@img/sharp-*` 同理安全（应用代码不 import，实测 `/_next/image` 仍 200）。

* **Electron Framework 的 85 种&#x20;**`locale.pak`（每个 524K）在框架 Resources 里，`electronLanguages` 管不到它，要自己删；只留 en/en\_GB/zh\_CN/zh\_TW 等十种。

* **打包构建必须走项目自己的 build 脚本**（`npm run build` = `next build --webpack`）：裸 `npx next build` 在 Next 16 是 Turbopack，会把 serverExternalPackages 外部化成 `.next/node_modules/<pkg>-<hash>` 副本、并给每条路由写 5M+ 的 `*.nft.json`——v0.1.8 DMG 从 218M 涨到 380M 就是技能脚本裸跑 Turbopack 造成的（pack-mac-dmg.sh Step 2 已改为优先项目 build 脚本）。

* **`.next/node_modules` 哈希副本不进包，以符号链接注入**（`scripts/after-pack.mjs`）：electron-builder 不带符号链接打包，files 的 `node_modules/**` 规则罩不到 `.next` 下面，把解引用副本 cpSync 进包等于双份 pi-coding-agent（+400M）。副本与顶层包**逐字等价**（文件清单 diff 验证，只多 8 个 `.bin` 垫片），所以剥掉 `-<16hex>` 哈希后缀 `symlinkSync` 到产物自带真包即可，真包缺失才退回复制；`build.files` 里 `!.next/node_modules/**` 让副本根本不进包。`mac.x64ArchFiles` 因此多了 `**/Resources/app/.next/node_modules/**`（universal 合并要求两架构同文件都要声明）。

* **嵌套 `@esbuild/*` 按目标平台裁剪**（afterPack）：pi-coding-agent 内嵌全部 26 个平台二进制（~250M），运行时只加载本平台一块；`build.files` 只排除顶层 `node_modules/@esbuild/**`（同一份清单还要打 win 包，平台裁剪只能放 afterPack，按 appOutDir 目录名后缀判定，认不出就不裁）。

* **`*.nft.json` 是纯打包垃圾**：Next 文件追踪清单只在 standalone 拷贝阶段用，运行时不读；Turbopack 产物里每条路由 5.5M（0.1.8 实测占 280M）。`build.files` 已排除 + afterPack 与 `--prune` 双保险。

* 体积基线：app 756M → 通用 DMG **191M**（ULMO）；Windows nsis **144M**。大头是 Electron 框架 （双架构 418M，单架构约 208M），再小只能改成 Next standalone 输出。v0.1.8 复盘：技能脚本裸跑 Turbopack 让 arm64 DMG 涨到 380M（app 1.3G）；改回 webpack 构建 + afterPack 符号链接注入 + esbuild 平台裁剪后 **arm64 DMG 116M**（app 323M），低于 0.1.7 的 218M（见 git log fork:pack-size）。

* 打包后必做三件事：`env -u ELECTRON_RUN_AS_NODE` 启动冒烟（`/api/home` 200）、`hdiutil verify`、 以及**真 Electron 窗口里的点击验证**（顶栏按钮是否被 `.desktop-drag-handle` 盖住—— 手柄是绝对定位元素，会绘制在 static 按钮之上，详见 `app/fork-ui.css`）。冒烟不必退出正在使用的正式实例：`electron/main.js` 支持 `PI_WEB_USER_DATA_DIR` 覆盖 userData（单实例锁按 userData 路径判定），打包技能 Step 6 自动走它。

## Pi Session File Format

Location: `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`

```jsonl
{"type":"session","version":3,"id":"<uuid>","timestamp":"...","cwd":"/path","parentSession":"/abs/path/to/parent.jsonl"}
{"type":"model_change","id":"<8hex>","parentId":null,"provider":"zenmux","modelId":"claude-sonnet-4-6","timestamp":"..."}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"user","content":"..."}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"assistant","content":[...],...}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"toolResult","toolCallId":"...","content":[...]}}
{"type":"compaction","id":"<8hex>","parentId":"<8hex>","summary":"...","firstKeptEntryId":"<8hex>","tokensBefore":N}
{"type":"session_info","id":"...","parentId":"...","name":"user-defined name"}
```

`entryIds[]` in `SessionContext` is a parallel array to `messages[]` — maps each displayed message back to its `.jsonl` entry id, used for fork and navigate\_tree calls.

***

## CSS Variables (`app/globals.css`)

```
--bg --bg-panel --bg-hover --bg-selected --border
--text --text-muted --text-dim
--accent --user-bg --tool-bg
--font-mono
```

### 设计系统：V5 是唯一真值（design/v5，2026-10-04 起）

**新代码只写 V5 的类**：`d-*`（Web，`design/v5/web/system.css`）与 `m-*`（PWA，`design/v5/pwa/system.css`）。
旧的 `pw-*` / `fork-*` / `--n-*` / `--ds-*` 属于 **v1–v4 历史层**，只许维护不许新增；
改动产品样式时，**照 `design/v5/` 的画板抄 DOM**，不要照着旧 `pw-*` 继续加。
理由与证据见 `design/v5/LANDING.md §0`：历史上三次落地失败（两套 DOM / 加类不换 DOM / 两个令牌文件），
编译器、单测、人眼评审**全都绿**，因为缺的是仲裁者。

* **结构**：`base.css`（角色令牌 + 13 组共享动效关键帧）· `web/{tokens,system}.css` · `pwa/{tokens,system}.css`
  · `web/boards/*.html`（桌面 1440×900）· `pwa/boards/*.html`（手机 390×844）· `assets/demo.js`（12 类声明式交互接线）
  · `README.md`（画板清单）· `LANDING.md`（**落地契约，常驻**）· `DIVERGENCE.md`（抄了什么 / 不抄什么）
* **两条形态刻意不同名**：Web 只挂 `base.css + web/`，PWA 只挂 `base.css + pwa/`；
  同时挂两套 = 类名冲突 + 令牌覆盖，就是老问题换名字再来一次
* **四条门禁（都可复算，不靠人记）**：
  - `npm run design:v5` —— 静态：未定义令牌 / 未定义类 / 前缀混用 / 图标名 / emoji / 内联设计值 / **比例令牌带单位**（v4 基座就中过这条，六档字阶静默全死）
  - `npm run design:v5:land` —— **落地清单**：每张画板哪些类还没进产品（这就是「我说一句话就启动全部改版」的数据源）
  - `npm run design:v5:shots` —— 真浏览器逐张出图 + **每个交互件真点一遍**（要 `cd design && python3 -m http.server 39411`）
  - `node scripts/board-diff.mjs <spec>` —— 画板 vs 产品逐选择器对几何（spec 的 `board` 可写 `v5/web/boards/…`，三代画板同一通道）
* **触发口令**：用户说「按 v5 设计落地 / 启动改版 v5」→ 先读 `LANDING.md`，再跑 `design:v5:land` 拿清单，逐项走四步法，每项过六件套验收
* **BoardUI 采纳清单**（MIT，抄规格不抄实现）在 `design/v5/DIVERGENCE.md §A`：采纳 11 组动效关键帧 +
  输入框环绕光带 + 四态思考指示器 + 行展开收起；**拒绝** Tailwind v4 / React Aria / 它的 400 令牌 —— 引入即多一套样式来源

* **颜色链路**：`design/pi-web-design/assets/tokens.css`（规范真值）→ `app/design/tokens.css`（`--ds-*` 逐值副本）→ `globals.css` 末尾 `fork:boardui-bridge` 块（把 `--bg/--text/--accent` 等 Zeno 槽位指向 `--ds-*`）。**新代码写 `var(--bg)` 这类 Zeno 名**，不写 hex。
* **CSS 引入顺序**（`app/layout.tsx`）：katex → tokens.css → `app/design/tokens.css` → globals.css → settings.css → wallpaper.css → **board.css（画板原件，刻意在产品样式之后）** → fork-ui.css（永远最后）。产品要覆盖画板用 0-2-0 双类（`.chat-input-shell.pw-composer`），并注明为什么。
* **第〇原则：禁止截图模仿**。改组件 = 打开定义它的画板 HTML，原样复制那段 DOM（类名/层级/`<i data-ico>`），再接产品数据与事件；计划与验收协议见 `docs/design-skin-swap-plan-2026-09-29.md`（SW-00~17 批次 + 陷阱清单 + 组件矩阵）。
* **判据⑦**：新 `pw-*` 类必须先进 `board.css` + 出现在至少一张画板 + 记进 `DIVERGENCE.md`；产品 CSS 不许另起同名 `pw-*` 类（fork-ui.css 里只留「UA 归零 / cursor / 窄屏 / 滚动」行为钩子，带注释）。
* **对比度门禁**：改任何前景/背景色后跑 `node docs/codex-skin/check-contrast.mjs`（需服务在 30141）。
* **主题只剩 light / dark / auto**；`lib/theme.ts` 的 `THEME_OPTIONS` 是唯一清单。字体 Geist + Geist Mono（`next/font/google`，中文回退 Noto Sans SC/PingFang SC）。
* **圆角 3/4/6 三档**（`--radius-3/4/6`，板面/弹层 6），控件高度 24/28/32；字阶五档 11/12/13/15/20；动效十一项 token（`--motion-*`，唯一曲线 `--ease`）。
* **门禁**：`npm run check:design`（style-literals + motion-tokens + icons + check-boards + check-align）；`npm run check:contrast`；`npm run verify:boards`（需 prod 起服）。改组件时同步跑。
  * **结构层才是漂移的来源**（2026-09-30 加）：颜色有对比度门禁守着，而「按钮/位置与画板不一样」全部是结构层的事。两条新闸：
    ① `check-style-literals` 新增 `inline-geometry-literal`（内联样式里写死的 `gap/width/height/margin/padding/top...` 数字）；存量 **198 处**冻结在 `scripts/style-literal-baseline.json`（**只许变少**，新增即失败，清理后跑 `--update` 收窄）。已清掉 109 处（307→198）：能等值换 token 的都换了（间距 `--s1..--s6`、控件 `--control-*`、图标 `--icon-*`），像素不变；剩下的多是面板/树列这类 token 表里没有的尺寸 —— 逐条登记在 `DIVERGENCE.md` Q 节，收敛只有两条路：固化进 `board.css` 的 `.pw-*`，或先进设计裁定出新 token，**不许留死数字**。根级错误页与独立 HTML 文档（`app/error.tsx` / `app/global-error.tsx`）是例外，那边 `var()` 可能解空。
    ② `npm run verify:boards` 的几何对位（`board-diff-all`）已进 CI（e2e job）；每次跑都打印**对位覆盖率**（现 19/30、22 份 spec、两个环境各 0 不符）与未覆盖画板 —— 对位是一板一 spec，**改到哪张画板就补哪张的 spec**。spec 需要特殊状态时用 `app.script` 自己驱动（写在 spec 里，不进共享预设表），这样多份 spec 能并行编写而不争同一个文件。
       · 转录 / 输入框 / 侧栏那几张要「开着一条有消息的会话」才量得到：CI 用 `npm run verify:boards:seeded`（`scripts/verify-boards-live.mjs` 自建临时 agent 目录走 `PI_CODING_AGENT_DIR`，不碰用户数据），本机对着真服务仍用 `npm run verify:boards`。
       · spec 里的 `knownDiffs` 只许登记「接线」与「数据依赖」，每条必须写清为什么；改到某张画板却没 spec，等于又回到人眼比。
  * 换类名 / 挪 DOM 时留下死 CSS 是**已经发生过的事故**（`.fork-msg-actions` → `.pw-msg-acts` 漏改，动作行恒为透明）：改「画板类名与本组件的对应关系」时，同一提交里搜一遍旧名（`grep -rn "旧名" app/*.css components`）。
* **图标**：全部 lucide，经 `<i data-ico="name">` 由 `components/PwIcons.tsx` 水合；禁 emoji、禁手绘 SVG。改完跑 `npm run check:icons`。
* **已登记不改的形态差异**（DIVERGENCE 37/49 裁定）：Git 图自绘 SVG 泳道、子代理以工具卡徽标呈现、diff 词级视图、BranchNavigator 树画布、皮肤工作室的 `fork-skin-preview-*` 实时预览、会话行扫掠线（fork-ui.css）。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
