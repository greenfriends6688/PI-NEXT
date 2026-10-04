# V5 落地执行计划（2026-10-04）

> 契约：`design/v5/LANDING.md`（**唯一通道，先读它**）。本文件只做执行编排：
> 谁改哪些文件、按什么顺序、怎么验收。两者冲突时以 LANDING.md 为准。

---

## 0 · 唯一的坑（不许再踩）

上一轮翻车的根因，用户记成「样本和真实的之间有个 DOM 的区别」，原文是 LANDING §0：

| 症状 | 根因 |
|---|---|
| 类名对上了，视觉还是错的 | **只加类不换 DOM** —— 画板有自己的结构，`class` 相同 ≠ 结构相同；只给现有 DOM 补类是死路 |
| 改一处只对一半 | 同一个视觉/值有两个来源 |
| 想「照着画板的样子做一个差不多的」 | **截图模仿** —— 历史上所有错行 / 竖线断截 / 压瘪都出自这条路 |

**唯一合法动作**：
1. 打开该组件对应的**画板 HTML**，原样复制那段 DOM —— 类名、嵌套层级、`<i data-ico>`、状态类一字不动；
2. 只改两处：静态文案 → 真实数据；`div` → `button`/`input`（**保留原类名**）；
3. 事件全部留在 React 里，CSS 只做 hover/focus；
4. 产品侧 CSS **不重复写画板已有的值**。

画板里的家具（`d-board` / `d-board-head` / `d-scene` / `d-frame` / `d-frame-body` / `d-frame-label` / `d-theme-toggle` / `d-tags`）**不进产品**，只抄家具里面那层组件 DOM。

---

## 1 · 运行形态（web / pwa 怎么共存）

- `design/v5/base.css` + 一套形态（`web/` 或 `pwa/`）**同时只有一个在作用**；
  落地的物理实现是 `app/design/v5-forms.css`（唯一引入点）：四个 `@import` 带媒体条件，
  ≥641px 走 web / ≤640px 走 pwa，由浏览器判定，resize 自动换套。**已完成并验证**
  （产物里 610 条 d-* 全在 `screen and (min-width: 641px)`、343 条 m-* 全在 `screen and (max-width: 640px)`）。
- 落地分两波：**Wave A 先做 Web 形态（`d-*`）**（本文件所有 agent 波的标的）；
  之后 **Wave B**：窄屏渲染 `m-*` DOM（`useIsMobile()` 已有的信号 + 每组件一个 PWA 分支/子组件）。
- 迁移期间旧样式（`design/pi-web-design/*` + `app/*.css`）**继续加载**，因为还没换的组件仍靠它；
  全量落地后由收尾波删除。`d-*` 与 `pw-*` 类名不重叠，`--nx-*` 与 `--n-*`/`--ds-*` 令牌不重叠，
  所以并存期没有冲突。

---

## 2 · 每个组件的四步法（照 LANDING §2）

1. **抄 DOM**：读画板 HTML（路径见对照表），复制目标段落；
2. **接数据与事件**：产品的 state/props/handler/i18n/测试钩子原样接回；状态布尔 → 画板状态类
   （`.is-on` / `.is-open` / `.running` / `.on`）；浮窗沿祖先链查 `overflow`，竖向必须 `visible`；
3. **CSS 纪律**：只做 UA 归零 / cursor / 窄屏语义 / 滚动容器；覆盖画板用 0-2-0 双类并写注释；
4. **验收**：`npx tsc --noEmit`、`npx eslint <改动文件>`、相关 `*.test.mjs` 全绿；
   源码守卫断言结构变了就**断言新的等价约束**（不许删测试、不许 @ts-ignore）。

另外三条硬纪律：
- **只动自己名下的文件**。需要别处配合（共享原语、其他组件）→ `agent_mail` 给父会话，写进汇报，不许跨文件改；
- **不许新造 `d-*`/`m-*` 类**：只能使用 `design/v5/web/system.css` 里已有的类；缺件就报告，不许顺手加进 design/；
- **不许删旧 CSS / 旧组件类**：收尾波统一做 stale 清扫（并行迁移期间删了会误伤没换的组件）。

---

## 3 · 画板 → 组件对照（BOARDS.md + 实际文件）

| 画板 | 落地文件 |
|---|---|
| D-01-workbench | `components/fork/NewSessionHome.tsx` |
| D-02/02b/02c/02d | `AppShell.tsx` `SessionSidebar.tsx` `TopBarPopovers.tsx` `TabBar.tsx` `ContextMenu.tsx` `fork/SessionActionsMenu.tsx` `fork/GroupedProjectList.tsx` `ChatWorkspaceRow.tsx` `fork/TabOverview.tsx` `fork/ProjectChip.tsx` |
| D-03/03b/03c/03d/03e | `MessageView.tsx` `ProcessGroup.tsx` `MarkdownBody.tsx` `MermaidBlock.tsx` `AsyncCodeHighlighter.tsx` `ChatMinimap.tsx` `TurnWrittenFiles.tsx` `TraceFrame.tsx` `fork/AttachmentPreview.tsx` `fork/TodoChip.tsx` `fork/PhaseRoll.tsx` `fork/RetryNotice.tsx` `fork/ConversationFindBar.tsx` `fork/TurnSkillUsageSummary.tsx` `fork/PathActions.tsx` `GitRefChips.tsx` `ChatWindow.tsx` |
| D-04-composer | `ChatInput.tsx` `ModelSelector.tsx` `ComposerReferenceMenu.tsx` `ComposerContextStrip.tsx` `PortalDropdown.tsx` `ThinkingIcon.tsx` `fork/RollingNumber.tsx` |
| D-05-right-panels | `ExplorerPanel.tsx` `TerminalPanel.tsx` `BrowserPanel.tsx` `GitGraphTab.tsx` `FileExplorer.tsx` `AnsiText.tsx` `ElementPicker.tsx` `fork/ScrollFadeViewport.tsx` |
| D-06/06b-file-viewer | `FileViewer.tsx` `CodeFileEditor.tsx` `ImagePreview.tsx` `fork/CsvPreview.tsx` `fork/UnsupportedFilePreview.tsx` `FileIcons.tsx` |
| D-07/07b-settings | `SettingsPanel.tsx` `SettingsUi.tsx` `WallpaperSettings.tsx` `BuiltinWallpaperPicker.tsx` `RetrySettingsBlock.tsx` `ContextBudgetSettingsBlock.tsx` `EnterSendModeSetting.tsx` `SettingsGroupSwitch.tsx` `ThemeSkinStrip.tsx` `ThemeSkinStudio.tsx` |
| D-08/09/10-models | `ModelsConfig.tsx` `ModelLimitsFields.tsx` `EnabledModelsSection.tsx` `ProviderIcon.tsx` |
| D-11/12/13 | `SkillsConfig.tsx` `AgentsConfig.tsx` `PluginsConfig.tsx` |
| D-15/16-mcp | `fork/McpConfig.tsx` `fork/McpCatalog.tsx` `fork/McpPastePanel.tsx` `fork/McpCodemodeSettings.tsx` `fork/McpLogModal.tsx` |
| D-17/19/20/21 | `fork/AutomationPanel.tsx` `fork/AutomationEditor.tsx` `fork/UsageStatsPanel.tsx` `fork/usage-charts.tsx` `fork/PhoneAndPushPanel.tsx` `fork/LanPairPanel.tsx` `fork/QrCanvas.tsx` `fork/ImBridgePanel.tsx` `fork/BotChannelPanel.tsx` `fork/BotChannelsDialog.tsx` `ChannelIcon.tsx` `ProjectArchivePanel.tsx` `ImportPanel.tsx` `fork/ShortcutGuideDialog.tsx` `fork/ShortcutGuideEntry.tsx` `fork/ProviderUsageCards.tsx` |
| D-22/24/25 | `fork/CommandPalette.tsx` `fork/PlanDocumentCard.tsx` `fork/PlanReferenceList.tsx` `ExtensionWidgets.tsx` `fork/EmptyStateGuide.tsx` |
| D-26/26b | `ProjectTrustDialog.tsx` `DirectoryPicker.tsx` `app/error.tsx` `app/global-error.tsx` `DismissButton.tsx` + `hooks/useDragDrop.ts` 宿主 |
| D-27~30 | 动效/焦点类落进已有组件（见 wave 3-M） |
| M-01~M-12 | Wave B：同一批组件加 `m-*` 分支 |

---

## 4 · 分波与文件归属

### Wave 0（编排者，先做）
- `app/layout.tsx` 挂 `design/v5/base.css + web/tokens.css + web/system.css`（**已完成**）；
- 本文件 + 各 agent 的 prompt。

### Wave 1（5 个并行 agent，文件互不重叠）
| Agent | 画板 | 独占文件 |
|---|---|---|
| A1 外壳 | D-01 / D-02 / D-02b / D-02c | `AppShell.tsx` `TabBar.tsx` `TopBarPopovers.tsx` `ContextMenu.tsx` `fork/TabOverview.tsx` |
| A2 侧栏 | D-02 / D-02d | `SessionSidebar.tsx` `fork/SessionActionsMenu.tsx` `fork/GroupedProjectList.tsx` `ChatWorkspaceRow.tsx` `fork/ProjectChip.tsx` `fork/NewSessionHome.tsx` |
| B1 转录壳 | D-03c / D-03e | `ChatWindow.tsx` `fork/ConversationFindBar.tsx` `fork/RetryNotice.tsx` `fork/ExplorationBanner.tsx` `fork/ExplorationPane.tsx` `ChatMinimap.tsx` |
| B2 转录体 | D-03 / 03b / 03d | `MessageView.tsx` `ProcessGroup.tsx` `MarkdownBody.tsx` `MermaidBlock.tsx` `AsyncCodeHighlighter.tsx` `fork/AttachmentPreview.tsx` `fork/TodoChip.tsx` `fork/PhaseRoll.tsx` `TurnWrittenFiles.tsx` `TraceFrame.tsx` |
| C 输入框 | D-04 | `ChatInput.tsx` `ModelSelector.tsx` `ComposerReferenceMenu.tsx` `ComposerContextStrip.tsx` `PortalDropdown.tsx` `ThinkingIcon.tsx` `fork/RollingNumber.tsx` |

### Wave 2（5 个并行 agent）
| Agent | 画板 | 独占文件 |
|---|---|---|
| D 右栏 | D-05 | `ExplorerPanel.tsx` `TerminalPanel.tsx` `BrowserPanel.tsx` `GitGraphTab.tsx` `FileExplorer.tsx` `AnsiText.tsx` `ElementPicker.tsx` `fork/ScrollFadeViewport.tsx` |
| E 查看器 | D-06 / 06b | `FileViewer.tsx` `CodeFileEditor.tsx` `ImagePreview.tsx` `fork/CsvPreview.tsx` `fork/UnsupportedFilePreview.tsx` `FileIcons.tsx` |
| F 设置壳+通用 | D-07 / 07b | `SettingsPanel.tsx` `SettingsUi.tsx` `WallpaperSettings.tsx` `BuiltinWallpaperPicker.tsx` `RetrySettingsBlock.tsx` `ContextBudgetSettingsBlock.tsx` `EnterSendModeSetting.tsx` `SettingsGroupSwitch.tsx` `ThemeSkinStrip.tsx` `ThemeSkinStudio.tsx` |
| G 模型 | D-08/09/10 | `ModelsConfig.tsx` `ModelLimitsFields.tsx` `EnabledModelsSection.tsx` `ProviderIcon.tsx` |
| H 技能/代理/插件 | D-11/12/13 | `SkillsConfig.tsx` `AgentsConfig.tsx` `PluginsConfig.tsx` |

### Wave 3（5 个并行 agent）
| Agent | 画板 | 独占文件 |
|---|---|---|
| I MCP | D-15 / 16 | `fork/McpConfig.tsx` `fork/McpCatalog.tsx` `fork/McpPastePanel.tsx` `fork/McpCodemodeSettings.tsx` `fork/McpLogModal.tsx` |
| J 自动化/用量/手机推送/归档 | D-17/19/20/21 | `fork/AutomationPanel.tsx` `fork/AutomationEditor.tsx` `fork/UsageStatsPanel.tsx` `fork/usage-charts.tsx` `fork/PhoneAndPushPanel.tsx` `fork/LanPairPanel.tsx` `fork/QrCanvas.tsx` `fork/ImBridgePanel.tsx` `fork/BotChannelPanel.tsx` `fork/BotChannelsDialog.tsx` `ChannelIcon.tsx` `ProjectArchivePanel.tsx` `ImportPanel.tsx` `fork/ShortcutGuideDialog.tsx` `fork/ShortcutGuideEntry.tsx` `fork/ProviderUsageCards.tsx` |
| K 命令中心/计划/空态 | D-22/24/25 | `fork/CommandPalette.tsx` `fork/PlanDocumentCard.tsx` `fork/PlanReferenceList.tsx` `ExtensionWidgets.tsx` `fork/EmptyStateGuide.tsx` |
| L 对话框与系统态 | D-26/26b | `ProjectTrustDialog.tsx` `DirectoryPicker.tsx` `app/error.tsx` `app/global-error.tsx` `DismissButton.tsx` |
| M 动效与焦点 | D-27~30 | `ThinkingIcon.tsx` 之外的动效落点由编排者指派（跨组件，按需小改） |

### Wave B（PWA）
- `app/design/v5-forms.css`（编排者）+ 每个组件加 `m-*` 分支（按 M-01~M-12 对照）。

### Wave Z（收尾，编排者）
- 删旧 imports（`design/pi-web-design/assets/*`、`app/pwa-*.css`）与 stale CSS（grep 全仓确认零引用）；
- `npx tsc --noEmit` / `npm run lint` / `npm test` / `npm run design:v5` / `npm run check:design` 全绿；
- `scripts/board-specs/` 补 v5 spec，`node scripts/board-diff.mjs` 对位；
- `design/v5/scripts/shoot.mjs` 出图存证 + 关键页面截图。

---

## 6 · 落地期发现的设计缺口（待设计侧裁定，暂不自行加类）

| 缺口 | 证据 | 产品现状 | 处置 |
|---|---|---|---|
| `design/v5/web/system.css` 第 812 行悬空声明块（`Unexpected }`） | postcss/浏览器解析失败 → 产品 `/` 直接 500（v5 从未进过真实 CSS 管线，所以一直没暴露） | 已按 PWA 对应件 `.m-empty-ico` 把 `color: var(--nx-text-3)` 合并回 `.d-empty-ico`、删掉悬空行 | **已修**（design 侧一行，记进最终报告） |
| `.d-ring.bad`（上下文环 >90% 的 error 档） | system.css 只有 `.d-ring.warn`；v1 明细表写三档 accent/warn/error，v5 画板只画了默认档 | 两档（>70%）都落 `.warn`，不误报为正常色 | 暂缓：设计侧补类（一条 conic-gradient）+ 至少一张画板用它，产品再接 |
| `check-v5.mjs` 不校验 CSS 可解析性 | 上面那条 500 就是它漏掉的（它只做正则） | 手工用 postcss 复算 | 建议设计侧给 `check-v5` 加一条 `postcss.parse` 门禁 |

---

## 5 · 产品纯行为清单（不许在换皮中改变）

换皮只改 DOM/CSS，以下全部保持原样：
- 所有 props / state / handler / effect / API 调用 / SSE 逻辑；
- i18n（`useI18n` 的 `t()`）、`data-*` 测试与主题钩子、`aria-*`、`title`、快捷键；
- 组件导出名与文件路径（其他文件 import 它们的路径）；需要新 props 时给默认值；
- 移动端行为在 Wave B 之前仍按旧逻辑（`useIsMobile`）工作。

---

## 7 · 收尾清单（agent 报告汇总，Wave Z 逐条处理）

### 7.1 旧 CSS 行为规则要改指 v5 类（同优先级 + 在 v5 之后加载 → 旧规则会赢）
- `app/fork-ui.css`
  - `:1786-1787` `.pw-composer-bar .model-selector{flex:0 0 auto}` → `.d-composer-bar .model-selector`（不修则模型芯片可被压缩）。
  - `:2164-2180` 手机媒体查询 `.chat-input-toolbar .pw-select/.pw-iconbtn/.pw-send/.pw-ring` + `::after` 命中区外扩 → 改指 `d-select/d-iconbtn/d-send/d-ring`（不修则手机 hit-slop 丢）。
  - `:2379-2483` `.model-selector .pw-select` 手机工具条尺寸 → 同上。
  - `:1793` `.chat-input-shell.pw-composer{overflow-x:clip;overflow-y:visible}` 已是死规则；`:754` 的 `.chat-input-shell{overflow-x:clip}` 仍生效且与 v5 兼容，保留。
  - `:764` `.chat-input-toolbar > *{min-width:0}`、`:1833` `.composer-ring-details` 网格：兼容，保留（收尾时对一次几何）。
- `app/fork-mac-skeuo.css` `:650-669/1301/1315` `.pw-composer / .pw-composer-top / .pw-composer-bar` 主题覆盖 → 改指 `d-composer*`。
- `app/globals.css`（查看器组）：`.file-viewer-shell[data-expanded]` 底色 `--bg` → v5 令牌；`.file-viewer-actions{order:-1}` 与画板「动作在右」相反 → 删 `order`；`.image-preview-dialog`/`::backdrop` 旧值；`.image-preview-image` 已成死类。
- `app/globals.css` `.terminal-panel` 恒定深色是用户裁定，保留。

### 7.2 旧 board-spec 已选不到元素（选 v5 选择器重指或改跑 v5 板）
- `scripts/board-specs/52-file-viewer-modes.mjs`、`30-files-panel.mjs`（`pw-viewer*`、`pw-ico`、`pw-mono`、`pw-badge`、`pw-btn`、`pw-code-body`、`pw-card-foot`）
- `scripts/board-specs/11-transcript-process.mjs`、`12-transcript-interactive.mjs`（`.pw-proc-head` → `d-card-head`；`.pw-drop` → `d-drop`）
- `scripts/board-specs/61-system-states.mjs`（`.pw-drop` / `.pw-drop .pw-ico` → `d-drop`，无 `.pw-ico` 包装）
- 收尾时给关键 v5 板（D-01/D-02/D-03/D-04/D-05/D-06）写新 spec，`board-diff-all` 的覆盖盘点也认 v5 板。

### 7.3 待处理的产品侧旧令牌/视觉值（agent 已留手）
- `FileExplorer` 粘顶目录行的 `--tree-row` / `--bg-panel`；重命名/上传等非板内子区的 v1 token（含 `FileExplorer.roots.test.mjs` 断言）。
- `GitGraphTab` 自绘泳道几何用 v1 间距 token（泳道是登记例外，保留自绘，只换 token）。
- `DirectoryPicker` / `ProjectTrustDialog` 等由 L 处理。

### 7.4 其余登记
- `ChatWindow` 扩展请求/权限卡：已派 L。
- 各测试的红/绿以 Wave 全部完成后的全量跑为准。
