# Attached mode（`docs/attached.md`）

窗口不再背一个 Node + Next 服务器，而是**用这台机器已经装好的 `pi`**：agent 走
`pi --mode rpc`（JSONL），其余数据直接读 pi 自己的文件。目标是 pi-gpui 的形状——一个
Rust 运行时 + 一个 `pi` 子进程，dmg 从 103M 回到 ~20M。

## 两种跑法并存

| | 谁回答 `/api/*` | 用在 |
|---|---|---|
| 现在（过渡） | 先问 `src/local/`（本地路由），没人认领的走管道给 `host/main.mjs` | 边搬边跑，随时能出包 |
| attached（终点） | 全部本地 | 包里的 `nsh/node` 与 `nsh/pi-web` 可以删掉 |

启动顺序也在这里定：窗口先附着（`pi --mode rpc`，毫秒级），**老服务器落到后台**
（`link.ts` `ensureHost()`，画完窗口 1.2 s 后再起），只有本地答不了的路由才用到它。

规则只有一条：**没实现的返回 `null`**，不要返回 501。`null` 让请求落回管道，功能不断；
501 会让本来能用的界面变成错误。

## 路由表

| 模块 | 路由 | 数据从哪来 |
|---|---|---|
| `src/local/agent-routes.ts` | `/api/agent/**`（state、命令、事件流、running、lease、new） | `pi --mode rpc` |
| `src/local/session-routes.ts` | `/api/sessions/**`（列表、一个会话、上下文分页、搜索、统计、ui-state、删除、fork） | `~/.pi/agent/sessions/*.jsonl` |
| `src/local/file-routes.ts` | `/api/files/**`（list/read/meta/download/watch）、`/api/file-index` | `fs`，git-ignore 靠 `git check-ignore` |
| `src/local/upload-routes.ts` | `/api/files?type=upload/upload-check/allow-link` | 会话目录（`@mention` 就指着它） |
| `src/local/git-routes.ts` | `/api/git/**`、`/api/cwd/**`、`/api/home`、`/api/default-cwd`、`/api/worktrees` | `git`、`fs` |
| `src/local/settings-routes.ts` | `/api/models`、`/api/tools/settings`、`/api/cache-miss-notices`、`/api/ui-preferences`、`/api/subagents/**` | `~/.pi/agent/*.json` |
| `src/local/mcp-routes.ts` | `/api/mcp`（两个 `mcp.json` 的读写、启停、曝光、移除+撤销、测试、OAuth 登录） | `~/.pi/agent/mcp.json`、项目 `.pi/mcp.json`、`pi mcp` |
| `src/local/skills-routes.ts` | `/api/skills`（列表、正文、模型调用开关）、搜索/安装/检查更新 | pi 的技能目录、`SKILL.md` frontmatter、`curl`/`npx` |
| `src/local/plugin-routes.ts` | `/api/plugins`（安装、移除、更新、启停）、`/api/plugins/check` | `settings.json`、`packages.lock.json`、`pi install/remove/update`、npm registry |
| `src/local/terminal-routes.ts` | `/api/terminal/**`（pty 用管道壳代替） | 本地 shell 子进程 |
| `src/local/trust-routes.ts` | `/api/project-trust` | pi / pi-web 的信任记录 |
| `src/local/misc-routes.ts` | `/api/sessions/[id]/export`、`/auto-name`、`/api/app-update` | 会话文件、npm registry |

启动顺序也在这里定：窗口先附着（`pi --mode rpc`，毫秒级），**老服务器落到后台**
（`link.ts` `ensureHost()`，画完窗口 1.2 s 后再起），只有本地答不了的路由才用到它。

规则只有一条：**没实现的返回 `null`**，不要返回 501。`null` 让请求落回管道，功能不断；
501 会让本来能用的界面变成错误。

## 能力（`nsh.json`）

attached 模式要读项目、要在项目目录里起 `pi` 和 `git`，所以：

- `capabilities.fs.read` / `.write` 加了 `${homeDir}`（项目都在 home 下；代价是 app 能写整个
  home，和 pi-web 作为本地服务器时的权限等价）；
- `capabilities.process.execute` 加了 `pi`、`git`、`/usr/bin/git`、`/bin/zsh`、`/bin/bash`
  （登录 shell 是找 `pi` 的唯一办法：Finder 起的窗口没有 `~/.local/bin`）。

`pi` 的发现、版本与更新在 `src/pi/install.ts`、`src/pi/updates.ts`（设置 › 通用 的 Pi 卡片）。

## 终点（删包）

所有界面要用的路由都本地之后：

1. `scripts/bundle-app.mjs` 不再放 `node/`、`pi-web/`（`embed-node.mjs`、`bundle-server.mjs` 停用）；
2. `src/api/link.ts` 的 `startAgent()` 改成只检查 `checkPi()`，没有 pi 就给连接卡片
   （一条 `npm install -g @earendil-works/pi-coding-agent` 就能继续）；
3. `host/main.mjs` 与 `src/lib/app-bundle.ts` 跟着删掉。

产物：`PI NEXT.app` ≈ 49M（就是 PINEXT 本身），dmg ≈ 20M。
