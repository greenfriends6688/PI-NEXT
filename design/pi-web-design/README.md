# Pi Web 设计画板 · 索引

> 本目录是 **Pi Web 的前端设计系统**：一份规范（`DESIGN-SPEC.md`）、一张 Token 表（`assets/tokens.css`）、
> 一套静态画板（`NN-*.html`）。画板是**功能边界**：画板没画的不做。
> 看画板之前先看 [`DIVERGENCE.md`](DIVERGENCE.md)：那里逐条记着设计与现有实现不一致的地方。

## 怎么打开

直接双击 `index.html`，它是一张**导航首页**，列出全部画板并给出预览缩略。
单个画板也可以直接双击打开，它们自带样式与图标集，不依赖服务器。

```
design/pi-web-design/
  README.md            本文件：索引 + 与参考项目的逐条对应
  DESIGN-SPEC.md       设计规范（风格系统 · 结构来源 · 画板清单 · 产出要求）
  DIVERGENCE.md        设计与现有实现的偏离清单
  index.html           导航首页
  brand/               应用标记来源（不是画板）
  assets/
    tokens.css         Token 表（唯一样式来源）
    board.css          画板样式（pw- 前缀）
    icons.js           lucide 图标集（255 个，data-ico 用法）
  00-tokens.html … 62-settings-layout.html   （30 张，不含本目录的 index.html）
```

## 约定

- **画板编号只增不改、不重排**；废弃的画板留「已废弃」占位。
- 一个画板一个 `.html`，文件名即身份，编号与下表一致；文件名只用字母、数字与连字符。
- 桌面整页画板 frame **1440×900**；卡片画板宽 **800**、高按内容；弹层合集 **1200×800**。
- **先看 `00-tokens`**：页面画板都从它取值；画板里出现的每个数值都要能在 `assets/tokens.css` 找到。
- **图标一律 lucide**（<https://lucide.dev>），内联 SVG，**不用 emoji**。
- 画板里的颜色 / 字号 / 间距 / 圆角**不写字面量**，一律引用 `var(--token)`。

## 画板

### P1 · Token 与壳

| 编号 | 名称 | 页面 | 文件 | 状态 |
|---|---|---|---|---|
| 00 | Token 表 | 全局 | `00-tokens.html` | 已出画板 |
| 01 | 工作台（新会话 / 进行中 / 回合结束 + 右栏 / **零会话起步三卡 + 选中型空态**） | 会话工作台 | `01-workbench.html` | 已出画板 |
| 02 | 侧栏与顶栏状态（双 pane / 搜索 / 会话行五态 / **自定义分组** / 折叠导轨 / 顶栏两态） | 会话工作台 | `02-sidebar-topbar.html` | 已出画板 |
| 05 | 动效规格（四类转场 + 轻量交互 + **17 项可播放动效**） | 全局 | `05-motion.html` | 已出画板 |
| 07 | 深色 Token 对位表 | 全局 | `07-dark-tokens.html` | 已出画板 |

### P2 · 转录卡片

| 编号 | 名称 | 页面 | 文件 | 状态 |
|---|---|---|---|---|
| 10 | 文本类卡片 | 转录 | `10-transcript-text.html` | 已出画板 |
| 11 | 过程类卡片 | 转录 | `11-transcript-process.html` | 已出画板 |
| 12 | 交互类卡片 | 转录 | `12-transcript-interactive.html` | 已出画板 |
| 53 | 转录辅助件与导航 | 会话工作台 / 转录 | `53-turn-and-nav.html` | 已出画板 |
| 54 | 扩展浮窗 / 链接 / 探索分支 | 会话工作台 / 右栏 | `54-extension-links-exploration.html` | 已出画板 |

### P3 · 输入框与弹层

| 编号 | 名称 | 页面 | 文件 | 状态 |
|---|---|---|---|---|
| 20 | 输入框与控件（**输入框下方无常驻条，用量在上下文环浮窗**） | 会话工作台 | `20-composer.html` | 已出画板 |
| 21 | 输入框弹层（含**输入历史**与**命令菜单实现形态**） | 会话工作台 | `21-menus.html` | 已出画板 |
| 22 | 顶栏下拉（系统提示词 / 工具定义 / 子代理 / 最近会话 / 分支 / **MCP** / **插件** / 查找条） | 会话工作台 | `22-top-panels.html` | 已出画板 |

### P4 · 右栏面板

| 编号 | 名称 | 页面 | 文件 | 状态 |
|---|---|---|---|---|
| 30 | 文件面板 | 文件面板 | `30-files-panel.html` | 已出画板 |
| 31 | 终端 / 浏览器 / Git | 文件面板 | `31-terminal-browser-git.html` | 已出画板 |
| 52 | 文件查看器其余形态 | 文件面板 | `52-file-viewer-modes.html` | 已出画板 |

### P5 · 设置

| 编号 | 名称 | 页面 | 文件 | 状态 |
|---|---|---|---|---|
| 40 | 设置 · 常规 | 设置 | `40-settings-general.html` | 已出画板 |
| 41 | 设置 · 模型 | 设置 | `41-settings-models.html` | 已出画板 |
| 42 | 设置 · 子代理 / 技能 | 设置 | `42-settings-agents-skills.html` | 已出画板 |
| 43 | 设置 · 插件 / MCP | 设置 | `43-settings-plugins-mcp.html` | 已出画板 |
| 44 | 设置 · 定时任务 / 记忆 | 设置 | `44-settings-cron-memory.html` | 已出画板 |
| 45 | 设置 · 快捷键 / 用量 | 设置 | `45-settings-shortcuts-usage.html` | 已出画板 |
| 46 | 设置 · 命令 / 归档 / 导入 | 设置 | `46-settings-prompts-archive-import.html` | 已出画板 |
| 47 | 皮肤工作室与壁纸（含**对话框外壳**） | 设置 | `47-skin-studio.html` | 已出画板 |
| 62 | 设置 · **布局重设计**（诊断四种骨架 / 新框架解剖 / 两栏块流 / 空态三态 / 动作四级 / 12 页落位表） | 设置 | `62-settings-layout.html` | 已出画板（提案，待裁定） |

### P6 · 其它页面

| 编号 | 名称 | 页面 | 文件 | 状态 |
|---|---|---|---|---|
| 50 | 对话框（项目信任 / 目录选择 / 扩展请求 / 确认 / 通知条 / **附件预览灯箱**） | 全局 | `50-dialogs.html` | 已出画板 |
| 51 | 菜单合集（原子表 + 四个真实菜单 + **行内动作簇**） | 全局 | `51-menus.html` | 已出画板 |
| 56 | 更新与认证 | 设置 / 会话工作台 | `56-update-and-auth.html` | 已出画板（2026-09-29 由 `56-agent-management.html` 更名，编号不变） |
| 60 | 移动端与 PWA（断点 **1024 / 640 / 480**，与 `hooks/useIsMobile.ts` 同源） | 会话工作台（窄屏） | `60-mobile-pwa.html` | 已出画板（2026-09-29 断点按实现对齐，380 → 480） |
| 61 | 系统状态页（错误页 / 拖放 / worktree / **离线态** / **长文本溢出**） | 全局 / 会话工作台 | `61-system-states.html` | 已出画板 |

状态取值：`已出画板`（画板已产出，代码未跟进）/ `已实现（R<N>）` / `已废弃`。

---

## 覆盖审计（2026-09-28）

把项目里全部 **91 个组件 + 26 个 hooks + 4 个路由** 逐条对到画板上，结论如下。

### 首轮漏掉、已补的（第二版新增 5 张画板）

| 漏掉的功能面 | 对应组件 / 文件 | 补在哪 |
|---|---|---|
| **移动端与 PWA**（抽屉侧栏、移动端顶栏、**覆盖式工具条**、安全区、standalone、安装提示、粗指针适配、移动端信任横幅、四档断点） | `useIsMobile` / `AppShell(mobile)` / `PwaRegistration` / `app/manifest.ts` / `globals.css` 的 `display-mode: standalone` + `pointer: coarse` 块 | `60-mobile-pwa.html` |
| **应用级错误页**（路由级 + 根布局级） | `app/error.tsx` / `app/global-error.tsx` | `61-system-states.html` |
| **拖放落区**（可接受 / 拒绝 / 拖到输入框 / 四条规则） | `useDragDrop` / `ChatWindow` | `61-system-states.html` |
| **worktree 切换器**（切换 / 过滤 / 新建 / 移除确认） | `SessionSidebar` 的 worktree 段 / `lib/worktree.ts` | `61-system-states.html` |
| **文件可编辑模式**（未保存 / 保存冲突） | `CodeFileEditor` | `52-file-viewer-modes.html` |
| **CSV 表格预览** | `fork/CsvPreview` | `52-file-viewer-modes.html` |
| **图片缩放预览** | `ImagePreview` | `52-file-viewer-modes.html` |
| **Markdown frontmatter 卡** | `FrontmatterCard` | `52-file-viewer-modes.html` |
| **长列表滚动淡出** | `fork/ScrollFadeViewport` | `52-file-viewer-modes.html` |
| **转录迷你地图** | `ChatMinimap` | `53-turn-and-nav.html` |
| **等待首 token 的阶段行** | `fork/PhaseRoll` | `53-turn-and-nav.html` |
| **回合写过的文件** | `TurnWrittenFiles` | `53-turn-and-nav.html` |
| **项目芯片 / 待办芯片** | `fork/ProjectChip` / `fork/TodoChip` | `53-turn-and-nav.html` |
| **路径动作菜单** | `fork/PathActions` | `53-turn-and-nav.html` |
| **Git ref 芯片** | `GitRefChips` | `53-turn-and-nav.html` |
| **扩展 widget / 扩展状态条** | `ExtensionWidgets` / `ExtensionStatusBar` | `54-extension-links-exploration.html` |
| **链接在哪儿打开** | `LinkOpenContext` | `54-extension-links-exploration.html` |
| **附件预览（六种渲染分支）** | `fork/AttachmentPreview` | `54-extension-links-exploration.html` |
| **探索分支（抬头条 + 只读并排视图）** | `fork/ExplorationBanner` / `fork/ExplorationPane` | `54-extension-links-exploration.html` |

### 第二轮深挖补的（扫 `app/*.css` 的类名才发现的）

| 漏掉的功能面 | 来源 | 补在哪 |
|---|---|---|
| **输入框内的 token 高亮**（`@` 引用 / `/` 命令着色，透明 textarea + 高亮层） | `ChatInput` 的 `.chat-input-highlight*` / `.mention-token` | `20-composer.html` |
| **输入框可拖高**（顶部 12px 把手，双击复位，上限 40vh） | `useResizableHeight` / `.chat-input-resize-handle` | `20-composer.html` |
| **空态输入框上方的凸出条**（工作区目标芯片 + 一句说明） | `ChatWindow` 的 `protrusion` / `.fork-protrusion-bar` | `01-workbench.html` 帧 A |
| **移动端设置的分节选择器**（左列 200px 导航换成下拉） | `.settings-mobile-section-picker` | `60-mobile-pwa.html` |
| **触屏下悬浮动作必须常显** | `.fork-msg-actions` 的 `@media (hover: hover)` 门控 | `60-mobile-pwa.html` |
| **PWA 平板档**（641–1024 的 composer 裁剪） | `fork:pwa-tablet-tier` | `60-mobile-pwa.html` 断点表 |

### 第三轮：对照参考项目逐画板比对 + 按钮审计

这一轮是**拿着参考项目的 40 张画板逐张对**，再把项目里所有按钮/动作文案提出来逐个核对，又补出以下内容。

**从参考项目画板 06 补的（此前完全漏掉）**：

| 补的内容 | 落在 |
|---|---|
| 运行中：会话项**底边 1px 常亮线 + 96px 强调亮点匀速掠过**（1400ms linear infinite，行高 48 → 58） | `02-sidebar-topbar.html` |
| 完成：**`N 条消息` 之后的 6px success 绿点**（只做 opacity，被查看后淡出且不留占位） | `02-sidebar-topbar.html` |
| 等你处理：同一位置一枚 warning 文字标记（待授权 / 待输入），行高 58、扫掠撤掉只留底线 | `02-sidebar-topbar.html` |
| 三者互斥表（含「取消与失败在侧栏一律不表达」） | `02-sidebar-topbar.html` |

**从参考项目其余画板补的**：

| 补的内容 | 参考画板 | 落在 |
|---|---|---|
| 工具卡展开后的**底部收起条** | 18 | `11-transcript-process.html` |
| 失败卡**不整卡描红**，只换状态图标 + 输出底色 `error.soft` | 19 | `11-transcript-process.html` |
| diff **行悬浮**才出「在文件面板中定位」 | 21 | `11-transcript-process.html` |
| 子代理完成后展开：嵌套工具行 + `↳ Subagent Output` + 反馈图标 | 24 | `11-transcript-process.html` |
| 卡片下方的 `Awaiting Confirmation` 等待行 + 两种停靠条（待授权 / 待输入，带 Scroll） | 26 | `12-transcript-interactive.html` |
| embedded resource · text（内嵌铺开）/ binary（退回文件卡） | 32 | `12-transcript-interactive.html` |
| 「N 条未知会话更新已丢弃」告警 | 34 | `12-transcript-interactive.html` |
| 用户消息**点击聚焦**态；编辑中写明「会截掉后面几轮」 | 11 | `10-transcript-text.html` |
| 分支切换**搜索即创建**（命中为空只剩 Create 行） | 41 | `22-top-panels.html` |
| 上下文浮窗：`Context / Rules` + 有 cost 时多两行 | 30 | `20-composer.html` |

**按钮审计补的（从 `title=` / `aria-label=` / i18n 文案里逐个挖）**：

| 补的控件 | 落在 |
|---|---|
| **输入历史**（空框按 ↑ / ↓ 翻自己发过的消息，「历史 3 / 12」） | `20-composer.html` |
| **模型错误**横幅（写明哪个模型、为什么不可用 + 换一个 + 关闭，发送键转禁用） | `20-composer.html` |
| **流式两种模式** Steer（立即打断）/ Follow-up（排队）+ 各自的后果提示 | `20-composer.html` |
| **收起控件**按钮（与自动塌陷同一个状态） | `20-composer.html` |
| **会话正在加载**（连 agent 与 session/load 期间，不计时不可关） | `12-transcript-interactive.html` |
| **滚动到最新**（离开底部时出现 + 未读数徽章） | `12-transcript-interactive.html` |
| **查找结果被截断**提示（命中超过上限） | `12-transcript-interactive.html` |
| **HTML 预览**（沙箱 iframe）+ 查看器全部分支清单 | `52-file-viewer-modes.html` |

**同时纠正的两处设计错误**：

1. **移动端不该有底部控件条**：原先画的「输入框下面一条 `附件 / @ / /` + 右端更多控件」是凭空的，实现里没有这种东西。
   现在改成**与桌面完全同构**：控件都在输入框那一行里；窄屏放不下的顶栏动作收进一条**覆盖顶栏**的工具条（就是桌面顶栏右侧那一排，7 个一个不少）。
2. **登录页是可选的**：只有设了 `PI_WEB_PASSWORD` 才启用（`proxy.ts` 里没设时 `/login` 直接 302 回 `/`）。
   画板已标注清楚，不是主流程、更不是要去做一套登录体系。

### 第四轮：图标对齐 + 三处长条改掉 + 会话时间线

用户驳回后逐条改的。

**① 图标与文字的垂直对齐（全局 bug）**

`icon + 文字` / `文字 + icon` 的组合里，**文字比图标低约 1.5–2px**。根因是 `<i data-ico>` 里的内联 `<svg>`
在基线上留出行高（strut），图标盒比图标高出一截、图标被顶到盒子上半部。

修法（`assets/board.css` 的「图标与文字的垂直对齐」一节）：`<i data-ico>` 自身 `inline-flex + line-height:0`、
内层 `<svg>` `display:block`、`.pw-ico` 包装层同样 `line-height:0`。
折行的提示条另走一条：`align-items: flex-start` + 图标盒高度撑成首行盒高
（`height: calc(var(--lh-body) * 1em)`），与图标实际尺寸无关。

**新增回归工具 `scripts/check-align.mjs`**：用 Playwright 量测每处「图标 vs 相邻文字」的垂直中心差，
双判据（对齐首行 **或** 对齐整块中心都算通过，避免把「标题 + 副标题」的列表行误报）。
实测：修复前平均偏差 **1.57px**（最大 2.00px）→ 修复后 **0.15px**（最大 0.69px），全量 0 处超差。

**② 输入框上方的「凸出条」删掉**（用户不喜欢长条）。

**③ 用量长条收进上下文圆环**：`01-workbench` 帧 C 里那条
`26,480 tok · 上下文 14% · 本轮 $0.021 … end_turn` 已删除；
改成圆环悬浮展开浮窗（`Context / Rules / 本轮 ↑↓ / 本会话花费 / 结束原因 / 压缩上下文`）。
规范里也写死了：**输入框下面不再有第二条横条**。

**④ 会话时间线弹层（参考项目画板 43）重新设计** —— 此前 `53` 里画的是「一列小色块」，是错的。
真实实现是 `ChatMinimap`：**36px 导轨 + 320px 通高时间线浮层**。
现在按实现重画：导轨节点（6px，间隔上限 50px）、浮层「编号列 34px + 内容列」、
编号下的工具数徽章、`A` 助手首行、当前轮 6% 底 + 左侧 2px 强调条、
顶部「图钉」按钮、浮层内滚动条隐藏、顶部「↑ 加载更早记录」。

### 第五轮（2026-09-28）：重做一遍组件审计 + 词表核对

这一轮**不信任上一轮的结论**，把「组件 → 画板」与「CSS 类名 → 画板」两条路重跑了一遍，并新增一条「**数据字段 → 画板**」的核对。

**方法**：`ls components/*.tsx components/fork/*.tsx`（88 个）逐个 `grep -r design/`；
再 `grep -ohE '^\.[a-z0-9-]+' app/{globals,fork-ui,settings,wallpaper}.css` 拿全部顶层类名，逐个回查 `components/**/*.tsx` 的真实使用点，
**剔除死 CSS**（`.session-history-panel` / `.session-info-popover` / `.chat-stats-center` / `.fork-tipline` 是死代码，不算缺口）。

**补出来的 4 处漏画**（旧版只在分支表里列了名字，没有画板）：

| 漏掉的功能面 | 证据（file:line） | 补在哪 |
|---|---|---|
| **Mermaid 全屏缩放查看器**（`<dialog>` + 布局 + 工具栏 + 步进器 + 百分比 + 适配/关闭） | `components/MermaidBlock.tsx:169`（`mermaid-zoom-dialog`）、`:181-182` | `10-transcript-text.html` C 段 |
| **文件查看器的 diff 覆盖层**（头部一个对比按钮 → 整个内容区换成只读 diff + 顶部横幅 + 「返回源码」） | `components/FileViewer.tsx:2529`（`-diff-toggle`）、`:2738-2747`（`-diff-overlay` / `-diff-banner`） | `52-file-viewer-modes.html` A/B 段 |
| **文件被删除提示**（对比关掉后没有内容可渲染，给一条 `role="status"` 说明而不是空面板） | `components/FileViewer.tsx:2735`（`file-viewer-deleted-notice`） | `52-file-viewer-modes.html` C 段 |
| **文件实时同步指示**（头部 6px 圆点：监听中 success + 4px 光晕 / 未监听 `--n-border`，各配一句 title） | `components/FileViewer.tsx:2483`（`file-viewer-live-indicator`）、`:2481` | `30-files-panel.html` A 段 + G 段（文件头解剖） |

**改掉的 1 处画错**（新增的「数据字段 → 画板」核对抓到的）：

| 画错的地方 | 旧版 | 真值 | 依据 |
|---|---|---|---|
| 回合结束行的 `stopReason` 词表 | `end_turn / max_tokens / max_turn_requests / refusal / cancelled`（**参考项目的 ACP 词表**） | `pending / stop / length / toolUse / error / aborted / deferred` | `node_modules/@earendil-works/pi-ai/dist/types.d.ts:292`；应用里 `end_turn` 等词一次都没出现 |

**根因**：参考项目用 `materials.md` §4 的「**协议投影面 → 画板**」覆盖矩阵挡这一类错误；
我们只做了「组件 → 画板」，而 `stopReason` 是**数据字段**不是组件，于是整条漏出去。
下一轮起，`README` 的对应表要同时按「组件 / CSS 类名 / 数据字段」三条线核对。

**已核过、确认不算缺口**（省得下一轮重复劳动）：
`useChatAppearance`（= 设置里的聊天宽度/字号两行，`40` 已画）、`session-info-popover` / `session-history-panel`（死 CSS）、
`lease`（纯 SSE 保活，无 UI）、`file-watch`（文件树自动刷新，无独立 UI）、`app-update`（`56` 已画）、
`push` 订阅（`40` 的通知开关已覆盖）。

### 第六轮（2026-09-29）：十二轮收尾的 9 处补画

前五轮都是「按组件扫」，这一轮改按**产品里已经存在、但画板没画的那一面**扫——
扫的是 2026-09-29 用户裁定之后产品侧改掉的地方（扩展归位顶栏、输入框下方去横条、断点取整），
以及几个一直有实现却没有画板的组件。共补 9 处，**全部落在已有画板上，不新增编号**：

| # | 补画的是什么 | 产品依据 | 落在 |
|---|---|---|---|
| 1 | 顶栏 MCP / 插件两枚浮窗与两枚触发钮 | `TopBarPopovers.tsx`（`McpStatusButton` / `PluginStatusButton` / `HoverPopover`） | `22` |
| 2 | 侧栏用户自定义分组四态 + 「拖到这里移出分组」落点 | `fork/GroupedProjectList.tsx`、`lib/session-groups.ts` | `02` |
| 3 | 无项目的零会话起步三卡与三卡展开态 | `fork/EmptyStateGuide.tsx` | `01` |
| 4 | 附件预览灯箱（图片整屏壳 / 多类型卡片壳 / 壳约定） | `fork/AttachmentPreview.tsx`、`ImagePreview.tsx` | `50` |
| 5 | 输入历史弹层 + `/` 命令菜单的实现形态 | `ChatInput.tsx` 的 `historyMenuOpen` / `slashMenuOpen` 两段 | `21` |
| 6 | 路径动作簇（复制 / 显示 / 打开，四态） | `fork/PathActions.tsx` | `51` |
| 7 | 皮肤工作室对话框外壳五行 | `ThemeSkinStudio.tsx` | `47` |
| 8 | 选中型空态两态（有目录 / 无目录） | `AppShell.tsx` 的 `showPlaceholder` 分支 | `01` |
| 9 | 画板 54 整帧重画：扩展 widget 进顶栏浮窗、状态条变右上角 mono 胶囊 | `TopBarPopovers.tsx:353`、`ExtensionStatusFloat` | `54` |

同轮还做了三件不是「补画」但同样属于画板侧的事：`board.css` 把 `.pw-quote` 从
`.pw-msg-user` 的后代选择器提成独立件（画板 10 正文的引用块此前拿不到样式）；
`52` 与 `56` 里两个**画板用到但 `board.css` 没有定义**的类（`.pw-diff` / `.pw-up-arrow`）改用已有基元表达；
`DESIGN-SPEC.md` 把八处「尽量少 / 合理样例」改成可量判据（详见该文件 §1.1 §1.2 §1.4 §2.1 §3 §4 §5）。

**本轮没有新增基元**：9 处补画全部复用 `board.css` 已有的 `pw-*` 类。

### 审计后确认已覆盖的

- **壳**：`AppShell` / `SessionSidebar` / `TabBar` / `SettingsPanel` / `SettingsUi` → `01` `02` `40`
- **转录**：`ChatWindow` / `MessageView` / `ProcessGroup` / `MarkdownBody` / `MermaidBlock` / `AsyncCodeHighlighter` / `AnsiText` → `10` `11` `12`
- **输入框**：`ChatInput` / `ComposerContextStrip` / `ComposerReferenceMenu` / `ModelSelector` / `SessionStatsBar` → `20` `21`
- **顶栏弹层**：`SystemPromptPanel` / `ToolDefinitionsPanel` / `AgentSessionPanel` / `BranchNavigator` / `fork/ConversationFindBar` → `22`
- **右栏**：`ExplorerPanel` / `FileExplorer` / `FileViewer` / `FileIcons` / `TerminalPanel` / `BrowserPanel` / `GitGraphTab` / `fork/TabOverview` / `fork/UnsupportedFilePreview` / `MarkdownFilePreview` → `30` `31` `52`
- **设置 13 分节**：`ModelsConfig` / `EnabledModelsSection` / `ProviderUsageSummary` / `ProviderIcon` / `SkillsConfig` / `AgentsConfig` / `PluginsConfig` / `fork/McpConfig` / `fork/CronConfig` / `fork/PiMemoryConfig` / `fork/ShortcutsSettings` / `fork/UsageStatsPanel` / `fork/usage-charts` / `fork/PromptsConfig` / `ArchivedSessionsPanel` / `ProjectArchivePanel` / `ImportPanel` → `40`–`47`
- **皮肤与壁纸**：`ThemeSkinStrip` / `ThemeSkinStudio` / `WallpaperSettings` / `BuiltinWallpaperPicker` / `WallpaperLayer` / `ThemeIcon` / `useBorderDepth` / `useUiDensity` / `useUiFont` / `useRailTranslucent` → `40` `47`
- **对话框与菜单**：`ProjectTrustDialog` / `DirectoryPicker` / `ContextMenu` / `fork/NewSessionHome` / `fork/EmptyStateGuide` / `fork/GroupedProjectList` / `SessionSearch` / `ChatWorkspaceRow` / `SessionRowContextMenuBridge` / `NewTaskPicker` / `DismissButton` / `fork/CopyStateIcon` → `01` `02` `50` `51`
- **无界面**（纯逻辑，不需要画板）：`useAudio` / `useAgentSession` / `useCollapsePresence` / `useDialogA11y` / `useKeyboardShortcuts` / `useMarkdownFile` / `useNotificationPrefs` / `useProjectContext` / `useResizableHeight` / `useResizablePanel` / `useShortcutBindings` / `useTheme` / `useThemeSkins` / `useThrottledText` / `useTwoPhaseEnter` / `useViewportHeight` / `useWallpaper` / `useIsMobile` / `useI18n` / `useDragDrop` / `fork/RollingNumber` / `fork/PhaseRoll` 的动画部分

### 审计中发现的两处「画板有、代码没有」

这两处**不是漏画，是设计提案**，已补记进 `DIVERGENCE.md`：

1. **壳级通知条（toast）**：全仓搜不到任何 toast / notice 实现（也没有 `aria-live` / `role="alert"`）。
   画板 `12` 与 `50` 里的通知条是**新提案**——现在各对象的 `lastError` 只进日志。
2. **会话导出为 HTML**：`app/api/sessions/[id]/export/route.ts` 存在，但菜单里只画了入口，
   现有 UI 是否已接线需要核对（已记进 `DIVERGENCE.md` C 节）。

### 明确「不做」的（不是漏，是有意不做）

- **ACP 流量调试页**（参考项目画板 80）：本项目走 SSE 事件流，没有独立的原始 JSON-RPC 页面。
- **Restore Checkpoint 分隔线**（参考项目画板 10）：本项目用「从此处回退」动作，没有独立分隔线。
- **Edits 审阅条**（Keep All / Reject All）：diff 卡只读，改动由 agent 自己落盘。

---

## 与参考项目的逐条对应

参考项目（`pi参考项目/AcpAgentClient-main/design/round-design/`）有 40 张画板。
下面是**逐条对位表**：左列是参考项目的画板，右列是本项目的落点。
「对位」表示功能重合、直接借形；「本项目改写」表示结构不同、保留能力但换形态；
「无对应」表示本项目没有该功能，或该功能已并入别处。

### 参考项目 P1（token 与壳）

| 参考画板 | 参考内容 | 本项目落点 | 处理 |
|---|---|---|---|
| 00 tokens | 中性色阶/强调/语义/字阶/圆角/间距/控件/图标/动效 | `00-tokens.html` | 对位，另补图标总览与按钮四态 |
| 01 workbench-empty | 新会话 + 尚无 agent 两态 | `01-workbench.html` 帧 A | 对位；本项目无「尚无 agent」态（用「无项目」空态替代） |
| 02 workbench-running | 进行中的一轮 | `01-workbench.html` 帧 B | 本项目改写：工具卡收成**过程时间轴** |
| 03 workbench-done | 回合结束 + 右栏展开 | `01-workbench.html` 帧 C | 对位 |
| 04 sidebar-states | 会话项 / 搜索 / 折叠 / 顶栏悬浮 | `02-sidebar-topbar.html` | 对位，另加「项目 / 聊天」双 pane |
| 05 motion | 转场规格 | `05-motion.html` | **对位并超过**：本项目独立成板，含 17 项可播放动效与轻量交互规格 |
| 06 session-activity | 侧栏会话活动指示（扫掠线 / 未读点） | `02-sidebar-topbar.html` | 对位：运行点 / 未读点 / 等你点 |
| 07 dark-tokens | 深色 Token 对位表 | `07-dark-tokens.html` + `assets/tokens.css` 的 `.dark` 块 | 对位：独立成板 + token 文件 |
| 08 interaction-upgrades | 回合折叠 / 跨工作区在跑数 | `11-transcript-process.html` | 对位：过程时间轴即折叠块 |
| 09 awaiting-you | 等你处理（侧栏 / 工作区切换器） | `02-sidebar-topbar.html` | 对位：`pw-badge.warn`「等你处理」 |
| 10 checkpoint | Restore Checkpoint 分隔线 | — | **无对应**：本项目用「从此处回退」动作，无独立分隔线 |

### 参考项目 P2（转录卡片）

| 参考画板 | 参考内容 | 本项目落点 | 处理 |
|---|---|---|---|
| 11 user-message | 用户消息气泡（@ 芯片 / hover 动作 / 编辑中） | `10-transcript-text.html` | 对位 |
| 12 assistant-text | 助手富文本正文 | `10-transcript-text.html` | 对位 |
| 13 code-block | 代码块卡片 | `10-transcript-text.html` | 对位 |
| 14 gfm-table | GFM 表格 | `10-transcript-text.html` | 对位 |
| 15 mermaid | Mermaid 图（图/源码两态） | `10-transcript-text.html` | 对位 |
| 16 math | 数学公式（行内/块级） | `10-transcript-text.html` | 对位 |
| 17 thinking | 思考折叠块 | `11-transcript-process.html` | 对位 |
| 18 tool-call | 标准工具调用卡 | `11-transcript-process.html` | 本项目改写：时间轴步骤 + 可展开工具卡 |
| 19 tool-failed | 工具调用失败卡 | `11-transcript-process.html` | 本项目改写：时间轴上失败行 + 失败卡 |
| 20 tool-cancelled | 工具已取消卡 | `11-transcript-process.html` | 对位 |
| 21 diff-card | 文件差异对比卡 | `11-transcript-process.html` | 对位；本项目另加**分栏视图** |
| 22 terminal-card | 嵌入式终端控制台卡 | `11-transcript-process.html` | 对位 |
| 23 terminal-running | 终端进行中卡 | `11-transcript-process.html` | 对位 |
| 24 subagent | 子代理委派卡 | `11-transcript-process.html` | 对位 |
| 25 permission | 权限授权卡 | `12-transcript-interactive.html` | 对位（三档 + 范围下拉） |
| 26 awaiting | Awaiting Confirmation | `12-transcript-interactive.html` | 对位：输入框上方停靠条 |
| 27 elicitation-form | 表单模式交互卡 | `50-dialogs.html` | 本项目改写：扩展请求对话框（select/confirm/input/editor） |
| 28 elicitation-url | 链接跳转交互卡 | `50-dialogs.html` | 同上，并入扩展对话框 |
| 29 plan | 计划卡 | `12-transcript-interactive.html` | 对位：Todo 卡 |
| 30 context-window | 上下文窗口浮窗 | `20-composer.html` | 对位：统计条 + 上下文环 |
| 31 turn-state | 回合态与结束（五种 stopReason） | `12-transcript-interactive.html` | 对位 |
| 32 content-blocks | 非文本内容块 | `12-transcript-interactive.html` | 对位 |
| 33 compaction | 上下文压缩卡 | `12-transcript-interactive.html` | 对位 |
| 34 agent-state | agent 状态与错误 | `12-transcript-interactive.html` | 对位 |

### 参考项目 P3（弹层与菜单）

| 参考画板 | 参考内容 | 本项目落点 | 处理 |
|---|---|---|---|
| 40 composer-popovers | 模型 / 思考 / 模式 / 布尔选项 / 用量 | `21-menus.html` | 对位，另加工具档与权限档 |
| 41 topbar-popovers | 项目切换 / 分支 / 新建会话 / 会话菜单 | `22-top-panels.html` | 本项目改写：项目切换在侧栏，顶栏下拉换成系统提示/工具定义/子代理/最近会话 |
| 42 inline-menus | `@` 提及 / `/` 命令 | `21-menus.html` | 对位，`@` 菜单扩成四类（文件/会话/MCP/Todos） |
| 43 session-timeline | 会话时间线弹层 | `22-top-panels.html` | 本项目改写：会话查找条 + 迷你地图 |

### 参考项目 P4（其余页面）

| 参考画板 | 参考内容 | 本项目落点 | 处理 |
|---|---|---|---|
| 50 registry | Agents 面板（ACP Registry） | `43-settings-plugins-mcp.html` | 本项目改写：npm 包插件 + MCP 服务器，无 registry 市场 |
| 51 registry-states | Registry 条目状态 | `43-settings-plugins-mcp.html` | 同上，并入插件/MCP 状态 |
| 52 auth | agent 认证 | `41-settings-models.html` + `56-update-and-auth.html` | 本项目改写：模型供应商订阅登录；agent 认证是提案（56） |
| 53 registry-upgrade | Registry 升级态 | `43-settings-plugins-mcp.html` + `56-update-and-auth.html` | 对位：插件/技能/应用的更新五态 |
| 60 files-panel | 文件面板 | `30-files-panel.html` | 对位 |
| 61 terminal-panel | 终端面板 | `31-terminal-browser-git.html` | 对位 |
| 70 settings | 设置 | `40`–`47` | 本项目改写：设置从 4 块扩成 **13 个分节**，拆成 8 张画板 |
| 80 traffic | ACP 流量调试 | — | **无对应**：本项目走 SSE 事件流，无独立流量调试页（对应能力在 `lib/` 日志） |

### 本项目独有（参考项目没有）

| 能力 | 落点 |
|---|---|
| 聊天工作区 / 项目双 pane | `02-sidebar-topbar.html` |
| 皮肤工作室 / 壁纸 / 主题六档 | `47-skin-studio.html`、`40-settings-general.html` |
| 定时任务（Cron） | `44-settings-cron-memory.html` |
| 记忆（pi-memory） | `44-settings-cron-memory.html` |
| 快捷键表 / 用量统计 | `45-settings-shortcuts-usage.html` |
| 自定义命令 / 归档历史 / 从其它 agent 导入 | `46-settings-prompts-archive-import.html` |
| ~~登录页~~（**已删除**，2026-09-28 用户裁定本产品没有登录） | — |
| 浏览器面板 / Git 图谱 / 标签概览 | `31-terminal-browser-git.html` |
| 迷你地图 / 会话查找条 | `22-top-panels.html` |

**覆盖结论**：参考项目 40 张画板里，**34 张有对位落点**，4 张因结构不同改写（08 / 27+28 / 41 / 43），
2 张无对应（10 checkpoint / 80 traffic，功能在本项目里不存在或已并入别处）。
本项目另有 9 类独有界面，全部落在 `02 / 22 / 31 / 40 / 44 / 45 / 46 / 47 / 50`。

---

## 脚本

两个维护脚本，都是设计稿专用、不进产品构建：

```bash
# 静态校验：图标是否注册 / 是否出现 emoji / 是否引用未定义 CSS 变量 / 标签是否平衡
node design/pi-web-design/scripts/check-boards.mjs

# 对齐回归：量测每处「图标 vs 相邻文字」的垂直中心差（必须 0 处超差）
node design/pi-web-design/scripts/check-align.mjs

# 渲染：用本机 Chrome 逐张出 PNG（fullPage）
node design/pi-web-design/scripts/render-boards.mjs /tmp/pw-boards            # 全部
node design/pi-web-design/scripts/render-boards.mjs /tmp/pw-boards 01-workbench.html
```

`check-boards.mjs` 退出码非 0 表示有错误。允许项写在脚本里：
`CONTENT_OK`（代码样例里出现的产品真实变量名）、`TYPO_OK`（终端输出里合法的印刷符号，如 ✓ ↑ ↓）。

`check-align.mjs` 容差 1px（折行提示条在 1500px 视口下有 1px 亚像素取整抖动）。
它用**双判据**：图标对齐首行 **或** 对齐整块中心都算通过——前者是提示条这类，
后者是「标题 + 副标题」的列表行，避免误报。

渲染脚本依赖仓库里的 Playwright + 本机 Chrome（`channel: "chrome"`）。
本机 macOS 12.7.1 上 Playwright 自带的 chromium 不兼容，必须走系统 Chrome。

## 待补画板

（暂无。发现缺口写在这里，不直接加画板。）

**2026-09-28 一轮补完之后的状态**：本轮的 4 处漏画（Mermaid 全屏缩放 / 文件查看器的 diff 覆盖层 / 文件被删除提示 / 文件实时同步指示）
已分别补进 `10` / `52` / `52` / `30`；词表错误（回合结束行的 stopReason）已改。当前无已知缺口。

## 变更记录

- **2026-09-28 · 第五轮（本文件与 DESIGN-SPEC 的欠账一次还清 + 动效成真）**。用户四条意见，逐条落地：

  1. **本产品没有登录 → 删干净**。`50-dialogs.html` 改名 `50-dialogs.html`（编号不动），整段登录页三态删除；
     `40-settings-general.html` 删掉左导航末位与「常规（续）」里的两处「退出登录」；`index.html` 卡片同步。
     起因：`proxy.ts` 只在设了 `PI_WEB_PASSWORD` 时才启用登录，用户本机使用根本到不了那一页，画板却把它画成主流程的一部分。
  2. **目录选择器改成「系统原生优先」**。`50` 的目录段拆成 C（系统原生选框 + 固定决策链）/ D（自绘浏览器，降级态）；
     `DESIGN-SPEC §4` 同步。事实依据：`lib/pick-directory.ts` 的头注释写明「优先系统原生选择器」，
     `app/api/cwd/pick/route.ts` 在 macOS 走 `osascript choose folder`、Windows 走 `PowerShell FolderBrowserDialog`、
     Linux 走 `zenity / kdialog / yad`，不可用时返回 `501 {fallback:true}`。**旧画板整条主路径都没画**。
  3. **动效成真**。`05-motion.html` 重写：11 个动效 token（新增 `--motion-layout` / `--motion-sweep` / `--motion-stream` / `--motion-sheet`）、
     四类转场 → 五类（多一类「静默布局」）、新增**轻量交互规格**（悬浮 120ms 进出等长 / 按下 0ms / 焦点环 0ms / 展开折叠 160ms / 开关 120ms）、
     新增**十七项动效的可播放清单**（`assets/board.css` 的动效包：rise / step / pending / pop / trigger / expand / stream / shimmer / row /
     notice / saved / drop+ripple / sheet / phase / flash / spin / breathe / sweep / reveal / collapse）、反例与禁区两栏。
     `01 / 11 / 12 / 20 / 40 / 60 / 61` 七张画板各加一段「本页动效」真在播的演示；`00` 的按钮四态改成可交互（真 hover / 真按下 / 真 Tab 焦点）。
     起因：旧版 29 张画板里只有 1 处真动效（侧栏扫掠线），其余全是静态图——「都是假的」。
  4. **补 4 处漏画 + 改 1 处画错**（详见「覆盖审计」第五轮）。其中 stopReason 用错词表是真错误：旧版列的是参考项目那套 ACP 词表
     （`end_turn / max_tokens / max_turn_requests / refusal / cancelled`），pi 的真实取值是
     `pending | stop | length | toolUse | error | aborted | deferred`（`@earendil-works/pi-ai` 的 `StopReason`）。

- **第四轮 · 迷你地图版式返工**：`53` 的浮层不再通高（按内容、上限为转录区高度）、编号改为对齐内容首行（不再整块居中）、
  回答行加左侧 2px 从属竖线且字母 `A` 只出现一次（旧版编号列一个、内容里又一个，屏幕上真印了两个 A）、
  图钉固定态只染图标 + 下边线（不铺底色）、hover 从 3% 提到全系统的 6%、画板注记从浮层里移出。

- **第三轮 · 图标对齐 + 长条改掉 + 会话时间线**：见下文「第四轮：图标对齐」段。

- **第二轮 · 覆盖审计 + 补 5 张画板**（21 → 26）：见下文「覆盖审计」。

- **首版入库**：00–51 共 **21 张画板**全部产出，另有导航首页 `index.html`。
  - 配套三份文档：`DESIGN-SPEC.md`（规范）、`README.md`（本文件）、`DIVERGENCE.md`（偏离）。
  - 资源：`assets/tokens.css`（Token 唯一来源）、`assets/board.css`（画板样式，`pw-` 前缀）、`assets/icons.js`（247 个 lucide 图标）。
  - 品牌：`public/pi-next-logo.png` / `public/pi-next-wordmark.png`（所有者交付的渐变标识，原图直出）+ `brand/README.md` + 出处总览板 `brand/pi-next-brand-board.png`。
  - 全项目**零 emoji**，图标一律 lucide 内联 SVG。
  - 与参考项目 `AcpAgentClient/design/` 的逐条对应见上文「与参考项目的逐条对应」：40 张画板里 34 张有对位落点。
