# 移动端布局：借鉴 Pi Remote 的形态与功能（2026-10-03）

- **参照物**：`pi参考项目/pi-移动端/`（Pi Remote，Compose Multiplatform + Node 桥接）
- **本文定位**：布局/功能对照 → 可借鉴点 → **PR 拆解**。只出计划，不含实现。
- **结论一句话**：功能上我方是**超集**，差的全在**手机上的动作摆放与滚动成本**；改动集中在 6 个 PR、**零后端新增**。

---

## 0. 取证范围

参照物读了这些文件（全部相对 `pi参考项目/pi-移动端/`）：

| 文件 | 拿到什么 |
|---|---|
| `app/composeApp/src/commonMain/kotlin/com/piremote/ui/App.kt` | 全部 5 个屏：`Main(Chat+Drawer)` / `Git` / `Tree` / `Settings` / `Connect`；`ModalNavigationDrawer` + 系统返回键分级 |
| `…/AppDrawer.kt:110-450` | 抽屉几何：标题+齿轮 → 「新建会话/新建工作区」双按钮 → 常驻搜索框 → `最近/工作区` 双 Tab → `PullToRefreshBox` 列表 → 底部连接状态条 |
| `…/ChatScreen.kt:247-300` | 顶栏：`☰` / 标题+**副行**(`cwd · model · thinking · Context% · 运行中`) / 仅 2 枚动作（Git 改动、刷新） |
| `…/ChatInput.kt:432-555` | 微信式 `+` 面板：**占满键盘高度**，3-5 列自适应，图标+两行文字，异步动作就地转 spinner |
| `…/MessageView.kt:784-864` | 思考/工具调用渲染成**单行 chip**，点开是 bottom sheet |
| `…/SessionControls.kt` / `ChipSheet.kt` | 模型/思考/字号/会话信息四张 sheet |
| `screenshots/6.0-6.2.jpg` | 抽屉、对话、面板三帧真机 |

我方读了 `hooks/useIsMobile.ts`、`components/AppShell.tsx`（断点/顶栏/抽屉/右栏/设置入口）、
`components/ChatInput.tsx`（窄屏两行 grid + 覆盖式工具条）、`components/SessionSidebar.tsx`、
`components/TabBar.tsx`、`app/manifest.ts`、`public/sw.js`、`design/pi-web-design/60-mobile-pwa.html`。

---

## 1. 布局对照

### 1.1 导航骨架

| | Pi Remote | PI NEXT（≤640px） | 差在哪 |
|---|---|---|---|
| 一级导航 | ModalNavigationDrawer（320dp，边缘滑动） | 遮罩抽屉（280px / 85vw，边缘滑动 + Esc） | 一致 |
| 屏数 | 5（全屏态，无标签栏） | 同构但**同一屏内切面板**（抽屉 / 右栏全屏 / 设置全屏） | 我方屏多，塞进一个 URL 状态机 |
| 子屏返回 | 系统返回键分级（抽屉→屏→主屏） | 浏览器返回 + 各处 `isMobile` 关闭 | 我方缺**系统返回键**（PWA standalone 下没浏览器栏，返回手势没兜底） |
| 底部标签栏 | 无 | 无（画板 60 明令） | 一致 |

### 1.2 顶栏（这是差距最大的一块）

| | Pi Remote | PI NEXT ≤480 | PI NEXT 481-640 |
|---|---|---|---|
| 按钮数 | **2**（Git 改动 / 刷新） | 1（`…`）**+ 覆盖层里 6 枚** | 6 枚直排 |
| 覆盖层 | 无 | `…` 点开一层**盖住会话标题**的模糊层（`AppShell.tsx:2882-2906`） | 无 |
| 会话身份 | 标题 + **常驻副行**（cwd·model·thinking·ctx%·运行中） | 只有标题 | 只有标题 |
| 面板开关 | — | `panel-right` | `panel-right` |

> 参照物只有 2 枚顶栏动作，是因为它**总共只有 9 个动作**，其余 8 个都在 `+` 面板。
> 我方顶栏 6 + composer 4 + `⋯` 菜单 12 = **22 个入口**，其中「生成标题 / 导出 Markdown / 子代理」在手机上一点就找不到。

### 1.3 输入区

| | Pi Remote | PI NEXT 窄屏 |
|---|---|---|
| 控件行 | 一行：无标签图标（思考/权限/预设）+ 发送 | 两行 grid：行一 `+ 型号`，行二 `思考 权限 预设 速度 … ctx环 发` |
| 次级动作 | `+` → **带文字的宫格**（模型/思考/新会话/生成标题/图片/压缩/字号/会话信息/树） | `…` → 一条**无文字**的覆盖式工具条 |
| 键盘关系 | 面板与键盘**等高互换**，零抖动 | 覆盖条在 composer 内部 `position:absolute`，靠键盘高度 hook 兜 |
| 忙碌时 | 弹「插队 / 排队」二选一 | 已有（`hooks/useAgentSession.ts` steer/followUp） |

### 1.4 会话流

| | Pi Remote | PI NEXT |
|---|---|---|
| 思考块 | 单行 chip + bottom sheet | `.fork-collapse` 折叠 + `--content-cap-*` 钳制 |
| 工具调用 | 单行 chip（文件名 / 命令行 + 图标） | 内联卡片，可折叠 |
| 成本 | 一屏能看 6-8 轮 | 一屏 2-3 轮 |

### 1.5 抽屉

| | Pi Remote | PI NEXT |
|---|---|---|
| 搜索 | **常驻输入框**（放大镜 + 清空钮） | 图标钮切换才出现 |
| 刷新 | `PullToRefreshBox` 下拉 | 无（侧栏 2.5s 轮询 running，列表要 refreshKey） |
| 分组 | `最近` / `工作区` 两 Tab | `项目` / `聊天` 分段 |
| 行 | 标题 + `N 条 · 时间` + **右侧工作区标签** | 标题 + `N 条 · 时间`（工作区靠父行） |
| 底部 | `● 已连接 code.local:30150` | `设置` + 手机钮 + 版本号 |
| 空态 | 有独立空屏 | 有 |

---

## 2. 功能对照

### 2.1 参照物有、我方**缺形态**（功能其实都在，只是手机上不好用）

| 功能 | 我方现状 | 需要什么 |
|---|---|---|
| Git 改动一览 | `/api/git/status\|log\|diff` 全有；只有右栏 git graph tab | 手机全屏页（PR-6），**零后端** |
| 会话树（分支跳转） | `BranchNavigator` 浮层挂在顶栏 `git-fork` | 手机全屏页（PR-7） |
| 次级动作集中入口 | 散在顶栏/composer/`⋯` 菜单 | 手机动作面板（PR-1） |
| 会话身份常驻可见 | 标题旁无副行 | 顶栏副行（PR-3） |
| 抽屉常驻搜索 / 下拉刷新 | 无 | PR-4 |
| 连接状态（当前地址） | 只有版本号 | PR-4 |

### 2.2 我方有、参照物没有（**不要为了对齐而砍**）

文件浏览器 / 终端 / 浏览器 tab / 调用轨迹 iframe 页 / 10 个设置分节（模型·技能·子代理·插件·MCP·用量·归档·导入·手机与推送）/ Web Push 通知（`lib/web-push.ts` + `/api/push/*` 已通）/ 多设备实时同步（SSE 扇出）/ 会话动作菜单 / MCP+配置发现 / IM 推送 / 机器人渠道。参照物是个纯远程控制台，这是一整个工作台。

### 2.3 参照物有、我方**真没有**（可选，可砍）

- **基准字号设置**（`FontSizeSheet` + 实时预览）→ 并入 PR-7，可单独砍。
- 服务端瘦身（toolResult >8KB 截断、thinking 前 200 字、列表剥 `allMessagesText`）→ 我方 `lib/session-reader.ts` 已是同一套读法，本轮不动。

---

## 3. 关键取舍：**画板 60 与参照物正面冲突**

`design/pi-web-design/60-mobile-pwa.html:16` 原文：

> **移动端与桌面端同构**：同一套控件、同一个位置，只改尺寸与折叠方式。
> 窄屏**不新增底部条、不新增底部弹层**——放不下的动作收进顶栏那条覆盖式工具条（一个都不少）。

参照物的形态（`+` 面板占满键盘高度）**正是这条裁定否掉的东西**。而我方 ≤480 那条
「盖住标题的覆盖层」（`AppShell.tsx:2882-2906`）就是这条裁定的**必然后果**：22 个动作
无处可放，只能盖。

因此本计划走**不推翻裁定**的那条路：

- 动作面板做成**锚在 composer 上方的带文字宫格浮层**，复用输入区已有的 popover 定位模式
  （模型 / 思考 / 工具预设三枚已经是同一套），**不做**「占满键盘高度」的整屏面板，
  省掉 `visualViewport` 高度冻结那一套键盘数学。
- 形态上它是**浮层**，不是「底部条」也不是「底部弹层」，与画板 60 的字面裁定不冲突；
  但**仍需在画板 60 增一帧并登记 `DIVERGENCE.md`（判据⑦）**——新 `.pw-*` 类不许凭空出现。
- 参照物的「`+` 一键换成面板」也不照搬：我方 `+` 是**附件**（手机上最常用），面板另给一枚钮。
  **这一条是明确偏离，记进 DIVERGENCE。**

---

## 4. PR 拆解

依赖顺序：`PR-1 → PR-2`，其余彼此独立、可并行。

### PR-1 ｜ 手机动作面板（带文字宫格，新家）

- **目标**：手机上所有次级动作收进一处、**拇指可达、看得懂名字**。
- **形态**：composer 工具行新增一枚 `grid-2x2` 图标钮 → 浮层宫格（列数按宽度自适应，4 列下限，
  每格 = 圆形图标 + 一行标签；异步动作就地换 spinner 并禁用点击）。
- **收进的 10 项**：调用轨迹 / 完整历史、生成标题、子代理切换、分支树、会话动作 `⋯`（全部）、
  导出 HTML、导出 Markdown、压缩上下文、会话信息（读数）、字号。发送图片**不进**（`+` 已经是它）。
- **改动面**：`components/ChatInput.tsx`（新浮层 + 一枚钮）、`components/fork/ActionGridPanel.tsx`（新）、
  `app/fork-ui.css`（`.pw-actgrid*`）、`design/pi-web-design/assets/board.css` + `60-mobile-pwa.html`
  增帧、`scripts/board-specs/60-mobile-pwa.mjs` 增断言、`DIVERGENCE.md`、`lib/i18n/*` 新键。
- **本 PR 是纯增量**：顶栏与 composer 的旧入口全部保留，PR-2 才删。
- **验收**：
  - 390×844 下打开面板，无横向溢出、无文字截断（`node scripts/pwa-audit.mjs 390 844`）
  - `npm run check:design` / `check:contrast` / `verify:boards:seeded` / `npm test` 全绿
  - 手工：面板打开时输入框仍可聚焦（键盘不被强制收起）
- **风险**：低—中。新类要走画板门禁，是本批唯一的设计系统成本。

### PR-2 ｜ 顶栏瘦身 + 拆掉两处覆盖层

- **目标**：手机顶栏只剩 **菜单 · 会话身份 · 面板切换**；删掉两个 `visibility`/覆盖 hack。
- **删**：`mobileToolbarMoreOpen` 覆盖层（`AppShell.tsx:2882-2906` + 2851-2872 的 `…` 钮）、
  `ChatInput` 的 `controlsMenuOpen` 覆盖条（窄屏工具条那一支）、`renderSidebarToggle` 死代码（2493-2514）。
- **顺带**：`SessionActionsMenu` 里的「调用轨迹/系统提示词/工具定义」在手机上的落点确认（走 PR-1 面板）。
- **验收**：390px 下顶栏除菜单与面板钮外无动作；`npm test`（`AppShell.mobile-toolbar.test.mjs` 需同步改断言）；
  `verify:boards:seeded` 的 60 号 spec 更新。

### PR-3 ｜ 顶栏副行（会话身份常驻）

- **目标**：不用点任何东西就知道「我在哪个项目的哪个会话、用什么模型、上下文还剩多少、有没有在跑」。
- **形态**：标题下方一行 `cwd basename · model · thinking · Context N% · 运行中`（11px muted，
  超长省略；`.pw-tb-title` 当前 `align-items:center` + `span` 强制 nowrap，需为两行版加一个
  `.pw-tb-title-sub`，同样要进 board.css + 画板 02/60）。
- **数据**：model / thinking 从会话状态读；context% 复用 `sessionStats`（composer 的 ctx 环已有同源）；
  running 复用 `runningSessionIds`。
- **验收**：390px 下副行不换行不溢出；与 ctx 环数字一致；暗色对比度过 `check:contrast`。

### PR-4 ｜ 抽屉改造（列表舒适度）

- **改**：
  1. 搜索框**常驻**（放大镜 + 清空钮，替掉现在的图标钮切换）
  2. 列表**下拉刷新**（`refreshKey++`，复用现有取数）
  3. `项目 / 聊天` 分段前加 **`最近`**：跨项目按 `modified` 倒序取 N 条，行尾补**工作区标签**
     （平铺列表里父行不可见，标签是唯一「这条属于哪个项目」的线索——参照物正是这么做的）
  4. 抽屉底部补 **连接状态**（`● 已连接 <host>`），版本号保留
- **不动**：树结构、滑动关闭、行内 `⋯`、置顶/归档。
- **验收**：`pwa-audit.mjs` 无溢出；`最近` 与 `/api/sessions` 首屏一致（无二次请求）；`npm test`。

### PR-5 ｜ 触控与可达性修补（纯 CSS / 小 JS，无新功能）

一次收掉审计里的**真缺陷**，不夹带功能：

| 项 | 位置 |
|---|---|
| tab 条触控靶（26px → 触控档） | `TabBar.tsx` 未进任何触控规则；`app/fork-ui.css:2250/2439/2949` 补 |
| 右栏头部 3 枚裸钮（git-branch / 关闭 / 搜索）无触控类 | `AppShell.tsx:3129-3168` |
| 抽屉底部手机钮 22×36 | `AppShell.tsx:2076-2084` |
| toast 缺 `env(safe-area-inset-bottom)` | `AppShell.tsx:3330-3343` |
| MCP / 插件状态手机不可达 | `AppShell.tsx:2833-2838` 的 `!isMobile` → 进 PR-1 面板 |
| 附件选择器无 `accept` / `capture`（iOS 弹通用文件框） | `ChatInput.tsx:3074-3086` |
| 横屏矮屏标签全失 | `ChatInput.tsx:3890/3988/4052` |

- **验收**：`node scripts/pwa-audit.mjs 390 844` 与 `768 1024` 两档触摸靶报告清零；
  `npm run check:design` / `npm test`。

### PR-6 ｜ 手机 Git 全屏页（零新后端）

- **形态**：`☰ · 标题 ‹ 返回` + `改动 / 提交` 两个 Tab；改动列表（状态字母 + 文件名 + 增删），
  点行进 **diff**（复用右栏 git graph 已有的 diff 组件，不重写）；提交列表点行进文件清单。
- **后端**：全用现成的 `/api/git/status|log|diff`（`lib/git-changes.ts` / `lib/git-graph.ts`），
  照抄参照物的请求形状即可，**不新增路由**。
- **表格**：自适应（窄屏把列折成两行标签），照 `AdaptiveTable.kt` 的思路。
- **入口**：PR-1 面板或顶栏（PR-2 后顶栏还有一枚 `git-commit-horizontal` 的位置）。
- **验收**：390px 下长文件名/长 commit message 不溢出；超长 diff 不顶掉返回键；
  `npm test` + 新增一条路由形状的单测。

### PR-7 ｜ 手机会话树全屏页 + 基准字号（可只做前者）

- **树**：把 `BranchNavigator` 的树画布搬到全屏页（手机上不再用顶栏浮层），
  保留现有「Edit from here」语义（回填输入框、发送时分支，**不在点击时导航**）。
- **字号**：设置 > 通用 加「基准字号」，写 `--chat-font-size-offset`（输入区已有这个变量），
  面板宫格里给一格。**这一项可以单独砍掉，不影响 PR-7 的树。**
- **验收**：树页返回手势 / Esc 正常；字号改动在消息流即时生效且不破布局（`check:contrast` + 画板 20 对位）。

---

## 5. 明确不做（以及什么时候做）

| 不做 | 理由 / 触发条件 |
|---|---|
| **工具调用 chip 化**（参照物那套单行 chip + bottom sheet） | 我方已有 `.fork-collapse` + `--content-cap-*` 钳制；改 chip 会波及桌面转录与 `TraceFrame` 导出页。等真机滚动投诉再单独评估 |
| **占满键盘高度的动作面板**（`+` 一键换面板） | 要 `visualViewport` 高度冻结与 settle 链，我方 `useViewportHeight` 已有一套但用在别处；收益（零抖动）不值这个复杂度。**登记为偏离** |
| 底部标签栏 / 底部导航 | 画板 60 明令 |
| 手机系统返回键分级（BackHandler 等价） | 要 PWA 里监听 `popstate` + 面板栈，PWA standalone 才用得上。PR-6/7 落地时顺手做（那时已有子屏栈） |
| 服务端瘦身（8KB 截断等） | `session-reader` 已是同一套读法 |
| 换 Material 3 / 新设计语言 | 设计系统唯一来源是 `design/pi-web-design/` |
| 独立桥接服务 / 自建 TLS | 我方同源 HTTP + `lib/lan-access.ts` 已覆盖 |

---

## 6. 每 PR 的门禁（照 `AGENTS.md` 判据）

```
npm run check:design          # style-literals + motion + icons + boards + align
npm run check:contrast        # 改任何前景/背景色之后（需 prod 起服）
npm run verify:boards:seeded  # 几何对位（CI 用的自建 agent 目录那档）
node scripts/pwa-audit.mjs 390 844 chat   # 手机档溢出/裁切/触摸靶
node_modules/.bin/tsc --noEmit && npm test && npm run lint
```

改动到哪张画板就补那张的 spec（新 `.pw-*` 类：先进 `board.css` → 上画板 → 记 `DIVERGENCE.md`）。

---

## 7. 执行顺序

```
PR-4 ─┐（低风险，先合，手感立刻变好）
PR-5 ─┘
PR-1 → PR-2 → PR-3        （动作面板 → 顶栏瘦身 → 副行，串行）
PR-6 ─┐（独立，复用现有 git 路由）
PR-7 ─┘（独立；PR-2 之后子屏返回栈一起做）
```

建议顺序：**PR-4 → PR-5 → PR-1 → PR-2 → PR-3 → PR-6 → PR-7**。
前两个零设计系统成本，先落地；PR-1 是这批的重心。

---

## 8. 落地前要确认的一件事

工作区当前 **163 个改动未提交**（MCP 1.0、IM 桥、机器人渠道、LAN 配对等在途）。这批 PR 需要
一个干净基线：建议先把这批在途功能提交/落分支，再从那里开第一个 PR。
---

## 9. 执行记录

| PR | 状态 | 落地内容 / 与原计划的差 |
|---|---|---|
| PR-4 | ⚠️ **部分被撤回**（`fork:mobile-drawer` → main `c6a9a776`） | 落地的是「最近」第三格 + 平铺列表 + 工作区标签 + 下拉刷新；随后 **`c6a9a776 revert(sidebar)` 撤掉了「最近」第三格，只保留下拉刷新**（`.pw-seg` 回到两格、九处画板同步回退、`lib/sidebar-pane.ts` 去掉 `recent`、DIVERGENCE AH 节改写成只记下拉刷新）。**这是用户的裁定，本计划的后续 PR 不再依赖那一格**。另外两条本来就没做：常驻搜索框（撞第 81 条裁定）、底部连接状态条（`.pw-side-foot` 是 5 份 spec 的对位锚点）。顺带修掉 `lan-supervisor.test.mjs` 在全量套件里的随机红（根因是 fs.watch 丢事件，不是迟到）。 |
| PR-5 | ✅ 已合（`fork:mobile-touch`） | 手机命中区补齐（tab 关闭钮 / 概览钮 / 右栏页头两枚 / 抽屉手机钮）+ toast 安全区 + 横屏矮屏被 `shellNarrow` 推翻的真缺陷。**「横屏标签全失」是审计误报**，实机一量推翻。**附件 `accept`/`capture` 挪到 PR-1** —— 手机要的是「图片」这个独立入口，而那是动作面板的一格；给现有输入框加 `accept` 会变成「只能选图片」的功能收窄。**MCP/插件状态上手机也归 PR-1**（它的落点就是那个面板）。 |
| PR-2 | ✅ 已合（`fork:mobile-toolbar`） | 窄屏顶栏瘦成「菜单 / 会话身份 / ⋯ / 面板开关」四件，拆掉**两条**覆盖式工具条（顶栏那条盖住标题的 + 输入区那条藏上下文环的）。声音开关不搬进宫格 —— 覆盖层拆了它本来就常驻行二，再给一格就是重复入口（第一版加了又撤）。画板 60 帧 C 重画，帧 E 顺带从「嵌在 C 里」挪成兄弟节点。五个测试文件同步（改的是断言对象，不是放宽）。 |
| PR-3 | ✅ 已合（`fork:mobile-subtitle`） | 手机顶栏副行 = `cwd 目录名 · 上下文 N%`。**只有两项，不照搬参照物的五项**：model / thinking 已在输入区常驻，再放一份就是「同一块屏上摆两枚同一个读数」；「运行中」由发送钮翻成「停止」已经说了。只挂窄屏（≤640），桌面与横屏一字未变。目录名的规则顺带抽成 `pathBasename`（与项目行同一条）。 |
| PR-6 | ❌ **不做**（复验后撤销） | 手机上的 Git 两半**都已经有入口**，实测（390×844）：改动清单 + 单文件 diff 在文件树头行的 ⋯ 里（「变更（暂无改动）」，即 `ExplorerPanel` 的 `file-diff`）；提交历史 + 图谱是右栏页头那枚 `git-branch` 打开的「Git 图谱」tab（手机上该右栏本来就是全屏）。再建一个「改动 / 提交」双 tab 的新屏 = 把两处都复制一遍 —— 而 main 刚用 `90b87022 fix(tabs): 删掉调用轨迹与 git 图谱的重复渲染` 在同一片区域付过一次代价。**原计划把「缺形态」和「缺入口」看成一件事了**：审计只量了移动端布局，没量功能可达性。 |
| PR-7 | ❌ **不做**（复验后撤销） | 两半都已有：**字号**早就是设置项（`useChatAppearance().fontSize`，`PwSelectBox` 12/13/15/20，`snapUserTextSize` 锁在规范五档上，见 `SettingsPanel.tsx:775`，手机走设置全屏页可达）；**会话树**是动作宫格里「分支」那一格打开的 `BranchNavigator` 浮层（宽 `min(BRANCH_MENU_WIDTH, innerWidth-16)`，390 下约 374）。全屏化是**改进不是缺口**，不值得单开一个 PR —— 真要做得先有真机反馈说浮层不够用。 |
| PR-1 | ✅ 已合（`fork:mobile-actions`） | 带文字的动作宫格（新类 `.pw-actgrid` / `.pw-actcell` + 画板 60 帧 E）。**7 格不是 10 格**：压缩上下文与会话信息已在上下文环浮窗里（不摆第二个入口），系统提示词/工具定义刚收进 ⋯ 菜单（不撤销那次裁定），置顶/重命名一族留在 ⋯ 菜单成组。**不做「占满键盘高度」**：要一整套 visualViewport 键盘数学，收益只是零抖动，用锚在输入卡上方的浮层代替（登记为偏离）。**`+` 不换成面板**（本仓 `+` 是附件）。**「发送图片」另开 `accept="image/*"` 输入框**而不是给现有的加 `accept`（那是功能收窄）。MCP/插件状态手机不做 —— 设置里可达，顶栏那两枚是桌面快捷方式。 |
