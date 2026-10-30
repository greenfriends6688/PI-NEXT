# PI NEXT

A UI-focused fork of [Pi Web](https://github.com/agegr/pi-web) — the local browser UI for the
[pi coding agent](https://github.com/earendil-works/pi). Same sessions, same configuration files,
redesigned interface.

> **Upstream:** everything below the interface — agent sessions, tools, models, MCP, files, Git,
> terminals — comes from Pi Web. This fork changes the rendering layer: design tokens, layout,
> themes, icons, motion. Business logic (`hooks/`, `lib/`, `app/api/`) is kept in sync with upstream.

## 为什么有这个仓库

Pi Web 本身很好用，但界面是「Tailwind 骨架 + 一份 `!important` 覆盖表」攒出来的：颜色能改，
几何、密度、材质、浮层层级改不动。这个 fork 换掉的是这一层——

| 改动 | 位置 |
| --- | --- |
| 设计令牌模型：主题只换 `surface` / `accent` / 三个状态色，其余由 `color-mix` 派生 | `app/v3/palettes.css`、`app/v3/bridge.css` |
| 36 套主题（浅色 10 / 深色 26），含 Catppuccin、Gruvbox、Tokyo Night、Rosé Pine、Claude、Codex、Cursor… | `lib/theme.ts`、`lib/i18n/messages/*` |
| 窗口、侧栏、时间线、输入区的骨架与几何 | `app/v3/shell.css`、`app/v3/chrome.css` |
| 会话树、项目组、文件树 | `app/v3/sidebar.css`、`app/v3/filetree.css`、`components/SessionTree.tsx` |
| 转录区与工具卡片（`composer__*`、`step`、`filecard`） | `app/v3/running.css`、`components/ChatInput.tsx` |
| 设置面板与侧栏菜单的整体重做 | `app/settings.css`、`app/sidebar-menu.css` |
| 54 个按 SF Symbols 笔画重画的图标 + 图标精灵 | `components/v3/Icon.tsx`、`components/v3/Spin.tsx` |
| 并排比对用的预览页（图标、会话、PWA） | `app/preview/` |

迁移是逐屏进行的：已换过的屏幕（输入区、转录、侧栏行、文件树、设置、菜单）用的是新骨架，
还没换的屏幕仍是上游的 DOM，只吃到新令牌——所以颜色一致，但几何密度会和新屏幕不同。

## 快速开始

需要 Node.js 22.19.0 或更新版本。

```bash
npm install
npm run dev            # http://127.0.0.1:30142
```

局域网访问用 `npm run dev:lan`；图形化安装包用 `npm run dist:mac`（electron-builder，产物在 `release/`）。

检查：

```bash
npm test                      # node --test，纯函数与组件测试
node_modules/.bin/tsc --noEmit
npm run lint
```

别在开发期间跑 `next build`：它会写 `.next/` 并干扰 dev server 的 Turbopack 图谱。

Pi 的数据仍然读 `~/.pi/agent`（模型、凭据、`sessions/<编码后的-cwd>/<时间戳>_<uuid>.jsonl`），
和命令行版 pi 共享，可以直接接着聊已有的会话。

## 和上游同步

```bash
git remote add upstream https://github.com/agegr/pi-web.git
git fetch upstream
git merge upstream/main     # 冲突基本只会出现在 CSS 和 components
```

## 这个仓库里没有的东西

- `docs/`、`design/`（设计画板、调研笔记、贡献指南）只在本地保留，没有上传。
  `AGENTS.md`、`CONTRIBUTING.md` 里指向它们的链接因此是断的。
- `node_modules/`、`.next/`、`release/`：构建产物，`.gitignore` 已排除。
- npm 包名仍是 `@agegr/pi-web`，这个 fork 不发布到 npm。想用请从源码跑，`npx @agegr/pi-web`
  装到的是上游版本。

## 目录

```text
app/             Next.js 界面与 API 路由；app/v3/ 是新的渲染层样式
components/      React 组件；components/v3/ 是新图标与转圈
hooks/           客户端状态与交互
lib/             会话、agent、模型、文件、Git、安全逻辑
public/          静态资源与 PWA
bin/             CLI 入口
electron/        桌面壳
scripts/         设计稿生成与比对脚本（v3gen、v3-*.mjs）
```

架构与文件级别的说明见 [`AGENTS.md`](./AGENTS.md)。

## 许可

[MIT](./LICENSE)，版权归上游作者。界面改动的责任在这个 fork。
