# 标书套件实施计划（fork:bid-suite）v2 —— 聊天原生，零新页面

日期：2026-10-06（v2，按用户裁定修订）· 参考项目：`pi参考项目/标书功能`（易标 OpenBidKit_Yibiao）
目标：在 PI NEXT 上实现标书生成能力——招标文件进，Word 标书出，全部长在**现有界面**上。

v2 裁定（覆盖 v1）：
1. **不新增页面/工作台模块**。界面载体 = 现有的聊天流 + 文件 tab + FileExplorer + todo 徽标 + 既有阻塞对话框。真正新增的界面只有两小块：设置页一个「生图模型」分节、mermaid 块上一枚「存为 PNG」动作。
2. **提示词直接搬用参考项目**（用户裁定，不再受 AGPL 约束）：来源文件清单见 §2.2，只做格式适配，不重写。
3. 生图模型设置单独新增（唯一认可的新功能面）。

---

## 1. 为什么不是技能（v1 结论保留）

技能形态缺四样：不保证发生（确定性流程靠模型自觉）、界面看不见（`bid_ask` 浮窗做不出来）、没有工具就没有能力（生图/结构化导出）、拦不住没法度量。这正是 `AGENTS.md` §proma-00-skill-policy 的裁定。已有技能套件（`~/.agents/skills/pi-智能标书`）保留当说明文档，不作为执行路径。

## 2. 从参考项目拿什么

### 2.1 方法论（十条设计决策，v1 已提炼，摘要）

拆叶子节点并发；上下文连贯靠层级元数据不靠前文原文；提示词稳定前缀前置（缓存）；JSON 走校验-定向修复流水线、错误带具体路径；编号/映射/一级目录锁死交程序；**事实是独立数据**（生成前确认→生成中按需注入→生成后审计）；知识库非 RAG（标题+使用方式路由）；配图先提名后程序拍板；修复类操作 old_text 唯一命中才落地；Agent 只做理解性决策和文件级修复。

### 2.2 提示词与模板（直接搬用的来源，已定位）

| 内容 | 参考项目文件 | 搬到本仓 |
|---|---|---|
| 18 项招标解析逐项提示词（key/full 两档） | `client/src/features/technical-plan/services/bidAnalysisWorkflow.ts`（Main 侧同构副本在 `electron/services/technicalPlanStore.cjs getBidAnalysisTasks`） | `lib/bid-prompts.ts` |
| 废标项提取 + 三段式废标/错别字/逻辑检查 | `client/src/shared/prompts/analysisPrompts.ts`、`rejectionPrompts.ts` | 同上（Phase 5） |
| JSON 修复提示词 | `client/src/shared/prompts/jsonRepairPrompts.ts` | 同上 |
| 正文各阶段提示词（规划/生成/配图/一致性/表格/字数） | `electron/services/contentGenerationAgent.cjs` 内构造函数 | 同上 |
| Agent 公共系统提示（工作区约定/大文件处理） | `client/electron/resources/agent-workspace.md` | `/bid` 命令提示词素材 |
| 受限 HTML 规范 / 正文模板 / 配图类型对照表 | `client/electron/resources/content-generation/` | `assets/` 或随工具描述 |
| 生图 9 种画面形式与风格补丁 | `electron/services/aiImageStyles.cjs` | `lib/bid-prompts.ts` |
| 导出格式默认值 + 系统预设模板 | `electron/services/exportFormatDefaults.cjs`、`systemExportTemplates.cjs`（`ExportFormatConfig` 形状） | `lib/bid-export.ts` 模板 JSON |
| 多标段识别 / 原方案还原 / 可研提示词 | `bidSectionExtractionTask.cjs`、`originalPlanRestoration.cjs`、`feasibilityReportPrompts.cjs` | Phase 5 |

适配原则：只把「Electron Main 调 aiService」的上下文替换成「pi 工具描述 + `/bid` 编排提示词」，提示词正文逐字保留；缓存排序原则（稳定前缀前置、任务差异殿后、同数据逐字节稳定）在工具内组织 message 时保持。

## 3. 界面 = 现有功能（v2 核心）

**一个标书项目就是一个工作目录 + 一个（或几个）会话。** 状态全部落盘为文件，现有界面天然就是它的 UI：

| 易标的 UI | 本仓的现有载体 |
|---|---|
| 步骤条/向导页 | 聊天流里的阶段推进 + `todo` 工具徽标（TodoChip 已渲染）——每阶段/每节一个 todo |
| 解析结果面板 | `analysis/*.md`（一项一个文件）在 **FileViewer tab** 打开阅读；`bid_ask` 门控里给摘要 |
| 大纲树编辑器 | `outline.md`（人读、**现有编辑器直接改**）+ `outline.json`（机器快照）；改完对 agent 说「重新同步大纲」，`bid_outline` 工具校验+重编号并报告差异（沿用用户技能已设计的 md/json 双轨） |
| 全局事实编辑页 | `facts.md` 同上 |
| 逐节状态树 | `sections/<id>.md` 文件存在=已完成；FileExplorer 直接看；todo 徽标给进度 |
| 一级目录确认/逐步门控弹窗 | **`bid_ask` 工具 → `ctx.ui.select/confirm/input` → 现有 `extension_ui_request` → ChatWindow 阻塞对话框**（approval 扩展同路，零新 UI；`lib/approval-extension.ts:91` 在用） |
| 正文预览/编辑 | `sections/*.md` 在 FileViewer（markdown 渲染 + mermaid 已渲染含灯箱） |
| 导出模板编辑器 | 模板 JSON 先内置一套预设（值搬自 `systemExportTemplates.cjs`）；改模板 = 对 agent 说，`bid_export_template` 工具写 JSON |
| 导出结果 | `exports/标书.docx` 走**现有 docx 预览**（同源 iframe） |
| mermaid/生图进 Word | `MarkdownBody.tsx` 的 mermaid 块加一枚「存为 PNG」动作（浏览器端渲染→canvas→POST `/api/files` 存 `images/`）；AI 生图由 `generate_image` 工具直接落盘 |

**新增的 API 只有一条**：`app/api/imagegen/route.ts`（GET/PUT `~/.pi/agent/imagegen.json`，0600，仿 `/api/models-config` 模式）。`bid_*` 工具都在 agent 进程内直接读写项目目录，**不需要任何 bid API 路由**。

## 4. 工具族（一个 `bid` 扩展 + `/bid` 命令）

注册进 `lib/rpc-manager.ts` `extensionFactories`；编排智能在模型，确定性逻辑在工具：

| 工具 | 职责 |
|---|---|
| `bid_project` | 建项目/开项目/读状态/写阶段与配置快照（`project.json`） |
| `bid_ask` | 门控确认（ctx.ui select/confirm/input；标准四选项：继续/提出修改/回到第N步/稍后决定） |
| `bid_parse` | tender 提取（docx/pdf→带页码+表格标记的 md）、按上下文切分、逐项解析（18 项提示词照搬）、校验落 `analysis/`、单项失败不中断 |
| `bid_outline` | `outline.md`⇄`outline.json` 同步；schema+业务校验（深度/评分项覆盖）；**程序重编号**；一一对应模式锁死一级；reason 协议（replace/edit/delete/add-*/sort） |
| `bid_facts` | 全局事实存取/合并去重；编辑后清正文缓存语义 |
| `bid_knowledge` | 知识条目存取（标题+使用方式+原文素材，非 RAG） |
| `bid_plan` | 逐节点编排结果校验与程序拍板（配图数量上限分段择优、同节 mermaid/image 冲突先 AI） |
| `bid_section_context` | 子代理取料口：按 node_id 返回层级元数据+选中事实**原文**+知识**原文**+字数目标+写作铁律 |
| `bid_section_write` | 落一节正文（校验写作禁令：无 `#` 标题、无 mermaid 代码块、事实变量逐字一致） |
| `bid_edit_section` | 唯一命中替换（old_text 不唯一即拒绝并说明） |
| `bid_export` | 按模板 JSON + 大纲顺序 + sections + images 组装 docx |
| `generate_image`（imagegen 扩展，通用） | OpenAI 兼容 `POST /images/generations`（OpenAI/火山/SiliconFlow 方言），落盘返回路径 |

`/bid` 命令（`pi.registerCommand`）注入编排总提示词 = `agent-workspace.md` 思想 + 用户 9 个技能里的编排知识 + 十条决策；正文/解析子提示词从 §2.2 来源逐字搬。

**正文并发**：主会话预编排后按叶子节点派后台子代理（内置 Agent 工具 + `agent_mail` 回报），子代理经 `bid_section_context` 取料、写 `sections/<id>.md`；上下文不带前文正文。断点 = 文件粒度，天然恢复。

## 5. 目录约定（不变）

```
<cwd>/bid/<项目名>/
├── project.json     manifest：阶段状态、生成配置快照、标段、updated_at
├── tender/          tender.md（页码+表格标记）+ 原稿 + 标段范围 + 旧方案.md
├── analysis/        解析结果（一项一个 md）
├── outline.md/.json 大纲（人读 md 可在现有编辑器直接改）
├── facts.md/.json   全局事实
├── knowledge/       知识条目
├── plans.json       逐节点编排
├── sections/<id>.md 逐节正文
├── images/          mermaid PNG + AI 生图
└── exports/         docx + 模板快照
```

## 6. 分批实施（每批独立 commit + 独立验证）

- **B1 生图扩展 + 设置**：`lib/imagegen-extension.ts` + `~/.pi/agent/imagegen.json`(0600) + `/api/imagegen` 路由 + `SettingsPanel.tsx`「生图模型」分节（复用 models-config 的编辑交互）+ `generate_image` 工具 + `.test.mjs`（fetch 桩锁三方言）+ **运行时 get_tools 验证**。
- **B2 bid 骨架**：`lib/bid-shared.ts`（18 项清单/类型/目录常量，客户端纯）+ `lib/bid-extension.ts` 注册 `bid_project`/`bid_ask` + `/bid` 命令 + 运行时验证。
- **B3 提取与解析**：`lib/bid-tender.ts` + `bid_parse`（提示词照搬 bidAnalysisWorkflow）+ 解析结果以文件+门控呈现。
- **B4 大纲**：`lib/bid-outline.ts`（校验/重编号/锁死/reason 协议/md⇄json 同步）+ `bid_outline`。
- **B5 全局事实**：`bid_facts`。
- **B6 知识整理（非 RAG）**：`bid_knowledge`。
- **B7 编排与正文**：`bid_plan`/`bid_section_context`/`bid_section_write`/`bid_edit_section` + 子代理逐节写作（写在 `/bid` 编排提示词）+ todo 进度约定。
- **B8 导出**：模板 JSON（值搬 exportFormatDefaults/systemExportTemplates）+ 装配器（**引 `docx` npm 包**，纯 JS 无原生；DIVERGENCE 登记）+ `bid_export` + 交付检查清单（`【待填写】`清零/字数/图表完整）。
- **B9 配图**：`MarkdownBody` mermaid 块「存为 PNG」动作 + mermaid 校验修复回路 + 生图执行（`generate_image` + 风格补丁照搬 aiImageStyles）+ 正文引用回填。
- **Phase 5 后置**：一致性审计、废标项检查（提示词已定位，照搬）、多标段、扩写（原方案还原）、查重、可研。

**MVP = B1–B8**（生图未配时配图降级 mermaid+占位）。

## 7. 门禁（每批）

`tsc --noEmit` + `node --test "lib/bid-*.test.mjs"` + `npm run lint`；一方扩展硬性 DoD = 运行时 `get_tools` 核对（30247 端口法）；SettingsPanel/MarkdownBody 改动过 `npm run check:design`（内联几何基线只减不增）+ V5 类；`lib/client-graph-purity.test.mjs` 保持绿；`DIVERGENCE.md` 登记（`docx` npm、`generate_image`/`bid_*` 工具清单、imagegen 配置文件、mermaid 动作钮）；收口批在 `AGENTS.md` 增「标书套件」一节。

## 8. 风险

| 风险 | 处置 |
|---|---|
| 提示词搬用后上下文形状变了（aiService→pi 工具） | 逐条过一遍 message 切分，保住「稳定前缀前置」；缓存在 pi 侧同样生效 |
| 无工作台后进度可见性弱 | todo 徽标约定写进 `/bid` 编排提示词（每阶段/每节一条）；文件即状态 |
| `outline.md` 人工编辑与机器快照漂移 | `bid_outline` 每次以 md 为准重校验重编号，报告差异（用户技能已验证此模式） |
| 导出排版质量依赖模板调校 | 预设值直接搬参考项目已调好的系统模板 |
| 扫描件 PDF 无文本层 | Phase 5 前：提示用户提供文本版 |
