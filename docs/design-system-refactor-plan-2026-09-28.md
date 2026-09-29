# Pi Web 设计系统落地计划（按 `design/pi-web-design/` 改造现有全部页面）

日期：2026-09-28 基准：`design/pi-web-design/`（**29 张画板 +&#x20;**`DESIGN-SPEC.md`**&#x20;+&#x20;**`DIVERGENCE.md`**&#x20;+&#x20;**`assets/tokens.css`） 对象：本仓库现有全部界面（**86 个组件 / 4 个产品 CSS 文件 / 13 个设置分节 / 4 个路由**） 拆分：**8 个阶段 / 27 个 PR**，每个 PR 一个意图、可独立 revert。 诊断依据：`docs/design-system-comparison-2026-09-28.md`（画板 vs 参考项目 vs 产品功能的三向对比）

---

## 0 · 先看四句话

1. **这不是「换配色」**，是三张尺度的整体收敛：圆角 **5 档 → 3 档**、字号 **8 档 → 5 档**、控件高度 **6 档 → 3 档**，
   再加一条颜色层（BoardUI 的**零色相灰** → 设计的**有色相 10 级中性**）。
2. **动效是全新的一层**：产品里现在有 14 个 `@keyframes` 和 13 处 `prefers-reduced-motion` 兜底，
   但**没有一个走 token**（产品用的是 `--motion-instant/fast/base/slow` = 90/120/150/250ms，
   设计是 `fast/base/transition/layout` = 120/160/200/240ms）。画板 `05-motion.html` 是第一次给出全量清单。
3. **颜色与圆角的改造落脚点只有一个文件**：`app/globals.css` 末尾的 `fork:boardui-bridge`（`:root:root` 块）。
   组件里写的是 `var(--bg)` 这类 Zeno 名，**桥接层一改，全站跟着变**，不需要逐个组件动。
4. **字号改造也只有一个落脚点**：`lib/typography.ts` 的 `TEXT_PX`（8 档 → 5 档）+ `nearestTextStep()` 的归并表。
   48 个组件用的是 `TEXT.*` 常量而不是字面量，所以这一次能改干净——**但聊天正文的字号不归它管**
   （那是用户可调的 `useChatAppearance`，12–24px）。

**改造的纪律**（照抄参考项目，也是 `DIVERGENCE.md` 的用法）：
> 实现与画板不一致的地方**当场**记进 `design/pi-web-design/DIVERGENCE.md`，不要攒；
> 要扩功能边界先改画板，再进实现。

---

## 1 · 现状与目标的差距

### 1.1 颜色层

| 维度 | 现在（BoardUI / Zeno） | 设计（`tokens.css`） | 差在哪 |
|---|---|---|---|
| 中性色阶 | `--color-neutral-100: #f7f7f7` / `200: #ebebeb` …**零色相**（纯灰） | `#fbfbfc / #f4f4f6 / #eeeef1 / #e7e7eb / #e2e2e7 / #d3d3da / #8b8b96 / #62626e / #33333d / #1e1e26`，**统一向强调色偏、饱和度 ≤ .02** | 值全不一样，且有/无色调之差 |
| 强调色 | `--color-accent-500`（BoardUI 蓝，且**可被皮肤工作室改**） | 固定 `#5566d8`（低饱和蓝紫） | 设计要「只有一个强调色、不可改」 |
| 语义色 | `--color-red/green/yellow-600` + `color-mix` 淡底 | `#bc4e39 / #477f40 / #8a6f12 / #5566d8` + 各自 `.soft` | 值不同 |
| 色相总数 | BoardUI 全套 ramp（blue/red/green/yellow/neutral + 代码高亮紫青） | ≤ 5（强调 + 4 语义），代码高亮只借既有槽位 | 设计更严 |
| 深色 | `html.dark` 块 | 一个浅色 token 名对应且只对应一个深色值，**无深色专有 token** | 结构相同，值不同 |

**唯一冲突点（要裁定）**：`47-skin-studio` 允许用户自定义强调色四色，与「单一强调色」直接相悖。
`DIVERGENCE.md` A 节第 1 条已经记着这一条，本计划按**「皮肤工作室保留，但它的取值必须在 token 允许的范围内」**推进
（即：皮肤改的是 `--accent` 这一槽位，不是新增色相）。

### 1.2 尺度层

| 维度 | 现在 | 设计 | 处理 |
|---|---|---|---|
| 圆角 | `--radius-base: 10px` 驱动的 `calc()` 链：xs 4 / sm 6 / md 10 / lg 12 / xl 12 / 2xl 24 / composer 24 | **3 / 4 / 6**（上限 6，pill 只给开关与全圆徽章） | 把 calc 链换成显式三档 + 别名（面板与弹层 = 6） |
| 字号 | `TEXT_PX` 8 档：10 / 11 / 12 / 13 / 14 / 15 / 18 / 24 | **5 档：11 / 12 / 13 / 15 / 20** | 改 `TEXT_PX` + `nearestTextStep()` 归并表 |
| 控件高度 | `--control-xs 22 / sm 26 / md 28 / lg 32 / xl 36 / touch 44` | **24 / 28 / 32**（触控 36） | 6 档 → 3 档 + touch 36 |
| 间距 | 4px 网格（已有） | 4px 网格（4 / 8 / 12 / 16 / 24 / 32） | 一致，只补 `--space-chip` / `--space-kbd` |
| 图标 | 混用 emoji 与手绘 SVG | 一律 lucide，16px（工具栏 14），stroke 1.5，**零 emoji** | 见 PR-04 |
| 字重 | 有 600 | 只用 400 / 500 | 扫一遍 `fontWeight: 600` |

### 1.3 动效层

| 维度 | 现在 | 设计 |
|---|---|---|
| token | `--motion-instant 90 / fast 120 / base 150 / slow 250` + `--ease-out` | `--motion-fast 120 / base 160 / transition 200 / layout 240` + `--motion-sweep 1400` + `--motion-rise/stream/pop/sheet` + `--motion-stagger` + `--opacity-pending` + 唯一曲线 `--ease` |
| keyframes | 14 个，散在 3 个文件里，**无一引用 token** | 17 项，全部登记在 `05-motion.html` 且可播放 |
| 轻量交互 | 各处自己写（120ms / 150ms / 无过渡混用） | 五条统一：悬浮 120ms 进出等长、**按下 0ms**、**焦点环 0ms**、展开折叠 160ms、开关 120ms |
| 减少动态效果 | 13 处兜底，但**行为不一致**（有的变快、有的变短） | 一律**停在终态** |

---

## 2 · 页面 ↔ 画板 ↔ 组件 ↔ CSS 对照表

| # | 产品页面 / 面 | 画板 | 组件（个数） | 主要 CSS |
|---|---|---|---|---|
| 1 | 壳（三栏 + 标签条 + 工作区对调） | `01` `02` | `AppShell` `TabBar` `fork/TabOverview` `ChatWorkspaceRow` (4) | `globals.css` |
| 2 | 侧栏（项目 / 聊天双 pane / 会话树 / 折叠导轨 / worktree） | `02` `51` `61` | `SessionSidebar` `SessionSearch` `SessionRowContextMenuBridge` `NewTaskPicker` `fork/GroupedProjectList` (5) | `globals.css` `fork-ui.css` |
| 3 | 转录 · 文本卡 | `10` | `MessageView` `MarkdownBody` `MermaidBlock` `AsyncCodeHighlighter` `AnsiText` `FrontmatterCard` (6) | `globals.css` |
| 4 | 转录 · 过程卡 | `11` | `ProcessGroup` `ThinkingIcon` `TurnWrittenFiles` `fork/ScrollFadeViewport` (4) | `globals.css` `fork-ui.css` |
| 5 | 转录 · 交互卡 | `12` | `MessageView`(权限/计划/压缩/内容块) `ExtensionStatusBar` (2) | `globals.css` |
| 6 | 转录 · 辅助件与导航 | `53` `54` | `ChatMinimap` `fork/PhaseRoll` `fork/ProjectChip` `fork/TodoChip` `fork/PathActions` `GitRefChips` `fork/ExplorationBanner` `fork/ExplorationPane` `fork/AttachmentPreview` `ExtensionWidgets` `LinkOpenContext` `fork/ConversationFindBar` (12) | `globals.css` `ChatMinimap.module.css` `fork-ui.css` |
| 7 | 输入框与弹层 | `20` `21` | `ChatInput` `ComposerContextStrip` `ComposerReferenceMenu` `ModelSelector` `SessionStatsBar` (5) | `globals.css` |
| 8 | 顶栏下拉 | `22` | `SystemPromptPanel` `ToolDefinitionsPanel` `AgentSessionPanel` `BranchNavigator` (4) | `globals.css` |
| 9 | 右栏 · 文件面板 | `30` `52` | `ExplorerPanel` `FileExplorer` `FileViewer` `FileIcons` `CodeFileEditor` `ImagePreview` `MarkdownFilePreview` `fork/CsvPreview` `fork/UnsupportedFilePreview` (9) | `globals.css` |
| 10 | 右栏 · 终端 / 浏览器 / Git | `31` | `TerminalPanel` `BrowserPanel` `GitGraphTab` (3) | `globals.css` |
| 11 | 设置 · 常规 / 皮肤 | `40` `47` | `SettingsPanel` `SettingsUi` `ThemeSkinStrip` `ThemeSkinStudio` `WallpaperSettings` `BuiltinWallpaperPicker` `WallpaperLayer` `ThemeIcon` (8) | `settings.css` `wallpaper.css` |
| 12 | 设置 · 模型 | `41` | `ModelsConfig` `EnabledModelsSection` `ProviderUsageSummary` `ProviderIcon` (4) | `settings.css` |
| 13 | 设置 · 子代理 / 技能 | `42` | `SkillsConfig` `AgentsConfig` (2) | `settings.css` |
| 14 | 设置 · 插件 / MCP / 更新 | `43` `56` | `PluginsConfig` `fork/McpConfig` (2) | `settings.css` |
| 15 | 设置 · 定时 / 记忆 | `44` | `fork/CronConfig` `fork/PiMemoryConfig` (2) | `settings.css` |
| 16 | 设置 · 快捷键 / 用量 | `45` | `fork/ShortcutsSettings` `fork/UsageStatsPanel` `fork/usage-charts` (3) | `settings.css` |
| 17 | 设置 · 命令 / 归档 / 导入 | `46` | `fork/PromptsConfig` `ArchivedSessionsPanel` `ProjectArchivePanel` `ImportPanel` (4) | `settings.css` |
| 18 | 对话框与菜单 | `50` `51` | `DirectoryPicker` `ProjectTrustDialog` `ContextMenu` `DismissButton` `fork/CopyStateIcon` (5) | `globals.css` `fork-ui.css` |
| 19 | 新会话首屏 | `01` `12` | `fork/NewSessionHome` `fork/EmptyStateGuide` (2) | `globals.css` |
| 20 | 系统状态与移动端 | `60` `61` | `PwaRegistration` + `app/error.tsx` + `app/global-error.tsx` (3) | `globals.css` `settings.css` |

> 合计 86 个组件。**每个 PR 只碰它那一行的组件 + 它那一行的 CSS 段**，不跨行。

---

## 3 · 改造顺序（8 阶段 / 27 PR）

### 阶段 0 · 地基（5 个 PR，必须先做）

> 这一阶段做完，全站的颜色 / 圆角 / 字号 / 控件高度 / 动效就已经是新系统了，**不改任何组件结构**。
> 也正因为如此，它必须**一次做完再逐页精修**——否则每改一个页面都要重来一遍。

| PR | 标题 | 依赖 | 主要文件 | 验收 |
|---|---|---|---|---|
| **PR-01** | **颜色层换血**：`fork:boardui-bridge` 指向设计 token | — | `app/design/tokens.css`(新)、`app/globals.css`（`:root:root` 块）、`app/boardui/theme.css` | ① `node docs/codex-skin/check-contrast.mjs` 8 组 × 2 明暗全过；② `node scripts/verify-themes.mjs` 每个主题选择器恰好 1 次；③ 全站截图与 `design/pi-web-design/preview/` 同框比对无残留旧色 |
| **PR-02** | **尺度收敛**：圆角 3/4/6、控件高度 24/28/32 | PR-01 | `app/globals.css`（radius/control 变量）、`app/boardui/theme.css` | ① `grep -rn "radius-\|control-" app/*.css` 只剩三档 + 别名；② 面板与弹层圆角 = 6（不是 24）；③ 触控目标在 `@media (pointer: coarse)` 下 = 36 |
| **PR-03** | **字阶 8 档 → 5 档** | PR-02 | `lib/typography.ts`（`TEXT_PX` + `nearestTextStep`）、`app/globals.css`（`--text-*`）、`app/boardui/typography.css` | ① `TEXT_PX` 恰好 5 项；② 48 个用 `TEXT.*` 的组件**不改一行**；③ 聊天正文字号仍受 `useChatAppearance` 控制（12–24 可调） |
| **PR-04** | **图标与 emoji 清零** | — | `components/**/*.tsx` | ① `grep -rn "✓\|✗\|→\|←\|↑\|↓\|⚙\|📁" components/*.tsx components/fork/*.tsx` 在**图标位**上为 0（终端输出与文案里的印刷符号不算）；② 新增图标一律内联 lucide SVG，stroke 1.5，16/14 |
| **PR-05** | **动效层**：token 对齐 + 17 项落到产品 | PR-02 | `app/globals.css`（`--motion-*`）、`app/fork-ui.css`、`app/settings.css`、`lib/motion.ts`(新) | ① `--motion-*` 与 `tokens.css` 第 12 节逐值一致；② 14 个既有 keyframes 全部改成引用 token；③ 轻量交互五条统一（**按下 0ms / 焦点环 0ms**）；④ `prefers-reduced-motion` 一律**停在终态**，不是变快变短；⑤ 与 `05-motion.html` 的 17 项逐条对得上 |

### 阶段 1 · 壳（3 个 PR）

| PR | 标题 | 依赖 | 主要文件 | 验收 |
|---|---|---|---|---|
| **PR-06** | 侧栏：会话行五态（运行扫掠 / 未读绿点 / 等你标记）+ 折叠导轨 52 + 双 pane | PR-02 PR-05 | `components/SessionSidebar.tsx`、`components/fork/GroupedProjectList.tsx`、`globals.css` 侧栏段 | 与 `02-sidebar-topbar.html` 同框比对；扫掠线 1400ms linear 且 `prefers-reduced-motion` 下停住；行高 48 / 58 两档 |
| **PR-07** | 顶栏 36 + 标签条 + 工作区对调 | PR-06 | `components/AppShell.tsx`、`components/TabBar.tsx`、`components/fork/TabOverview.tsx` | 顶栏三种上下文（会话态 / 工作区态 / 空态）动作集与 `02` 一致 |
| **PR-08** | 新会话首屏 + 空态引导 | PR-07 | `components/fork/NewSessionHome.tsx`、`components/fork/EmptyStateGuide.tsx` | 三层错开入场（40ms ×3 封顶）；与 `01` 帧 A 一致 |

### 阶段 2 · 转录（4 个 PR）

| PR | 标题 | 依赖 | 主要文件 | 验收 |
|---|---|---|---|---|
| **PR-09** | 文本卡：用户气泡 / 助手正文 / 代码块 / 表格 / 公式 / Mermaid（含**全屏缩放查看器**） | PR-03 | `components/MessageView.tsx`、`MarkdownBody.tsx`、`MermaidBlock.tsx`、`AsyncCodeHighlighter.tsx`、`AnsiText.tsx`、`FrontmatterCard.tsx` | 与 `10-transcript-text.html` 逐卡比对；Mermaid 缩放 50–300%、步进 25%、Esc/遮罩/× 三种关法 |
| **PR-10** | 过程时间轴 + 工具卡四态（完成 / 失败 / 取消 / 展开）+ diff 卡分栏 | PR-05 | `components/ProcessGroup.tsx`、`ThinkingIcon.tsx`、`TurnWrittenFiles.tsx`、`fork/ScrollFadeViewport.tsx` | 步骤逐条入场 4px；展开折叠 160ms 只动高度+透明；失败行就地标红不整卡描红 |
| **PR-11** | 交互卡：权限三档 + 计划卡 + 压缩卡 + 内容块六分支 + **回合结束行（七个 stopReason）** | PR-10 | `components/MessageView.tsx`、`ExtensionStatusBar.tsx` | ① 回合结束行按 `pending/stop/length/toolUse/error/aborted/deferred` 分色；② 权限文案与 `APPROVAL_CHOICES` 逐字一致；③ 内容块六分支齐全 |
| **PR-12** | 转录辅助件：迷你地图（**返工版**）/ 阶段行 / 项目与待办芯片 / 路径动作 / Git ref / 扩展 widget / 附件预览 / 探索分支 | PR-10 | `ChatMinimap.tsx` + `ChatMinimap.module.css`、`fork/PhaseRoll.tsx`、`fork/ProjectChip.tsx`、`fork/TodoChip.tsx`、`fork/PathActions.tsx`、`GitRefChips.tsx`、`ExtensionWidgets.tsx`、`LinkOpenContext.tsx`、`fork/ConversationFindBar.tsx`、`fork/ExplorationBanner.tsx`、`fork/ExplorationPane.tsx`、`fork/AttachmentPreview.tsx` | ① 浮层**高度按内容、上限为转录区高度**（不再是 `top:0;bottom:0`）；② 编号**对齐内容首行**；③ 回答行左侧 2px 从属竖线、**字母 A 只出现一次**；④ 图钉固定态不铺底色；⑤ 行 hover 6% |

### 阶段 3 · 输入框与弹层（2 个 PR）

| PR | 标题 | 依赖 | 主要文件 | 验收 |
|---|---|---|---|---|
| **PR-13** | 输入框：三态 + 附件与引用芯片条 + 统计条与上下文环三态 + 输入历史 + 流式两模式 | PR-05 | `components/ChatInput.tsx`、`ComposerContextStrip.tsx`、`ComposerReferenceMenu.tsx`、`ModelSelector.tsx`、`SessionStatsBar.tsx` | ① **输入框下面没有第二条横条**（用量收进上下文圆环浮窗）；② 上下文环三档配色（正常 / >70% warning / >90% error）；③ 阅读态塌陷 120ms |
| **PR-14** | 弹层：模型 / 思考 / 工具档 / 权限档 / `@` 四类 / `/` 命令 / 顶栏四下拉 | PR-13 | 同上 + `SystemPromptPanel.tsx`、`ToolDefinitionsPanel.tsx`、`AgentSessionPanel.tsx`、`BranchNavigator.tsx` | ① 弹层出现 160ms + 4px，**关闭 0ms 不反向**；② 触发钮选中容器 **0ms 立即**；③ 成组错开 40ms 封顶 3 项；④ 工具定义参数表四列齐全 |

### 阶段 4 · 右栏（2 个 PR）

| PR | 标题 | 依赖 | 主要文件 | 验收 |
|---|---|---|---|---|
| **PR-15** | 文件面板：树 + 查看器全分支（源码 / Markdown / 图片 / CSV / HTML / **与 HEAD 对比覆盖层** / 冲突 / **已删除** / 空态）+ **实时同步点** | PR-02 PR-05 | `components/ExplorerPanel.tsx`、`FileExplorer.tsx`、`FileViewer.tsx`、`FileIcons.tsx`、`CodeFileEditor.tsx`、`ImagePreview.tsx`、`MarkdownFilePreview.tsx`、`fork/CsvPreview.tsx`、`fork/UnsupportedFilePreview.tsx` | ① 文件头 6px 同步点两态（success + 光晕 / border）；② 对比是**覆盖层**不是视图模式，关掉不丢滚动位置；③ 删除文件不给空白面板 |
| **PR-16** | 终端 / 浏览器 / Git 图谱 / 标签概览 | PR-15 | `components/TerminalPanel.tsx`、`BrowserPanel.tsx`、`GitGraphTab.tsx`、`fork/TabOverview.tsx` | 与 `31-terminal-browser-git.html` 同框比对 |

### 阶段 5 · 设置（8 个 PR，13 个分节）

| PR | 标题 | 依赖 | 主要文件 | 验收 |
|---|---|---|---|---|
| **PR-17** | 设置壳 + 常规 + 皮肤工作室与壁纸 | PR-02 PR-03 | `SettingsPanel.tsx`、`SettingsUi.tsx`、`ThemeSkinStrip.tsx`、`ThemeSkinStudio.tsx`、`WallpaperSettings.tsx`、`BuiltinWallpaperPicker.tsx`、`WallpaperLayer.tsx`、`ThemeIcon.tsx`、`settings.css`、`wallpaper.css` | ① 左导航 13 分节、**无「退出登录」**；② 主题只剩 light / dark / auto 三档；③ 皮肤工作室保留但只改 `--accent` 槽位，不新增色相 |
| **PR-18** | 设置 · 模型 | PR-17 | `ModelsConfig.tsx`、`EnabledModelsSection.tsx`、`ProviderUsageSummary.tsx`、`ProviderIcon.tsx` | 三层钻取；订阅登录四态；与 `41` 一致 |
| **PR-19** | 设置 · 子代理 / 技能 | PR-17 | `SkillsConfig.tsx`、`AgentsConfig.tsx` | 与 `42` 一致 |
| **PR-20** | 设置 · 插件 / MCP | PR-17 | `PluginsConfig.tsx`、`fork/McpConfig.tsx` | 与 `43` + `56` 的更新五态一致 |
| **PR-21** | 设置 · 定时任务 / 记忆 | PR-17 | `fork/CronConfig.tsx`、`fork/PiMemoryConfig.tsx` | 与 `44` 一致 |
| **PR-22** | 设置 · 快捷键 / 用量 | PR-17 | `fork/ShortcutsSettings.tsx`、`fork/UsageStatsPanel.tsx`、`fork/usage-charts.tsx` | 与 `45` 一致；图表用 CSS 柱条形态 |
| **PR-23** | 设置 · 命令 / 归档 / 导入 | PR-17 | `fork/PromptsConfig.tsx`、`ArchivedSessionsPanel.tsx`、`ProjectArchivePanel.tsx`、`ImportPanel.tsx` | 与 `46` 一致 |
| **PR-24** | 设置 · 移动端分节选择器 | PR-17 | `SettingsPanel.tsx`、`settings.css` | ≤ 640 时左列 200px 换成下拉 |

### 阶段 6 · 对话框、系统态、移动端（3 个 PR）

| PR | 标题 | 依赖 | 主要文件 | 验收 |
|---|---|---|---|---|
| **PR-25** | **删登录** + 对话框与菜单（信任 / 目录选择 / 扩展请求四种 / 确认 / 通知条 / 右键菜单） | PR-01 | `app/login/`(删)、`app/api/web-auth/route.ts`(删)、`proxy.ts`、`components/SettingsPanel.tsx`、`DirectoryPicker.tsx`、`ProjectTrustDialog.tsx`、`ContextMenu.tsx`、`DismissButton.tsx`、`fork/CopyStateIcon.tsx` | ① `/login` 路由不存在、`proxy.ts` 无密码分支、设置里无退出登录；② **目录选择的主路径是系统原生选框**（`/api/cwd/pick`），用户取消不弹二次确认；③ 通知条三色、最多 3 条、6 秒自收 |
| **PR-26** | 系统状态：错误页 / 拖放落区 / worktree 切换器 | PR-25 | `app/error.tsx`、`app/global-error.tsx`、`hooks/useDragDrop.ts`、`components/SessionSidebar.tsx`(worktree 段) | ① 根布局级错误页只能用系统色（Canvas/CanvasText）；② 拖放四规则；③ 脏 worktree 移除返回 409 后二次确认 |
| **PR-27** | 移动端与 PWA | PR-06 PR-13 | `hooks/useIsMobile.ts`、`AppShell.tsx`、`PwaRegistration.tsx`、`app/manifest.ts`、`globals.css`、`settings.css` | ① **与桌面完全同构**：无底部控件条、无底部弹层；② 顶栏 48、图标 36、滚动条 6；③ 抽屉上滑 14px；④ standalone 安全区 |

### 阶段 7 · 收口（1 个 PR，可与任何阶段并行）

| PR | 标题 | 依赖 | 主要文件 | 验收 |
|---|---|---|---|---|
| **PR-28** | 门禁三件套 + 偏差登记回填 | 全部 | `scripts/check-style-literals.mjs`(新)、`scripts/check-motion-tokens.mjs`(新)、`package.json`、`.github/workflows/ci.yml`、`design/pi-web-design/DIVERGENCE.md` | ① 组件里写 `#rrggbb` / `rgb(` / `fontSize: \d+` / `borderRadius: \d+` → 脚本退出码非 0（白名单：`app/boardui/**`、`fork/usage-charts.tsx`）；② 动效时长只允许来自 token；③ `DIVERGENCE.md` 的 A/B/C 三节每条都有结论 |

> **批次建议**：`PR-01…PR-05` 一批合并（都是地基，互不冲突）；`PR-06…PR-08` 一批（壳）；
> 转录四张一批；设置八张一批。**每批合并后立刻重跑对比度门禁并重渲画板 PNG**。

---

## 4 · 每个 PR 的通用验收（照抄，不必每次重写）

```bash
node_modules/.bin/tsc --noEmit          # 全量约 10 分钟，必须后台跑
node_modules/.bin/eslint . --ignore-pattern 'release/**'
npm test                                # 2129 个用例
node docs/codex-skin/check-contrast.mjs # 对比度门禁（需服务在 30141 运行）
node scripts/audit-tokens.mjs
node scripts/verify-themes.mjs
node design/pi-web-design/scripts/check-boards.mjs
node design/pi-web-design/scripts/check-align.mjs   # 必须 0 处超差
```

外加两条**人工**判据（脚本判不了）：

1. **与画板同框比对**：把该 PR 涉及的那张画板的 PNG（`design/pi-web-design/preview/NN-*.png`）
   与产品实拍截图并排看，逐项确认「位置 / 层级 / 文案 / 状态」四样。
2. **偏差当场登记**：实现与画板不一致的，当场写进 `design/pi-web-design/DIVERGENCE.md`，
   格式 `编号 · 画板画的是什么 → 实现是什么（为什么）·（PR, 日期）`。

---

## 5 · 门禁与回滚

| 关卡 | 规则 |
|---|---|
| **阻塞级 finding 清零才合并** | 用 `docs/reviews/TEMPLATE.md` 的判据清单跑一次只读审查 |
| **同一验收项整改 2 次仍不过** | 停下呼人，**禁止放宽验收标准自我通过** |
| **低危项** | 写明理由记 `docs/BACKLOG.md` 后放行 |
| **回滚单位** | 一个 PR 一个 revert。阶段 0 的五个 PR **必须能独立 revert**（不互相依赖代码，只依赖语义） |
| **阶段 0 的额外门禁** | 五个 PR 全并之后，**先跑一轮全站截图**（22 个页面态）存档为「新基线」，再进阶段 1 |

---

## 6 · 与上游合并的关系（这一条最容易被忽略）

本仓库是**长期跟踪上游 pi-web 的皮肤分支**，合并流程写在 `docs/codex-skin/delta.md`。这套改造会**加重**每次合并的重打量：

| 改造 | 对上游合并的影响 | 缓解 |
|---|---|---|
| 颜色层换血（PR-01） | 上游改动**颜色**的地方全部要重打（但颜色本来就集中在 `globals.css` 与组件里的 `var(--*)`，可控） | 桥接层集中一处；组件不改 |
| 圆角 / 控件高度（PR-02） | 上游常引入硬编码数字圆角（`borderRadius: 10`），每次合并要扫一遍 | PR-28 的字面量门禁会当场拦住 |
| 字号（PR-03） | **上游大量使用字面量 `fontSize`**；`TEXT_PX` 收敛后上游新增的字面量会「跑出梯度」 | `nearestTextStep()` 已经在做归并；PR-28 的门禁覆盖 `fontSize: \d+` |
| 动效（PR-05） | 上游新增 keyframes 大概率不引用 token | 门禁 `check-motion-tokens.mjs` |
| **`delta.md` 必须更新** | 每次改造落地后把「皮肤改动点」一节补上，否则下一次合并没有台账可依 | 每个 PR 的收尾动作 |

**结论**：这套改造**值得做，但必须在 PR-28 的门禁落地之后才长期可控**。
建议 `PR-28` 与 `PR-01` 同期做（脚本先有、改造后跑），而不是放到最后。

---

## 7 · 明确不做的（不是漏，是裁定）

| 不做 | 为什么 |
|---|---|
| **ACP 流量调试页**（参考项目画板 80） | 本项目走 SSE 事件流，没有独立 JSON-RPC 页面；排障走服务器日志 |
| **Restore Checkpoint 分隔线**（参考项目画板 10） | 参考项目自己 2026-09-17 废弃了；本项目用「从此处回退」动作 |
| **Edits 审阅条**（Keep All / Reject All） | diff 卡只读，改动由 agent 自己落盘 |
| **登录 / 会话令牌 / 退出登录** | 用户裁定：本产品没有登录 |
| **底部控件条 / 底部弹层**（移动端） | 用户裁定：移动端与桌面完全同构 |
| **换栈（Flutter + Rust）** | 收益远小于成本；参考项目那套架构优势在 Node 里有等价物 |
| **整页转场 / 滚动视差 / 骨架屏常驻** | `05-motion.html` 的禁区 |
| **新增色相** | 全套 ≤ 5 个色相（强调 + 4 语义）；代码高亮只借既有槽位 |

---

## 8 · 依赖、风险与工作量

### 依赖图

```
PR-01 颜色 ──┬─► PR-02 尺度 ──┬─► PR-03 字号 ──┐
             │                └─► PR-05 动效 ──┼─► 阶段 1 壳（06-08）
PR-04 图标 ──┘                                ├─► 阶段 2 转录（09-12）
                                              ├─► 阶段 3 输入框（13-14）
                                              ├─► 阶段 4 右栏（15-16）
                                              ├─► 阶段 5 设置（17-24）
                                              ├─► 阶段 6 对话框/系统/移动（25-27）
                                              └─► PR-28 门禁（建议提前到 PR-01 同期）
```

### 风险

| 风险 | 级别 | 缓解 |
|---|---|---|
| **对比度倒退**：设计的中性色阶比 BoardUI 更浅/更深，`--text-muted` 那类可能跌破 AA | **高** | `check-contrast.mjs` 是硬门禁；`globals.css` 桥接层已经有过「各加深一档」的先例 |
| **圆角 24 → 6 观感突变**：面板、弹窗、输入框外壳全部收紧 | 中 | 这是设计的有意提案（`DIVERGENCE.md` A-1）；先出一张前后对比截图给所有者确认 |
| **皮肤工作室与「单一强调色」相冲** | 中 | 按「皮肤只改 `--accent` 槽位」推进；若所有者要求保留自由改色，把该条从 `DIVERGENCE` A 节挪到 B 节 |
| **字号收敛导致局部拥挤**（10 → 11、14 → 13） | 中 | 聊天正文不归字阶管（用户可调）；收敛后用 `check-align.mjs` + 截图逐页看 |
| **上游合并重打量上升** | 中 | PR-28 的门禁提前做 |
| **`tsc --noEmit` 全量 10 分钟** | 低 | 后台跑，别在前台等 |

### 工作量估算

| 阶段 | PR 数 | 估时 |
|---|---|---|
| 阶段 0 · 地基 | 5 | **2.5 天**（颜色 1 天 + 尺度 0.5 + 字号 0.5 + 图标 0.25 + 动效 0.25） |
| 阶段 1 · 壳 | 3 | 1 天 |
| 阶段 2 · 转录 | 4 | 2 天 |
| 阶段 3 · 输入框与弹层 | 2 | 1 天 |
| 阶段 4 · 右栏 | 2 | 1 天 |
| 阶段 5 · 设置 | 8 | 2 天 |
| 阶段 6 · 对话框 / 系统 / 移动 | 3 | 1 天 |
| 阶段 7 · 门禁与收口 | 1 | 0.5 天 |
| **合计** | **28** | **约 11 天**（不含审查与返工） |

---

## 9 · 现在就可以开工的第一步

```bash
# 1) 把设计 token 落成产品文件（PR-01 的第一步）
cp design/pi-web-design/assets/tokens.css app/design/tokens.css

# 2) 看桥接层现在长什么样（PR-01 要改的就是这一块）
sed -n '3045,3124p' app/globals.css

# 3) 先跑一次对比度门禁拿到「改造前基线」
lsof -nP -iTCP:30141 -sTCP:LISTEN || npm run prod
node docs/codex-skin/check-contrast.mjs
```

**做完 PR-01 之后立刻重跑第 3 步**，两份输出并排看——这是这一整套改造里唯一一个**不能靠肉眼判断**的环节。

---

## 10 · 落地状态（2026-09-28 第六轮实测）

按画板逐条验收后的结果。**门禁四项全绿**：样式字面量 0 违规、动效 token 0 违规、
30 张画板 0 错误、对齐 0 处偏差；`tsc --noEmit` 通过；全量测试 2233 例、2228 通过，
剩余 5 例失败全是沙箱环境限制（4 例 symlink、1 例 `~/.pi/agent/auth.json.lock` 残留），
单独运行均通过，**与改造无关**。

| PR | 状态 | 说明 |
|---|---|---|
| 01 颜色层 | ✅ | `app/design/tokens.css` 与画板逐值一致（99 项；别名引用差异除外） |
| 02 尺度收敛 | ✅ | 圆角 3/4/6、控件 24/28/32+touch36 |
| 03 字阶 | ✅ | `lib/typography.ts` 五档；字体栈本轮换成 Geist / Geist Mono |
| 04 图标清零 | ✅ | 本轮补掉 8 处印刷符号（`✓ ⚠ ↑`）→ 内联 lucide |
| 05 动效层 | ✅ | 本轮把 `--motion-rise/stream/stagger/sheet/transition` 全部落到产品 |
| 06 侧栏 | ✅ | 会话行五态 + 扫掠线已在；本轮尺寸改默认 280 / 可拖 220–480 |
| 07 顶栏 / 标签条 | ✅ | 顶栏 46 → 桌面 36 / ≤1024 48；7 个动作齐全 |
| 08 空态首屏 | ✅ | 本轮照画板 01 重做 + 三层错开入场 |
| 09 文本卡 | ✅ | Mermaid 全屏缩放已具备 |
| 10 过程卡 | ✅ | 步骤入场接 `--motion-stream` |
| 11 交互卡 | ✅ | **本轮新增回合结束行**（七个 stopReason 分色 + 耗时 + 用量 + 解释） |
| 12 转录辅助件 | ✅ | 迷你地图浮层/编号对齐/字母 A 唯一；本轮导轨改 6px 圆点、hover 6% |
| 13 输入框 | ⚠️ | 上下文环三档已对；「不要第二条横条」按 §2.1 保留常显，待裁定（DIVERGENCE 31） |
| 14 弹层 | ✅ | 出现 160ms + 4px、关闭 0ms |
| 15 文件面板 | ✅ | 同步点 7 → 6px；diff 覆盖层已具备 |
| 16 终端/浏览器/Git | ✅ | 与画板 31 一致 |
| 17 设置壳 | ✅ | 13 分节、无退出登录、主题三档、皮肤只改 `--accent` |
| 18–24 设置各节 | ✅ | 文件在位；移动端分节选择器已有 |
| 25 对话框与菜单 | ✅ | 删登录已完成；**本轮补「导出为 HTML」菜单项** |
| 26 系统状态 | ✅ | 根级错误页只用系统色 |
| 27 移动端 / PWA | ✅ | 本轮顶栏 48、图标 36、滚动条 8/6、抽屉 `--motion-sheet` |
| 28 门禁 | ✅ | 两条脚本 + `check:design` 串联 |

**仍待 Owner 裁定**：DIVERGENCE 第 31 条（输入框下方的常显统计条 vs 画板 20 的「收进圆环浮窗」）。
**已登记的形态偏差**：DIVERGENCE 第 29 条（工具定义参数表两列 vs 四列，信息等价；
迷你地图「标题节点 muted」缺数据支撑）。
