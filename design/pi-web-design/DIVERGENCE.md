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
      扁平分支列表，与产品的树导航不同构——登记同 Git 图泳道；
    - 内容块六分支的 resource_link / 音频 / embedded text：`AssistantContentBlock`
      类型没有这些变体（`lib/types.ts`），无数据源不画；
    - 导入「本次选择」的来源/预计写入明细：产品选择态只有 id 集合，明细无从算起。
