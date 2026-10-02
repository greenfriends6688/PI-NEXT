# MCP 运行时：SDK 内部件适配 + stdio env 清洗 + `builtin:mcp` 接线

| | |
| --- | --- |
| 状态 | 已实现（单测 29，其中 **11 条真 SDK 契约在 pi 0.87 下 skip**；作者在 `/tmp` 的 0.99.1 + pi-mcp 沙盒实测 23/23 全过，并真起过一个 stdio server 验子进程 env） |
| 上游依据 | ADR 0006（上游自己**尚未接线**，这两个文件只被它们自己的测试引用） |
| 依赖 | **必须先升 pi 到 0.99.x**，否则内置 `mcp` 扩展根本不存在 |

## 为什么不能删掉我们自己的 MCP

我们那 1464 行是**配置管理器**，pi 不会替代：握手校验（`mcp-validator.ts` 620 行，
启用前真连一次 `initialize`+`tools/list`，手写 JSON-RPC）、跨 agent 配置发现
（`mcp-discovery.ts` 254 行，Claude Code / Codex / Cursor）、`/mcp-auth` 命令入口、
CRUD 路由。只有 `mcp-config-file.ts` 那 57 行将来可能被 pi 的官方编辑器替代。
删掉的结果是设置里只剩一个「复制命令」按钮。

## 三道重复副本防护 + 契约测试

`lib/pi-sdk-internals.ts` 按 file URL 从**本进程跑的那份** SDK 加载 6 个内部模块：
`PI_PACKAGE_DIR` 不符 / realpath 不一致 / 第二个 pi-mcp 实例，三者任一即拒；
`globalThis` 每进程一次。**契约测试会因 SDK 升级而失败**（这正是它的用途），
且比上游严一档：函数槽位上塞个类也算不合格。

## 三个 ADR 0006 写死的坑

1. **fan-out**：扩展在 `session_start` 上连全部启用的 server，而我们每个 wrapper 都会建
   （切会话 `get_tools`、自动命名、SSE 预热）→ 浏览一个会话就把所有 stdio server 拉起来常驻。
2. **stop**：`before_agent_start` 最多等 10s 且**不理会 abort**，这段时间 Stop 按不动。
3. **env**：stdio 会继承整个 `process.env`（`PI_WEB_PASSWORD` 就在里面）→
   `mcp-transport.ts` 用 `inheritEnv: false` + 洗过的 env；引用密码的条目在 SDK 解析任何值
   **之前**就拒。密码名单等密码网关（G7）裁定后再与 `project-command-env.ts` 合并。

另：OAuth 回调只听 `127.0.0.1`；`.pi/mcp.json` 靠目录信任继承。远程部署都要单独处理。

## 0.87 下的降级

接线做成「导出存在才注册」：`import * as piSdk` → `typeof createMcpExtension === "function"`，
再查 `dist/extensions/mcp/*.js` 存在。缺任一条返回 `[]` 并按**模块级 flag 只 warn 一次**
（不按会话刷屏）。11 条真 SDK 契约 `t.skip()` 并打印原因。

## 升到 0.99 后要跑的

```bash
node_modules/.bin/tsc --noEmit
node --experimental-strip-types --test lib/pi-sdk-internals.test.mjs lib/mcp-transport.test.mjs   # 必须 0 skipped
node_modules/.bin/eslint lib/pi-sdk-internals.ts lib/mcp-transport.ts lib/rpc-manager.ts && npm test
```
再验 DoD 需真跑：P1 接上 `McpHost` 后，一个 stdio server 真连上并出工具、浏览会话不拉起
进程、连接等待期 Stop 可用。**P1 `McpHost` 尚未做，所以当前一个 server 都不连。**
