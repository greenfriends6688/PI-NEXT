# 对齐上游 pi-web 0.10.0 的 MCP：差异盘点与迁移计划（2026-10-02）

> 上游 = `pi参考项目/pi-web-0.10.0`（pi **1.0.0**，与本仓同版本）。
> 本仓 = pi-web fork，pi 1.0.0，2026-10-02 之前已做过 P0（原生 exposure / 自动重载 /
> `updateConfig` 接管落盘）。
> 原则：**同一件事以上游为准**，但架构级替换要单独决策（见 §4 第 1 条）。

---

## 0. 一句话结论

上游这版 MCP 的**运行时模型和本仓根本不同**，而且比本仓成熟得多：它的 `loadConfig` 返回
**空列表**（内置 mcp 扩展什么都不连），改由一个 per-wrapper 的 `McpHost` 在**每次 prompt 前**
用公开的 `pi.registerMcpServer()` 注册、用完回收；配套还有真连测试、粘贴添加、删除撤销、
只读策略、codemode 视图、状态表。本仓是「让内置 mcp 扩展在 `session_start` 连全部」。

**已迁移（本轮）**：纯函数与独立扩展，能直接落地且不碰架构的部分。
**建议下一步**：状态表 / 撤销 / 真连测试 / codemode 视图（增量）。
**需你拍板**：运行时模型是否换成 `McpHost`（§4 第 1 条）。

---

## 1. 两边现状对照

### 1.1 运行时（**分歧最大**）

| | 上游 0.10.0 | 本仓 |
| --- | --- | --- |
| 谁决定连哪些 server | `McpHost`（per-wrapper），`loadConfig` 返回空 | 内置 `mcp` 扩展在 `session_start` 连全部 |
| 连接时机 | 每次可能起 run 的 prompt 前；`agent_end` / sync 后 arm idle 释放 | 会话打开期间常驻，靠 wrapper 空闲回收 |
| 只等「直接」工具的 server | 是（`promptWaitMs` 10s，且同一 server 只等一次） | `startupWaitMs: 0`（首个 prompt 完全不等） |
| 让渡/孤儿连接防护 | `replaceWaitMs` 5s + `abandoned` 计数 + `refuseAbandoned()` | 无（连接由扩展持有） |
| 项目信任 | 每次 `sync` 现读（不信 `ctx.isProjectTrusted()` 的快照） | 建 wrapper 时读一次，reload 刷新 |
| 状态上报 | host 把连接状态写进进程内 `mcp-status.ts` | 无（面板只有 enabled 计数） |
| 文件变化 | 每次 sync 重读 → 改动即时生效 | 只在 `session_start` / reload 时重读 |

上游这样做的理由写在 `docs/adr/0006-mcp-and-code-mode.md` 第 3 节（fan-out、首条消息延迟、
Stop 被扩展等待吞掉、孤儿连接）。本仓当时也识别过这些问题，但选了另一条路
（transport 上挂 session-liveness 租约 + `startupWaitMs: 0`）。

### 1.2 功能面

| 功能 | 上游 | 本仓（迁移前 → 现在） |
| --- | --- | --- |
| exposure 四档 UI | ✅ `McpConfig.tsx:1601` | ✅ 本轮 P0-1 加的下拉（已对齐语义） |
| 粘贴添加（命令 / JSON / 安装链接） | ✅ `lib/mcp-import-*.ts` | ❌ 只有「发现」+ 手填 |
| 测试连接（**真连** + 工具清单 + 耗时） | ✅ `lib/mcp-test.ts` | ❌ 结构校验（`lib/mcp-validator.ts`） |
| OAuth 登录 UI（授权链接 + 粘回重定向） | ✅ `McpSignIn.tsx` | ⚠️ 只能复制 `/mcp login` 命令 + 连接目录的 OAuth |
| 删除撤销（60s、token） | ✅ `lib/mcp-undo.ts` | ❌ |
| 连接状态（连接中/已连/需登录/失败…） | ✅ `lib/mcp-status.ts` + 行状态徽章 | ❌ |
| 只读会话拦未标只读的 MCP 工具 | ✅ `lib/mcp-read-only-policy.ts` | ✅ **本轮已迁移并注册** |
| 密钥掩码（env/headers/secret/url/args） | ✅ `lib/mcp-secrets.ts` | ✅ **本轮已迁移并接进 `get`/`update`** |
| 工具名按 `server/tool` 显示 | ✅ `lib/mcp-tool-display.ts` | ✅ **本轮已迁移并接进 MessageView** |
| codemode 设置（自动/始终、mode、预算） | ✅ `lib/codemode-settings.ts` | ❌ |
| codemode 在转录里渲染成脚本+调用 | ✅ `CodemodeToolView.tsx` | ❌（走通用工具卡） |
| `/mcp` 打开设置 | ✅ `lib/mcp-command.ts` | ❌ |
| 按内容 HMAC 识别条目（状态/测试绑定） | ✅ `lib/mcp-config-key.ts` | ✅ **本轮已迁入（未接线）** |
| 项目信任对话框列出 MCP 条目 | ✅ | ❌ |
| 技能/插件「全部启用/停用」 | ✅ | ❌ |
| 目录选择器新建文件夹 / 在访达中打开工作区 / `~/pi-cwd/YYYYMMDD` | ✅ | 部分 |
| 运行中分叉 / 调推理档 | ✅ | ❌ |
| Enter/Ctrl+Enter、Markdown 列表续行 | ✅ | ❌ |
| Safari 16.2 / 手机键盘遮挡 / Stop 结束被占住的 bash / 压缩中提示 | ✅ | 部分 |

---

## 2. 本轮已迁移（可直接落地的部分）

| 文件 | 来源 | 落地方式 |
| --- | --- | --- |
| `lib/mcp-secrets.ts` | 上游原样 | 新依赖（`lib/mcp-secret-mask.ts` 用它） |
| `lib/mcp-secret-mask.ts` | 本仓新写 | `get` 出去掩码、`update` 回来按掩码换回真值（**修掉一个凭据泄漏面**） |
| `lib/mcp-read-only-policy.ts` | 上游原样 | `rpc-manager` 注册（chat-only / 子代理不挂） |
| `lib/mcp-tool-display.ts` | 上游原样 | `MessageView` 的工具名按 `server/tool` 显示 |
| `lib/mcp-config-key.ts` | 上游原样 | 已迁入，本轮未接线（状态/测试/撤销都要它） |
| `lib/mcp-undo.ts` | 上游原样 | 已迁入，本轮未接线（下一步） |
| `lib/mcp-command.ts` | 上游原样 | 已迁入（只读策略与 `/mcp` 共用常量），`/mcp` 本轮未接线 |

**为什么这批能直接搬**：都是纯函数或单个自包含扩展，依赖（`lib/session-tool-selection.ts`、
`MCP_EXTENSION_PATH`、`SessionEntry`）本仓都有，且上游的测试一起搬过来了。

**本轮修掉的实际问题**：本仓 `POST /api/mcp {action:"get"}` 原样回传 `env` / `headers` /
`oauth.clientSecret` 明文给浏览器（JSON 编辑器要用）。上游是从读侧掩码 + 没有 JSON 编辑器；
我们保留编辑器，所以做「出去掩码 / 回来还原」。

验证：`lib/mcp*.test.mjs` 210 条、`components/*.test.mjs` 645 条、`hooks/*.test.mjs` 72 条全绿；
`tsc` 对本仓文件干净；`check:design` 只剩另一个会话新加的 `LanPairPanel.tsx` 触发基线。

---

## 3. 建议的下一步（按性价比排序）

1. **删除撤销**（`mcp-undo.ts` 已迁入）：路由 `remove` 返回 token、`undo` 动作取回，面板一条
   notice + 按钮。**小、安全、用户能感知**。
2. **连接状态表**（`mcp-status.ts` + `mcp-config-key.ts` 接线）：面板行显示
   连接中/已连接/需登录/失败，测试结果按内容 HMAC 绑定（条目改了旧结果自动失效）。
3. **真连测试**（`lib/mcp-test.ts`）：上游的有界真连（15s/请求、20s 死线、`!command` 串行、
   先掩码后截断）。**需要你拍板**（远程部署下会在 Web 服务进程里 spawn 用户命令）。
4. **codemode 视图 + 设置**（`codemode-view.ts` / `CodemodeToolView.tsx` / `codemode-settings.ts`）：
   转录里把 codemode 渲染成「脚本 + 它调的工具」，设置里加 自动/始终 + mode + 预算。
   本仓刚把 codemode 打开（MCP 默认走它），这一项的收益马上变高。
5. **粘贴添加**（`mcp-import-*.ts`）：一次粘贴覆盖安装命令 / JSON / 安装链接，比本仓的
   「发现 + 手填」顺手很多。体量最大（~1500 行），但都是纯函数 + 一个粘贴框。
6. **`/mcp` 打开设置**：小。

---

## 4. 需要决策的两件事

1. **运行时模型是否换成上游的 `McpHost`？**
   换来的：连接按需（idle 释放）、首条消息不为 MCP 让路、改配置即时生效、状态可观测、
   孤儿连接防护。代价：`lib/mcp-host.ts` ~1000 行要接进 `rpc-manager` 的建会话/reload/Stop
   三条路，并替换掉本仓现有的 session-liveness 闸门方案（那套是 ADR 0006 里本仓自己的决定）。
   **建议：换，但单独一个 PR**，先落 `McpHost` 与它共存的开关，再切默认。
2. **真连测试的形态**：只在本机/桌面放开，远程部署继续只做结构校验？（§3 第 3 条依赖它）

---

## 4b. 迁移进度（2026-10-02 当日）

已接线并验证：
- **删除撤销**：`lib/mcp-undo.ts` + `readMcpServerEntryAt`/`insertMcpServerAt` + 路由
  `remove` 返回 token、`undo` 动作放回**原位** + 面板 notice（60 秒自动消失、410 收起）。
  真机验过：删除 → 撤销 → `tender, codegraph, stitch` 顺序复原、文件仍 0600、同 token 二次
  撤销 410。掩码配合 `lib/mcp-secret-mask.ts`（条目原文不过网络）。
- **`/mcp` 打开设置页**：`lib/mcp-command.ts` + `BUILTIN_SLASH_COMMANDS` 增 `mcp` +
  `onOpenSettingsSection` 接线。注意本仓实测：该会话的 `/mcp` 被用户装的
  `pi-mcp-adapter` 扩展占用，按上游规则「别的扩展的 `/mcp` 保留消息」，所以当前环境
  `/mcp` 仍发给那个扩展（行为正确）；内置 MCP 扩展拥有 `/mcp` 时才开设置页。

③ 真连测试 —— **已做完，与上游有一处刻意不同**（`lib/mcp-live-test.ts` + `lib/mcp-test-redact.ts` +
`lib/mcp-config-values.ts`，后两者取自上游）：默认**仍然只做结构校验**，只有运维显式打开
（`PI_WEB_ALLOW_MCP_TEST=1`）才真连。理由见该文件「边界」：本仓的 Web 服务可能部署在远程
机器上，那里的「测试连接」等于替远程用户 spawn 一条他配置的命令（上游是无条件真连，它假定
服务与用户同机）。上游那些有界做法全部保留：每请求 `min(timeout,15s)`、整体 20s 死线、
关闭最多等 2s、`!command` 串行、同条目重复点并同一次、结果**先掩码再截断**。
实测（本地 fixture server）：连上 0.76s / 2 个工具 / 读到 serverInfo；连不上时给出
`spawn … ENOENT`；**服务器往 stderr 写的密钥在响应里被换成 `•••`**（`contains secret: False`）。
切换开关的两个形态都验过：默认 `live:false` 只回结构校验结论。

已迁入 `docs/upstream-mcp-staged/`（暂不接线，依赖未到位）：
- `mcp-status.ts`（+ test）—— 写入者是真连测试与 McpHost，两者未到位；它还依赖上游
  `McpServerStatus`/`McpHostInactiveInfo` 类型（依赖 `McpTestResult` 与 host）。

下一步（按顺序）：③ 真连测试 → ④b McpHost 替换 → ② 状态表接线 → ⑤ 粘贴添加 → ④ codemode 视图/设置。

---

## 4c. 上游非 MCP 清单的核对与补齐（2026-10-02）

逐条核对（子代理拿两棵树比对，每条都有 `文件:行号`）：

- **已对齐 9 条**：运行中分叉、Enter/Ctrl+Enter + Markdown 续行、技能/插件批量开关、文件夹
  选择器新建、Stop 结束被孙进程占住的 bash、压缩提示、Anthropic 登录贴回、侧栏在文件管理器
  打开、Safari/iOS 16.2。
- **本轮补上 3 条**：② 运行中调推理等级（去掉只读守卫；原断言反过来重写）、⑪ 默认工作目录
  （迁上游 `lib/default-cwd.ts`：本地日期 + `~/pi-cwd/<YYYYMMDD>`，并改掉 `file-access` 里
  「按家目录内容推断白名单」的旧做法）、⑥ 手机键盘（60px 阈值 + 按缩放后高度比较 + 沉降链
  `SETTLE_DELAYS_MS` + IME 事件兜底）。
- **本轮补上 ⑯⑮ codemode**：迁 `lib/codemode-view.ts` + `components/CodemodeToolView.tsx`
  （转录里 codemode 变成「脚本 + 它调用的工具」）、`lib/codemode-settings.ts` +
  `lib/global-settings-file.ts` + `lib/regular-file.ts` + `PUT /api/tools/settings`，并新写
  `components/fork/McpCodemodeSettings.tsx`（本仓 MCP 页没有「点开非 server 详情」的位置，
  所以做成详情区顶部的可折叠块，形态不同、写盘口径同一把锁）。迁入时按本仓规范改了两处：
  上游的正则 lookbehind 换成扫描式（Safari 16.2 会白屏）、硬编码 hex 换成 token。
- **⑭ 粘贴添加（本轮做完）**：迁入上游解析层 `lib/mcp-import{,-cli,-json,-links,-core}.ts` +
  `lib/jsonc.ts` + `lib/shell-words.ts` + `lib/mcp-add.ts` + `lib/mcp-server-display.ts`（**78 条
  上游测试原样通过**），路由新增 `action:"paste"`（浏览器只发粘贴原文，服务端用同一解析器复解 +
  `prepareMcpAdd` 预检），UI 新写 `components/fork/McpPastePanel.tsx`。**没有搬上游那 656 行的
  `McpAddServer.tsx`**：它依赖本仓 `SettingsUi` 里没有的 6 个展示基件与它的 MCP 页数据层，搬
  过来等于把它的设计系统一并搬进来；解析/预览/拒绝原因这些有难度的部分已经在 helpers 里。
  `mcp-add-helpers.ts` 里三处依赖上游响应形状的判断改由 `components/mcp-add-trust-shim.ts`
  按本仓口径实现。
  真机验过（临时加进 `~/.pi/agent/mcp.json` 再删掉）：npx 安装命令 / JSON 配置 /
  `claude mcp add` / 裸 URL 四种都写入成功；「读不出 server 的东西」按上游口径当成
  一条命令（`readServerCommand` 的设计）；两条安全边界拦得住 ——
  **引用 `PI_WEB_PASSWORD` 的 env 拒绝**（`web-password`）、
  **项目级字面密钥拒绝**（`secret-global-only`，密钥只能进全局）。
- **仍未做**：⑬ MCP 凭据层（`lib/mcp-sign-in.ts` + `mcp-sign-out.ts` + 状态层）、④b 运行时换
  `McpHost`（② 状态表与 ⑱ 都等它）、⑰ 信任对话框列 MCP 条目与「添加服务器时顺带信任新
  文件夹」（**粘贴面板依赖它**：本仓目前只给「写全局 / 写已受信任的项目」两个出口，
  `components/mcp-add-helpers.test.mjs` 里 7 条相关断言已 `skip` 并在标题里写明原因与恢复条件）。

---

## 5. 与本仓已有能力的关系

本仓这几项上游没有，**保留**：
- `lib/mcp-discovery.ts`：从 Claude Code / Codex / Cursor / VS Code / Gemini / OpenCode /
  Windsurf 等 11 个来源发现已配置的 server（上游是「粘贴导入」，我们是「主动发现」）。
- `lib/mcp-catalog*.ts` + `/api/mcp/catalog/**`：连接目录、0600 凭据、目录 OAuth 回填。
- `lib/mcp-transport.ts`：`inheritEnv:false` + 宿主变量清洗 + `PI_WEB_PASSWORD` 拒绝 +
  失败冷却 + session-liveness 闸门（上游有前 3 条，没有冷却与闸门）。

冲突点：上游的 `mcp-transport.ts` 没有 `PI_WEB_PASSWORD` 之外的那层「拒绝引用」，也没有冷却；
若换 `McpHost`，transport 仍应沿用本仓这份。