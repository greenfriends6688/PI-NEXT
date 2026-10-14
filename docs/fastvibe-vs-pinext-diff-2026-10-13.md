# PI NEXT × FastVibe 能力差异实测（双向清单）

日期：2026-10-13  
方法：两路并行深读，PI NEXT 读 `lib/** app/api/** components/** mobile/**`，FastVibe 读 `src/main/** resources/extensions/** src/renderer/src/components/** apps/mobile_flutter/lib/**`；逐条给出「用户看得见什么 / 在哪实现 / 是否暴露为模型工具」。两份原始清单见本文附录索引。  
**本文回答的问题**：「这个项目的功能是不是比 FastVibe 更多？」

---

## 0. 结论：**不是。两边各有对方没有的大块，是互补关系。**

- PI NEXT 计价：**≈134 项用户可感知能力**
- FastVibe 计价：**≈201 项**

（两者计数口径不完全一致——FastVibe 那份把 19 个设置分节与 9 个 `dag_*` / 14 个 `computer_*` 工具逐个计；但**数量级相当**，谁都不是谁的超集。）

**因此「在 fastvibe 基础上补充 PI NEXT 的功能」这个说法要改口径**：不是单向补齐，是**双向补齐 + 逐项裁定重叠区谁赢**。

---

## 1. FastVibe 独占（PI NEXT 完全没有）

| 块 | 能力 | 证据 |
|---|---|---|
| **电脑操控** | 14 个 `computer_*` 工具（截图/列应用/列窗口/点击/输入/按键/热键/滚动/菜单/剪贴板读写/批处理/`computer_task`）+ macOS 辅助功能授权流 + 拖拽授权浮层 | `resources/extensions/computer-use.ts`(19.9KB)、`src/main/pi/cua-bridge.ts`(1106)、`computer-grant-flow.ts`、`resources/grant-overlay/` |
| **DAG 编排** | 9 个 `dag_*` 工具 + 分层画布 UI + 节点详情（含子代理实时转录）+ 节点级停止/重试/恢复 | `resources/extensions/dag.ts`(14.9KB)、`src/main/pi/dag-scheduler.ts`(635)、`src/main/engine/dag-store.ts`、`components/dag/*` |
| **决策引擎** | Jev 决策模型 + 三个场景开关（浏览器操控 / 电脑操控 / 批量决策）+ `batch_decide` 工具 + 决策轨迹 jsonl | `src/main/engine/decision/**`、`resources/extensions/batch-decide.ts` |
| **长期记忆** | 两阶段管线（6h 静默抽取 → 后台合并写 `MEMORY.md`）+ 读路径注入 + 引用计数 + 密钥脱敏 + 立即整理/清空 | `engine/memory*.ts`、`src/main/pi/memory-agent.ts`、`resources/memories/**` |
| **SSH 远程主机** | 主机列表（含 `~/.ssh/config` 导入）/ 密钥与密码认证 / 指纹校验 / 远程部署 headless agent / 端口转发 / 主机侧手机访问 | `src/main/ssh/**`(15 个 IPC 通道) |
| **账号 + WebRTC 远程** | 登录、设备列表、官方 P2P（STUN/TURN）、NAT 穿透、远程媒体流 | `src/main/rtc/**`、`src/main/remote/**`、`engine/account.ts`(505) |
| **Goal / Handoff / Question / Present** | `/goal` 长程目标循环 + 目标面板；`/handoff` 把上下文蒸馏成新会话；`question` 多问题卡；`present` 内联展示图片/视频/HTML | `resources/extensions/{goal,handoff,question,present}.ts` |
| **Checkpoint / 重试回滚** | 重试一个 turn 时把工作区回滚到该 turn 之前 | `engine/checkpoint.ts` |
| **供应商深度** | 30+ 原生 provider、cc-switch 导入、网关探测/识别/余额、OpenAI 配额、models.dev 同步、逐模型详情（协议/思考档/上下文/价格分层）、按项目默认模型 | `engine/{providers,native-providers,cc-switch,gateway-probe,openai-quota,models-dev,model-api,context-window}.ts`、`settings/model-detail-dialog.tsx` |
| **用量账本** | append-only 每 turn 记账（删掉的会话也计入）+ 图表/热力图/模型占比 | `engine/{usage-stats,usage-ledger,pricing}.ts` |
| **网络代理** | 系统/自定义/直连三模式；同时作用于 Chromium 会话与 Node（undici/ws），fail-closed | `engine/{network-proxy,node-proxy,proxy-relay}.ts` |
| **包市场** | pi.dev 包目录浏览/搜索/安装；扩展包安装/移除 | `src/main/pi/package-catalog.ts`、`settings/extensions-settings.tsx` |
| **其余** | 自动归档、防休眠、崩溃恢复 UI、Git 写操作（stage/commit/push/pull/discard/建分支）+ AI 提交信息 + 审查侧栏（三来源 diff）、会话导入 5 源（claude-code/codex/opencode/pi/zcode）、输出重复检测、无 cwd 会话的隔离 scratch 目录 | 见附录 A |

---

## 2. PI NEXT 独占（FastVibe 完全没有）

| 块 | 能力 | 证据 |
|---|---|---|
| **文档工具** | 11 个工具：docx / xlsx / pptx / pdf 的 read / write / edit（含中文 docx） | `lib/document-*.ts`（7 文件 2,974 行） |
| **生图** | `generate_image` + 6 个预设档 + 三种请求方言（openai / agnes / google）+ 真实测试出图 | `lib/imagegen-{config,extension,shared}.ts`(929) |
| **IM 桥 + 入站机器人** | `im_send` 出站（飞书/企微/钉钉/Slack/Telegram/自定义）+ **三个真跑通的入站渠道**（Telegram 长轮询 / 微信 iLink / 飞书 device-flow 建应用）+ 扫码注册 + 白名单绑定 | `lib/{im-bridge,im-extension,telegram,weixin,feishu}-*.ts`(2,349) |
| **免 key 联网搜索** | provider 链 `searxng / bing / duckduckgo / mojeek / public`，**任意模型可用**，逐源如实报失败，SSRF 边界 | `lib/websearch/**`(859) + `websearch-extension.ts` |
| **定时任务** | once/daily/weekly/interval、会话复用模式、活跃时段与星期、运行历史、跨进程租约 | `lib/automation-*.ts`(2,203) |
| **可见终端工具** | `terminal_open / terminal_execute / terminal_read / terminal_list`——**模型与用户共用同一个用户可见的终端**（FastVibe 的终端是纯 UI，模型只能用 pi 自带 bash） | `lib/terminal-tools-*.ts` |
| **6 位配对 + 隧道** | 应用自持令牌 + 6 位一次性码（10 分钟/单次/限流）+ 内置 cloudflared quick tunnel（FastVibe 明写不再内置） | `lib/{lan-access,lan-pair,tunnel-manager}.ts` |
| **手机同步与离线** | 字节游标增量同步 + 缓存 `export?inline=1` 自包含 HTML 离线阅读 + 在场裁决 + Web Push | `lib/{mobile-sync,session-sync,presence-store,notification-plan,web-push}.ts` |
| **文件层（深）** | git check-ignore 决定可见性、项目外软链的一次性授权、文件增删改/压缩解压、文件索引、文件监听、`@` 提及、docx/PDF 预览选中引用 | `lib/{file-tree-visibility,linked-directory,file-mutations,file-archives,file-fuzzy}.ts` |
| **MCP 管理面（深）** | 配置编辑器 + 10 项精选目录（含凭证字段）+ **从 Claude Code/Codex/Cursor/VS Code 发现导入** + 密钥掩码与撤销 + OAuth + 实时测试 + 只读策略 + 改配置自动重载会话 | `lib/mcp-import-*.ts`(2,615)、`mcp-{catalog,secrets,auth-command,live-test}.ts` |
| **审批模式** | bypass / ask / plan 三模式 + **拦截任意工具调用的策略引擎** + plan 模式严格护栏 + plan 文档（`write_plan` / `read_plan`） | `lib/{permission-mode,approval-policy,approval-extension,plan-mode-extension,plan-tools-extension}.ts` |
| **agent↔agent 信箱** | `agent_mail`（子→父 / 子→兄弟 / 父→全体），不是单向委派 | `lib/subagent-mail.ts` |
| **三语 i18n** | zh-CN / zh-TW / en（FastVibe renderer 只有 zh / en） | `lib/i18n/messages/*.ts` |
| **界面外壳** | 8 个功能开关、AI 身份（名称/头像/同步本机名）、壁纸层、mac 拟物皮肤、右栏分屏 + tab 总览 + 最近关闭、探索分支、批量选中会话、Git 图 tab、聊天小地图、上下文预算设置、重试设置、思考档记忆、项目信任、会话文件引用授权、聊天专用模式、系统提示词/工具定义查看器 | 见附录 B |
| **移动端形态** | PWA + Capacitor 壳（FastVibe 是纯原生 Flutter，无 web target） | `mobile/**`、`lib/mobile-shell.ts` |

---

## 3. 重叠区：两边都有，但**不是同一份实现**（必须逐项裁定谁赢）

| 能力 | FastVibe | PI NEXT | 建议 |
|---|---|---|---|
| **联网搜索** | 走 provider 托管的 `{type:"web_search"}`，**只在 openai-responses 模型上可用**，其它模型直接没有这个工具 | 自建 provider 链，**任意模型可用** | **PI NEXT 赢**，搬过来 |
| **浏览器** | 10 工具 + 内嵌 webview + **CDP 驱动本机 Chrome** + 导入本机浏览器 cookie + 引擎选择 + `browser_task`（受决策引擎驱动） | 10 工具 + Electron 受管浏览器 host + 设备视口/缩放/元素拾取 + 风险告知门 + 容量限制 | **合并**：保留 FastVibe 的 CDP/profile/task，搬 PI NEXT 的拾取与视口 UI |
| **终端** | PTY 面板 + 多标签（**UI only**） | 面板 + **4 个共享终端工具** | **PI NEXT 赢**（工具是净增量） |
| **MCP** | mcp-manager + exposure 模式 + codemode/tool_search | 配置编辑 + 目录 + 导入 + 密钥 + OAuth + 实时测试 + 自动重载 | **合并**：FastVibe 管运行时，PI NEXT 管管理面 |
| **供应商/模型** | 深（原生 provider、cc-switch、网关余额、配额、逐模型详情、按项目默认） | 中（models.json 编辑、目录、发现、测试、收藏、`enabledModels` glob 作用域） | **FastVibe 赢**；考虑搬 `enabledModels` 作用域与收藏 |
| **子代理** | `subagent`（单个/并行≤8/链式）+ DAG + 配置化角色 + handoff | `Agent`/`get_subagent_result`/`steer_subagent` + **agent_mail** + profile | **合并**：FastVibe 为主，搬 agent_mail |
| **文件** | 预览 + 图标 + read-dir | 树可见性/软链授权/增删改/索引/监听/提及/office 预览引用 | **PI NEXT 赢**，整层搬 |
| **Git** | 全套写操作 + AI 提交信息 + 审查侧栏 | status/changes/diff/log/branch + **Git 图** | **合并** |
| **会话导入** | 5 个会话源 | 会话 + 模型 + 技能 + MCP 四组，带 UI | **合并**（PI NEXT 的组更宽） |
| **Todo** | TodoWrite 式 + 面板 | chip + 卡 | 形态二选一，**FastVibe 为主**（UI 已渲染） |
| **工作树** | 4 个工具 + UI | UI + 服务 | **合并**，工具侧取 FastVibe |
| **用量统计** | 账本 + 图表/热力图/占比 | 每 turn 与历史 | **FastVibe 赢** |
| **主题 24 套** | 源 | **已逐字移植**（`lib/themes-fastvibe.ts` 832 行） | 无需工作 |
| **i18n** | zh / en | zh-CN / zh-TW / en | **PI NEXT 赢**，补 zh-TW |
| **通知/自动更新** | 系统通知 + 自动更新 | 系统通知 + 更新提示 + Web Push | **合并** |

---

## 4. 这个事实对「改造 FastVibe」这个思路意味着什么

### 4.1 思路本身成立（它就是计划里的 B′）

「改造 FastVibe + 补功能 + 加 web 端」= `docs/fastvibe-host-migration-plan-2026-10-13.md` 的方案 B′。技术前提已经实测：

- FastVibe renderer **零 Electron 依赖**，全部调用走注入全局 `window.fastvibe`，由 `src/shared/api.ts:createFastVibeApi(transport)` 构造（注释原文 "Nothing Electron-specific belongs here"），且已有浏览器安全客户端 `src/shared/app-client.ts`。→ **web 端不是新造，是给已有接缝写一个入口。**
- FastVibe 自带 headless 宿主（`src/agent/main.ts`，`fastvibe-agent`，默认 7777，AppServer + `HEADLESS_CAPABILITIES`），web 产物可直接由它托管。

### 4.2 但「补充相关功能」是双向的，不是单向

按第 1、2 节，**FastVibe 缺的那一整面（电脑操控 / DAG / 决策 / 记忆 / SSH / 账号远程 / Goal）比 PI NEXT 缺的那一面更大**（估算各 ≈20–25k 行）。所以：

- 若以 FastVibe 为宿主 → 要搬 PI NEXT 的独占块（§2，约 **19k 行 lib + 少量 UI**）。
- 若以 PI NEXT 为宿主（方案 C）→ 要搬 FastVibe 的独占块（§1，约 **20–25k 行**）**外加实现 215 个 IPC 通道**。

**两边搬的东西体量相当，但 B′ 不需要那 215 个通道。这是 B′ 唯一但决定性的优势。**

### 4.3 重叠区是隐藏成本

§3 里 16 项重叠**每一项都要裁定谁赢、然后把输的那份删掉**——不是「两份都留着」。「两份都留」会立刻出现两个联网搜索按钮、两套终端面板、两个 MCP 编辑入口，正是 PI NEXT 在 `fork:memory` 里已经踩过的坑（同一件事两个入口 = 「显得乱七八糟的」）。

### 4.4 已有的移植先例说明方向可逆

PI NEXT 里已经有 FastVibe 的移植物：`lib/themes-fastvibe.ts`（24 套主题逐字搬）与 `lib/import/**`（形状与 FastVibe 的 `engine/import/sources/*` 同源）。也就是说**两个仓库之间早已在做这种搬运**，只是方向是 FastVibe → PI NEXT。改方向不改变工作性质。

---

## 5. 建议

1. **维持 B′**（宿主 = FastVibe），但把范围写清：
   - **移植**：§2 里 PI NEXT 独占、且以工具扩展形态存在的部分（生图 / 联索 / 文档 / 定时任务 / IM 桥 / 终端工具 / plan-todo-审批 / agent_mail）——低耦合，几乎逐字搬。
   - **移植**：§2 里的管理层（文件层 / MCP 管理面 / 界面外壳 / 6 位配对 / tunnel / 手机同步）。
   - **裁定**：§3 的 16 项重叠，逐项记录谁赢、输的那份当场删除。
   - **不动**：§1 FastVibe 全部独占能力——一行不碰。
2. **先做 web 入口 + 会话目录 + 一个工具扩展的端到端样本**（计划里的 P0–P4 第一项），验证宿主成立与移植手感，再铺开。
3. **每项移植必须回答三问**（改状态吗 → 工具名；用户看得见吗 → UI；提示词还是代码）——这是 PI NEXT 已有的纪律，直接沿用。

---

## 附录索引

- 附录 A：FastVibe 逐能力清单（15 区，≈201 项）—— 本轮 subagent 产出，原文见会话记录。
- 附录 B：PI NEXT 逐能力清单（18 区，≈134 项）—— 同上。
- 宿主可行性实测：`docs/fastvibe-host-swap-2026-10-13.md`
- 迁移完整计划：`docs/fastvibe-host-migration-plan-2026-10-13.md`
- 现计划（A 方案）：`docs/fastvibe-imitation-plan-2026-10-13.md`
