# Pi Web 换肤计划 · 第二轮（组件矩阵版）

日期：2026-09-29 · 基准：`design/pi-web-design/`（29 张画板 + DESIGN-SPEC + DIVERGENCE + tokens.css/board.css/icons.js）
对象：全站剩余未换肤面 + 功能增补 + 冲突裁定 + 验收协议
拆分：**7 个批次 / SW-00 ~ SW-17**，每批一个意图、可独立 revert
前置文档：`docs/design-system-refactor-plan-2026-09-28.md`（第一轮，PR-01~28）

---

## 0 · 第〇原则：禁止截图模仿

**每个组件的替换只有一条路：打开定义它的画板 HTML，原样复制那段 DOM。**

- 类名、层级、`<i data-ico="…">` 一字不动地搬进产品组件；
- 然后把产品数据与事件接上去（React 状态 → className 布尔、onClick/onKeyDown 接回）；
- 产品侧 CSS **只**做 UA 归零、cursor、窄屏语义（fork-ui.css 末尾的接线块），不重复写画板里已有的任何颜色/尺寸/间距。

验收同样不看"长得像不像"：截图只做存证，判定靠 **structdiff**（画板与产品 DOM 各自归一化成 `tag + pw-* + data-ico` 签名逐节点 diff）和**几何对数**（同一选择器在画板页与产品页各取 `getBoundingClientRect`，逐项对数）。历史上所有翻车（错行、竖线断截、模型名压瘪）都发生在"凭视觉理解仿写"的路线上，此路已封。

---

## 1 · 定位与两套编号

### 1.1 与第一轮计划的关系

第一轮（`design-system-refactor-plan-2026-09-28.md`，PR-01~28）的改造对象是**token 层**（颜色桥接、尺度收敛、字阶归并、动效 token），已全部落地；其中 PR-13 的「输入框下要不要第二条横条」冲突，已于 2026-09-29 第十轮由用户裁定（**统计收进上下文环浮窗，长条删除**，DIVERGENCE 50）。

第一轮完成之后，路线又前进了两步（DIVERGENCE F/G/48/50 轮）：

1. **F 轮**：放弃"桥接仿写"，`app/layout.tsx` 直接引入 `design/pi-web-design/assets/tokens.css + board.css`，产品 DOM 挂画板 `pw-*` 类——**画板原件零修改进运行时**；
2. **G 轮起**：从"给现有 DOM 加类"升级为"**照画板的 DOM 结构原结构替换**"（侧栏壳、过程时间轴、composer 三段结构、环浮窗等 32+ 组件已按此重写）。

本文档是这条路线的**收尾计划**：把矩阵里剩余的 ✗/◐ 项清完，补上设计画了而产品没有的功能，裁决两处冲突。

### 1.2 样式引入顺序（现状，换肤的物理前提）

```
katex → design/pi-web-design/assets/tokens.css → app/design/tokens.css(--ds-*)
→ app/globals.css(2947 行, 内含 boardui/theme.css 867 行) → app/settings.css(1876)
→ app/wallpaper.css(250) → design/pi-web-design/assets/board.css(1265, 233 个 pw- 类)
→ icons.js(243 图标, PwIcons.tsx 水合) → app/fork-ui.css(2378, 永远最后)
```

board.css 在产品样式之后：同特异性下**画板规则覆盖产品规则**。产品侧要覆盖画板时用 0-2-0 双类选择器（如 `.chat-input-shell.pw-composer`），与引入顺序无关。

### 1.3 两套编号对照

| 本计划 | 含义 | 旧计划对应 |
|---|---|---|
| SW-00 | git 快照（硬前置） | — |
| SW-01~03 | 批次 A · 弹层与菜单 | PR-14 的未尽部分 |
| SW-04~06 | 批次 B · 文件查看器全套 | PR-15/16 的未尽部分 |
| SW-07~13 | 批次 C · 设置 13 分节 | PR-17~24（当时只做了 token 对齐，本轮照画板重写 DOM） |
| SW-14~15 | 批次 D · 顶部面板与小件 | PR-09/12 的未尽部分 |
| SW-16 | 批次 E · 功能增补 | 新增 |
| SW-17 | 批次 F · 门禁与收尾 | PR-28 的延续 |

代码标记沿用现有体系：`fork:design-system SW-NN`（计划接线点）+ `fork:design-components`（画板原件直用）+ `fork:<slug>`（功能补丁）。

---

## 2 · 组件清单矩阵（主体）

现状四档：**✅ 已直接引用画板原件 / ◐ 部分或仅挂类 / ✗ 未接（本轮工作量） / ⊘ 登记不改**。
"证据"列是 2026-09-29 实测（grep/量测），不是估计。

### 2.1 基础原子（10 项）

| 组件（画板类） | 画板 | 产品宿主 | 现状 | 证据 / 落点 |
|---|---|---|---|---|
| 按钮四态 `pw-btn(.primary/.outline/.danger/.sm)` | 00 | ChatInput/MermaidBlock/SessionSidebar 等 | ✅ | — |
| 图标按钮 `pw-iconbtn(.sm/.is-on)` | 00/01 | AppShell/SessionSidebar/FileExplorer/ExplorerPanel 等 | ✅ | — |
| 徽章 `pw-badge(.ok/.warn/.bad/.accent/.count)` | 01/12 | MessageView/ProcessGroup/SessionSidebar/TodoChip | ✅ | — |
| 图标 `pw-ico` + `<i data-ico>`（243 个 lucide） | 全部 | PwIcons.tsx 水合 + 全站 | ✅ | 顶栏手绘 SVG 已清零（50 轮） |
| 键位 `pw-kbd` | 00 | NewSessionHome/权限卡 | ✅ | — |
| 芯片 `pw-chip(.accent)` | 20 | ChatInput 引用上下文条/TodoChip | ✅ | — |
| 顶栏芯片 `pw-chipbtn` | 01/02 | AppShell（运行中/工作区/main） | ✅ | — |
| 状态点 `pw-dot(.unread)` | 02 | SessionSidebar | ✅ | — |
| 分段 `pw-seg` | 02 | SessionSidebar（项目/聊天） | ✅ | — |
| 分组标题 `pw-group-title` | 02 | SessionSidebar | ✅ | — |

### 2.2 壳（8 项）

| 组件 | 画板 | 产品宿主 | 现状 | 证据 / 落点 |
|---|---|---|---|---|
| 三栏壳 `pw-app(.with-panel)` | 01 | AppShell | ✅ | — |
| 侧栏五段 `pw-side(-head/-nav/-search/-scroll/-foot)` | 01/02 | SessionSidebar（G-38 重写） | ✅ | — |
| 品牌行 `pw-brand/pw-logo` | 02 | SessionSidebar | ✅ | favicon/桌面图标仍是渐变 logo，见 6.3 |
| 会话行六态 `pw-session(.child/.running/.awaiting/.is-on)` + `pw-body/pw-t/pw-m/pw-await/pw-acts` | 02 | SessionSidebar + ChatWorkspaceRow | ✅ | 运行扫掠线/awaiting 底线由 fork-ui.css 承载（⊘ 同源登记） |
| 折叠导轨 `pw-rail` 系 | 02 | SessionSidebar（zn-13） | ✅ | — |
| 顶栏 `pw-topbar/pw-tb-title` | 01/02 | AppShell | ✅ | — |
| 空态首屏 `pw-empty/pw-empty-inner/pw-starters/pw-starter` | 01 | fork/NewSessionHome | ✅ | EmptyStateGuide 本体仍 inline（24 处）→ SW-15 |
| 工作区对调 | 02 | AppShell（workspaceSwapped） | ✅ | 对调钮图标已换 columns-2（50 轮） |

### 2.3 转录（13 项）

| 组件 | 画板 | 产品宿主 | 现状 | 证据 / 落点 |
|---|---|---|---|---|
| 用户气泡 `pw-msg-user` | 10 | MessageView | ✅ | — |
| 助手富文本 `pw-md` | 10 | MarkdownBody | ◐ | 表格已 pw-table；markdown-\* 仍有 **102 条**规则在 globals.css → SW-15 |
| 过程时间轴 `pw-proc/pw-proc-head/pw-proc-body/pw-step*` | 11 | ProcessGroup（G-40 按画板 DOM 重写） | ✅ | — |
| 工具卡 `pw-card/pw-card-head/pw-tool/pw-path` | 11 | MessageView | ✅ | 收起态保持时间轴行形态 |
| diff 卡 `pw-diff-body/pw-diff-line(.add/.del)` | 11 | MessageView | ◐ | 行内/分栏已接；**词级视图自有实现 ⊘**（`--diff-*` 同源）；"在文件面板定位"悬浮动作未接 → SW-15 |
| 权限卡 `pw-perm*`（唯一强调色边框卡） | 12 | MessageView + ChatWindow 扩展请求 | ✅ | — |
| 计划卡 `pw-todo(.done/.now)` | 12 | fork/TodoChip | ✅ | — |
| 压缩卡 `pw-compact` | 12 | MessageView | ✅ | — |
| 子代理卡 `pw-sub`（唯一 2px 左强调线） | 11 | —（产品以工具卡徽标呈现） | ⊘ | DIVERGENCE 37：呈现形态等价，登记不改 |
| 终端卡 `pw-term` | 11 | TerminalPanel + MessageView | ✅ | — |
| 回合结束行 `pw-turn-end`（七种 stopReason 分色） | 12 | MessageView | ✅ | pi 词表 pending/stop/length/toolUse/error/aborted/deferred |
| 通知条 `pw-toast(.bad/.warn/.ok)` | 12/50 | ChatWindow NoticeShelf | ✅ | 最多 3 条、6s 自收 |
| 内容块六分支（图片/resource_link/音频/不可渲染/embedded text/退回文件卡） | 12 | MessageView ContentBlock 渲染 | ✗ | 画板 12 的分支形态未逐一对齐 → SW-15 |

### 2.4 内容块（5 项）

| 组件 | 画板 | 产品宿主 | 现状 | 证据 / 落点 |
|---|---|---|---|---|
| 代码块 `pw-code/pw-code-head/pw-code-body` + Copy→Copied | 10 | MermaidBlock CodeBlock | ✅ | — |
| GFM 表格 `pw-table` | 10 | MarkdownBody | ✅ | — |
| 数学公式（KaTeX 容器） | 10 | MarkdownBody | ◐ | KaTeX 已引入；容器对齐画板待核 → SW-15 |
| Mermaid 图/源码两态 + 渲染失败退化 + 全屏缩放 | 10 | MermaidBlock | ◐ | 图/源码两态已有；**全屏缩放查看器未做**（DIVERGENCE 22 漏画补回项）→ SW-15 |
| frontmatter 卡 | 52 | MarkdownFilePreview | ✗ | markdown-frontmatter-\* 旧类 → SW-15 |

### 2.5 输入框（7 项）

| 组件 | 画板 | 产品宿主 | 现状 | 证据 / 落点 |
|---|---|---|---|---|
| 三态 composer `pw-composer/pw-composer-top/pw-composer-bar` | 20 | ChatInput（G-41 三段结构） | ✅ | 空闲/流式停止/无项目禁用；compact 阅读态与 bash 边框为产品状态覆盖 |
| 附件/引用芯片行 `pw-chips` | 20 | ChatInput protrusion | ✅ | — |
| token 高亮层（@文件/@会话/@MCP/@待办 // 命令着色） | 20 | ChatInput highlight-wrap | ◐ | 结构已有；与画板 20 的着色分档逐项对表 → SW-15 |
| 控件 `pw-select`（思考/权限/工具档/压缩/模型） | 20/21 | ChatInput ×4 + ModelSelector | ✅ | — |
| 发送/停止 `pw-send(.stop/.disabled)` | 20 | ChatInput | ✅ | — |
| 上下文环 `pw-ring(.warn/.bad)` + 浮窗 `pw-pop`（**点击钉住 + /session 入口**） | 01帧C/20 | ChatInput contextRing | ✅ | 50 轮升级为完整会话明细（SessionStatsDetails）；常显统计条已删除 |
| 流式排队（N 条排队徽章/召回编辑/逐条移除/立即发送） | 20 | ChatInput queueControls | ✅ | 徽章形态对画板待核 → SW-15 |

### 2.6 弹层与菜单（6 项）

| 组件 | 画板 | 产品宿主 | 现状 | 证据 / 落点 |
|---|---|---|---|---|
| 弹层体系 `pw-pop/pw-pop-search/pw-pop-title/pw-prow(.is-on/.pw-desc)/pw-sep`（320 宽/圆角 6/单一阴影） | 21 | ChatInput/SessionSidebar/PortalDropdown | ✅ | 统一宽 320、搜索钉顶、分组小标题的**行类型对表**未做全 → SW-01 时一并对 |
| 模型选择器（搜索+分组+Latest/订阅徽章） | 21 | ModelSelector | ✅ | 徽章/分组形态待核 → SW-01 |
| @ 引用四类菜单 + / 命令菜单（按来源分组） | 21 | ComposerReferenceMenu + ChatInput | ✗ | anim-popover + inline，未接 pw-pop → **SW-02** |
| 模态 `pw-modal/pw-modal-head` | 50 | SettingsPanel/扩展请求/ChatWindow | ✅ | 二次确认（危险主按钮 error 填充）未统一 → SW-03 |
| 扩展请求对话框四种（select/confirm/input/editor + 倒计时） | 50 | ChatWindow ExtensionDialog | ✅ | 倒计时条待核 → SW-03 |
| 项目信任三态 | 50 | ProjectTrustDialog | ✗ | 纯 inline ×12 → **SW-03** |

### 2.7 右栏面板（7 项）

| 组件 | 画板 | 产品宿主 | 现状 | 证据 / 落点 |
|---|---|---|---|---|
| 面板三段 `pw-panel/pw-panel-head/pw-panel-body` | 01帧C | AppShell/ExplorerPanel | ✅ | 分栏态树列保留自己头行（⊘ 49 条形态差异） |
| 标签条 `pw-tabs/pw-tab(.x)` + 溢出折叠 + 标签概览 | 31/51 | TabBar | ✅ | 指示器动效仍 fork-tab（同源） |
| 文件树 `pw-trow(.indent-*)` + 改动列表钉顶 + 工具栏七动作 | 30 | FileExplorer/ExplorerPanel | ◐ | 行已 pw-trow；改动列表钉树顶、工具栏动作集合未对画板 → SW-04 |
| 查看器六形态 `pw-viewer/pw-viewer-head/pw-viewer-body`（源码/图片/冲突/已删除/空态/CSV） | 30/52 | FileViewer | **✗ 全套未接** | file-viewer-\* **31 条** + 74 inline，0 个 pw 类——**最大遗留面** → SW-04/05 |
| 可编辑源码（未保存/保存冲突三动作/页脚定位） | 52 | CodeFileEditor | ✗ | CodeMirror 自有主题 → SW-06 |
| Git 图泳道 `pw-git`（44px 泳道） | 31 | GitGraphTab（自绘 SVG） | ⊘ | DIVERGENCE 37：lane 色已从 --accent 派生，登记不改 |
| 应用内浏览器（地址栏+视口预设） | 31 | BrowserPanel | ✗ | 10 inline → SW-06 |

### 2.8 设置（6 项，13 分节 · 用户已裁定全量照画板重写）

| 组件 | 画板 | 产品宿主 | 现状 | 证据 / 落点 |
|---|---|---|---|---|
| 设置壳 `pw-settings` + 模态头 + 关闭钮 | 40 | SettingsPanel | ✅ | 左导航 13 分节（lib/settings-navigation.ts）形态未对画板 → SW-07 |
| 分节内容（常规/模型/技能/子代理/插件/MCP/定时/记忆/快捷键/用量/命令/归档/导入） | 40~46 | SettingsPanel + 13 个分节组件 | **✗ 全部** | config-\* **43 选择器/95 引用** + settings-\* **68 选择器**；零 inline 纪律 → SW-07~12 |
| 表单控件（input/switch/slider/录制态/下拉） | 40~45 | SettingsUi（ConfigButton/SettingsSlider）+ fork-ui zn-15 | ✗ | → SW-07 先做控件基件，后续分节复用 |
| 用量九卡五图（图表只用三色） | 45 | fork/UsageStatsPanel + usage-charts | ✗ | 14 inline → SW-12 |
| 皮肤条 + 皮肤工作室（四色留空继承 + 实时预览 + CSS 校验） | 47 | ThemeSkinStudio + ThemeSkinStrip | ◐ | 保留并**约束输出到 token 槽位**（6.2 裁定）；对话框形态接 pw-modal → SW-13 |
| 壁纸选择器（内置/本机） | 47 | WallpaperSettings/BuiltinWallpaperPicker | ✗ | wallpaper.css 250 行保留（功能），选择器接画板 → SW-13 |

### 2.9 全局（4 项）

| 组件 | 画板 | 产品宿主 | 现状 | 证据 / 落点 |
|---|---|---|---|---|
| 菜单原子表（八种行 + 结构件 + 子菜单，长菜单带搜索头） | 51 | ContextMenu（全局右键） | ✗ | context-menu-\* **13 条**(globals) + 3 条(fork-ui) → **SW-01** |
| 新建任务选择器 | 51 | NewTaskPicker | ✗ | 17 inline → **SW-03** |
| worktree 切换器（切换/过滤/新建/移除强制确认） | 61 | SessionSidebar | ◐ | 已 pw-pop（Portal 化）；「未提交改动强制确认」的确认形态对画板 → SW-03 |
| 拖放落区（可接受/拒绝/拖到输入框 + 四条规则） | 61 | ChatWindow | ◐ | 已有；形态与四条规则文案对画板 → SW-15 |

### 2.10 移动端（4 项）

| 组件 | 画板 | 产品宿主 | 现状 | 证据 / 落点 |
|---|---|---|---|---|
| 抽屉侧栏 + 遮罩 | 60 | AppShell/SessionSidebar | ✅ | — |
| 覆盖式工具条（更多控件，不是底部条） | 60 | AppShell mobile toolbar | ✅ | 与桌面同构（用户裁定） |
| 安装提示（分平台） | 60 | PwaRegistration | ◐ | 分平台文案/图标待对画板 → SW-16 |
| **移动端信任横幅**（不弹模态框） | 60 | —（产品没有） | **✗ 新功能** | DIVERGENCE 17 → **SW-16** |

### 2.11 辅助（3 项）

| 组件 | 画板 | 产品宿主 | 现状 | 证据 / 落点 |
|---|---|---|---|---|
| 迷你地图 `pw-minimap-rail/pw-minimap-pop`（36 导轨 + 320 浮层 + 图钉） | 53 | ChatMinimap（module.css 自绘 412 行） | ✗ | 画板类未接入；**标题节点 muted 需回合 kind 字段**（29 条）→ SW-15 |
| 等待首 token 阶段行（四相位） | 05/53 | ChatWindow PhaseRoll | ✅ | — |
| 项目芯片/待办芯片/回合写过的文件/GitRef 芯片 | 53 | ComposerContextStrip/TodoChip/TurnWrittenFiles/GitRefChips | ◐ | TurnWrittenFiles ✗ inline；其余 ◐ → SW-15 |

### 2.12 动效（1 族 17 项）

| 组件 | 画板 | 产品宿主 | 现状 | 证据 / 落点 |
|---|---|---|---|---|
| 十一 token + 五类转场 + 轻量交互五条 + 17 项清单 | 05 | app/\*.css + 组件 | ◐ | token 已全量落地（PR-05/27）；17 项逐项对表 + reduced-motion 停终态核查 → SW-17 |

**矩阵小结**：共 **74 行**——✅ 45 / ◐ 12 / ✗ 15 / ⊘ 2。✗ 与 ◐ 的宿主即批次 A~F 的全部工作量；⊘ 项（子代理卡、Git 图泳道，及行内注记的 diff 词级、会话行扫掠线）有 DIVERGENCE 登记背书，本轮不动，收尾时复核一次。

---

## 3 · 批次计划

> 每批交付：代码（照第 4 章四步法）+ 测试守卫更新 + 验收记录（六件套，见 4.4）+ DIVERGENCE 当场登记。每批一个 commit，信息格式 `refactor(skin): SW-NN <名称>`。

### SW-00 · git 快照（硬前置，先于一切）

**为什么**：当前全部换肤成果（约 80 个改动文件，含九、十轮的 AppShell/ChatInput/ChatWindow/SessionSidebar/MessageView 等 + 9 项 untracked：`design/` 整个设计系统、`components/PwIcons.tsx`、`scripts/check-motion-tokens.mjs`、`scripts/check-style-literals.mjs`、两份 09-28 计划文档、`docs/screenshots/`、`app/design/`、`.scratch/`）都悬在工作区里未提交，任何一次误操作都无法回滚。执行时以当天 `git status` 实数为准。

**做什么**：
1. `.scratch/` 加入 `.gitignore`（一次性量测脚本不入库，但先把脚本用法备份到本文档 8.1 与 `design/pi-web-design/scripts/`）；
2. 分两个 commit：① `feat(skin): 设计系统资产与门禁脚本入库`（design/、PwIcons、scripts/check-\*、app/design/tokens.css）；② `refactor(skin): 第九/十轮换肤成果`（其余 78 个改动文件）；
3. 打 tag `skin-snapshot-2026-09-29`。

**验收**：`git status` 干净；`npm test` 2233/2233。

### 批次 A · 弹层与菜单（SW-01~03，对应画板 21/50/51）

- **SW-01 ContextMenu 全局右键菜单** → 画板 51 菜单原子表：八种行类型（普通/勾选/带子菜单/危险/error 色/描述行/快捷键行/搜索头）逐行接 `pw-pop/pw-prow/pw-sep/pw-desc/pw-kbd`；退役 globals `context-menu-*` 13 条 + fork-ui 3 条。顺带把模型选择器的 Latest/订阅徽章、分组小标题对表画板 21。
- **SW-02 @ 引用菜单 + / 命令菜单 + SessionSearch** → 画板 21：`pw-pop` + `pw-pop-search` 钉顶 + `pw-prow(.is-on)` + 分组小标题；@ 四类（文件/会话/MCP/待办）与 / 命令（内置/自定义/技能）分组标题照画板；退役 anim-popover inline。注意：这些浮窗开在 composer 上方，沿第九轮结论必须逃逸 `pw-composer` 的竖向裁切（`overflow-y: visible` 已就位，回归用浮窗审计脚本）。
- **SW-03 对话框三件 + worktree 确认** → 画板 50/51/61：NewTaskPicker（17 inline）→ `pw-pop` 菜单形态；ProjectTrustDialog（12 inline）→ 画板 50 三态（确认/信任中/失败）；DirectoryPicker 自绘降级态（主路径已是系统原生，画板不画系统对话框）；worktree「未提交改动」强制确认 → 二次确认形态（危险动作用 error 填充主按钮）。

### 批次 B · 文件查看器全套（SW-04~06，对应画板 30/52——最大遗留面）

- **SW-04 查看器头行 + 源码态** → 画板 30：`pw-viewer/pw-viewer-head/pw-viewer-body`（图标 + mono 路径 + 格式徽章 + 已改动徽章 + 动作钮 `pw-iconbtn.sm`）；file-viewer-\* 31 条逐条退役；文件树改动列表钉树顶 + 树工具栏七动作对画板。
- **SW-05 查看器分支形态** → 画板 30/52：与 HEAD 对比**覆盖层**（头部按钮 → 整内容区换只读 diff + 顶部横幅 + 返回源码）；文件已删除提示；外部改动冲突三动作；空态；图片缩放预览（工具栏四样）；滚动淡出遮罩。
- **SW-06 编辑器与特化预览** → 画板 52：CodeFileEditor 的 CodeMirror 主题对齐 token（未保存改动/保存冲突/页脚定位信息）；CsvPreview 真表格（pw-table）；MarkdownFilePreview（pw-md）；PathActions 统一路径动作菜单（画板 53）；AttachmentPreview 六分支（画板 54）；BrowserPanel 地址栏 + 视口预设（画板 31）。

### 批次 C · 设置 13 分节（SW-07~13，对应画板 40~47 · **用户裁定：全量照画板重写**）

> 基件先行：SW-07 先把画板 40 的表单控件基件（输入/开关/滑块/下拉/行卡片）做成 `components/SettingsUi` 的 pw 版，之后每个分节只做 DOM 替换，避免六次重复。
> 纪律：SettingsPanel 有「零 inline style」守卫，全部走类。

- **SW-07 设置壳左导航 + 常规分节** → 画板 40：13 分节导航形态；常规页（主题、皮肤条、壁纸、侧栏、通知五开关、字体、聊天、语言）。**无登录项**（用户裁定）。
- **SW-08 模型分节** → 画板 41：供应商列表+详情（订阅登录四态/用量摘要四小卡/模型启用/上游导入）、模型详情（能力/规格/成本/测试连接原始回显）。
- **SW-09 子代理 + 技能** → 画板 42：内置开关+并发上限+作用域分组+两栏编辑器；技能列表+SKILL.md 编辑+市场安装对话框。
- **SW-10 插件 + MCP** → 画板 43：插件包列表+资源清单；MCP Basic/JSON 双模式、环境变量打码、从其它 agent 导入（八来源+同名冲突 warning）、OAuth 授权流程。更新五态（画板 56）一并覆盖。
- **SW-11 定时任务 + 记忆** → 画板 44：新建任务表单（频率八选一/会话模式/通知策略）+ 任务列表 + 运行历史 +「错过一次」状态；记忆开关/工具逐条标注/记忆文件编辑（CronConfig 86 inline 是最大单件）。
- **SW-12 快捷键 + 用量 + 命令 + 归档 + 导入** → 画板 45/46：快捷键表（录制/冲突标色/保留键位）；用量九卡五图（图表只用三色）；自定义命令三段式；归档历史（恢复/彻底删除危险项）；导入四类资产页签（只读扫描/结果三色统计）。
- **SW-13 皮肤工作室 + 壁纸** → 画板 47：工作室对话框接 `pw-modal`（皮肤设置/自定义 CSS 两页签、四色留空表示继承、左侧实时预览、CSS 校验比对 token 规范）；壁纸选择器接画板。**功能保留、输出约束到 token 槽位**（6.2）。

### 批次 D · 顶部面板与小件（SW-14~15，对应画板 22/10/53/54）

- **SW-14 顶部面板两件**：SystemPromptPanel（token 计数+复制）、ToolDefinitionsPanel（左列表已启用/未启用 + 右详情；**参数表维持两列**，⊘ 29 条信息等价）——删除两个内嵌 `<style>`，全部走 pw 类。
- **SW-15 转录小件收尾**：ChatMinimap 接 `pw-minimap-rail/pw-minimap-pop`（36 导轨 + 320 浮层 + 图钉固定 + 加载更早），并给回合数据加 **kind 字段**实现标题节点 muted（29 条遗留）；Mermaid 全屏缩放查看器；MarkdownBody 的 markdown-\* 102 条逐条退役；token 高亮层对表；BranchNavigator 残余 inline；散件九个（TurnWrittenFiles/ComposerContextStrip/ProviderUsageSummary/EmptyStateGuide/拖放落区文案对表/排队徽章/KaTeX 容器）。

### 批次 E · 功能增补（SW-16，设计画了而产品没有——已裁定）

- **做**：
  - **移动端信任横幅**（画板 60，DIVERGENCE 17）：PWA standalone 下不弹模态框、顶部横幅说明信任来源；不违反「移动端与桌面同构」裁定（不是底部条）。
  - 迷你地图标题节点 kind（并入 SW-15，需先给回合数据加字段——纯前端派生，不动会话文件格式）。
  - 安装提示分平台（并入 SW-16）。
- **核实即闭环**：主题切换 view-transition 圆扩散（AGENTS.md 称 hooks/useTheme.ts 已有）——核查存在性与 reduced-motion 停终态，缺补。
- **不做**（理由见第 7 章）：agent 认证流程（画板 56 自标"设计提案"，产品已有供应商 API-key/OAuth 登录体系）；工具参数四列表格（两列信息等价，⊘ 29 条）。

### 批次 F · 收尾（SW-17）

- ⊘ 四项复核（子代理卡/Git 图/diff 词级/会话行扫掠线）——确认仍是"登记不改"的最优解；
- 动效 17 项逐项对表 + `prefers-reduced-motion` 全量停终态核查；
- `render-boards.mjs` 重渲 29 张基线 PNG 存档；全站 22 个页面态截图存新基线；
- DIVERGENCE 回填（本轮全部裁定与偏差）；AGENTS.md 增补本轮结论（组件矩阵位置、SW 编号、验收协议）；
- `npm run check:design` 四门禁接入 CI/提交流程固定化。

---

## 4 · 组件替换四步法（每个 ✗/◐ 项都走这四步）

### 4.1 ① 抄 DOM 原文
打开定义画板 HTML（矩阵「定义画板」列），找到该组件的片段，**原样复制**：类名、嵌套层级、`<i data-ico="…" data-size="…">`、状态类（`.is-on/.child/.running`）全部保留。产品里只改两处：静态示例文本换成数据、静态元素换成可交互元素（div→button/input 时保留类名，UA 归零在 fork-ui.css）。

### 4.2 ② 接数据与事件
- 状态映射：产品布尔 → 画板状态类（`is-on/is-open/.child/.running`）；
- 事件不进 CSS：hover/focus 行为留在 CSS（画板已有），点击/键盘在 React；
- 浮窗一律考虑**裁切与翻转**：宿主链上有 overflow 的（滚动容器/composer），要么 portal + fixed（SessionSidebar `PortalDropdown` 模式），要么确认 `overflow-y: visible` 链路（composer 模式）；下方放不下（<260px）才朝上（ModelSelector 规则）。

### 4.3 ③ 产品侧 CSS 纪律
- 画板值**一个都不重复写**；fork-ui.css 末尾接线块只做 UA 归零（button/input border/background/font）+ cursor + 窄屏语义；
- 需要覆盖画板时：双类 0-2-0 选择器（`.chat-input-shell.pw-composer`），并在注释里写明为什么覆盖、对应哪条台账；
- 改完顺手删 stale 规则（本轮 explorer-column 负 margin 教训：DOM 挪了，CSS 还在）。

### 4.4 ④ 验收六件套（每批全过才算完）
1. `node_modules/.bin/tsc --noEmit` 0 错；`npm run lint` 0 错；`npm test` 全绿（**源码守卫测试改成断言新结构**，不是删）；
2. **structdiff**：画板 vs 产品 DOM 签名 diff（`.scratch/structdiff.mjs` 模式）——组件级 0 结构偏差（产品状态类除外）；
3. **几何对数**：`.scratch/geom.mjs` 模式，关键选择器 board vs app 并排对数（1440×900 桌面 + 390×800 移动端）；
4. **浮窗裁切审计**：`.scratch/popover-audit.mjs` 模式——本批触发的每个浮窗，hover/点开，沿祖先链查 overflow 裁切 + 截图；
5. `npm run check:design`（style-literals + motion-tokens + check-boards + check-align 四门禁）；
6. 改了任何前景/背景色：`docs/codex-skin/check-contrast.mjs`（需服务在 30141）；全部截图存 `docs/screenshots/skin-swap-2026-09-29/`。

---

## 5 · 陷阱清单（每一条都真实翻过车）

| 陷阱 | 事故 | 对策 |
|---|---|---|
| 画板容器的 `overflow: hidden` | `.pw-composer` 裁圆角用的 hidden 把向上弹的环浮窗/下拉/@ 菜单整张裁掉（只剩一行露头） | 浮层宿主竖向必须 `overflow-y: visible`；横向可保留 `clip` |
| 左缘锚定的浮窗 | 320 宽下拉右缘锚定在左侧组触发钮上，探出卡片左缘 151px 被 `overflow-x: clip` 裁掉 | 左侧组浮窗一律左缘锚定；右侧组右缘锚定 |
| `min-width: 0` 链 | 逐层 min-width:0 让 flex 把模型芯片压瘪成「D…」 | 芯片按内容定宽 `flex: 0 0 auto`；真放不下走窄屏折叠形态（容器实测 <700px），不靠芯片自己缩 |
| 折叠判据用视口断点 | 1440 视口开右栏后聊天列只剩 ~352px，视口断点不感知，发送钮被顶出裁掉 | 折叠判据 = 视口断点 **或** ResizeObserver 实测容器宽 |
| 挪 DOM 留 stale CSS | 标签行挪出 body 后，explorer-column 的负 margin 把树列顶出面板体（头行全部失联） | 每次结构替换，同批 grep 旧位置专属规则并删除 |
| 虚拟列表约束 | 绝对定位容器内部不能插行 | 插在容器**外的普通流位置**（分支行教训），列表槽位计算不受影响 |
| 内联样式压 CSS | ModelSelector 根节点 inline `minWidth: 0` 压过任何 CSS 保底 | 改组件内联本身，不要试图用 CSS 赢 inline |
| 源码守卫测试 | 换结构后旧断言失效 | 断言**新的等价约束**（真正的不变量），不是删测试 |
| SettingsPanel 纪律 | 文件有「零 inline style」守卫 | 批次 C 全部走类，先做 SW-07 控件基件 |
| 宽正则改 JSX | `[^}]*` 近似匹配曾弄坏 12 处 | 用精确锚点或 python 脚本 + 唯一性断言 |
| dev/prod 共用 `.next` | 直接混用报 `Module factory is not available` 假故障 | 切换只走 `npm run dev:clean` / `npm run prod`；起服前 `lsof -nP -iTCP:30141` 复用健康进程 |
| 截图模仿 | 全部历史错行/错位的根因 | 本文第〇原则；验收用 structdiff + 对数，不用肉眼 |

---

## 6 · 裁定记录

### 6.1 用户裁定（2026-09-29）
1. **设置 13 分节全量照画板重写**（不采用"只做 token 对齐"的轻量路线）——批次 C 按 7 个 PR 拆分落地。
2. **皮肤工作室保留，输出约束到设计 token 槽位**——不删除四色自定义与滑块；皮肤改的是 `--accent/--bg` 等既有槽位（桥接层已实现大半），不新增色相。DIVERGENCE A-1 维持登记，注记"规范让位于产品功能"。

### 6.2 本计划新增裁定（按"看着办"授权）
3. **移动端信任横幅：做**（SW-16）——画板 60 的新元素，产品缺失，且不违反"移动端同构"。
4. **迷你地图标题节点 muted：做**（并入 SW-15）——需要回合 kind 字段，纯前端派生，不动会话文件格式。
5. **agent 认证流程：不做**——画板 56 自标"设计提案"，产品已有完整的供应商 API-key/OAuth 体系。
6. **工具参数四列表格：不做**——两列已承载全部信息（required/enum/default/描述），强压四列会丢字段描述（⊘ 29 条）。
7. **Mermaid 全屏缩放查看器：做**（并入 SW-15）——画板 10 明确画了，属漏接不是新功能。

### 6.3 历史裁定索引（不再重议）
登录体系删除（无登录产品）· 统计收进圆环、常显长条永不恢复 · 移动端与桌面同构（无底部条/弹层）· 主题三档 light/dark/auto · 目录选择系统原生优先 · 会话分支(git-fork) ≠ Git 分支(git-branch) · 扩展状态右上角胶囊浮标。

---

## 7 · 明确不做的（不是漏，是裁定）

沿用第一轮 §7 全部条目：ACP 流量调试页 · Restore Checkpoint 分隔线 · Edits 审阅条（Keep/Reject All）· 登录/会话令牌 · 移动端底部控件条与弹层 · 换栈 Flutter+Rust · 整页转场/滚动视差/骨架屏常驻 · 新增色相（全套 ≤5）。

本轮新增：agent 认证流程（提案未采纳）· 工具定义参数四列表格（两列等价）· 恢复输入框下方常驻统计条（50 轮已裁定进圆环）· Git 图泳道重写为静态 grid（SVG 自绘已同源 token）· 子代理独立卡（工具卡徽标等价）· diff 词级视图重写（自有实现走 `--diff-*`）。

---

## 8 · 附录

### 8.1 验收脚本速查

| 脚本 | 用法 | 判定 |
|---|---|---|
| `.scratch/geom.mjs`（模式脚本） | 改 `targets` 里的选择器组，board `file://` vs app `http://127.0.0.1:30141` 双端取 rect+computed style | 关键尺寸逐项对上画板 |
| `.scratch/structdiff.mjs`（模式脚本） | 归一化 DOM 签名（tag+pw-\*/fork-\*+data-ico，滤文本）逐节点 diff | 组件级 0 结构偏差 |
| `.scratch/popover-audit.mjs`（模式脚本） | 触发每个浮窗，沿祖先链查 overflow 裁切 + 截图 | 0 处裁切 |
| `.scratch/shot.mjs` | `node shot.mjs <url> <out.png> [w] [h] [wait]` | 截图存证（不作判定） |
| `npm run check:design` | style-literals + motion-tokens + check-boards + check-align | 退出码全 0 |
| `docs/codex-skin/check-contrast.mjs` | 需服务在 30141；9 组组合 × light/dark | 正文 4.5 / dim 3.0 |
| `design/pi-web-design/scripts/render-boards.mjs` | 本机 Chrome 逐张出 PNG | 基线存档 |
| `npm test` / `npm run lint` / `tsc --noEmit` | 全量 | 全绿 |

### 8.2 常用命令

```bash
npm run dev:clean     # 改代码（清缓存 → next dev :30141）
npm run prod          # 日常/演示（预编译，快 10 倍）
npm run mode:status   # 看当前 .next 属于哪种模式
lsof -nP -iTCP:30141 -sTCP:LISTEN   # 起服前复用健康进程
```

### 8.3 29 张画板 ↔ 批次反向索引

| 画板 | 批次 | 画板 | 批次 |
|---|---|---|---|
| 00 tokens | （基准，随 SW-00 入库） | 41 模型 | SW-08 |
| 01 workbench | ✅（G 轮基准） | 42 子代理/技能 | SW-09 |
| 02 sidebar-topbar | ✅（G 轮） | 43 插件/MCP | SW-10 |
| 05 motion | SW-17 对表 | 44 定时/记忆 | SW-11 |
| 07 dark | （每次改色随 check-contrast 核） | 45 快捷键/用量 | SW-12 |
| 10 transcript-text | SW-15（pw-md/公式/Mermaid 全屏） | 46 命令/归档/导入 | SW-12 |
| 11 transcript-process | ✅（⊘ 子代理卡/diff 词级） | 47 皮肤工作室 | SW-13 |
| 12 transcript-interactive | SW-15（内容块分支） | 50 dialogs | SW-03 |
| 20 composer | ✅（50 轮收口） | 51 menus | SW-01/03 |
| 21 menus | SW-01/02 | 52 viewer-modes | SW-04~06 |
| 22 top-panels | SW-14 | 53 turn-and-nav | SW-15 |
| 30 files-panel | SW-04 | 54 extension/links | SW-15/16 |
| 31 terminal/browser/git | SW-06 | 56 agent-management | SW-10（更新五态）/ 认证不做 |
| 40 settings-general | SW-07 | 60 mobile-pwa | SW-16 |
| — | — | 61 system-states | SW-03/15 |

### 8.4 工作量参考（单 PR 粒度）

批次 A 每个 PR 半天~1 天；批次 B 的 SW-05 最重（约 2 天，六形态+覆盖层）；批次 C 每分节 0.5~1.5 天（SW-08 模型、SW-11 定时/记忆偏重）；批次 D 的 SW-15 最重（约 2 天，迷你地图+pw-md 收尾）；SW-00 半小时。全部走完约 15~20 个工作日，每批独立可停。
