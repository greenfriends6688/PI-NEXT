# 新皮肤落地差距审计（2026-09-29 · 第十二轮）

> 基准：`design/pi-web-design/`（30 张画板 + `DESIGN-SPEC.md` + `assets/tokens.css` + `assets/board.css` + `assets/icons.js`）。  
> 目的：回答「现在所有页面/功能离这套新皮肤还有多远、还差哪些组件 / 画板 / 规范」。  
> 方法：8 个只读子代理按功能域并行审计 + 主线程用脚本做集合差与计数复核；每条结论带 `file:line`。  
> 关系：接在 `design/pi-web-design/DIVERGENCE.md`（第 51 条）之后；与 `docs/design-skin-swap-plan-2026-09-29.md` 的 SW 批次编号对齐。  
> **注意**：那份换肤计划的矩阵写于同日早些时候，其中若干行已被后续批次作废，本文件是它的现状快照，作废项见 §6。

---

## 0 · 一句话结论

**颜色与 token 层已经统一（三个门禁 0 违规），没统一的是「结构」——还有 74 个画板组件类产品完全没用，  
30 个可见界面组件仍是自有类或内联自绘，画板侧另有 10 个产品自造的 `pw-*` 类和 8 条没有验收判据的规范条目。**

四个数字：

| 指标         | 实测                                               | 口径                                                                                            |
| ---------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| 画板组件类落地率   | **112 / 186 = 60%**                              | `board.css` 定义的 237 个 `pw-*` 去掉演示台与画板页头脚手架后 186 个；产品 `app/ components/ hooks/ lib/` 引用到 112 个 |
| 按画板计的覆盖率   | 818 / 941 = 87%                                  | 同一组件出现在多张画板会重复计；重复项主要是 `pw-md` `pw-perm` `pw-minimap-*` `pw-assistant`                        |
| 组件文件挂板面类比例 | 34 / 85 = 40%                                    | `components/**/*.tsx`（>2KB）；另 71 个文件仍含内联 `style={{}}`，共 **1595 处**                            |
| 规范硬约束越界    | 圆角 5 处、字阶 20 处、字重 119 处、手绘内联 `<svg>` 171 处/42 文件 | §1.3 / §1.5 / §1.6                                                                            |

已跑通的门禁（**不要重复报为缺口**）：

```
node scripts/check-style-literals.mjs            → 182 文件 0 违规（无裸 hex / px）
node scripts/check-motion-tokens.mjs             → 4 个 CSS 0 违规
node design/pi-web-design/scripts/check-boards.mjs → 30 画板 0 错误
```

---

## 1 · 量化总览

### 1.1 画板组件类：接了 / 没接

`board.css` 定义 237 个 `pw-*`；扣掉演示台（`pw-anim-*` 26 个）、画板页头（`pw-head/pw-tag/pw-tags`）、  
手机壳与栅格脚手架（`pw-frame*` `pw-stage*` `pw-grid*` `pw-phone*` `pw-mobile-*` 等）后剩 **186 个真实组件类**：

- **已接 112 个**
- **未接 74 个**，按画板分布：

| 画板                                              | 已接/总            | 未接的类（节选）                                                                                |
| ----------------------------------------------- | --------------- | --------------------------------------------------------------------------------------- |
| 01-workbench                                    | 68/87           | `pw-perm*` `pw-md` `pw-diff-*` `pw-chips` `pw-tree` `pw-viewer*` `pw-tok-*`             |
| 10-transcript-text                              | 17/24           | `pw-md` `pw-quote` `pw-math` `pw-tasklist` `pw-msg-acts` `pw-tok-*`                     |
| 11-transcript-process                           | 22/31           | `pw-card-body` `pw-diff-*` `pw-sub*` `pw-think` `pw-stat`                               |
| 12-transcript-interactive                       | 28/42           | `pw-perm*` `pw-plan*` `pw-img` `pw-filecard` `pw-fname` `pw-meta` `pw-audio` `pw-md`    |
| 30-files-panel                                  | 59/70           | `pw-tree` `pw-viewer` `pw-viewer-body` `pw-tok-*` `pw-meta`                             |
| 31-terminal-browser-git                         | 24/29           | `pw-browser*` `pw-url` `pw-commit`（`pw-git` 已登记 ⊘）                                      |
| 45-settings-shortcuts-usage                     | 24/27           | `pw-stat` `pw-legend` `pw-bars`                                                         |
| 53-turn-and-nav                                 | 29/37           | `pw-minimap-rail` `pw-minimap-pop` `pw-card-body` `pw-chips`                            |
| 54-extension-links-exploration                  | 45/53           | `pw-md` `pw-filecard` `pw-fname` `pw-meta`                                              |
| 60-mobile-pwa                                   | 37/50           | `pw-mobile-top` `pw-mobile-actions` `pw-touch` `pw-drawer` `pw-scrim-layer` `pw-banner` |
| 00 / 05 / 07 / 21 / 22 / 40 / 50 / 51 / 56 / 61 | 全接或仅差 1–3 个脚手架类 | —                                                                                       |

### 1.2 内联样式分布（最大的未清理面）

| 文件                              | 内联 `style={{}}` | 说明                                                             |
| ------------------------------- | --------------- | -------------------------------------------------------------- |
| `components/ChatInput.tsx`      | 123             | 盒 ≈67 / 排版 ≈45 / 定位 ≈20（重叠计）；其中约 22 处是运行时计算必须留（圆环百分比、三态色、队列高亮） |
| `components/MessageView.tsx`    | 107             | 卡片已用 `pw-*`，未用画板件的是消息操作行、provider 错误框、超长折叠、diff、内容块            |
| `components/AppShell.tsx`       | 67              | 尺寸类 40 处：6 个顶栏图标钮重复内联 `width/height`、顶栏标题未挂 `pw-tb-title`      |
| `components/ChatWindow.tsx`     | 75              | 骨架屏、引用气泡、扩展对话框体与按钮                                             |
| `components/FileViewer.tsx`     | 32              | 头行已用 `pw-viewer-head`，容器仍是 `file-viewer-shell`                 |
| `components/SessionSidebar.tsx` | 69              | 分支行重复画板值（`paddingLeft:26;height:26`）                           |

---

## 2 · 按域明细

三档口径：**已用**=挂 `pw-*` 且 DOM 照画板；**半迁移**=挂了部分 `pw-*`，仍有自有类/内联承载视觉；  
**未迁移**=零 `pw-*`。

### 2.1 壳与侧栏（画板 01 / 02 / 47 / 53）

| 组件                                                                                                                         | 档   | 缺口                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SessionSidebar.tsx` 壳                                                                                                     | 已用  | 六区段齐全（`pw-side-head/nav/seg/search/scroll` + AppShell 提供的 `foot`）；**`.pw-side-search` 只在搜索态渲染**，画板画的是常显（`SessionSidebar.tsx:1668` 与 DIVERGENCE 38 的措辞冲突）                                                                      |
| 会话行 / 项目行 / 分支行                                                                                                            | 已用  | 分支行把画板值写成内联（`SessionSidebar.tsx:1830-1832`）                                                                                                                                                                                   |
| `AppShell.tsx`                                                                                                             | 半迁移 | 顶栏标题未挂 `pw-tb-title`（`:2216`）；6 个图标钮重复内联尺寸（`:1983/2036/2069/2106/2137/2159`）；空会话占位未用 `pw-empty`（`:2940-2951`）；移动端工具条自绘（`:2651-2720`）；信任条自绘（`:1899-1933`，**已存在**，不是缺口）；**折叠导轨仍走 `fork-collapsed-rail` + 手绘 SVG，未用 `.pw-rail`** |
| `ChatWorkspaceRow.tsx`                                                                                                     | 半迁移 | 内层触发钮 8 项内联复位样式（`:57-58`）                                                                                                                                                                                                     |
| `fork/GroupedProjectList.tsx`                                                                                              | 未迁移 | 用户分组头全内联（`:397-470`）未用 `pw-group-title`；「回到未分组」拖放落区自绘，画板无此件                                                                                                                                                                   |
| `fork/EmptyStateGuide.tsx`                                                                                                 | 未迁移 | 零会话起步三卡全内联（`CARD_STYLE:54`），**画板也没有对应件**                                                                                                                                                                                      |
| `SessionSearch.tsx` / `ThemeSkinStrip.tsx` / `fork/NewSessionHome.tsx` / `fork/ProjectChip.tsx` / `ProjectTrustDialog.tsx` | 已用  | —                                                                                                                                                                                                                             |
| `lib/panel-layout.ts`                                                                                                      | 已对齐 | 280 / 220–480 与 §2.2 一致                                                                                                                                                                                                       |

`.fork-session-*` 已全仓删除（DIVERGENCE 39 已落地），不要再报。

### 2.2 转录（画板 10 / 11 / 12 / 22 / 54）

| 组件                                                                                                                                                                                                | 档   | 缺口                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ProcessGroup.tsx`                                                                                                                                                                                | 已用  | 只剩 `StepIcon` 13 只手绘 `<svg>`（`:128-153`）未换 `data-ico`                                                                                                                                        |
| `SystemPromptPanel.tsx`                                                                                                                                                                           | 已用  | —                                                                                                                                                                                            |
| `MessageView.tsx`                                                                                                                                                                                 | 半迁移 | 未用画板件：消息操作行（`fork-msg-actions:576/1016` → `pw-msg-acts`）、provider 错误框（`:920-946`）、超长消息折叠（`:134-168`）、diff（自绘 SplitFilesView，未用 `pw-diff-*`）、内容块六分支（`pw-img` / `pw-filecard` / `pw-audio` 未用） |
| `MarkdownBody.tsx`                                                                                                                                                                                | 半迁移 | 表格已用 `pw-table`；**代码块仍走 `markdown-code-*`，未用 `pw-code/pw-code-head/pw-code-body`**；正文未用 `pw-md`                                                                                              |
| `MermaidBlock.tsx`                                                                                                                                                                                | 未迁移 | 源码态用 `markdown-code-*`；缩放器 `mermaid-zoom-*` 自绘 + 4 只手绘 svg；全屏缩放查看器未做（DIVERGENCE 22 补画项，实现仍缺）                                                                                                 |
| `ChatMinimap.tsx` + `.module.css`                                                                                                                                                                 | 未迁移 | 导轨与 320px 浮层都在，但用模块类 + `fork-minimap-popover`，**未用 `pw-minimap-rail` / `pw-minimap-pop`**；标题节点 muted 区分仍缺（节点数据无 `kind` 字段）                                                                   |
| `fork/TodoChip.tsx`                                                                                                                                                                               | 半迁移 | 条目已用 `pw-todo`；chip 本体与面板自绘（`:71-119`），未用 `pw-plan`                                                                                                                                          |
| `fork/PhaseRoll.tsx` / `AgentSessionPanel.tsx` / `fork/ConversationFindBar.tsx` / `ExtensionWidgets.tsx` / `fork/ExplorationBanner.tsx` / `fork/ExplorationPane.tsx` / `ProviderUsageSummary.tsx` | 未迁移 | 全部零 `pw-*`；`ExplorationBanner.tsx:115` 还有一个渲染态符号 `⑂`                                                                                                                                         |
| `ToolDefinitionsPanel.tsx`                                                                                                                                                                        | 半迁移 | **参数表已恢复画板 22 的四列**（`:247-262`），但 `:168` 的注释仍写「维持两列」，是 stale 注释；余 26 处内联尺寸                                                                                                                   |

### 2.3 输入框与弹层（画板 20 / 21 / 50 / 51 / 60）

| 组件                                                                  | 档   | 缺口                                                                                                                                |
| ------------------------------------------------------------------- | --- | --------------------------------------------------------------------------------------------------------------------------------- |
| `ChatInput.tsx` 壳                                                   | 已用  | —                                                                                                                                 |
| `ChatInput.tsx` 浮层与芯片                                               | 半迁移 | 附件芯片自绘（`:3325-3398`）未用 `pw-chip`；5 条通知条自绘（`:3148/3249/3263/3278/3713`）未用 `pw-alert`；输入历史菜单头/行自绘（`:3429/3469`）；收藏浮窗行自绘（`:939/950`） |
| `ModelSelector.tsx`                                                 | 未迁移 | 弹层 `className="anim-popover"`（`:269`），搜索头（`:280-300`）、分组标题、`ModelOptionButton`（`:377`）全自绘                                         |
| `ComposerReferenceMenu.tsx`                                         | 半迁移 | 壳/行/空态已用 `pw-pop/pw-prow`，**缺 `pw-pop-search` 搜索头**（画板 21:158/161 强制）                                                             |
| `ComposerContextStrip.tsx`                                          | 未迁移 | 引用芯片整段自绘（`:66-200`）                                                                                                               |
| `ContextMenu.tsx` / `TopBarPopovers.tsx` / `ProjectTrustDialog.tsx` | 已用  | 信任框缺画板 50:280 的「记住这个选择」开关                                                                                                         |
| `NewTaskPicker.tsx` / `DirectoryPicker.tsx`                         | 半迁移 | 前者缺 `pw-pop-search`、触发 chevron 自绘（`:96-112`）；后者只挂 `pw-modal` 壳（`:263`），头/体/脚全内联                                                   |
| `fork/PathActions.tsx` / `fork/AttachmentPreview.tsx`               | 未迁移 | 全内联                                                                                                                               |
| 目录选择主路径（`lib/pick-directory.ts` + `app/api/cwd/pick/route.ts`）      | 已一致 | 原生优先，产品无自家 UI，符合画板 50-C（DIVERGENCE 19 实现已落地）                                                                                      |

### 2.4 右栏（画板 30 / 31 / 52）

| 组件                                                                                                                                                                                | 档         | 缺口                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AppShell.tsx` 面板壳 / `ExplorerPanel.tsx` 头行 / `TabBar.tsx` 容器                                                                                                                     | 已用        | 容器与头行已接 `pw-panel*`；ExplorerPanel 6 个动作钮仍是手绘 SVG（`:180/213/232/246/258/300`）                                                                                     |
| `FileViewer.tsx`                                                                                                                                                                  | 半迁移       | 头行、模式切换、diff 横幅、删除提示均已用画板件；**实时同步点用自有 `file-viewer-live-indicator` + 内联（`:2469-2477`），未用 `.pw-live`**；容器仍是 `file-viewer-shell`，未用 `pw-viewer` / `pw-viewer-body` |
| `FileExplorer.tsx`                                                                                                                                                                | 半迁移       | 行已用 `pw-trow`（`:454`）；变更分组头（`:1847`）与 scope 分组头（`:764`）自绘；空态纯文本（`:1931`）非 `pw-empty-inner`；右键菜单全自绘（`:1908-1948`）                                                 |
| `TerminalPanel.tsx`                                                                                                                                                               | 半迁移       | `pw-term` + `pw-card-head` 已用；**画板 31 的 cwd 状态条与退出徽章未落**，现为 `.terminal-panel-exit` 自绘（`:249-264`）                                                                |
| `BrowserPanel.tsx`                                                                                                                                                                | 半迁移       | 头行已用 `pw-viewer-head`；容器、地址栏、视口预设（原生 `select:131`）、空态（`:185-197`）自绘                                                                                              |
| `GitGraphTab.tsx` / `GitRefChips.tsx`                                                                                                                                             | 未迁移       | 全自绘；**`pw-git` 已登记 ⊘（DIVERGENCE 37），不必再改**，但 GitRefChips 应并入同一条登记                                                                                                |
| `CodeFileEditor.tsx` / `fork/UnsupportedFilePreview.tsx` / `ImagePreview.tsx` / `fork/AttachmentPreview.tsx` / `fork/CsvPreview.tsx` / `MarkdownFilePreview.tsx`（FrontmatterCard） | 未迁移 / 半迁移 | CodeFileEditor 全自有类（`:361-372`）；兜底卡全内联（`:93-121`）；CSV 用了 `pw-table` 但元信息条/行号/脚注自绘；frontmatter 用 `markdown-frontmatter-*` 而非画板 `pw-card` + `pw-kv`                |
| `fork/TabOverview.tsx`                                                                                                                                                            | 未迁移       | 全内联浮层（`:143-263`），未用 `pw-pop` / `pw-pop-search` / `pw-prow` / `pw-sep`                                                                                           |
| `FileIcons.tsx`                                                                                                                                                                   | 未迁移       | 彩色 `catppuccin-file-icon`（`:55`），画板 30 用单色 lucide `data-ico`                                                                                                     |

### 2.5 设置（画板 40–47，13 分节）

| 分节                                                 | 档   | 缺口                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 设置壳 + 常规分节 + `WallpaperSettings`                   | 已用  | `pw-modal/pw-settings/pw-snav/pw-row` 齐全（`SettingsPanel.tsx:996-1057`），导航图标 lucide 同序；产品另有画板未画的 `.pw-snav-close` 关闭行（`:1043-1051`）与移动端 `<select>`（`:999-1006`）                                                                                                                           |
| 模型 / 技能 / 子代理 / 插件 / MCP                           | 半迁移 | 结构基件已改挂 `pw-cols/pw-list/pw-detail/pw-litem/pw-btn/pw-switch`（`SettingsUi.tsx:94-330`）；**详情内仍是 `config-scope-tag` / `config-detail-*` + 内联盒**（`ModelsConfig:413/516-525`、`SkillsConfig:189-193/339`、`AgentsConfig:545-549`、`PluginsConfig:1552-1673`）；`AgentsConfig:660-662` 还有手绘成功勾 SVG |
> **时效声明（2026-09-30 换肤收尾后）**：下表是 2026-09-29 审计时的快照，**已滞后**。
> 换肤收尾轮（见 `design/pi-web-design/DIVERGENCE.md` 第 I 节）已把定时 / 记忆 / 快捷键 /
> 用量 / 归档 / 导入 / 命令 / 皮肤工作室全部迁到画板件，`app/boardui/` 也已删除。
> 表格原文按历史保留，现状以 DIVERGENCE I 节与 `docs/design-skin-swap-plan-2026-09-29.md` 为准。

| 定时任务 `fork/CronConfig.tsx`                         | 未迁移 | 单栏 `settings-general*` + `<details>` 内联（`:112-140/484-491`），画板 44 是 `pw-cols` 双栏 + 运行历史                                                                                                                                                                                                  |
| 记忆 `fork/PiMemoryConfig.tsx`                       | 未迁移 | `settings-general` + 全内联（`:216-265`）                                                                                                                                                                                                                                                     |
| 快捷键 `fork/ShortcutsSettings.tsx`                   | 未迁移 | 键帽全内联（`:34-58/273-290`），未用 `pw-field` / `pw-kbd`                                                                                                                                                                                                                                         |
| 用量 `fork/UsageStatsPanel.tsx` + `usage-charts.tsx` | 未迁移 | `StatCard` 内联（`:57-85`）未用 `pw-stat`；`usage-charts.tsx` 三张图全是手写 inline SVG（`:117/189/265`），未用 `pw-cell/pw-bars/pw-legend`                                                                                                                                                                 |
| 归档 / 项目归档 / 导入                                     | 未迁移 | `settings-archive-*` / `fork-settings-block` + `role="tablist"` 内联，画板 46 是 `pw-sec-title/pw-detail/pw-list/pw-radio/pw-kv`                                                                                                                                                               |
| 皮肤工作室 `ThemeSkinStudio.tsx`                        | 未迁移 | 对话框整体 `fork-skin-dialog-*`（`:168-384`），**画板 47 只画了内容行、没画 dialog 框架**；皮肤条 `ThemeSkinStrip` 已用画板件                                                                                                                                                                                          |
| 命令 `fork/PromptsConfig.tsx`                        | 未迁移 | 零 `pw-*`                                                                                                                                                                                                                                                                                 |

### 2.6 移动端与系统态（画板 60 / 61）

- 抽屉侧栏、安全区、`display-mode: standalone`、三档断点（`hooks/useIsMobile.ts:6/8/19` = 640/480/1024）**已落地**。
- **移动端信任横幅已经存在**（`AppShell.tsx:1899-1933`，`data-mobile-trust-banner`）——DIVERGENCE 17「实现里没有」已过时；现状是内联手绘 banner，未用 `.pw-banner`。
- 顶栏 48 / 覆盖式工具条为内联实现，未用 `pw-mobile-actions` / `pw-touch` / `pw-scrim-layer` / `pw-drawer`。
- **画板 60 正文写窄屏 ≤380，实现用 480**（`useIsMobile.ts:8`），二者必须二选一。
- 系统态：错误页两层齐备（`app/global-error.tsx` 合规；`app/error.tsx:58-63` 缺画板的主题图标卡 / digest 复制 / 「看控制台」）；**拖放落区未用 `.pw-drop`**（`ChatWindow.tsx:1982-2010`）；离线无全局 UI；画板 61 未画离线态与长文本溢出规则。

---

## 3 · 设计侧缺口

### 3.1 产品有、画板无（真漏画）

| 功能                         | 现状                      | 证据                                                                      |
| -------------------------- | ----------------------- | ----------------------------------------------------------------------- |
| 顶栏 MCP / 插件两枚图标与浮窗         | 画板 22 自述「六个图标」，无 MCP/插件 | `TopBarPopovers.tsx:20-22/260/318`                                      |
| 扩展 widget 已移入插件浮窗          | 画板 54 仍画「输入框上方可折叠块」     | `54-extension-links-exploration.html:26/29` vs `TopBarPopovers.tsx:353` |
| 侧栏「用户自定义分组头 + 回到未分组拖放区」    | 全内联，无画板                 | `fork/GroupedProjectList.tsx:397-470`                                   |
| 零会话起步三卡（`EmptyStateGuide`） | 全内联，无画板                 | `fork/EmptyStateGuide.tsx:54`                                           |
| 附件预览灯箱                     | 产品有，画板 50 未画            | `fork/AttachmentPreview.tsx:214-300`                                    |
| 输入历史弹层（↑ 唤起）               | 产品有，画板 21 未画            | `ChatInput.tsx:3429-3469`                                               |
| 路径操作簇（复制/显示/打开）            | 全内联，画板未给行内动作规范          | `fork/PathActions.tsx:57-96`                                            |
| 皮肤工作室 dialog 外壳            | 画板 47 只画内容行             | `ThemeSkinStudio.tsx:168-384`                                           |
| 「已选目录但无会话」的选中型空态           | 产品有，画板 01 未画            | `AppShell.tsx:2934-2951`                                                |


### 3.2 board.css 反向缺口：产品自造的 10 个 `pw-*` 类

这些类**产品用了、名字带画板前缀，但定义在 `app/fork-ui.css`，`board.css` 与 30 张画板里都没有**：

| 类                                                                       | 产品定义                              | 使用处                              |
| ----------------------------------------------------------------------- | --------------------------------- | -------------------------------- |
| `pw-search-results` / `pw-search-project` / `pw-search-hit` / `pw-mark` | `fork-ui.css:2327/2344/2351/2360` | `SessionSearch.tsx:79/112/13/15` |
| `pw-row-toggle`                                                         | `fork-ui.css:2313`                | `SessionSidebar.tsx:510`         |
| `pw-range`                                                              | `fork-ui.css:2507`                | `SettingsUi.tsx:675`             |
| `pw-skin-actions`                                                       | `fork-ui.css:2577`                | `ThemeSkinStrip.tsx:119`         |
| `pw-snav-close`                                                         | `fork-ui.css:2599`                | `SettingsPanel.tsx:1048`         |
| `pw-wallpaper-thumb`                                                    | `fork-ui.css:2611`                | `WallpaperSettings.tsx:170`      |
| `pw-litem-add`                                                          | `fork-ui.css:2636`                | `SettingsUi.tsx:286`             |

治理动作：要么上提到 `board.css` + 对应画板，要么去掉 `pw-` 前缀改回 `fork-`；否则「视觉唯一来源是 board.css」这条纪律名存实亡。

### 3.3 规范条目缺验收判据（`DESIGN-SPEC.md`）

| 条目                             | 问题                                         | 建议补的判据                                                                |
| ------------------------------ | ------------------------------------------ | --------------------------------------------------------------------- |
| §1.1「不做大面积底色」                  | 无面积阈值                                      | accent/语义实色只允许主按钮、焦点环、spinner；`.soft` 淡底不得覆盖整卡或超过 `--control-xs` 高的整行 |
| §1.1「细状态条」                     | 未给厚度                                       | ≤2px                                                                  |
| §1.2「唯一的一种阴影」                  | 与同时存在 `--shadow-modal` 自相矛盾                | 弹层 = popover，模态/遮罩 = modal                                            |
| §1.4「四周各多 4–6px」               | 区间模糊                                       | 定死 6 / 4                                                              |
| §2.7「输入框下没有第二条横条」              | 画板 `20:313-343` 仍画 `.pw-stats` 常显条，与规范直接冲突 | 删掉该帧或改断                                                               |
| §2.1「结构照实现」 vs README「画板是功能边界」 | 无优先级规则                                     | 结构照实现仅限画板已绘制的面；新面先出画板                                                 |
| §3「合理样例」                       | 无判据                                        | 删掉或量化                                                                 |
| §5 产出要求                        | **没有「新增 `pw-*` 必须先进 board.css」这一条**        | 补上——这正是 §3.2 的成因                                                      |

### 3.4 硬约束越界清单（`app/ components/ lib/`，排除测试）

| 约束               | 越界数                        | 最差处                                                                                                                                                                                                                    |
| ---------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1.3 圆角上限 6      | 5 处                        | `fork-ui.css:1454`(12px)、`:1423`(10px)、`:1484`(8px)、`:1599`(7px)、`ChatInput.tsx:4285`(`0 9px 9px 0`)；全部在皮肤工作室与 composer 右端                                                                                             |
| §1.5 字阶五档        | 20 处                       | `usage-charts.tsx:119/124/197/228/276/292`(9px)、`ChatMinimap.module.css:154/174/252`(10px) 与 `:200/314/337`(14px)、`settings.css:193/263/341/352`、`globals.css:234/2313`；另有 5 个动态字号入口（`--chat-content-font-size` 等）破坏五档 |
| §1.5 字重只 400/500 | 119 处                      | 600×92、650×7、700×20；最差 `app/boardui/typography.css`(26)、`ModelsConfig.tsx`(17)、`globals.css`(11)、`settings.css`(11)、`ChatWindow.tsx`(7)                                                                                |
| §1.6 图标一律 lucide | 手绘内联 `<svg>` 171 处 / 42 文件 | `ChatInput.tsx`(13)、`FileExplorer.tsx`(13)、`ProcessGroup.tsx`(13)、`AppShell.tsx`(10)、`MessageView.tsx`(10)；`data-ico` 已用 154 处 / 30 文件                                                                                 |
| §1.6 禁 emoji     | 渲染态 2 处 + i18n 6 行         | `ModelsConfig.tsx:351/353`（供应商 emoji 图标）、`i18n/messages/*.ts:184-185`（✅❌）；`ExplorationBanner.tsx:115` 一个 `⑂`；另有 `✕ ↺ ● ↗` 五个符号字形当图标                                                                                    |
| §1.1 单一强调色       | 3 类第二色入口                   | `app/boardui/theme.css:35-45`(`--color-accent-*`)、`:343-365`(`--color-chart-1..9` 九个色相)、`:368-371`(4 条渐变)——**定义存在但产品消费 = 0（惰性死变量）**；真正会出现的第二色相只有皮肤工作室自定义 accent（`ThemeSkinStudio.tsx:60`，用户已裁定保留）（2026-09-30 起 boardui 已删，该行仅存档）                      |
| §1.2 三级表面        | 达标                         | `globals.css:2784-2797` 桥接层把 `--bg*` 全映射到同一条 10 级中性阶                                                                                                                                                                   |

---

## 4 · 已过时的台账条目（应清理，避免每轮重复审计）

| 条目                                                           | 现状                                                                                                                                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DIVERGENCE §C 12–17（C-12~C-17）                               | **整段作废**：回合结束行、上下文环三档、通知条、导出入口、移动端信任横幅均已落地（分别见 `MessageView.tsx:985`、`ChatInput.tsx:2956`、`ChatWindow.tsx:2733`、`SessionRowContextMenuBridge.tsx:87`、`AppShell.tsx:1933`） |
| D-18「登录实现侧尚未删」                                               | **已删净**：`app/login/`、`app/api/web-auth/`、`lib/web-auth.ts` 不存在（`SettingsPanel.test.mjs:203-211` 断言 ENOENT），`proxy.ts` 只剩同源防护，`SettingsPanel.tsx:896` 是注释                  |
| D-20「动效没有引用设计 token」                                         | 已落地（PR-05/27 + `--motion-rise/transition/stream/stagger/sheet`）                                                                                                           |
| D-31「统计长条与画板冲突」                                              | 已裁定：统计收进上下文环浮窗，常显条删除（`AppShell.session-stats.test.mjs:19-20` 断言无 `.pw-stats`）                                                                                             |
| G-38「`.pw-side-search` 常显」                                   | 实为**仅搜索态**（`SessionSidebar.tsx:659-663` 注释 + `:1668`）                                                                                                                     |
| 第 29 条「工具定义参数表两列」                                            | 已恢复四列（`ToolDefinitionsPanel.tsx:247-262`）；`:168` 的注释还是旧的                                                                                                                  |
| 第 248-249 行「分节样式全由 `config-*` 承载，维持现状」                       | 结构基件已改挂 `pw-*`（`SettingsUi.tsx:94-330`），应改为「五个详情分节半迁移，七个分节待迁」                                                                                                             |
| 换肤计划矩阵「`@` 引用菜单 / `ProjectTrustDialog` / `NewTaskPicker` 未接」 | 三者都已挂 `pw-pop` / `pw-modal`，只差搜索头与个别开关                                                                                                                                    |
| 换肤计划矩阵「查看器六形态全套未接」                                           | 已接 `pw-viewer-head` + diff 覆盖层 + 已删除提示（`FileViewer.tsx:2462/2718/2713`），剩容器与 `.pw-live`                                                                                   |
| 画板 `56-agent-management.html`                                | **文件名与内容不符**：文件标题是「56 · 更新与认证」，真正的子代理画板是 42                                                                                                                               |
| 画板 `20-composer.html:313-343`                                | 仍画已删除的 `.pw-stats` 常显条，与规范 §2.7 冲突                                                                                                                                        |

---

## 5 · 建议批次（沿用 SW 编号）

| 批次                             | 内容                                                                                                                                                                                         | 覆盖的未接类                                                                                                 | 规模    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ----- |
| **SW-A 收口弹层**（原 SW-01~03 的剩余）  | `ModelSelector` 整段换 `pw-pop`；`@`/`/` 菜单补 `pw-pop-search`；`DirectoryPicker` 头体脚；`PathActions`；`NewTaskPicker` 搜索头                                                                           | `pw-pop-search` `pw-url`                                                                               | 0.5 天 |
| **SW-B 设置七分节**（原 SW-07~13 的剩余） | 定时 / 记忆 / 快捷键 / 用量 / 归档 / 导入 / 命令 + 五个详情分节的 `config-*` 内联盒清零 + 皮肤工作室 dialog 外壳（**需先补画板 47 的 dialog 帧**）                                                                                    | `pw-stat` `pw-bars` `pw-legend` `pw-kbd` `pw-field` `pw-textarea` `pw-kv`                              | 3–4 天 |
| **SW-C 转录收尾**（原 SW-15）         | `MarkdownBody` 的 `markdown-code-*` → `pw-code`；`MermaidBlock` 源码态 + 全屏缩放；`ChatMinimap` 接 `pw-minimap-rail/pop` + 回合 `kind` 字段；消息操作行 → `pw-msg-acts`；内容块六分支 → `pw-img/pw-filecard/pw-audio` | `pw-md` `pw-code*` `pw-minimap-*` `pw-msg-acts` `pw-img` `pw-filecard` `pw-audio` `pw-meta` `pw-fname` | 2 天   |
| **SW-D 右栏收尾**（原 SW-04~06 的剩余）  | `pw-viewer/pw-viewer-body` 容器、`.pw-live` 同步点、树分组头 / 空态 / 右键菜单、`TabOverview`、CSV 行号与脚注、frontmatter 卡、CodeFileEditor 状态栏、`FileIcons` 单色化                                                     | `pw-viewer*` `pw-tree` `pw-live` `pw-empty-inner` `pw-kv`                                              | 2 天   |
| **SW-E 壳与零散**（原 SW-17 前半）      | 折叠导轨 → `pw-rail`；`AppShell` 67 处内联收敛（图标钮尺寸 / 顶栏标题 / 空态）；`GroupedProjectList` 分组头；手绘 `<svg>` 171 处分批换 `data-ico`（先 ProcessGroup/ExplorerPanel/TabBar/FileIcons）                             | `pw-rail` `pw-group-title` `pw-banner` `pw-touch` `pw-mobile-actions`                                  | 1.5 天 |
| **SW-F 设计侧**（与代码并行）            | 补 9 张漏画（§3.1）；把 10 个产品自造 `pw-*` 上提 `board.css` 或改前缀；`DESIGN-SPEC` 补 8 条判据 + 「新增 `pw-*` 先进 board.css」；修画板 20 的 `.pw-stats` 帧；画板 56 改名或改内容；画板 60 断点 380/480 二选一；清理 §4 的过时台账                  | —                                                                                                      | 1 天   |

排序建议：**SW-F 的前半（10 个 `pw-*` 上提 + 规范补判据）先做**，否则后面每个组件都会继续在 `fork-ui.css` 里长出「假的画板类」。

---

## 6 · 复现口径

```bash
# 三个门禁（应全绿）
node scripts/check-style-literals.mjs
node scripts/check-motion-tokens.mjs
node design/pi-web-design/scripts/check-boards.mjs

# 画板组件类落地率：board.css 的 pw-* 定义集 − 产品引用集
#   （实现见本文件 §1.1 口径：剔除 pw-anim-* / pw-head|pw-tag|pw-tags / 演示台脚手架）

# 内联样式分布
#   components|app|hooks|lib 下 .tsx/.ts（排除 *.test.*）里 style={{ 的出现次数
#   本文件实测：产品 85 个 >2KB 组件中 71 个含内联，共 1595 处

# 字重 / 字阶 / svg / emoji 越界
#   /(?:font-weight|fontWeight)\s*[:=]\s*(\d{3})/g          → 600/650/700 计越界
#   /<svg[\s>]/g                                            → 手绘图标（非 data-ico）
#   /[\u{1F300}-\u{1FAFF}\u2705\u274C\u2728\u26A0\uFE0F]/gu   → emoji
```

> 写这份审计时没有改动任何产品代码；所有结论均来自上列命令与 `file:line` 复核。
