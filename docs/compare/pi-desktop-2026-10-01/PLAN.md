# PI-Desktop 对比结论与 PR 拆分计划

日期：2026-10-01
对手：`vastsa/PI-Desktop` 0.16.0-beta.1（6.2k star）main 快照 + **58 个 open PR / 742 个历史 PR**
我方：`@agegr/pi-web` 0.1.6（PI NEXT）

五份分报告（本目录）：
| 文件 | 领域 |
|---|---|
| `01-feature-parity.md` | 功能/能力 |
| `02-layout-visual.md` | 布局/视觉/设计系统 |
| `03-interaction-ux.md` | 交互/细节手感 |
| `04-open-pr-triage.md` | 58 个 open PR 逐个判定 |
| `05-architecture.md` | 架构/可移植性/门禁 |

---

## 0. 结论先行

**上一轮（2026-09-24，`PD-01…PD-22`）已经吃透了。** 五份报告各自用 grep 复核，结论一致：22 条里 18-19 条已落地、PD-03 部分、PD-04/05 未开工、**0 条漏**。所以本轮**不重复**导入 / 项目归档 / 模型高级参数 / 文件查看器 / PWA 布局这五条线。

**58 个 open PR 的判定分布**：直接可 cherry-pick **1** / 需移植 **14** / 已覆盖 **11** / 不建议 **32**。

**三分之一的 PR 直接判死**，原因是一条硬事实：他们 20 个 PR 的生产代码只落在 `packages/agent-runtime/`（他们**重写了一遍 pi**，137 个源文件）或 `crates/host-core/`（Rust sidecar）。这两层我们没有——我们用官方 pi SDK 的进程内 `AgentSession` + `.jsonl` 真源。方向对也改不动。

**本轮真正的三个来源**，按性价比排序：
1. **我们代码里已确认的缺陷**（IME、子代理模型覆盖、LAN 无鉴权）——不需要"借鉴"，是修 bug。
2. **门禁缺口**（架构行数、i18n key、重活上限、会话归属契约）——都很小，但它们是后面所有改动不腐化的地基。
3. **上游 open PR 里的真需求**（14 个需移植，约 1700 行 / 16 人天）。

**明确不做**：SSH 远程主机 + RACP、config sync 全量、自建 SQLite 表、provider 原生联网搜索、9 语言 i18n、多账号 OAuth、Linux 打包。理由见 §4。

---

## 1. 已亲自复核的三条（本计划的地基）

不是转述 agent 结论，是本轮自己读的代码：

**① `lib/subagent-runtime.ts:286`**
```ts
const requestedModel = parseSubagentModel(parentModelRuntime, request.model ?? profile.model);
```
`request.model`（Task 调用参数）**压过** `profile.model`（用户在 `components/AgentsConfig.tsx:719` 的模型下拉里显式钉的）。用户在 UI 上配的模型会被 agent 传的参数静默覆盖。上游为这件事在 main 上翻过两次车（MERGED #305、#318）。

**② `components/ChatInput.tsx:2517`**
```ts
if (slashMenuOpen && slashQuery !== null) {          // ← 缺 !isComposing
```
同文件三个兄弟菜单都有：`historyMenuOpen && !isComposing`（:2494）、`referenceMenuOpen && !isComposing`（:2565）、`atMenuOpen && !isComposing`（:2590）。**一个 `&&` 的遗漏。** 中文输入法组字时按方向键/Enter 会被斜杠菜单吃掉。
另：`handleInput`（:2675-2684）只做自动增高，不做 `isComposingRef` 兜底复位。`onCompositionEnd`（:3696）确实会置 false，所以"卡住"不是必现，但**缺 settled-input 兜底**（compositionend 丢失的环境会永久失键）。上游为此有专项脚本 `scripts/e2e-composer-ime-stack.mjs`。

**③ `proxy.ts` + `package.json:34,37`**
`start:lan` / `dev:lan` 绑 `0.0.0.0:30141`；`proxy.ts` 的 matcher 只有 `/` 和 `/api/:path*`，`isTrustedRequest` 是同源/本机防护（代码注释原话："**本产品没有登录**"），`lib/request-security.ts` 只防 rebinding 不做身份。**今天就在无凭据暴露一个能读全部 `~/.pi` 的 agent。** 这条与"要不要做远程主机"无关——是现状漏洞。

---

## 2. PR 拆分（32 个，分 6 批）

> 排序原则：先合零风险小改动，再碰热路径（`ChatInput` / `MessageView` / `ProcessGroup` / `AppShell`），画板相关的最后。每批一次 `npm run check:design` + `npm run verify:boards` + `npm test`。

### Batch 0 — 止血（3 PR / ~1 天）

| PR | 内容 | 文件 | 代价 | 依据 |
|---|---|---|---|---|
| **PR-01** | IME 三件套：① `handleInput` 加 settled-input 兜底复位 ② `:2517` 补 `&& !isComposing` ③ 抽 `lib/ime.ts` 统一 `isImeEvent(e)`（含 `keyCode===229`），替换 `ChatWindow.tsx` 六处重复判据 | `ChatInput.tsx`、`ChatWindow.tsx`、新 `lib/ime.ts` | S（~40 行 + 2 条测试） | 上游 `e2e-composer-ime-stack.mjs` |
| **PR-02** | 子代理固定模型优先于 Task 参数（`request.model ?? profile.model` → profile 优先，`?? parentModel` 兜底） | `lib/subagent-runtime.ts` | S（+30 −5 + 3 单测） | 上游 #973 + MERGED #305/#318 |
| **PR-03** | `start:lan` 加共享令牌：未设 `PI_WEB_LAN_TOKEN` 时拒绝启动；`proxy.ts` 校验 `Authorization: Bearer`；e2e 断言「无令牌 401」 | `proxy.ts`、`package.json`、`e2e/` | S（~150 行） | 本轮 §1③ |

### Batch 1 — 门禁（5 PR / ~2 天）

全是新脚本 + 一份 baseline JSON，不改运行时。**它们必须在 Batch 2+ 之前合**，否则后面的改动没有回归网。

| PR | 内容 | 代价 | 为什么 |
|---|---|---|---|
| **PR-04** | `scripts/check-architecture.mjs`：新 `.ts/.tsx` ≤800 行（存量豁免进 baseline）+ 纯逻辑模块禁 import `node:*` | S | 我们最大文件 4096 行，是他们上限的 5 倍；`lib/import/types.ts` 拉 node 层已经真炸过一次 `next build` |
| **PR-05** | i18n key 门禁：扫 `t("…")` 字面量，断言 `en/zh-CN/zh-TW` 三份词表齐全 + key 数 >300（防扫描器静默失效） | S（~60 行） | 今天引一个不存在的 key，UI 上只显示原始 key，没有任何检查能抓住 |
| **PR-06** | `lib/limits.ts`：把 `app/api/file-index` + `lib/import/*` 的上限常量集中登记，每条加「超限截断而非抛错」断言；file-index git 超时 10s→4s、buffer 64MiB→32MiB | S | 单进程下这是唯一会卡死整个 Web 服务的路径 |
| **PR-07** | 「会话不属于浏览器 tab」契约测试：断言 `events/route.ts` 走 `getRpcSession`/`startRpcSession` 而非按连接建会话；e2e 断开重连后 id 与历史不变 | S | 这是我们架构的免费红利（单进程 + 文件真源），他们花 1537 行 `agent-host` 才建立；不钉住会静默退化 |
| **PR-08** | 浏览器级 e2e 网：`e2e/composer-ime.mjs`、`composer-paste.mjs`、`transcript-scroll.mjs` | M | Batch 0 的三个 bug 之所以存在，就是因为没有这层网 |

### Batch 2 — 小功能补齐（7 PR / ~4 天）

高价值 + S 代价、不新建存储、不引新进程。**每条独立可回滚。**

| PR | 内容 | 落点 | 依据 |
|---|---|---|---|
| **PR-09** | **Ask 工具**（结构化提问，单选起手） | 新 `lib/ask-tool-extension.ts`（照 `lib/todo-extension.ts:58` 的 `registerTool` 写法）+ `components/AskToolCard.tsx` | agent 猜错一整轮的成本远高于写一个 150 行工具；`extension_ui_request` 通道已通 |
| **PR-10** | **应用内指令编辑器**（写 `AGENTS.override.md`/`AGENTS.md`/`CLAUDE.md`） | 新 `app/api/instructions/route.ts` + `components/InstructionsPanel.tsx` | pi 自己的 context 发现顺序就认这些路径 → **零新存储，完全 pi 原生**。现在 `SystemPromptPanel.tsx:11` 明写"只读" |
| **PR-11** | **网络代理设置**（bypass 语义对齐上游 `network_proxy.rs:24`） | 新 `app/api/settings/network-proxy/` + `lib/network-proxy.ts`；出网口只有 `lib/http-dispatcher.ts` 一处 | 国内网络下这是"能不能用"级别 |
| **PR-12** | **deny-first 权限叠加**（tools/paths/commands 永拒，bypass 下也生效） | `lib/approval-policy.ts:26` 现在写死「bypass 是硬约束」→ 默认配置下**没有任何硬边界**。复用 `pi-web-preferences.json`，零迁移 | 上游 #457，~150 行纯 TS。**有产品语义，需先拍板** |
| **PR-13** | 上下文菜单键盘可达：开菜单 rAF focus 首项、卸载还焦、`Shift+F10`/菜单键 + `pointForEvent` 锚定 | `components/ContextMenu.tsx` | 现在方向键导航事实上不可用，键盘用户打不开菜单 → WCAG 2.1.1 |
| **PR-14** | Composer 模型行显示「上下文 · 输出上限」+ 从选择器直接打开模型设置 | `components/ModelSelector.tsx:16-20` 现在一个 token 都不显示 | 上游 #1039 + #1010，共 ~70 行 |
| **PR-15** | 提示音音色选择 + 试听（`lib/sound-presets.ts` 的 4×4 库用户根本选不到） | `components/SettingsPanel.tsx` | 上游 #1239，~70 行。不做本地上传音频（与零资产路线冲突） |

### Batch 3 — 交互手感（6 PR / ~5 天）

| PR | 内容 | 代价 | 依据 |
|---|---|---|---|
| **PR-16** | **Disclosure anchor**：展开/折叠块时锚住被点的标题（notifier/restore/release/isHeld 四件套），接进 `ChatWindow` 已有 ResizeObserver | M | 现在点开任一工具块，被点的标题会向上跑掉。上游 128 行 hook + 专项 e2e |
| **PR-17** | 三合一小改：通知条按 `notice.type` 切 `role="alert"`/`status`；自动折叠不抢焦点/选区；平滑流式开关（`prefers-reduced-motion` 时自动关） | S×3 | 偏好落 `settings.json`/localStorage，**不建表** |
| **PR-18** | `window.confirm` → 应用内两段式确认（`ARMED_DELETE_MS=3200`），先改删文件 + rewind 历史两处高危 | S+M | 原生模态在 PWA/Electron 下与视觉割裂；`SessionSidebar` 已有行内两段式可参考 |
| **PR-19** | 压缩韧性：压缩后 todo 清单不丢（改 `promptGuidelines` 措辞，10 行）+ 压缩失败时的确定性退化描述（纯函数，90 行） | S×2 | 上游 #1275 + #688。砍掉他们的"重复 call id 归属"规则（我方 id 不重复） |
| **PR-20** | 实时 tok/s + 首输出耗时 TTFT | M（~220） | 我们完全没有速率/延迟可观测性。**只能做估算路线**（流中拿不到 provider usage），UI 必须标 `≈`。上游 #418 |
| **PR-21** | 会话顶栏「…」操作菜单（侧栏收起时也能管理当前会话） | M（~120） | 上游 #1030。delete 的两步 armed 状态要从 `SessionSidebar` 上提 |

### Batch 4 — 布局重构（5 PR / ~10 天，画板纪律）

> 每条都先改画板，再改产品，最后补 `DIVERGENCE.md`。**一条建议都不涉及降低门禁。**

| PR | 内容 | 代价 | 依据 |
|---|---|---|---|
| **PR-22** | 折叠判据从 React state 改成 CSS 容器查询（`container-type: inline-size` + `@container` 3–5 档），去掉 `useIsNarrowControls` | M | 跨档不再触发重渲；**是 PR-23 的前置** |
| **PR-23** | **右栏改单列**（树在上/查看器在下），面板默认宽 760 → ~420，删掉「开文档自动加宽到 760+60」补丁 | L | **本轮价值最高**：1440 屏上侧栏 280 + 面板 760 只剩 400 给聊天。画板 30/31/52 重画 + 49 份 spec 重新对位 |
| **PR-24** | 三栏预算改「侧栏先让」（`MAIN_PANE_MIN_WIDTH=450` 硬地板 + 不足时自动折叠侧栏）+ **收编或删除第四个断点 960** | M + S | `SPLIT_PANEL_MIN_WIDTH=960` 不在 `DESIGN-SPEC.md` §4 的三档里 → **纪律缺口**（`DESIGN-SPEC` 明文禁止画板另取断点）。PR-23 完成后可删，否则必须登记 |
| **PR-25** | 会话行 `height` → `min-height`（运行态改行内标记），虚拟化改「测量 + 单一套 + 偏移表」 | L | 现在状态一变整列重排；且 `lib/ui-density.ts:8-12` 自己承认密度开关碰不到侧栏。画板 02 五帧重画。**有回归风险，需实测滚动** |
| **PR-26** | 设置从 560px 模态改整页 + 275px 常驻导航 + 分组 + 搜索 | XL | 一次性解决 `DIVERGENCE` U-1 那 6 处接线偏离（多半是"560 模态里塞 12 分节"的代偿）。画板 40–47+62 全量重画 + 24 份 spec 重对。**必须排在 PR-23 之后**（它会重设所有"内容区宽度"基准） |

### Batch 5 — 大功能（6 PR / XL，按需启动）

| PR | 内容 | 代价 | 前置 / 风险 |
|---|---|---|---|
| **PR-27** | **裸文本路径 → 可点文件**（含 `path:line`） | L（~320） | 上游 #1207+#1149。**最大最险**：他们的 `splitChatText` 预切段会和我们 `MarkdownBody.tsx:339-350` 的 `splitStableParts` 流式 interning 冲突，正确落法是写 remark 插件。上游为此开 3 个 PR 关 2 个 → 没有便宜方案。**动手前先量基线** |
| **PR-28** | `@agent` 提及路由到子智能体 + 选中文字作为输入框注记（不塞进编辑区） | M×2 | 上游 #1101 + #923。**@agent 必须在 linkify 之前**，否则 `&`/`#`/`/`/`@` 四种触发符要先定优先级 |
| **PR-29** | 文件树拖进 Composer | M（~120） | 上游 #786。复用 `hooks/useDragDrop.ts` + `lib/file-mentions.ts:toCwdRelativeMentions` |
| **PR-30** | MCP 官方 registry 市场目录（公开 API，不是他们的私有资产） | S | 我们已有 MCP 管理面板可挂载 |
| **PR-31** | 设置页「导出/导入配置」（带 version 的 JSON，不做远端/合并） | S | 覆盖"换机器"需求，成本是 config sync 的 1/50，不引入第二真源 |
| **PR-32** | 插件「装之前先亮权限」（解析 `pi.extensions` 入口，列出它会注册的工具/命令） | S/M | 他们有 `permissions`/`fs`/`net` 三层声明；我们只有来源可检查性。不需要 marketplace 就能对齐 |

---

## 3. 只读核查（0 行代码，先做再决定排期）

| # | 查什么 | 为什么 | 成本 |
|---|---|---|---|
| CHK-1 | `thinkingLevelMap.off` 的 effort-only 阶梯是否会阶梯错（上游 CLOSED #648） | 若成立，会在 xAI 上稳定 400 | grep 一个字符串 |
| CHK-2 | 容量耗尽是否被误报成「key 无效」（上游 MERGED #1115） | 单进程 Web 服务把 OOM/超时说成"key 无效"是误导性报错 | 只读 |
| CHK-3 | 2000 会话下的真实搜索耗时 | 我们是 4s 线性扫描 + 50 条截断；**值不值得升级取决于这个数** | 造数据跑一次 |
| CHK-4 | 停止会话时在途 MCP 调用是否被取消（上游 #1000 系列） | 现在停会话只能等 MCP 超时 | 只读 |

---

## 4. 明确不做（附理由，避免下一轮再议）

| 不做 | 理由 |
|---|---|
| SSH 远程主机 + RACP（3125 + 2400 行） | 与"单机 Web 应用"形态冲突。`start:lan` + 令牌 + 反向代理已覆盖 90% 场景 |
| config sync 全量（8191 行 Rust / 10 域） | 同步域里有 3 个我们不存在的实体（providers/projects/plugins），抄 = 造第二真源。**PR-31 的导出/导入是它的 1/50 成本版本** |
| 自建 SQLite（他们 21 张表） | 真源是 pi 的 `.jsonl`。15 张能用派生视图替代（我们已有 `pi-web-session-index.json` 按 (size,mtime) 指纹失效的派生索引 = 对应物）、3 张明确不抄（turn_queue/session_todo/projects）、只有 FTS 索引真需要新建——而它值不值得先看 CHK-3 |
| provider 原生联网搜索 | 他们打了 3 张 pi 补丁（38 个 dist 文件）才做成。我们 pi 0.87.0 里 `grep -rl hostedSearch` 零命中 → **不可平移** |
| 多账号 OAuth | `auth.json` 每 provider 只存一份凭据，SDK 限制 |
| 自建加密凭据库 / 跨会话投递账本 / scratch 目录 | 第二真源 / 要 SQLite / 工具写入路径由 SDK 拥有 |
| i18n 追到 9 语言 | 我们词表基数只有他们 1/5，加第 4 种的相对代价更高。**只抄那条 60 行的 key 门禁（PR-05）** |
| Linux 打包 | 先问有没有 Linux 用户，别先做 |
| 10 档圆角 / 13 档字阶 / 零强调色 / 24px composer 圆角 / 折叠不留导轨 / mascot GIF | 他们的品牌选择或 macOS 原生能力。我们有画板禁图片素材 + 无帧动画流水线。这六项在 `DIVERGENCE.md` 登记一下，免得反复议 |

---

## 5. 需要用户拍板的三件事

1. **PR-12 deny-first 权限**：默认 bypass 下引入拦截是产品语义变更（用户会第一次被工具调用挡住）。做不做？
2. **Batch 4（布局）要不要现在启动**：价值最高（PR-23 直接把聊天区从 400px 放回 680px），但要重画 3 张画板 + 49 份 spec 重新对位，且 PR-26 是 XL。
3. **PR-27 裸路径 linkify**：用户天天撞，但与流式渲染 interning 冲突、要写 remark 插件，上游试了 3 次。是否值得排 Batch 5 第一位？
