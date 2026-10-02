# 上游对齐落地计划（fork ↔ agegr/pi-web）

日期：2026-10-01 · 审计基线：本 fork `main` @ `e34c1c6` · 上游 `agegr/main` @ `e17d2cc`（已过 `v0.9.3` tag）

原始审计报告（三份，含逐条证据）在本目录：

| 文件 | 内容 |
| --- | --- |
| [`upstream-audit-2026-10-01/feature-gap.md`](./upstream-audit-2026-10-01/feature-gap.md) | 功能级差异：上游有我们没有的 10 条真缺口（G1–G10）+ 12 条「我们已有等价」+ 结构差异 |
| [`upstream-audit-2026-10-01/closed-prs.md`](./upstream-audit-2026-10-01/closed-prs.md) | 上游 588 个 PR 的审计：87 个已合并未收、275 个 closed-unmerged 的筛选结论 + Top 10 |
| [`upstream-audit-2026-10-01/commit-coverage.md`](./upstream-audit-2026-10-01/commit-coverage.md) | 123 个上游 commit 逐条判定：已有 59 / 缺失 61 / 不确定 1，含「刻意移除不要补」D 档 |
| [`upstream-audit-2026-10-01/model-config.md`](./upstream-audit-2026-10-01/model-config.md) | 模型配置专项：上游字段全集 + 两边逐项判定 + 模型类 closed PR 复核（PR-12 / PR-13 的依据） |
| `upstream-audit-2026-10-01/cherry-pick-feasibility.txt` | 123 个上游 commit 逐个跑三方合并的可行性（100 CONFLICT / 18 ok / 5 SAME） |

---

## 0. 一页结论

1. **参考目录 `pi参考项目/pi-web-main` 不是 v0.9.3，是上游 `agegr/main` 的 HEAD**（逐文件 blob 比对 776/776 一致）。
   本 fork 的基线是 **v0.9.1**，所以真正的差距是 **v0.9.1 → e17d2cc 共 123 个非 merge commit / 87 个已合并 PR**。
2. **用户可见功能上我们并不落后**：cron、记忆、导入、SkillHub、CodeMirror 编辑器、内置浏览器、Git 图谱、Electron 打包这些上游完全没有的东西，我们一大堆。
   逐 commit 判定：123 条里 **已有 59 / 缺失 61 / 不确定 1**；缺失的 61 条中真正要做的约 **30 条**（其余是内部重构与已刻意移除项），工作量约 **15 人日**。
2b. **但缺失里混着两条真·安全/数据问题，且我们代码里已复现**（详见 PR-2）：第三方扩展/MCP 返回文本里的路径会获得文件访问授权（`lib/session-file-references-core.ts:64`）；`models.json` 解析失败被吞成空配置，下一次保存会抹掉全部 provider（`lib/models-config-store.ts:69`）。
2c. **「模型配置不全」的真实形状不是缺功能，是缺入口**（`model-config.md`）：我们的 `ModelsConfig.tsx` 比上游还大（2762 vs 2273 行），Refresh catalog、enabledModels、思考档、**temperature/top_p** 都有；缺的是 **7 条「后端字段已在、UI 没控件」**（重试策略、配额芯片、输入上限/提示词缓存、压缩预算、思考档 token 预算、思考档记忆预填、空值请求头行），以及 6 条真要改行为的（保存后热重载、规格回填、阶梯定价、协议扩充、compat 开关、重命名被静默丢弃）。→ PR-12 专门吃这些便宜的。
2d. **MCP 不能删我们的**（§3.11）：pi 0.99 的 MCP **不导出**（上游自己用 442 行去加载未导出的内部模块），且上游那份**还没接线**；我们的 1464 行是配置管理器（握手校验 / 跳 agent 发现 / OAuth 命令），pi 不会替代。正确顺序是 PR-1 → PR-11。
3. **最大的单点是依赖**：本 fork 锁 **pi SDK 0.87.0**，上游 **0.99.1**。上游大量能力（MCP 原生、subagent 控制面、工具 exposure、ADR 0006）都建立在 0.99.x 的 SDK 表面上，在 0.87 上照抄会静默失效。
4. **不能 cherry-pick**：`git merge-tree` 逐个测，123 个 commit 里 **100 个冲突**。落地方式只能是**按能力手工移植**，沿用现有 `docs/patches/` 台账流程。
5. **上游 closed PR 里值得拉的只有 6–10 条**（275 条里 40% 是维护者批量清理，且最大两类「会话组织重设计」「文件管理是 agent 的活」在我们这儿已经自己做完了）。

---

## 1. 事实基线（已核验）

| 项 | 本 fork | 上游 `agegr/main` |
| --- | --- | --- |
| 基线 / HEAD | v0.9.1 → `e34c1c6`（274 个自己的 commit） | `e17d2cc`，已过 `v0.9.3` tag（53 个 commit） |
| pi SDK | **0.87.0** | **0.99.1** |
| next | 16.3.5（**未含 GHSA-vcvr-r3jv-pc5j 修复**） | 16.3.6 |
| 文件规模 | app 106 / components 190 / hooks 34 / lib 493 | app 81 / components 101 / hooks 18 / lib 298 |
| 改动面 | 1000 个文件 | 555 个文件，**其中 200 个与我们重叠** |
| 打包 | Electron（通用包 / nsis / AppImage） | 无 |
| 门禁 | `check:design` / `verify:boards` / `check:contrast` + 对比度 CI | 无设计门禁 |
| 单测 | 2000+ | ~170 |

> ⚠️ **执行前必读**：本 fork 与上游 **没有共同祖先**（历史被改写过），`git merge agegr/main` 不可用；也不要拿上游的 `next.config.ts` / `ci.yml` / `.gitignore` 直接覆盖（会毁掉跨平台打包与设计门禁，见 `feature-gap.md` §3）。

---

## 2. 四条差距轨道

| 轨道 | 内容 | 规模 | 处置 |
| --- | --- | --- | --- |
| **A. 上游已合并、我们没有** | 87 个 PR（`closed-prs.md` §2 / `commit-coverage.md`） | 其中真缺 **4 条** | PR-1 / PR-5 / PR-7 |
| **B. 功能级真缺口** | G1–G10（`feature-gap.md` §1.1） | 约 15 人日 | PR-2 … PR-7 |
| **B2. 安全 / 数据完整性** | `b3c7255` `499aa4f` `fe288c0` `162a749` | 4 条，都有我们代码里的复现点 | **PR-2** |
| **C. 上游 closed-unmerged** | 275 条，真值得拉 **6–10 条** | Top 10 见 `closed-prs.md` §4 | PR-9 |
| **D. 我们独有、台账没记** | 8 块（Electron 打包 / Git 图谱 / 跨 agent 导入 / SkillHub / CodeMirror / 归档 / 通知提示音 / 收藏模型） | 0 代码 | **PR-10**（纯文档，但保护下一次合并） |
| **E. 模型配置补齐** | 「后端已有只差 UI」7 条 + 真要改行为的5 条（`model-config.md`） | 约 6 人日 | PR-12（A 批，最便宜）/ PR-13（B 批）/ 待决 1 条 |

另有 **待决**：`G7 密码网关（PI_WEB_PASSWORD + /login）`——上游为「远程部署的 Web 服务器」设计，我们默认单机 + Electron + 绑 127.0.0.1，**本轮不做**，除非确定要支持局域网/公网暴露。

---

## 3. PR 拆分（按依赖顺序，逐个可独立评审）

每个 PR 一条分支，从 `main` 切，完成后合回 `main`。**每 PR 只做一件事**，可独立 revert。

### PR-0 · 基线清理（0.5h，无代码）

- **为什么**：当前工作树有 **75 个文件被改动/删除**（另一个会话正在做「cron / memory / prompts 分节清理」）。脏树上做任何移植都无法给出可信的验收结论。
- **动作**：等那批改动落 commit → 建 `main-clean` 备份分支 → 确认 `git status` 干净、`npm test` 绿。
- **DoD**：`git status --porcelain` 空；`npm test` 全绿。

### PR-1 · 依赖升级：pi 0.87.0 → 0.99.1（上游 `d0bf6be` / #931，**地基**）

- **为什么**：上游 MCP、subagent 控制面、工具 exposure、ADR 0006 全建立在 0.99.x 的 SDK 表面上；`next` 16.3.5 **含已知 RCE（GHSA-vcvr-r3jv-pc5j）**，而 next 是精确锁版本，不升就永远拿不到修复。
- **做什么**：
  - `@earendil-works/pi-{agent-core,ai,coding-agent,tui}` 0.87.0 → 0.99.1，`next` 16.3.5 → 16.3.6，`eslint-config-next` → 16.3.6，`semver` 7.8.5、`undici` 8.11.0。
  - 适配 SDK 变更：`prompt()` 的 `preflightResult` 由 boolean 变 `"handled" | "queued" | "started"`；`steer()` / `followUp()` 也有 disposition；工具新增 `exposure`（`direct` / `model-only` / `codemode` / `deferred` / `hidden`）——**这条直接改我们 `lib/tool-presets.ts` + `lib/rpc-manager.ts` 的工具开关语义**，是我们 Chat-only / 权限档位 / 子代理工具集的地基。
  - **不要**照抄上游 `ansi_up` / `remark-*` 挪 devDeps 的那部分（我们 CodeMirror / markdown 相关依赖是真在服务端用的）。
- **风险**：**最高**。SDK 跨 12 个 minor。单独一个 PR，不夹带任何功能。
- **DoD**：`tsc --noEmit` 0 · `npm test` 全绿 · `npm run lint` 0 error · `npm run prod` 构建成功 · 起服后跑一遍真实会话（发消息 / 工具调用 / 压缩 / 子代理 / fork）。
- **回报**：解锁 MCP 正解（上游 #893/#900 被关的唯一理由就是「先升 pi」）。

### PR-2 · 安全与数据完整性（4 条，**都有我们代码里的复现点**，S×4）

上游 `commit-coverage.md` B 档里最该先做的四条。这四条**不依赖 SDK 升级**，改完就能收。

| 编号 | 问题 | 我们的复现点 | 量 |
| --- | --- | --- | --- |
| `b3c7255` | **安全**：只有编码工具的结果才算「授权来源」；现在**每条 entry 的每个字符串**都参与路径匹配 → MCP / 第三方扩展返回的文本里塞一个路径就拿到文件访问授权 | `lib/session-file-references-core.ts:64-71`（同文件 76 行已有 bash 专用的 `isBashOutputPathReferencedByEntries`，缺的是那道闸） | S |
| `499aa4f` | **数据丢失**：`models.json` 带注释时 `JSON.parse` 失败被 `catch` 吞成 `{providers:{}}`；下一次保存把整份 draft 覆盖回去，所有 provider 消失。读不出来时应**禁用保存并报原因** | `lib/models-config-store.ts:69-72` | S |
| `fe288c0` | **安全**：打开文件夹前先 `stat()` 再查白名单，用 400/403 的差别探测路径是否存在 | `app/api/open-in-explorer/route.ts:36` vs `:41` | S |
| `162a749` | 子代理的 `ext:` 禁用名单认得出扩展别名与 npm 作用域写法，不能被绕过（我们已有 `exclude_extensions` / `ext:` 解析） | `lib/subagent-settings.ts` / 代理档案 frontmatter 解析 | S |

- **为什么排这么前**：前两条是**别人能用我们的产品造成的事**（越权读文件、配置被抹），不是体验问题；改动面都很小。
- **DoD**：每条补单测（越权路径必须在入口被拒；坏 `models.json` 保存按钮禁用且给出原因；不存在路径与越权路径返回同一状态码；别名写法被拒）+ 手工复现一次。

### PR-3 · 渲染兼容与文本修复（上游 #1019 / #1015 / #971 / #972 / #976）

| 编号 | 内容 | 依据 | 量 |
| --- | --- | --- | --- |
| G5 | Safari / iOS 16.2 首页白屏：`mdast-util-gfm-autolink-literal@2.0.1` 的 lookbehind 正则 Safari 解析不了 → 整 chunk SyntaxError。加 loader（**写成 `.mjs`**，我们的 `next.config.mjs` 不能换回 `.ts`）+ `transpilePackages: ["mermaid", ...]` | #1019 / `f52fd84` | S |
| — | 用户消息里的换行被吃掉 | #1015 / `faeff03` | S |
| — | 自动链接在 CJK 标点处误伤 | #971+#972 / `4a5081a` | S |
| — | 行内公式旁的货币格式 | #976 / `6a97d0b` | S |

- **为什么放最前**：G5 **我们现在就有这个 bug**（实测 node_modules 就是 2.0.1 + lookbehind，且 `next.config.mjs` 无 loader）；其余三条是纯 bugfix，无设计决策。
- **DoD**：上面四条 + `npm run prod` + Safari/iOS 16.2 真机（或 Playwright WebKit）过一次。

### PR-4 · 扩展 UI 排队（G3，上游 `70470ca` / `e17d2cc` / `46b5235`）

- **为什么**：`hooks/useAgentSession.ts:366` 是**单槽** state。并行工具各自被权限扩展 gate 住时，后一个请求顶掉前一个，**前一个的服务端 future 永远不 resolve**。我们的 `lib/approval-extension.ts` 是这类交互的主要来源，这是真 bug 不是新功能。
- **做什么**：新增 `lib/extension-ui-queue.ts`（上游 45 行，可整份照搬）；单槽 → 按 id 排队；SSE 重连重放同 id 不重复入队；服务端已关但关闭事件因断流丢失的陈旧请求按 id 集合裁掉；`ChatWindow.tsx:2090` 单个 `ExtensionDialog` → `.map()`。
- **量 / 风险**：M / 低。**DoD**：单测覆盖「两个请求同刻到达」「重连重放」「陈旧 id 裁剪」+ 浏览器实测并行审批两个工具。

### PR-5 · 会话与流正确性（上游 #1023 / #1008 / #1009 / #997 / #1016 / #1017 / #990 / #991 / #987）

- G8 **运行中也能 fork**（#1023）：`ChatWindow.tsx:2203` 现在硬编码 `sessionBusy || isNew ? undefined : handleFork`。
- G9 **压缩中显示「正在压缩」**（#1008）：我们已有 `isCompacting`，只差 `fork/PhaseRoll.tsx` 相位表的优先级。
- 历史编辑分支时机（#1009）· SSE 每客户端 backlog 上限（#997）· Stop/reap 无法收尾的运行（#1016/#1017）· 子代理重启后成孤儿（#990/#991/#987）。
- **量 / 风险**：G8 S–M、G9 S、其余 S–M / 中。G8 看着一行，实际落在 session 写入路径，单独 commit、单独测。

### PR-6 · 文件与工作区（G1 / G2 / #825 / #790 / #981）

- G1 **让 Git 决定文件树隐藏什么**（#1014）：现在 `IGNORED_NAMES` 写死黑名单 → 被 gitignore 的 `secret/` 照列，被 git 跟踪的 `build/` 反而看不见。改用 `git check-ignore --no-index` + `git ls-files --cached` 兜底。新增 `lib/file-tree-visibility.ts`（上游 157 行）+ files 路由 list 分支接线。**注意列表会等 git（上限 5s）**，`lib/git-status.ts` 已踩过 git 阻塞的坑。
- G2 **符号链接目录显式放行**（#1018）：`lib/linked-directory.ts` + 一个确认弹层，只授权这一条、不放宽全局 roots；lstat 校验 + realpath 变更 409。
- 面板可调宽（#825）· 文件面板全宽切换（#790）· 目录选择器新建目录（#981）。
- **量 / 风险**：每条 M / 中。

### PR-7 · 设置面板与 composer（G4 / G6 / G10 / #1001 / #1020 / #1021）

- G4 **技能/插件按组全开全关**（#1020）+ 分组标题行开关（#1021）：我们只有单项开关，连 i18n key 都没有，且设置面板是我们重画过的，要按画板重抄（`npm run verify:boards` 会量）。
- G6 **发送键可配**（Enter / Ctrl+Enter，#1001）：`ChatInput.tsx:2482` 现在写死 `Enter && !shiftKey && (!isMobile || ctrl/meta)`。
- G10 **Enter 续 Markdown 列表**（#884）：依赖 G6（Enter 腾出来才有意义）；顺带把我们的 `markdown-list.ts` 补上 thematic break / 代码围栏 / `1、` 中文顿号。
- **量 / 风险**：M+S+S / 中。G4 要过设计门禁。

### PR-8 · 模型 / provider 小修（#969 / #1006 / #871 / #938 / #844 / #833）

上游返回了但我们丢弃的字段、provider 目录发现端点、provider 名保存、新会话模型选择不写全局默认、provider 用量相对时间。全部小补丁，按需挑，**可与 PR-7 合并评审、分开 commit**。

> 你说的「模型配置功能不全」，逐字段对完的完整清单在 [`upstream-audit-2026-10-01/model-config.md`](./upstream-audit-2026-10-01/model-config.md)（含上游字段全集、两边逐项判定、模型类 closed PR 复核）。
> 先看结论：**我们的 `ModelsConfig.tsx` 反而比上游大（2762 vs 2273 行）**，可编辑字段更多（多 `thinking`），Refresh catalog、enabledModels、思考档全都有，而且**比上游还多三样**：`samplingParams`（temperature / top_p 任意请求参数编辑器，`ModelsConfig.tsx:965`）、`thinkingLevelMap` 自动推导（`lib/model-catalog.ts:112-135`）、收藏模型。
> 真缺的在下面两批。

### PR-12 · 模型配置补齐 A 批：**后端已有、只差一个 UI 入口**（最便宜，先做）

这七条的共同点：**pi 的字段/类型/路由已经在我们树里了，只是没有控件**。零协议改动、零新依赖。

| # | 缺什么 | 用户少了什么 | 落点 | 量 |
| --- | --- | --- | --- | --- |
| A1 | 模型级**空值请求头行会被写进 models.json**，静默覆写父 provider 的同名 header | 请求头莫名变空（**上游 main 也有这个 bug**，两边都没修） | `components/models-config-helpers.ts:66-73` | XS |
| A2 | `settings.retry.{enabled,maxRetries,baseDelayMs}` 无 UI（现在 `autoRetryEnabled` 只被读出来透传） | 网络抖动只能吃 SDK 默认 3 次 / 2000ms | 新增 `lib/retry-settings.ts` + `app/api/retry-settings/route.ts` + 设置页 General | S–M |
| A3 | `app/api/provider-usage/route.ts` 已有（与上游逐字一致），**聊天输入框上没有配额芯片** | 写代码时看不到额度 | `components/ChatInput.tsx` | S |
| A4 | `ModelInputLimits`（含 `images.resize`）/ `ModelPromptCache` 是 pi-ai 原生字段，`ModelEntry` 类型里根本没声明 | 多模态与提示词缓存的规格配不了 | 类型 + `ModelsConfig.tsx` | S |
| A5 | `settings.compaction.{reserveTokens,keepRecentTokens,modelOverrides}` / `branchSummary.reserveTokens` 无控件 | 压缩预算 / 保留量 / 压缩用哪个模型都改不了 | 设置页 | M |
| A6 | `settings.thinkingBudgets.{minimal,low,medium,high}` 无控件（`SettingsManager` 甚至没有 setter） | 各思考档的 token 预算不可配 | 设置页 | M |
| A7 | `lib/thinking-level-memory.ts` + 路由已有，但**聊天侧思考档选择器不预填** | 每次都要重新选档 | `components/ChatInput.tsx` | S |

**DoD**：每条补单测（尤其 A1：空值行不得落盘）；设置页改动要过 `npm run verify:boards`。

### PR-13 · 模型配置补齐 B 批：真需要改行为

| # | 缺什么 | 用户少了什么 | 上游依据 | 量 |
| --- | --- | --- | --- | --- |
| B0 | **provider 重命名会被静默丢弃**：`editingName` 是组件内 state（`ModelsConfig.tsx:397`），改名后不点 Rename 直接 Save，重命名就没了 | 输入框里改了名字，保存后没生效且无提示 | 上游 bug #903 / PR #969 | S |
| B1 | **保存 models.json 后不热重载活会话** | 改完 baseUrl/headers/apiKey，正在跑的会话还用旧配置，得重启或等 10 分钟空闲回收。`rpc-manager.ts:885` 已有 `modelRuntime.refresh({allowNetwork:false})` 可直接用 | PR #482② | S |
| B2 | **模型规格不能从 provider 自己的 `/models` 回填** | 私有网关 / vLLM / 自建端点，catalog 查不到只能手抄 | PR #957 | S（只做回填）/ M（含优先级 UI） |
| B3 | `cost.tiers` 阶梯定价无编辑器 | 长上下文阶梯计价的模型，费用显示与实际扣费对不上（pi-ai `types.d.ts:780` 有 `ModelCostTier`） | 双方都缺 | M |
| B4 | `api` 协议只支持 4 种（`API_OPTIONS` 写死） | bedrock-converse / mistral-conversations / azure-openai-responses 选不了 | 双方都缺 | S（数据）+ M（协议适配测试） |
| B5 | `compat` 只有 2 个布尔开关 | `supportsToolSearch` / `supportsAdditionalTools` / `supportsOpenAIGrammarTools` 等只能手改 JSON | 上游同样只统计数量 | S–M |

### 模型配置 · 待决（不进本轮）

**「全局默认模型 / 默认思考档没有显式入口」**（星标、per-session / per-project / 全局三层区分）——上游 `#871` 全线缺失（无 `lib/default-preferences.ts`、无 `app/api/models/default/`、ModelSelector 无 `onSetDefault`、无 `defaultThinkingLevel` 字段），我们这边对应代码已被删（`startup-preferences` 那条路），而 `AGENTS.md:186` 还留着旧描述（见 §3.12 的 `6a1246e`）。
**先把 §3.12 里的实测跑完**（「新建会话 → 选模型 → 重开，看 `settings.json` 变没变」），确认我们要不要「显式默认模型」这个概念，再决定 L 级工作量开不开。

### PR-9 · 上游 closed-unmerged 精选（逐条人工接线，`closed-prs.md` §4）

| 序 | PR | 内容 | apply -3 | 建议 |
| --- | --- | --- | --- | --- |
| 1 | **#615** | Chromium 150+ 剥掉 Origin 端口导致全站 403 | CLEAN | **人工评审后 apply**（放宽 Origin 校验，安全边界） |
| 2 | **#998** | 有委派工作的会话不算 idle | NOBLOB | 只抄 `isBusy()` 语义，别抄 artifact-mtime 扫描 |
| 3 | **#840** | 写文件卡片上显示本轮 Diff | CONFLICT(3/10) | 取 `SplitPatchView.tsx`，UI 按画板 53 重画 |
| 4 | **#713** | 项目级回收站 | CONFLICT(5/18) | 取 `lib/session-trash.ts` + 2 路由，UI 自绘 |
| 5 | **#957** | 自动填 context window / max output tokens | CONFLICT(3/8) | 只取 limits 解析，**丢弃**它点名的 discoveryState 重构 |
| 6 | **#710** | 会话拖拽排序 | CLEAN | 只取纯模块 `lib/session-order-state.ts`，UI 后置 |
| 7 | **#861** | 一键 60 秒关机倒计时 | CONFLICT(1/11) | 先过产品评审 |
| 8 | #918 / #481 | 重试开关 / 模型请求头覆盖 | — | 排队 |

**明确放弃**（理由见 `closed-prs.md` §4.1）：Lite 系列 #984/#999–#1004 · MCP #893/#900（正解是 PR-1）· #911 第二套插件契约 · #832/#831 程序化 dispatch · #510 ask_user · 以及 §3.3 里「我们已有等价实现」的 11 条。

### PR-10 · 台账补录（纯文档，0.5 人日）

把 `docs/patches/README.md` 缺的 8 块补上编号：Electron 打包、Git 图谱/分支/历史、跨 agent 导入、SkillHub 市场、CodeMirror 工作区编辑器、会话/项目归档、通知偏好与提示音、收藏模型（外加 `@文件` 提及待确认）。
**为什么必须做**：Electron 打包的冲突面在 `package.json` + `.gitignore` + 构建脚本，正是下一次合并最容易漏的地方。

### 明确不做

- `demo/`（264 文件的 GitHub Pages 假后端演示站）+ `demo-pages.yml`——内部产品无对外演示需求，顺带免掉 tsconfig/eslint/依赖树的麻烦。
- 密码网关 `PI_WEB_PASSWORD` + `/login`（G7）——定位边界项，先决策再排期。
- 覆盖上游的 `next.config.ts` / `ci.yml` / `.gitignore` / `tsconfig.json`（我们的更强）。

---

### 3.9 刻意不补（上游有、我们**故意**没有）

移植时容易被当成缺口抄进来的，显式排除：

| 上游 | 为什么不做 |
| --- | --- |
| `c1e544b` `20ad98b` `beb32a9` `3e1f436` `6ad18cd`（`PI_WEB_PASSWORD` + `/login` + Basic Auth + 限速 + 跨源跳转拦截） | **用户裁定删除**：`proxy.ts:19-27` 有注释「本产品没有登录」。默认单机 + Electron + 绑 127.0.0.1，除非决定支持远程部署，否则整段不补 |
| `4857da3` `96966e5` `demo/` + `demo-pages.yml` | 对外演示站，内部产品无需求；顺带免掉 tsconfig/eslint/依赖树的麻烦 |
| `040fadd` `0876cf4`（版本号） | fork 自己的 0.1.x 发版线 |
| `ea8a278`（细滚动条悬停显形） | 我们的 Codex 皮肤用实心边框体系，不是 macOS overlay 滚动条；`fork-ui.css` 里没有 `.scrollbar-subtle`，**待设计裁定而非移植** |
| `58c1a21`（`.gitignore` 补两条）、`5b96a9d` `6edbecb` `ed7a4d7`（上游 AGENTS.md 补文档） | 低成本，但我们的 `.gitignore` / `AGENTS.md` 有自己的约定，按需捡 |

### 3.11 MCP：结论是**不要删我们的**，顺序错了会更糟

你问「pi 底层原生支持 MCP 了，能不能把我的 mcp 去掉直接用它」。查完的结论是**不能直接换**，理由是三层的，都可验证：

**1. pi 没有「导出的」MCP 可用。** 装着的 0.87.0 `dist/` 里连 `mcp` 字样都没有。0.99 才带三个内置扩展（`mcp` / `codemode` / `tool-search`），但**包不导出它们**——SDK 根只导出 `createMcpExtension` 工厂，扩展清单、mcp.json 编辑器、连接类、OAuth 登录助手全部未导出（上游 ADR 0006 原文）。CLI 是在自己包里从未导出的 `dist/extensions/index.js` 里 prepend 的。
上游自己的解法就是 `lib/pi-sdk-internals.ts`（**442 行**：按 file URL 加载内部模块、拒绝第二份副本、`globalThis` 缓存）+ 契约测试防 SDK 升级踩坑。

**2. 上游那份还没接线。** `pi-sdk-internals.ts` / `mcp-transport.ts` 在上游树里**只被自己的测试引用**，ADR 0006 的 Rollout 明写 P1（运行时）未启用、P2（Settings › MCP 面板）未发布。→ 现在没有「它的」可以直接用，只有两份未接线的地基。

**3. 我们的 1464 行和它不是同一层东西。**

| 我们的文件 | 行数 | 干什么 | pi 会不会替代 |
| --- | --- | --- | --- |
| `lib/mcp-validator.ts` | 620 | 启用前真实握手（`initialize` + `tools/list`，手写 JSON-RPC 因为仓里没装 `@modelcontextprotocol/sdk`），失败就不许写 enabled | **不会**。pi 是会话启动时直接连，不预校验 |
| `lib/mcp-discovery.ts` | 254 | 从 Claude Code / Codex / Cursor / VS Code 的配置里发现已有 server 并合并 | **不会**。pi 没这功能 |
| `app/api/mcp/route.ts` | 450 | mcp.json 的 CRUD 路由 | 不会（上游 P2 计划自己写一个面板） |
| `lib/mcp-auth-command.ts` | 83 | 复制 `/mcp-auth <server>` 命令（台账 0023） | **不会**。pi 的 `/mcp` 面板只在 `ctx.mode === "tui"` 渲染 |
| `lib/mcp-config-file.ts` | 57 | mcp.json 原子读写（0600 + temp + rename） | **可能会**。pi 有未导出的官方编辑器，未来可换 |

**结论**：删掉的结果是设置里只剩一个「复制命令」按钮，MCP 变成不可用。正确路径是 **PR-1（SDK 0.99）→ PR-11（移植上游运行时）→ 未来若上游 P2 落地，只把 `mcp-config-file.ts` 那 57 行换成 pi 官方编辑器**，其余全留。

> **后续（2026-10-02，`1e4dbac0` + `42f96a70`）：上表里的三行已经换了，但换的不是「删我们的」。**
> 换成的是**同一层里的官方原语**：`mcp-config-file.ts` → `loadMcpConfig`/`add`/`update`/`remove`（外面仍包
> 0600 staging + `renameSync`）；`mcp-validator.ts` → `validateMcpServerConfig`（**不再真连握手**，
> 校验失败 400 不写）；`/mcp-auth` → pi 的 `/mcp login` + `signInMcpServer`。
> `app/api/mcp/route.ts` 保留为浏览器唯一入口（响形不变，内部转发）、`mcp-discovery.ts` 保留
> （pi 没这能力）。同时运行时真的通电了（见 `docs/patches/0058-mcp-runtime.md`）。
> 这一段分析里「不能直接换」的理由 1（包不导出 → 我们自己的 `pi-sdk-internals.ts` 解决了）
> 与理由 3（不是同一层 → 配置层确实是同一层）已被推翻；理由 2（上游未接线）仍然成立 ——
> 我们比上游先接上了。

### PR-11 · MCP 运行时（上游 ADR 0006 的 P0+P1，**必须在 PR-1 之后**，M/L）

- **做什么**：移植 `lib/pi-sdk-internals.ts` + `lib/mcp-transport.ts` + 契约测试；把 `mcp`（以及后续 `codemode` / `tool-search`）以 `{ builtin: true, replaceable: true }` 加进 `rpc-manager.ts` 的 `extensionFactories`。
- **必须一起搬的三个坑**（上游 ADR 写死的，我们的产品形态全中）：
  1. **fan-out**：扩展在 `session_start` 上连全部启用的 server，而我们**每个 wrapper 都会建**（切会话 `get_tools`、自动命名、SSE 预热）→ 浏览一个会话就把所有 stdio server 拉起来常驻。
  2. **stop**：`before_agent_start` 最多等 10s 且**不理会 abort**，这段时间 Stop 按不动。
  3. **env**：stdio 传输会把整个 `process.env` 传给子进程（我们的 `PI_WEB_PASSWORD` 就在里面）→ `mcp-transport.ts` 专门洗 env。
  另外 OAuth 回调只听 `127.0.0.1`、`.pi/mcp.json` 靠目录信任继承——远程部署时都要单独处理。
- **不做**：P2 的 Settings 面板（我们已有）、P3 的搜索/编辑、P4 的 per-session 开关。
- **DoD**：一个 stdio server 能真连上并暴露工具；`PI_WEB_PASSWORD` 不出现在子进程 env；浏览会话不拉起 server；Stop 在连接等待期可用。

### 3.12 待实测（两条读代码定不了，要跑）

| 编号 | 怎么验 | 验收 |
| --- | --- | --- |
| `46b5235`（长扩展对话框标题会否撑破对话框、把取消键裁掉） | 开浏览器 → 造一个 `select` 扩展请求，标题塞 40 行 ASCII 或一段多行 SQL → 量 `.pw-modal-head`（`design/pi-web-design/assets/board.css:635`）的实际高度 vs `ChatWindow.tsx:3020-3070` 里 `ExtensionDialog` 的布局 | 头部不撑破、选项与取消键不被 `overflow:hidden`（`ChatWindow.tsx:3035`）裁掉 |
| `6a1246e`（新会话选的模型会不会被写进全局默认） | 建会话 → 选模型 → 重开，看 `~/.pi/agent/settings.json` 有没有变 | 不应被改写。**注意 `AGENTS.md:186` 还在描述已被上游删掉的 `startup-preferences.ts` 持久化路径，疑似残留 bug**，一并核实 |

---

---

## 4. 落地机制（为什么不能 cherry-pick）

`cherry-pick-feasibility.txt` 是 `git merge-tree <sha>^ main <sha>` 逐个跑的只读结果：

```
CONFLICT 100   ok 18   SAME 5
```

原因：本 fork 与上游**无共同祖先**且改动面 1000 文件，200 个文件双方都改过。
→ **每个 PR = 手工移植 + `docs/patches/NNNN-*.md` 台账 + `fork:<slug>` 标记**，与现有 46 个补丁同一套约定（见 `docs/patches/README.md`）。

分支命名：`up/<主题>` 例：`up/pi-0991`、`up/render-compat`、`up/ext-ui-queue`。
每 PR 完成后在台账追加一行「上游依据 commit / PR 号」。

---

## 5. 每个 PR 的统一门禁

```bash
node_modules/.bin/tsc --noEmit      # 0
npm test                             # 全绿（新增逻辑必须有单测）
npm run lint                         # 0 error
npm run check:design                 # 改了 UI 必跑（style-literals / motion / icons / boards）
npm run check:contrast               # 改了任何前景/背景色
npm run prod                         # 构建 + 起服 + 浏览器冒烟
```

---

## 6. 建议顺序与里程碑

```
PR-0 清理 ──► PR-2 安全/数据（不依赖 PR-1，随时可做）
           ──► PR-12 模型配置 A 批（不依赖 PR-1，随时可做）
           ──► PR-1 pi 0.99.1 ──┬─► PR-3 渲染兼容（可与 PR-1 并行）
                               ├─► PR-4 扩展 UI 排队 ──► PR-5 会话/流正确性
                               ├─► PR-6 文件与工作区
                               ├─► PR-8 模型/provider 小修 ──► PR-13 模型配置 B 批
                               └─► PR-11 MCP 运行时
PR-0 ──► PR-7 设置/composer ──► PR-8 模型/provider 小修
PR-0 ──► PR-10 台账补录（随时可做）
PR-9 全程排队，逐条单独评审
```

- **M0（今天就能做）**：PR-0 + PR-2 + PR-12 —— 两条安全/数据问题 + 一堆只差 UI 入口的模型配置，都不依赖任何依赖升级。
- **M1（地基）**：PR-1 + PR-10 —— 之后随时可以停，上游不再进一步拉开。
- **M2（正确性）**：PR-3 + PR-4 + PR-5。
- **M3（能力）**：PR-6 + PR-7 + PR-8 + PR-13。
- **M4（MCP）**：PR-11 —— 必须在 PR-1 之后，单独一条分支。
- **M5（长尾）**：PR-9 逐条。

## 7. 风险与未尽事项

1. **PR-1 是全盘最大风险**：SDK 跨 12 个 minor，`exposure` 语义变更会波及我们的工具预设 / 权限档位 / 子代理工具集。建议单独开一条分支，允许「降级回 0.87 + 只做 next/semver/undici 的安全 bump」。
2. `closed-prs.md` §2 的「我们已有等价实现」是 **grep 级判断**，标「部分」的 30 余条只做了文件级确认，采纳前需逐行核对。
3. `apply -3` 的冲突数是**瞬时快照**（审计期间工作树被并发改动过），以 `rc=0` 为准，采纳前在干净树上重跑。
4. 上游仍在推进（`e17d2cc` 是审计当天的提交），87 条清单随时会变；执行前重新 `git fetch agegr` 对一次。
5. **别把 `docs/upstream-audit-2026-10-01/` 当活文档**——它是 2026-10-01 的快照，结论过期就重跑审计，不要在它上面直接改。
6. **`pi-web-pr-inbox/` 的快照已过期**：里面 61 个 open PR 现在只剩 7 个还 open（其余 54 个已被合并或关闭）。下一次收 PR 前先重跑 `fetch.sh`。
7. **台账补录要等脏树落 commit**：cron/memory/prompts 那批改动已经删掉了对应路由，基于它们的台账判定（PR-10）会失真，commit 之后重跑一遍。
---

## 8. 执行状态（已收尾）

**全部 PR 已合入 main**，pi SDK 已升到 **1.0.0**（上游 agegr/main 还在 0.99.1）。

| 里程碑 | 内容 | 状态 |
| --- | --- | --- |
| M0 | PR-0 基线 · PR-2 安全与数据 · PR-10 台账 · PR-12 模型配置 A 批 | ✅ |
| M1 | PR-1 依赖升级（pi **1.0.0** + next 16.3.6）· PR-10 | ✅ |
| M2 | PR-3 渲染兼容 · PR-4 扩展 UI 排队 · PR-5 会话与流 | ✅ |
| M3 | PR-6 文件与工作区 · PR-7 设置与 composer · PR-8 模型小修 · PR-13 模型 B 批 | ✅ |
| M4 | PR-11 MCP 运行时 · PR-9 安全精选 | ✅ |
| — | PR-12 的 A5/A6（压缩/思考预算）· misc-tail 四条小尾巴 | ✅ |

台账新增 **0057–0061**（`docs/patches/`）。验收数据：`tsc --noEmit` 0 ·
全量 **2691/2691** · MCP 契约 **23/23（0 skipped）** · `check:design` 全绿 ·
prod 起服冒烟 6 个接口全 200。

### pi 1.0.0 升上去时被抓到的两处行为变化（都靠既有测试发现）

1. **mistral 思考档镜像漂移**：1.0 把判定依据从「模型 id 名单」换成
   `model.thinkingLevelMap` 是否存在。`lib/thinking-profile.test.mjs` 那个
   「镜像 vs 真 SDK」漂移探测器在发布当天抓到。已改成同规则。
2. **会话首刷时机**：0.99+ 把「有 assistant 消息」改成「有 user **或** assistant 消息」，
   所以首条用户消息就建盘。`lib/rpc-manager.test.mjs` 的 clone 用例断言随之改写。

### 仍未验证（要真设备 / 要人眼）

- **G5 真机 Safari / iOS 16.2 与 Playwright WebKit**（无设备）
- **`verify:boards` 逐帧对位**：需要独占 30141 与 `.next`；本轮跑了 `check:design`
  的静态四项，画板逐帧几何对位仍欠着
- **PR-6 的 `..` fail-closed**：G2 下沉后所有拿 cwd 授权的路由都 fail closed，
  单测覆盖了但没有运行时实测
- **PR-11 的 per-prompt `McpHost` 未做**：内置扩展已注册、配置面已换官方原语、运行时已通电
  （会话租约闸门挡 fan-out、`startupWaitMs: 0` 避开 stop 那段等待、真起 stdio server 拿到工具）；
  剩下的只是「每次 prompt 前比配置指纹」这一层，连接目前靠 wrapper 空闲回收关闭。
- **PR-7 两条 CSS**（分组标题开关热区、状态条间距）只能窄屏人眼验
