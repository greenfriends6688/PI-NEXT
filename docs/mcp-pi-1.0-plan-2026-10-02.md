# MCP 对齐 pi 1.0：现状对照与实施计划（2026-10-02）

> 背景：参考项目 `pi参考项目/pi-agent-desktop-main`（pi **0.99.1**，`package.json` devDeps：
> `pi-ai`/`pi-coding-agent`/`pi-mcp` 全 `^0.99.1`）在 MCP 上有几件我们没做的事；
> 本仓已经跑在 pi **1.0.0**（`node_modules/@earendil-works/pi-coding-agent/package.json`），
> 而 1.0 把当年"包不导出"的那批东西**公开了**。这份计划把三方差集写清楚，按优先级排。

---

## 0. 三句话结论

1. **我们被一份过期的前提绑住了**：`lib/pi-sdk-internals.ts:7` 写着"pi 0.99 起自带 `mcp`/`codemode`/`tool-search` 三个内置扩展，但**包不导出它们**"。**1.0 已经导出**（`dist/index.d.ts:29` `createCodemodeExtension`、`:33` `createToolSearchExtension`）。我们因此把每个 MCP server 的 exposure 一律降级成 `direct`（`lib/pi-sdk-internals.ts:796-814`）——**代价是所有 MCP 工具平铺进模型工具表**，而不是 pi 设计的渐进披露（codemode 脚本 / tool_search / `mcp_servers` 提示段）。
2. **我们最缺的功能是"改完配置让在跑的会话重载"**：参考项目每次增删改/开关/移动后都调 `requestSessionResourceReload()`（`lib/rpc-manager.ts:813`，遍历注册表让会话 `requestResourceReload()`）；我们的 MCP 页**一个 reload 都不发**，只有插件页有手动 reload 按钮，MCP 配置只在 `session_start` 生效。1.0 的 `AgentSession.reload()` 在（`dist/core/agent-session.d.ts:739`，`:258` 明确说 reload 会把 MCP server 的工具带上），接线成本很低。
3. **参考项目有两件值得抄、一件不该抄**：抄 `loadDesktopMcpConfig` 的**字段适配 + 拒绝 legacy SSE + `autoEnableCodemode: false` 的权威口径**，抄 **自动 reload**；不该抄的是它的**真连测试**（它在 Web 服务进程里 spawn 用户配置的命令）——我们当初刻意只做结构校验（`lib/mcp-validator.ts`），远程部署下这个边界不能破，要做也得分形态。

---

## 1. 对照表

| 能力 | pi 1.0 SDK | 本仓（pi-web） | 参考项目（0.99.1） |
| --- | --- | --- | --- |
| 配置读写 | `loadMcpConfig` / `addMcpServerConfig` / `updateMcpServerConfig` / `removeMcpServerConfig`（`extensions/mcp/config.d.ts`，**函数不公开导出，类型公开**） | 走官方原语 + 0600 原子写 + malformed 不回显 parser 原文（`lib/mcp-config-file.ts:60,130,151,170`） | 自己读改写 `mcp.json`（`lib/mcp-config.ts:66,96,175,205,236`） |
| 运行时扩展 | `createMcpExtension(options)`（`extensions/mcp/index.d.ts:73`） | ✅ 已用（`lib/rpc-manager.ts:2450`） | ✅ 已用（`lib/rpc-manager.ts:881`） |
| codemode / tool_search | **1.0 公开导出**（`dist/index.d.ts:29,33`） | ❌ 没注册 → 只能降级 exposure | ❌ 没注册（但它 `autoEnableCodemode: false`，语义自洽） |
| exposure 透传 | `McpExposure = codemode \| deferred \| direct \| hidden`（`core/mcp-servers.d.ts:12`） | ❌ 一律改写成 `direct`（`lib/pi-sdk-internals.ts:796-814`） | ✅ 原样透传 + UI 下拉（`components/McpConfigModal.tsx:30,216,248,369`） |
| `toolExposure`（含 `*` 模式） | ✅（`core/mcp-servers.d.ts:24-30`） | 读得进、但同样被降级；UI 无控件 | 类型里有字段，UI 无控件 |
| `timeout`（秒，默认 60） | ✅（`core/mcp-servers.d.ts:33`） | 透传，无 UI | 透传，无 UI |
| `auth.provider`（用 pi provider 的 token 代替 OAuth） | ✅（`core/mcp-servers.d.ts:84-92`） | ❌ 无 UI 无文档 | ❌ 无 |
| `oauth.*`（clientId/secret/callbackPort/callbackUrl/scope/clientName/authServerMetadataUrl） | ✅（`core/mcp-servers.d.ts:49-77`） | 部分（走 pi 的 `signInMcpServer`，`lib/mcp-auth-command.ts`） | ❌ |
| `/mcp` 改动的落盘 | `McpExtensionOptions.updateConfig(entry, patch)`（`extensions/mcp/index.d.ts:52-53`），默认 pi 自己改 mcp.json | ❌ 没传 → pi 直接改文件，绕过我们的 0600 原子写 | ❌ 没传（同一个问题） |
| 配置改动 → 在跑会话重载 | `AgentSession.reload()`（`agent-session.d.ts:739`） | ⚠️ 有 `case "reload"`（`lib/rpc-manager.ts:1245`）但 MCP 页不调 | ✅ `requestSessionResourceReload`（`lib/rpc-manager.ts:813`） |
| 测试连接 | 无（SDK 不提供 probe） | 结构校验（`lib/mcp-validator.ts`，`action:"test"`） | **真连**：`McpClient` + transport + `listTools()`，5s 超时（`lib/mcp-config.ts:305-330`） |
| env 处理 | `${VAR}` / `!cmd` 引用由 pi 解析（`core/mcp-servers.d.ts:38,80`） | 清洗宿主变量 + 拒 `PI_WEB_PASSWORD` + `inheritEnv:false` + 绝不回退 SDK 默认 transport（`lib/mcp-transport.ts`） | `${VAR}` 自己插值、`!cmd` 拒绝并指向 `/mcp`（`lib/mcp-config.ts:311-315`） |
| 从别家配置发现 server | 无 | ✅ 11 个来源 + Codex TOML 子集（`lib/mcp-discovery.ts:52-71`） | ❌ |
| 连接目录 / OAuth 回填 | 无 | ✅（`lib/mcp-catalog*.ts`、`app/api/mcp/catalog/oauth/route.ts`） | ❌ |
| 扩展注册 server（`pi.registerMcpServer()`） | ✅（`core/mcp-servers.d.ts`，`mcp.json` 优先；变更发 `mcp_servers_change`，`core/extensions/types.d.ts:541`） | ❌ | ❌ |
| MCP 日志 | `logPath`（默认 agent 目录 `mcp.log`） | 没设置，没展示 | 没设置 |

---

## 2. 计划

### P0-1 · 注册 codemode + tool_search，撤掉 exposure 降级

**为什么**：这是 1.0 相对 0.99 最大的一处"我们本该跟上、但被过期前提挡住"的地方。现在每个 MCP 工具都 `direct` 平铺给模型：工具表膨胀、提示词变长、模型要在几十个 `mcp__*` 里挑。pi 的设计是默认 `codemode`（脚本里 `searchTools()` 找），或 `deferred`（`tool_search` 按需加载），并给非 direct 的 server 一段 `mcp_servers` 提示（`extensions/mcp/index.d.ts` 的 `renderServersSection`，上限 4096 字符）。

**改动**
- `lib/rpc-manager.ts` 的 `extensionFactories`：在 `...mcpBuiltinExtensionEntries(...)` 旁边加 `createCodemodeExtension()`、`createToolSearchExtension()`（两者都是"注册但不激活"，由 mcp 扩展按 server exposure 激活；见两个 `index.d.ts` 头部注释）。
- `lib/pi-sdk-internals.ts`：删掉 `normalizeMcpConfigForPiWeb` 里的 exposure 改写（保留 `disabled → enabled` 折叠与错误清洗）；`directExposure()` 及其测试改为"只归一别名 `codemode-deferred → codemode`"。
- `LoadedMcpConfig` 透出 `autoEnableCodemode`：Chat-only 会话与"没注册 codemode"的降级路径传 `false`，其余跟随默认（true）。
- `lib/pi-sdk-internals.ts:7` 的注释与 `AGENTS.md` 里"MCP 运行时"那段（"pi 的内置 mcp 扩展包不导出"）同步更新。

**验收**
- 新建会话加一个 stdio server（不写 exposure）→ `get_tools` 里**没有** `mcp__*`，但 `codemode` 工具在；脚本里 `searchTools("关键词")` 能列出该 server 的工具并能调通。
- 把该 server 改成 `exposure: "direct"` → `get_tools` 里出现 `mcp__*`。
- 改成 `deferred` → 出现 `tool_search`，加载后工具才声明给模型。
- `exposure: "hidden"` → 工具注册但调不到。
- Chat-only 会话：一个 MCP 工具都不注册（现状不能破）。
- `lib/pi-sdk-internals.test.mjs` 的 exposure 归一用例改写；新增一条"codemode/deferred 原样透传"。

**风险**：`withExtensionTools()`（`lib/rpc-manager.ts:243`）对 `codemode`/`deferred` exposure 是"不声明"，工具预设不应把它们当普通工具开关；要补一条测试钉住"预设里选 `+codemode` 不生效 / 由 mcp 扩展激活"。另：`mcp_servers` 提示段会进系统提示，与 Chat-only 的"用 context files 替换 base prompt"路径要各测一次。

---

### P0-2 · 配置改动后自动重载在跑的会话

**为什么**：现在改完 MCP 必须自己想到"去插件页点重载"，或者开新会话；参考项目是自动的。这是体验上最直接的差距。

**改动**
- `lib/rpc-manager.ts`：加 `requestMcpReload(cwd?: string)` —— 遍历 `getRegistry()`，对 cwd 匹配（或不限）的 wrapper 发一次 reload（复用 `case "reload"` 的实现，或直接 `this.inner.reload()`）。加 300ms 防抖 + "同一 cwd 只发一次"，避免批量导入时打爆。
- `app/api/mcp/route.ts`：`add` / `update` / `remove` / `enable` / `disable` / `move` 成功后调用它；`app/api/mcp/catalog/route.ts` 同样。
- 响应里带上 `{ reloaded: number }`，前端在 MCP 页给一行反馈（"已重载 N 个会话"），无会话时静默。
- 不要自动 reload **正在跑**（streaming）的会话：`AgentSession.reload()` 在 turn 中途的行为要确认；先做"空闲会话重载 + 跑着的会话标记'下次生效'"（与 `lib/session-liveness.ts` 的忙碌信号同源判断）。

**验收**
- 开着会话 A（空闲）→ 设置里加一个 server → A 不用重启，`get_tools` 立刻多出对应工具（或 codemode 能搜到）。
- 会话 B 正在跑 → 配置改动后 B 不被打断，UI 提示"下次生效"。
- 单测：`lib/rpc-manager` 的 reload 目标筛选（cwd 过滤、去重、忙碌跳过）。

---

### P0-3 · `updateConfig` 接管 `/mcp` 的落盘

**为什么**：`McpExtensionOptions.updateConfig` 是 1.0 给的钩子：pi 的 `/mcp` 面板改 `enabled` / `exposure` 时，默认由 pi 自己改 `mcp.json`。我们已经有"0600 + 同目录 staging + rename"的写入器（`lib/mcp-config-file.ts:101-128`），让 `/mcp` 的改动也走它，文件权限与错误口径才统一。

**改动**
- `mcpBuiltinExtensionEntries()` 里加 `updateConfig: (entry, patch) => setMcpServerConfigPatch(entry, patch)`，用 `lib/mcp-config-file.ts` 的写入器落盘（`patch` 形状：`{enabled?, exposure?}`，`McpServerConfigPatch`）。
- `entry.scope === "extension"` 时**不要**写文件（pi 的约定：扩展注册的 server 不落盘）。

**验收**：在会话里用 `/mcp` 关掉一个 server → `mcp.json` 里该 server `enabled: false`、文件权限仍 0600、其它键（含我们保留的未知字段）不动；单测覆盖 extension scope 不落盘。

---

### P1 · 配置面补齐（对齐 1.0 的 `McpServerConfig`）

1. **exposure 下拉**（`codemode` / `deferred` / `direct` / `hidden`）+ **per-tool `toolExposure`**（键支持 `*` 模式；`hidden` + 少量 override = 只暴露那几个工具）。参考项目的下拉可作形态参考（`components/McpConfigModal.tsx:369`），但我们的 UI 在 `PluginsConfig.tsx`（`only="mcp"`），要按我们的画板规格做。
2. **`timeout`（秒，默认 60）** 数字输入；**`description`**（进 `mcp_servers` 段与 tool_search 排序）。
3. **`auth.provider`**：用某个 pi provider 的 token 代替 OAuth（`core/mcp-servers.d.ts:84-92`；注意项目级 `mcp.json` **不允许**用它，校验器要拦）。
4. **`oauth.*` 结构化编辑**（clientId/clientSecret/callbackPort/callbackUrl/scope/clientName/authServerMetadataUrl），`clientSecret` 支持 `${VAR}` / `!cmd`；`callbackUrl` 要过 `isLoopbackRedirectUri`（SDK 有导出）。
5. **校验器升级**（`lib/mcp-validator.ts`）：用 1.0 的判别联合（stdio 必 `command`；http 必 `url`，且 `auth.provider` 不能在 project scope）、`toolExposure` 模式合法性、`oauth.authServerMetadataUrl` 必须 https（loopback 例外）；继续拒绝 legacy SSE。
6. **类型改用 SDK 导出**：`LoadedMcpConfig` / `McpServerConfig` / `McpExposure` / `McpServerEntry` / `ToolExposure` 现在都在根导出里（`dist/index.d.ts:8,11,31`），`lib/pi-sdk-internals.ts:100-350` 那份手写类型可以删；`McpExposure` 别再自己带上 `codemode-deferred`（它是别名，不是类型成员）。
7. **`logPath`**：显式指到 agent 目录的 `mcp.log`，并在 server 详情里给"查看日志"入口（现在 server 的 stderr 只在 `lib/mcp-transport.ts` 里被接管，用户看不到）。

**验收**：每项字段"UI 改 → 落盘 → 读回一致"，含 JSON 模式与结构化模式两条路径；`lib/mcp-validator.test.mjs` 增补用例。

---

### P2 · 真连测试与可观测性

1. **真连测试（分形态）**：参考项目用 `@earendil-works/pi-mcp` 的 `McpClient` + `StdioTransport`/`StreamableHttpTransport` 真连并 `listTools()`（`lib/mcp-config.ts:305-330`）。我们可以做，但**必须**：
   - 复用 `lib/mcp-transport.ts` 的 env 清洗与 `inheritEnv: false`、拒绝 `PI_WEB_PASSWORD`；
   - 只在**桌面/本机**形态开放（新增一个"允许真连探测"的能力开关），远程部署仍只做结构校验；
   - 7s 硬超时 + 一定 `client.close()`；探测进程与"会话连接"分开（参考项目也是这么写的：*session connections remain owned by Pi*）。
   - 依赖问题：`@earendil-works/pi-mcp` **不是我们的依赖**（参考项目直接依赖它）。要么加依赖，要么从 pi-coding-agent 的内部件里取（`lib/pi-sdk-internals.ts:466-476` 已经在做类似的事）。
2. **MCP 工具的可观测性**：`get_tools` 结果里标 exposure（现在 `ToolInfo.exposure` 可选、`ToolExposure` 可从 SDK 拿）；顶栏 `McpStatusButton`（`components/TopBarPopovers.tsx:260-305`）从"enabled 计数"升级到"每 server：连接状态 / 工具数 / exposure / 是否需登录"。
3. **登录态提示**：server 需要 OAuth 时，列表行上给"需登录"标记 + 一键登录（现在只有连接目录那条路径有 OAuth UI）。

---

### P3 · 可选（要你拍板）

1. **`/mcp` 命令面**：参考项目把用户往 pi 的 `/mcp` 上引（它的错误文案直接写"use /mcp to check this server"）。我们要不要把这个管理器接出来（或至少在我们的 UI 里覆盖它的三件事：登录 / 重连 / 改 exposure）？
2. **扩展注册 server**（`pi.registerMcpServer()` + `McpServersChangeEvent`）：可以把"连接目录"里的 server 以扩展方式注册（不落盘、`mcp.json` 优先），适合"我们内置、用户不可改"的那几个。需要先定产品语义。

---

## 3. 建议的落地顺序与工作量

| 阶段 | 内容 | 预估 | 可独立合并 |
| --- | --- | --- | --- |
| 第 1 步 | P0-2 自动 reload（收益最直接、风险最低） | 0.5 天 | ✅ |
| 第 2 步 | P0-3 `updateConfig` 接管落盘 | 0.5 天 | ✅ |
| 第 3 步 | P0-1 codemode/tool_search + 撤降级（含测试与 AGENTS 更新） | 1–1.5 天 | ✅ |
| 第 4 步 | P1 字段面 + 校验器 + 类型换 SDK（可分 3 个小 PR） | 1–1.5 天 | ✅ |
| 第 5 步 | P2 真连测试（分形态）+ 可观测性 | 1–2 天 | ✅ |

每步的门禁：`tsc --noEmit`、`npm run check:design`、`npm test`（MCP 相关单测：`lib/mcp-*.test.mjs`、`lib/pi-sdk-internals.test.mjs`）；第 3 步额外要跑一次真机会话验证（`get_tools` + codemode 脚本调通）。

---

## 4. 需要你裁定的三件事

1. **exposure 默认值**：采用 pi 的原生默认（`codemode`，工具不进模型工具表、要靠脚本/搜索）—— 这会让"我加了个 MCP server，模型直接就能用它的工具"变成"模型要先搜/写脚本"。若你更想要后者那种"直接可用"，那就保留现在的 `direct` 降级，只做 P0-2/P0-3 + P1 的字段面。
2. **真连测试**：是否允许在**本机/桌面**形态下由 Web 服务 spawn 用户配置的命令来试连？（远程部署一律不做。）
3. **`/mcp` 命令面**：是把 pi 的管理器接出来，还是我们自己的 UI 覆盖它的三件事就够？
