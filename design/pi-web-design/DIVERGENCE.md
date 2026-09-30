# 设计与实现的偏离清单

> 本文件记录**本设计系统与 Pi Web 现有实现不一致的地方**，一条一行：
> 设计画的是什么、实现是什么、为什么、以哪边为准。
> 这些条目**不要求回补画板**，它们是「设计先走一步」的提案，等裁定后再决定是否落地。
> 画板清单与计数以 [`README.md`](README.md) 为准；本文只在它之上加一层「这一处已经和代码不一样」的注记。

## 怎么用

- **看画板之前先看本文**。画板是本设计系统想要的形态；下面列到的几处，代码里**还不是这样**。
- 新增偏离时追加一行。格式：`编号 · 画板画的是什么 → 实现是什么（为什么）`。
- 本文收的是三类既成事实：**A 设计有意偏离实现**（提案）、**B 画板简化**（画板画得比实现简单）、
  **C 实现有意少做**（画板画了、实现暂时做不到）。

---

## A · 设计有意偏离实现（提案，待裁定）

1. **整体视觉系统换血**：画板采用参考项目的路线——中性色阶 10 级单色相、**强调色只有一个** `#5566d8`、
   语义色四个、**圆角 3/4/6**、字阶 5 档、控件高度 24/28/32、图标统一 lucide。
   现有实现是 BoardUI/Zeno 血统：圆角 4/6/10/12/24 五档、字号 8 档、控件高度 5 档、
   主题六套（Light/Dark/System/Mist/Rose/Pine）+ 皮肤工作室可自定义四色。
   **以设计为准的方向**是收敛；但皮肤工作室的能力（自定义强调色）与本规范的「单一强调色」直接冲突，
   需要所有者裁定：是保留皮肤自由改色、还是把皮肤限制在 token 允许的范围内。

2. **应用标记改单色 —— 已作废（2026-09-30）**：设计稿曾主张壳内标记用单色 π（`--n-strong` + 一个 `--accent` 锚点），
   理由是「本规范只留一个强调色」。现所有者直接交付了**多色渐变**的 PI NEXT 标识
   （`public/pi-next-logo.png` + `public/pi-next-wordmark.png`，出处 `brand/pi-next-brand-board.png`），
   该提案作废，`brand/app-icon.svg` 已删。
   **以所有者的标识为准**：标记与字标是位图原图直出，不进 token 体系；
   唯一的实现妥协是字标只在浅色主题用图（深色主题回落实色文字），原因见 `brand/README.md`。

3. **工具调用收成过程时间轴**：参考项目把每个工具调用画成独立卡片；本设计**沿用本项目现有的
   `ProcessGroup` 形态**（一条竖线串起的步骤流 + 汇总行），只在视觉上重做。
   这与参考项目画板 18/19 的形态不同，是有意选择：省纵向空间、失败行能就地标红。

4. **权限卡用强调色边框 + 淡底**：本规范 § 1.2 说卡片一律 1px 发丝边框、无彩色。
   权限卡是唯一例外（还有子代理卡的 2px 左侧强调线）。理由：它是唯一需要抢注意力的卡，
   且与「等你处理」的 warning 色在语义上要区分开（一个是「需要你决策」，一个是「提醒你去看」）。

5. **设置从 4 块扩成 13 分节**：参考项目的设置只做四块（agent 配置 / 从 Zed 导入 / Node 运行时 / 数据目录）。
   本项目的设置实际有 13 个分节（含定时任务、记忆、快捷键、用量、自定义命令、归档、导入），
   设计把它们拆成 8 张画板（`40`–`47`）。这不是偏离实现，是**实现比参考项目复杂得多**。
   〔2026-09-30 部分过时〕用户裁定去掉「键盘快捷键」一节，现为 **12 分节**；
   画板 45 的快捷键帧失去产品对应（见第 113 条）。

6. **`@` 引用菜单扩成四类**：参考项目只有「文件 / 文件夹 / 最近」。
   实现有「文件 / 会话 / MCP / Todos」四类（`ComposerReferenceMenu`）。设计按实现画。

---

## B · 画板简化（画板画得比实现简单）

7. **Mermaid 图用静态占位**：画板里 Mermaid 只画一个「图形态 / 源码态」的静态示意，
   不真的渲染图。实现用 `MermaidBlock` 真实渲染（含 elk 布局）。

8. **图片预览用 CSS 占位**：规范 § 3 禁用图片素材，所以图片块用斜纹占位 + 文件名，
   不放真图。实现里是真实图片预览。

9. **壁纸缩略用色块**：内置壁纸选择器在画板里用纯色块示意，不放真实壁纸图。

10. **用量图表用 CSS 柱条**：用量页的热力图 / 趋势图用 `flex` 柱条示意，
    不用图表库。实现用的是真实图表组件。

11. **终端 / Git 图用静态样例**：终端输出与 Git 泳道是写死的样例文本，
    不接真实数据。

---

## C · 实现有意少做（画板画了、实现暂时没有）

12. **回合结束行**：画板 `12-transcript-interactive.html` 画了完整的回合结束行
    （`stopReason 徽章 · 耗时 · in/out · 成本`）。实现里这一行**部分缺失**——
    现有 `ProcessGroup` 有汇总行与耗时，但 stopReason 徽章与成本需要确认是否已在
    `MessageView` 里输出。这一条要核对后再决定是否立项。

13. **上下文环的三档配色**：画板把上下文占用环画成三档（正常 accent / >70% warning / >90% error）。
    实现的 `SessionStatsBar` 是否已按阈值变色，需要核对。

14. **工具定义面板的参数表**：画板 `22-top-panels.html` 画了工具详情里的
    「参数 / 必需 / 允许值 / 默认值」四列表格。实现 `ToolDefinitionsPanel` 有列表与详情，
    参数表的字段完整度需要核对。

15. **壳级通知条（toast）—— 全新提案，代码里完全没有**：全仓（`components/` `lib/` `app/` `hooks/`）
    搜不到任何 `toast` / `notice` 实现，也没有 `aria-live` / `role="alert"`。
    画板 `12-transcript-interactive.html` 与 `50-dialogs.html` 里的通知条三态是**新设计**，
    对应的是现在只进日志的那些 `lastError`（新建/删除会话失败、附件超限、载不回历史、开终端失败…）。
    落地前要确认：是新增一层 toast，还是把这些错误收进转录（现在的做法）。
    （2026-09-28 覆盖审计时发现）

16. **会话导出为 HTML 的入口**：`app/api/sessions/[id]/export/route.ts` 存在，
    画板 `51-menus.html` 的会话行菜单里画了「导出为 HTML」这一项。
    现有 UI 是否已经有入口需要核对——如果只是 API 存在而界面没有，这一项属于提案。
    （2026-09-28 覆盖审计时发现）

17. **移动端与 PWA 的形态是提案**：实现里确实有 `useIsMobile` / `useIsNarrowMobile` /
    `useIsCompact` 三档、`mobileToolbarMoreOpen` 的「更多控件」、`@media (display-mode: standalone)`、
    `@media (pointer: coarse)`、`PwaRegistration` 与 `app/manifest.ts`，
    但**没有任何一屏的移动端视觉基准**。画板 `60-mobile-pwa.html` 是本设计系统第一次给出：
    抽屉侧栏、移动端顶栏 48、覆盖式工具条、安全区、四档断点表。
    **移动端与桌面完全同构**（用户裁定）：不新增底部控件条、不新增底部弹层。
    其中「移动端信任横幅（不弹模态框）」是**新增元素**，实现里没有。
    （2026-09-28 覆盖审计时发现；同日后修订把「底部控件条 / 底部弹层」删掉）

---

## D · 2026-09-28 第五轮新增（用户四条意见的落地记录）

18. **登录已从画板彻底删除**（用户裁定「我这个项目没有登录」）。
    `50-login-dialogs.html` → `50-dialogs.html`（编号不动），整段登录页三态删除；
    `40-settings-general.html` 删掉左导航末位与「常规（续）」两处「退出登录」。
    **实现侧尚未删**：`app/login/page.tsx`、`app/api/web-auth/route.ts`、`proxy.ts:33` 起的密码分支、
    `components/SettingsPanel.tsx:915` 的退出登录块都还在。要落地见 `docs/design-system-refactor-plan-2026-09-28.md` 的 PR-02。

19. **目录选择器改成「系统原生优先」**（用户裁定「直接调用系统文件选择器就行」）。
    画板 `50` 的目录段拆成 C（系统原生选框 + 固定决策链）/ D（自绘浏览器，降级态）。
    **这一条是实现早已先行、画板落后**：`lib/pick-directory.ts` 的头注释写着「优先系统原生选择器」，
    `app/api/cwd/pick/route.ts` 在 macOS 走 `osascript choose folder`、Windows 走 `PowerShell FolderBrowserDialog`、
    Linux 走 `zenity / kdialog / yad`，不可用时返回 `501 {fallback:true}`。
    **旧画板整条主路径都没画**，只画了浏览器回退那一屏。

20. **动效从「一张规格表」变成「十七项真在播的清单」**（用户裁定「动效都没有，都是假的」）。
    `05-motion.html` 重写；`assets/board.css` 新增动效包（20 个 keyframes + 演示台 + `prefers-reduced-motion` 全量兜底）；
    `01 / 11 / 12 / 20 / 40 / 60 / 61` 七张画板各加一段真在播的「本页动效」；`00` 的按钮四态改成可交互。
    **实现侧的对应**：`app/*.css` 里已经有 14 个 `@keyframes` 与 13 处 `prefers-reduced-motion` 兜底，
    但**没有任何一处引用设计 token**（实现用的是 `--motion-fast: 120ms` / `--motion-base: 150ms` /
    `--motion-slow: 250ms` / `--motion-instant: 90ms`，与设计的三档 + 一档布局对不上）。
    要落地见改造计划的 PR-07。

21. **回合结束行的 `stopReason` 词表已改对**（旧版抄的是参考项目的 ACP 词表）。
    pi 的真值：`pending / stop / length / toolUse / error / aborted / deferred`
    （`@earendil-works/pi-ai/dist/types.d.ts:292`）。这条**不要求回补参考项目**——参考项目根本不用 pi。

22. **补 4 处漏画**：Mermaid 全屏缩放（`10`）、文件查看器的 diff 覆盖层（`52`）、
    文件被删除提示（`52`）、文件实时同步指示（`30`）。证据见 `README.md` 的「第五轮」段。

---

## E · 2026-09-28 第六轮：按本规范落地实现侧的缺口

> 这一轮把画板当验收基准，把「设计画了、实现没有 / 不一致」的地方逐条落到代码。
> 每条写明改了哪个文件；仍存在的偏差照旧登记在 29。

23. **PR-11 回合结束行已落地**（原 C-12 的结论是「部分缺失」）。
    `components/MessageView.tsx` 新增回合结束行：按 `stopReason` 分色的徽章
    （`stop`=success / `length`=warning / `error`=error / `toolUse`=accent /
    `aborted`·`deferred`·`pending`=中性）+ 耗时 + 用量 + 成本 + 非正常结束的人话解释。
    旧的「输出被上限截断」告警块撤掉（由 `length` 徽章 + `chat.truncatedByOutputLimit` 接管）；
    provider 错误告警框保留（它带 `role="alert"` 与链接解析）。

24. **C-15 通知条参数已对齐**：`hooks/useAgentSession.ts` 的
    `MAX_NOTICES 5 → 3`、`NOTICE_VISIBLE_MS 5000 → 6000`（画板 50：最多 3 条、6 秒自收）。

25. **C-16 会话导出 HTML 入口已补**：`components/SessionRowContextMenuBridge.tsx`
    新增「导出为 HTML」项，复用既有 `/api/sessions/[id]/export?inline=1`。

26. **PR-27 移动端尺寸已对齐**：`app/globals.css` 新增 `--topbar-icon-size`
    （桌面 28 / ≤1024 36），`--height-toolbar` 46 → 桌面 36、≤1024 48；
    桌面滚动条 10 → 8px；`--motion-sheet` 落到 `fork-sheet-up`（抽屉上滑 14px）。

27. **PR-05 动效 token 全部落到产品**：`--motion-rise` / `--motion-transition`
    （切会话整块替换 200ms + 8px，`fork-turn-enter`）、`--motion-stream`
    （过程步骤入场 4px）、`--motion-stagger`（空态首屏三层错开，封顶 3 项）、`--motion-sheet`。

28. **PR-04 图标位符号清零**：`✓ ⚠ ↑` 等 8 处印刷符号换成内联 lucide SVG
    （`AppShell` / `NewTaskPicker` / `fork/TodoChip` / `SkillsConfig` /
    `PluginsConfig` / `ChatMinimap` / `MessageView`）。

29. **仍存在的形态偏差（登记，不阻塞）**：
    - 工具定义参数表：实现是「名字列 + 值列」两列（`components/ToolDefinitionsPanel.tsx`），
      画板 `22` 是「参数 / 类型 / 必需 / 允许值·默认」四列表格。**信息等价**（required、enum、default 都有），
      只是排版不同；两列版还多带了字段描述，强行压成四列会丢描述，故保持现状。
    - 迷你地图导轨：已从 `22×3` 短线改成 6px 圆点（当前节点 8px 转 accent），
      但画板的「标题节点用 muted 区分」没有做——`ChatMinimap` 的节点数据里没有 kind 字段，
      要做需要先给回合数据加类型。

30. **其余按画板对齐的零散项**：文件同步点 7 → 6px（`globals.css`）；
    迷你地图行 hover 3% → 6%（`ChatMinimap.module.css`）；上下文环正常态改强调色
    （`SessionStatsBar.tsx`）；「回到底部」不再用胶囊圆角（`globals.css`，改 `--radius-sm`）；
    空态首屏照画板 `01` 重做（`fork/NewSessionHome.tsx`：mark 40×40、标题 20px·500、
    提示带 kbd、起始卡 2×2 带描述）；侧栏尺寸照 §2.2 改成默认 280 / 可拖 220–480
    （`lib/panel-layout.ts`）；字体栈换成 Geist + Geist Mono（`app/layout.tsx`、`globals.css`）；
    顶栏 36 / ≤1024 48、图标按钮 28 / ≤1024 36（`globals.css`、`AppShell.tsx`）。

31. **输入框下方的统计条与画板 `20` 冲突（需要裁定）**：画板 `20` 与规范 §2.7 要求
    「用量不进长条：输入框下面没有第二条横条，用量收进左下角的上下文圆环，悬浮才展开浮窗」。
    实现里 `SessionStatsBar` 是 composer 下方一条**常显**统计条，这是更早的用户要求
    （`fork:ui-stats-inline` 的注释：「token 统计不该藏在 hover 门里」）。
    两条要求直接冲突，本轮按 §2.1「只重做视觉、结构照现有实现」**保留常显条**，
    只把它的配色对齐（见 30）。若要按画板收进圆环浮窗，需要所有者裁定后再动结构。

---

## F · 2026-09-28 第七轮：组件改为「直接引用」模式（用户裁定，覆盖桥接路线）

> 用户裁定：不要「照截图仿写」，要**直接使用设计文件夹里的组件代码**。
> 自本轮起路线变更：设计资产原样进运行时，产品 DOM 直接挂画板类名，视觉一字不差来自 `board.css`。

32. **设计资产原样进运行时（零复制、零修改）**：`app/layout.tsx` 直接
    `import "../design/pi-web-design/assets/tokens.css"`（board.css 依赖的无前缀变量）
    与 `import "../design/pi-web-design/assets/board.css"`（全部 pw-* 组件样式）。
    `assets/icons.js`（lucide 路径表 + hydrate）由 `components/PwIcons.tsx` 引入 client bundle，
    MutationObserver 兜住流式渲染新增的 `<i data-ico>` 节点。
    引入顺序在 globals.css 之前，globals 的 `--font-ui/--font-mono` 按序覆盖（next/font 注入），
    其余同名变量两边值一致。

33. **已替换成画板原件的组件（第七轮续，共 14 个）**：
    - 回合结束行 → `.pw-turn-end` + `.pw-badge(.ok/.warn/.bad/.accent)` + `i[data-ico]`（`MessageView.tsx`）
    - 空态首屏 → `.pw-empty` / `.pw-empty-inner` / `.mark` / `.pw-starters` / `.pw-starter` / `.pw-kbd`（`fork/NewSessionHome.tsx`）
    - 通知条 → `.pw-toast` + `.bad/.warn/.ok` 三色 + 图标首行对齐（`ChatWindow.tsx`）
    - 发送 / 停止 → `.pw-send` / `.stop` / `.disabled`，图标 arrow-up / square（`ChatInput.tsx`）
    - 上下文环 → `.pw-ring` + `.warn` / `.bad` 三档（`SessionStatsBar.tsx`）
    - 附件按钮 → `.pw-iconbtn` + `.is-on`（`ChatInput.tsx`）
    - **代码块 → `.pw-code` + `.pw-code-head` + `.pw-btn.sm` 复制钮（Copy→Copied 换 check 图标）**（`MermaidBlock.tsx` 的 CodeBlock）
    - **GFM 表格 → `.pw-table`**（`MarkdownBody.tsx`）
    - **composer 工具栏五控件 → `.pw-select`**：思考（brain）/ 权限（shield / shield-check / book-marked）/ 工具档（wrench）/ 压缩（minimize-2 / loader-circle，进行中转 error 色）/ 模型触发钮（`ChatInput.tsx`、`ModelSelector.tsx`）
    - **声音开关 → `.pw-iconbtn`（volume-2 / volume-x）**（`ChatInput.tsx`）
    - **两个工具下拉 → `.pw-pop` + `.pw-prow(.is-on)`**，对勾用 `i[data-ico=check]`（`ChatInput.tsx`）
    - **计划条目 → `.pw-todo(.done/.now)` + `.pw-badge.accent`**（`fork/TodoChip.tsx`）
    - 引入顺序调整为 board.css 在产品样式之后（同元素上画板规则覆盖实现），fork-ui.css 仍保持最后。

34. **第八轮续：顶栏动作钮全部换成画板 `.pw-iconbtn` + `data-ico`**（`AppShell.tsx`）：
    历史=history、生成标题=loader-circle/check/wand-sparkles 三态、子代理=bot（数量徽标保留）、
    分支=git-branch、系统提示词=file-text、工具定义=wrench、导出 Markdown=download、
    窄屏「更多控件」=ellipsis/x；工具卡 → `.pw-card` + `.pw-card-head` + `.pw-tool`/`.pw-path`
    （`MessageView.tsx` 的 ToolCallBlock，收起态保持时间轴行的透明形态，与画板「时间轴是收起形态」一致），
    chevron 与子代理打开钮也换 `data-ico`。
    **探测验证**（playwright）：顶栏 7×`.pw-iconbtn`、5×`.pw-select`、`i[data-ico]` 全部 hydrate。

35. **第九轮续（2026-09-28 晚）**：
    - 压缩卡 → `.pw-compact` + `data-ico=chevron-right`（`MessageView.tsx` 的 CompactionMessageView，
      顺带清掉违规的 `fontWeight: 650`）
    - 终端卡 → `.pw-term` + `.pw-card-head` 头部，重连/重启钮换 `data-ico=link/rotate-cw`（`TerminalPanel.tsx`）
    - 标签条 → 容器 `.pw-tabs`、标签 `.pw-tab(.is-on)`（`TabBar.tsx`，拖拽/溢出折叠逻辑不变）
    - 扩展请求对话框 → `.pw-modal` + `.pw-modal-head`，选项按钮 `.pw-btn.outline`（`ChatWindow.tsx`，
      顺带清掉 `fontWeight: 650`）
    - 设置壳 → `.pw-modal` + `.pw-modal-head` + `.pw-settings`，关闭钮 `.pw-iconbtn`+`x`
      （`SettingsPanel.tsx`；该文件有「零 inline style」纪律守卫，替换时不得加 style）
    - 文件树行 → `.pw-trow` + `data-ico=chevron-right`（`FileExplorer.tsx`）
    - **Git 图不换**（`.pw-git` 是静态泳道文本的 grid 形态，产品的自绘 SVG 泳道布局不适配；
      泳道色已取自 `--accent`，视觉同源）——登记，不改。
    - **探测验证**：5×`.pw-trow`、7×`.pw-iconbtn`、5×`.pw-select`、`i[data-ico]` 全部 hydrate。

36. **第十轮（收尾）**：
    - **用户气泡 → `.pw-msg-user`**（右对齐 78% / 发丝边框 / 面板底 / radius-6，
      删掉 inline 的背景/边框/阴影/盒样式；`MessageView.tsx` 的 UserMessageView）
    - **输入框外壳 → `.pw-composer`**（面板底 / 发丝边框 / radius-6 / 弹层阴影来自类；
      compact 阅读态与 bash/流式边框色作为状态覆盖保留；`ChatInput.tsx`）
    - **顶栏容器 → `.pw-topbar`**（36px / 发丝底线；`AppShell.tsx` 主区顶栏；
      右栏 40px pane header 形态不同不挂）
    - **侧栏会话行追加 `.pw-session`**（48 行高 / radius-4 / hover 叠色 / `.is-on`；
      运行扫掠线与「等你处理」底边线仍由 fork-ui.css 的 `.is-running/.is-awaiting` 承载）
    - ~~**设置分节内容不换**（settings.css 的 154 个 `config-*` 类已完整承载分节样式，
      且引入顺序在 board.css 之后，逐类追加 pw 会被压掉，维持现状）~~ ——
      **〔已过时〕分节结构基件已改挂 `pw-*`**：设置壳与分节骨架（`.pw-modal` / `.pw-modal-head` /
      `.pw-settings` / `.pw-side-nav` / `.pw-snav` / `.pw-snav-close` / `.pw-sec-title` / `.pw-field` /
      `.pw-label` / `.pw-input` / `.pw-switch` / `.pw-range` / `.pw-radio` / `.pw-seg` / `.pw-kbd`）都已是
      画板原件，`config-*` 只剩内容级细节。逐类追加被压掉的问题已通过调整引入顺序解决。
    - **探测验证**：3×`.pw-msg-user`、1×`.pw-composer`、1×`.pw-topbar`、5×`.pw-trow`、
      7×`.pw-iconbtn`、5×`.pw-select`、`i[data-ico]` 全部 hydrate。
    - **累计 32 个组件/壳直接使用画板原件**。

37. **最终剩余（视觉已同源 token，属形态差异或归属迁移收益为零，全部登记不阻塞）**：
    子代理独立卡（`.pw-sub`——产品以工具卡徽标呈现）、diff 分栏词级视图（自有实现，
    颜色走 `--diff-*`）、Git 图（SVG 泳道）、侧栏会话行运行态细节（fork-ui.css 扫掠线，画板 02 同源）。
    ~~设置分节内容（`config-*` 154 类承载）~~ 已按上一条作废。

---

---

## 附 · 与现有 `design/round-design/` 的关系

本目录**不替代** `design/round-design/`，两者的来源不同：

| | `design/round-design/` | `design/pi-web-design/`（本目录） |
|---|---|---|
| 来源 | 从**产品现有 token** 反向提炼（`board.css` 头部注明） | 从**参考项目**的规范正向重建 |
| 圆角 | 10 / 12 / 24（跟产品走） | 3 / 4 / 6 |
| 强调色 | 产品 accent 槽位（可被皮肤改） | 固定 `#5566d8` |
| 图标 | 混用 emoji 与手绘 SVG | 一律 lucide |
| 用途 | 记录「现在长什么样」 | 提出「应该长什么样」 |

**两者冲突时以本目录为准**（本目录是提案），但落地前必须走裁定。
`design/round-design/` 里的 `02-workbench-running.html` 用了 emoji，本目录的对应画板已全部换成 lucide。

---

## G · 2026-09-29 第八轮：工作台（画板 01）按「原结构替换」重做

> 用户裁定：不要「给现有 DOM 挂画板类」，要**照画板的 DOM 结构替换**。
> 上一轮（F 节）是「加类」路线，结果凡是画板依赖**直接子元素**的组件（过程时间轴、
> 会话行的动作组、输入框的三段结构）都错行了 —— 这一轮改成「画板怎么写，DOM 就怎么长」。

38. **侧栏壳按画板 01/02 重建**（`SessionSidebar.tsx`）：`.pw-side` 由 AppShell 提供，
   内部依次是 `.pw-side-head`（`.pw-brand` + `.pw-logo` + 搜索 / 折叠 `.pw-iconbtn`）、
   `.pw-side-nav`（`.pw-row` 新建任务）、`.pw-seg`、`.pw-side-search`（**只在搜索态出现**，见下方第十二轮 52 条表格里的帧 C）、
   `.pw-side-scroll`、`.pw-side-foot`（设置 + 版本徽章）。
   ~~搜索不再藏在图标后面：画板画的是常显一格~~ —— **〔已过时〕**：画板 `02` 的帧 A（项目 pane）本来就没有
   搜索格，`.pw-side-search` 只出现在帧 C（搜索状态）。产品曾按「常显」实现，导致「默认」与「搜索中」
   在界面上不可分、搜索框白占一行高度并一直挂着焦点环；现已改回「默认收起、点搜索才展开并聚焦」。
   折叠导轨的「设置」也搬进 `.pw-side-foot`（原来在 AppShell 的 `.fork-rail-footer`）。

39. **会话行 / 项目行 / 分组头**：`.pw-session(.child/.running/.awaiting/.is-on)` +
   `.pw-body`/`.pw-t`/`.pw-m`/`.pw-dot`/`.pw-await`/`.pw-acts`，项目行 `.pw-row` +
   `.pw-name` + `.pw-count` + `.pw-acts`，分组头 `.pw-group-title`。
   删除 `fork-ui.css` 里整段重复的 `.fork-session-*`（它与 `.pw-session` 是同一套值的第二份拷贝）。

40. **过程时间轴按画板 11 的 DOM 重写**（`ProcessGroup.tsx`）：步骤行**就是** `.pw-step`
   （`button.pw-step`，icon/verb/arg/grow/dur 是它的直接子元素），展开正文是它的**兄弟**
   而不是子元素 —— 塞进行里会把行的 flex 布局挤成两列（上一轮的错行就是这个原因）。
   外壳是 `.pw-proc` + `.pw-proc-head`（计数汇总 + `.pw-badge` 进行中/已完成/失败）+ `.pw-proc-body`。
   删掉 `globals.css` 里自绘的竖线 + 肘形连接线那一段。

41. **输入框按画板 20 的三段结构**：`.pw-composer` > `.pw-chips`（工作区芯片）+
   `.pw-composer-top`（输入区，内边距 12/12/6、最小高 46）+ `.pw-composer-bar`
   （附件 · 模型 · 思考 · 权限 · 工具档 · 压缩 ｜ 环 · 声音 · 发送）。
   实测 `.pw-composer` 从 66px 变成与画板一致的 **800×88**。
   思考 / 权限 / 工具档 / 压缩从右侧组搬到左侧组（画板的顺序），窄屏折叠逻辑不变。

42. **上下文环进输入框工具条**（`.pw-ring` + `.pw-pop` 浮窗）：悬浮或键盘聚焦才展开，
   给出 Context / 本轮 ↑↓ / 花费 / 结束原因 + 「压缩上下文」。统计条改为
   **自己占一行**贴在输入框下方（`.pw-stats`），不再塞在扩展状态条的 trailing 槽里与它挤同一行；
   折叠行按画板只留四格（上下文 · 本轮 · 花费 ｜ 耗时），总计与缓存命中率进展开面板。

43. **回合结束行按画板 12 的词表**：`↑ 8,912 · ↓ 1,328 tok` + `$0.021` 两格分开
   （原来写成 `17,043 in · 70 out`），缓存读写不再混在这一行。

44. **右栏挂画板件**：容器 `.pw-panel`、头行 `.pw-panel-head`（高度 `--topbar-height` 36，
   原来是 40）、主体 `.pw-panel-body`；文件面板头行 `.pw-panel-head` + 动作钮全换 `.pw-iconbtn.sm`。

45. **顶栏**：`.pw-topbar` 去掉自绘底线（用 board.css 的），标题 `.pw-tb-title` +
   `.pw-chipbtn`（有会话给分支，没有会话给工作区目录）。空会话时**不再隐藏顶栏**
   （画板 01 帧 A 就画着它）。

46. **产品侧接线集中到一个 CSS 块**（`fork-ui.css` 末尾）：只做「画板里的 div/span →
   产品里的 button/input」这一层 UA 归零与 cursor，**不重复写任何颜色 / 尺寸 / 间距**。
   视觉值只有一个来源：`board.css`。

47. **仍存在的形态偏差（登记，不阻塞）**：
    - ~~工作区（分支）行在侧栏滚动区的顶部~~ → **已落地，见 48**。
    - `.pw-panel` 的「文件头行 + 标签行 + 树/查看器分栏」三行结构：产品是「标签行即头行」，
      树与查看器互斥（没有画板那种左树右查看器并排）。要看文件时才并排（`explorer-column`）。
      分栏态树列被旧负偏移顶出面板体的 bug 已修（见 48）。
    - 扩展状态条（MCP / ponytail）画板 01 没画；它是本产品自己的东西，暂留。

48. **第九轮续（2026-09-29，浮窗遮挡与错位专项，G-47 遗留收尾）**：
    - **G-47-1 分支行位置已落地**：工作区（分支）行挪到**选中项目行下面**（`SessionSidebar.tsx`）。
      原来登记的「要改虚拟列表槽位计算」其实是过虑——分支行插在虚拟列表容器**之前的普通流位置**，
      列表内部的绝对定位槽位不受影响。仅当选中项目处于展开态时渲染（画板 02 的画法）；
      `inactiveWorktreeSelector` 引导行随之同址。
    - **浮窗被遮挡的根因**：board.css 的 `.pw-composer { overflow: hidden }`（为裁圆角）把输入框里
      所有向上弹的浮层裁掉——实测上下文环浮窗（`.pw-pop`，高 201）只露出卡片内的一角
      「压缩上下文」一行。修复（`fork-ui.css`）：`.chat-input-shell.pw-composer { overflow-x: clip;
      overflow-y: visible }`——竖向放行（环浮窗 / 思考 / 工具档下拉 / @ 与 / 菜单全部浮出卡片），
      横向保留「工具条塞满裁行尾」的语义；0-2-0 特异性压过画板 0-1-0，与引入顺序无关。
      **画板 01 帧 C 自己的浮窗演示同样会被这条规则裁掉**——画板缺口，登记不回补。
    - **思考 / 工具档下拉改为无条件左缘锚定**（`ChatInput.tsx`）：原 `narrowControls ? left : right`
      的右缘锚定会把 320 宽的浮窗探出卡片左缘，被 `overflow-x: clip` 横向裁掉（实测超出 151px）。
      左锚后从触发点向右展开，实测全部落在卡片内。
    - **窄聊天列发送钮消失**：右栏 + 树列把聊天列压到 ~350px（视口 1440 也会发生），工具条右侧组
      （环 / 声音 / 发送）被顶出卡片右缘裁掉，且窄屏折叠判据是视口断点（≤1024）不感知容器宽度，
      两个形态都没接住。修复两层：① 折叠判据加容器实测宽度（`narrowControls = 视口 ≤1024 ||
      卡片 < 700px`，ResizeObserver 实测 `.chat-input-shell`，`700` 是全量工具条自然宽度上限）；
      ② 中间态由芯片省略消化（模型芯片 max-width 220 内省略，原有规则不动）。窄形态里
      环 / 声音 / 发送走「更多控件」浮出面板，实测可达。
    - **侧栏浮窗 portal 化**（`SessionSidebar.tsx` 新增 `PortalDropdown`）：worktree 下拉与项目 ⋯ 菜单
      portal 到 body + `position: fixed`，下方放不下（<260px）才朝上（与 ModelSelector 同一规则），
      滚动 / 缩放跟随重算；滚动区里的行靠近底部时浮窗不再被 `overflow` 裁掉或把列表撑长。
      外点关闭判据连同 portal 面板一起算（`wtPanelRef` / `menuPanelRef`）。
    - **分栏态树列错位已修**（`globals.css`）：删除为旧 DOM 写的 `.explorer-column { margin-top: -40px }`
      （G 轮把标签行挪进 `.pw-panel-head` 后它成了 stale 规则，把树列整体顶出面板体——
      实测 y=-4、高 904 > 864，树列头行的搜索 / 上传钮全部失联）；树列头行对齐面板体顶部，
      高度改 `--topbar-height`（36，画板 30）。
    - 统计条窄列防碎折行：格内 `white-space: nowrap`、放不下整格换行（`.pw-stats`）。
    - 验证：tsc 0 错；lint 0 错（260 warning 全为存量）；`npm test` 2233/2233；
      playwright 实测——环浮窗浮出卡片、思考/工具下拉在卡片内、@ 菜单浮出、分支行在选中项目行下
      （sameX 嵌套缩进）、两个 portal 下拉 fits 滚动区、分栏树列 y=36/h=864 对齐、窄形态发送钮可达。

49. **仍存在的形态偏差（第九轮后重登记，不阻塞）**：
    - 分栏态（文件查看器 + 树并排）里树列保留自己的头行——画板 01 帧 C 的树列没有头行
      （动作全在面板头）。产品的树动作（搜索 / 上传 / 刷新 / 改动过滤）要有去处，
      全部 hoist 进标签行会挤爆，登记为形态差异。
    - 「文件」头行与标签行仍是产品形态：树独占面板时 ExplorerPanel 的头行就是画板 30 的
      `.pw-panel-head`；无标签时不渲染空标签行。画板的「文件标题行 + 标签行」两行结构
      与产品的「头行 + 无标签时隐藏」等价，不硬改。
    - 扩展状态条（MCP / ponytail）画板 01 没画；它是本产品自己的东西，暂留
      （文本里的 emoji 来自扩展上报的状态文本，非 UI 硬编码）。→ **2026-09-29 晚已从
      composer 底部挪到聊天区右上角胶囊浮标，见 50。**

50. **第十轮（2026-09-29 晚，用户四条裁定的落地）**：
    - **统计长条删除，「用量收进圆环」路线最终落地**（裁定 #31 的冲突：用户选了浮窗路线）。
      composer 下方的常显 `.pw-stats` 行与展开面板删除；环浮窗内容升级为完整会话明细
      （`SessionStatsDetails`：会话信息 / 消息 / Token 三栏，带复制钮），并支持**点击圆环钉住**
      （`.is-pinned`，/session 命令与触屏经 `ChatInputHandle.openStatsPopover` 打开）。
      composer 底部留 `--s4` 呼吸空隙——输入框下面不再有任何常驻行（画板 01/20 的原意）。
    - **扩展状态右上角胶囊浮标**（`ExtensionStatusFloat`，fork-ui.css `.ext-float-pill`）：
      MCP / ponytail 状态收成聊天区右上角一枚 mono 胶囊（截断 + title），带插件 widget 时
      点击展开面板；移动端键盘弹出时与旧状态条同待遇隐藏。
    - **会话分支 ≠ Git 分支，视觉区分**：顶栏右侧的分支导航钮图标从手绘 git-branch 换成
      皮肤 lucide **git-fork**，文案「分支」→「会话分支」（i18n.branches 三语言）；
      左侧「main」芯片保持 git-branch（Git 分支 / worktree）。二者功能本就不同
      （navigate_tree 的会话内分叉 vs 仓库分支），现在是两套图形语言。
    - **顶栏剩余手绘 SVG 清零**：移动端侧栏开关（panel-left / menu）、边界面板开关
      （panel-right）、工作区对调（columns-2）全部换成皮肤 `data-ico`。
    - 验证：tsc / lint 0 错；npm test 2233/2233；playwright 实测——环浮窗钉住态
      680×392 完整浮出卡片（含明细与复制钮）、点外部收回；右上角胶囊 (x=1028,y=48)、
      底部 shelf/stats 均 0 渲染；pi-codex 会话顶栏「会话分支」git-fork + 左侧「main」芯片。

51. **第十一轮（2026-09-29 下午，用户裁定）：工作区选择搬出输入卡，改 Codex 式上下文条**。
    - 画板 20 原来把「这条会话在哪跑」画成 `.pw-chips` 行里的一枚 `.pw-chip`（**卡内**顶行），
      实现跟随；用户给了 Codex 实拍，要求按它改位置与图标。
    - 现在：画板 20 新增「新会话 · 上下文条」三帧（有分支 / 非 git / 不在项目中），
      `.pw-ctxbar` 在**卡上方**，内容 = 工作区（folder + 目录名）+ 分支（git-branch + 分支名），
      每一项是 `.pw-chipbtn`（无铬，hover 才显底，没有 chevron）。产品同步落地（`fork:ui-ctxbar`）。
      画板 53 帧 A 同步：工作区与分支搬到卡上方，`.pw-chips` 只留待办芯片。
    - **裁定记录**：用户明确**不要** Codex 条里的第三项「本地」（执行环境）—— pi-web 纯本地跑，
      那项是纯装饰；显示范围仍是**只在空的新会话页**（点工作区 = 开新会话，已有会话里没有这个语义）。
    - 因此 **41 条里「`.pw-chips`（工作区芯片）」的说法作废**：回补时不要把工作区芯片塞回卡内。
    - 验证：见 `docs/codex-skin/delta.md` §32。

---

## H · 2026-09-29 第十二轮：设计侧收尾（补 9 处漏画 + 修 3 处过时 + 补 8 条判据）

> 本轮**只改 `design/pi-web-design/**`**，产品代码一个字没动。
> 起因是 `docs/design-skin-adoption-audit-2026-09-29.md` 的 §3（产品已有、画板没画）与 §4（画板画了、产品不是那样）。
> 本轮确立的流程规则见 `DESIGN-SPEC.md` §5 的**判据 ⑦**（新增 `pw-*` 必须先进 `board.css` + 进画板 + 进本台账）。

52. **10 个产品自造的 `pw-*` 类已上提到 `board.css`**。它们此前只活在产品 CSS 里，
    等于「产品自己长出来的私有基件」——违反本系统「视觉唯一来源是 `board.css`」的立身之本。
    本轮全部收进 `assets/board.css` 并在画板上出现：

    | 类名 | 用途 | 落在哪张画板（本轮已画出） |
    |---|---|---|
    | `.pw-search-results` | 会话搜索结果区容器（可伸缩、可滚） | `02-sidebar-topbar.html` 帧 C 搜索 |
    | `.pw-search-project` | 结果行里的项目名一格（可收缩、单行省略） | `02-sidebar-topbar.html` 帧 C 搜索 |
    | `.pw-search-hit` | 命中片段一行（弱化正文色、单行省略） | `02-sidebar-topbar.html` 帧 C 搜索 |
    | `.pw-mark` | 命中词高亮（accent 淡底 + accent 文字，不用马克笔黄） | `02-sidebar-topbar.html` 帧 C 搜索 |
    | `.pw-row-toggle` | 行内折叠箭头（16×16，`.pw-row` 家族的行首） | `02-sidebar-topbar.html` 帧 C 搜索的项目行 |
    | `.pw-range` | 区间滑杆（180×4 轨道 + 12px 圆钮，产品是真 `<input type="range">`） | `40-settings-general.html`「边框深度」 |
    | `.pw-skin-actions` | 皮肤条下方那行动作（导入 / 导出 / 打开工作室 / 删除） | `40`「主题皮肤」与 `47-skin-studio.html` 皮肤条 |
    | `.pw-snav-close` | 设置左列导航底部的「收起左列」行 | `40-settings-general.html` 左导航 |
    | `.pw-wallpaper-thumb` | 壁纸缩略方块（64×36） | `40-settings-general.html`「当前壁纸」 |
    | `.pw-litem-add` | 列表末尾的「新增一行」条目（行规格同 `.pw-litem`，文字与图标弱化） | `41-settings-models.html` 模型列表、`43-settings-plugins-mcp.html` 插件包与 MCP 服务器列表 |

    十条全部满足 `DESIGN-SPEC.md` §5 判据 ⑦ 的三条（先进 `board.css` + 至少出现在一张画板 + 进本台账）。
    **两条欠账已在同日第二次执行中清掉**（不再留着）：`.pw-diff` 与 `.pw-up-arrow` 此前是画板用到、
    `board.css` 没有定义的空类。处理方式是**改画板、不补类**——`.pw-diff`（`52-file-viewer-modes.html:292/330`）
    改用已有的 `.pw-diff-body`；`.pw-up-arrow`（`56-update-and-auth.html:116/120`）改用
    `.pw-ico` + `data-ico="arrow-up"`。判据 ⑦ 双向核对现在为「画板用到的 `pw-` 类全部有定义」。

53. **画板 20 与 §2.7 的冲突：规范侧已裁定，画板侧仍是旧稿**。§2.7 早已裁定「输入框下方无常驻横条、
    用量全部收进上下文环浮窗」，`DESIGN-SPEC.md` §2.7 已按此重写（含三栏明细、可钉住、
    `/session` 与触屏两条无 hover 触发路径）。但 **`20-composer.html` 里那三帧 `.pw-stats`
    （正常 / >70% / >90%）至今还在**（第 53 条早先写成「已删除」是不实的，此处更正）。
    处理办法已写进规范：§2.7 加了一段明确的「本条优先于 §2.5」，并把画板 20 那三帧标为
    **待重画的旧稿**——三档配色判据（>70% warning / >90% error）继续有效，载体从「横条」改成
    「圆环 + 浮窗」；重画前不要照那三帧实现。重画本身属画板侧工作，留给下一轮。

54. **画板 54 修订 —— 扩展归位到顶栏插件浮窗**。扩展 widget 从「输入框上方的可折叠块」移进
    **顶栏插件浮窗**（`TopBarPopovers.tsx:353` 的 `PluginStatusButton`），扩展状态条从
    **应用底部 22px 高**改成**聊天区右上角的 mono 胶囊浮标**（`.ext-float-pill`）；
    本轮更进一步，那枚胶囊也已被顶栏两枚图标取代，状态文本全部进浮窗的「扩展状态」段。
    画板改动：`<h1>` / `<title>` / 说明 / 三标签改写（`扩展 / 链接 / 探索分支` → `扩展浮窗 / 链接 / 探索分支`）；
    第一帧整段重画（原来两段：widget 卡 + 22px 底部条 → 现在两段：浮窗体内的 widget 卡 + 只剩状态时的最短形态）；
    注记里写明这次变更，并注明「画板 22 补上 MCP / 插件两枚图标与浮窗后 54 归位」。
    **仍未落地的一条**（保留登记）：产品里 `.ext-float-pill` 的历史形态已在
    `AppShell.mobile-toolbar.test.mjs:105` 的断言里被要求不再出现在 ChatWindow，
    顶栏浮窗已接管；但 `fork-ui.css` 里那条规则本身是否清干净，需要产品侧确认。

55. **画板 56 更名**：文件名 `56-agent-management.html` 与内容不符——文件里 `<h1>` 是
    「56 · 更新与认证」，真正的子代理画板是 `42-settings-agents-skills.html`。
    已改名为 **`56-update-and-auth.html`**，**编号不变、内容不变**。
    同步更新 `README.md`（画板表 + 变更记录）、`index.html`（导航卡片 href）、
    `DESIGN-SPEC.md` §4 的 P6 行（并注明更名原因）。

56. **画板 60 断点按实现对齐**：正文与标签原写「断点 1024 / 640 / 380」，
    实现（`hooks/useIsMobile.ts:6/8/19`）是 **1024 / 640 / 480**
    （`COMPACT_QUERY` / `MOBILE_QUERY` / `NARROW_MOBILE_QUERY`）。
    按规范 §2.1「结构照实现」改板：标签改 `断点 1024 / 640 / 480`、断点表改 `481–640 · 手机` 与 `≤ 480 · 窄屏`；
    `DESIGN-SPEC.md` §4 的断点表同步，并新增判据 ⑧（断点只有 `hooks/useIsMobile.ts` 一处真值，改动四处一次改完）。
    顺带把组件标签补上 `useIsCompact`（平板档此前在画板上完全没出现过）。
    注记里写明这次对齐，并说明 `.pw-phone.narrow` 的 320px 是演示形态、不是断点。

57. **补画 1 —— 顶栏 MCP / 插件两枚图标与浮窗**（`TopBarPopovers.tsx`）→ `22-top-panels.html`。
    新增三格：MCP 浮窗（连接 / 禁用 / 作用域 / 首条诊断 / 未配置态）、
    插件浮窗（扩展状态 / 插件包 / 独立扩展 / 四个合计）、两枚触发钮（28×28 · accent 台数徽标 · 钉住的 `is-on` 态）。
    只用 `.pw-pop` + `.pw-pop-title` + `.pw-prow` + `.pw-badge`，没有新造基元。

58. **补画 2 —— 侧栏用户自定义分组头 + 回到未分组的拖放落区**（`fork/GroupedProjectList.tsx`）
    → `02-sidebar-topbar.html` 新增「用户自定义分组」帧。分组头四态（展开 / 折叠 / 落点 / 改名中）
    全部复用 `.pw-group-title`；落区用 `.pw-drop`。

59. **补画 3 —— 零会话起步三卡**（`fork/EmptyStateGuide.tsx`）→ `01-workbench.html`。
    用 `.pw-empty` + `.pw-empty-inner` + `.pw-starters` + `.pw-starter` + `.pw-kbd`，
    画的是**选目录 / 用最近的项目 / 导入会话**三条（与帧 A 的四张「起步提问」是不同的一件事，已在注记里说清）。

60. **补画 4 —— 附件预览灯箱**（`fork/AttachmentPreview.tsx` / `ImagePreview.tsx`）→ `50-dialogs.html`。
    图片整屏壳 + 多类型卡片壳，用 `.pw-scrim` + `.pw-modal*` + `.pw-iconbtn`。

61. **补画 5 —— 输入历史弹层与 `/` 命令菜单的实现形态**（`ChatInput.tsx:3368-3558`）→ `21-menus.html`。
    历史弹层用 `.pw-pop` + 30px 头 + `.pw-prow.is-on`；命令菜单按实现画成**与输入框同宽**
    （`left:0; right:0` 贴在输入框容器上，上限 `--composer-max-width: 800px`）、
    `repeat(auto-fit, minmax(220px, 1fr))` 组内自适应列（800 宽下自然排**三列**）、
    sticky 分组头 + 计数徽标 + 休眠态；命令名 `.pw-mono` 不省略、描述单行省略。
    顺带改掉旧注记里「`/` 也带搜索框」的错误说法（实现是输入即筛选，没有独立搜索框），
    并把开头「弹层宽度统一 320」改成「只有模型/思考/工具/权限/`@` 五件归 320 那一族」。
    **更正本条早先草稿里的「680 宽、两列」**：680 是**上下文环浮窗**的宽度
    （`ChatInput.tsx:1143` 的 `ringPopWidth = min(680px, 100vw − 48px)`），不是命令菜单的；
    画板 21 的注记已按实现改正。

62. **补画 6 —— 路径操作簇**（`fork/PathActions.tsx`）→ `51-menus.html` 新增「行内动作簇」段。
    完整形挂在 `.pw-card-head`（`.pw-path` + 三枚 `.pw-btn.sm`），紧凑形挂在 `.pw-trow`（三枚 `.pw-iconbtn.sm`），
    外加失败态（两枚转 error 底 + 卡脚一句人话）。**注意：产品用的是自有类 `.fork-path-actions`，
    本轮画板用画板基元表达，落地时按判据 ⑦ 处理（要么把 `.fork-path-actions` 换成画板基元，要么给
    `board.css` 补一个 `pw-path-actions`）——这一步属产品侧，本轮不做。**

63. **补画 7 —— 皮肤工作室对话框外壳**（`ThemeSkinStudio.tsx:164-414`）→ `47-skin-studio.html`。
    900×720 的对话框正文早已画全，缺的是**壳的结构**。按实现补成**五行**（不是「head 带页签」那版）：
    头行（标题 + 一枚关闭钮，**页签不进头行**）/ 页签行（`role="tablist"`，`pw-tabs` + `pw-tab`）/
    内容行（左控件 + 右实时预览，中间发丝线）/ 提示行（`role="status"`，无消息时整行不存在）/
    动作行（左「删除」仅编辑态 · 右「取消 / 恢复默认 / 保存」）。另画出编辑态与新建态两枚，
    以及遮罩与 portal 到 body 的理由。用 `.pw-scrim` + `.pw-modal*` + `.pw-tabs` + `.pw-iconbtn`，
    全部是已有基元，没有新增类。

64. **补画 8 —— 「已选目录但没有会话」的选中型空态**（`AppShell.tsx:2934-2951`）→ `01-workbench.html`。
    两态并排：整屏居中一句「从侧边栏选择一个会话」（`activeCwd` 有值）；
    左上角绝对定位的「开始使用」两步提示 + 44px 返回箭头记号（`activeCwd` 无值）。

65. **补画 9 —— 全局离线态与长文本溢出规则** → `61-system-states.html` 新增一帧。
    离线用 `.pw-alert`（壳级横幅）+ `.pw-toast.warn`（具体损失）+ `.pw-empty`（发送键禁用 + 重试）；
    长文本溢出写成四条可验收规则（省略号 / `overflow-wrap: anywhere` / 等宽两行封顶 / 单行 + `title`）。

66. **规范补 8 条可验收判据**（`DESIGN-SPEC.md`）。原文里全是「尽量少」「合理样例」这类只能靠猜的措辞，
    实现时无从验收。本轮把它们变成可量的：
    ①§1.1 大面积底色的面积 / 尺寸上限；②§1.1 细状态条写死 ≤2px；③§1.2 唯一阴影按层级分
    `--shadow-popover` / `--shadow-modal`；④§1.4 悬浮容器外扩量定死水平 6 / 垂直 4；
    ⑤§2.1 补「画板是功能边界」与「结构照实现」的优先级规则（画板决定要不要做 / 实现决定怎么排 /
    规范决定长什么样）；⑥§3 把「合理样例」量化为三条可查的判据并删掉编造宣称的表述；
    ⑦§5 新增 `pw-*` 类的准入（先进 `board.css` + 进画板 + 进台账，不许在产品 CSS 另起同名类）；
    ⑧断点只有一处真值，改动四处一次改完。

67. **本轮作废的旧条目**（逐条在前文就地标注了「已过时」，此处只列索引）：
    **§C 12–17 整段**（12→E-23 落地 / 13→E-30 落地 / 14→参数表已恢复四列 / 15→F-33 已实现 /
    16→E-25 已补 / 17→画板 60 已产出）、**D-18**（登录已在画板与实现两侧删净）、**D-20**（动效 token 已由 E-27 落地）、
    **D-31**（统计条冲突已在第十一轮裁定）、**G-38**（`.pw-side-search` 实为仅搜索态，不是常显）、
    **第 29 条的「参数表两列」**（`ToolDefinitionsPanel.tsx:246` 起已恢复四列）、
    **第十轮第 36 条的「设置分节内容不换」与第 37 条同款**（分节结构基件已改挂 `pw-*`）。

68. **同日第二次执行：九张画板的补画与 8 条判据在画板侧真正落地**。
    第十二轮的正文（52–67）当天被一次外部 `git reset` 回滚过：`DIVERGENCE.md` 与
    `assets/board.css` 的第十一轮派生件幸存，九张画板内容、`index.html`、`README.md`、
    `DESIGN-SPEC.md` 全部丢失。第二次执行把丢的部分逐张补回并逐张读回确认：
    `54`（整帧重画）、`60`（断点对齐）、`22`（MCP / 插件浮窗）、`02`（自定义分组）、
    `01`（起步三卡 + 选中型空态）、`50`（附件灯箱）、`21`（历史弹层 + 命令菜单）、
    `51`（路径动作簇）、`47`（工作室外壳）。本节 52–67 与第 68 条合起来才是完整的第十二轮。

69. **`.pw-quote` 从后代选择器提成独立件**（`assets/board.css`）。
    此前它只写在 `.pw-msg-user .pw-quote` 下，而画板 `10-transcript-text.html:34` 的
    引用块在正文里、不是用户消息的一部分，**拿不到任何样式**。现改为独立 `.pw-quote`
    （上下 margin 归一），另留一条 `.pw-msg-user .pw-quote` 只把下边距收成 0。

70. **本轮仍未做的事**（留给产品侧，画板侧无能为力）：
    - `app/globals.css` / `app/fork-ui.css` / `app/settings.css` 里仍重定义着二十多个同名 `pw-` 类
      （重构前的历史拷贝）。判据 ⑦ 只约束**新增**的类，老的这批清理属产品侧。
    - `assets/board.css` 里**定义了但没有任何画板用到**的 15 个 `pw-` 类
      （`pw-usage` / `pw-ctxbar` / `pw-ctx-name` / `pw-browser-body` / `pw-hint` / `pw-swatches` /
      `pw-swatch` / `pw-login` / `pw-login-card` / `pw-login-form` / `pw-mobile-bar` / `pw-sheet` /
      `pw-icon-cell` / `pw-tokens-grid` / `pw-anim-bar`）按判据 ⑦ 登记在此，等下一轮决定删类还是补画板。
    - `TopBarPopovers` 用到的 `topbar.*` i18n 键在 `lib/i18n/messages/*.ts` 里**目前不存在**
      （`topbar.mcpServers` / `topbar.pluginTotals` / `topbar.mcpNone` …），
      运行时会把原始键名渲染到界面上。画板 22 用了这些键**应该有的中文**，不照抄键名。
    - `PathActions` 用的仍是自有类 `.fork-path-actions`，没换成画板基元（见第 62 条）。

---

## I · 2026-09-30 换肤收尾轮（集中修复 P0–P5）

71. **BoardUI 层已删除**（用户裁定）：`app/boardui/`（theme.css 867 行 + typography.css 257 行）从
    `globals.css` 的 `@import` 移除并整目录删除。此前它已被架空——颜色权威在 2026-09-28 就迁到了
    `--ds-*`（fork:design-system 桥），52 个排版类全仓零使用，`--font-inter`/`--font-mono-source`
    是死引用。Tailwind 的 `--color-*` 反向桥（globals.css `@theme` 块）保留，工具类仍可用。
    ChatWindow 里 4 处 `text-text-muted` 换成 `var(--text-muted)`。

72. **70 条 (b) 闭环**：TopBarPopovers 用的 10 个 `topbar.*` 键已按画板 22 用词补进三语字典
    （mcp / mcpServers / mcpLoadFailed / mcpNone / plugins / extensionStatus / pluginPackages /
    pluginLoadFailed / pluginNone / pluginTotals）。运行时不再渲染原始键名。

73. **70 条 (a) 部分闭环**：fork-ui.css 与 board.css 的同名 `pw-*` 顶层定义从 7 个收敛到 4 个，
    且全部是**行为钩子**（不复制视觉值，各带注释）：`.pw-side-search`（cursor:text）、
    `.pw-skin-strip`（横向滚动语义）、`.pw-range`（真 input 的 UA 归零）、`.pw-md`
    （overflow-wrap，画板 61 溢出规则）。三个纯重复（`.pw-skin-actions` / `.pw-snav-close` /
    `.pw-wallpaper-thumb`）已删本地副本。settings.css 的 12 处 pw- 命中全是 0-2-0
    双类接线的注释与选择器，非独立重定义。

74. **画板 20 的三帧 `.pw-stats` 旧稿已删**（第 53 条的处置）：按 §2.7 裁定重画为
    「上下文环三档」帧——三档配色判据（正常 accent / >70% warning / >90% error）不变，
    载体 = composer 工具条里的 `.pw-ring`（浮窗见画板 01 帧 C）。board.css 与 fork-ui.css
    里无人使用的 `.pw-stats` 规则同步删除。

75. **设置三件落地**（SW-12 收尾）：PromptsConfig / ProjectArchivePanel+ArchivedSessionsPanel /
    ImportPanel 照画板 46 重写为 pw 件（此前 pw=0）。Custom commands 的「参数提示」字段、
    归档页的「清理 30 天前归档」、导入页「预计写入」明细：产品无对应数据源，按 §2.1
    「结构照实现」不上。

76. **皮肤工作室落地**（SW-13 收尾）：ThemeSkinStudio 接画板 47「按实现」五行外壳
    （pw-modal-head / pw-tabs / pw-modal-body 1fr+340px / 提示行 / pw-modal-foot）；
    fork-skin-dialog-* 与已死的 fork-skin-library 家族（约 300 行）退役；
    `fork-skin-preview-*` 实时预览是功能性部件，保留（登记同 Git 图泳道）。
    BuiltinWallpaperPicker 接 `.pw-wallpaper-thumb`；选中态（accent 描边）画板没画，
    在 fork-ui.css 接线块补一条。

77. **移动端两件落地**（SW-16 收尾）：移动端信任横幅照画板 60 帧 D——`.pw-banner`
    内联「信任」钮直接调信任接口，**不再弹模态框**；PWA 安装提示照画板 60 帧 B
    （Android beforeinstallprompt / iOS share-2 教学 / standalone 与已关闭不显示）。
    桌面端安装提示画板未画，不做。

78. **token 高亮对表**（SW-15）：@ 引用与消息正文 mention 统一接画板 20 的
    `.pw-tok-ref`（`/` 命令才是 `.pw-tok-cmd`，区分靠前缀字符）；`.mention-token`
    （--accent，比画板差一档）与无 CSS 的 `mention-token-{kind}` 后缀退役。

79. **MermaidZoom 接 pw-modal**（SW-15）：照画板 10 帧 C 重写（760 宽三段 +
    缩放器一格包住 + pw-card-foot 脚注）；globals 里 11 条自绘规则退役，只留
    dialog 壳与画布两条功能规则。

80. **登记不改**：
    - 拖放超限阈值：实现 10MB（`lib/image-attachments.ts`），画板 61 写 20MB——
      画板是提案值，按 §2.1 结构照实现保留 10MB；
    - BranchNavigator 树画布：自绘连接线/节点点（token 取色），画板 22 画的是
      扁平分支列表，与产品的树导航不同构——登记同 Git 图泳道。
      〔2026-09-30 补〕连接线 / 圆点 / 角色徽章的样式**已从组件内联迁到
      `app/fork-ui.css` 的 `.pw-branch-row` 家族**（行本体改 button，取画板
      `.pw-prow` 的 26px / radius-4 / hover 6% / 选中 accent 淡底），色值全部
      走设计令牌；树结构本身仍自绘（登记理由不变）。
    - 内容块六分支的 resource_link / 音频 / embedded text：`AssistantContentBlock`
      类型没有这些变体（`lib/types.ts`），无数据源不画；
    - 导入「本次选择」的来源/预计写入明细：产品选择态只有 id 集合，明细无从算起。

---

## H · 2026-09-30 用户实测反馈：交互与版式修复（第 81–90 条）

> 这一轮不是「换肤」，是用户在真机上一项项点出来的**功能与版式缺陷**。判据仍然是
> 画板 + 本台账：能对上的照画板，对不上的按用户裁定并登记在此。

81. **搜索框回到「搜索态才出现」**（`SessionSidebar.tsx`）：第 38 条早已裁定
    「默认收起、点搜索才展开并聚焦」（画板 02 帧 A 的项目 pane 根本没有搜索格），
    但代码被写成了常显 —— 本次按台账改回：`sessionSearchOpen` 状态 + 头部搜索钮
    （挂 `is-on`）+ 清除钮 / Esc 收起；焦点交还给触发钮，避免键盘 Tab 从头开始。
    折叠导轨递来的 `searchRequestId` 同样先展开再聚焦。

82. **会话列表去掉时间分桶**（`lib/time-groups.ts` 新增 `flatTimeGroupEntries`，
    `SessionSidebar.tsx` 三处调用点）：用户裁定不要「今天 / 昨天 / 本周 / 本月 / 更早」
    这层分类。顺序不受影响（`orderedProjectSessions` 倒序 + `applySessionFlags` 的置顶
    分区本来就在最前）。`groupByTimeBucket` / `bucketOf` / `timeBucketKey` 与
    `lib/time-group-state` 保留给测试与其它入口，侧栏不再接线。

83. **侧栏列表滚不动**（`SessionSidebar.tsx`）：滚动容器原来写 `flex: 1 1 auto`，
    但父级 `.pw-side-scroll` 是 `overflow: hidden` 的普通块（不是 flex）——简写完全
    失效，容器高 = 内容高，超出部分被裁掉。改 `height: 100%` + `overflow-y: auto`，
    与 `.pw-search-results` 同一口径。

84. **项目行 ⋯ 点不动**（`SessionSidebar.tsx`）：项目行整体 `draggable`，而 ⋯ / ⊕
    只有 22px —— 在 draggable 元素上按下再抬起，只要有几像素位移浏览器就起 drag 并
    **取消这次 click**。动作区加 `data-project-actions`，行上的 `dragstart` 识别到
    「从动作区起手」就 `preventDefault()`，点击照常派发。

85. **顶栏两件**（`AppShell.tsx` + `TopBarPopovers.tsx`）：
    - 分支芯片原来是**没有 onClick 的 span**（用户实测「这个 main 点不了」），接上第
      18 节就写好的 `BranchChip`（画板 02 帧 B 的 `.pw-chipbtn` + chevron-down → 工作区
      列表浮窗）；选中另一个 worktree = `startSessionIn`（切目录并在那里开 composer）。
    - MCP / 插件改成顶栏两枚 icon（画板 22 的 MCP / 插件浮窗），悬停或点击展开；
      聊天区右上角那枚常驻胶囊（`ExtensionStatusFloat`）退役 —— 与第 54 条
      「扩展归位到顶栏插件浮窗」同向。数据由 ChatWindow 上报（它才持有 useAgentSession），
      AppShell 只负责渲染图标与浮窗。

86. **最近会话面板接画板 22**（`AppShell.tsx`）：原来是整段自绘（`--bg-elev` /
    `--radius-lg` / `--shadow-lg` 那套旧 token + 30px 内联行），换成 `.pw-pop` +
    `.pw-pop-title` + `.pw-prow`（message-square + 标题 + 相对时间 / 当前项用新增的
    `sidebar.currentSession`）+ `.pw-sep` + 新建任务行（`.pw-kbd` ⌘N）。

87. **斜杠命令浮窗不再换行**（`ChatInput.tsx`）：680×`minmax(220px)` 排 3 列时每列只有
    ~218px，而命令名那格带 `overflowWrap: anywhere` —— 稍长的技能命令折成两行。
    放宽到 760 宽、每列下限 260（排 2 列），命令名改 `nowrap + ellipsis`。

88. **上下文环浮窗两处改判**（`ChatInput.tsx`，**修订第 42 条**）：第 42 条写的浮窗内容
    含「结束原因」——用户裁定去掉（诊断字段，占一整行无人看）。默认宽度收成 320
    （画板 22 的 `.pw-pop`），点「显示详情」展开时才放宽到 620，让「会话信息 / 消息 /
    Token」三节并排成一行（用户要求「消息和 token 并列」）。

89. **过程头行整行是折叠开关**（`ChatWindow.tsx` + `app/fork-ui.css`）：原来只有一枚
    16px 的 chevron 可点、且没有文字。现在 `.pw-proc-head` 本身是 `<button>`（选择器
    进 `@layer fork-reset` 的 UA 归零清单），热区 = 整行；右侧补 `.pw-desc` 的
    「展开 / 收起」，箭头改成同一枚 chevron-down 旋转（`--motion-base`）。hover 反馈
    取 `--surface-panel` 叠 4% 文字色（画板是静态 div，没有 hover 档，属可交互化适配）。

90. **焦点框只在键盘焦点出现**（`hooks/useFocusModality.ts` + `app/globals.css`）：
    规范 §1.4 写的是「焦点环 1.5px 强调色描边、偏移 1px，**只在键盘焦点时出现**」，
    但浏览器对文本框 / select 的 `:focus-visible` 在鼠标点击时同样命中，纯 CSS 表达
    不出来 —— 用户实测「很多输入的地方都有蓝色的框」。现在 AppShell 维护
    `html[data-focus-modality]`（pointerdown → pointer，Tab / 方向键 → keyboard）：
    鼠标档下统一 `outline: none !important`（压过设置页各处字段规则）；键盘档下各组件
    自己的 `:focus-visible` 照常（1.5px / +1）。composer 那圈 3px 的 `--focus-ring`
    一并收成 1.5px 且只在键盘档出现；`globals.css` 里「字段改满强度 accent 描边」
    那条同时退役 —— 它是蓝框的第二个来源。

91. **登记不改（本轮）**：
    - 过程头行状态徽标：`failed` 判据是 `block.status === "error"`（与步骤行的
      `step.failed` 同源）。历史会话里若 toolCall 块没带 status，就只能显示「完成」——
      需要会话文件补字段，属数据层，不在本轮改；
    - 搜索结果的「项目分组」：画板 02 帧 C 的分组头 + `.pw-search-hit` 已照搬，
      但产品按 `session.cwd` 归组（画板是静态示例），命中行额外带会话标题作辨识。


---

## I · 2026-09-30 用户实测反馈：设置页布局（第 92–96 条）

> 用户带着 4 张截图（常规 / 模型 / 子代理 / 记忆）说「布局有问题、整体不合理、
> 新增按钮位置不对、有的间距特别近、有的显示不合理、有的按钮看不懂」。
> 逐页对着画板 40 / 41 / 42 / 44 核了一遍：**结构类问题改掉，画板没有的产品语义登记在此**。

92. **记忆页按画板 44 重排**（`PiMemoryConfig.tsx` + `lib/pi-memory.ts`）：
    - 工具列表原来是「一行一个工具名」，整段说明挤成列表下面的 `.pw-hint` 段落
      —— 行太矮、说明贴着列表。现在每个工具带一句 `.pw-lsub`
      （新增 `PI_MEMORY_TOOL_HINT_KEYS` + 7 条 i18n），段落删除。
    - 「新建」原来挂在**每个**缺失文件行尾（行被按钮挤窄、位置与画板不符）。
      按画板收成过滤行右侧的 `file-plus` 图标钮，一次建出全部缺失文件。
    - 状态块补齐画板的三行：启用记忆（说明走 `.pw-label small`）/ pi-memory 状态
      （徽章 + 重新安装）/ 记忆文件目录（等宽路径 + 打开）。
    - 右栏 `.pw-detail` 给 `minHeight: 420`：没选文件时 `.pw-empty` 的
      `place-items:center` 才有地方居中，否则那行说明飘在右上角像「浮空的段落」。

93. **子代理页按画板 42 重排**（`AgentsConfig.tsx`）：
    - 左列头补画板的「搜索子代理 + 新建图标钮」两件；列表末尾那行 `.pw-litem-add`
      「＋ 新建子代理」撤掉（画板 41/43 才用 `pw-litem-add`，42 用搜索行的 `+`）。
    - 列表行从「自绘圆点 + 光名字」改成画板的两段：`bot` 图标（启用走 accent-text）
      + `.pw-lname`（显示名）+ `.pw-lsub`（描述，缺省回落 id）；状态点移到行尾。
    - 详情头补标题：画板的 h3 是名字，原来这一行只有「作用域徽章 + 等宽路径」，
      卡片没有标题。
    - 工具 / 资源芯片各补一行 `.pw-hint` 讲清「点一下加入、再点一下移除」
      （画板只有芯片没有说明，用户实测「按钮啥的看不懂」）。

94. **两栏设置页的右列也要能滚**（`app/settings.css`）：
    `.config-panel-surface > .pw-cols > :last-child { height:100%; overflow-y:auto }`。
    原来只给左列声明了滚动，右列按内容长高；外层 `.config-panel-surface` 是
    `overflow:hidden` —— 多出来的部分被**直接裁掉**，而 `.pw-modal-foot` 仍贴在面板底，
    看起来就是「模型页的可用模型列被切断 + 保存按钮浮在列表上」。

95. **块内提示 / 横幅的上边距**（`app/settings.css` 的 `fix:block-rhythm`）：
    画板的 `.pw-block` 里只有 `.pw-field`；产品补的状态行（通知块的状态提示、
    记忆块的说明、子代理的加载条）在 Tailwind preflight 把 `<p>` 的 UA margin 归零后
    **紧贴上一行** —— 用户说的「有的页面间距特别近」就是这类位置。块内 / 详情内的
    `.pw-hint` / `.pw-alert` 统一加 `margin-top: var(--s2)`。

96. **登记不改（本轮）**：
    - **常规页**：逐块核对画板 40 后未发现结构偏差 —— 外观 / 主题皮肤 / 默认外观壁纸 /
      侧栏 / 通知 / 界面字体 / 语言 / 聊天都在，字段都走 `.pw-field`、页头走 `PwPageHead`、
      块走 `.pw-block`。画板壁纸块的「适配方式 / 遮罩浓度」两行不在设置页：产品这两个值
      在壁纸选择器里，按 §2.1「结构照实现」不搬回来。
    - **模型页可用模型行的副标题**用模型 id（画板写的是「128K 上下文 · $0.14 / $0.28」
      规格与定价串）：模型目录接口不返回规格/定价字段，无数据不画。
    - **常规页「描边深度」多一枚「重置」**（画板没有）：产品便利控件，登记保留。

---

## J · 2026-09-30 用户实测反馈第二批（第 97–106 条）

> 用户带着 9 张截图（m6_01–m6_09）逐项反馈。**先说一个前提**：用户当时看的是
> `/Applications/Pi Web.app`（打包快照，`.next` 构建于 11:53），而仓库里 12:50 / 13:45
> 两轮修复都没进那个包 —— 9 条里有 4 条（#5 顶栏芯片、#7 最近会话、#9 项目 ⋯、
> #3 供应商图标）在**仓库构建里实测本来就是好的**。本节只登记「在仓库构建里确认有差异」
> 的改动；实测正常的条目见第 106 条。

97. **侧栏两个下拉「点不动」的真正根因：一份没人管的旧副本**（`components/SessionSidebar.tsx`）：
    9-29 的 `fork:ui-pop-portal-fix` 只改到了**抽出来的共享版**
    `components/PortalDropdown.tsx`（给 portal 容器加 `position:relative;
    z-index: var(--z-popover)`），而 `SessionSidebar.tsx` 里还留着**同源旧副本**三件
    （`DROPDOWN_ANIMATION_MS` / `AnimatedDropdown` / `PortalDropdown`），侧栏的
    worktree 切换下拉与项目 ⋯ 菜单用的正是这份旧副本 —— 它 portal 到 body 之后
    **没有给容器任何 z-index**，在根层叠上下文里是第 0 层，被 `.sidebar-container`
    （`position:relative; z-index:200`）整块盖住。
    实测证据（30141）：浮窗在 DOM 里 `visibility:visible / opacity:1`、盒子
    `[8,212,264,98]` 正常，但 `document.elementFromPoint(浮窗中心)` 命中的是侧栏的
    `SPAN.pw-t`，`topIsInsidePop: false` —— **有、点不到、看不见**。
    改法：删掉侧栏里的旧副本，改 import 共享版（一处定义，两处受益）。
    ⚠️ 教训：`fork:ui-pop-portal-fix` 那次的备注写的是「改 PortalDropdown 一处全治」，
    实际漏了这份副本 —— 改共享件时必须 `grep` 一遍同名函数。

98. **上下文环浮窗：不再折叠、不再「多一块」**（`ChatInput.tsx` + `app/fork-ui.css`）：
    用户裁定（推翻第 82 条的「默认 320 + 显示详情」）——「为啥要折叠呢，不直接显示全乎呢」。
    - 撤掉「显示详情 / 隐藏详情」开关，`SessionStatsDetails`（会话信息 / 消息 / Token）
      **常显**；宽度恒取三节并排那一档（620，按视口收窄）。
    - 删掉与明细重复的自造行（`上下文` / `上下文已用` / `本会话花费`）—— 明细的 Token 小节
      本来就给这些；只留 `本轮 ↑/↓`（明细里没有本轮用量）。用户说的「多一块」就是它们。
    - 首行那个 `上下文 ?`（`contextUsage.percent == null` 时的兜底）一并去掉。
    - `app/fork-ui.css` 的 `.composer-ring-pop` 补 `width:100%`（画板把 `.pw-pop` 写死
      320px，内层不跟外层宽度走，明细被挤成一列、浮窗长到 650+ 再被 `overflow:hidden`
      裁掉）+ `overflow-y:auto`（明细常显后靠它自己滚）。

99. **转录步骤行里的文件芯片不换行**（`app/globals.css` 的 `.process-file-chip`）：
    芯片有 `max-width:190px` 却没有 `white-space/overflow/text-overflow` —— 长文件名
    （`proma-pr-plan-2026-09-18.md`）在 190px 处折成两行，而步骤行是 24px 定高，
    看起来就是「错行」。现在一律单行 + 省略号，完整路径留在 `title`。

100. **皮肤工作室：实时预览挪到左列**（`ThemeSkinStudio.tsx`）——**用户裁定，与画板 47 相反**。
     画板 47 的 `pw-modal-body` 是 `1fr 200px`，预览在**右**；用户说「为啥把预览放在右边了
     啊，应该放到左边啊」（他更认可改造前那版）。按用户改判：预览列 `order:1`、设置列
     `order:2`，发丝线从左边线改成右边线。**画板不动，产品偏离登记在此。**

101. **新建任务页：文件夹芯片右侧补「选目录」**（`ChatWindow.tsx`）：
     画板 20 只有一枚工作区芯片（点开是项目列表 + 打开文件夹）。用户要「文件夹的右边加一个，
     让我可以选啊，不然我都选不了」—— 补一枚 `folder-open` 图标钮直接走系统目录选择器
     （同一个 `onOpenFolder`）。属**产品便利控件**，画板没有。

102. **顶栏工作区芯片可点**（`AppShell.tsx`）：
     未选会话时顶栏那枚工作区芯片原来是**没有 onClick 的 `span`**，用户「这个点不了啊」。
     改为复用输入框上方那枚 `ProjectChip`（项目列表 + 打开文件夹）。

103. **文件查看器两件**（`FileViewer.tsx`）：
     - **选区浮窗不换行**：容器原来是 `flexWrap:wrap` + 宽度交给 shrink-to-fit，
       「@ 在当前对话询问」/「↗ 在新对话询问」两个按钮一超宽就各占一行，浮窗变两行高
       还带竖向滚动条。改 `flexWrap:nowrap` + `width:max-content` + 按钮
       `whiteSpace:nowrap`。
     - **源码层撑满**：`CodeFileEditor` 的根 `.pw-viewer`（flex 列 + `height:100%`）
       挂在一个 **auto 高度**的 `div[data-file-stage="source"]` 上，百分比高度落回 auto
       —— 编辑器只剩内容高，底栏（`Ln · Col` / `EOL · UTF-8`）浮在面板中间，下面一大片空白。
       只给 **source** 层 `height:100%`：preview 层的 markdown 是随内容长的，
       锁 100% 会让长文档再也滚不动。

104. **顶栏「最近会话」浮窗**（`AppShell.tsx`）：**登记不改**。用户截图里时间列被切、
     浮窗底部有横向滚动条 —— 那是**打包快照里的旧面板**（旧面板是自绘的、没有 `.pw-pop`
     约束）。仓库构建实测：320 宽、`overflow-x: hidden`、`popScrollX:false`、
     行内 `pw-desc` 时间格 `scrollWidth === clientWidth`（0 处裁切），1440 / 1080 两档一致。

105. **供应商选择弹窗的图标**（`components/ProviderIcon.tsx`）：**登记不改**。
     用户「icon 没了 / 显示慢」。仓库构建实测（30141，设置 → 模型 → `+`）：
     `public/provider-icons.svg`（40KB，38 个 symbol）齐全，弹窗里 9 个订阅服务 + API Key
     分组共 14 行的 `<use href="/provider-icons.svg#…">` 全部命中，截图里 Anthropic /
     GitHub Copilot / Kimi / Meta / OpenAI / OpenRouter / Radius / xAI / Bedrock 图标都在。
     「慢」是**外链 sprite 的首屏空白**（`<use>` 指向外部文件时要等一次 fetch）。
     若用户在新包里仍然觉得慢，正解是把 sprite 内联进文档（服务端读 `public/` 后
     `dangerouslySetInnerHTML` 到一个隐藏 `<svg>`，`<use href="#id">` 同文档引用）——
     本轮不改，因为无法在沙箱里构建验证。

106. **实测正常、判定为「打包快照过旧」的条目**（仓库构建 30141 实测）：
     - **#9 项目行 ⋯**：菜单正常弹出（`打开文件夹 / 重命名 / 归档项目 / 从列表中移除`，
       210×139，可见）。第 97 条修完后才真正**可见**（此前被侧栏盖住）。
     - **#5 侧栏 worktree 行**：是 `<button>`、`cursor:pointer`，点开得到
       `main / 主分支 / upstream / 新建 worktree…`（264×98）。同上，第 97 条修完后才可见。
     - **#3 供应商弹窗**：图标齐全（见第 105 条）；选中模板后右列是完整的
       「Provider name / 图标 / 接口地址 / API Key / API 协议 / Headers」表单，不是空面板。
     - **#7 最近会话**：见第 104 条。
     **给用户的结论：需要重新出包**（`/Applications/Pi Web.app` 是 11:53 的快照，
     12:50 与 13:45 两轮改动都不在里面）。

---

## J · 2026-09-30 用户实测反馈：过程时间轴与展开折叠动效（第 107–112 条）

> 用户：「design/ 里所有动效交互效果跟现在这个项目对不上，项目里**根本没有动效**」
> 并给出画板 11（过程时间轴）与展开后的实际截图。逐张对下来：**折叠类动效的时长与曲线
> 不是设计的**，时间轴的推理行不是画板帧 A 的形态，且行与行之间的竖线被展开正文截断。
> 这一节记录成因与落地；能对上画板的照画板，产品语义照旧登记。

107. **展开折叠回到设计规格**（`app/fork-ui.css` + `hooks/useCollapsePresence.ts`）：
     `.fork-collapse` 是**全站唯一**的折叠原语（思考块 / 工具卡参数与结果 / 扩展消息 /
     过程时间轴）。它写死的是 `260ms` + `cubic-bezier(.22,1,.36,1)` —— 两者**都不是**设计的：
     规范 §1.6 把展开折叠定为 **`--motion-base`(160ms) + 全系统唯一曲线 `--ease`
     (`cubic-bezier(.215,.61,.355,1)`)**。改成引用 token 后，全站每一处折叠同时归位。
     `hooks/useCollapsePresence.ts` 的 `COLLAPSE_DURATION_MS` 260→160 必须同步
     （它是 `transitionend` 缺席时的兜底定时器）。

108. **过程时间轴接上折叠动效**（`ProcessGroup.tsx` + `ChatWindow.tsx`）：
     两处正文原来都是 `{open && …}` 直接增删 DOM —— 浏览器没有可动的东西，点行头永远瞬跳，
     这正是「项目里没有动效」的直接来源。现在都套 `.fork-collapse`
     （grid 行高 0fr↔1fr + `useCollapsePresence` 两段式卸载）。
     惰性契约不变：**收起态 DOM 里仍然没有正文**（`.process-steps` 在收起时不进 DOM，
     长会话不会因此把全部工具卡挂上）。

109. **推理行回到画板 11 帧 A 的形态**（`ProcessGroup.tsx` + `lib/process-step-expansion.ts`）：
     画板帧 A 的推理行是 `推理 <模型原话一行>`（行上摘要用 `.pw-think`，正文色阶、非等宽）；
     产品把摘要挂在 `.pw-arg` 上（11px 等宽），且 `reasoning: true` 默认摊开 ——
     一行推理掉出一大块斜体正文。现在：摘要走 `.pw-think`，三类步骤**都默认收起**。
     设置页的三档开关不变，想回「一进来全摊开」把推理打开即可。

110. **时间轴竖线穿过展开正文**（`app/globals.css`）：
     board.css 的连线是 `.pw-step::before`，按**步骤行自己的行高**画的；展开正文是行的
     **兄弟**（第 40 条定下的结构），插进来就把两个图标之间的线截断成虚线。
     正文自己补一段同位置（`left:9px` + 同一发丝线）的线。
     附带：折叠壳常驻后是 `.pw-proc-body` 的一个 0 高度 grid 子项，会多吃一格 `gap:1px`，
     用 `margin-top:-1px` 补回，收起态与加动画前逐像素一致。

111. **工具卡失败态不再整卡描红**（`MessageView.tsx`）：
     画板 11 帧 B 写死「失败只换两处 —— 状态图标转 error、输出区底色转 `error.soft`；
     卡片边框仍是发丝线，不加左侧彩条、不给整卡着色」。产品原来给整张 `.pw-card` 上
     `error 38%` 边框 + `error-soft` 底，还把工具名一起转红。现在按画板收窄。
     〔已知残留〕light 主题的 `--error` on `--error-soft` = **4.32:1**（<4.5 AA）：
     这一对是**画板自己的取值**（帧 B 的 `.err` 文本就压在 error-soft 上），
     改动前整卡着色时同一对比度已经存在，本轮不放大也不缩小；要过 AA 得动
     `tokens.css` 的 `--error` 或 `--error-soft`，属设计侧裁定。

112. **过程头行右侧顺序**（`ChatWindow.tsx`）：画板 11 帧 B 是**先状态徽标、后「展开 / 收起」**
     （`✓ 已完成` 在 `展开` 之前），产品原来是反的。1 行对调。

**登记不改（本轮）**：
- 画板 11 帧 C「只有一步不折、不画头行」：产品的头行还是整轮汇总行（计数 + 状态徽标 +
  折叠开关），单步时也保留 —— 去掉头行会连「失败」徽标一起丢掉，判定为交互语义回归，
  不在本轮改；
- 步骤行的 `×N`（同名同类工具合并数）：画板没有这一格，是产品语义（第 3 条的后缀），保留；
- 工具卡头的状态徽标（画板 `完成 · 3s` / `失败 · 3s`）：产品沿用 `.pw-dim` 的裸时长，
  没有徽章 —— 属外观细化，登记待办；
- 工具卡展开后底部的整条「收起」条：画板有、产品没有（点卡头即可收起），登记待办；
- `--opacity-pending`（`05-motion` 第 03 项「等待期减弱」，定义 0.5）全仓**零引用**：
  十七项动效里唯一没有产品接线的一项，适用于「重载 agent」那条路径，登记待办。

---

## K · 2026-09-30 用户实测反馈：三处（第 113–115 条）

113. **「键盘快捷键」一节从设置里删除**（用户裁定「给我去掉」）：
     `components/fork/ShortcutsSettings.tsx` 与它的测试整份删除，导航项 / `sectionHost`
     接线 / 画板 40 的分节图标（`shortcuts: "keyboard"`）/ `SETTINGS_SECTION_VALUES` 里的
     `"shortcuts"` 一并撤掉。
     **快捷键引擎不动**：`lib/shortcuts.ts`（中央命令表 + 默认键位 + 覆盖）与
     `hooks/useKeyboardShortcuts.ts` 照常工作，已有覆盖仍然生效 —— 去掉的只是**编辑界面**。
     〔登记〕画板 `45-settings-shortcuts-usage.html` 的快捷键帧（搜索 / 分组 / 录制 / 冲突）
     从此没有产品对应；`settings.shortcuts.*` 里 17 个只服务这个界面的文案成为死键
     （`group*` / `stopAgent` / `newSession` / `toggle*` / `findInConversation` 仍被
     `lib/shortcuts.ts` 当命令名用，**不能删**）。本节由用户主动要求，覆盖画板。

114. **过程头行不再挂「失败」徽标**（`ChatWindow.tsx`）：
     用户：「这个失败俩字你不能显示在这里吧，因为他只是中间一个过程」。
     `status="failed"` 的判据是「这一轮里**任意** toolCall 块 status 为 error」——
     跑完了但有两三条命令没跑通，抬头就被读成「这一轮失败了」。
     画板 11 的抬头也只画 **进行中 / 已完成** 两档，某个工具失败由**步骤行**上的
     `.pw-badge.bad` 就地标红（帧 A），失败次数本来就在计数汇总里（`N 次失败`）。
     现在：抬头徽标只有两档，`status` 收成 `"running" | "done"`，唯一的 `"failed"`
     调用点删除。步骤行与工具卡的失败表达**一个都没少**。

115. **会话行的副行不再折行**（`SessionSidebar.tsx` + `app/fork-ui.css`）：
     用户：「鼠标放上去的时候文字会换行，变形了」。
     悬停时行尾出一组动作钮（置顶 / 归档 / 重命名 / 删除，约 100px），它们是在流的，
     `.pw-body` 被挤窄：标题有 board.css 的 `.pw-t`（nowrap + 省略号）兜着，
     但 `.pw-m`（相对时间 · 条数 + 状态标记）**板里没有截断规则** ——
     被折成两行后超出 `.pw-session` 的固定行高（48 / 58），整行看起来就散了。
     加产品类 `.fork-session-meta` 做单行截断（与 `.process-step-detail` 同一做法：
     画板类不动，产品类负责截断，见第 73 条）。实测悬停时行高 48 不变、
     标题与副行各 20 / 17px 各一行、无换行。

---

## L · 2026-09-30 用户裁定：token 表比对后的四项（第 116–120 条）

> 用户拿 `00-tokens.html` 逐条比对「icon / 按钮 / 颜色有没有按规范走」。实测结论：
> **颜色与圆角是干净的**（工作台与设置 12 个分节全量扫描，每一个渲染出的
> color / background / border 都能解析到某个 `--ds-*`，圆角只出现 0/3/4/6/999）。
> 不符合的是**字号档位、图标来源、按钮的描边语法**三项，逐条落地如下。

116. **字号只允许停在规范的五档（去掉 meta）**（`lib/typography.ts` + `hooks/useChatAppearance.ts`
     + `lib/ui-font.ts` + `SettingsPanel.tsx`）：三个字号设置原来是
     `<input type=range>` 的**连续值**（界面 12–16 / 聊天 12–24 / 扩展组件 12–24），
     用户随手就能停在 **14 · 16 · 24** 上，而这三个值不在 11 / 12 / 13 / 15 / 20 里。
     实测当时 composer 的输入框就是 14px（`useChatAppearance` 的
     `CHAT_CONTENT_FONT_SIZE_DEFAULT = 14` —— `lib/ui-font.ts` 在换肤收尾时已收敛到 13，
     同一次收敛漏掉了聊天正文）。
     现在：新增 `USER_TEXT_SIZE_OPTIONS`（由 `DESIGN_TEXT_STEPS` 推导 = 12/13/15/20）与
     `snapUserTextSize()`，三个设置都改成与「UI 字号」同一个下拉；存过的旧值归并到最近档
     （14 → 13、16 → 15、24 → 20，并列时取较小档）。**默认值 14 → 13。**
     代价：可调上限从 24 收到 20（规范的上限）；下限 12 不变。

117. **`StepIcon` 的 13 个手绘 SVG 退役**（`components/ProcessGroup.tsx`）：
     时间轴的步骤图标原来是手绘 `<svg width=14 stroke-width=1.7>`，而画板 11 写的是
     `<span class="pw-step-ico"><i data-ico="brain" data-size="12"></i></span>`。
     现在走 `STEP_ICON` 语义名 → lucide 名（brain / file-search / file-text / pencil-line /
     file-plus / trash-2 / terminal / wrench / image / list / list-checks / folder /
     triangle-alert），尺寸回到画板的 **12**（`.pw-step-ico` 的方框仍是 14）。
     13 处全部有画板出处，只有 `toolbox`（工具名认不出来时的兜底）取画板 05 的 `wrench`。

118. **删死代码 + 补门禁漏洞**：
     - `components/SettingsUi.tsx` 的 `SettingsSelect` **全仓零引用**（真正在用的是画板原子
       `PwSelectBox` → `.pw-selectbox`），连同它唯一的样式 `app/fork-ui.css` 的
       `.fork-settings-select` 一起删除 —— 那份样式本身就违反 token 表：控件高度 **36**
       不在 24/28/32 里、focus 是 `box-shadow: 0 0 0 3px`（规范是 **1.5px outline + 1px offset**）、
       下拉箭头是 data-URI 里写死的 `#888b91`。
     - `scripts/check-style-literals.mjs` 新增 `color-literal-encoded`：上一条颜色规则看不到
       data-URI 里 **URL 编码过的 `%23rrggbb`**（SVG 内联时 `#` 必须写成 `%23`），
       上面那枚箭头就是这样漏过去的。

119. **`.pw-btn.outline` 的描边语法回到 token 表**（`design/pi-web-design/assets/board.css`，用户裁定）：
     用户实测「设置里这些黑色文字按钮不符合规则，「浅色 / 深色 / 跟随系统」那几个可以，
     我喜欢那样的按钮」。对照后确认病因：`.pw-btn.outline` 是
     `--n-border`（二级深边框，token 表里它是**控件轮廓**）+ `--surface-canvas`（实底）
     + 继承来的 `--n-text`（正文黑），比旁边同尺寸的 `.pw-radio` 芯片
     （`--n-border-subtle` 发丝边框 + 透明底 + `--n-muted`）重两档 ——
     一排「导入 / 导出 / 打开皮肤工作室 / 选择图片」就是四个黑字方框。
     改判据只有一条：00-tokens 的按钮一栏只列 ghost / hover 6% / active 10% / selected /
     primary / danger ghost / focus ring，并写明「**按钮默认无边框无填充**，悬浮才出 6%
     深色容器，**主按钮是唯一的强调色填充例外**」。
     现在 `.pw-btn.outline` = 发丝边框 + 透明底 + 次要灰字，与 `.pw-radio` 芯片同族。
     **影响面**：20 张画板里 48 处 `.pw-btn outline` 与产品 16 处用法同时归位 —— 这是有意的，
     画板自己画的就是这套偏重的值。
     〔对照〕`.pw-selectbox` / `.pw-input` **不改**：它们是**控件**不是按钮，
     00-tokens 明确把 `--n-border` 指给「控件轮廓」，实底 + 二级边框正是规范要的。

120. **画板图标表的「自跑 hydrate」在产品里关掉**（`design/pi-web-design/assets/icons.js`
     + 新增 `components/pw-icons-manual.ts`）：
     `icons.js` 末尾会在 DOMContentLoaded（或模块求值时若文档已过 loading）自己 hydrate 一次 ——
     那是给静态画板页面用的。产品不需要（`PwIcons.tsx` 自己有一份：commit 之后跑一次 +
     MutationObserver），而且它会坏事：Next 的流式渲染**先把 Suspense 片段的 HTML 补进 DOM、
     再让 React 认领**，自跑若落在两步之间就会往那些节点里塞 `data-ico-done="1"` 与 `<svg>`，
     React 随后报 hydration mismatch 并重生整个子树（实测第一个撞上的是侧栏搜索钮的
     `data-ico="search"`，连续 3 次刷新必现）。现在产品在 import 本文件**之前**设
     `global.__piIconsManual = true` 关掉自跑；画板页面不设这个标志，行为不变
     （实测画板 11：64/64 图标仍水合；00 的图标总览 255/255 仍在）。

121. **〔第 119 条的续，同日〕幽灵按钮的前景也从 `--n-text` 改成 `--n-muted`**（`board.css` 的 `.pw-btn` 基类）：
     119 只改了 `.pw-btn.outline` 一档，用户复测后回来说「别的设置页面的黑色文字按钮还是有」。
     查清楚剩下的黑字不在 `outline` 上，而在**基类**：`复制 / 重新安装 / 打开 / 刷新 / 重置 /
     标记已整理 / 排队发送 / 取消` 这些是 `.pw-btn.sm`（ghost，board 42 / 44 / 45 都这么画），
     而 `.pw-btn` 基类的 `color` 是 `--n-text`（正文黑）。
     改判据：token 表把 `--n-text` 定义为「正文」、`--n-muted` 定义为「次要文字」——
     按钮装的是**次要动作**，用正文色等于让一整页的次要动作与正文一样黑。
     现在幽灵按钮与 `.pw-radio` 芯片同族（`--n-muted`），层次由
     **primary（accent 填充）/ danger（error）/ ghost（muted）** 三级拉开。
     `primary` 与 `danger` 各自覆盖前景，不受影响；产品侧仅有的 3 处裸 `.pw-btn`
     （排队发送 ×2、对话框取消）都是次要动作，正好是应该变灰的那一类。
     **影响面**：20 张画板里的幽灵按钮同时归位（画板自己画的也是黑的，这是规范的改动，
     不是产品的偏离）。实测 12 个设置分节重扫：`pw-btn` 黑字剩余 **0**（改前：技能 6 × 复制、
     记忆 3 × 重新安装/打开/标记已整理、用量 2 × 刷新/Token）。
     〔对照，仍未改〕同页还有三种 `--n-text` 但**不是按钮**的东西：
     `.pw-selectbox`（控件，00-tokens 把 `--n-border` 指给控件轮廓）、
     `.pw-skin`（皮肤卡片）、`.pw-litem`（列表行，行名就是该行的主体内容）。

---

## M · 2026-09-30 工作台画板（01）逐项校验

> 用户要求「逐一校验设计稿」，从工作台开始。判据照旧：几何对数（`scripts/board-diff.mjs`
> + 新增规格 `scripts/board-specs/01-workbench-a.mjs`，23 项里 18 项一致、5 项登记分歧、
> 0 项不符）+ 结构/图标清单。下面每一条都是「画板写了、产品没跟上」或「产品自己长出来的」。

122. **帧 A 五处几何/图标归位**（`app/globals.css` / `AppShell.tsx` / `ChatInput.tsx` /
     `ModelSelector.tsx` / `SessionSidebar.tsx` / `app/fork-ui.css`）：
     - **`.pw-seg` 被固定宽度顶出容器**（画板 263 ≠ 产品 280，右缘溢出 16px）。
       病根在 `globals.css` 的 `.sidebar-container > * { width: var(--sidebar-width) }`
       —— 那条是给开合动画「内容不回流」用的，但画板 01/02 的 `.pw-seg` 与 `.pw-side-search`
       靠**自己的左右外边距**内缩 8px，固定宽度把外边距一起顶出去了。
       现在这两个块交还给拉伸宽度（279 − 8×2 = 263，与画板逐像素一致），其余块保留固定宽度。
     - **顶栏左内边距被 `--main-workspace-header-leading-inset: "0px"` 归零**：
       该变量是为折叠导轨（92px）让位用的，展开态写 0 会把画板
       `.pw-topbar { padding: 0 var(--s2) }` 的 8px 一起吃掉（`padding-inline-start` 覆盖 board）。
       展开态改回落到 `var(--s2, 8px)`；折叠态仍是 92px。
     - **composer 附件「+」是 28px**（画板 `.pw-iconbtn` 全员 24px）。内联
       `width/height: var(--control-sm)` 删除，交给 board.css。
     - **模型芯片 `gap: 6`**（画板 `.pw-select` 是 4px，其余四枚芯片都吃 4）。内联删除。
     - **分区头图标是 `list-tree`，右端另起一枚 `.pw-iconbtn.sm` 的 `chevrons-up-down`**
       —— 画板 01/02 的 `.pw-group-title` 左端**就是** chevrons-up-down（「展开 / 折叠全部」的
       记号），右端只有 filter + plus（「添加项目」已按用户要求移除，见 84）。
       现在：左端换回 `chevrons-up-down`，整行接上那一个动作（`role=button` + Enter/Space + hover
       反馈在 fork-ui.css 的接线块），不再另起按钮 —— 22px 的 `.pw-iconbtn.sm` 会把标题推右 10px、
       行高从 29 增到 34。`check-align` 0 处偏差。

123. **标签条按画板 `.pw-tab` 归位**（`components/TabBar.tsx` + `app/fork-ui.css`）：
     内联样式原来整片压着 board —— `height: 28 / padding 10+4 / radius-md / gap 6 / TEXT.sm`，
     画板是 **26 高 / `padding: 0 var(--s2)` / `radius-4 4 0 0` / gap 5 / `--text-meta`(11)**。
     另外标签图标、关闭钮、溢出钮、概览钮**四枚手绘 SVG 全部退役**：
     - 终端标签 → `<i data-ico="terminal" data-size=13>`；浏览器标签 → `globe`；
     - 关闭钮 → 画板的 `.pw-tab .x` 壳（`<button class="x">` + `<i data-ico="x" data-size=11>`，
       UA 归零在 fork-ui.css 接线块），不再自绘 10×10 双线；
     - 折叠溢出 → `ellipsis`；标签概览 → `rows-3`。
     滑动指示条 `.fork-tab-pill`（登记同源的 `fork:zm-05`）跟着改成同样尺寸与圆角，
     竖向用 `top: var(--s1)` + `bottom: 0` + `margin: auto` 定位 —— 标签行在产品里是
     36px 的**合并头行**（画板是「标题行 + 标签行」两行，登记见 49），写死 `top` 会差 2px。

124. **面板头「新建浏览器标签」不再是自绘按钮**（`AppShell.tsx`）：
     它挂的是 `file-viewer-icon-button`（26px / 自带颜色与 hover），比同排其余 `.pw-iconbtn.sm`
     （22px）大一圈、色值也对不上。现已换成 `.pw-iconbtn.sm` + `globe`。
     `file-viewer-*` 家族其余部分仍属 SW-04/05（见文末登记）。

125. **`ProjectChip` 的四枚手绘 SVG 退役**（`components/fork/ProjectChip.tsx`）：
     `folder / folder-open / message-square / chevron-down` 四个近似形原来是手写 `<path>`，
     违反「图标一律 lucide，经 `<i data-ico>` 水合」。现在返回的就是那个 `<i>`，图标壳用画板的
     `.pw-ico`（原来是自己写的 `display:flex` 包壳，`opacity: .6` 也一并去掉 —— 画板没有这一档）。

126. **新会话顶栏那枚工作区芯片撤掉，改成输入框上方上下文条的分支项**（用户裁定）：
     - **顶栏**：新会话时不再渲染 `ProjectChip`/工作区芯片（用户：「红框里的这个帮我去掉」）。
       有会话时的分支芯片（`BranchChip` → 工作区列表）不动；换工作区/目录的入口统一在
       输入框上方那条 `.pw-ctxbar`（工作区芯片的菜单里含「打开文件夹」）。
     - **上下文条**：原来右端那枚「打开文件夹」按钮（101 条补的产品控件）换成**分支芯片**
       —— 用户：「打开文件夹这块，帮我换成 main，就是分支」。分支从 `/api/git/branch` 读
       （那个接口本来就是为这条上下文条写的，`resolveProject()` 一次 `git rev-parse`，
       不是 `git status` 全量）；读不到（非 git / 无权限）就不渲染这一项。
       芯片本体复用顶栏同一枚 `BranchChip`，点开是工作区列表 —— 顶栏撤掉那枚之后，
       「切到另一个 worktree」的能力在这里留着。
     - 规格补齐：`scripts/board-specs/01-workbench-a.mjs`（画板 01 帧 A 的 23 项对数）。

127. **系统目录选择器「取消」不再弹第二次框**（`lib/pick-directory.ts` + `components/AppShell.tsx`
     + 新增 `lib/pick-directory.test.mjs`）：
     路由在用户取消时回 `200 { cancelled: true }`，而 `pickDirectory()` 把「取消」和
     「这里没有原生选框（501 / 网络失败）」都归约成 `null`，调用方只能一律回退到手输弹窗 ——
     用户实测「点开系统文件夹后点取消，又弹一个选择目录的窗口」。
     现在返回三态 `{ picked | cancelled | unavailable }`：取消什么都不做，只有真的没有原生能力
     才回退。附带把 65s 的 `AbortController` 定时器挪进 `finally`（失败分支原来会把它留在
     事件循环里，测试进程因此多活 65 秒）。
     回归守卫：路由回 `cancelled` → 0 个弹窗；回 501 → 1 个弹窗（playwright 双向实测）。

128. **fork-ui.css 里一段断掉的注释**（P4「死 CSS 清退」的遗留）：删 `.fork-settings-select` 时
     把它的注释块提前闭合了，后面 10 行 `* …` 悬空成非法 token —— webpack 生产构建容忍它，
     Turbopack（`npm run dev:clean`）直接报 `Invalid dangling combinator in selector` 并拒绝编译。
     已并回同一个注释块。

**本轮登记不改（工作台）：**
- **右栏文件查看器全套**（`.pw-viewer / .pw-viewer-head / .pw-viewer-body / .pw-tree / .pw-split`）：
     仍是 `file-viewer-*` + 74 处内联，0 个 pw 类 —— 属计划里的 **SW-04/05**（最大遗留面），
     不并进本轮工作台的几何校验；
- **项目行的折叠箭头**紧跟名字（`fork:ui-project-row`，照 Zeno），画板 02 的项目行本身不画箭头，
     折叠箭头类 `.pw-row-toggle` 只用在搜索行/分组头 —— 保留产品形态；
- **`.pw-side-search` 只在搜索态出现**（38 / 81 条的既定裁定），画板帧 A 画的是常显；
- **新会话不画 `.pw-ring`**：空会话没有 `contextUsage` / `sessionStats`，环不渲染 ——
     与画板 20 帧 C（无项目态）同构；帧 A 那枚 1% 是静态示意；
- **`.pw-dot` / `.pw-await`**（未读点 / 「等你处理」）只在有该状态的行上出现，画板是静态示例；
- **顶栏动作钮的图标集合**与画板不同（MCP / 插件 / 自动命名 / 系统提示词 / 工具定义 / 导出），
     原因是产品功能集更大，逐枚登记见 34 / 85；
- **`.pw-empty` 的 32/16 内边距**、**`.pw-composer` 的 flex 列（拖高句柄）**、
     **`.pw-composer-top` 的高亮层双列**、**`.pw-topbar` 右内边距 28（给右栏边界开关让位）**：
     全部写进 `scripts/board-specs/01-workbench-a.mjs` 的 `knownDiffs`，逐条给了理由。

---

## N · 2026-09-30 用户反馈第三轮：设置页整体布局重设计（第 129–140 条）

> 用户带 5 张截图（模型 / 技能 / 子代理 / 插件 / MCP）说「这几个页面的整体布局
> 重新帮我设计一下，我觉得现在不合理的地方太多了」，并列出 12 个分节。
> **先说一个前提**：用户截图里的几处（模型页的「可用模型」列被切断、技能页的
> SKILL.md 被横向裁切）在第 94 条已经修过；本轮**以仓库构建（30141，18:0x）实测为准**，
> 逐页量了几何，只登记**在仓库构建里仍然成立**的问题。
> 新规格出画板 `62-settings-layout.html`，本节记的是「实测到的问题 → 新规格 → 待裁定」。

**实测（1440 × 900，仓库构建，`.settings-dialog-surface` = 全屏 1440×900，左导航 200）**

| 分节 | 页头 | 骨架 | 列表列 | 详情列 | 内容高度 |
|---|---|---|---|---|---|
| 常规 | 有 | 单列块流 | — | 块宽 **1160** | 1862（滚 2 屏） |
| 模型 | **无** | 列表 + 详情 | 260 | 884 | — |
| 技能 | **无** | 列表 + 详情 | 260 | 884（列表高 2957） | — |
| 子代理 | **无** | 顶部整宽条 + 两栏 | 260 | 884 | — |
| 插件 | **无** | 列表 + 详情 | 260 | 884 | — |
| MCP 服务器 | **无** | 列表 + 详情 | 260 | 884 | — |
| 定时任务 | 有（**没有 sub**） | 列表 + 详情 | 260 | 884 | 958 |
| 记忆 | 有（h2 + sub） | 块流 + 底部两栏 | 260 | 884（仅 420 高） | 1162 |
| 用量 | 旧类名 `settings-general-title` | 单列块流 | — | 卡网格 1100 | 2399 |
| 自定义命令 | h2 在 `.pw-inline` 里 | 列表 + 空右列 | 260 | 空 | 900 |
| 归档历史 | h2 在 `.settings-general` 里 | 单列块流 | — | — | 900 |
| 导入 | h2 在 `.settings-general` 里 | 块流 + 右侧浮卡 | — | 浮卡 300 | 900 |

129. **四种骨架并存**（画板 `62` 帧 A）。12 个分节用了 4 种互不相同的页面骨架：
     单列块流（常规 / 用量 / 归档 / 导入 / 自定义命令）、列表+详情（模型 / 技能 / 子代理 /
     插件 / MCP / 定时任务 / 记忆 / 自定义命令）、顶部整宽条+两栏（子代理）、
     块流+底部两栏（记忆）。切换分节时视觉锚点会跳。
     **新规格：收敛成 2 种。** 有「条目」概念的用「列表 300 + 内容 760」，
     没有的用「两栏块流 570 × 2」。

130. **字段行的「标签—控件」跨度最大 1000px**。常规页块宽 1160，`.pw-field` 是
     `justify-content: space-between` —— 「桌面通知」在最左（x≈230）、开关在最右（x≈1055）。
     子代理页顶部的两条设置行同样拉满 1160。定时任务表单跨度 500。
     **新规格：全站只有两个内容宽度 —— 列表 300、内容 760（块流页每栏 570）。**
     跨度 1000 → 570/760。

131. **详情列 884px，内容只占 350px**（画板 `62` 帧 A 的骨架 B）。MCP 详情的
     `kv` 只有 7 行、占左半边 350px，右边 530px 与下方 55% 都是空白；
     插件页同理。**新规格：详情列 `minmax(0, 760px)`，其余留白，不做拉伸。**

132. **7 个分节没有页头**：技能 / 子代理 / 插件 / MCP / 用量 / 自定义命令 / 导入。
     用户进到这些页看不到「这页是干嘛的」，也看不到本页的主动作
     （技能页要滚到列表底部才有安装入口）。

133. **4 个分节的 h2 不在内容区的直接子层，`board.css` 的 `> h2` 选择器没命中** ——
     页头排版因此与常规 / 记忆不一致。三处形态各不相同：
     - 用量 / 归档 / 导入：`<div class="settings-general"><h2 class="settings-general-title">`
       —— 用的是**旧类名**（`settings-general-*`），完全绕开画板 40 的 `pw-sbody > h2`；
     - 自定义命令：`<div class="pw-inline"><h2 style="margin:0">` + 两个直接子 `<p class="sub">`
       （第二段是等宽路径），h2 被包在 inline 行里，字号吃不到 15/500；
     - 定时任务：h2 是对的，但 `PwPageHead` **没有传 sub** ——
       左列那个「任务列表」是 `ConfigSectionTitle`（小节标题），不是页头说明。
     **新规格（129–133 合一条）：12 页全部有页头，h2 必须是分节内容区的直接子元素、
     且只出现一次；`p.sub` 写「这页是干嘛的」，不写数据；旧类名 `settings-general-title`
     退役，统一走 `PwPageHead`。**

134. **模型页的「保存」浮在视口右下角**（画板 `62` 帧 B 的对照项）。截图实测：
     未选中供应商时右列整片空白，`保存` 仍贴在面板右下角（y≈859）。
     这是第 94 条那个「面板 `overflow:hidden` + 保存按钮贴底」的残留形态 ——
     94 修的是「右列不能滚」，没修按钮的归属。
     **新规格：动作只有四级** —— ① 页级 → 页头右端（最多 2 个，1 主 1 次）；
     ② 列表级 → 工具栏右端（与计数同排）；③ 条目级 → 详情头右端；
     ④ 表单级 → 表单块底部右对齐。**禁止浮在视口角落的按钮。**

135. **MCP 页的页脚显示的是插件页的统计**：`4 ext · 7 skills · 0 prompts · 0 themes`
     两页都在（`PluginsConfig` 的 `only="mcp"` 模式没把 footer 一起关掉）。
     插件页还同时有页头「检查」与页脚「检查更新 / 刷新」两组同名动作。
     **新规格：页脚不放动作，也不放别的分节的统计。**

136. **空态没有落点**：
     - 自定义命令页的空态说明「保存后斜杠面板立即可用，无需重载。」**飘在右列中段**（x≈635）；
     - 归档历史页两个小节的空态是贴左的一行小字，右端各有一枚**没有文字标签的眼睛图标**；
     - 定时任务页左列的空态「还没有定时任务。」是列表里的一行小字；
     - 详情列未选中时（模型页）是居中的一句「选择 Provider 或模型」，但同一形态在
       自定义命令页就不是居中 —— 三处三种做法。
     **新规格：空态三态各有落点** —— 列表空在列表列内（32px 图标 + 一句 + 一句说明）；
     详情未选在详情列**居中**（40px 方框图标 + 一句引导）；整页空在内容区居中
     （20px 标题 + 说明 + 一个出口动作）。说明写进空态本体，不飘到别处。

137. **滚动归属不统一**：分节内容区高度都等于面板高（900），但内容更高的分节
     （常规 1862 / 记忆 1162 / 用量 2399 / 定时任务 958）靠外层滚；技能页的列表列
     2957 高靠左列自己滚、详情列 884 靠右列自己滚；记忆页两栏只有 420 高被夹在中段。
     选中技能列表第 20 项时，详情仍在视野内（因为两列各自滚）—— 这一条是对的，
     但它只是技能页碰巧对了，不是规格。
     **新规格：分节内容区 `flex column + min-height:0`，页头与工具栏 `flex:none`；
     列表页两列各自滚；块流页只有块流区滚；详情内部不再套第二层滚动。**

138. **技能详情是「裸字段罗列」**（画板 `62` 帧 B 对照）。现在渲染的是
     `Name` / `Description` / `内容` 三行 + 一个「编辑」按钮 —— 没有作用域徽章、
     没有来源 / 路径 / 允许自动调用，也没有条目级动作。画板 42 画的是
     「头部（名字 + 作用域徽章 + 在文件面板打开）+ `pw-kv`（来源 / 路径 / 允许自动调用）
     + SKILL.md 正文（可编辑，带磁盘冲突动作）」。
     **本轮：按画板 42 补结构**（这是画板早就画了、实现没跟上的部分，不是新规格）。

139. **子代理页的顶部两条整宽设置行**（画板 `62` 帧 A 的骨架 C）：
     「启用 PI NEXT 内置子代理」的标签在最左、开关在最右（相距 1000px），
     第二行「并发子代理数」同理。下面才切进两栏。
     **新规格（待裁定）：收进列表列「内置」组顶部的一条紧凑设置行**，让主区域始终是
     统一的两栏 —— 或者反过来，把它移进详情列里选中「内置」组时的详情。

140. **本轮登记不改**：
     - **用量页 9 张卡排成 4+4+1**：新规格给的是「两栏里 2×2 对齐」，但卡片数是产品语义
       （Token / 会话 / 消息 / 活跃天数 / 连续天数 / 最常用模型 / 缓存 / 工具成功率 / 成本），
       拆成几栏要等裁定；
     - **热力图 / 条形图拉满 1100**：图表宽度属于图表组件自己的规格（画板 45），
       本轮只登记「块流页收成 570 后图表要跟着收」；
     - **`--motion-layout` 与滚动条宽度**：不在本轮范围。

**需要裁定的三项**（裁定后回填本节，并把结论写进画板 `62`）：
1. 是否接受「列表 300 / 内容 760」这两个固定宽度（替代现在的 260 / 884）；
2. 是否接受把子代理页顶部的两条整宽设置行收进列表列（第 139 条）；
3. 用量页 9 张卡与两张图表在「两栏块流」里怎么排（第 140 条第一项）。

### N-1 · 用户裁定与落地（2026-09-30 同日）

用户回复「可以，按你的来吧」——**三项全部按提案执行**。落地清单：

141. **新框架三件套进设计系统**（`board.css` + `SettingsUi.tsx` + `app/settings.css`）：
     - `board.css` 新增 `.pw-shead`（页头）/ `.pw-stools`（工具栏）/ `.pw-scontent`（唯一滚动的内容区）
       / `.pw-scontent.is-fixed`（列表页：内容区不滚，两列各自滚）/ `.pw-narrow`（760 宽）
       / `.pw-stats-grid.is-2col` / `.pw-stools .pw-search`；
       `.pw-cols` 从 `260px minmax(0,1fr)` 改成 **`300px minmax(0,760px)`**。
     - `SettingsUi.tsx`：`PwPageHead` **退役**，换成 `SettingsPage`（head + 可选 toolbar + content，
       返回 Fragment 而不是 wrapper —— 宿主本身就是 flex column，多一层会断掉 `height:100%`）
       + `PwSearch`。
     - `app/settings.css`：`.settings-section-host.pw-sbody:has(> .pw-shead)` 改成 flex column
       （页边距归零，交给三件套）。**用 `:has()` 是为了让 12 个分节可以一页一页迁移** ——
       没迁移的分节继续走原来那条「宿主自己滚」，不会被裁掉。

142. **12 个分节全部迁移**，动作按四级归位：
     - 页级（页头右端）：技能「安装技能 / 检查更新」、子代理「新建子代理」、插件「添加插件 / 更新全部」、
       MCP「添加服务器 / 从其它 agent 导入」、模型「添加供应商 / 保存」、自定义命令「新建命令」、
       记忆「标记已整理」、导入「扫描」。
     - 列表级（工具栏）：计数徽章 + 刷新 / 检查更新 / 全部更新；技能、子代理、模型、自定义命令补了搜索框。
     - 表单级：模型「保存」从**视口右下角的浮动按钮**移到页头（整页就是那张表单，页头保存是它的正确层级）；
       子代理的保存从页脚移进详情卡底部。
     - **页脚整块删除**：`SkillsConfig` / `AgentsConfig` / `PluginsConfig` / `ModelsConfig` 四个
       `ConfigFooter` 全部撤掉 —— 其中插件/MCP 页脚**在 MCP 页原样显示插件页的统计**
       （`4 ext · 7 skills · 0 prompts · 0 themes`），第 135 条记的就是这一处。

143. **子代理页顶部的两条整宽设置行收进列表列**（第 139 条）：`AgentsConfig` 的
     `.pw-block`（启用内置子代理 / 并发子代理数）从 `ConfigSplitView` **上方**移进
     `<ConfigSidebar>` 顶部。1440 面板下标签与控件的距离从 1000px 收到 268px 列宽内。

144. **技能页补搜索与计数**（第 138 条的延伸）：`SkillsConfig` 新增 `listQuery`，
     工具栏按名字 / 描述 / 路径过滤；计数从页脚搬到工具栏（`skills.count`）。

145. **用量页**（第 140 条第一项）按「两栏块流」重排：左栏 = 统计卡（`StatGrid columns={2}`，
     九张卡从 4+4+1 变成 2×5）+ 热力图；右栏 = 按模型 / 请求与错误 / 每日 token / 按项目。
     周期芯片 + 扫描进度 + 刷新进工具栏；热力图宽度从 1100 收到 570。
     〔登记残留〕**块本身的类名还是旧的 `settings-general-section` / `pw-cell`**，
     没有换成画板的 `.pw-block`（那是产品自己的 token：`--border` / `--radius-lg`）——
     属下一轮的外观对齐，本轮只动布局。

146. **记忆页**（第 129–133 条）：页头 + 「标记已整理」进页头；状态块与工具块收进 `.pw-narrow`（760）。
     〔与提案的差异〕画板 62 写的是「统一两栏」，落地时两块仍留在两栏**上方** ——
     把它们塞进详情列会让「未选中文件」的空态与状态块打架。登记为有意偏离。

147. **常规页改两栏块流**：10 个块按语义分栏（左 = 外观 / 主题皮肤 / 壁纸 / 侧栏；
     右 = 通知 / 字体 / 语言 / 聊天 / Shell / 推送），每栏 570。原来是一条 1160 宽的单列、
     内容高 1862（滚两屏），字段行跨度 1000。

148. **归档 / 导入 / 用量 / 自定义命令的 h2 归位**（第 133 条）：四处原来分别是
     `.settings-general-title`（旧类名）、`.pw-inline > h2`、`<div className="settings-general">` 包裹 ——
     全部换成 `SettingsPage`，h2 成为分节内容区的直接子元素。
     `.settings-archive-page` 与 `ImportPanel` 的外层 `.settings-general` 一并撤掉。

149. **同步测试断言**：`SettingsUi.test.mjs`（基件清单 + `.pw-cols` 宽度 + 两条「滚动容器」断言改成
     新的选择器 + 「页脚不再放动作」）、`AgentsConfig.test.mjs`（新建入口从列表行改到页头）、
     `ModelsConfig.test.mjs`、`CronConfig.test.mjs`、`PiMemoryConfig.test.mjs`、
     `UsageStatsPanel.test.mjs`。新增三语文案：`skills.pageSub / search / count / noneFound`、
     `agents.pageSub / count / noneFound`、`models.providerCount`、`mcp.pageSub / count`、
     `plugins.pageSub`、`cron.pageSub / count`、`prompts.count`。

150. **本轮验证**：`tsc --noEmit` 0 错；`npm test` **2385/2385 全绿**；
     `npm run check:design` 四门禁全过（样式字面量 184 文件 0 违规 / 动效 0 / 图标 381 处全命中 /
     31 张画板 0 错误 + 对齐 0 处偏差）；eslint 改动文件 0 error。

151. **改完第一版实测抓到的 5 个回归**（都在这一轮修掉，值得记下来）：
     - **`cron.pageSub` / `cron.count` 忘了加三语文案** → 页面上直接显示原始 key。
       教训：新增 key 必须在 `en` / `zh-CN` / `zh-TW` 三处各 grep 一遍。
     - **`.pw-label` 是 `flex: 0 0 auto`**：块流页收进 570 的一栏后，长 `small` 说明
       （推送注册那句 30+ 字）把标签撑到 1300+ 宽、溢出内容区 338px。
       改成 `flex: 0 1 auto` + `max-width: 100%`（换行交给文字，放不下时控件由
       `.pw-field` 的 `flex-wrap` 换行）。
     - **详情卡里的 grid 子项 `min-width: auto`** 被 min-content 撑破卡片：
       技能详情的 SKILL.md 只读盒（长代码行）把内容顶到 847 宽、横向溢出卡片 88px。
       加 `.pw-detail > *, .pw-detail .pw-detail-stack > * { min-width: 0 }`。
     - **详情列的空态「飘着」**：`.pw-empty` 的 `flex: 1` 在 block 父级里无效，
       `place-items: center` 只在自己那点内容高度里居中。`.pw-detail` 改成 flex 列 +
       `ConfigDetailStack` 补 `.pw-detail-stack` 钩子类（`flex: 1`）。
     - **按钮文字换行**（「打开皮肤工作室」折成两行）→ `.pw-btn { white-space: nowrap }`。

152. **`:has()` 必须是后代选择器**（第 141 条的修正）：列表页（模型 / 技能 / 子代理 /
     插件 / MCP）外面还套着 `ConfigPanelShell` 的两层 `.config-panel-root` /
     `.config-panel-surface`，三件套**不是宿主的直接子元素**。写成 `:has(> .pw-shead)`
     会让这 5 页漏掉 —— 宿主仍带 24/40/32 内边距 + 自己的滚动条，100% 高的内层
     因此溢出 56px、右侧多出一条滚动条（实测 `hostOverflowY: auto`）。
     改成 `:has(.pw-shead)` 后 12 页横向溢出**全部归零**。

153. **技能详情的元信息改成 `.pw-kv` 属性表**（第 138 条的收尾）：`Name` / `Description`
     原来是两行 `.pw-field`（标签最左、值最右），详情列 760 宽时「Name」与「image-gen」
     相距 640px，读起来是两段不相干的文字；而且标签还是**硬编码英文**。
     现在：名称 / 描述 / 来源 / 版本 四行进 `.pw-kv`（140px 标签 + 值），
     标签走三语文案（`skills.fieldName / fieldDescription / fieldSource / fieldVersion`），
     「检查 / 更新」两个按钮按 ③ 条目级归到详情头右端。

154. **移动端补三件套的内边距**：`.pw-shead` / `.pw-stools` / `.pw-scontent` 的桌面值
     是左右各 40；`@media (max-width: 900px)` 里收到 `--s4`，与原来
     `.settings-section-host.pw-sbody` 那条同源。

**仍未做（下一轮，已登记）**：
- 用量页的块仍用产品自有的 `settings-general-section` / `pw-cell`（`--border` /
  `--radius-lg`），没换成画板的 `.pw-block`；
- MCP 详情仍是 `pw-kv` 属性表，没换成行式 `.pw-field`（第 134 条）；
- 归档历史页两个小节的空态没重排，右端仍有一枚无文字标签的眼睛图标（第 136 条）。

### N-2 · 用户复验后报的两个问题（2026-09-30 同日晚）

用户：「记忆页面不能滑动，然后用量页面好像是假的，没有真实数据吗」。
两条都实测复现，**都是这一轮迁移引入/放大的**：

155. **记忆页不能滚动 —— 我把 `fill` 用错了页面**（`PiMemoryConfig.tsx`）。
     `SettingsPage` 的 `fill` 会给出 `.pw-scontent.is-fixed`（`overflow: hidden`），
     那是**纯列表页**的形态（内容区不滚，两列各自滚）。记忆页不是：
     状态块 + 工具块 + 两栏加起来 **1062px**，而内容区只有 **819px** ——
     `is-fixed` 把多出来的 **243px 直接裁掉，连滚动条都没有**
     （实测 `contentOverflowY: hidden`、`scrollables: []`）。
     去掉 `fill` 后整页共用一个滚动容器（`scrollables: [{ pw-scontent, sh 1062, ch 819 }]`）。
     **判据（已写成守卫测试）**：分节里除了 `.pw-cols` 还有别的块时，不能用 `fill`。

156. **用量页的年度热力图被裁成「假数据」**（`UsageStatsPanel.tsx`）。
     数据是真的：接口回 **158 会话 / 40186 消息 / 4.15B token / US$31.44 / 16 个模型**，
     统计卡与「按模型」都是真实值。假的是**图** —— 年度热力图是
     「53 周 × 14px ≈ 742px」的固定轨道网格，我把它放进了 **570 的一栏**：
     可见宽度只有 514px，而**最近的活动全在最右端**（今天在最后一列）。
     用户看到的是一整片空白灰格子。
     改成**整行**（1160）：热力图容器 1100 宽，`scrollWidth === clientWidth`，
     12 个月标签齐、9 月的活动格子可见。
     新的页面骨架是「两栏（统计卡 / 按模型）→ 整行热力图 → 两栏（每日 token / 按项目）」。
     **判据（已写成守卫测试）**：`pw-grid2` 出现 2 次，`<UsageHeatmap>` 必须落在两者之间。

157. **新增两条守卫测试**：`PiMemoryConfig.test.mjs` 的「记忆页不用 fill」、
     `UsageStatsPanel.test.mjs` 的「年度热力图占一整行」。
     `npm test` 2387/2387 全绿；`check:design` 四门禁全过。

**由此得到的一条通用规则（补进画板 62 的硬规则）**：
`fill`（`.pw-scontent.is-fixed`）**只给「整个分节就是一个列表 + 一个详情」的页面**。
分节里只要还有别的块（状态块 / 工具块 / 说明块），就必须用默认滚动 —— 否则
超出的部分会被静默裁掉。另外：**任何固定轨道的年度/长跨度图表，都不要放进 570 的一栏**，
它的右端才是最近的数据。

### N-3 · 「画板画得好，落地有差距」——根因与修复（2026-09-30 同日晚）

用户：「我发现你都是 `62-settings-layout.html` 这个设计的好，但是真正落地的时候
就有差距了，就不按照规划的进行设计了，咋回事啊」。

**根因（实测到的，不是推测）：画板与实现是两套 DOM。**

```
画板 62 里  pw-shead  出现次数 = 0     ← 帧是手写内联样式画的
board.css   .pw-shead 规则条数 = 5     ← 落地时才新造的类
组件        pw-shead  出现次数 = 3     ← SettingsPage
```

没有共同选择器 → `scripts/board-diff.mjs` 逐项报「画板里没有这个选择器」→
只能靠人眼比 → 必然漂移。**而且 live 对位本身早就跑不动：**

1. `package.json` 的 `verify:boards` 写成 `... && node scripts/board-diff.mjs`，
   而 `board-diff.mjs` 是**单 spec 的顶层脚本**，不带参数只打印用法并 `exit 2`
   —— 所以**整条命令从来没真正跑过**。
2. `settings:<X>` 预设按**分节行的文字**找（界面是中文，spec 传的是 `skills` / `常规`），
   找不到 → 设置面板根本没打开 → 所有 `.pw-*` 都报「产品里没有」——**假阴性**。
3. 设置分节是**懒挂载 + 常驻**（切走只加 `hidden`），`document.querySelector`
   会命中上一个分节的节点 —— 实测技能页被拿去和常规页的 `.pw-scontent` 比。

**修复**：

158. **补 `scripts/board-specs/62-settings-layout.mjs`（帧 B 列表页）与
     `62-settings-blockflow.mjs`（帧 C 两栏块流）**，把画板 62 的两个骨架变成可跑的规格。
159. **修 `board-diff.mjs` 的三处硬伤**：
     - 新增 `scripts/board-diff-all.mjs`（遍历 `board-specs/*.mjs`），
       `verify:boards` 改成跑它 —— 现在**能真正跑全部 10 份 spec**；
     - `settings:<X>` 先按 `[data-section]` 找，找不到再退回按文字（兼容旧 spec）；
       `SettingsPanel` 的导航行补上 `data-section={item.id}`
       （分节 id 与语言无关，这是脚本 / 测试该用的锚点）；
     - 产品侧探测**跳过藏在 `[hidden]` 里的匹配**（懒挂载分节），
       不缩范围 —— 壳级选择器（`.pw-settings` / `.pw-snav`）因此仍能取到。
160. **把画板 40–46 的 13 个页帧迁到新三件套**（`.pw-shead` / `.pw-stools` /
     `.pw-scontent`）。它们原来全是旧帧（`.pw-sbody` 直接跟 `h2` 或 `pw-inline` 标题行），
     与实现已经不是一个东西。顺带把过时的元素去掉：
     列表底部的 `.pw-litem-add`「添加插件 / 添加模型」已按画板 62 移到页头；
     子代理帧的「内置子代理」块从两栏上方收进列表列；模型 / 插件 / 技能 / 子代理
     补了页头动作与工具栏。
161. **新增静态守卫**（进 `check:design`，不需要浏览器）：
     `SettingsUi.test.mjs` 的「画板与实现共用同一套设置页框架类」——
     钉死 `SettingsPage` 输出的五个类在 board.css 里有规则，且 8 个设置画板的页帧
     都必须用 `.pw-shead` / `.pw-scontent`，**不许再出现旧帧**。
     这条能挡住「画板手写内联、实现另造类」再次发生。
162. **剩余差距登记为 `knownDiffs`**（`npm run verify:boards` 现在 **10 份 spec 全部 0 不符**）：
     - `.pw-field` gap 6/16 vs 16 —— `fork:settings-field-density` 接线，既有登记；
     - 模型 / 自定义命令的详情卡、字段行、统计卡 —— **数据依赖**（没选中供应商、
       本机 0 条命令），空态下本来就没有那些节点；
     - `.pw-skin-strip` / `.pw-skin .cap`、`.pw-inline` —— 产品接线层的留白与 UA 归零；
     - **画板 47 皮肤工作室是真差距**：产品里已经不是 `.pw-modal` 结构
       （半径 0、`.pw-modal-head` display:none、无 `.pw-modal-foot`），画板画的还是模态框。
       **列为下一轮待办**，不掩盖。

**由此得到的第二条通用规则**：
**画板帧必须直接写实现的那套类名**（`class="pw-*"`，规则在 board.css），
**不能用内联样式另画一套** —— 内联的那一套没有任何机制能验证，写完即漂移。
`board-diff` 的 `knownDiffs` 只允许登记「有注释的接线」与「数据依赖」，
不允许登记「画板画的形态产品没有」。




