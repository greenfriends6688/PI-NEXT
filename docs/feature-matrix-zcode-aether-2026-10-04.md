# 三方能力对比 · PI NEXT × ZCode × Aether

> 调研日期 2026-10-04 · 证据均来自源码实读，路径可复核
> - `ZCode-main` = `pi参考项目/ZCode-main`（pnpm monorepo，`packages/ui|web|desktop|server|zcode-cua` + `apps/zcode-cli`）
> - `Aether-main` = `pi参考项目/Aether-main`（Kotlin Multiplatform，Compose + SwiftUI，pi-bridge 宿主）
> - `PI NEXT` = 本仓（Next.js 16 单页工作台）
>
> **这份文档只回答三件事：我这里有什么、他们有什么、哪些能搬。**

---

## 0 · 一句话结论

**PI NEXT 的"硬能力"已经比两个参考项目都厚**（转录渲染、文件查看器、终端/浏览器、模型配置、技能市场、定时任务、用量仪表盘、LAN/IM/机器人、主题皮肤，全都比 Aether 重，多数也比 ZCode 重）。

**真正缺的是"元层"——让人能把这套能力用起来的那层：**

| 缺口 | 严重度 | 参考方 |
|---|---|---|
| 命令面板（⌘K 全局搜索） | **P0** | ZCode `command-center/` |
| 插件商店（远程目录浏览/详情/安装） | **P0** | ZCode `settings/PluginStore*` |
| 扩展 UI 插槽体系（只有 3 个注入点） | **P0** | Aether `extension-api`（12 插槽 + 5 宿主） |
| 首次引导 Onboarding | P1 | ZCode `onboarding/` · Aether `OnboardingScreen` |
| 记忆 / 知识（主动删掉了） | P1 | ZCode `MemorySettingsSection` |
| 保存的工作流（可复用带参流程） | P1 | ZCode `saved-workflows/` |
| 可访问性开关（高对比 / 减动效用户级） | P2 | Aether 4 套调色板 |
| 可编辑快捷键 | P2 | ZCode `shortcuts/` |
| 消息重做（regenerate） | P2 | Aether `redoAgentMessage` |

**最大的债不是功能，是样式层**：`fork-ui.css` 159KB + `board.css` 111KB + `globals.css` 94KB + `fork-mac-skeuo.css` 59KB = **423KB 全局 CSS，靠 `app/layout.tsx` 里 11 条 import 的源码顺序决胜负**。任何一条 import 移位就是全局视觉回归。这才是 v3 要解的题。

---

## 1 · 你点名的 11 项（ZCode 侧）

### 1.1 插件系统 · 尤其是 iOS / Android 模拟

**证据**：`apps/zcode-cli/packages/bootstrap/src/app/official-plugin-definitions.ts`

ZCode 官方插件清单（含分类与默认启用）：

| 插件 | 分类 | 默认 | 说明 |
|---|---|---|---|
| `node-repl-host` | — | ✅ | 宿主注入 `node_repl` MCP |
| **`android-emulator`** | developer-tools | ❌ | 「提供 Android 开发工作流与**模拟器自动化**能力」 |
| **`ios-simulator`** | developer-tools | ❌ | 「提供 iOS 开发工作流与**模拟器自动化**能力」 |
| `browser-use` | productivity | ✅ | 操作内置浏览器，检查网页并验证交互 |
| **`computer-use`** | — | — | 电脑控制（配 `packages/zcode-cua`、`cua-permission/`） |
| `documents/pdf/presentations/spreadsheets` | productivity | ✅ | Office 四件套（docx/pptx/xlsx） |
| `image-search` | productivity | ✅ | 搜图 |
| `plugin-creator` / `skill-creator` | — | ✅ | 元插件：让 Agent 自己造插件/技能 |
| `zcode-guide` | — | — | 内置指引 |
| `restore-legacy-sessions` | utilities | ❌ | 旧版会话迁移 |

**关键事实（决定能不能搬）**：

1. 这两个是**真·原生模拟器**，不是 Web 端渲染的设备外壳。
   描述写的是「开发工作流与**模拟器自动化**」，走的是 macOS `simctl` / Android `adb`。
2. 插件本体**不在仓库里**。`rootCandidates` 指向 `packages/ios-simulator-plugin`
   （`ls packages/` 只有 client/desktop/ui/web/server/services/shared/rpc/provider/zcode-cua 等，
   **没有** `ios-simulator-plugin`）→ 说明从市场/CDN 下拉安装，本仓只有"清单定义"。
3. 因此**依赖本地运行时**：必须宿主机器装了 Xcode（仅 macOS 能跑 iOS 模拟器）或 Android SDK。

#### 能不能直接集成到 PI NEXT？

**分三层回答：**

| 层 | 能否集成 | 方案 |
|---|---|---|
| **插件商店的 UI/交互** | ✅ **能，且应立刻做** | 纯前端。`PluginStorePage/ListView/DetailView/Card/SourcesDialog/PluginUninstallConfirmDialog` 的交互骨架可直接抄。PI NEXT 已有技能市场（skills.sh + SkillHub）与 MCP catalog 的经验，插件商店是同一模式的第三块拼图。**v3 已画：W-09（Web）/ P-08（PWA）** |
| **设备预览（视口外壳）** | ✅ **能** | 纯 Web：iframe + 机型尺寸预设 + 旋转/缩放/截图/安全区开关。不需要任何本地依赖。**v3 已画：W-08（Web 设备预览面板）/ P-07（PWA 浏览器与设备视口）** |
| **原生模拟器自动化** | ⚠️ **有条件能** | PI NEXT **有** `electron/` 桌面壳 + `/api/terminal` + bash 工具 → **技术上可行**。做成「技能/插件」：通过 bash 调 `xcrun simctl` / `adb`，截图回传到转录区。**前提**：宿主是 macOS（iOS 侧）、装了 Android SDK（安卓侧）。纯浏览器部署形态下**不可用**，必须走桌面壳。 |

**结论**：不要试图"直接集成 ZCode 的这两个插件"（它们是 CLI 包，且不在本仓）。
正确姿势是 **「商店 UI 抄 ZCode + 设备预览做纯 Web 降级 + 模拟器自动化做成依赖本地运行时的可选技能」**，三件事分别排期。

---

### 1.2 定时任务

**ZCode 没有叫 cron 的东西，它叫 `Automations`**（`packages/ui/src/settings/`）：

- `AutomationsSection.tsx` / `AutomationsMainBreadcrumbFrame.tsx`
- `AutomationEditView.tsx` / `AutomationInstructionsComposer.tsx`
- `AutomationScheduleBadge.tsx` / `AutomationSwitchToggle.tsx`
- `AutomationTemplateSkeletonGrid.tsx` / `AutomationScheduledTemplateIcon.tsx`
- 还有一组 **`OffPeak*`**：`OffPeakTaskList` / `OffPeakEditView` / `OffPeakHistoryTab` / `OffPeakTemplateIcon`

**PI NEXT 现状**：✅ **已有且更完整**（`lib/automation-store.ts`、`/api/automation`、
`fork/AutomationPanel.tsx`）。4 种调度 `once/daily/weekly/interval`，子会话归属 `daily/reuse`，
运行状态 `success/error/skipped`，运行历史，运行中 5s 刷新，读不出数据返回 422 而非空列表。

| 维度 | ZCode | PI NEXT | 判定 |
|---|---|---|---|
| 调度模式 | Automations + 模板 | once/daily/weekly/interval | **PI NEXT 胜** |
| 模板目录 | ✅ `AutomationTemplateSkeletonGrid` | ❌ 无 | **ZCode 胜** |
| **错峰执行（OffPeak）** | ✅ 独立一组 UI | ❌ 无 | **ZCode 胜，值得抄** |
| 运行历史 | ✅ | ✅ | 平 |

> **可抄点**：「模板目录」与「错峰执行」两个概念。错峰（把不急的任务放到低负载时段跑）
> 在有多供应商配额 / 本地机器负载的场景很实用，PI NEXT 已有供应商配额芯片，接得上。

---

### 1.3 全局搜索

**ZCode**：`packages/ui/src/command-center/CommandCenterDialog.tsx`
+ `commandCenterSearchHistory.ts`（搜索历史）+ `quickpick/`（快速选择）
+ `workspace-file-search/`（工作区文件搜索）

**PI NEXT 现状**：❌ **没有命令面板**。这是最明确的缺口。
- 全仓搜不到 `CommandPalette`，`lib/shortcuts.ts:26` 注释说「⌘K 是只读行」，
  但 `SHORTCUT_COMMAND_IDS` 里**根本没有 commandPalette 这一项**——**注释与实现已经漂移**。
- 现有搜索是分裂的：侧栏会话全文搜索（`/api/sessions/search`，上限 50）、
  会话内 ⌘F（`lib/conversation-find.ts`）、文件树搜索、`@` 模糊匹配。

**v3 已画：W-07（Command Center）** —— 三类结果（`>` 命令 / `#` 会话 / `@` 文件）、
scope 页签、搜索历史、命中片段高亮、范围浮层。这是**本次改版最高优先级的新增页面**。

---

### 1.4 工作流

**ZCode 有，且是一整套**：`packages/ui/src/settings/saved-workflows/`（24 个文件）

| 文件 | 含义 |
|---|---|
| `SavedWorkflowCard` / `DetailView` / `DetailHeader` | 卡片 + 详情页 + 详情头 |
| `SavedWorkflowArgsTable` / `savedWorkflowArgsForm` / `savedWorkflowLaunchPrompt` | **带参数的启动表单** |
| `SavedWorkflowLaunchDialog` / `useSavedWorkflowLauncher` | 启动对话框 + 启动器 |
| `SavedWorkflowRunHistoryPanel` / `savedWorkflowRunHistory` / `useSavedWorkflowRunOpeners` | 运行历史 |
| `SavedWorkflowProjectGroup` / `SavedWorkflowGlobalGroup` / `globalWorkflowGroupHelpers` | 按项目分组 + 全局分组 |
| `SavedWorkflowMoveDialog` / `useSavedWorkflowPromote` / `useSavedWorkflowProjectTargets` | 移动 / **提升为全局** |
| `SavedWorkflowArtifactChips` / `SavedWorkflowMetaForm` | 产物芯片 / 元信息表单 |

**概念**：把一次跑通的任务流程**存成可复用、带参数、有运行历史、可提升到全局的工作流**。
这不是"工作流编排引擎"（没有节点图），而是**「成功任务 → 模板化 → 一键复跑」**。

**PI NEXT 现状**：❌ **没有**。最接近的是 slash 命令（`prompt` 来源）与技能，但都不带"参数表单 + 运行历史 + 提升为全局"。

> **可抄点**：这个概念成本不高、价值很高——它把"我上次那个复杂任务怎么跑的"变成可复用资产。
> 建议做进「定时任务」旁边（`fork/AutomationPanel` 已有 CRUD + 历史的基础设施，可复用）。

---

### 1.5 模型设计

| 维度 | ZCode | Aether | PI NEXT |
|---|---|---|---|
| 多供应商并存 | ✅ | ✅ | ✅ |
| 目录 catalog | ✅ | ✅ `PiProviderCatalog.kt` | ✅ |
| 远端拉取模型列表 | ✅ | ✅ | ✅ |
| 认证方式 | API Key / OAuth | **ApiKey / OAuth / Ambient** | API Key / OAuth |
| 自定义 Header / UA / 兼容模式 | ✅ | ✅ | ✅ |
| **按用途拆默认模型** | ❓未见 | ✅ **4 个**（chat / title / naming / compacting） | ⚠️ **只有 2 个**（defaultModel + titleModel） |
| **推理强度按模型 clamp** | ✅ `ThoughtLevelCycleControl` | ✅ `thinkingLevelClampsByProviderModel` | ✅ `lib/thinking-level-memory` |
| 供应商配额 | ✅ `CodingPlanUsageRemainingPanel` | ❌ | ✅ `fork:quota-chip` |
| 收藏模型 | ❌ | ❌ | ✅ `fork:pr17-favorites` |
| 成本档 | ❌ | ❌ | ✅ `fork:cost-tiers` |

> **可抄点（Aether）**：`compacting` 与 `naming` 各用独立模型。
> PI NEXT 的压缩预算已有"按模型覆盖"（`CompactionModelOverride`），但那是给某模型配
> reserveTokens，**不是"用哪个模型压缩"**（`lib/context-budget-settings.ts:40` 注释明说
> SDK 里 `grep -n "compactionModel"` 零命中）。要真做，得看 SDK 是否支持；不支持就别造。

---

### 1.6 使用统计

| | ZCode | Aether | PI NEXT |
|---|---|---|---|
| 面板 | `CodingPlanUsageRemainingPanel`（偏配额剩余） | `StatisticsSettingsPage`：4 图表（每日 token 柱 / 折线 / 构成饼 / 速度柱）+ 指标磁贴 + 历史峰值 | `fork/UsageStatsPanel` + `fork/usage-charts.tsx`：**卡片网格 + 年度热力图 + 模型占比条 + 请求/错误散点 + 每日 token 柱 + 项目列表**，7d/30d/1y/all 四档 |
| 依赖 | — | 自绘 | **零依赖手写**（明确拒绝 recharts，因 Electron/Linux 下 recharts 模块初始化崩溃） |
| 每会话 token | ❓ | ✅ 气泡底部 | ✅ 上下文环浮窗 |

**判定：PI NEXT 这块已经比两边都强。** 唯一缺口是**首 token 延迟 / 输出速度故意不做**（`.jsonl` 里没样本，不造假）——这个克制是对的，别为了对齐 Aether 去造数据。

---

### 1.7 浏览器控制

| | ZCode | PI NEXT |
|---|---|---|
| 形态 | `browser-use` 插件 + `browser-use/` 目录 + `EmbeddedBrowserPaneParts` | `BrowserPanel.tsx` + `/api/browser`、`/api/browser/preview` |
| 能力 | 「操作内置浏览器，检查网页并验证交互」——**给 Agent 用的自动化** | 本地预览 + 远程页面脚本 |
| 安全 | — | `lib/browser-*.ts`：ref store、风险门禁、URL 策略、容量、通知 |

**PI NEXT 的已知问题**（`findings.md:50`）：自称"本地服务浏览器"，实际任意非空 URL 都能进，
iframe 允许 scripts/same-origin/forms/popups；**没有跨站提示、加载失败态、被 CSP/X-Frame-Options 拦截后的解释**。

> **可抄点**：ZCode 把它做成**插件 + 独立目录**，边界清晰。PI NEXT 建议补三件事：
> 跨站提示条、加载失败态、被拦截后的解释文案。v3 的 P-07 已画地址栏与元素拾取。

---

### 1.8 电脑控制（Computer Use）

| | ZCode | PI NEXT |
|---|---|---|
| 实现 | `computer-use` 官方插件 + `packages/zcode-cua` + `cua-permission/`（独立权限模块） | ❌ **没有** |
| 权限 | 专门的 `cua-permission/` 目录 | — |

**判定**：这是 PI NEXT 的真空地带。但要注意——**PI NEXT 是 Web 应用，浏览器里拿不到桌面截图与输入注入**。
要做得依赖桌面壳（`electron/`），且需要一套**显式的、可撤销的权限模型**（ZCode 为此单开 `cua-permission/` 目录，说明这是个重活）。

> 建议：**不做**。除非桌面壳成为主推形态。若要做，必须先把权限模型设计清楚，
> 「截图范围 / 持续时间 / 可随时中断 / 操作留痕」四件事缺一不可。

---

### 1.9 工作台（首屏）

| | ZCode | Aether | PI NEXT |
|---|---|---|---|
| 形态 | `TaskList` / `TaskListItem` / `workspace-grouped-tasks/`（任务列表为中心） | `ConversationScreen`（对话即首屏）+ 空态 2×2 starter chip | `fork/NewSessionHome.tsx` + `.pw-empty`（"1. 选项目 2. 加模型"）+ `.pw-starter` 三条起步路径 |
| 空态引导 | `ChatEmptyState.tsx` / `ChatEmptyScratchWorkspaceDialog` | **2×2 彩色 starter chip**（分析图片 / 写代码 / 帮我写 / 总结文件），点击直接填入完整提示词 | 三条起步路径 |

**v3 已画：W-01（工作台基准页）**。

> **可抄点（Aether）**：starter chip 点击后**直接填入完整提示词**（不是只给个标题）。
> PI NEXT 的 `.pw-starter` 是"路径"，Aether 的是"可执行的完整指令"，后者转化率高。

---

### 1.10 输入框（Composer）

**ZCode**：`LexicalChatInput.tsx`（Lexical 编辑器）+ `chat-input-toolbar/`（含
`ThoughtLevelCycleControl`、`display.tsx`）+ `v4/composer/`（V4ComposerModeControls）+ `mentions/`

**Aether**：`ConversationComposerOverlay` —— **"Plus 分离"形变动画**是全场最值得抄的一段：

```
plusSeparated = 有草稿 || 有 action tray || (聚焦 && 键盘可见)
一个布尔量同时驱动 5 个属性，统一 tween(260ms, cubic-bezier(.22,.84,.18,1))：
  外层水平 padding 30 → 18 → 14dp
  字段左侧占位   0  → 50dp
  字段内容左内边距 52 → 18dp
  最小高度      50  → 56dp
  Plus 按钮阴影  0  → 10dp
```
（`ConversationUi.kt` L2490-2561）

**PI NEXT 现状**：`components/ChatInput.tsx`（4298 行，全仓最大文件）——
模型选择（含收藏、配额芯片）、**延迟生效模型**、思考档、工具档、权限档、
`@` 提及（带防误触发）、行内引用 `& # ~`、`/` 命令（带补全面板，4 类来源，内置 8 条）、
附件、草稿、**双队列（steering/followUp）**、历史回溯、缩放、阅读态塌陷、实时速度徽标、上下文环、待办芯片。

| 维度 | ZCode | Aether | PI NEXT | 判定 |
|---|---|---|---|---|
| 编辑器内核 | Lexical | 原生 TextField | textarea | ZCode 更重 |
| 能力 chip 归一化 | ❓ | ✅ **技能/MCP/AgentMode/Chrome 全归一化为同一种可选 chip** + 动态 placeholder | 模型/思考/工具/权限是**分开的独立控件** | **Aether 胜** |
| Plus 分离形变 | ❌ | ✅ | ❌ | **Aether 胜** |
| 队列 | ✅ | ✅ Steer vs Queue 二选一 | ✅ **双队列数据层，但 UI 被砍成单通道** | 见下 |
| `/` 补全 | ✅ `SlashCommandPlugin` | ✅ | ✅ | 平 |
| 上下文占用显示 | ❓ | ❌ | ✅ 上下文环浮窗 | **PI NEXT 胜** |

**PI NEXT 的一个已知裁定**（`ChatInput.tsx:2375`）：「流式中发送只有一条路：排队（followUp），
不再让用户选 steer/followUp」。所以 `steering` 队列只剩扩展/SDK 能填。

> **这里有个真实的产品张力**：Aether 明确给了 Steer / Queue 二选一（琥珀 vs 蓝两种配色），
> ZCode 也有队列。PI NEXT 数据层两个队列都维护，UI 却只暴露一个。
> **建议**：保持"默认排队"的简洁，但在队列面板里允许把某条**提升为 steer**（W-12 已画"恢复方式浮层"）。

---

### 1.11 对话排队

| | ZCode | Aether | PI NEXT |
|---|---|---|---|
| 机制 | 队列 + `TaskInteractionBadge` | `pendingInputs` + `onQueueFollowUp` / `onSteerFollowUp`，`promoteSharedSteersToQueue()` | `QueuedMessages { steering, followUp }`（`useAgentSession.ts:137-140`） |
| UI | — | 二选一菜单 | 逐条移除 / **拖拽排序** / 立即发送 / 移至输入框（`lib/queue-surgery.ts`） |

**判定：PI NEXT 的队列 UI 是三方里最细的**（拖拽排序 + 手术式操作）。
真正的差距不是机制，是**没有把"暂停"做成一等公民**——Aether 有 `ComposerPauseButton`
（运行中且无草稿时显示，白色小方块），PI NEXT 只有 Esc 停止。

**v3 已画：W-12（计划时间线与队列）** —— 含队列两态（自动接续 / 暂停）+ 恢复方式浮层。

---

## 2 · Aether 逐项对比（你要求的第 (3) 点）

### 2.1 Aether 有、PI NEXT 没有

| # | 能力 | Aether 证据 | PI NEXT | 建议 |
|---|---|---|---|---|
| 1 | **扩展 UI 注入框架** | `packages/extension-api/src/index.ts`：12 插槽 + 5 组件宿主（before/after/replace/wrap/hide）+ 29 种设置控件 + 自定义消息类型 + `registerToolTitle` + `intercept` | **只有 3 个注入点**：输入框上下两条 widget（`placement` 仅 2 值）、阻塞式对话框（select/confirm/input/editor/custom）、slash 命令来源 | **P0**。这是生态天花板，差一个量级 |
| 2 | 会话时间轴（右下角迷你地图） | `ConversationTimeline.kt`：58dp 竖轨，静止显示紧凑窗口，拖动展开全量并跳转；阈值 18dp、离开容忍 28dp | ⚠️ **有但形态不同**：`ChatMinimap.tsx` 是聊天区右侧 **36px 全高导轨，永久占一列 grid**（`gridTemplateColumns: minmax(0,1fr) 36px`） | 改为**浮层**，不占布局列 |
| 3 | 消息分支切换 UI + **重做 agent 消息** | `UserMessageBranchSwitcher`、`onRedoAgentMessage` | 分支✅（BranchNavigator）／**重做❌**（全仓搜不到 regenerate） | P2，加"重新生成这一条" |
| 4 | 上下文压缩建议（带百分比） | `compactCommandSuggestion` + `chat_compact_thread_context_percent` | ⚠️ 有百分比读数（上下文环），**没有主动建议** | P2 |
| 5 | 4 种用途独立默认模型 | chat / title / naming / compacting | ⚠️ 只有 2 种 | 见 §1.5，需 SDK 支持 |
| 6 | 统计仪表盘 4 图表 | `TokenBarChart` / `TokenLineChart` / `TokenMixPieChart` / `SpeedBarChart` | ✅ **已有且更强**（含热力图、散点、4 档范围） | **不用抄** |
| 7 | Pi 扩展市场（目录/详情/下载量/兼容警告） | `PiExtensionsPage` / `PiPackageDetailPage` / `formatExtensionDownloads` / `PiPackageInstallWarningDialog` | ❌ 插件无市场（技能✅、MCP✅） | **P0**，同 ZCode 插件商店 |
| 8 | 引导式 Onboarding（6 步 + 流式揭示动画） | `OnboardingScreen.kt`：`splitRevealUnits` / `StreamingStepMessage` / `tourBringIntoViewOnFocus` | ❌ 只有空态两行文案 | **P1** |
| 9 | 平板自适应：抽屉 → 常驻左栏 | `SharedAdaptiveConversationLayout` + `useTabletLayout` | ⚠️ 641–1024px **直接走抽屉**（`useIsCompact()` 被赋给 `isMobile`），没有"宽屏常驻"这一档 | 明确策略 |
| 10 | 高对比模式（4 套调色板） | `Color.kt` L95-115 | ❌ 只有派生 `--accent-contrast`，**无用户开关** | P2 |
| 11 | 全量数据归档 + 日志导出 | `SharedAppDataArchive.kt`、`exportLogsToUri` | ⚠️ **归档是假的**（纯展示，localStorage，不动磁盘）；导出只有会话 HTML/MD 与 MCP 日志 | P2 |
| 12 | 「后台完成未读」指示 | `SharedConversationIndicator.UnviewedComplete` | ⚠️ 有未读标记与"等你处理"，但非同一语义 | — |
| 13 | 扩展请求原生对话框 | `PiExtensionUiDialog`（select/input/confirm） | ✅ 已有（`ExtensionUiRequest`，双队列） | 平 |
| 14 | 工作区模式（共享 / 每会话独立） | `AgentWorkspaceMode { Shared, PerSession }` | ✅ worktree（不同概念，PI NEXT 更强） | — |
| 15 | Agent 自我管理工具 | `SharedAgentManagementTools`（Agent 能改自己配置、装扩展） | ❌ | P2，风险高 |
| 16 | Showcase 演示回放（0.5/1/2/5 倍速） | `ShowcaseControls.kt` + `ShowcaseCatalog.kt` | ❌ | 可选，做官网 demo 有用 |

### 2.2 PI NEXT 有、Aether 没有（别盲目抄）

**这部分很重要——PI NEXT 在不少地方是领先的：**

| PI NEXT 能力 | Aether |
|---|---|
| **LAN 访问**（`lib/lan-access.ts` + `proxy.ts`，只读令牌 HMAC 派生）+ **6 位配对码** + 二维码 | ❌ 纯本地单端 |
| **IM 推送**（飞书/企微/钉钉/Slack/Telegram/任意 webhook） | ❌ |
| **机器人渠道入站**（Telegram / 微信 iLink / 飞书 / Lark） | ❌ |
| **Git 专用面板 + Git 图谱 + worktree** | ❌ 只有 bash/grep 间接，无 Git UI |
| **文件查看器多模式**（源码/预览/diff，支持 PDF/DOCX/PPTX/XLSX/ZIP/CSV/图片）+ CodeMirror 编辑 | 有文件管理器 + sora-editor，但无 diff 模式 |
| **主题皮肤工作室**（501 行，基色/强调色/壁纸/不透明度 + 导入导出）+ 内置 Mac 拟物皮肤 | ❌ 只有 System/Light/Dark，无自定义 |
| **技能双市场**（skills.sh + SkillHub）、**MCP catalog** | 单市场 + 无 catalog UI |
| **用量仪表盘**（热力图 + 散点 + 4 档范围，零依赖手写） | 4 图表但更简单 |
| **定时任务**（4 调度模式 + 子会话归属 + 运行历史 + 422 语义） | 仅 Android，更简单 |
| **双队列 + 拖拽排序 + 手术式队列操作** | Steer/Queue 二选一，无排序 |
| **上下文环浮窗**（token/费用/缓存命中率/耗时，可钉住） | 气泡底部文字 |
| **自动命名 + 命名模型** | ✅ 有（naming model） |
| **会话回退 rewind** | ❌ |
| **⌘F 会话内查找**（CSS Custom Highlight 上色） | ❌ |

---

## 3 · 优先级建议（借鉴价值 × 移植成本）

| 优先级 | 事项 | 来源 | 成本 | v3 是否已设计 |
|---|---|---|---|---|
| **P0-1** | 命令面板（⌘K Command Center） | ZCode `command-center/` | 中 | ✅ **W-07** |
| **P0-2** | 插件商店（目录/详情/安装/来源管理） | ZCode `PluginStore*` + Aether `PiExtensionsPage` | 中 | ✅ **W-09 / P-08** |
| **P0-3** | 扩展 UI 插槽体系（从 3 点扩到 8 点） | Aether `extension-api` | **大** | ✅ **W-11**（已声明 8 个 slot） |
| **P0-4** | 设计体系落地（v3，解 423KB CSS 的债） | 自研 | **大** | ✅ **24 张画板全出** |
| **P1-1** | 首次引导 Onboarding | ZCode `onboarding/` + Aether 6 步向导 | 中 | ⬜ 待补画板 |
| **P1-2** | 保存的工作流（带参 + 历史 + 提升全局） | ZCode `saved-workflows/` | 中 | ⬜ 待补画板 |
| **P1-3** | 记忆 / 知识（找回被删的能力） | ZCode `MemorySettingsSection` | 中 | ⬜ 待补画板 |
| **P1-4** | 定时任务模板目录 + 错峰执行 | ZCode `AutomationTemplate*`/`OffPeak*` | 小 | 部分（W-09 含模板目录） |
| **P2-1** | 消息重做（regenerate） | Aether `onRedoAgentMessage` | 小 | ⬜ |
| **P2-2** | 高对比模式（用户开关） | Aether 4 套调色板 | 小 | ⬜ |
| **P2-3** | 可编辑快捷键 | ZCode `shortcuts/` | 小 | ⬜ |
| **P2-4** | 全量数据归档 / 日志导出 | Aether `SharedAppDataArchive` | 小 | ⬜ |
| **P2-5** | 时间轴改浮层（不占布局列） | Aether `ConversationTimeline` | 小 | ⬜ |
| **—** | 原生模拟器自动化 | ZCode `ios-simulator`/`android-emulator` | **大 + 有前置** | ✅ 降级方案 **W-08 / P-07** |
| **—** | 电脑控制 CUA | ZCode `zcode-cua` | **大 + 权限重** | **建议不做**（Web 形态拿不到） |

---

## 4 · 三条硬边界（别踩）

1. **不要为了对齐而造数据。** Aether 的 `SpeedBarChart`（速度采样）PI NEXT 做不了，
   因为 `.jsonl` 里没有样本——现有代码里明确写了「首 token 延迟、输出速度**故意不做**，不造假」。这个克制是对的。
2. **不要抄 Aether 的 `compacting` 独立模型**，除非先确认 SDK 支持
   （`lib/context-budget-settings.ts:40` 注释已记：SDK 里 `grep -n "compactionModel"` 零命中）。
3. **不要在 Web 形态下做电脑控制 / 原生模拟器**。这两个依赖本地运行时与桌面壳，
   浏览器里既拿不到屏幕也注入不了输入。要么走 `electron/` 并配完整权限模型，要么别做。

---

## 5 · 落到 v3

对比结论已经变成画板了（`design/v3/`）：

| 对比结论 | 对应画板 |
|---|---|
| 命令面板 | **W-07** 全局搜索 Command Center |
| 插件商店 | **W-09** / **P-08** |
| 扩展插槽 | **W-11**（8 个 slot 声明表） |
| 设备预览（纯 Web 降级） | **W-08** / **P-07** |
| 工作台重做 | **W-01** |
| 侧栏顶栏状态 | **W-02** |
| 转录全集 | **W-03** / **P-03** |
| 输入框与弹层 | **W-04** / **P-04** |
| 设置 | **W-05** / **P-05** |
| 右栏四面板 | **W-06** / **P-06** |
| 计划与队列 | **W-12** |
| 安装/更新/离线/信任 | **P-09** |
| 手势与系统态 | **P-10** |

**落地走 `design/v3/LANDING.md`**（四步法 + 触发口令「按 v3 设计落地」）。
