# PI NEXT v0.1.8

这一版把三件积压的事一起收了：**手机端从「同构」改成「按得准」**、**定时任务与三条入站渠道接进来**、
**一批字号与布局的真缺陷修掉**。桌面形态一字未动。

## 新增

- **手机「更多动作」宫格**：窄屏下顶栏放不下的动作（调用轨迹、生成标题、子代理、分支、
  导出 HTML / Markdown、发送图片）搬进输入卡上方的七格宫格，每格带文字标签，
  不用再猜图标是什么。
- **手机顶栏会话身份副行**：`目录名 · 上下文 N%`，一眼看到「我在哪个目录、还剩多少上下文」。
- **定时任务**：无人值守自动运行，每一轮开一个子会话，工具调用自动放行。
  设置里新增「定时任务」分节，可配提示词、模型、间隔、星期与具体时刻，并保留运行历史。
- **三条入站渠道**：Telegram、微信、飞书 / Lark。扫码即用，不用预建应用；
  首个发信人自动绑定，之后只有白名单里的人能开 agent 会话。
- **出站推送**：飞书、企业微信、钉钉、Slack、Telegram + 自建 webhook，agent 可以主动给你发消息。
- **手机扫码连接**：第一次打开「手机与推送」即生成访问令牌并显示二维码 / 6 位配对码，
  开关一点真生效，不用敲命令行。
- **agent ↔ agent 信箱**：`agent_mail` 一个工具补齐子→父、兄弟之间、父→全体三个方向
  （原来只有父→子），对方会话当下不在线时信也不会丢。
- **MCP 换成 pi 1.0 官方原语**：配置读写、校验、OAuth 全部走官方实现，
  并支持从其他 agent（Claude Code / Codex / Cursor / VS Code）发现并合并已有 server。
  另补 codemode / tool-search 曝光、密钥掩码、三种导入来源、撤销与连接日志。
- **「使用默认目录」**：按天开一个新文件夹，第一次用的人不会落进一个已经堆着数据的目录。
- **Mac 拟物材质皮肤**：实板质感而非玻璃，夜间端强调色重新调过以通过对比度要求。

## 修复

- **手机上控件「点不准」**：多处按钮命中区偏小（关闭钮 11px、概览钮 28px、页头裸钮 24px、
  底栏手机钮 22px），现已全部扩到手指够得着的尺寸，界面大小不变。
- **两条工具条盖住内容**：窄屏顶栏那条覆盖会话标题、输入区行二那条把上下文环与声音藏起来，
  已拆除并改为常驻行。
- **横屏矮屏工具条换行**：横屏下高度本该是稀缺资源，之前实测在 390 高的屏里被两行占掉约 150px，
  现在恒为单行。
- **正文字号显示与渲染不一致**：设置里显示 13px、正文实际按 14px 渲染，已并回设计五档。
- **定时任务面板太局促**：提示词框被压成 28px 单行、数字输入被拉满整列、星期芯片没有间隙、
  运行历史是裸列表，现已全部修正，并清掉四处重复文案。
- **侧栏列表下拉刷新**：手机上原来只有运行态轮询，PC 上新开的会话没有刷新口。
- **9 个复制按钮缺失败反馈**；**9 处指针点了没反应**（MCP / 插件图标、⋯ 菜单里的系统提示词
  与工具定义等）已逐个定位并修复。
- **配置监听测试随机红**：`fs.watch` 在负载下会丢事件，改为「等条件 + 重发」。
- **合并丢注释、残留死样式**：已恢复注释并清理无用 CSS。

## 移除

- **「任务与日程」工作区**：功能回到输入框左上角的待办，中间那个吸底浮层撤掉。
- **「项目知识」与「思考档 token 预算」**两个分节。
- **变更来源面板**：右栏已有 git 图谱页在渲染同一批数据。
- **⋯ 菜单里的「前往配置」与「调用轨迹」**两个重复入口（已在设置与宫格里）。
- **tab 的重复渲染**（调用轨迹与 git 图谱各渲两份），并加了计数断言防再犯。

## 已知

- 定时任务的星期芯片选中态这一节不在设计画板内，形态以界面实际为准。
- 桌面包（DMG）**本版没有重新打包** —— 这一版是源码发布，装桌面版请等下一次打包。

---

## English

This release takes care of three backlogged items at once: **mobile went from "isomorphic" to "accurately tappable"**, **scheduled tasks and three inbound channels are wired in**, and **a batch of real font-size and layout defects are fixed**. The desktop form is untouched, down to the word.

### Added

- **Mobile "More Actions" grid**: actions that don't fit in the top bar on narrow screens (call trace, generate title, subagents, branch, export HTML / Markdown, send image) move into a seven-cell grid above the input card, each cell with a text label, so you no longer have to guess what an icon is.
- **Mobile top-bar session identity subrow**: `directory name · context N%`, showing at a glance "which directory I'm in and how much context is left".
- **Scheduled tasks**: run automatically unattended, opening a sub-session each round with tool calls auto-approved. A new "Scheduled Tasks" section in Settings lets you configure the prompt, model, interval, day of week, and exact time, and keeps run history.
- **Three inbound channels**: Telegram, WeChat, Feishu / Lark. Works right after scanning a QR code, no pre-built app needed; the first sender is bound automatically, and afterward only people on the allowlist can start agent sessions.
- **Outbound push**: Feishu, WeCom, DingTalk, Slack, Telegram + self-hosted webhook, so the agent can proactively send you messages.
- **Mobile QR-code connection**: opening "Mobile & Push" for the first time generates an access token and displays a QR code / 6-digit pairing code; the toggle takes effect immediately with one click, no command line needed.
- **agent ↔ agent mailbox**: a single `agent_mail` tool fills in the three directions child→parent, sibling↔sibling, and parent→all (previously only parent→child); messages are not lost even when the other session is currently offline.
- **MCP switched to pi 1.0 official primitives**: config read/write, validation, and OAuth all go through the official implementation, and it supports discovering and merging existing servers from other agents (Claude Code / Codex / Cursor / VS Code). Also added codemode / tool-search exposure, secret masking, three import sources, undo, and connection logs.
- **"Use Default Directory"**: opens a new folder per day, so first-time users don't land in a directory already piled with data.
- **Mac skeuomorphic material skin**: a solid-panel feel rather than glass, with the dark-mode accent color retuned to pass contrast requirements.

### Fixed

- **Controls were "hard to hit" on mobile**: hit areas on many buttons were too small (close button 11px, overview button 28px, bare header button 24px, bottom-bar phone button 22px); all are now enlarged to finger-reachable sizes without changing the visual size.
- **Two toolbars covered content**: the narrow-screen top-bar strip covered the session title, and the input-area second row hid the context ring and sound; both were removed and changed to always-on rows.
- **Toolbar wrapping on short landscape screens**: in landscape, height should be a scarce resource; testing previously showed two rows eating about 150px on a 390-tall screen, and now it is always a single row.
- **Body font-size display did not match rendering**: Settings showed 13px while body text actually rendered at 14px; this has been merged back into the five design tiers.
- **Scheduled-task panel too cramped**: the prompt box was squeezed to a 28px single line, number inputs stretched to fill the whole column, day-of-week chips had no gaps, and run history was a bare list; all are now corrected, and four duplicated pieces of copy were cleared out.
- **Sidebar list pull-to-refresh**: on mobile there was previously only running-state polling, and newly created sessions on PC had no refresh entry point.
- **9 copy buttons lacked failure feedback**; **9 places did nothing when clicked** (MCP / plugin icons, the system prompt and tool definitions in the ⋯ menu, etc.) and were located one by one and fixed.
- **Config-watch test randomly red**: `fs.watch` drops events under load; changed to "wait for condition + resend".
- **Merge dropped comments and left dead styles behind**: comments were restored and unused CSS cleaned up.

### Removed

- **The "Tasks & Schedule" workspace**: the functionality returns to the to-do in the top-left of the input box, and the bottom-sticky overlay in the middle is removed.
- The two sections **"Project Knowledge" and "Thinking-tier Token Budget"**.
- **The change-source panel**: the right column already has a git graph page rendering the same data.
- The two duplicate entries **"Go to Settings" and "Call Trace"** in the ⋯ menu (already in Settings and the grid).
- **Duplicate tab rendering** (the call trace and git graph each rendered twice), and a count assertion was added to prevent recurrence.

### Known

- The selected state of the scheduled-task day-of-week chips is not in the design artboards; its form is as actually shown in the interface.
- The desktop package (DMG) **was not repackaged for this release** — this is a source release; please wait for the next packaging to install the desktop version.
