# AcpAgentClient 对比与借鉴清单（设计文档体系 / 会话交互 / 排障可见性）

分析日期：2026-09-28
基准：本仓库 `pi-codex`（Next.js App Router + 进程内 pi SDK + Electron 打包 + PWA）
对象：`pi参考项目/AcpAgentClient-main`（**AcpAgentClient v1.4.6**，Flutter 壳 + Rust `cdylib`，ACP 多 agent 桌面客户端，Windows x64）

> 本文回答两个问题：① 它的 `design/` 与研发流程文档体系到底强在哪、我们哪些能抄、抄到什么粒度；
> ② 它的产品能力里有哪些是我们现在缺的。
> 落地项编号 **AC-01…AC-19**（§3 文档与流程 / §4 产品能力），PR 拆分在 §6，不抄清单在 §5，待核项在 §8。

---

## 0. 先看清形态差异，别照抄

| 维度 | 本仓库 | AcpAgentClient | 对本文的约束 |
| --- | --- | --- | --- |
| 形态 | Next.js（浏览器 + PWA + Electron 壳） | Flutter 壳 + Rust 核心（frb v2，进程内 cdylib） | 它放进 Rust 的重活（registry / 安装 / PTY / fs 监听）我们只能放 **Route Handler**，且不能阻塞渲染 |
| 协议 | **进程内 pi SDK**，事件走 `/api/agent/[id]/events` 的 SSE | **ACP**（Zed 的 Agent Client Protocol），每 agent 一条 stdio 连接 | 它的「能力门驱动 UI」我们已有对应物（工具档位 + `get_tools`），但语义不同，不能直接搬 |
| 数据归属 | `~/.pi/agent/*` 是唯一真源，我们只读 | 自己只存**索引** `sessions.json`，历史靠 agent 重放 | 它的「重放期间批量 hold、命令返回后一次性释放」我们没有对应问题（我们读文件） |
| 设计产物 | **没有画板**：只有 CSS token（`app/boardui/theme.css`）+ 视觉规格 `docs/codex-skin/visual-spec.md` | 47 张 `.dc.html` 画板 + PNG 基准 + `canvas.json` | **它的 `design/README.md` 是「画板索引」，我们要抄的是骨架（索引 + 状态 + token 变更列），不是行** |
| 门禁 | `tsc` / `lint` / `npm test` + `docs/codex-skin/check-contrast.mjs` | `validate.ps1`（禁止样式字面量）+ gallery 对照 + 无头验收 | 它「把纪律变成脚本」这一点我们只做了一半 |
| 团队 | 单人 + 多个 AI 会话 | 单人（所有者裁定）+ 多个 AI 会话 + 第二个模型做审查 | **它的流程就是为这个团队规模写的，可移植性最高** |

**结论先行**：
- **过程体系**是「乱糟糟」的正解，而且成本最低 —— §3 的 8 项全是文档与一个脚本，**零运行时风险**，一次性投入约一天。
- **产品能力**里只有三项是我们现在就疼的：**回合结束行**（每轮耗时 / 结束原因）、**「等你处理」的全局可见性**、**RPC 流量面板**。其余按需排后。
- 它**没有**快捷键体系、没有命令面板、没有托盘/通知、没有发送队列 —— 这四样我们都有，属于**它抄我们**。

---

## 1. 它强在哪（读到的，不是推测）

### 1.1 `design/` 的骨架：四件套 + 一条铁律

`design/README.md` 开头钉了三条硬约束，全部是「唯一事实来源 + 只增不改 + 先看偏离」：

> 「**设计稿是功能边界**（CLAUDE.md 规则 3）：设计稿没有的功能一律不做。清单与计数以本文为准。」
> 「`.dc.html` 是设计的唯一事实来源，PNG 是审查与验收的基准。」
> 「**画板编号只增不改、不重排**；废弃的画板留『已废弃』占位。」
> 「**看画板之前先看 `DIVERGENCE.md`**。」

结构上有四样东西，我们**一样都能用**（换掉「画板」这个载体）：

1. **一张全量索引表**：`编号 | 名称 | 页面 | 设计轮 | 源文件 | PNG | 状态 | token 变更`。状态只有三值：`待实现 / 已实现（R<N>）/ 已废弃`。
2. **token 唯一来源 + 提取方向**：首个设计轮先出 `00-tokens` 画板；**只从它提炼 token 到 `lib/theme/tokens.dart`，不从页面反推**；该文件是样式唯一来源；每次设计轮结束同步更新并在「token 变更」列记一句。
3. **追加式变更记录**：每条写「起因 + 所有者裁定 + 落点 + 引用简报」，倒序追加。
4. **一画板一文件、文件名即身份**，画布与仓库两边**不各改一份**（改设计先拉回源文件、重渲 PNG、更新索引）。

**对我们的映射**：我们没有画板，但**有等价物**——`docs/codex-skin/visual-spec.md`（皮肤唯一依据）+ `app/boardui/theme.css`（颜色槽位唯一来源）+ `AGENTS.md` 的 BoardUI/排版/圆角/焦点段落。问题不是「没有规范」，而是**规范散在三个文件、没有索引、没有状态、没人回头更新**。见 AC-02。

### 1.2 `design/DIVERGENCE.md`：偏差登记簿（这是最值得抄的一件）

> 「本文记录**实现与画板不一致的地方**，一条一行，说明画板画的是什么、实现是什么、为什么、以哪边为准。」
> 「**看画板之前先看本文**。画板 PNG 是验收基准，但下面列到的那几处已经不是——以『实现是什么』那一栏为准。」
> 「**新增偏离时追加一行**，不回头改画板。格式：画板编号 · 画板画的是什么 → 实现是什么（为什么）·（轮次, 日期）。」

它解决的是一个**所有项目都会遇到的死结**：实现必然跑偏于规范（协议没数据、实现先行、规范写错），如果每处都要求回补规范会拖死开发；如果不管，验收基准就失真、后人不知道哪边为准。

三节分类是这套东西的精髓：

| 节 | 含义 | 我们的现实里对应什么 |
| --- | --- | --- |
| **A · 实现已超越画板** | 规范没写，实现先做了 | 代码里已经做了但 `visual-spec.md` / `AGENTS.md` 没写的（例：`.fork-row-enter` 入场动效、`--radius-composer`） |
| **B · 画板画错或自相矛盾** | 实现做对了 | `visual-spec.md` 里已经过时的段落（例：§7 之后被 BoardUI bridge 取代的颜色层） |
| **C · 实现有意少做或做不到** | 规范有、实现不做 | **`AGENTS.md` 现在自己写着的那条**：「已知缺口：组件的内联样式按钮没有 `:focus-visible`，`fork-ui.css` 末尾用 CSS 兜底」 |

两条边界它也写清楚了，照抄：① 只收**既成事实**，不替代「扩功能边界」的裁定（新功能仍要先改规范）；② 不要求回补规范，回补了就把对应行删掉并在索引的变更记录里记一句。

### 1.3 研发流程：轮次 / 迭代 / BACKLOG

- `ROUNDS.md`（98 KB）**只管三件事**：「哪一轮做什么画板与协议面、验收什么、开工前要所有者裁定什么」。§0 拆解原则 8 条，其中两条特别值得抄：
  - 「**每个有 UI 的轮次分两段提交：画板阶段 + 接线阶段**，接线判据是 `git diff <画板阶段收口提交>..HEAD -- lib/theme lib/ui` 为空」——把「照稿实现」变成**可执行的 diff 判据**。
  - 「**裁定门**：无推荐项的不裁定不开工」。
- `rounds/TEMPLATE.md` 是**八段任务卡**：`状态 / 目标（一句话，可证伪）/ 前置 / 交付物（文件级清单）/ 验收（表格：# | 检查 | 命令 | 期望）/ 禁止 / 代码审查（回填）/ 失败处理 / 本轮实测（回填）`。
- `iterations/TEMPLATE.md` 是**日常单位**：一个迭代一个文件、一项一行（`# | 类型 | 工作项 | 来源 | 分支→合并提交 | 验证 | 审查 | 状态`），收口四项（构建手测 / 发版 / 移出项去向 / 设计稿补注记）。
- 走轮次还是走迭代有**一句话判据表**：改契约 / 钉版本 / 新页面 / ≥3 张画板 / 结构性重构 / 新平台 / 需裁定门 → 轮次；其余 → 迭代。
- `rounds/BACKLOG.md` 是两条流程**共用的唯一入口**，每条**三行**（标题 / **产品**：用户撞上什么 / **技术**：在哪、为什么、最小修法），按 **P0–P5** 分档（「按谁会撞上、撞上有多疼」）；关闭时把技术行连同结论压成一行 `- [x]` 剪到 `BACKLOG-CLOSED.md`。

### 1.4 审查：任务书 + 门禁（solo 开发也能用）

`docs/review-workflow.md` 把「谁来审」变成一个可执行流程，且**审查者不能改代码**：

- **任务书契约入库**（`.claude/cursor-review-prompt.md`），含：范围占位符、职责边界、**逐条编号的判据清单**、三级严重级（high / P2 / P3）、**固定输出格式**（每条：`位置 / 判据 / 事实 / 最小修复`）、禁止清单（不改文件、不跑构建、不联网、不读密钥）。
- **门禁**：「审查循环不得带**阻塞性问题**收口，继续整改→复审直到清零才允许合并 `main`；低危项写明理由记 BACKLOG 后放行。禁止以『spike 会被替换』『概率低』为由跳过整改。」
- **范围收缩**：只有前两轮全量 diff，第 3 轮起只审「上一轮 findings 整改后的 diff」。
- **边界**：「审查是缺陷门禁，不负责长出方案」；「**非严重阻塞性 findings 严禁新增机制类修复**（新队列/新协议/新抽象/新配置）：只允许最小改动或记 BACKLOG」。
- **失败处理**：同一验收项整改后连续 2 次仍不过 → 写 `BLOCKED.md` 停下呼人，**禁止放宽验收标准自我通过**。

---

## 2. 我们现在的家底（对照）

| 机制 | 我们有 | 它的对应物 | 差距 |
| --- | --- | --- | --- |
| 项目约定 | `AGENTS.md`（27 KB，架构 + 坑 + 约定混在一起） | `CLAUDE.md`（五块固定结构）+ `AGENTS.md`（**只是指针**） | 缺**编号化硬规则**与「只增不改」纪律；事实与纪律混写，改一条不知道会影响谁 |
| 功能改动台账 | ✅ `docs/patches/`（编号 + 状态 + `fork:<name>` 接线标记） | — | **我们这一块比它强**，它的等价物是 `DIVERGENCE` 的 A 节 |
| 皮肤改动台账 | ✅ `docs/codex-skin/delta.md` | — | 同上，我们更强 |
| 视觉规范 | ⚠️ `docs/codex-skin/visual-spec.md`（§1–§8，含验收）+ `app/boardui/theme.css` + `AGENTS.md` 的 BoardUI 段 | `design/README.md` + `00-tokens` 画板 | 规范在**三个文件**里，没有索引、没有状态列、没有 token 变更列 |
| 偏差登记 | ❌（散落在 `AGENTS.md`「已知缺口」与各 plan 文档的「待核」里） | `design/DIVERGENCE.md` | **完全缺失**，见 AC-03 |
| 待办池 | ❌（散落在 plan 文档与聊天记录） | `rounds/BACKLOG.md`（三行 + P0–P5） | **完全缺失**，见 AC-04 |
| 任务卡 | ⚠️ `docs/specs/`（4 份规格）+ 15 份 `*-plan-*.md` | `rounds/TEMPLATE.md`（八段） | plan 文档是**一次性**的，没有执行期状态、没有验收表格、没人回头填「本轮实测」 |
| 迭代记录 | ❌ | `iterations/TEMPLATE.md` | **完全缺失**，见 AC-05 |
| 审查 | ⚠️ 有 `codexhost-delegation` 技能与子代理能力 | 任务书契约 + 0-high 门禁 + findings 回填 | 缺**固定契约**与**门禁**，见 AC-06 |
| 纪律 → 门禁 | ⚠️ `check-contrast.mjs` / `audit-tokens.mjs` / `verify-themes.mjs` | `validate.ps1`（无样式字面量、组合根行数、版本门） | 我们只门禁了颜色对比度，**没有门禁「组件里写 hex/字号字面量」**，见 AC-15 |
| 渲染回归 | ⚠️ `components/*.test.mjs`（多为源码形状断言）+ `e2e/`（Playwright） | `test/fixtures/*.jsonl` + `lib/projection/fixture_replay.dart` | 缺**用真实会话快照做的渲染黄金测试**，见 AC-14 |

---

## 3. 借鉴清单 A：文档与流程（AC-01…AC-08）

> 全部是文档与一个脚本，零运行时风险。建议**先做这一组**，它是「乱糟糟」的直接解药。

### AC-01 `docs/CONVENTIONS.md`：编号化硬规则（只增不改），`AGENTS.md` 退成指针
- **现状**：`AGENTS.md` 混着「事实（架构/文件表）」「纪律（不要写 hex）」「坑（`.next` 模式切换）」「流程（发版）」。
- **参考**：`CLAUDE.md` 五块固定结构 + 「硬性规则编号只增不改、不重排（代码注释会引用『CLAUDE.md 规则 N』）；删掉的规则留『已废弃』占位」；`AGENTS.md` 只写一句「全部约定见 CLAUDE.md，本文件只是指针，避免双份维护」+ 一份「审查者速记」（11 条压缩成可即用的判据）。
- **最小可移植版**：新建 `docs/CONVENTIONS.md`，把 `AGENTS.md` 里**属于纪律**的部分抽成编号条目（初版约 12 条：唯一真源、不要写 hex/字号字面量、上游文件只留接线 + `fork:` 标记、不动用户数据、密钥不入日志、`.next` 模式不混用、桌面打包三件套、对比度门禁、i18n 三语齐、测试必须真跑……）。`AGENTS.md` 保留事实与坑，顶部指向它。
- **验收**：`grep -c "^\*\*[0-9]" docs/CONVENTIONS.md` ≥ 10；`AGENTS.md` 顶部有指针且不再重复规则正文；CI 加一条「`CONVENTIONS.md` 里已废弃条目不删只标注」的检查（可选）。

### AC-02 `docs/ui/README.md`：UI 规范索引（把三个文件收成一张表）
- **现状**：规范散在 `docs/codex-skin/visual-spec.md`（§1–§8）、`app/boardui/theme.css`（颜色槽位唯一来源）、`AGENTS.md`（BoardUI / 排版 / 圆角 / 焦点）。
- **参考**：`design/README.md` 的画板索引表 + 三值状态 + token 变更列 + 追加式变更记录。
- **最小可移植版**：`docs/ui/README.md` 一张表，行 = **规范条目**（不是画板）：`编号 | 条目 | 唯一来源文件 | 落点（CSS/组件） | 状态 | 最近变更`。状态三值照抄：`待实现 / 已实现（<commit 或 PR>）/ 已废弃`。首批行建议 15–20 条：色板、材质、圆角、排版 52 个复合样式、控件尺寸、焦点环、动效、壁纸、主题三档、对比度门禁、`cx()` 用法、面板宽度、composer 宽度…… 变更记录段倒序追加。
- **验收**：`visual-spec.md` / `theme.css` / `AGENTS.md` 三处出现的每个规范点都能在表里找到一行（人工核对一次）；表头含「状态」与「最近变更」两列。

### AC-03 `docs/ui/DIVERGENCE.md`：偏差登记簿（三节 + 固定一行格式）
- **现状**：完全没有。已知偏离以「已知缺口」的形式散在 `AGENTS.md` 末尾与各 plan 文档的「待核」段。
- **参考**：见 §1.2（三节分类、只增编号、固定格式、两条边界、**「看规范之前先看这里」**）。
- **最小可移植版**：新建文件，三节标题照抄（A 实现已超越规范 / B 规范写错 / C 实现有意少做），格式改成我们的话：`<规范条目编号> · 规范写的是什么 → 实现是什么（为什么）·（PR/commit, 日期）`。**首批条目直接回填现有的既成事实**：
  - C 类：`AGENTS.md` 的「内联样式按钮没有 `:focus-visible`，`fork-ui.css` 末尾兜底」；「组件里仍有 257 条 lint warning（未用变量等）」；
  - B 类：`visual-spec.md` §7 之后被 BoardUI bridge 取代的颜色段落；
  - A 类：`--radius-composer`、`.fork-row-enter` 入场动效、`view-transition` 主题圆扩散 —— 都是代码先做了、规范没写。
- **验收**：三节各 ≥1 条；每条都指到具体文件/行；文件头有「看规范前先看这里」与「只收既成事实」两句。

### AC-04 `docs/BACKLOG.md`：待办池（三行格式 + P0–P5）
- **现状**：待办散在 plan 文档「待核」、聊天记录、以及我们口头说过的「已知口径缺口」。
- **参考**：三行格式（标题 / **产品**：用户撞上什么 / **技术**：在哪、为什么、最小修法）+ P0–P5 按「谁会撞上、撞上有多疼」分档；关闭时压成一行剪到 `BACKLOG-CLOSED.md`。
- **最小可移植版**：直接建两个文件。**首批条目我手上就有现成的**：用量统计 fork 会话重复计数（P2）、用量缓存残留已删会话（P3）、`lib/model-catalog-refresh.test.mjs` 被删的 3 个用例是否要恢复（P4）、`e2e` CI 任务长期失败（P2）、`npm test` 257 条 lint warning（P4）、会话列表「等你处理」缺失（P1，见 AC-12）。
- **验收**：≥8 条；每条三行齐全；P0/P1 条目必须能指出「用户在哪一步撞上」。

### AC-05 `docs/iterations/`：迭代记录（一项一行）+ 任务卡模板
- **现状**：`docs/*-plan-*.md` 是一次性的；做完之后没人知道哪条做了、哪条没做。
- **参考**：`iterations/TEMPLATE.md`（一个迭代一文件、一项一行表 + 收口 + 备注）+ `rounds/TEMPLATE.md` 八段任务卡 + 「走轮次还是走迭代」判据表。
- **最小可移植版**：`docs/iterations/TEMPLATE.md` 照抄骨架，列改成我们的：`# | 类型（fix/ux/perf/docs/tidy）| 工作项 | 来源（plan/AC/BACKLOG 编号）| 分支 → 合并提交 | 验证 | 审查 | 状态`；`docs/tasks/TEMPLATE.md` 用八段任务卡，但「禁止」段写我们的三条默认（不写 hex 字面量 / 不引新依赖 / 上游文件只留接线）。第一份迭代文件就把**本次这批改动**（导入 / 文件预览 / 用量仪表盘 / 六处修正）补记进去。
- **验收**：模板两份落地；首份迭代文件能回答「这周改了哪些、每项怎么验的、有没有移出项」。

### AC-06 `docs/reviews/TEMPLATE.md`：审查任务书 + 0-high 门禁
- **现状**：我们有子代理/委派能力，但没有固定契约与门禁，审查结果随会话消失。
- **参考**：任务书结构（范围占位符 / 职责边界 / **编号判据清单** / 三级严重级 / 固定输出格式 `位置·判据·事实·最小修复` / 禁止清单）+ 「0 high 才合并」+「findings 逐条回填采纳/不采纳理由」+ BLOCKED 呼人规则。
- **最小可移植版**：`docs/reviews/TEMPLATE.md`（判据清单直接引用 `docs/CONVENTIONS.md` 的编号条目 + 我们的常规缺陷清单）；`docs/reviews/README.md` 写三条门禁：① 阻塞级 finding 清零才合并；② 每条 finding 必须回填采纳/不采纳理由；③ 同一验收项整改 2 次仍不过 → 停下呼人，禁止自我放行。
- **验收**：用它对**下一个 PR** 跑一次真实审查，产出 `docs/reviews/<date>-<pr>.md`，findings 全部有处置结论。

### AC-07 `docs/ui/` 的「唯一来源」纪律落到 token
- **现状**：`app/boardui/theme.css` 是颜色唯一来源这条纪律写在 `AGENTS.md`，但**没有索引条目**，也没有「token 变更列」。
- **参考**：「只从 `00-tokens` 提炼，不从页面反推」「该文件是样式唯一来源，每次设计轮结束同步更新并在索引『token 变更』列记一句」。
- **最小可移植版**：并入 AC-02 的索引表（token 行 + 「最近变更」列），并加一条约定写进 `CONVENTIONS.md`：**新增颜色只能加在 `theme.css` 的语义槽位**，`globals.css` 的 bridge 负责映射，组件里只写 `var(--bg)` 这类名字。
- **验收**：索引表里 token 行的「最近变更」列至少回填最近 3 次颜色改动。

### AC-08 「纪律 → 门禁」清单（先写清楚，脚本见 AC-15）
- **参考**：它把纪律变成 `validate.ps1`（无样式字面量 / 组合根行数 / 版本门 / NOTICE 双向核对），并**在任务卡里写「违规怎么判」**。
- **最小可移植版**：在 `docs/CONVENTIONS.md` 每条规则后加一行「**违规判据**」（一句话，能被人或脚本判真假），例：
  - 「不要写 hex」→ 违规判据：`grep -rn "#[0-9a-fA-F]\{6\}" components/ app/*.css | grep -v "boardui/"` 非空。
  - 「上游文件只留接线」→ 违规判据：`git diff upstream/main -- <file> | grep -c "^+.*fork:"` 为 0 却改动 >30 行。
- **验收**：≥8 条规则带可执行判据；其中 ≥3 条能直接变成脚本。

---

## 4. 借鉴清单 B：产品能力（AC-11…AC-19）

> 按「我们现在疼不疼」排序，前三条建议本季度做。

### AC-11 回合结束行（每轮：结束原因 + 耗时 + tokens in/out + 成本）【P1】
- **它的做法**：画板 31 的回合结束行 = `stopReason` 五值徽章 + **第 6 个「失败」态**（`session/prompt` 回 JSON-RPC error 时显示错误原文，而不是伪造一个 stopReason）+ tokens(in/out) + cost + 耗时；整回合可折叠（历史轮也能折）。
- **我们的现状**：有会话级 `SessionStatsBar`（messages/tokens/cost/cache/context 环），有消息级 usage 行（`MessageView` 的 `formatUsage`），有 `stopReason` 的**文本**判定（`lib/message-display.ts` 的 `getAssistantErrorMessage` / `isAssistantTruncated`）。**缺的是「每一轮的耗时 + 结束原因徽章」**——想知道「这一轮跑了 6 分钟还是 6 秒」现在只能看时间戳。
- **最小可移植版**：在 `ProcessGroup` 的回合尾部（或 `MessageView` 的 usage 行）加一行：`stopReason 徽章 · 耗时 · in/out · $cost`。耗时用回合内 entry 的 `timestamp` 首尾差（`lib/session-reader.ts` 已经带出 entry 时间）；`stopReason: error` 显示原文、`length` 显示「输出被截断」（这两个判定已有）。
- **验收**：一条真实会话里，展开任意一轮能看到耗时与结束原因；`stopReason: error` 的一轮显示错误原文而不是空徽章。

### AC-12 「等你处理」的全局可见性【P1】
- **它的做法**：侧栏条目上的「等你处理」标记（待授权 / 待追问）+ **项目切换器上的跨工作区在跑数徽标** + agent 状态条；挂起队列按 `(agentId, requestId)` 认项，两个 agent 同时挂请求也不串。
- **我们的现状**：审批走 `ctx.ui.select` → `extension_ui_request` → **ChatWindow 的模态对话框**（`lib/approval-extension.ts` 注释写明「没有自造审批通道」），刷新后待决请求由 `rpc-manager` 重发恢复。**但若用户切到别的会话/项目，这个弹窗是看不见的** —— 会话就那么挂着，用户不知道在等自己。
- **最小可移植版**：侧栏会话行加第三类标记（已有 running / unread 两种点）：`awaiting`。数据源用 `/api/agent/running` 的同类快照扩一个字段（或新增 `/api/agent/awaiting`，返回「有待决 `extension_ui_request` 的 sessionId 列表」），顶栏/项目行显示汇总数。**不新建审批通道**，只做可见性。
- **验收**：在一个会话里触发审批 → 切到另一个项目 → 侧栏仍能看到「等你处理」标记，点回去能直接看到那张对话框。

### AC-13 RPC 流量面板（脱敏原始 JSON-RPC）【P2】
- **它的做法**：画板 80 的流量面板逐条列 in/out/stderr 的原始 JSON-RPC（**脱敏**）、方法过滤、一键复制，同源落 `logs/acp-<日期>.log`；「未知 update 变体被丢弃」有计数器进 agent 状态条。
- **我们的现状**：`/api/mcp` 面板已经证明了「把协议流量摆出来」的形态；但 pi 自己的 RPC（`session.prompt` / 事件流 / `extension_ui_request`）**没有可视化**，排障只能翻服务器日志。
- **最小可移植版**：设置 → 调试 → 「RPC 流量」页签：环形缓冲（内存 500 条 + 可选落盘），列 `时间 / 方向 / 方法 / 摘要`，点击展开原始 JSON；**必须脱敏**（Authorization / api_key / token / cookie 打码，见 AC-16）。数据源：`lib/rpc-manager.ts` 的 send/事件分发处挂一个 tap。
- **验收**：发一条消息后能在面板里看到 `prompt` 出站与 `agent_start`/`tool_call`/`prompt_done` 入站；复制出来的 JSON 里没有明文 key。

### AC-14 渲染黄金测试：用真实会话快照当 fixtures【P2】
- **它的做法**：`test/fixtures/*.jsonl` 是**真实 agent 采集的线上流**，同一份数据同时喂给 ① rust-sdk 类型反序列化契约测试 ② 前端 fixture 回放器 ③ gallery 离屏渲染 —— 「重放与实时共用同一条投影路径」。
- **我们的现状**：`components/*.test.mjs` 大量是**源码形状断言**（`assert.match(source, /regex/)`），e2e 用 Playwright 跑真实页面。渲染正确性没有「输入 → 期望输出」的黄金测试；这次「窗口切在回合中间会退化成流水账」的 bug 就是这类。
- **最小可移植版**：`test/fixtures/sessions/*.jsonl`（从 `~/.pi/agent/sessions` 里脱敏挑 3–5 条：长回合、含失败工具、含 compaction、含 fork）+ 一个把 `.jsonl` → `messages` → 分组渲染结果的**纯函数快照**测试（不需要 DOM：断言「哪个 message 进了 group、哪条是 final answer、用量行出现在哪」）。这次的时间轴修复正好用它钉住。
- **验收**：新增 fixture 后，把 `ChatWindow` 的分组逻辑改坏 → 测试必须红。

### AC-15 样式字面量门禁脚本【P2】
- **它的做法**：`validate.ps1` 里「widget 里出现颜色/字号/间距字面量」直接失败（`Assert-NoStyleLiteral`），并且**在轮次记录里留下负向验证**（「往 widget 里塞 `Color(0xFF000000)` 会被拦下，记录输出后撤掉」）。
- **我们的现状**：`AGENTS.md` 明确要求「不要再写 hex」，`fork-ui.css` 末尾有覆盖层兜底，但**没有任何脚本拦**。
- **最小可移植版**：`scripts/check-style-literals.mjs`：扫 `components/**/*.tsx`（排除白名单），命中 `#rrggbb` / `rgb(` / `fontSize: \d+` / `borderRadius: \d+` 就报错并给行号；接进 `npm run lint`（或独立 `npm run check:styles`）与 CI。首版允许白名单（`app/boardui/**`、`components/fork/usage-charts.tsx` 这类手写 SVG）。
- **验收**：故意在组件里写一个 `#ff0000` → 脚本退出码非 0；修掉 → 通过。

### AC-16 日志与诊断脱敏【P1（安全）】
- **它的做法**：日志脱敏（`Authorization` / `api_key` / `token` 打码），「密钥不入库不入日志」是一条硬规则；数据目录与卸载行为都写在文档里。
- **我们的现状**：`~/.pi/agent/models.json`、`auth.json`、MCP 配置里**真的有 key**；`pideck-doctor` 技能生成的诊断报告声称脱敏，但没有统一实现；`pi-web-prod.log` 里可能落进请求体。
- **最小可移植版**：`lib/redact.ts`（一个纯函数：对对象递归打码 `key/token/secret/authorization/cookie` 命中的字段，长串保头尾各 4 位）+ 在 ① 日志写盘 ② 诊断报告导出 ③ RPC 流量面板（AC-13）三处调用；配单测。
- **验收**：单测覆盖嵌套对象 / 数组 / 字符串内 `Bearer xxx`；诊断报告里 grep 不到任何 32 位以上疑似密钥。

### AC-17 工具卡的「取消态」与「原始入参」【P3】
- **它的做法**：工具卡五态（pending / in_progress / completed / failed / **本地 cancelled**）；`session/cancel` 后未完成卡转本地 cancelled（协议没有这个态，客户端自造）；Raw Input / Output 折叠；`locations[]` 支持「Go to File」定位。
- **我们的现状**：`ProcessGroup` 有 failed（`status === "error"`）与 `approval_rejected` 两类，有 `targets` 文件芯片；**没有「用户中断导致的取消」态**（`stopReason: aborted` 已有判定，但工具卡上不体现），原始入参的完整 JSON 也没有折叠入口。
- **最小可移植版**：`lib/step-categorizer.ts` 增加 `cancelled` 判定（aborted 回合里未闭合的 toolCall）→ `ProcessGroup` 渲染一个中性徽章；工具行加「原始入参」折叠（复用 `ToolCallView` 已有的 input 展示）。
- **验收**：中断一轮 → 未完成的工具卡显示「已取消」而不是一直转圈。

### AC-18 内嵌终端卡（长输出留在卡里）【P3】
- **它的做法**：终端卡嵌在工具卡里，**即使 `terminal/release` 也保留输出**（前端 `TerminalBuffer` 跟着卡走）。
- **我们的现状**：bash 结果走 `BashExecutionView`，长输出有「读取完整输出」按钮（`/api/agent/[id]/bash-output`）。形态上是文本块，不是终端卡。
- **最小可移植版**：`BashExecutionView` 的等宽区加「终端外壳」（顶部一行 exit code + 耗时 + 清屏/复制），输出保留在卡内可折叠。纯展示层改动。
- **验收**：跑一条输出 2000 行的命令 → 卡片默认折叠、展开后能滚、退出码可见。

### AC-19 字体四轴（中西文分轴 + 随包 CJK）【P4】
- **它的做法**：`ui_font_family` / `ui_cjk_font_family` / `buffer_font_family` / `buffer_cjk_font_family` 四轴；随包 Geist / Geist Mono / Noto Sans SC（OFL），可选字体运行时注册不入库。
- **我们的现状**：Inter（`next/font/google`）+ 中文回退 PingFang SC；**没有分轴**，也没有随包 CJK（离线/打包环境里中文可能回退到系统默认）。
- **最小可移植版**：先做「界面中文」与「代码中文」两个下拉（复用设置页已有的字体行形态），随包一份 Noto Sans SC 子集（打包体积 +2 MB 量级，需与桌面端体积基线一起评估）。
- **验收**：设置里换中文轴 → 界面中文字体立刻变；离线环境不塌回系统默认。

---

## 5. 不抄的清单

| 不抄 | 为什么 |
| --- | --- |
| **整栈换成 Flutter + Rust** | 我们是 Next.js + 进程内 pi SDK，重写收益远小于成本；它的架构优势（Rust 侧注册表/PTY/fs）在 Node 里都有等价物 |
| **GPL-3.0 代码** | 本仓库是 MIT；它的代码只能读思路，不能复制片段 |
| **画板工具链**（`.dc.html` / `canvas.json` / `render-design.ps1` / Claude Design 画布） | 我们没有画板流程；抄的是**索引 + 状态 + 偏差登记**这套骨架，不是它的载体 |
| **多 agent registry / 安装 / 认证 / 受管 Node / 六平台矩阵** | 我们是 pi 专用客户端。这是它最大的功能面，也是我们**明确不做**的方向（与 `requirements` 层面的定位有关，若将来要多 agent 再单独立项） |
| **`_meta` 键白名单机制** | 它的白名单是为「严格 ACP 投影」服务的；pi 生态需要 pi 私有能力，照抄会把自己锁死 |
| **「轮次 / 画板阶段 + 接线阶段」两段提交判据** | 适合「先出稿再实现」的流程；我们的顺序是「实现 → 截图核对」，没有稿阶段可比 |
| **两级审查执行器 + 模型 pin + 7 条运维坑 + 12 分钟耗时基线** | 强依赖它的 Windows + cursor-agent 环境；我们只需要「任务书模板 + 一个只读 reviewer」 |
| **发送队列 / steer** | **我们已有**（`ChatInput` 的队列 + steer），它那边还是「未开始」 |
| **快捷键体系 / 命令面板 / 托盘 / 通知 / 多窗口** | 它**都没有**；我们已经有（快捷键贯穿、slash palette、托盘、通知、badge、防休眠），这一块没有可抄的 |
| **会话回放的 hold/release 批处理** | 我们的历史是读 `.jsonl` 一次性拿到的，没有「重放逐条刷新」的问题 |
| **每个必须项都做五 agent × 七格实测矩阵** | 单 agent 客户端没有这个维度 |

---

## 6. PR 拆分

> 约定：**一个 PR 一个意图**，可独立 revert。A 组（文档/流程）零运行时风险，建议连做；B 组按 P 级别插入。
> 「依赖」列里 `A#` 指 AC 编号。

### 阶段 0 —— 止血（文档，预计 1 天）

| PR | 标题 | 依赖 | 主要文件 | 验收 |
| --- | --- | --- | --- | --- |
| **PR-01** | `docs/CONVENTIONS.md`：编号化硬规则 + `AGENTS.md` 指针化 | — | `docs/CONVENTIONS.md`(新)、`AGENTS.md` | ≥10 条带违规判据；`AGENTS.md` 顶部指针且不重复正文 |
| **PR-02** | `docs/BACKLOG.md`：待办池（三行 + P0–P5）+ 首批 8 条 | PR-01 | `docs/BACKLOG.md`(新)、`docs/BACKLOG-CLOSED.md`(新) | ≥8 条三行齐全；P0/P1 能指出用户撞点 |
| **PR-03** | `docs/ui/README.md`：UI 规范索引（状态列 + 最近变更列） | PR-01 | `docs/ui/README.md`(新) | 15–20 行；`visual-spec` / `theme.css` / `AGENTS.md` 的规范点都能对上 |
| **PR-04** | `docs/ui/DIVERGENCE.md`：偏差登记簿 + 回填首批既成事实 | PR-03 | `docs/ui/DIVERGENCE.md`(新) | 三节各 ≥1 条、每条指到文件行 |

### 阶段 1 —— 流程启用（文档，预计 0.5 天）

| PR | 标题 | 依赖 | 主要文件 | 验收 |
| --- | --- | --- | --- | --- |
| **PR-05** | `docs/iterations/` + `docs/tasks/` 模板 + 首份迭代记录（补记本批改动） | PR-02 | `docs/iterations/TEMPLATE.md`、`docs/tasks/TEMPLATE.md`、`docs/iterations/2026-09-28.md` | 首份迭代能回答「改了什么/怎么验的/有没有移出项」 |
| **PR-06** | `docs/reviews/` 审查任务书 + 三条门禁，并对下一个 PR 实跑一次 | PR-01, PR-05 | `docs/reviews/TEMPLATE.md`、`docs/reviews/README.md`、`docs/reviews/<date>-*.md` | 产出一份真实 findings 且全部有处置结论 |

### 阶段 2 —— 用户可感知（代码）

| PR | 标题 | 依赖 | 主要文件 | 验收 |
| --- | --- | --- | --- | --- |
| **PR-07** | 回合结束行：结束原因徽章 + 耗时 + tokens/cost | — | `components/ProcessGroup.tsx`、`components/MessageView.tsx`、`lib/process-summary.ts`(新)、i18n×3 | 任意一轮能看到耗时与结束原因；error 轮显示原文 |
| **PR-08** | 「等你处理」全局可见性（侧栏标记 + 顶栏汇总） | — | `app/api/agent/awaiting/route.ts`(新)、`components/SessionSidebar.tsx`、`components/AppShell.tsx`、i18n×3 | 切到别的项目仍能看到待处理标记并可点回 |
| **PR-09** | `lib/redact.ts` + 三处接入（日志 / 诊断 / 流量面板） | — | `lib/redact.ts`(新)、`lib/redact.test.mjs`、日志与诊断调用点 | 单测覆盖嵌套与 `Bearer`；报告里 grep 不到密钥 |
| **PR-10** | 渲染黄金测试：真实会话 fixtures + 分组纯函数快照 | PR-05 | `test/fixtures/sessions/*.jsonl`、`lib/chat-grouping.ts`(抽纯函数)、`lib/chat-grouping.test.mjs` | 改坏分组逻辑 → 测试红 |
| **PR-11** | RPC 流量面板（设置 → 调试） | PR-09 | `app/api/agent/[id]/traffic/route.ts`(新)、`components/fork/RpcTrafficPanel.tsx`(新)、`lib/rpc-manager.ts`(tap)、`components/SettingsPanel.tsx` | 能看到一次 prompt 的出入站；复制内容已脱敏 |
| **PR-12** | 样式字面量门禁脚本 + CI 挂钩 | PR-01 | `scripts/check-style-literals.mjs`(新)、`package.json`、`.github/workflows/ci.yml` | 故意写 `#ff0000` → 非 0 退出 |
| **PR-13** | 工具卡取消态 + 原始入参折叠 | PR-07 | `lib/step-categorizer.ts`、`components/ProcessGroup.tsx` | 中断一轮 → 未完成卡显示「已取消」 |
| **PR-14** | 内嵌终端卡外壳（exit code / 耗时 / 折叠） | — | `components/MessageView.tsx`（`BashExecutionView`） | 2000 行输出默认折叠、退出码可见 |
| **PR-15** | 字体四轴（界面/代码 × 中西文） | — | `hooks/useTheme.ts`、`components/SettingsPanel.tsx`、`app/globals.css`、随包 CJK 子集 | 切换中文轴立刻生效；离线不塌回系统字体 |

**批次建议**：`PR-01…PR-04` 一批合并（都是文档，互不冲突）；`PR-07 / PR-08 / PR-09` 一批（三项都是「用户能立刻感觉到」的）；其余按 BACKLOG 的 P 级别排。

---

## 7. 执行顺序与门禁

1. **阶段 0 先做**：`CONVENTIONS` / `BACKLOG` / UI 索引 / 偏差登记 —— 这四份是后面所有东西的落脚点，没有它们，后面的任务卡与审查没有判据可引。
2. **每批改动过三关**：`tsc --noEmit` → `npm run lint` → `npm test`（2129 个用例）；文档类 PR 只需 lint 与 markdown 自查。
3. **每批改动补一次偏差登记**：实现与规范不一致的地方（有意少做 / 实现先行 / 规范过时）**当场**记 `docs/ui/DIVERGENCE.md`，不要攒。
4. **每个 PR 一条 BACKLOG 闭环**：开工时把对应条目移到「进行中」，合并时压成一行剪到 `BACKLOG-CLOSED.md`。
5. **审查门禁**：阻塞级 finding 清零才合并；低危项写理由进 BACKLOG。

---

## 8. 待核项（写文档时没有证据、需要开工前确认的）

1. **我们的审批对话框**是否已经覆盖「范围选择」（只批这一次 / 一直批准）—— 我只读到 `ctx.ui.select`，选项由 `lib/approval-policy.ts` 决定，未逐条核对选项集。
2. **会话列表的 running/unread 点**是否已有「待处理」语义可复用，还是必须新加第三类状态（PR-08 的第一件事）。
3. **`stopReason` 在 pi 的会话文件里**除了 `error` / `length` / `aborted` 还有哪些取值（PR-07 的徽章分档依赖它）。
4. **随包 CJK 字体的体积代价**与桌面端体积基线（`docs/` 里记录 DMG 191 MB / EXE 144 MB）的关系 —— PR-15 开工前先量。
5. **`.github/workflows/ci.yml` 的 `e2e` 任务**长期失败（本次推送同样失败，与上一个 commit 相同），PR-12 挂钩前需要先确认它是不是应该先修。

---

## 9. 交付记录

| 日期 | 内容 |
| --- | --- |
| 2026-09-28 | 首版：读完 `design/README.md`、`design/DIVERGENCE.md`、`docs/review-workflow.md`、`ROUNDS.md`、`rounds/`、`iterations/`、`CLAUDE.md`、`docs/{requirements,design,acp-projection,zed-agent,research}.md` 与 `lib/` 目录结构；产出 AC-01…AC-19 与 PR-01…PR-15。**尚未开始实施**。 |
