# ZCode / Aether 功能对比矩阵（对照 Pi NEXT 现状）

日期：2026-10-04 · 对象：`pi参考项目/ZCode-main`、`pi参考项目/Aether-main`
目的：回答「他们有什么、我有什么、缺的能不能拿过来、先拿哪个」，作为设计体系 v2 的功能清单输入。

---

## 0 · 方法与口径

- 现状栏**以本仓代码为准**（`components/`、`lib/`、`app/api/`），不凭印象。
- 可移植性三档：
  - **形状可抄** = 纯前端 DOM/状态，照画板抄下来接数据即可（这是本项目已有能力）；
  - **需重写** = 能力可要，但它的实现绑死在自研后端/Electron 上，只能借语义；
  - **不可移植** = 依赖它独有的运行时（原生 Helper、TS 编译器沙箱、CDP 进程），本仓不做。
- 「ZCode 的模拟器」这类**语义错位**项单列，写清在 Web 产品里的等价物是什么。

---

## 1 · ZCode 逐项（用户点名 11 项 + 插件）

### 1.1 插件系统（含「模拟 iOS / Android」）

| | ZCode | Pi NEXT 现状 |
|---|---|---|
| 数据 | `packages/services/src/plugins/*`，manifest `.zcode-plugin/plugin.json`，事实源在 CLI 进程 | `app/api/plugins/route.ts` + `components/PluginsConfig.tsx`，走 pi 的 `DefaultPackageManager`（npm 包） |
| 界面 | `PluginStorePage`：公开/个人分段、Featured、分类分组、**卡片网格**、详情整页（资源清单 + 示例提示词 + userConfig 表单）、市场源对话框、已安装管理视图 | 一个列表式配置弹窗：包列表 + 详情（资源·更新·移除）。**没有商店形态** |

**「模拟 iOS / Android」的真相**：ZCode 里是两张**官方 CDN 插件卡**（`ios-simulator` / `android-emulator`，默认关闭），实现是 MCP server 调 `xcrun simctl` / `adb`，**源码不在仓库**。它给你的是「模型能操作模拟器」，不是「界面上有个手机画面」。

**在 Web 产品里的等价物（这是我们该做的）**：**设备预览面板** —— 把产品页面（尤其 PWA 画板）渲染进 iPhone / Android 设备框，可切机型尺寸、可交互、可截图。它直接服务于「设计 PWA 那套体系」这件事，且成本只有 `iframe + 设备外框 + 尺寸预设`。

- 判定：**商店形态形状可抄**（卡片网格 + 详情页 + 分类，纯前端）；**模拟器语义改写为设备预览面板**；CDN 插件下载体系不抄。
- 优先级：**P0**（设备预览是 PWA 设计体系的必要工具）；商店形态 **P2**。

### 1.2 定时任务

| | ZCode | Pi NEXT 现状 |
|---|---|---|
| 调度 | 独立 Electron utilityProcess 常驻轮询 + SQLite 认领 + misfire 跳过 + 退避重试（`automationRepo.claimDue`） | `components/fork/AutomationPanel.tsx` + `AutomationEditor.tsx` |
| UI | 整页：列表 + 创建/编辑整页 + 状态筛选 + **运行历史** + **闲时任务独立 tab** + **模板目录网格** | 面板 + 编辑器 |

- 判定：**需重写**（调度语义不能抄）。但 **UI 的这四件要补**：运行历史、状态筛选、模板目录、失败/错过一次的明确表达。
- 优先级：**P1**。

### 1.3 全局搜索 ★

| | ZCode | Pi NEXT 现状 |
|---|---|---|
| 形态 | **Command Center** 浮层：`>` 命令 / `#` 会话 / `@` 文件 三类聚合 + scope tab + 搜索历史 chip | 只有 `lib/conversation-find.ts`（**会话内**查找）+ 侧栏会话名搜索 |
| 跨消息 | SQLite `searchable_text` 子串匹配，命中点为中心截 4 条摘要片段 | **没有** |
| 跨文件 | worker 过滤工作区文件清单 | 文件树过滤（仅当前目录树） |

- 判定：**形状可抄**（cmdk 式浮层 = 我们已有的 `pw-pop` + `pw-pop-search` + `pw-prow` 就能搭）；跨会话消息索引**需重写**（我们是 `.jsonl` 文件，没有 DB —— 可以懒建内存索引，或直接流式 grep jsonl 取片段）。
- 优先级：**P0**。这是现状最明显的能力空洞，且完全在纯前端能力范围内。

### 1.4 工作流

| | ZCode | Pi NEXT 现状 |
|---|---|---|
| 引擎 | `dynamic-workflow`：agent 写 TS → 类型检查/污点分析 → 站点图 → 子进程沙箱执行多 actor run + SQLite journal | 无。有 `plan-mode-extension` + `todo-extension` |
| UI | 已保存工作流中枢 + 详情 + 参数表单 + 横向 run 时间线（~25 组件）+ 产物面板 | 无 |

- 判定：**不可移植**（TS 编译器 API + 沙箱 + 自研 run 协议，对纯 Web 产品过重）。
- **建议不做引擎**；只做「多步计划的进度可视化」（把已有 todo/plan 的进度画成时间线）。优先级 **P3**。

### 1.5 模型设计

| | ZCode | Pi NEXT 现状 |
|---|---|---|
| 规模 | `model-provider-section/` ~55 文件 | `ModelsConfig.tsx` + `models-config/{catalog,discover,test}` |
| 独有 | Provider 卡片**内联编辑**、**模型元数据对话框**（模态/推理档位/maxOutputTokens）、**模板选择器**、**拖拽排序**、Coding Plan 套餐卡、`model-option-map`（把推理档编译成请求体 JSON merge patch） | 供应商列表 + 详情 + 模型启用 + 上游导入 + 测试连接 |

- 判定：**形状可抄**（表单/卡片/下拉）；`model-option-map` 那套 Provider 协议接入**需重写**。
- 补：模型元数据编辑、拖拽排序、模板选择器。优先级 **P1**。

### 1.6 使用统计

| | ZCode | Pi NEXT 现状 |
|---|---|---|
| 结构 | `AppUsageSnapshot`：totalTokens/input/output/reasoning/**cacheHitRate**/sessions/turns/**toolCallCount**/**modelErrorRate**/**avgTTFT**/streak | `UsageStatsPanel.tsx` + `usage-charts.tsx`（画板 45 已画九卡五图） |
| 图 | 范围 tab（all/7d/30d）+ 汇总条 + **热力图** + **每日模型堆叠趋势** + **模型饼图** + **工具用量** | 已有五种图 |

- 判定：**形状可抄**，数据**需重写**（它读 agent SQLite，我们读 jsonl / SSE 事件）。
- 补：热力图、工具用量、错误率与 TTFT 两卡。优先级 **P1**。

### 1.7 浏览器控制

| | ZCode | Pi NEXT 现状 |
|---|---|---|
| 能力 | Electron `WebContentsView` + CDP/Playwright：点击/输入/截图/**录屏**/元素拾取/响应式视口/Chrome 数据导入 | `lib/browser-tools-extension.ts`（agent 可控的内置浏览器）+ `BrowserPanel.tsx`。**已有** |
| 缺 | — | 元素拾取、响应式设备视口、截图/录屏回放、多标签驻留 |

- 判定：**已有主体**。补的三件都在我们能力内（元素拾取 = 注入 overlay 脚本；响应式视口 = 改 iframe 尺寸，与 1.1 的设备预览同一套件；截图 = 已有工具）。
- 优先级：**P1**（元素拾取 + 响应式视口与设备预览合并做，一次投入两处受益）。

### 1.8 电脑控制（CUA）

| | ZCode | Pi NEXT |
|---|---|---|
| 状态 | **当前构建是 fail-closed 占位包**（`packages/zcode-cua/README.md` 明示 "This build ships without Computer Use"），设置页入口在但能力不可用 | 无 |

- 判定：**不做**。ZCode 自己都没做出来，没有可抄的实现。

### 1.9 工作台

| | ZCode | Pi NEXT 现状 |
|---|---|---|
| 分屏 | 多窗格树 + **从侧栏拖会话到窗格** + 每 pane 独立 provider | `components/fork/SplitPaneHost.tsx`（已有分屏） |
| 右栏 | side pane 标签：terminal/git/browser/file/subagent/workflow | `TabBar` + 右栏面板（terminal/browser/git/file） |
| 资源盘 | 独立窗口：CPU/内存/存储三 tab + 进程采样 | 无（Web 产品无进程概念） |

- 判定：分屏**已有**；补「拖会话到窗格」。资源盘**不做**（Web 无意义）。优先级 **P2**。

### 1.10 输入框

| | ZCode | Pi NEXT 现状 |
|---|---|---|
| 已有 | 附件上传事务、`@文件/#会话/$技能` mention、slash 命令、prompt 历史、草稿、模型/思考/模式、context usage、Esc 停止、暂停队列确认 | ChatInput 已覆盖：附件、模型、思考、权限档、工具档、压缩、上下文环、声音、发送/停止、队列、`@`/`/`、token 高亮、可拖高、输入历史 |
| 独有 | **网页元素上下文附件**、**代码评论附件**、**PPTX 元素引用**、跨工作区草稿迁移 | 无 |

- 判定：**形状可抄**（都是 chip + 引用快照）。补「选中代码 → 引用」与「网页元素 → 引用」（后者与 1.7 元素拾取同一件）。优先级 **P2**。

### 1.11 对话排队

| | ZCode | Pi NEXT 现状 |
|---|---|---|
| 已有 | dnd-kit 拖拽排序、删除、撤回编辑、立即发送 | `fork:gap04-queue` 已全部覆盖（拖拽/移除/立即发送/移至输入框） |
| 独有 | **autoDrain 暂停/恢复**语义、held 横幅（`stop → completed + queue>0 + autoDrain=false`） | 无暂停语义 |

- 判定：**形状可抄**，状态机**需重写**（它的 autoDrain 在 CLI 侧）。补「队列暂停横幅 + 恢复」。优先级 **P2**。

---

## 2 · Aether 逐项

Aether = Kotlin Multiplatform（Android + iOS），**没有 Web / PWA 端**，内核是 pi-bridge（Node + pi SDK，与我们的 agent 内核同源）。所以：

- **架构层：不可移植**（Compose / SwiftUI / proot / iSH / Termux / Shizuku，全部依赖移动端原生）。
- **形态层：大量可借鉴** —— 它是「同一个 pi agent 在触屏上该怎么长」的最完整答案，正好是我们 PWA 体系的参照。

### 2.1 值得借鉴的形态（按价值排序）

| # | Aether 的形态 | 源码 | 我们的现状 | 判断 |
|---|---|---|---|---|
| 1 | **扩展 slot 体系**：`app.overlay` / `chat.top` / `chat.composer.top` / `chat.list.start/end` / `drawer.header/footer` / `settings.hub` | `AetherExtensionUi.kt:102-119`、`docs/AETHER_EXTENSIONS.md` | 扩展只能进顶栏浮窗 + 右上角状态胶囊 | **值得做**：把「扩展能往哪儿挂」变成一张**声明式 slot 表**，画板为每个 slot 画一帧。P1 |
| 2 | **输入框上方 Action Tray**：已选 Skill / MCP / 模式 / 浏览器 的 chip 常驻输入框上方，可被扩展整块替换 | `ComposerActionTray` | `ComposerContextStrip` 部分覆盖（项目/待办/引用） | 补「模式与能力 chip」 |
| 3 | **三层渐变顶栏** + IME 跟随动画 + 滚动方向感知 | `topOverlayBodyGradient` / `topOverlayTailGradient` | 顶栏是实底 36px | PWA 端可借（移动端顶栏需要渐隐以省高度）。P1 |
| 4 | **右侧时间轴导航**（58dp 轨道，紧凑 56dp，长按展开全量导航条） | `ConversationTimeline.kt` | `ChatMinimap`（36 导轨 + 320 浮层 + 图钉） | 我们已更好。**PWA 端要重新决定**（窄屏没有 36px 导轨的位置）。P1 |
| 5 | **消息级统计浮窗**（tokens/速度/首 token 延迟/缓存命中） | `MessageStatisticsPopup` | `SessionStatsDetails`（会话级） | 补「单条消息级」。P2 |
| 6 | **ReasoningTimeline**：步骤行 + 工具行 + 完成行，带 shimmer 状态 | `ReasoningTimeline` | `ProcessGroup` 过程时间轴（等价） | 已等价 |
| 7 | **流式渲染按 token/句子/CJK 边界切分逐段显现** | `StreamingMarkdownContent` | 逐字/逐块流式 | 可借（CJK 边界对中文观感提升明显）。P2 |
| 8 | **Agent Mode 实时镜像预览 + 光标回放**（坐标归一化 0..1000） | `AgentModePreviewPanel` / `AgentModeCursor` | 无 | **语义改写**：用于「浏览器控制」的操作回放。P2 |
| 9 | **会话抽屉行的三态**（运行中 / 未读完成 / 待处理输入摘要） | `DrawerSessionRow` | `SessionSidebar` 五态（更细） | 已超过 |
| 10 | **设置 hub 卡片分组** + 32 个设置页 | `SettingsScreen.kt` | 13 分节左导航；`62-settings-layout.html` 已是提案 | 已提案，待裁定 |
| 11 | **Showcase 演示模式**：脚本化对话回放，播放/暂停/0.5–5x | `scripts/showcase/` | 无 | **对设计体系直接有用**：画板里的「真实 demo」可以用同一思路做。P1 |
| 12 | **PlatformCapabilities 单点声明**平台差异 | `PlatformCapabilities` | `hooks/useIsMobile.ts` 三断点 + 散落判断 | 可借：把「哪些功能在 PWA 端不可用」集中声明。P2 |
| 13 | 分支切换 `‹ n/m ›` | `UserMessageBranchSwitcher` | `BranchNavigator` | 已等价 |
| 14 | 三层扩展内核（Script API / Native Mod / DEX 热插拔） | `AetherModKernel.kt` | 无 | **不可移植**（Android DEX） |

### 2.2 Aether 明确没有的（不要以为它比我们全）

- 无 Web/PWA、无桌面端（README 宣称的 macOS 实际是 iPad 模式）
- 无应用内 Git 面板、**无独立 diff 视图**（只在工具卡里高亮 oldText/newText）
- 无账单/计费
- 无独立 To-Do/计划面板
- 无全局搜索、无工作流

---

## 3 · 缺口总表（只列我们缺的，按优先级）

| 优先级 | 缺口 | 来源 | 可移植性 | 落点 |
|---|---|---|---|---|
| **P0** | **全局搜索（Command Center）** | ZCode | 形状可抄 + 索引需重写 | 新画板 |
| **P0** | **设备预览面板**（iPhone/Android 框渲染产品页） | ZCode 模拟器语义改写 | 形状可抄 | 新画板 + PWA 设计工具 |
| **P1** | 定时任务：运行历史 / 状态筛选 / 模板目录 | ZCode | 形状可抄 | 画板 44 |
| **P1** | 模型元数据编辑 + 拖拽排序 + 模板选择器 | ZCode | 形状可抄 | 画板 41 |
| **P1** | 用量：热力图 + 工具用量 + 错误率/TTFT | ZCode | 形状可抄 | 画板 45 |
| **P1** | 浏览器：元素拾取 + 响应式视口 | ZCode | 形状可抄 | 画板 31 |
| **P1** | 扩展 slot 声明表（能往哪儿挂） | Aether | 需设计 | 新画板 |
| **P1** | PWA 端整页覆盖（现在只有 1 张画板） | 用户需求 | 新设计 | PWA 画板组 |
| **P2** | 插件商店形态（卡片网格 + 详情 + 分类） | ZCode | 形状可抄 | 画板 43 |
| **P2** | 拖会话到窗格 | ZCode | 形状可抄 | 画板 01 |
| **P2** | 队列暂停/恢复横幅 | ZCode | 需重写状态机 | 画板 20 |
| **P2** | 选中代码 → 引用附件 | ZCode | 形状可抄 | 画板 20 |
| **P2** | 消息级统计浮窗 | Aether | 形状可抄 | 画板 53 |
| **P2** | 流式 CJK 边界切分 | Aether | 需重写 | 动效画板 05 |
| **P3** | 多步计划进度时间线（不做工作流引擎） | ZCode | 需重写 | 画板 12 |
| **—** | 电脑控制（CUA） | ZCode | **不做**（它自己也是占位） | — |
| **—** | 工作流引擎 | ZCode | **不做**（过重） | — |
| **—** | 资源仪表盘（CPU/内存） | ZCode | **不做**（Web 无进程概念） | — |
| **—** | Aether 三层扩展内核 | Aether | **不做**（Android DEX） | — |

---

## 4 · 一句话结论

- **ZCode 里真正值得抄的是「界面形态」**：商店卡片、Command Center 搜索浮层、统计图表、队列面板。它的后端（SQLite 调度器、TS 工作流沙箱、CDP 进程、原生 Helper）**一条都搬不过来**，也不用搬。
- **用户点名的「模拟 iOS / Android」在 Web 产品里的正确等价物是「设备预览面板」** —— 它同时是设计 PWA 那套体系的必要工具，一次投入两处受益。
- **Aether 的价值在「触屏上 pi 该怎么长」的形态答案**，不在代码。它的扩展 slot 体系与 Showcase 演示模式是最值得借的两件。
- 缺口里 **P0 只有两件**（全局搜索、设备预览），其余是「已有功能补齐形态」。
