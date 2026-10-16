# 三方基线事实（先看这一页）

分析日期：2026-10-16
本仓 HEAD：`1fa2218e`（pinext 0.1.10，branch `pinext`）

## 三个项目

| | 本仓 Pinext | 参考 A：pi-agent-desktop | 参考 B：PI-Desktop |
|---|---|---|---|
| 路径 | `/Users/yingjing/Desktop/pinext` | `参考项目/pi-agent-desktop-main` | `参考项目/PI-Desktop-main` |
| 版本 | 0.1.10 | `@agegr/pi-web` **0.10.0** + Tauri 壳 | `pi-desktop` **0.20.1** |
| 形态 | Electron + electron-vite + React 19 + Tailwind v4 + shadcn/Base UI，**内嵌 pi SDK 在 main 进程** | Next.js 15 App Router（浏览器服务）+ Tauri 桌面壳，**同一份 pi SDK 跑在服务端** | Electron + React renderer + **Rust `host-core` sidecar** + pnpm monorepo |
| agent | 官方 `@earendil-works/pi-coding-agent`，`AgentSession` 进程内 | 同上（pi-web 就是本仓的上游同源） | **自己重写了一遍**（`packages/agent-runtime`，137 源文件） |
| 数据真源 | Pinext 自己的 userData（`runtime/engine/**`），不写 `~/.pi` | `~/.pi/agent/**`（pi SDK 所有） | 自建 SQLite `~/.pi-desktop/pi.sqlite` |
| 会话文件 | pi v3 `.jsonl` | pi v3 `.jsonl` | 自己的表 |
| 远程/移动 | LAN 密码 + 官方 RTC + SSH 主机 + Flutter 手机端 | PWA / 浏览器 profile | SSH 远程主机 + RACP + S3 云同步 |
| i18n | zh / en | en / zh-CN / zh-TW（`lib/i18n/messages/`） | English-first + zh-CN 等 |
| 许可 | MIT | MIT | 未核（仓库根有 LICENSE，未读） |

## 三条硬约束（结论先行）

1. **参考 A 是同源上游，参考 B 是异源邻域。** `pi-agent-desktop-main` 的 `lib/**`、`components/**` 与 Pinext 的祖先同源（本仓 `git remote agegr = agegr/pi-web`，见 `docs/upstream-merge-policy.md`），它上面出现而本仓没有的能力，**基本可以直接搬语义**；PI-Desktop 的能力大多绑在「自建 runtime + SQLite + Rust sidecar」上，**只能搬交互与产品判断，不能搬实现**。

注意方向：参考 A 是 pi-web 的 **0.10.0** 桌面化分支，比 `参考项目/pi-web-0.12.1` 旧；所以「上游已修但参考 A 没有」的东西不在本轮讨论范围（那属于 `docs/upstream-alignment-plan-*.md` 的题目）。
2. **参考 B 的插件内核不可移植。** 它的 `packages/plugin-sdk` 是一套「声明式 manifest + 权限网关 + Node 子进程 + `WebContentsView` 面板」的完整平台，本仓的「插件」是 pi extension（受信任的进程内代码）。两者不是同一个东西，见 PLAN §4。
3. **历史结论不要重复。** 本仓已有两轮 PI-Desktop 对比：
   - `docs/pi-desktop-borrowing-plan-2026-09-24.md`（PI-Desktop 0.15.x → `PD-01…PD-22`）
   - `docs/compare/pi-desktop-2026-10-01/`（0.16.0-beta.1，58 个 open PR 逐个判定）
   两份都成文于 **FastVibe 宿主迁移之前**（迁移见 `docs/fastvibe-host-migration-plan-2026-10-13.md`），那时的结论是「往 Next.js 里补 FastVibe 形态」。**本文是新宿主（Electron + FastVibe 壳）下的第一轮三方对比**，落地项重新编号 `PX-01…`。

## 一个反复出现的陷阱

迁移期的旧文档（`docs/upstream-alignment-plan-2026-10-12.md`、`docs/upstream-audit-2026-10-01/feature-gap.md`）写的是 **Next.js 时代的 `lib/`**。上面写着 **HAVE / 已落地** 的能力（artifacts、mermaid、提示音、工具预设、enabledModels 开关），指的是那些 `lib/*.ts` 文件——**它们已经不在当前仓库里了**。所以本轮每一条缺口都用 **`grep` 在 `src/` + `resources/` 里重新验证过**，不是转述旧文档。例如：

```
$ grep -rl "mermaid" src resources         # 空
$ grep -rl ":::artifact" src resources     # 空
$ grep -rl "AudioContext" src resources    # 空
$ grep -rl "PRESET_READ_ONLY" src resources # 空
$ grep -rl "nonChat" src resources         # 空
$ grep -rl "McpOAuthCredential" src resources # 空
```

## 输出要求

- 报告中文，Markdown 表格为主，**每条结论带 `路径:行号` 证据**，读不到就写「未找到」，不推测。
- 每节结尾给「建议动作」表：动作 | 类型 | 价值 | 代价 | 落点 | 依据。
- **本轮不改任何产品代码**，只写 `docs/compare/pi-agent-desktop-pi-desktop-2026-10-16/**`。
