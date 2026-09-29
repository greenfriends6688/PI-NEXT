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

2. **应用标记改单色**：设计稿的壳内标记是单色 π（`--n-strong` + 一个 `--accent` 锚点）。
   实现用的是 `public/pi-agent-logo.svg`，蓝紫渐变多色。理由：本规范只留一个强调色。
   落地前需要裁定是否放弃现有渐变标识。

3. **工具调用收成过程时间轴**：参考项目把每个工具调用画成独立卡片；本设计**沿用本项目现有的
   `ProcessGroup` 形态**（一条竖线串起的步骤流 + 汇总行），只在视觉上重做。
   这与参考项目画板 18/19 的形态不同，是有意选择：省纵向空间、失败行能就地标红。

4. **权限卡用强调色边框 + 淡底**：本规范 § 1.2 说卡片一律 1px 发丝边框、无彩色。
   权限卡是唯一例外（还有子代理卡的 2px 左侧强调线）。理由：它是唯一需要抢注意力的卡，
   且与「等你处理」的 warning 色在语义上要区分开（一个是「需要你决策」，一个是「提醒你去看」）。

5. **设置从 4 块扩成 13 分节**：参考项目的设置只做四块（agent 配置 / 从 Zed 导入 / Node 运行时 / 数据目录）。
   本项目的设置实际有 13 个分节（含定时任务、记忆、快捷键、用量、自定义命令、归档、导入），
   设计把它们拆成 8 张画板（`40`–`47`）。这不是偏离实现，是**实现比参考项目复杂得多**。

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
    - **设置分节内容不换**：settings.css 的 154 个 `config-*` 类已完整承载分节样式，
      且引入顺序在 board.css 之后（逐类追加 pw 会被压掉），维持现状——登记。
    - **探测验证**：3×`.pw-msg-user`、1×`.pw-composer`、1×`.pw-topbar`、5×`.pw-trow`、
      7×`.pw-iconbtn`、5×`.pw-select`、`i[data-ico]` 全部 hydrate。
    - **累计 32 个组件/壳直接使用画板原件**。

37. **最终剩余（视觉已同源 token，属形态差异或归属迁移收益为零，全部登记不阻塞）**：
    子代理独立卡（`.pw-sub`——产品以工具卡徽标呈现）、diff 分栏词级视图（自有实现，
    颜色走 `--diff-*`）、Git 图（SVG 泳道）、设置分节内容（`config-*` 154 类承载）、
    侧栏会话行运行态细节（fork-ui.css 扫掠线，画板 02 同源）。

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
   `.pw-side-nav`（`.pw-row` 新建任务）、`.pw-seg`、`.pw-side-search`（常显搜索框）、
   `.pw-side-scroll`、`.pw-side-foot`（设置 + 版本徽章）。
   搜索不再藏在图标后面：画板画的是常显一格，头部搜索钮改为聚焦它。
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
