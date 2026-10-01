# 共享事实（所有对比 agent 必读，避免重复劳动）

分析日期：2026-10-01

## 两个项目

| | 本仓库（"我们"） | 参考项目 |
|---|---|---|
| 路径 | `/Users/yingjing/Desktop/pi-codex` | `/Users/yingjing/Desktop/pi-codex/pi参考项目/PI-Desktop-main` |
| 形态 | Next.js 15 App Router + 进程内 pi SDK（`AgentSession` in-process）+ React SPA，Electron 只是壳，另有 PWA | Electron 三进程：main + React renderer + Rust `host-core` sidecar（`crates/host-core`），数据在自建 SQLite `~/.pi-desktop/pi.sqlite` |
| 语言 | TS/TSX/CSS | TS/TSX + Rust + Biome，pnpm monorepo（`apps/desktop`、`apps/pi-host`、`packages/{agent-host,agent-runtime,host-runtime,i18n,plugin-devkit,plugin-sdk,racp,shared,voice-runtime}`） |
| 版本 | `@agegr/pi-web` 0.1.6（"PI NEXT"） | `pi-desktop` 0.16.0-beta.1 |
| 规模 | ~180 个 `components/*.tsx` + ~40 组 `app/api/**` | `apps/desktop/src/{components,features,stores,hooks,pages,plugins}` |
| 设计系统 | `design/pi-web-design/`（29 张画板 + `app/design/tokens.css` + `board.css`），Zeno 变量名 `--bg/--text/--accent`；门禁 `npm run check:design` / `check:contrast` / `verify:boards` | `apps/desktop/src/styles/*`，`packages/i18n` |
| 数据真源 | `~/.pi/agent/sessions/**.jsonl` + `~/.pi/agent/{settings,models,auth}.json`（**pi SDK 拥有**，不能自建库） | 自建 SQLite + pi host |

**不可抄的三条**（结论先行，所有建议必须遵守）：
1. **数据模型不能抄**。我们没有 SQLite，真源是 pi 的 `.jsonl` / `settings.json`。任何"建表"的方案在我们这里只能落成 `localStorage` + 现有 API。
2. **进程模型不能抄**。他们能放 sidecar 的重活（扫描、索引、keep-alive），我们只能放 Route Handler，且**必须显式设上限**，否则卡的是整个 Web 服务。
3. **设计系统不能混**。新 `pw-*` 类必须先进 `board.css` + 出现在至少一张画板 + 记进 `DIVERGENCE.md`；禁止截图模仿，禁止在 `fork-ui.css` 另起同名 `pw-*`。

## 已有历史结论（**不要重复报告这些**）

- `docs/pi-desktop-borrowing-plan-2026-09-24.md` — 上一轮针对 PI-Desktop 0.15.x 的逐项对比，落地项 `PD-01…PD-22`（导入 / 项目归档 / 模型高级参数 / 文件查看器性能 / PWA 布局）。
- `docs/fork-comparison-2026-09-16.md`、`docs/design-system-comparison-2026-09-28.md`、`docs/proma-*`、`docs/zeno-*`、`docs/musepi-borrowing-plan-2026-09-17.md`、`docs/acp-agent-client-borrowing-plan-2026-09-28.md` — 其他参考项目的对比。

**你的任务第一步**：读 `docs/pi-desktop-borrowing-plan-2026-09-24.md`，把 `PD-01…PD-22` 逐条标成 `已落地 / 部分落地 / 未落地`（用 grep 在代码里验证，不要只信文档），然后**只报告"那一轮之后新增的、或那一轮明确漏掉的"**。已落地的一律不写进报告正文，最多在附录一行带过。

## 拉到本地的 PR 数据

`pi参考项目/_pr/`：
- `OPEN.md` — **58 个 open PR**，带标题/作者/日期/labels/body 摘要/改动规模。**这是主战场。**
- `CLOSED-UNMERGED.md` — 101 个被关未合的 PR（可能是被否的提案或重复实现，可作"别人试过"的信号）。
- `MERGED-TITLES.md` — 583 个已合 PR 标题（这些已在 `PI-Desktop-main` 代码里，**不要当新功能提**，但可以用来判断"这个功能他们做了几轮迭代"）。
- `diffs/pr-<number>.diff` — 58 个 open PR 的完整 diff（23MB）。**读 diff 前先看 `OPEN.md` 里的 body**，很多 body 已经写清了动机；只对真正要推荐的 PR 读 diff 细节。

## 输出要求（所有 agent）

1. 报告写到 `/Users/yingjing/Desktop/pi-codex/docs/compare/pi-desktop-2026-10-01/<你的文件名>.md`，**中文**，用 Markdown 表格。
2. 每条发现必须带 **证据**：`相对路径:行号`（我们侧）与 `相对路径`（对方侧）。**不许写"据说/可能/大概"**——没读到就不写。
3. 每条结论末尾打**置信度**标记：`[已验证]`（两侧代码都读到）/ `[单侧]`（只有一侧有证据）/ `[推断]`。
4. 结尾必须有一节 **"建议动作"**，每条形如：
   `| # | 动作 | 类型(新增功能/补齐/移植交互/不建议) | 价值(高中低) | 代价(S/M/L/XL) | 依赖 | 落点文件 |`
   价值与代价必须给理由，不要拍脑袋。
5. **不要修改任何代码。** 只读 + 写报告。
6. 不要复述已知事实（见上），不要写"总结"式套话。密度优先。
