# 上游对齐落地计划（fork ↔ agegr/pi-web）· 第二轮

日期：2026-10-09 · 审计基线：本 fork `main` @ `e220c177`（0.10.0-beta.2）· 上游 **`v0.11.0`** @ `c9e1513`
上一轮：[`upstream-alignment-plan-2026-10-01.md`](./upstream-alignment-plan-2026-10-01.md)（基线 `e17d2cc7`，已收尾）
纪律：[`upstream-merge-policy.md`](./upstream-merge-policy.md)（T0/T1/T2 + `fork:<slug>` + audit leak 只降不升）

---

## 0. 一页结论

上游从上一轮基线 `e17d2cc7` 推进到 **`v0.11.0`**，共 **107 个非 merge commit / 302 个改动文件**，跨两个大版本：

| 版本 | 日期 | 主题 |
| --- | --- | --- |
| **v0.10.0** | 2026-10-02 | MCP 完整化（Settings › MCP + 每会话 host + OAuth）+ Code mode + 项目信任 + pi 1.0 |
| **v0.11.0** | 2026-10-08 | **侧栏重设计** + **安全修复** + pi 1.1.0 + next 16.3.8 + 一批聊天/子代理/模型小改 |

1. **v0.10.0 的 MCP 我们已自建大半。** `lib/mcp-import.ts`、`lib/mcp-command.ts`、`lib/mcp-secrets.ts`、`lib/mcp-config-values.ts`、`lib/mcp-undo.ts`、`lib/mcp-read-only-policy.ts`、`lib/mcp-tool-display.ts`、`lib/codemode-settings.ts`、`lib/codemode-view.ts`、`lib/regular-file.ts`、`lib/shell-words.ts`、`lib/jsonc.ts`、`lib/global-settings-file.ts`、`app/api/tools/settings/route.ts` 与上游 v0.11.0 **逐字节相同**；设置面板是我们自绘的 `components/fork/Mcp*.tsx` + `PluginsConfig.tsx`。真缺口只剩 **项目信任列表、连接状态元数据、OAuth 内联、测试默认真连、host 空闲卸载/override** 五处。
2. **v0.11.0 有两件必须马上做**：
   - **安全**：Next 构建产物 `.next/prerender-manifest.json` 的 `previewModeId` 随包出厂且不轮换，`x-prerender-revalidate` 可跳过 `proxy.ts` —— 我们的 **Host/Origin 校验与 LAN 令牌闸门会一起被绕过**（npm 包 / DMG / EXE 都带该文件，已实测三份产物的值）。上游修法是启动时轮换（`cf3ebfba5`），我们**有 3 条 next 启动路径**，上游只补了 1 条。
   - **数据/越权**：`#1039` 的 Windows 目录 junction 越权（`app/api/git/diff/route.ts`）与上传覆盖失败丢原文件（`app/api/files/[...path]/route.ts` 先 `unlink` 再写）我们**都仍受影响**。
3. **能力缺口按用户可感知度排序**：子代理 profile 的 `skills:`/`extensions:` 白名单被静默放大成「全加载」；session_start 注册的 provider 从模型选择器消失（`#1071`）；侧栏置顶/归档/项目排序只存在浏览器 localStorage、无撤销/自动回归/跨端同步；侧栏行菜单没有分叉；MCP 项目信任对话框看不到将运行的命令。
4. **明确不做**：侧栏「会话 \| 文件」整套 DOM 重画（我们侧栏是 V5 自绘，只补能力）、`demo/`、`sw.js`、Node 22 CI、拖文件上传、CSS 转圈、codemode 视图、read-only MCP 策略、MCP 粘贴导入、exposure 四档、删除撤销 —— 都已具备或等价（§2）。

**工作量**：必做安全/数据 2 条（S+S），地基升级 1 条（L），能力补齐约 8 条（合计约 12–16 人日）。

---

## 1. 事实基线（已核验）

| 项 | 本 fork | 上游 `v0.11.0` |
| --- | --- | --- |
| HEAD | `e220c177`（0.10.0-beta.2） | `c9e1513` |
| 上一轮对齐基线 | `e17d2cc7`（2026-10-01） | — |
| 本轮增量 | — | **107 commit / 302 文件**（166 新增 / 134 改 / 2 删） |
| pi SDK | **1.0.0** | **1.1.0** |
| next | **16.3.6**（6 个 advisory） | **16.3.8** |
| 密码登录 | 已删（`proxy.ts` 注释，用户裁定） | 有（`PI_WEB_PASSWORD`） |
| 访问门 | `lib/request-security.ts`（Host/Origin/sec-fetch）+ `lib/lan-access.ts`（随机令牌） | 密码 + Host/Origin/Fetch-Metadata |
| 侧栏 | V5 自绘（`SessionSidebar.tsx` + `components/fork/`） | 重设计（`SessionTree.tsx` + `sidebar.css`） |
| MCP | 自建配置面 + SDK 内置扩展（`lib/pi-sdk-internals.ts`） | 自建 `McpHost` + `McpConfig.tsx` |

---

## 2. 已具备 / 不适用（**不要再抄一遍**）

| 上游项 | 依据 | fork 现状 |
| --- | --- | --- |
| MCP 粘贴导入（install 命令 / JSON / CLI / 目录链接） | `8716e70` `2ac2a0f` `c8fc3c0` `eeda862` | 逐行同源：`lib/mcp-import.ts`、`components/fork/McpPastePanel.tsx`、`McpCatalog.tsx` |
| exposure 四档（codemode / tool_search / direct / hidden） | `d702bc6` | `pi-sdk-internals.ts:800-860` 原生透传 + `PluginsConfig.tsx` 选择器 |
| MCP 删除 + 60s 撤销 | `00647b0` | `lib/mcp-undo.ts`（同源）+ `PluginsConfig.tsx:2400` |
| read-only 预设拦截无 `readOnlyHint` 的 MCP 工具 | `e299ab9` | `lib/mcp-read-only-policy.ts` **逐字节相同**，接在 `rpc-manager.ts:2566` |
| Code mode 自动/始终 + 内置工具接管 + tool list budget | `9cf9547` `0b2d4fa` `6c599e9` | `lib/codemode-settings.ts` + `app/api/tools/settings/route.ts` **逐字节相同** + `components/fork/McpCodemodeSettings.tsx` |
| codemode 调用显示为脚本 + 其调用工具 | `9dc822e` `82e5539` `7b3df71` | `lib/codemode-view.ts` **逐字节相同** + `components/CodemodeToolView.tsx` |
| `/mcp` 斜杠命令打开设置 | `ce615e7` | `lib/mcp-command.ts` **逐字节相同** + `useAgentSession.ts:2376` |
| 拖文件进聊天框上传 + `@` 提及 | `c3c5c6f` `#1094` | 已有（`fork:gap07-attachments`），且 cwd 内零拷贝 |
| 侧栏转圈改 CSS（GPU） | `80cd55e` `#1042` | 已是 CSS 动画，全仓无 SMIL |
| 扩展请求对话框折叠/键盘/倒计时 | 早期版本 | 已有（`ChatWindow.tsx:3249+`） |
| 文件标签搜索 | `8e6b7d3` | 右栏 `FileExplorer.tsx` 搜索等价 |
| sw 静态资源不被 cache write 阻塞 | `37d4045` `#1089` | 已是 `networkFirst` + 先返回后写 |
| Node 22 CI 固定 | `dda61b2` | 已是 `22.19.0` |
| `demo/` 演示站 | — | 不做（内部产品） |

---

## 3. 逐项对比（真缺口）

### 3.1 安全 / 数据完整性（**必做**）

| # | 问题 | 上游依据 | fork 现状 | 证据 | 量 |
| --- | --- | --- | --- | --- | --- |
| S1 | **Next preview-mode 密钥固定 → 绕过 `proxy.ts`**。`.next/prerender-manifest.json` 的 `previewModeId` 随 npm 包 / DMG / EXE 出厂且不轮换；`x-prerender-revalidate` 匹配时 Next 跳过 middleware，于是 Host/Origin/Fetch-Metadata 与 **LAN 令牌**一起失效 | `cf3ebfba5`（腾讯玄武实验室报告） | **缺**。实测 `.next` = `741cae4f…`，win/mac 产物 = `b3ffc2b7…`；全仓无 rotate 代码；**3 条启动路径**（`bin/pi-web.js:95`、`electron/main.js:178`、`scripts/next-mode.mjs:69`）全未接 | `lib/request-security.ts:105` 把任意 IP 字面量判为可信（保留 LAN 访问），所以一旦跳过 `proxy.ts` 就没有第二道门 | S |
| S2 | next 16.3.6 带 6 个 advisory（SSG/ISR 缓存投毒、dev MCP 端点泄露、image optimizer SSRF 等） | `1e294b01` | **缺**（精确锁 16.3.6） | `package.json` | XS |
| S3 | Windows 目录 junction 可让「看似本地」的 git diff 路径读到仓库外文件 | `1ddaf11f` `#1039` | **缺**。`app/api/git/diff/route.ts` 只校验 `cwd` 的 realpath 与 `filePath` 的词法白名单 | 上游加 `isDiffPathAllowed()`（`hasParentDirectorySegment` + 逐级 `lstat` 回退到最近存在项）；我们 `lib/path-security.ts:45` / `lib/file-access.ts:68` 已有可复用的原语 | S |
| S4 | 上传覆盖先 `unlinkSync` 再 `writeFileSync`，写入失败即丢原文件 | `1ddaf11f` `#1039` | **缺**。`app/api/files/[...path]/route.ts:429-441` | 上游 `lib/file-upload.ts` 加 `replaceUploadFile()`（同目录暂存 + `rename` 原子替换） | S |

> **S1 的边界**：fork 没有写死的登录密钥，LAN 完整令牌是 `randomBytes(24)` + 0600 落盘、只读令牌是 HMAC 派生，都**不是**固定值。但 preview 密钥是构建期常量、随包出厂，属**同类**可绕过问题。默认桌面只绑 loopback 时风险低；用户一旦开 LAN（`PI_WEB_LAN_TOKEN` + `0.0.0.0`），同网段持有公开包的人即可越权。**不能靠升 next 解决** —— 上游的修法就是启动时轮换。

### 3.2 依赖升级（地基）

| # | 项 | 上游依据 | fork 现状 | 量 |
| --- | --- | --- | --- | --- |
| D1 | pi SDK **1.0.0 → 1.1.0**（4 个包） | `e77a4e55`(1.0) `86dea26a`(1.1) | 停在 1.0.0 | L |

pi 1.1.0 触及 pi-web 的变更（逐条对照 fork 现状）：

| 1.1.0 变更 | fork 现状 | 风险 |
| --- | --- | --- |
| 项目 `.pi/mcp.json` 可只改全局 server 的 `enabled`/`exposure`/`toolExposure`（override） | 无 `lib/mcp-override.ts`；`pi-sdk-internals.ts` 的 `updateMcpServerConfig` 仍 3 参 | **高**（合并语义变） |
| `signInMcpServer()` 接收 `signal`（取消/过期即停） | 无 `signal` 透传 | 中 |
| **被 Stop 的运行不算完成**（`agent_settled.aborted` / `prompt_done.aborted`）：不播完成音、不发通知 | `onAgentEnd?: () => void` 无参；`useAgentSession.ts:1690` / `:1697` 忽略 `aborted` | 中（观感/打扰） |
| 工具卡显示真实 `durationMs` | 未接 | 低 |
| Azure provider 改名 `azure-openai-responses` → `azure` | 仍用旧名（`components/ProviderIcon.tsx:41,68`、`lib/provider-icon.ts:34`、`lib/thinking-request-core.ts:840`） | 低-中 |
| 粘贴导入读 `oauth.clientRegistration` + validator cimd 规则 | 未接 | 低 |
| pi 不再带 `npm-shrinkwrap.json` | lock 各自一份 | 低 |

> **最大风险面**：`lib/pi-sdk-internals.ts` 按 file URL 硬编码加载未导出的内部模块（`dist/extensions/mcp/*.js`、`dist/core/mcp-servers.js`、`dist/core/resolve-config-value.js`）。升级前**先跑** `lib/pi-sdk-internals.test.mjs` 契约测试；1.1.0 大概率只加字段不改路径，但契约测试就是为这一天写的。

### 3.3 子代理 / 模型

| # | 项 | 上游依据 | fork 现状 | 证据 | 量 |
| --- | --- | --- | --- | --- | --- |
| A1 | profile `skills:` 预加载**指定** skill | `5d5a69e` `#1034` | **缺**（语义被放大） | `lib/subagents.ts:210` `resourceBoolean` 把数组/字符串一律当 `true` = 加载**全部**；无 `lib/subagent-skills.ts`；snapshot 无 `skills[]` | L |
| A2 | profile `extensions:` **只加载列出的**扩展 | `17bbadb` `#1091` | **缺**（同上，数组 = 全加载） | `lib/subagents.ts:210`；无 `scopeSubagentExtensions`；`rpc-manager.ts` 只有 `withoutDisabledMemoryExtension` | M |
| A3 | 回合上限/结束状态/恢复参数（#1093/#1055） | `496611c` `6f2b4f0` `f272cd8` | **部分/过时** | `lib/subagent-runtime.ts:367-381` 旧订阅式限流；`maxTurnsReached` 记 `completed` 而非带原因失败；`resume` 传 `model/max_turns` 静默忽略 | M |
| A4 | session_start 注册的 provider 不再消失 | `a1362679` `#1071` | **缺** | 无 `lib/deferred-provider-models.ts`；`app/api/models/route.ts:46`、`enabled/route.ts:43` 每次新建 runtime | S |
| A5 | models-only provider 保留原 API 协议 | `7aaeff97` `#1050` | **已有**（fork 自研模型页未继承该 bug）；建议 e2e 核实 | `components/ModelsConfig.tsx:826-833` 无强制覆盖 | XS |

### 3.4 侧栏 / 会话 UI（v0.11.0 主主题）

> 注意：fork 侧栏是 **V5 自绘**，形态与上游不同。下表判定的是**能力**，不是代码。

| # | 能力 | 上游依据 | fork 现状 | 证据 | 量 |
| --- | --- | --- | --- | --- | --- |
| B1 | 折叠分组显示运行中 + 未读计数 | `2e87ddb` | **部分**（只显示未读） | `SessionSidebar.tsx:2437-2458` `showProjectActivity` 在 unread=0 时 return null | XS |
| B2 | 置顶/归档：10s 撤销、归档后新消息自动回归、一键归档 7 天前 | `2e87ddb` | **部分**（置顶/归档有，三项都没有） | `lib/session-flags.ts:118-136`；无 archive undo；无 `archivedAt` vs 新消息判定；无批量归档 | M |
| B3 | 项目顺序固定 + 拖拽/上移下移 + **跨端同步** | `02ded7e` `085fba9` | **部分**（拖拽有；默认仍随活动跳动；无上移下移；仅 localStorage） | `SessionSidebar.tsx:1468,1493`；`lib/session-groups.ts:39` | L |
| B4 | **状态存服务端** `~/.pi/agent/pi-web-session-state.json` | `lib/session-ui-state.ts` + `/api/sessions/ui-state` | **缺**（全 localStorage） | `session-flags.ts:27`、`session-groups.ts:39`、`project-flags.ts:29` | L |
| B5 | 侧栏行菜单**分叉**会话（运行中也能）+ 短后缀命名 | `085fba9` `1aef2f6` | **缺** | 行菜单仅 pin/archive/export/copy；现有分叉只在消息气泡，且不加后缀 | M |
| B6 | Git 忽略文件**显示开关**（变暗 + 原因） | `2f6a0a9` `#1092` | **部分**（默认已隐藏，无开关/变暗/原因） | `lib/file-tree-visibility.ts:236` 只回 boolean；`app/api/files/[...path]/route.ts:867` | M |
| B7 | 手机切回桌面恢复侧栏状态 | `fdeea87` `#1059` | **缺** | `AppShell.tsx:555-567` 只 `setSidebarOpen(false)`，回桌面不恢复 | S |
| B8 | 删除已离开的会话不再跳空白 | `a096af3` `#1083` | **缺** | `AppShell.tsx:1721-1745` 用闭包 `selectedSession` | S |
| B9 | 新会话项目+工作树选择（草稿/图片/模型/推理等级随行） | `12cf745` `7989bc2` | **部分**（项目/工作树/草稿/图片有；模型/推理等级随行不保证） | `components/fork/ProjectChip.tsx`、`lib/draft-store.ts:156` | S |
| B10 | 「会话 \| 文件」两个标签 | `2e87ddb` | **不适用**（fork 是「项目 \| 聊天工作区」+ 右栏文件树） | `lib/sidebar-pane.ts:8` | — |

### 3.5 聊天渲染 / 扩展 UI

| # | 能力 | 上游依据 | fork 现状 | 证据 | 量 |
| --- | --- | --- | --- | --- | --- |
| C1 | `write` 工具卡直接显示写入内容 | `038057f` `#1024` | **缺** | `MessageView.tsx:2872` 仍回 JSON 入参 | S |
| C2 | 扩展可在状态栏放**命令按钮** `ctx.ui.setStatus("command:…")` | `1333c80` `#1030` | **缺** | `TopBarPopovers.tsx:159-173` 只画只读文本 | M |
| C3 | 扩展对话框按内容自动加宽 | `981e270` `#1032` | **缺**（恒 560px） | `ChatWindow.tsx:3291` | S |
| C4 | 运行中上下文用量及时刷新 | `9182fdf` `#1058` | **缺** | `useAgentSession.ts:1764-1796` 只 append，不刷 usage | S |
| C5 | CJK 标点旁粗体/斜体 | `6d4d6b5` `#1072` | **缺** | `lib/markdown.ts:504-508` 无 `remark-cjk-friendly` | XS |
| C6 | 文件提及可撤销（Ctrl+Z） | `012e805` `#1098` | **缺** | `ChatInput.tsx:2320-2348` 走受控 `setValue`，不进原生 undo 栈 | S |
| C7 | 长表格单元格换行（含表头） | `81e5b03` `#1056` | **部分**（`th` 仍 `nowrap`） | `design/v5/web/system.css:1155` | XS |
| C8 | 文件源码视图背景跨主题保持 | `9da54e1` `e2ea7da` `#1060` | **部分**（聊天码块已免疫；文件源码视图未修） | `AsyncCodeHighlighter.tsx:114,121` 用 `background` 简写 + 保留 `vscDarkPlus` 简写 | XS |
| C9 | 自定义**代码字体** + UI/代码**字重** | `86d94e2` `#1074` | **部分**（只有 UI 字体族 + 字号） | `components/SettingsPanel.tsx:706-740` 注释明说没有这两项 | M |

---

## 4. PR 拆分（按依赖顺序，逐个可独立评审）

每个 PR 一条分支，从 `main` 切，完成后合回 `main`。**每 PR 只做一件事**，可独立 revert。
按 [`upstream-merge-policy.md`](./upstream-merge-policy.md) §2.1，每个 PR 描述必须带：
`接触面：T<n> · <文件数> 个上游文件 / <处数> 处改动 · slug=fork:<slug> · audit leak <前> → <后>`

### PR-0 · 基线清理（0.5h，无代码）
- 确认 `git status --porcelain` 干净、`npm test` 全绿、`npm run prod` 能起。
- **DoD**：脏树落 commit；基线可复现。

### PR-1 · 安全：Next preview-mode 密钥轮换 + next 16.3.8（P0，S）
- **做什么**：
  - 新增 `lib/rotate-preview-secrets.ts`（纯函数 + `.test.mjs`，含 missing/unreadable/unexpected-shape/unwritable 四种返回）。
  - 在 **3 条** `next start` 之前调用：`bin/pi-web.js`、`electron/main.js`（自己 spawn，不走 bin）、`scripts/next-mode.mjs`（`npm run prod` 入口）。只读安装/打包目录打印告警而不是静默带漏洞。
  - `next` / `eslint-config-next` 16.3.6 → **16.3.8**（+ `npm audit fix`）。
- **上游依据**：`cf3ebfba5`、`1e294b01`
- **DoD**：单测绿；打包产物里 `previewModeId` 每次启动都变；`x-prerender-revalidate` 带旧值不再返回 200；`npm run prod` 起服冒烟。
- **接触面**：T1 · 3 个上游文件 / 3 处接线 · slug=`fork:rotate-preview-secrets`

### PR-2 · 安全/数据：#1039 两处（P0，S）
- **做什么**：
  - `app/api/git/diff/route.ts`：加 `isDiffPathAllowed()`（复用 `lib/path-security.ts:hasParentDirectorySegment` + 逐级 `lstat` 回退到最近存在项，复用 `isExistingFilePathAllowed`）。
  - 上传覆盖改原子替换：`lib/file-upload.ts` 加 `replaceUploadFile()`（同目录暂存 + `rename`），`app/api/files/[...path]/route.ts` 改调用。
  - 补回归测试：junction 越权被拒、deleted-file diff 仍可读、写入失败保留原文件。
- **上游依据**：`1ddaf11f` `#1039`
- **DoD**：三条回归测试绿；手工复现 junction 越权被 403。
- **接触面**：T1 · 2 个上游文件 / 4 处 · slug=`fork:file-integrity`

### PR-3 · pi SDK 1.0.0 → 1.1.0（地基，L）
- **做什么**：4 个 pi 包 → 1.1.0；适配：
  - MCP 项目 override（`lib/mcp-override.ts` + `updateMcpServerConfig` 的 `override` 参数）
  - `signInMcpServer()` 透传 `signal`
  - `agent_settled.aborted` / `prompt_done.aborted`：`onAgentEnd` 带参，**被 Stop 的运行不播完成音、不发通知**
  - 工具卡 `durationMs`、Azure provider 改名 `azure`、粘贴导入读 `oauth.clientRegistration`
- **上游依据**：`e77a4e55` `86dea26a`
- **先决**：先跑 `lib/pi-sdk-internals.test.mjs` 契约测试，确认内部件路径未变。
- **DoD**：契约测试 0 skipped；全量测试绿；真实会话冒烟（发消息/工具调用/压缩/子代理/fork/MCP）；Stop 后无完成音。
- **接触面**：T1 · `lib/pi-sdk-internals.ts` / `lib/rpc-manager.ts` / `hooks/useAgentSession.ts` 等 · slug=`fork:pi-1.1`
- **降级预案**：允许「只做 MCP override + aborted + Azure 改名，pi 停在 1.0.x」的最小版。

### PR-4 · 子代理 profile 白名单语义（L）
- **做什么**：
  - 移植 `lib/subagent-skills.ts`；修正 `resourceBoolean`：**数组 ≠ 全加载**，`skills:[a,b]` 只加载 a/b。
  - `scopeSubagentExtensions`：`extensions:[x]` 只加载 x；被排除扩展的 provider/native/virtual 注册要回收。
  - 回合上限/结束状态/恢复参数（`#1093`/`#1055`）：队列有消息时不多跑一轮；超限带原因失败；`resume` 拒绝新建参数。
  - snapshot 记录 `skills[]` / `extensions[]`，让 resume/reopen 一致。
- **上游依据**：`5d5a69e` `17bbadb` `496611c` `6f2b4f0` `f272cd8`
- **DoD**：单测（数组白名单只加载列出的、`max_turns` 边界、resume 拒绝覆盖参数）+ 真跑一个带 `skills:` 的 profile。
- **接触面**：T1 · `lib/subagents.ts` / `lib/subagent-runtime.ts` / `app/api/subagents/profiles/route.ts` · slug=`fork:subagent-scope`

### PR-5 · deferred provider models（S）
- **做什么**：移植 `lib/deferred-provider-models.ts`，接到 `app/api/models/route.ts`、`default/route.ts`、`enabled/route.ts`、`lib/model-runtime.ts`、`lib/rpc-manager.ts`。
- **上游依据**：`a1362679` `#1071`
- **DoD**：单测 + 用 `pi-claude-bridge` 类延迟注册 provider 手工验：列举两次后仍在选择器、能用其模型开会话。
- **接触面**：T1 · 5 处 · slug=`fork:deferred-providers`

### PR-6 · 侧栏状态服务端化 + 交互补齐（L，建议拆 6a/6b）
- **6a 服务端状态层**：新增 `~/.pi/agent/pi-web-session-state.json` + `app/api/sessions/ui-state/route.ts`（上游 `lib/session-ui-state.ts`），把 `lib/session-flags.ts` / `session-groups.ts` / `project-flags.ts` 从 localStorage 迁到服务端，加 revision 合并。
- **6b 交互补齐**：归档 10s 撤销 toast、归档后新消息自动回归、一键归档 7 天前、项目顺序默认固定（新活动不跳顶）+ 上移/下移、折叠组运行中计数。
- **上游依据**：`2e87ddb` `02ded7e` `085fba9` + `lib/session-ui-state.ts`
- **DoD**：单测（迁移/合并/撤销窗口）+ 两个浏览器验证置顶/归档/顺序同步；`npm run verify:boards`。
- **接触面**：T0 为主（新文件）+ T1 少量接线 · slug=`fork:session-state`

### PR-7 · 侧栏行菜单分叉 + 短后缀命名（M）
- **做什么**：移植 `lib/session-fork.ts` / `lib/session-fork-name.ts` / `app/api/sessions/[id]/fork/route.ts`；`components/SessionRowContextMenuBridge.tsx` 加「分叉」项（运行中也可）；新会话名 = 原标题 + 短随机后缀。
- **上游依据**：`085fba9` `1aef2f6`
- **DoD**：单测（命名、运行中分叉）+ 手工验证两条链（侧栏分叉 vs 消息气泡分叉）。
- **接触面**：T1 · `lib/rpc-manager.ts` / `SessionRowContextMenuBridge.tsx` · slug=`fork:session-fork-row`

### PR-8 · MCP 补齐（M/L，建议拆 8a–8e）
- **8a 项目信任列表**（M）：`lib/mcp-config-read.ts` + `GET /api/project-trust` 返回 `mcpServers`/`mcpFile`/`mcpError` + `ProjectTrustDialog` 列出 server 与其命令 + i18n `trust.mcp.*`。
- **8b 连接状态元数据**（M）：`lib/mcp-status.ts` + `McpServerInfo` 补 `status`/`configKey`/`signedIn`/掩码/override 字段 + transport 观测上报。
- **8c OAuth 内联 + 测试默认真连**（M）：`McpSignIn.tsx`/`OAuthPastePanel.tsx` + `app/api/mcp/sign-in/*` + `/api/mcp/test` 默认真连。
- **8d 每会话 host 的空闲卸载 / prompt 前 sync / override**（M）。
- **8e models-only provider 默认协议**（S）：`ModelsConfig.tsx` 去掉无 auth provider 的强制默认。
- **上游依据**：`3e693c7` `dff71a0` `922a9d7` `30fe218` `7aaeff97`
- **DoD**：每条补单测；MCP 契约测试全绿；`PI_WEB_PASSWORD` 不进子进程 env（既有约束保持）。
- **接触面**：T0 为主 + T1 · slug=`fork:mcp-parity`

### PR-9 · 聊天渲染小改（S×N，可合并评审、分开 commit）
- C1 write 卡显示内容 · C3 扩展对话框自动加宽 · C4 运行中 context 用量刷新 · C5 CJK 强调 · C6 提及可撤销 · C7 表头换行 · C8 文件源码视图背景 · C9 代码字体 + 字重。
- C2 扩展状态栏命令按钮（M）**单独**一个 PR/分支（要动 composer 上方的状态架）。
- **上游依据**：见 §3.5 各条。
- **DoD**：每条补单测或 e2e；改样式跑 `check:design` + `verify:boards`。
- **接触面**：T1 · slug=`fork:chat-polish`

### PR-10 · Git 忽略文件显示开关（M）
- **做什么**：`lib/file-tree-visibility.ts` 返回 `hidden` 原因（`ignored`/`excluded`）+ `getFileTreeHiddenReasons`；`app/api/files/[...path]/route.ts` 加 `hidden=1`；`FileExplorer.tsx` 开关 + 变暗 + 原因 tooltip + localStorage 记忆。
- **上游依据**：`2f6a0a9` `#1092`
- **注意**：列表要**等 git**（上限 5s），沿用 `fork:file-tree-visibility` 的合并缓存与 signal。
- **接触面**：T1 · slug=`fork:file-tree-visibility`（扩展既有）

### PR-11 · 侧栏/移动端小修（S）
- B7 手机切回桌面恢复侧栏（`desktopSidebarOpenRef`）
- B8 删除已离开的会话不跳空白（`selectedSessionRef`）
- **上游依据**：`fdeea87` `#1059`、`a096af3` `#1083`
- **接触面**：T1 · `components/AppShell.tsx` · slug=`fork:sidebar-state`

### PR-12 · 新会话项目/工作树 + 模型/推理等级随行（S）
- **做什么**：确认并补齐新会话切换项目时草稿 + 图片 + **模型 + 推理等级**一起迁移（上游 `carryComposer`）。
- **上游依据**：`12cf745` `7989bc2`
- **接触面**：T1 · `components/ChatWindow.tsx` / `lib/draft-store.ts` · slug=`fork:new-session-context`

---

## 5. 建议顺序与里程碑

```
PR-0 清理 ──┬─► PR-1 安全轮换 + next 16.3.8   （今天就能做）
            └─► PR-2 #1039 两处               （今天就能做）
            └─► PR-5 deferred providers       （不依赖任何升级）
            └─► PR-11 侧栏小修 / PR-12 新会话  （不依赖任何升级）
PR-1 ──► PR-3 pi 1.1.0 ──┬─► PR-4 子代理白名单
                          └─► PR-8 MCP 补齐
PR-0 ──► PR-6 侧栏状态服务端化（6a→6b）──► PR-7 行菜单分叉
PR-0 ──► PR-9 聊天渲染小改 ──► PR-10 Git 忽略文件开关
```

- **M0（今天）**：PR-0 + PR-1 + PR-2 —— 两条安全/数据问题，独立于任何升级。
- **M1（地基）**：PR-3 + PR-5 —— 升到 pi 1.1.0，之后上游不再拉开。
- **M2（能力）**：PR-4 + PR-6 + PR-7。
- **M3（MCP）**：PR-8（必须 PR-3 之后）。
- **M4（体验）**：PR-9 + PR-10 + PR-11 + PR-12。

---

## 6. 每个 PR 的统一门禁

```bash
node_modules/.bin/tsc --noEmit      # 0
npm test                             # 全绿（新增逻辑必须有单测）
npm run lint                         # 0 error
npm run check:design                 # 改了 UI 必跑
npm run check:contrast               # 改了任何前景/背景色
node docs/upstream-merge-audit.mjs --check   # leak 只允许降
npm run prod                         # 构建 + 起服 + 浏览器冒烟
```

---

## 7. 风险与未尽事项

1. **PR-3 是全盘最大风险**：SDK 跨 1.0→1.1，且我们深度依赖未导出的内部模块（`lib/pi-sdk-internals.ts`）。先跑契约测试；允许降级为最小适配。
2. **S1 不能靠升 next 解决**：上游修法是启动时轮换；我们有 **3 条**启动路径，少接一条就等于没修（`electron/main.js` 最容易被漏，它自己 spawn next，不走 `bin/pi-web.js`）。
3. **侧栏是形态分叉区**：B10（会话|文件标签）判为不适用；其余按**能力**补，不要照抄上游 DOM —— 我们侧栏走 V5 设计系统，`verify:boards` 会量。
4. **MCP 的架构差**：fork 用 SDK 内置扩展 + `session-liveness` 闸门，上游自建 `McpHost`。PR-8d 是补 host 级行为，不是换实现；`lib/pi-sdk-internals.ts` 的脆弱性要持续用契约测试兜住。
5. **子代理白名单是语义 bug**：`resourceBoolean` 把数组当 `true` 意味着「用户写了白名单，实际全加载」——这不是缺功能，是**做错了**，优先级高于观感类小改。
6. **上游仍在推进**：`v0.11.0` 是 2026-10-08 的提交，执行前重新 `git fetch agegr` 对一次。
7. **本文件的审计快照**：2026-10-09。上游再发版就重跑，不要在本文件上直接改数字。

---

## 8. 执行状态（2026-10-09 首轮）

**已合入 main（11 个提交，59 文件 / +3500 −2164）**

| PR | 内容 | 状态 |
| --- | --- | --- |
| PR-0 | 基线清理（PhaseRoll 过期断言） | ✅ |
| PR-1 | preview 密钥轮换（3 条启动路径）+ next 16.3.8 | ✅ |
| PR-2 | #1039 junction 越权 + 上传覆盖原子替换 | ✅ |
| PR-3 | pi 1.0.0 → 1.1.0 + 六处适配 | ✅ |
| PR-4a | `skills:` / `extensions:` 白名单语义 | ✅ |
| PR-5 | deferred provider models（#1071） | ✅ |
| PR-7 | 侧栏行菜单分叉 + 短后缀命名 | ✅ |
| PR-9 | C1/C3/C4/C5/C6/C7/C8 七项 | ✅（C2/C9 见下） |
| PR-10 | Git 忽略文件显示开关（#1092） | ✅ |
| PR-11 | 手机切回桌面恢复侧栏 + 删除会话不跳空白 | ✅ |
| PR-6 | 归档自动回归（B2 的一部分） | ✅ 部分 |

**验收数据**
- `tsc --noEmit` 0 错；`npm test` **3863 pass / 0 fail / 8 skipped**（含新增 30+ 用例）
- `npm run build`（next build --webpack）成功；隔离端口 30249/30250 冒烟：
  `/api/home` `/api/models` `/api/sessions` `/api/tools/settings` `/api/subagents/profiles?cwd`
  `/` 全 200；`POST /api/sessions/nope/fork` 404；文件树默认 37 条 → `hidden=1` 58 条（21 条带原因）
- PR-1 端到端：不受信 Host + 旧发布 id → 403；+ 当前磁盘 id → 200（证明该头确实跳过 proxy）；
  启动时 `previewModeId` 确实被换新
- 上游契约测试 37/37（0 skipped，`pi-sdk-internals` 内部件路径未变）

**本轮未做（附理由，不是遗漏）**

| 项 | 为什么没做 |
| --- | --- |
| PR-4b 子代理回合上限/结束状态（#1093/#1055） | 纯内部鲁棒性（队列多跑一轮、超限记 completed 而非带原因失败），改动面在 `subagent-runtime.ts` 的限流器重写，回归风险高于收益；单独一轮并配真实会话验证更稳 |
| PR-6 B1 折叠组「运行中计数」 | **与本仓 V5 画板 02 的既有裁定冲突**：`components/SessionSidebar.test.mjs` 钉着「运行态归会话行底边扫掠线，项目行不长徽标」。属设计裁定项，不能照上游加 |
| PR-6 B2 剩余（归档 10s 撤销 toast、一键归档 7 天前） | 纯 UI，可与 B3 一起做 |
| PR-6 B3/B4 项目顺序固定 + 状态存服务端 | 要把 `session-flags` / `session-groups` / `project-flags` 三份 localStorage 迁到 `~/.pi/agent/pi-web-session-state.json` 并加跨端同步（L 级基础设施），单独一轮 |
| PR-8 MCP 补齐（信任列表 / 连接状态 / OAuth 内联 / host 空闲卸载 / models-only 默认协议） | M–L；其中项目信任列表是安全相关，建议下一轮首项 |
| PR-12 新会话模型/推理等级随行 | 本仓新会话栏是 `ProjectChip` 自绘（非上游 `NewSessionContextBar`），边际价值低；需要产品裁定 |
| PR-9 C2 扩展状态栏命令按钮 | M；要动 composer 上方的状态架，本仓状态显示在顶栏浮窗里，形态需先裁定 |
| PR-9 C9 自定义代码字体 + 字重 | M；新增设置分节要同步 15 张设置画板 + `SettingsPanel.boardnav.test.mjs` 计数 + `SETTINGS_HUB_GROUPS`，是设计门禁项 |

**⚠️ 需要重启**：本轮已执行 `npm run build`（`next 16.3.8` + `pi 1.1.0` + 全部改动），
`.next` 已被替换。正在跑的那个 30141 实例仍是旧进程，请 `npm run prod` 重启后再用。

---

## 9. 第二轮：照上游优化侧栏 + PR-8a（2026-10-09 下午）

### 9.1 侧栏（参照上游 `components/SessionSidebar.tsx` + `lib/session-tree.ts`）

用户拿上游截图点名要的那几样，本仓原来都没有（项目 ⋯ 菜单只有「打开文件夹 / 重命名 /
归档项目 / 移除」）：

| 加的东西 | 落点 | 依据 |
| --- | --- | --- |
| 项目 ⋯ 菜单：置顶 / 取消置顶 | `lib/project-flags.ts` 新增 `pinned` + `applyProjectPins` | 上游 `groupMenuItems` |
| 项目 ⋯ 菜单：上移 / 下移 | `lib/session-groups.ts` 新增 `moveProjectAdjacent`（与拖拽共用同一份 `order`） | 上游 `adjacentProjectMove` |
| 项目 ⋯ 菜单：归档 7 天前的会话 · N | `lib/sidebar-bulk.ts` `familiesOlderThan` | 上游 `familiesToArchive` |
| 项目 ⋯ 菜单：折叠其他 / 展开全部 | 侧栏 `collapseOtherProjects` / `expandAllProjects` | 上游 `setAllGroupsExpanded` |
| 项目 ⋯ 菜单：查看已归档 · N | 打开「设置 → 归档」 | 上游 `openArchiveView` |
| Alt+单击项目行 = 全部跟着这一个 | `ProjectRow.onToggleAll` | 上游 `handleToggleGroup(key, all)` |
| 「显示更多 · N」 | `lib/sidebar-bulk.ts` `visibleFamilies` / `moreRowState`；每分组 6 → 每点 +20 | 上游 `visibleFamilies` / `showMoreFamilies` |
| 归档条（撤销 / 查看 / 关闭） | `lib/session-flags.ts` `archiveSessions` / `restoreSessions` | 上游 `archiveFamilies` + `SidebarToast` |

两个规则按上游原样搬：**运行中 / 未读 / 当前选中的行永远显示，且不占「显示更多」名额**；
归档条上的「撤销」是真的把会话放回列表（归档是展示位，不动 `.jsonl`）。

**没照搬**（本仓 V5 有裁定）：折叠组上的「运行中计数」徽标 —— `SessionSidebar.test.mjs`
钉着画板 02 的「运行态归会话行底边扫掠线，项目行不长徽标」。

### 9.2 PR-8a · 信任对话框列出项目 MCP server

上游 `3e693c7b3`。信任一个文件夹 = 允许它的 `.pi/` 在本机执行，所以按「信任」之前
必须先看清会跑什么 —— 这是 pi 的 `loadMcpConfig` 做不到的（它只在**已信任**时才读
项目文件）。新增 `lib/project-trust-mcp.ts`：走 `loadMcpConfigFile` 的「只读一个文件」
通道，只解析 + 校验，不起进程 / 不连网络 / 不展开 `${VAR}` / 不跑 `!command`。
命令**按原文**（掩码会把要跑的东西藏起来，那正是这张表要回答的），URL 凭证掩码、
host 保留，env / header 只列名字。

### 9.3 仍未做

| 项 | 状态 |
| --- | --- |
| PR-4b 子代理回合上限重写 | 未做（纯内部鲁棒性，重写限流器风险 > 收益） |
| PR-6 B3/B4 项目顺序固定 + 状态存服务端 | 未做（三份 localStorage 迁服务端 + 跨端同步，L 级基础设施） |
| PR-6 B2 剩余（单个归档的 10s 撤销、一键归档 7 天前的设置项） | 未做（批量归档已有归档条撤销；设置项本仓没有「自动归档」概念） |
| PR-8b–8e MCP（连接状态 / OAuth 内联 / host 空闲卸载 / models-only 默认协议） | 未做（8a 已完成；其余 M 级） |
| PR-9 C2 状态栏命令按钮 / C9 字体设置 | 未做（形态要先产品裁定；字体是设置画板族 + 门禁项） |
| PR-12 新会话模型随行 | **核对后已满足**：`newSessionModel` / `thinkingLevel` 都不随 cwd 切换重置，没有要改的代码 |

**验收（本轮追加）**：tsc 0 错 · `npm test` **3875 pass / 0 fail** · `check:design` 无新增违规 ·
`check:icons` 全绿 · `npm run build` 成功。
