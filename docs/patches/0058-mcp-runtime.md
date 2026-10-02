# MCP 运行时：配置面换 pi 官方原语 + 运行时通电 + stdio env 清洗 + `builtin:mcp` 接线

| | |
| --- | --- |
| 状态 | 已实现。SDK 1.0.0 下契约 **29/29（0 skipped）**；`npm test` 2702/2702；真起过一个最小 stdio server 验工具可达与子进程 env |
| 上游依据 | ADR 0006 |
| 依赖 | pi ≥ 0.99（本仓现为 **1.0.0**）。SDK 不具备 MCP 时 `mcpBuiltinExtensionEntries()` 返回 `[]` |

## 配置面：换成了 pi 1.0 的官方原语（`1e4dbac0`）

| 手写块 | 换成 | 语义差异（有意） |
| --- | --- | --- |
| `lib/mcp-config-file.ts` 的 `JSON.parse` + 原子写 | `loadMcpConfig` / `add` / `update` / `removeMcpServerConfig` | pi 的编辑入口是普通 `writeFileSync`，不带 0600、不原子 → 外面仍包一层「同目录 0600 staging → `renameSync`」。解析失败只抛 `malformed JSON`，不让 V8 的 parser 文本（会引用文件内容）进响应 |
| `app/api/mcp/route.ts` 的内部实现 | 全部转发到上面几个原语 | **对外响应形状与状态码一个都没变**（GET 的 `servers`/`settings`/`diagnostics`/`projectResourcesLoaded`；POST 的 400/403/404/415/500 分支逐条保留；`serverInfo` 的 10 个键不变）。浏览器里唯一入口还是它 |
| `lib/mcp-validator.ts` 620 行手写 JSON-RPC 握手 | `validateMcpServerConfig` | **不再真连**：错误码从连接类变成 `invalid-config`；socket / legacy SSE 被拒；校验失败 **400 不写**（`force` 仍跳过） |
| `/mcp-auth` 复制命令 | pi 内置 `/mcp login` / `/mcp logout`；服务端另有 `signInMcpServer` + `McpOAuthCredentialStore` 助手 | OAuth 回调只监听 `127.0.0.1`，远程部署未解决 |
| `disabled` 键 | pi 的 `enabled` | 老配置在读取/写入时折叠成 `enabled`，升级不会被误启用 |
| `lib/mcp-discovery.ts` | **保留** | 跨 agent（Claude Code / Codex / Cursor / VS Code）发现是 pi 没有的能力，换掉 = 删功能 |

服务端 OAuth 助手（`signInMcpServerWithPrompt` / `signOutMcpServerWithPrompt`）已实现并单测，
但**未接 UI/路由**：面板冻结，且回调只听 loopback。等有 UI 或远程方案再接。

## 运行时：通电（`42f96a70`）

`mcpBuiltinExtensionEntries()` 的 `loadConfig` 带上正确上下文
（`agentDir: getAgentDir()`、`cwd: ctx.cwd`、`projectTrusted: ctx.isProjectTrusted()`、
会话身份取 `ctx.sessionManager.getSessionId()/getSessionFile()`），`createTransport`
接到 `lib/mcp-transport.ts` 的洗 env 工厂。

## 三个 ADR 0006 写死的坑，逐个处置

1. **fan-out** → `createMcpSessionLivenessGate`：复用空闲回收已经在用的**同一份**
   session-liveness 租约 —— 只有浏览器真的在看这个会话（SSE 租约）才放行；
   `get_tools` / 自动命名 / SSE 预热建出来的 wrapper 一个进程都不起。
   等待有 10 分钟上限（与默认空闲回收同档）、timer `unref`、可被 dispose 中止。
2. **stop** → `startupWaitMs: 0` 绕开 `before_agent_start` 那段「最多等 10s 且不认 abort」
   的等待；`tool_call` 侧的等待用 SDK 自带的 `ctx.signal`。
3. **env** → `mcp-transport.ts` 用 `inheritEnv: false` + 洗过的 env；引用 `PI_WEB_PASSWORD`
   的条目在 SDK 解析任何值**之前**就拒。密码名单等密码网关（G7）裁定后再与
   `project-command-env.ts` 合并。

**exposure 归一**：pi-web 没注册 `codemode` / `tool-search`，而 pi 只把 `direct` / `model-only`
声明给模型 —— 所以 `loadConfig` 把默认的 `codemode` / `deferred` 一律落成 `direct`
（`hidden` 保持隐藏）。不落盘、不改用户的 `mcp.json`。

**仍未做**：per-prompt 的 `McpHost`（上游 P1）。连接在浏览器会话打开期间常驻，靠 wrapper
空闲回收关闭。远程部署仍要单独处理 OAuth 回调与目录信任。

## 三道重复副本防护 + 契约测试

`lib/pi-sdk-internals.ts` 按 file URL 从**本进程跑的那份** SDK 加载内部模块：
`PI_PACKAGE_DIR` 不符 / realpath 不一致 / 第二个 pi-mcp 实例，三者任一即拒；
`globalThis` 每进程一次。**契约测试会因 SDK 升级而失败**（这正是它的用途），
且比上游严一档：函数槽位上塞个类也算不合格。

## DoD 怎么跑

```bash
node_modules/.bin/tsc --noEmit
node --experimental-strip-types --test lib/pi-sdk-internals.test.mjs lib/mcp-transport.test.mjs   # 必须 0 skipped
node --experimental-strip-types --test lib/mcp-*.test.mjs lib/import/mcp.test.mjs
node_modules/.bin/eslint lib/pi-sdk-internals.ts lib/mcp-transport.ts lib/rpc-manager.ts lib/mcp-*.ts app/api/mcp/route.ts && npm test
```

真连验证（`/tmp/mcp-verify`，真 SDK + 最小 stdio MCP server）当时的输出：

```
LIVE mcp tools: mcp__fixture__ping[direct]
LIVE server env: DECLARED = declared-value | PI_WEB_PASSWORD present = false | PORT present = false | PATH present = true
UNWATCHED mcp tools: 0 | server process spawned = false
```
