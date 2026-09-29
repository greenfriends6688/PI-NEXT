# `design/pi-web-design` 对比报告（vs `AcpAgentClient/design`，+ 产品功能查漏）

分析日期：2026-09-28
对比对象 A：`design/pi-web-design/`（workbuddy 产出，**29 张画板 + index + 3 份文档**）
对比对象 B：`pi参考项目/AcpAgentClient-main/design/`（**47 张画板 + 47 张 PNG + 5 份支撑文件**）
查漏对象：本仓库 `pi-codex` 全部组件 / hooks / 路由 / CSS 类名

> 本文只做诊断，**未改动任何画板或产品代码**。结论：设计系统骨架够用，但有三类实质缺口（黑户画板 / 规范自相矛盾 / 漏画与画错），
> 其中「回合结束行的 stopReason 用了参考项目的词表、不是 pi 的词表」是真错误。

---

## 0 · 三句话结论

1. **骨架已经立住了**：索引表 + 单一 token 来源 + 偏离登记簿 + 零 emoji + lucide + 校验脚本，这套参考项目最值钱的东西都在，
   47 张参考画板里 **45 张有对位落点**（其中 5 张是形态改写），只剩 2 张无对应（参考自己废弃的 10-checkpoint、我们明确不做的 80-traffic）。
2. **三张画板是「黑户」**：`05-motion.html` / `07-dark-tokens.html` / `56-agent-management.html` 都存在，
   但 `README.md` / `DESIGN-SPEC.md` / `index.html` 三处都没登记；而且规范里还留着 **6 处与之直接矛盾的话**
   （最刺眼的是 `README.md:260` 写着「本项目不做独立动效画板」——那张画板就躺在同一个目录里）。
3. **你提的四条全部成立，其中有一条比你想的更彻底**：目录选择器**代码里本来就是优先调系统选择器**
   （`lib/pick-directory.ts`，Electron 走 `/api/cwd/pick` 拉起 osascript / PowerShell / zenity），
   是**画板把这条主路径整个漏掉了**，只画了浏览器回退用的自绘浏览器。

---

## 1 · 方法与证据

| 手段 | 命令 / 文件 | 用途 |
|---|---|---|
| 组件 ↔ 画板 全量比对 | `ls components/*.tsx components/fork/*.tsx`（88 个）逐个 `grep -r design/` | 找漏画 |
| **CSS 类名反扫** | `grep -ohE '^\.[a-z0-9-]+' app/{globals,fork-ui,settings,wallpaper}.css` | 找「同一组件里的第二三块 UI」 |
| 类名 → 使用点回查 | 每个可疑类名 `grep -rn --include=*.tsx` | 剔除死 CSS |
| 参考画板全文提取 | python 剥标签后读 `05-motion.dc.html` 等 | 比粒度 |
| 词表核对 | `node_modules/@earendil-works/pi-ai/dist/types.d.ts` | 验证 stopReason |
| 静态校验 | `node design/pi-web-design/scripts/check-boards.mjs` | 画板本身健康度 |

**先说画板本身的健康度**：`check-boards.mjs` → 「扫描 30 个画板：0 个错误，0 个标签警告」。画板是干净的，问题全在**覆盖**与**登记**上。

---

## 2 · 结构级对位（参考有什么 / 我们有什么）

| 参考项目的设施 | 我们的状态 | 判定 |
|---|---|---|
| `README.md` 全量索引表（编号/名称/页面/源文件/PNG/状态/token 变更） | 有表，但**只有前 5 列**；缺「状态（已实现）」跟踪、「token 变更」列 | ⚠ 半缺 |
| 47 张 PNG 快照（**审查与验收基准**） | **0 张 PNG**。`render-boards.mjs` 在，但产物没入库 | ❌ 缺 |
| 画板编号只增不改 | 遵守 | ✅ |
| 「看画板前先看 DIVERGENCE」 | 有，且写得好（A/B/C 三节分类完整） | ✅ |
| `DIVERGENCE.md` 三节分类 | 完整，17 条，每条指到组件 | ✅ **比参考更细** |
| `materials.md` §4 **覆盖矩阵（协议面 → 画板）** | **没有等价物**。我们有「组件 → 画板」审计，但没有「事件/数据面 → 画板」矩阵 | ❌ 缺（这正是 §4.C 那个错误的根因） |
| `materials.md` §2 演示入口黑名单 | 没有（本项目没有原型演示入口，可不算缺口） | — |
| `input/design-prompt.md` + `revision-NN.md` 修订简报 | **没有**。第二~四轮的「起因 + 裁定」只活在 workbuddy 的私有 memory 里 | ❌ 缺 |
| `canvas.json` 画布布局 | 用 `index.html` 导航页替代，够用 | ✅ |
| README 追加式变更记录 | **只有 1 条**（首版入库），第二~四轮没记 | ❌ 缺 |
| `brand/` | 有（单色 π + README） | ✅ |
| `validate.ps1` 式门禁 | `check-boards.mjs` + `check-align.mjs`，**而且 check-align 的双判据比参考的审核清单更硬** | ✅ **比参考强** |

**一句话**：参考项目的「骨架」我们抄到了，但它「**验收基准（PNG）+ 覆盖矩阵 + 修订简报 + 追加式变更记录**」这四样没抄全。
其中**覆盖矩阵**的缺失已经造成了实际损失（见 §4.C）。

---

## 3 · 逐条画板对位（参考 47 张）

### P1 · token 与壳

| 参考 | 我们 | 判定 |
|---|---|---|
| 00 tokens | `00-tokens.html`（另补图标总览 + 按钮四态） | ✅ 对位，略强 |
| 01 workbench-empty | `01-workbench.html` 帧 A | ✅ |
| 02 workbench-running | `01-workbench.html` 帧 B（过程时间轴改写） | ✅ |
| 03 workbench-done | `01-workbench.html` 帧 C | ✅ |
| 04 sidebar-states | `02-sidebar-topbar.html` | ✅ 对位，另加双 pane |
| **05 motion** | `05-motion.html` —— **存在，但三处索引都没登记** | ⚠ **黑户**，见 §4.A |
| 06 session-activity | `02-sidebar-topbar.html`（扫掠线 / 未读点 / 等你点，三者互斥表） | ✅ 对位 |
| **07 dark-tokens** | `07-dark-tokens.html` —— **存在，但索引没登记**；`tokens.css` 的 `.dark` 块 | ⚠ **黑户** |
| 08 interaction-upgrades | B 折叠 → `11`；C 跨工作区在跑数 → `02:362-363` + `51:213`；A 段参考自己删了 | ✅ |
| 09 awaiting-you | `02`（侧栏 warning 标记）+ `51`（切换器两枚徽章并排） | ✅ |
| 10 checkpoint | 无对应 —— **参考项目 2026-09-17 自己废弃了**（我们走「从此处回退」） | ✅ 不是缺口 |

### P2 · 转录卡片（24 张）

| 参考 | 我们 | 判定 |
|---|---|---|
| 11 user-message | `10-transcript-text.html` | ✅ |
| 12 assistant-text | `10` | ✅ |
| 13 code-block | `10` | ✅ |
| 14 gfm-table | `10` | ✅ |
| 15 mermaid | `10`（图/源码两态）——**但参考没有全屏缩放，我们有**：见 §4.B-1 | ⚠ 我们的实现有画板没有 |
| 16 math | `10` | ✅ |
| 17 thinking | `11` | ✅ |
| 18 tool-call | `11`（时间轴改写）；原始入参折叠 ✅；`locations → 在文件面板定位` ✅ | ✅ |
| 19 tool-failed | `11`（不整卡描红，换状态图标 + `error.soft` 底） | ✅ |
| 20 tool-cancelled | `11` | ✅ |
| 21 diff-card | `11`（另加**分栏视图**，参考没有） | ✅ 略强 |
| 22 terminal-card | `11` | ✅ |
| 23 terminal-running | `11` | ✅ |
| 24 subagent | `11`（嵌套工具行 + `↳ Subagent Output` + 反馈图标） | ✅ |
| 25 permission | `12`（三档 + 范围下拉）——**核对过 `lib/approval-policy.ts:216-218`，pi 就是三档**，参考的四 kind 是 ACP 的 | ✅ 对位正确；仅文案要跟代码对齐（见 §4.C-2） |
| 26 awaiting | `12`（停靠条两态） | ✅ |
| 27 elicitation-form | `50`（扩展请求对话框四种） | ✅ 改写 |
| 28 elicitation-url | `50` | ✅ 改写 |
| 29 plan | `12`（Todo 卡） | ✅ |
| 30 context-window | `20`（统计条 + 上下文环 + 悬浮浮窗） | ✅ |
| 31 turn-state | `12`（回合结束行）——**词表用错了**，见 §4.C-1 | ❌ **错** |
| 32 content-blocks | `12`（图片 / resource_link / 音频 / embedded text 铺开 / embedded binary 退回文件卡） | ✅ 六分支齐全 |
| 33 compaction | `12` | ✅ |
| 34 agent-state | `12`（含「N 条未知会话更新已丢弃」告警） | ✅ |

### P3 · 弹层与菜单

| 参考 | 我们 | 判定 |
|---|---|---|
| 40 composer-popovers | `21-menus.html`（另加工具档 + 权限档） | ✅ 略强 |
| 41 topbar-popovers | `22-top-panels.html`（顶栏六个图标按钮的下拉） | ✅ 改写 |
| 42 inline-menus | `21`（`@` 扩成文件/会话/MCP/Todos 四类） | ✅ 略强 |
| 43 session-timeline | `22` + `53`（36px 导轨 + 320px 通高浮层，第四轮重画过） | ✅ 对位。**但两处文档落点不一致**（`README` 说落 `22`，`DESIGN-SPEC §4` 说落 `53`） |

### P4 · 其余页面

| 参考 | 我们 | 判定 |
|---|---|---|
| 50 registry | `43-settings-plugins-mcp.html`（npm 包插件 + MCP，无 registry 市场） | ✅ 改写 |
| 51 registry-states | `43` | ✅ |
| 52 auth | `41`（模型供应商订阅登录）+ `56`（agent 认证提案） | ✅ 改写 |
| 53 registry-upgrade | `43` + `56`（插件/技能/应用更新） | ✅ |
| 60 files-panel | `30-files-panel.html` | ✅ |
| 61 terminal-panel | `31-terminal-browser-git.html` | ✅ |
| 70 settings | `40`–`47`（4 块 → **13 分节 8 张画板**） | ✅ **大幅强于参考** |
| 80 traffic | 无对应 —— 我们走 SSE，没有独立 JSON-RPC 流量页 | ⚠ **设计说「不做」，但 `docs/acp-agent-client-borrowing-plan` 的 AC-13 想做** → 待裁定，见 §6 |

**对位统计**：47 张参考画板里 **45 张有落点**、**2 张无对应**（`10 checkpoint` 参考项目 2026-09-17 自己废弃；`80 traffic` 我们走 SSE，没有独立 JSON-RPC 流量页）。
我们的 29 张里，**5 张是参考项目没有的独有面**：`52` 文件查看器其余形态 / `53` 转录辅助件 / `54` 扩展与探索分支 / `60` 移动端 PWA / `61` 系统状态；
另有 `40`–`47` 把参考的 1 张设置画板拆成 8 张（13 个分节）。

---

## 4 · 三类实质缺口

### A · 三张「黑户」画板 + 6 处自相矛盾

`05-motion.html` `07-dark-tokens.html` `56-agent-management.html` 存在于磁盘，但：

```
grep -n "05-motion\|07-dark\|56-agent" DESIGN-SPEC.md README.md index.html   →  0 命中
grep -c 'class="nm"' index.html                                              →  26  （实际 29 张）
```

并且规范里留着**直接矛盾**的话：

| # | 位置 | 现在写的 | 与什么矛盾 |
|---|---|---|---|
| 1 | `README.md:260` | 「05 motion → 并入 token 表（**本项目不做独立动效画板**）」 | `05-motion.html` 就在同一个目录 |
| 2 | `DESIGN-SPEC.md:112` | 「**动效只记时长**：120ms / 160ms，`ease-out`，不弹跳」 | `05-motion.html` 有 8 个值（含 200ms / 8px / 4px / 40ms / 0.5） |
| 3 | `assets/tokens.css:16` | 「动效只记时长：120ms / 160ms，ease-out，不弹跳」 | 同文件 `:133-140` 就定义着那 8 个值 |
| 4 | `DESIGN-SPEC.md:277` | 60 号画板 =「…**底部控件条**、「更多控件」底部弹层…」 | `60-mobile-pwa.html:380` 明写「**没有「底部控件条」**」 |
| 5 | `DESIGN-SPEC.md:287` | ≤380 「其余控件收进「更多控件」**底部弹层**」 | `60-mobile-pwa.html:147` 「窄屏「更多控件」= **顶栏**展开（不是底部条）」 |
| 6 | `README.md:105` | 覆盖审计里同样写着「底部控件条、更多控件弹层」 | 同 #4 |

**根因**：第四轮改完画板后只改了画板，没回头动三份文档；第二~四轮的改动也没进 README 的变更记录。
**后果**：任何人（包括下一个 AI 会话）读 `README` + `DESIGN-SPEC` 会得到与画板相反的设计意图——这正是参考项目用「先看 DIVERGENCE + 追加式变更记录」挡掉的那类事故。

> 另有一处不算矛盾但会误导：`DESIGN-SPEC.md:301` 写「不加 § 4 未列的页面或功能」，
> 而 §4 **根本没有 05 / 07 / 56** —— 按字面读，这三张画板是违规产物。

### B · 漏画的 4 处真实界面（我重做了组件审计，workbuddy 那轮漏的）

> 方法：`grep -ohE '^\.[a-z0-9-]+' app/*.css` → 逐类名回查 `components/**/*.tsx` 的真实使用点，剔除死 CSS。
> 剔掉的死 CSS（**不是缺口**）：`.session-history-panel` `.session-info-popover` `.chat-stats-center` `.fork-tipline`。

| # | 漏掉的功能面 | 证据（file:line） | 该补在哪 |
|---|---|---|---|
| **B-1** | **Mermaid 全屏缩放查看器**：`<dialog>` + 布局 + 工具栏 + 步进器 + 百分比 + 适配/重置/关闭，是独立于卡片的一套 UI | `components/MermaidBlock.tsx:169`（`mermaid-zoom-dialog`）、`:181-182`（`-layout` / `-toolbar`）；CSS 里还有 `-stepper` `-value` `-canvas` `-icon-button` `-title` `-actions` | `10-transcript-text.html` |
| **B-2** | **文件查看器的 diff 覆盖层**：顶栏一个「对比」按钮 → 整块覆盖成 git diff + 顶部横幅（含「返回源码」）；与「已删除文件的 diff」复用同一层 | `components/FileViewer.tsx:2529`（`file-viewer-diff-toggle`）、`:2738-2747`（`file-viewer-diff-overlay` / `-banner`） | `52-file-viewer-modes.html` |
| **B-3** | **文件被删除提示**：对比关掉后没有内容可渲染，就出一条 `role="status"` 说明而不是空面板 | `components/FileViewer.tsx:2735`（`file-viewer-deleted-notice`） | `52-file-viewer-modes.html` |
| **B-4** | **文件实时同步指示**：路径右侧一枚 6px 圆点，`fs.watch` 在跟 = success + 4px 光晕，没跟 = border；title 有两句文案 | `components/FileViewer.tsx:2483`（`file-viewer-live-indicator`）、`:2481`（`i18n.liveSync` / `i18n.notWatching`） | `30-files-panel.html` |

**已核过、确认不算缺口**（省得下一轮重复劳动）：
`useChatAppearance`（= 设置里的聊天宽度/字号两行，`40` 已画）、`session-info-popover` / `session-history-panel`（死 CSS）、
`mermaid-zoom` 之外的 `image-preview-*` / `csV` / `frontmatter`（`52` 已画）、`file-viewer-load-more` / `-meta` / `-mode-switch`（`30` / `52` 已画）、
lease（纯 SSE 保活，无 UI）、`file-watch`（文件树自动刷新，无独立 UI）、`app-update`（`56` 已画）。

### C · 画错的 1 处（这条比较重要）

#### C-1 · 回合结束行的 `stopReason` 用了**参考项目的词表**，不是 pi 的

画板 `12-transcript-interactive.html:221` 标题写「**五种 stopReason**」，正文列的是：
`end_turn` / `max_tokens` / `max_turn_requests` / `refusal` / `cancelled`。

**这是 ACP（Zed）的词表。pi 的真实取值是 7 个**：

```ts
// node_modules/@earendil-works/pi-ai/dist/types.d.ts:292
export type StopReason = "pending" | "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred";
```

核对：`grep -rn "end_turn\|max_turn_requests\|refusal" lib/ components/ hooks/ app/` → 应用里**一次都没出现过**
（`refusal` 的两处命中是 enabled-models 的英文注释，无关）。
应用真正处理的是 `error` / `aborted` / `length`（`lib/message-display.ts:37,50`、`lib/session-title.ts:265,268`、`lib/subagent-runtime.ts:97`）。

**根因**：这是「画板照着参考项目画，而不是照着本项目的数据画」。
参考项目用 `materials.md` §4 的**覆盖矩阵**（每个协议投影面 → 落在哪张画板）挡这一类错误，我们只做了「组件 → 画板」审计，
而 stopReason 是**数据字段**不是组件，于是整条漏出去。

**顺带**：`docs/acp-agent-client-borrowing-plan-2026-09-28.md` §8 待核项第 3 条「stopReason 还有哪些取值」
现在有答案了，可以关掉。

#### C-2 · 一处文案没跟代码对齐（小）

`12-transcript-interactive.html:40` 写「**本会话内始终允许**」，
`lib/approval-policy.ts:216` 的真实标签是「**本次会话总是允许**」。三档结构本身是对的。

---

## 5 · 你提的四条

### 5.1 目录选择器 —— 成立，而且比你以为的更彻底

**事实**（都在代码里）：

| 文件 | 内容 |
|---|---|
| `lib/pick-directory.ts:1-9` | 头注释：「**优先系统原生选择器**。桌面版（Electron）走 `POST /api/cwd/pick`，服务端拉起系统对话框；浏览器里没有这个能力…」 |
| `app/api/cwd/pick/route.ts` | macOS = `osascript choose folder`；Windows = PowerShell `FolderBrowserDialog`；Linux = `zenity` → `kdialog` → `yad`；平台不支持时返回 **501 + `{fallback:true}`**；用户取消返回 `{cancelled:true}` |
| `components/SessionSidebar.tsx:1285` | 已经在调 `/api/cwd/pick` |
| `components/DirectoryPicker.tsx`（29 KB） | **是浏览器里的回退**：自绘目录浏览器 + 新建/重命名/删除文件夹 |

**画板**：`grep -rn "cwd/pick\|pick-directory\|系统选择器\|系统对话框" design/` → **0 命中**。
`50-login-dialogs.html` 只画了自绘浏览器那一态。

**所以这不是「要不要改」的问题，是「画板漏了主路径」**。改法：
`50` 的目录选择器段拆成两态 —— **A · 本机/桌面（系统原生对话框，画板用「已交给系统」的说明块表示，不画 OS 界面本身）**、
**B · 浏览器回退（现有自绘浏览器）**，并在 `DESIGN-SPEC §4` 与 `DIVERGENCE` 各记一句。

### 5.2 登录 —— 成立

**事实**：
- `proxy.ts:33` `if (!isWebPasswordEnabled(password))` → 访问 `/login` **302 回 `/`**。没设 `PI_WEB_PASSWORD` 时这页根本到不了。
- `components/SettingsPanel.tsx:915` `{webAuthEnabled && …}` —— 「退出登录」只在启用密码后才渲染。

**画板里现在有它的地方（3 处要清）**：
1. `50-login-dialogs.html` 整个「登录页（可选 · 默认不启用）」段（含 A/B/C 三态）
2. `40-settings-general.html:46`（左导航末位「退出登录」）+ `:204-207`（分节正文）
3. `index.html:231-233`（导航卡片标题仍是「登录与对话框」）

**改法**：`50` 的**编号不动**（README 约定「编号只增不改」），改名「**对话框**」，删登录段；
`40` 删两处；`index.html` 同步。这样「没有登录」就是画板的事实，而不是在画板里写一段解释。

> 更彻底的做法是把 `app/login/` + `app/api/web-auth/` + `proxy.ts` 的密码分支一起删掉 —— 那是**产品改动**，等裁定。

### 5.3 动效 —— 成立，且「半成品」比「完全没有」更麻烦

**事实**：
- `05-motion.html` **已经存在**，内容也不差（4 类转场 A/B/C/D + 8 个 token + 时间轴示意 + 「不做的事」）。
- 但它是**黑户**（§4.A），`README` 还写着「本项目不做独立动效画板」。
- **29 张画板里只有 1 处是真动效**：`assets/board.css:180` 的 `pw-sweep`（侧栏运行中扫掠线）。其余 28 张全是静态图，**看不出动画**。
- **应用里其实已经有 14 个 keyframes 在跑**，一个都没进动效规范：

  ```
  fork-sheet-up（抽屉上滑）   fork-tipline-in（提示线入场）   fork-shimmer（骨架微光）
  fork-row-in（列表行入场）   fork-stream-enter（流式内容入场） extension-widget-update-pulse
  drop-zone-in / drop-ripple（拖放）   spin / pulse
  notice-shelf-in / notice-shelf-out（通知条进出）  saved-pop / saved-check-draw（保存成功）
  ```
  另有 **13 处** `prefers-reduced-motion: reduce` 兜底，和 `useTheme` 的主题切换 `view-transition` 圆扩散。

**参考项目 05 画得比我们细的地方（可直接借格式）**：
1. **每个转场一张属性表**：`属性 | 起→止 | 时长 | 曲线 | 延迟 | 备注`（我们只有一句话描述）
2. **明确列出「哪些不动」**：线程头按钮 / 输入框 / 左侧栏 / 右栏 / 顶栏 / 滚动位置 / 已展开的折叠状态
3. **反例清单**：不做旧内容淡出、不做横滑、不做缩放、**新旧内容任何一帧都不得同时可读**
4. **轻量交互规格**：hover 进出同一条 120ms；**active 按下不做过渡、松开才走 120ms**；**焦点环不做过渡**；展开折叠 160ms
5. **明确写「本画板不含什么」**：不含流式内容出现动效、不含骨架屏、不含整页转场与回弹
6. **成组错开的封顶规则**：步长 40ms、**最多 3 项**，第 4 项起不延后

**改法**：先登记（1 行 README + 1 节 DESIGN-SPEC + tokens.css 头注释），
再把 05 的覆盖面从「4 类转场」扩到「4 类转场 + 悬浮/按下/焦点/展开的轻量规格 + 应用里那 14 个 keyframes 的归类」，
并**给画板加可播放的演示元素**（同一张画板里放 `<style>` 驱动的 CSS 动画，`prefers-reduced-motion` 下停住）。

### 5.4 查漏汇总（回答「有缺的吗」）

| 类别 | 数量 | 明细 |
|---|---|---|
| 漏画 | **4** | Mermaid 全屏缩放 / 文件 diff 覆盖层 / 文件被删除提示 / 文件实时同步指示 |
| 画错 | 1 | 回合结束行的 stopReason 词表（§4.C-1） |
| 文案未对齐代码 | 1 | 权限档第二档标签（§4.C-2） |
| 文档自相矛盾 | 6 | §4.A 那张表 |
| 支撑设施缺 | 4 | PNG 基准 0 张 / 覆盖矩阵无 / 修订简报无 / 变更记录只有 1 条 |

---

## 6 · 修复清单（按优先级）

| P | 项 | 改动面 | 工作量 |
|---|---|---|---|
| **P0** | 三张黑户登记进 `README` + `DESIGN-SPEC §4` + `index.html`；改掉 §4.A 那 6 处矛盾 | 3 份文档 | 0.5h |
| **P0** | 回合结束行词表改成 pi 的 7 值（`stop` / `length` / `toolUse` / `error` / `aborted` / `pending` / `deferred`），每种给一句人话 | `12` 一张画板 | 1h |
| **P1** | 删登录：`50`（改名「对话框」）+ `40` 两处 + `index.html` | 3 个文件 | 0.5h |
| **P1** | 目录选择器补「系统原生对话框」主路径，自绘浏览器降为回退态 | `50` + `DESIGN-SPEC §4` | 1h |
| **P1** | 动效：登记 + 05 扩到「轻量交互规格 + 14 个 keyframes 归类」+ 画板加可播放演示 | `05` + `00` + 3 份文档 | 3h |
| **P2** | 补画 4 处漏画（Mermaid 缩放 / diff 覆盖层 / 删除提示 / 实时指示） | `10` `52` `30` | 2h |
| **P2** | README 变更记录补第二~四轮（从 workbuddy memory 搬）；补「状态（已实现）」列与「token 变更」列 | `README` | 1h |
| **P3** | 出 PNG 基准（`render-boards.mjs` 全量跑一遍，产物入库） | 脚本 + 29 张 PNG | 0.5h |
| **P3** | 建 `materials` 式覆盖矩阵：把「SSE 事件 / 数据字段 → 画板」列成表（挡住 C-1 那类错误） | 新文档 | 2h |

---

## 7 · 需要你裁定的三处冲突

1. **动效要不要进产品代码？**
   画板 05 是纯规格图，落地要写进 `app/*.css`。但应用里已经有 14 个 keyframes 且各自有 `prefers-reduced-motion` 兜底——
   是「按 05 统一重做」，还是「保留现状、只把 05 补成对现状的记录」？

2. **登录是只从画板删，还是产品也删？**
   只删画板：`README` 里那句「登录是可选的」还留着，`app/login` + `proxy.ts` 的密码分支保留（公网部署时有用）。
   连产品一起删：`app/login/`、`app/api/web-auth/`、`proxy.ts:33` 起的密码分支、`SettingsPanel.tsx:915` 的退出登录块。

3. **`80 traffic`（RPC 流量面板）到底做不做？**
   设计（`README` 对位表 + `DIVERGENCE`）写的是「无对应 · 不做」；
   但 `docs/acp-agent-client-borrowing-plan-2026-09-28.md` 的 **AC-13 / PR-11** 明确要做「设置 → 调试 → RPC 流量」。
   两边现在互相打脸，得挑一个。

---

## 附 · 本报告用到的关键命令（可复现）

```bash
# 1) 三张黑户：是否存在、是否被索引
ls design/pi-web-design/*.html | wc -l                                    # 29
grep -c 'class="nm"' design/pi-web-design/index.html                      # 26
grep -n "05-motion\|07-dark\|56-agent" design/pi-web-design/{README,DESIGN-SPEC}.md design/pi-web-design/index.html

# 2) 组件 / 类名 查漏
for p in components/*.tsx components/fork/*.tsx; do n=$(basename "$p" .tsx);
  grep -rq "$n" design/ || echo "MISS $n"; done
grep -ohE '^\.[a-z0-9-]+' app/{globals,fork-ui,settings,wallpaper}.css | sort -u

# 3) stopReason 真值
grep -n "export type StopReason" node_modules/@earendil-works/pi-ai/dist/types.d.ts
grep -rn "end_turn\|max_turn_requests" lib/ components/                    # 应为空

# 4) 目录选择器
sed -n '1,12p' lib/pick-directory.ts
grep -rn "cwd/pick" components/ app/api/ lib/
grep -rn "cwd/pick\|pick-directory\|系统选择器" design/                      # 0 命中

# 5) 动效资产
grep -n "@keyframes" app/*.css
grep -n "@keyframes\|animation:" design/pi-web-design/assets/board.css

# 6) 画板健康度
node design/pi-web-design/scripts/check-boards.mjs
```
