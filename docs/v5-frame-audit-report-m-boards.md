# V5 逐帧结构核对 · 汇报 · M 板组（M-03 / M-06 / M-08 / M-10 / M-11 / M-12）

> 只改了窄屏 `m-*` 分支（桌面 `d-*` 分支一个字没动）；`design/v5/**` 一行未改；产品 CSS 一行未改；
> 行为零变化（所有改动都是类名 / 节点顺序 / 静态文案落位，不动 props、state、handler、i18n 语义、快捷键、aria 角色）。

---

## 0 · 工具侧（先说，因为它决定了本轮能验多少）

`scripts/struct-diff.mjs`（**未纳入 git 的新文件**，`?? scripts/struct-diff.mjs`）补了五件事，否则这一轮一张帧都收敛不了：

| 增强 | 为什么必须 |
|---|---|
| `viewport: {width,height}`（默认 1440×900） | 之前写死 1440×900 —— 手机帧永远走不到 `isMobile`，`m-*` 分支整片验不到。本组 spec 全部 390×844 |
| `appSkip` / `boardSkip`（连子树剔掉） | 产品独有的高亮 overlay（`.chat-input-highlight-wrap`）、板上独有的占位件，不剔就整篇错位噪音 |
| `skipBare`（默认开；裸节点不比对但子树照走） | 产品钩子外壳 `<div>` / `<span>` 没有形态类，之前每一层都算成 `EXTRA`，把真偏差埋掉 |
| 图标内部零件（lucide 灌进 `<i data-ico>` 的 `svg/path/…`）两侧对称剔除 | 比的仍然是 `<i>` 那一层的 `data-ico` 图标名，但一棵树里几十个 `path` 不再互相错位 |
| `knownDiffs`（按路径/前缀登记 + 输出里单列计数） | 「已登记的等价件」不再混在偏差里，收敛判据可复算 |
| 家具类过滤在产品侧也做（此前只有板侧做） | 不对称的过滤本身就是一种噪音源 |

> ⚠ 这两个文件（`scripts/struct-diff.mjs`、`scripts/struct-specs/`）在 git 里是 **untracked**，提交时要一并带上，否则别人的 spec 会跑在我这版工具语义之外。

---

## 1 · 逐帧：改前 → 改后

### M-03 帧 A · 静息输入卡 —— **收敛（0 偏差）**
spec：`scripts/struct-specs/m03-composer.mjs`

| | 改前 | 改后 |
|---|---|---|
| 板 12 / 产品 12 | 偏差 35（级联） | **偏差 0**（1 条已登记：`input`≡`textarea`） |

改前那一屏的结构其实已经对上了（`m-composer-wrap › m-composer › m-composer-row` 五件套、plus/`m-input`/`m-cap-btn`/`m-iconbtn`/`m-send` 全在），**这一帧我一行 DOM 都没改**；收敛靠的是把三处噪音说清楚：`.m-tray`（工作区/待办芯片，随会话恢复异步出现）→ `appSkip`；高亮 overlay → `skipBare`；板上静态 `<input>` → 登记为等价件（LANDING §2① 允许）。

### M-03 帧 A · 能力面板 —— **收敛（35/35，0 偏差）**
spec：`scripts/struct-specs/m03-capsheet.mjs` · 改前 **62 偏差** → 改后 **0**

| 偏差 | 板 | 产品改前 | 改后 |
|---|---|---|---|
| MISSING | `.m-group-title`「这一轮怎么跑」 | 没有，面板直接开第一行 | **补上** |
| CLASS ×4 | 副行 `.m-setrow-s` | `.m-sheet-row-desc`（补全区那一套） | **按板改回 `.m-setrow-s`** |
| 位置错 | `.m-ring` 在**行首**（图标位） | 挂在 `trailing` 里、跟着 chevron 走 | **新增 `leading` prop，环回行首** |
| MISSING | `.m-sheet-foot`「五项只影响这一轮…」 | 没有 | **补上** |
| ICON（已登记） | `shield-check` | `shield`（当前会话是 bypass 档） | 图标随权限档走 = 数据差异，登记为 knownDiff |

> 关键判据：`.m-setrow-s` 与 `.m-sheet-row-desc` **两个类都在库里**（`pwa/system.css:429 / 372`），两块板原文不同 —— M-03 帧 A / M-01 帧 C 的**能力·模型**行是 `.m-setrow-s`，M-03 帧 D-1 / M-08 的**补全**行是 `.m-sheet-row-desc`。所以没改默认值，而是给 `PwaComposerSheetRow` 加了 `descClass`（默认仍是 `m-sheet-row-desc`，由调用方按那块板指定）。**没有自造任何类。**

⚠ 这一帧的**行数是数据驱动的**（模型行 ← `modelOptions`；工具行 ← `!isStreaming`；上下文行 ← `contextUsage || sessionStats`）。停在新会话首页（无会话 / 无模型）时只有 3 行 —— 那是数据缺失不是结构缺失，spec 头部已写明。

### M-08 帧 A-2 / B / C · 命令中心（窄屏弹层）—— 改了 3 处，**无法运行时核对**
`components/fork/CommandPalette.tsx`

| 偏差 | 板 | 产品改前 | 改后 |
|---|---|---|---|
| MISSING | `.m-tray` 右端 `.m-grow` + `.m-t-xs.m-t-faint`「前缀即分类」 | 三个裸 chip，无图注 | **补上**（chip 的来由一句话说清） |
| MISSING | `.m-pickbar` 底排三段人话（`移动`/`打开`/`收起`） | 只有 4 枚 `.m-kbd` | **补上 3 句 `.m-t-xs.m-t-faint`** |
| MISSING | 空态 `.m-pickbar` 三条可点的去处 | `.m-empty` 只有图标+标题+说明 | **补 2 条真能兑现的：清空 / 去掉前缀**（第三条「去商店」见 §3） |

**为什么没能跑 spec**：窄屏顶栏**没有命令中心入口**（板 M-08 帧 A 明写「顶栏右钮从 ⋯ 改成放大镜」，产品顶栏是 `⋯ 会话动作`），抽屉里那条也没有，`⌘K` 在手机上不存在 —— 手机上**没有任何入口**能打开它。宿主在 `AppShell.tsx`（不在本轮可改文件）。spec 我没写（写不出可达的 `app.script`，写了也是假绿）。

### M-12 帧 A · 右栏入口面板 —— 补了 2 行，**六项列表仍缺**
spec：`scripts/struct-specs/m12-entry.mjs` · 改前 42 板 / 6 产品 · 38 偏差 → **仍 38（其中 36 是那六行）**

| 偏差 | 板 | 产品改前 | 改后 |
|---|---|---|---|
| MISSING | `.m-group-title`「选一块进入 · 六块共用一层切换条」 | `listLabel` 没传 → 不渲染 | **组件内给默认值**（接线层可覆盖） |
| MISSING | `.m-sheet-foot`「不做常驻页签…」 | `footNote` 没传 → 不渲染 | **组件内给默认值** |
| **MISSING ×6 行** | 六个 `.m-sheet-row`（轨迹/文件/终端/浏览器/Git/审查，各带现状一句 + 徽章/圆点） | **0 行** | **仍缺**，见 §3-① |

### M-06 帧 C · 终端键排 —— 类名/键序全对，改的是无障碍名
`components/pwa/TerminalKeybarMobile.tsx`：`.m-keybar` + 九枚 `.m-key`，键序（Ctrl-C · Esc · Tab · ↑ ↓ ← → · `|` · Ctrl-P）与板上一致，**DOM 一字未动**。改的是 `title`/`aria-label`：此前把**控制序列本身**写进去了（读屏念「ETX」「escape」），板上写的是人话（中断 / 退出全屏 / 补全路径 / 上一条历史 …）→ 改为 9 个新 i18n 键。**终端一个字节都没变**（仍走 `paste()` → 同一个 `onData → writer.write`）。

### M-06 帧 F · 不支持类型降级卡 —— 补 1 行
`components/fork/UnsupportedFilePreview.tsx`：`.m-viewbox` / `.m-doc-head` / `.m-doc-body` / `.m-pickbar`（两条替代路径）与板一致，**缺**板上的 `.m-group-title`「降级不是白屏：至少给两条替代路径」→ **补上**（这句是这块卡的用途说明，去掉之后两个按钮看着只是按钮）。

### M-11 帧 D ⑪ / 帧 F · 两级错误页 —— 已对齐，只核对未改
`components/pwa/ErrorStates.tsx` + `components/TabErrorBoundary.tsx`：`.m-empty` / `.m-empty-ico` / `.m-empty-t` / `.m-empty-s` + `.m-code`（`.m-code-head` + `.m-code-body`，digest）+ `.m-pickbar`（重试必给 + 重新加载）与板一致；触控档 `.m-touch-48 / .m-touch-44` 也对。**一处差异保留**：板 ⑪（文档格）那枚「重试」是 `.m-empty` 的直接子节点，产品包在 `.m-pickbar` 里 —— 帧 F-1（真页面）用的就是 `.m-pickbar`，两帧板面本身不一致，我按 F-1 走，没改。

### M-10 / M-06 帧 A·B·D·E / M-07 —— 未能逐帧核对，原因是宿主缺失（见 §3）

---

## 2 · 补出来的「新增内容」清单

| # | 新增 | 落点 |
|---|---|---|
| 1 | 能力面板 `.m-group-title` + `.m-sheet-foot` | `ChatInput.tsx` |
| 2 | 上下文行的 `.m-ring` 移到行首（板：图标位） | `ChatInput.tsx` + `PwaComposerSheetRow.leading` |
| 3 | 模型 / 思考 / 权限 / 工具 / 上下文五行的副行改回 `.m-setrow-s` | `ChatInput.tsx`、`ModelSelector.tsx` |
| 4 | 右栏入口面板的 `.m-group-title` + `.m-sheet-foot` 默认文案 | `RightPanelsMobile.tsx` |
| 5 | 命令中心：托盘图注 + 底排键位人话 + 空态两条去处 | `CommandPalette.tsx` |
| 6 | 终端键排九枚键的人话无障碍名 | `TerminalKeybarMobile.tsx` |
| 7 | 降级卡那句判据 `.m-group-title` | `UnsupportedFilePreview.tsx` |
| 8 | 20 个新 i18n 键 × 3 语言（capSheet 2 · palette 6 · terminal.keybar 9 · pwa.rightPanels 2 · unsupportedFallbackHint 1） | `lib/i18n/messages/{zh-CN,zh-TW,en}.ts` |

**新增的 `m-*` 类：0 个。** 全部用 `design/v5/pwa/system.css` 里已有的类。

---

## 3 · 仍缺什么（按严重度排）

### ① 【最严重 · 宿主在 AppShell】手机上整个右栏是**死路**
- `MobileRightPanels` 的 `items` 来自 `AppShell` 的 `panelTabs`（= **当前打开的右栏页签**），而板 M-12 要的是**固定的六项**（轨迹/文件/终端/浏览器/Git/审查，每行一句现状）。
- 手机端**没有任何入口能打开右栏页签**（顶栏那枚被替换成 `MobileRightPanels`，右栏容器 `right-panel-closed`），实测：空列表六行渲染 0 行。
- 连带后果：**M-06 的文件树 / 查看器 / 终端 / 轨迹 / 审查、M-07 的浏览器 / Git 在手机上都进不去** —— 这就是这几帧没法写 spec 的原因，不是组件的问题。
- 需要在 `AppShell.tsx`：① `mobileRightPanelItems` 由六块**固定面板**构造（每块带一句现状 + 徽章/圆点）；② 给一块 `onEnter` 打开对应内容（文件→文件树、终端→键排、浏览器→地址栏+视口档位、Git→只读泳道、审查→两份来源、轨迹→单例时间线）。
- 图标名也要按板抄：现在是 `route / terminal / file`，板上是 `history / square-terminal / folder`（`globe / git-branch / file-diff` 三个已对）。

### ② 顶栏两枚按钮与板不一致（AppShell）
- 左端现在是 `menu`，板上是 `panel-left`（会话抽屉）。
- 右端 `⋯ 会话动作` 在板 M-08 帧 A 里应当是**放大镜 · 命令中心**（板上原话：「手机上 `⋯` 这个符号猜不出来」）。
- 板上的 `.m-top-title m-grow` 产品是 `.m-top-title` + 副行（副行是产品加的，可留；`m-grow` 缺）。

### ③ M-10 三条横幅：**`.m-update` / `.m-offline` / `.m-trust` 产品全都没有**
| 板 | 现状 | 缺什么 |
|---|---|---|
| `.m-update` 更新浮条 + 「什么时候再提醒」四选一面板 | 全库**没有任何地方**渲染 `.m-update` | 宿主 + 文案 + 「稍后」的时间选项持久化 |
| `.m-offline` 离线条（两行：状态 + 代价） | 只有零散的 `navigator.onLine` 判断（TerminalPanel/CHANGELOG），**没有 UI** | 宿主 + 一条 `online/offline` 监听即可 |
| `.m-trust` 目录信任常驻条 | `AppShell` 用的是 `.m-banner.warn`（帧 C-1 那条），形态不同 | 换 `.m-trust`；且板上还有 `.m-perm` 就地询问 + 三选项面板（信任一次 / 本次会话 / 永不 + 哪三类动作永不放行），产品的 `ProjectTrustDialog` 是另一套 |
| M-10 帧 A 安装引导（iOS 三步 `.m-step-card` / Android `.m-storecard` + 条件自检） | 只有一枚 `.m-banner`（`InstallPromptBanner`） | 三步文案 + 真实自检数据（`navigator.storage.estimate()` / `location.protocol` / manifest / SW controller —— **数据源都有，只差 UI 与文案**）。本轮未做：文案量太大且需要三语言同批，留在汇报里 |

> 这三条的共同点：**都是全局宿主件，而 AppShell 不在本轮可改文件里**，所以我没有凭空在某个组件里塞一个全局条（会变成第二份真相）。

### ④ M-06 帧 A / B / D / E、M-07、M-08 帧 C-2 —— **组件里的 DOM 我逐行读过，多数已对，但没法结构化验证**
已读后确认对齐的：`ExplorerPanel` 窄屏 `.m-top`（返回/路径/筛选/新建）、`FileExplorer` `.m-list` + `.m-group-title` + `.m-trow` + `.m-vbar`、`CsvPreview` `.m-viewer.is-open` + `.m-viewer-bar` + `.m-tbl-scroll` + `.m-tbl`、`ErrorStates`、`PwaDirectoryPicker`、`PwaTrustSheet`、`DismissButton`、`ImagePreview`。
仍缺数据的：M-08 帧 C-2「索引未命中」那张卡（要「这次搜过什么 / 没搜什么」的**逐条索引统计**——`lib` 里没有这份数据源，需要在 `/api` 侧补一个索引覆盖度接口）、M-06 帧 D 轨迹（`.m-steps`/`.m-step-row` 的数据在会话事件流里，窄屏无宿主）、M-06 帧 E 审查的两份来源（git diff + 本轮 agent 写入清单，同样是宿主问题）。

### ⑤ 命令中心空态第三条「去商店」
命令中心没有 `onOpenStore` 这类 prop，**不造一个按不动的按钮**（板上原话：空态必须给**可点的**去处）。需要 `AppShell` 传一个进商店页的回调。

---

## 4 · 碰过的文件与行段（合并用）

| 文件 | 行段（约） | 内容 | 归属 |
|---|---|---|---|
| `components/ChatInput.tsx` | 4017-4019 | 能力面板 `.m-group-title` | **我** |
| | 4052 / 4062 / 4072 | 思考·权限·工具三行 `descClass="m-setrow-s"` | **我** |
| | 4081-4092 | 上下文行 `.m-ring` → `leading`（行首） | **我** |
| | 4093-4095 | 能力面板 `.m-sheet-foot` | **我** |
| | 其余 diff（716 / 3286 / 3300 / 4687 / 4714 / 5182 / 5192 / 5321 / 5390 / 5404 等 `D-04` 段） | — | **桌面 agent，别碰** |
| `components/pwa/PwaComposerSheet.tsx` | 84-135 | `PwaComposerSheetRow` 新增 `leading` / `descClass` 两 prop | **我** |
| `components/ModelSelector.tsx` | 200-202、510 | 模型行副行改 `.m-setrow-s`；`ModelSheetRow` 传 `descClass` | **我** |
| | 408 附近（`D-04` 段） | — | **桌面 agent** |
| `components/pwa/RightPanelsMobile.tsx` | 21、28、92-96、137、169 | `useI18n` + `groupTitle`/`sheetFoot` 默认值 | **我** |
| `components/fork/CommandPalette.tsx` | 396-410 | 底排键位人话 | **我** |
| | 440-443 | 托盘图注 | **我** |
| | 489-508 | 空态 `.m-pickbar` 两条去处 | **我** |
| | 130 / 271 / 290 / 601 / 644 / 721（`D-22` 段） | — | **桌面 agent** |
| `components/fork/UnsupportedFilePreview.tsx` | 100-103 | 降级卡 `.m-group-title` | **我** |
| `components/pwa/TerminalKeybarMobile.tsx` | 22、31-46、57-63 | 键排无障碍名改人话（键序/DOM 未动） | **我** |
| `lib/i18n/messages/{zh-CN,zh-TW,en}.ts` | 47 / 544-545 / 946-951 / 1294-1302 / 1349-1351 | 20 个新键 | **我**（与他人新增键同文件不同行） |
| `components/fork/NewSessionHome.tsx` | **102** | 删掉别人留下的一个游离 `</div>`（它让**整个构建 500**，全组都验不了） | **代删，需要复核** |
| `scripts/struct-diff.mjs` | 全文 | 工具增强六项（见 §0） | **我**（文件 untracked，提交要带上） |
| `scripts/struct-specs/{m03-composer,m03-capsheet,m12-entry,m-dump}.mjs` | 新增 | 本组 spec + 窄屏 dump 工具 | **我** |

**没碰**：`design/v5/**`、任何产品 CSS、`FileExplorer/FileViewer/CodeFileEditor/TerminalPanel/ExplorerPanel/ImagePreview/CsvPreview/ProjectTrustDialog/DirectoryPicker/PhaseRoll` 的 `d-*` 分支、`AppShell.tsx`、两处已修的现场（`.d-ctxbar` 卡外待办芯片 L4836、`PortalDropdown` 自身 `className` L3274）—— 已复查，都还在原样。

---

## 5 · 验收

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | **0 错**（中途出现的 `MessageView / NewSessionHome / SessionSidebar / AppShell` 报错全在别人正在编辑的文件上，其中 `NewSessionHome` 那处由我代删了一个游离 `</div>`；别人文件恢复后 tsc 全绿） |
| `npx eslint`（我碰的 8 个文件 + 3 个语言包 + `components/pwa/`） | **0 error**。`ChatInput.tsx` 4 条 `no-unused-vars` warning 是别人在改的 import（`ThinkingIcon/FavoriteModelMenu/favoriteModels/canQueueStreamingMessage`），不在我的 diff 里 |
| 相关测试 | `pwa-wave-b` / `CommandPalette` / `UnsupportedFilePreview` / `ChatInput`×3 / `ModelSelector` = **61 tests / 61 pass / 0 fail** |
| `npm test`（全量） | 剩余失败**全部是别人在改的文件**的源码守卫测试，已用 `git show HEAD:` 逐条比对确认（例：`ContextMenu` 的 `m-pop-float is-open : d-pop-float`、`AppShell` 的 `className="main-workspace-header d-topbar"`、`const subtitle = isMobile ? …` 在 HEAD 里存在、在工作树里被改掉了）+ 一个路径编码的环境问题（`gfm-autolink-email-loader`，`PI NEXT` 空格）。**我没有删任何测试、没有加 @ts-ignore。** |
| spec 收敛 | `m03-composer` ✓ 12/12 偏差 0 · `m03-capsheet` ✓ 35/35 偏差 0（行数随会话数据，见 §1 警告）· `m12-entry` ✗ 42/6（缺口已定位到 AppShell，见 §3-①） |

---

## 6 · 给编排者的三句话

1. **本轮最值钱的发现不是某一行类名，是「手机上整个右栏进不去」**：M-06 / M-07 / M-12 的文件、终端、浏览器、Git、审查、轨迹六块全部没有宿主入口，`mobileRightPanelItems` 又是按「已打开的页签」建的，六项列表恒为 0 行。这不是换皮问题，是 `AppShell` 的接线问题，优先级高于任何类名对齐。
2. `.m-update` / `.m-offline` / `.m-trust` 三条板上有、产品全无的横幅，同属「需要全局宿主」的一类；安装引导（iOS 三步 / Android 条件自检）的**数据源其实都现成**，只差 UI 与三语言文案，可以立刻做。
3. `scripts/struct-diff.mjs` 与 `scripts/struct-specs/` 还是 **untracked**：这轮的工具增强（viewport / appSkip / skipBare / knownDiffs）必须跟代码一起提交，否则下一批 agent 拿到的还是 1440×900 写死版。