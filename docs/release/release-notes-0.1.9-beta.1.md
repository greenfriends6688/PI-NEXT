# PI NEXT 0.1.9-beta.1（预发行）

> V5 设计体系完整落地 —— Web 与 PWA 两套形态一次性换完。
> 预发行通道：功能已可用，但形态过渡期还有少量缺口（见「已知」）。

## 新增

- **V5 设计体系落地（Web · `d-*`）**：38 张画板逐一抄进产品——工作台与新会话、侧栏与顶栏
  （项目树 / 会话三态 / 折叠导轨 / 动作 ⋯）、转录全集（过程时间轴、工具卡、代码、diff、
  失败重试、未读分割）、输入框与全部浮层、右栏六面板、文件查看器多模式、设置 11 分节
  （弹窗与整页两种宿主）、命令中心、计划卡与队列、系统态与对话框。
- **V5 设计体系落地（PWA · `m-*`）**：12 张手机画板全部落地——会话页与抽屉、手机转录、
  输入卡与能力面板、设置两层（hub → 分节二级页）、商店 / 定时任务 / 用量三个一级页、
  文件与终端（含软键盘键排）、浏览器与命令中心、安装更新信任、手势与系统态、手机右栏六面板。
  新增 `components/pwa/` 下 12 个窄屏组件。
- **命令中心补全**（⌘K）：三域分组标题、命中片段高亮（只加重命中，不整行打底色）、搜索中骨架、
  空查询的「最近打开」、空态带 `>` `#` `@` 前缀说明。
- **设备视口补全**：五档机型预设（iPhone 15 / 16 Pro Max / SE / Pixel 9 / Galaxy Tab）、
  旋转、逻辑视口与 DPR 读数底栏；宽度预设 / 机型 / 自由尺寸三段互斥。
- **计划卡**：底栏补落盘日期。
- **上下文环浮窗**：完整会话明细（会话信息 / 消息 / Token 三节并排，窄屏自动落一列）。

## 修复

- **步骤时间轴图标去掉圆环**：13 条步骤读成一串绿圈；改为竖线 + 图标 + 文案表达时间轴
  （失败 / 运行中仍是状态色）。
- **步骤行左对齐**：画板里是 `div`、产品里是 `button`，UA 默认居中；同类板件统一做 UA 归零。
- **待办芯片与输入框左对齐**：从卡内移到卡外上下文条，与输入卡同宽同居中。
- **上下文环浮窗点不出**：浮窗类挂在内层节点上，316px 高的面板有 233px 掉出视口；
  改挂到浮层宿主自身后完全在屏内。
- **两个真 bug**：`getServerSnapshot` 每次新建对象导致 React 反复重渲；应用首页样式表
  有一条悬空声明块（会让页面直接 500）。
- **旧层收口**：约 950 行死 CSS 删除；仍生效的行为规则（手机命中区、模型芯片不压扁、
  macOS 红绿灯让位、查看器动作在右）改指 v5 类名。

## 移除

- 旧皮肤 `pw-*` 类从产品 DOM 全面退场（被脚本或测试当选择器的保留并逐处注释）。
- 21 份几何对位规格迁到 v5 选择器；覆盖盘点现在同时统计 V5 画板。

## 已知（预发行口径）

- **形态过渡**：部分窄屏部位（PWA 库无对应件）仍用 `d-*` DOM 取 PWA 令牌值，
  视觉一致但类名未分形态。
- **PWA 库缺口**：`m-tok-*`（代码高亮分色）、`m-cite`、`m-quote`、`m-tasklist`、
  `m-mention`、`m-math`、并排 diff、`m-loader`（运行中环绕光带）、`m-think-*`（四态思考）
  在 `design/v5/pwa/system.css` 里没有定义，相关内容在手机上退到基础形态或桌面类。
- **待你拍板的新增能力**（画板标「提案」、产品尚无数据源，未擅自造）：真设备模拟器
  （`simctl`/`adb`）、6 步首启引导与引导进度持久化、保存的工作流、视口截图抓帧、
  计划步骤时间线、扩展插槽声明表与「每插槽可关」开关、目录信任的第三态「永不信任」。
- **设置族几何规格**仍是 V1 选择器，需要一份「设置壳 V5 类名对照表」才能收口。
- **测试基线**：3560/3569 通过；两个失败是换皮前既有问题（`lan-access` 网络绑定判定、
  `gfm-autolink-email-loader` 在路径含空格时的编码比较）。

---

## English

> The V5 design system fully landed — both Web and PWA forms swapped in one pass.
> Pre-release channel: features are usable, but the form transition period still has a few gaps (see "Known").

### Added

- **V5 design system landed (Web · `d-*`)**: 38 boards copied into the product one by one — workbench and
  new session, sidebar and top bar (project tree / session three states / collapse rail / actions ⋯), the
  full transcript set (process timeline, tool cards, code, diff, failure retry, unread divider), input box
  and all floating layers, right column six panels, file viewer multi-mode, settings 11 sections (modal and
  full-page two hosts), command center, plan card and queue, system states and dialogs.
- **V5 design system landed (PWA · `m-*`)**: all 12 phone boards landed — session page and drawer, phone
  transcript, input card and capability panel, settings two levels (hub → section secondary page), store /
  scheduled tasks / usage three top-level pages, files and terminal (including soft keyboard key rows),
  browser and command center, install/update trust, gestures and system states, phone right column six
  panels. Added 12 narrow-screen components under `components/pwa/`.
- **Command center completed** (⌘K): three-domain group titles, matched fragment highlighting (only bold
  the hit, no full-row background), searching skeleton, "recent opens" for an empty query, empty state with
  `>` `#` `@` prefix descriptions.
- **Device viewport completed**: five device presets (iPhone 15 / 16 Pro Max / SE / Pixel 9 / Galaxy Tab),
  rotation, logical viewport and DPR readout bottom bar; width preset / device / free size three segments
  mutually exclusive.
- **Plan card**: bottom bar gains the save-to-disk date.
- **Context ring floating window**: full session details (session info / messages / Token three sections
  side by side, narrow screens automatically fall to one column).

### Fixed

- **Step timeline icons lost their rings**: 13 steps read as a string of green circles; changed to vertical
  line + icon + text to express the timeline (failed / running still use status colors).
- **Step rows left-aligned**: in the boards it's a `div`, in the product it's a `button` with UA-default
  centering; same-category board pieces get UA reset uniformly.
- **Todo chip and input box left-aligned**: moved from inside the card to the context bar outside the card,
  same width as the input card and centered the same.
- **Context ring floating window can't be clicked open**: the floating-window class was hung on an inner
  node, so a 316px-tall panel had 233px falling out of the viewport; after moving it to the floating host
  itself it's fully on screen.
- **Two real bugs**: `getServerSnapshot` created a new object every time, causing React to re-render
  repeatedly; the app home page stylesheet had a dangling declaration block (which would make the page
  return 500 directly).
- **Old layer cleanup**: about 950 lines of dead CSS deleted; still-effective behavior rules (phone hit
  areas, model chips not squashed, macOS traffic lights given way, viewer actions on the right) redirected
  to v5 class names.

### Removed

- Old skin `pw-*` classes fully retired from the product DOM (ones used as selectors by scripts or tests are
  kept and annotated one by one).
- 21 geometric alignment specs migrated to v5 selectors; the coverage inventory now also counts V5 boards.

### Known

- **Form transition**: some narrow-screen parts (no corresponding piece in the PWA library) still use `d-*`
  DOM with PWA token values; visually consistent but class names aren't split by form.
- **PWA library gaps**: `m-tok-*` (code highlighting color separation), `m-cite`, `m-quote`, `m-tasklist`,
  `m-mention`, `m-math`, side-by-side diff, `m-loader` (running surround light band), `m-think-*`
  (four-state thinking) are not defined in `design/v5/pwa/system.css`, so the related content falls back to
  the basic form or desktop classes on phones.
- **New capabilities awaiting your decision** (boards marked "proposal", product has no data source yet,
  not invented unilaterally): real device simulator (`simctl`/`adb`), 6-step first-run onboarding with
  persisted onboarding progress, saved workflows, viewport screenshot capture, plan step timeline,
  extension slot declaration table and a "each slot can be turned off" toggle, and a third directory-trust
  state "never trust".
- **Settings family geometry specs** are still V1 selectors and need a "settings shell V5 class name mapping
  table" to close out.
- **Test baseline**: 3560/3569 passing; the two failures are pre-existing issues before the reskin
  (`lan-access` network binding determination, `gfm-autolink-email-loader` encoding comparison when the path
  contains spaces).
