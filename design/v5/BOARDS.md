# V5 画板总清单（49 张）· 一板一页面 · 设置一律弹窗

> **编号唯一**（2026-10-04 重整：两波并行曾把 D-11~D-20 编重，现已按类别重排并同步所有交叉引用）。
> 基准是**产品真实有的页面与功能**（`SettingsPanel.tsx` 的 11 个分节、`app/api/**` 85 条路由、`components/**` 60+ 组件）。
> **2026-10-04 产品对账修订**：删除产品没有的三张提案板（D-14 插件商店、D-18 定时模板/错峰执行、
> D-31 移动模拟器——板上自称「产品已有 SimulatorPanel」经查不存在）；
> D-23 / D-24 / D-25 / M-08 改画产品真实功能（浏览器视口、零项目首屏、计划文档卡+队列、手机搜索与补全）；
> 其余各板删除了画了但产品没有的控件（侧栏过滤 tab、Git 提交/推送按钮、队列暂停、审批「永远拒绝」等），
> 并把「产品有但没画」的真实能力补进对应板。
> 机器可读版：`manifest.json`（由 `check-v5.mjs` 从画板自身抽取）；带缩略图的集合页：`index.html`。

## 一 · 核心六张（工作台 / 转录 / 右栏 / 查看器）

| 画板 | 页面 | 落地到 |
|---|---|---|
| `D-01-workbench.html` | 工作台 · 新会话（起步卡填完整指令、草稿续写） | `fork/NewSessionHome` |
| `D-02-sidebar-topbar.html` | 侧栏与顶栏（项目树、会话三态、动作 ⋯、折叠导轨） | `SessionSidebar` `TopBarPopovers` |
| `D-03-transcript.html` | 转录全集（过程时间轴、工具卡、代码、diff、失败重试、未读分割） | `MessageView` `ProcessGroup` |
| `D-04-composer.html` | 输入框与全部浮层（模型/思考/工具/权限、@ /、队列、上下文环） | `ChatInput` `ModelSelector` |
| `D-05-right-panels.html` | 右栏四面板 + 调用轨迹页签 | `ExplorerPanel` `TerminalPanel` `BrowserPanel` `GitGraphTab` |
| `D-06-file-viewer.html` | 文件查看器（源码 / 预览 / diff / 图片 / Office / ZIP / 不支持） | `FileViewer` `CodeFileEditor` |

## 二 · 设置 · 14 张

> **两种宿主都要画**（2026-10-04 用户裁定）：
> - **整页宿主 = 产品现状**：`SettingsPanel` 直接挂在 AppShell 里，结构是 页头（title/sub + 动作）+ 工具栏 + 内容区，
>   对应 `SettingsPage` 的契约（`components/SettingsUi.tsx`）。`D-07` 帧 A/B/C 画的就是它。
> - **弹窗宿主**：深链进入（⌘K → 设置）、窄屏、需要「不丢当前会话上下文」时用。
>   结构是 `.d-modal.is-open` + `.d-modal-box.wide` + `.d-set`，弹窗限高 + 内容区内部滚动。
>   `D-07` 帧 D 画的就是它。
> **内容与左导航两宿主共用同一份**，不许为弹窗另写一套。

| 画板 | 分节 / 子视图 | 落地到 |
|---|---|---|
| `D-07-settings-general.html` | 设置壳 + 分节导航 + 通用（主题、声音、回车、重试、预算） | `SettingsPanel` |
| `D-08-settings-models.html` | 模型：供应商、认证四态、配额、收藏、成本档 | `ModelsConfig` |
| `D-09-settings-model-advanced.html` | 模型高级：Header / UA / 兼容预设 / 上下文与输出上限 | `ModelsConfig` 高级区 |
| `D-10-settings-enabled-models.html` | 启用模型：白名单 pattern + thinking 钉 + 失配诊断 | `EnabledModelsSection` |
| `D-11-settings-skills.html` | 技能：已加载、开关、搜索安装、内容查看、默认技能 | `SkillsConfig` |
| `D-12-settings-agents.html` | 子代理：总开关、profile、工具白名单、`ext:` 解析 | `AgentsConfig` |
| `D-13-settings-plugins.html` | 插件：已装、启用、检查更新、禁用、卸载、手填来源添加 | `PluginsConfig` |
| `D-15-settings-mcp.html` | MCP：server 列表、编辑、粘贴解析、连接目录、登录、日志 | `McpConfig` `McpCatalog` |
| `D-16-settings-mcp-exposure.html` | MCP 工具曝光四档 + 代码模式设置 | `McpCodemodeSettings` |
| `D-17-settings-automation.html` | 定时任务：列表、编辑器（含活跃时间窗）、运行历史、跳过原因 | `fork/AutomationPanel` |
| `D-19-settings-usage.html` | 用量：统计卡、热力图、模型占比、每日 token、项目 | `fork/UsageStatsPanel` |
| `D-20-settings-phone-push.html` | 手机与推送：LAN、扫码、配对码、IM、机器人渠道 | `fork/PhoneAndPushPanel` |
| `D-21-settings-archive-import.html` | 归档 / 导入 / 快捷键地图（只读） | `ProjectArchivePanel` `ImportPanel` `ShortcutGuideDialog` |

## 三 · 新增能力（5）

| 画板 | 页面 | 落地到 |
|---|---|---|
| `D-22-command-center.html` | 全局搜索 ⌘K（chips 全部/命令/会话/文件 + 最近搜索） | `fork/CommandPalette` |
| `D-23-browser-viewport.html` | 浏览器视口与缩放（预设 390/768/1024/1280 · 自由宽高 · 缩放档） | `BrowserPanel` 视口区 |
| `D-24-empty-state-guide.html` | 零项目首屏与每日工作目录（三条起步路径 · 首次信任） | `fork/EmptyStateGuide` |
| `D-25-plan-queue-slots.html` | 计划文档卡、队列两态（引导/追加）、扩展小部件 | `fork/PlanDocumentCard` `ExtensionWidgets` |
| `D-26-dialogs-states.html` | 对话框与系统态（模态、确认、Toast、横幅、空/载/错） | — |

## 四 · 系统态与动效（4）

| 画板 | 页面 |
|---|---|
| `D-27-motion.html` | **动效总台**：输入框环绕光带 + 四态思考指示器（波/绕心/星/彗星） |
| `D-28-motion-feedback.html` | 动效 A · 进入与反馈（流光、数字、翻卡、标签交换、描边、按压、焦点环） |
| `D-29-motion-containers.html` | 动效 B · 容器与转场（浮层、抽屉、面板、页签下划线、错峰、骨架、列表增删） |
| `D-30-keyboard-focus.html` | 键盘与焦点（焦点环宿主、Tab 序、Esc 四层阶梯、快捷键冲突） |

## 五 · PWA · 完整页面（11）

| 画板 | 页面 |
|---|---|
| `M-01-conversation-drawer.html` | 会话页 + 抽屉（项目/聊天分段）+ 模型选择 |
| `M-02-transcript.html` | 转录（折叠过程、代码横滚、附件格、横滚表格） |
| `M-03-composer-sheet.html` | 输入卡（附件、四块能力浮层、@ / 补全、队列） |
| `M-04-sessions-drawer.html` | 会话抽屉整页（搜索、项目分组、行动作） |
| `M-05-settings.html` | 设置 11 分节（响应式）+ 分节二级页 |
| `M-06-files-terminal.html` | 文件树 / 查看器 / 终端 |
| `M-07-browser-cc.html` | 浏览器（地址栏、视口预设、元素拾取、三态） |
| `M-08-search-completion.html` | 手机搜索与补全（抽屉搜索 · @ 文件 · / 命令 · 输入历史） |
| `M-09-plugins-cron-usage.html` | 插件添加 / 定时任务 / 用量 |
| `M-10-install-update-trust.html` | 安装 · 更新说明 · 离线兜底 · 目录信任 |
| `M-11-gestures-states.html` | 手势 · 触控规格 · 系统态九宫格 · 四种反馈 |

## 六、三条硬约束

1. **禁止装饰性左侧彩色边线**（用户明确不喜欢）：层级靠底色 / 徽章 / 圆点 / 图标表达。
   `check-v5` 直接拦 `border-left` / `inset` 竖线。
2. **设置两种宿主都要有**：整页（产品现状，页头 + 工具栏 + 内容区）与弹窗（深链/窄屏）。
   内容共用一份；弹窗必须限高 + 内部滚动。
3. **一板一页面**：一张板只管一件事，落地时一批只换一个组件。
4. **编号唯一**：新增板先查 `ls web/boards | cut -c1-5 | sort | uniq -d` 没有重号再动手。