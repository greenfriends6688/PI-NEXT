# FastVibe 宿主迁移完整计划（壳 FastVibe × 核 PI NEXT）

日期：2026-10-13  
触发：用户「直接逐步替换成 fastvibe-0.19.5 2，壳子用 fastvibe、里面核心用 PI NEXT，或在 fastvibe 基础上加功能」  
前置评估：`docs/fastvibe-host-swap-2026-10-13.md`（本文取代它的结论部分）  
现计划（将被本文替代或收窄）：`docs/fastvibe-imitation-plan-2026-10-13.md`

---

## 0. 一页结论

**推荐方案 B′：把 FastVibe 0.19.5 当宿主 repo，PI NEXT 只搬「FastVibe 没有的那部分」。**

| 决策 | 内容 |
|---|---|
| 宿主 | FastVibe 0.19.5（Electron 44 + electron-vite + React 19 + Tailwind v4 + shadcn/Base UI；engine 43.3k 行，renderer 46.6k 行） |
| 搬什么 | PI NEXT `lib/**` 84k 行里**只搬约 19k 行**（FastVibe 真的没有的功能，见 §6） |
| 不搬什么 | Next.js 宿主、103 个 route、`proxy.ts`、`instrumentation*`、全部 `components/**`（82k 行）、V5/V6 画板与门禁 |
| 移动端 | **保留 FastVibe 的 Flutter app**（实测成熟）；**另给 renderer 加 Web 入口 → 新的 PWA**（renderer 零 Electron 依赖，接缝已就绪） |
| 会话目录 | 把 FastVibe 的 `agentDir` 指回 `~/.pi/agent`（一处改动），保住与 pi CLI / TUI 的实时互通 |
| 代价（要知道） | 已落地的 L1–L8（往 Next.js 里搬 FastVibe 形态）**基本作废**——那些改动服务的是错误宿主 |
| 工作量估计 | **20–28 个工作日**（对比现计划 A 的 57 个 PR） |

**为什么不选「壳 FastVibe + 核 PI NEXT」（方案 C）**：那需要把 FastVibe 的 **215 个 IPC 通道**接到 PI NEXT 的 lib 上，其中 58 个（dag / ssh / computer / remote / account / memory / decision / 导入）PI NEXT **根本没有对应实现**——等于要把 FastVibe 的 engine 功能重新写一遍。B′ 反过来走：FastVibe 的 engine 原样留着，PI NEXT 只补自己独有的能力。

---

## 1. 三个方案的对照（结论来自实测，不是估算）

| | 保留 | 丢掉 | 主要工作量 | 交付形态 |
|---|---|---|---|---|
| **A** 现计划 | PI NEXT 全部 lib + 103 route + Next 宿主 | PI NEXT 82k 行 UI | 手抄 FastVibe 46.6k 行 UI（57 PR）；结果只是「像」 | 浏览器 + LAN + PWA + 手机 |
| **C** 壳 + 核（用户想法·其一） | FastVibe renderer + PI NEXT `lib/**` | PI NEXT UI + Next 宿主 | **215 个通道适配**，其中 58 个无对应实现 | 三端（Electron / Web / Flutter） |
| **B′** 换宿主 + 补功能（用户想法·其二，**推荐**） | FastVibe 全部（renderer + engine + Flutter） | Next 宿主 + Next UI | **只搬 PI NEXT 独有的 ~19k 行** | 三端（Electron / Web / Flutter） |

### 支撑数据（本轮实测）

| 事实 | 证据 |
|---|---|
| PI NEXT 的 core 框架无关 | `grep -rn 'next/server' lib/` = **0 命中**；84k 行纯 Node/TS |
| Next 绑定面很小 | 103 个 route（9,718 行）+ `proxy.ts`（64 行）+ `instrumentation*.ts`（67 行） |
| FastVibe 的壳框架无关 | `src/renderer/src` 零 Electron import；全部调用走注入全局 `window.fastvibe` |
| 接缝已经存在 | `src/shared/api.ts:createFastVibeApi(transport)`（注释原文 "Nothing Electron-specific belongs here"）+ `src/shared/app-client.ts`（浏览器安全客户端） |
| renderer 能在浏览器跑 | `src/renderer/mock.html` + `mock/preview.ts`（1024 行处安装 fixture `window.fastvibe`） |
| FastVibe 有 headless 宿主 | `src/agent/main.ts`（`fastvibe-agent`，默认 7777，AppServer + `HEADLESS_CAPABILITIES`） |
| 通道总数与分组 | `src/shared/ipc.ts` 去重 **215**：engine 67 / workspace 25 / providers 21 / ssh 15 / conversations 15 / remote 10 / computer 9 / window 6 / settings 6 / decision 6 / browser 6 / update 5 / projects 5 / memory 5 / dag 5 / account 5 / app 3 / models-dev 2 / stats 1 |

### 215 通道里 PI NEXT 无对应实现的（方案 C 的核心成本）

```
dag 5 · ssh 15 · computer 9 · remote 10 · account 5 · memory 5 · decision 6
+ engine:import-{sessions,candidates,sources} 3            = 58 个
```

方案 B′ **完全不碰这 215 个通道**——FastVibe 的 engine 原样留着。这是 B′ 比 C 便宜的根本原因。

---

## 2. 目标架构

```
┌─ FastVibe repo（宿主）────────────────────────────────────────────┐
│                                                                   │
│  src/main   ← FastVibe engine 原样（pi SDK host / app-server /     │
│                remote / rtc / ssh / dag / memory / decision）      │
│      +                                                           │
│  src/main/pinext/**   ← 本计划新增：PI NEXT 独有功能的移植区        │
│      ├─ extensions/   工具扩展（生图 / 联网 / 文档 / plan-todo）    │
│      ├─ services/     IM 桥 / bot channel / 定时任务 / tunnel      │
│      └─ engine/       MCP 导入器 / 密钥 / 目录                     │
│                                                                   │
│  src/renderer  ← FastVibe UI 原样 + 新增「PI NEXT」设置分节        │
│  src/shared    ← + pinext 的通道名与类型（新方法，不动旧 215 个）   │
│                                                                   │
└──────────────┬────────────────────────────┬───────────────────────┘
               │                            │
     Electron 窗口（原样）        Web 入口（新增，= 新 PWA）
                                   ↳ createFastVibeApi + AppClient over WS
                                   ↳ 由 FastVibe 自己的 http server 托管
                                   ↳ 现有 Capacitor 壳可直接包它
               │
     Flutter app（原样，走 app-protocol）
```

**三种前端、一个宿主、一份 engine。** 这是 A / C 都拿不到的形态。

---

## 3. 移动端实测（用户问题的直接回答）

**FastVibe 确实有移动端：`apps/mobile_flutter`，一个原生的 iOS + Android 应用**（Flutter 3.47 / Dart 3.13，package `fastvibe_mobile` 0.5.6+506）。

### 它能做什么

| 能力 | 实现 |
|---|---|
| 设备管理 | 保存 / 重命名 / 收藏 / 搜索机器（`screens/devices.dart`，6 条路由） |
| 配对 | 扫二维码 / 手输 `host[:port]`+密码 / mDNS 「附近的电脑」 |
| 会话列表 | 按「等你 / 运行中 / 最近」分组 + 项目过滤 + 归档 + **服务端全文搜索** |
| 读转录 | Markdown + 数学 + 思考块 + 工具卡分组 + 图片 + 代码块 + 表格 |
| 发消息 | 文本 + 最多 4 张照片（缩放到 2048px/JPEG）+ 耐久队列（steer / follow-up / stop / resume） |
| **回答阻塞式提问** | 权限 / 确认 / 选择 / 输入 / 多问题（`engine:permission-respond`） |
| 切模型与思考档 | `engine:set-model` / `engine:set-thinking`（8 档） |
| 看子代理与 DAG | 任务层级、每节点指令/验收/产物、重试/停止/恢复/取消、子代理转录 |
| 通知 | **本地通知**（运行完成 / 失败 / 需要答复），随通知跳进正确的机器与会话 |
| 手机设置 | 主题 / 语言 / 触感 / 通知 / 玻璃 / 连接诊断 / 更新日志 / Android 自更新（arm64 APK） |

### 连接方式（三条，都不依赖 FastVibe 云也能用前两条）

1. **局域网直连 WebSocket** — mDNS `_fastvibe._tcp` 发现，`ws://<host>:7777/ws`
2. **公网 / 隧道域名** — `wss://host/ws`（FastVibe **不再内置** cloudflared，需自备反代 → 这正是 PI NEXT 的 tunnel 值得搬的理由，见 §6 T3）
3. **账号云连接** — WebRTC data channel + TURN 中继（`app.fastvibe.dev`，**只有这条需要云**）

**认证**：密码（scrypt，N=32768）→ 256-bit 设备令牌，存 Keychain/Keystore；二维码里**只有地址，不含密钥**；改密码即吊销所有设备。

### 与 PI NEXT 现有 PWA / Capacitor 壳的对比

| 维度 | FastVibe Flutter | PI NEXT PWA + Capacitor |
|---|---|---|
| 形态 | 原生 App（仅 iOS/Android，**无 web target**） | 浏览器 PWA + 原生壳 |
| 发现 | **mDNS** 自动列出附近电脑 | 无 mDNS，扫码 / 手输 |
| 配对 | 打密码 | **6 位一次性码**（10 分钟、单次、限流） |
| 通知 | **原生本地通知** | 壳内本地通知 + 浏览器 Web Push |
| 离线阅读 | **无**（消息只在内存，重连重读） | **有**（缓存 `export?inline=1` 自包含 HTML） |
| 草稿 | 有（`draft_storage.dart`） | 有（`lib/draft-store.ts`） |
| 外部可达 | 自带 WebRTC/TURN（需云） | cloudflared tunnel（可自建） |
| 成熟度 | 21 个单测文件 + 1 集成测试（~185 用例）、双语文案、双主题全屏渲染测试 | 自研同步协议 + 自研壳 |

**推荐**：主机端选 FastVibe 时，**保留 Flutter app**（它是一个完整、有测试的原生客户端，不是半成品），同时**给 renderer 加 Web 入口**——于是浏览器/PWA 形态由 FastVibe 自己的 UI 承担，而不是维护第二套手机壳。PI NEXT 的「离线阅读」若仍想要，可作为 Flutter 的增量（`engine:export-html` 已经存在）。

---

## 4. 会话与数据

### 4.1 `~/.pi/agent` 决策（**建议：指回去**）

- PI NEXT 与 pi CLI / TUI **共用** `~/.pi/agent/sessions`（刻意设计，三方看到同一份分支）。
- FastVibe **刻意隔离**：`agentDir = <userData>/runtime/engine/agent`，源码注释写着 "FastVibe never uses this as its runtime"；它只提供「同步 pi 配置」与一个 pi 会话**导入器**。

**计划**：改 `src/main/engine/paths.ts` 的 `agentDir` 为 `~/.pi/agent`（一处赋值 + 需要复核 FastVibe 对转录做原子写/修复的 `engine/transcript-file.ts` 是否与 pi CLI 的写盘假设冲突）。若复核不通过，则退回「隔离 + 一次性导入」，代价是 CLI/TUI 不再实时互通。

### 4.2 过渡期

- 现有 PI NEXT 会话：FastVibe 已有 `engine/import/sources/pi.ts` 读 `~/.pi/agent/sessions`；若 §4.1 指回去，则无需导入。
- 现有 PI NEXT 配置：`~/.pi/agent/pi-web-preferences.json`（记忆开关 / 联网搜索 / 界面开关 / 身份）、`im-bridge.json`、`imagegen.json`、`chat-channels-state.json` 全部由移植后的模块**原样继续读写**——这是选择「搬 lib 而不是重写」的直接收益。

---

## 5. 通道面：B′ 不动它

方案 C 才需要实现 215 个通道。B′ 下：

- FastVibe 的 `src/shared/ipc.ts` 215 个通道**全部保持**（engine / workspace / providers / conversations / ssh / dag / remote / computer / …）。
- PI NEXT 的移植**只会新增方法**（例如 `pinext:im-send`、`pinext:imagegen-state`、`pinext:websearch-query`），走同一套 `createFastVibeApi` + capability 机制。
- 新增方法必须补两条规则，否则 FastVibe 启动即 fail-closed（`RemoteServer.start` 调 `assertPolicyCoverage`）：
  1. `src/shared/remote-policy.ts` 的 ALLOW/DENY 分类；
  2. `src/main/app-server/capabilities.ts` 的前缀 → capability 映射。

这个「新通道必须登记否则拒绝启动」的约束是 FastVibe 的强项，直接复用。

---

## 6. 移植清单（PI NEXT → FastVibe 宿主）

行数是实测（`wc -l`，不含测试）。分四档按耦合度排序。

### T1 工具扩展（低耦合，几乎逐字搬）≈ 6.7k 行 · 3–4 天

| 功能 | 源文件 | 行数 | 备注 |
|---|---|---|---|
| 生图 | `lib/imagegen-{config,extension,shared}.ts` | 929 | pi SDK extension factory；默认落 `~/.pi/agent/generated-images/`；三种方言（openai/agnes/google） |
| 联网搜索 | `lib/websearch/**` + `websearch-{extension,settings}.ts` | 1,060 | 免 key provider 链；SSRF 边界在 `lib/websearch/fetch.ts` |
| 文档工具 | `lib/document-{docx,pdf,xlsx,pptx,xml,zip,files,tools-extension}.ts` | 2,974 | **路由无关**，注册即用 |
| plan / todo / 审批 | `lib/{plan-tools-extension,plan-documents,todo-{state,extension},approval-{policy,extension}}.ts` | 1,713 | FastVibe 有权限面板，但**没有** plan 模式与 todo 卡；这是净增量 |

### T2 服务类（需适配宿主 API）≈ 5.1k 行 · 5–7 天

| 功能 | 源文件 | 行数 | 适配点 |
|---|---|---|---|
| IM 桥 | `lib/im-bridge{,-shared}.ts`、`im-extension.ts` | 579 | 配置读写 + `im_send` 工具；**几乎不动** |
| Bot channel | `lib/chat-channel{,-shared,-register}.ts`、`bot-channel-runtime.ts`、`telegram/weixin/feishu-channel.ts` | 1,770 | 需要拿到「发一条 prompt 进会话」的宿主 API（换成 FastVibe 的 `engine:submit-prompt` 路径） |
| 定时任务 | `lib/automation-{lease,runner,runtime,schedule,scheduler,store,types}.ts` | 2,203 | 需要会话可用性信号；FastVibe 有 `process-manager-events.ts` 可挂 |
| 用量统计 | `app/api/usage-stats` + `lib/usage-*` | 待测 | FastVibe 已有 `stats:usage`，先比对再决定是否补 |

### T3 网络（补 FastVibe 的缺口）≈ 0.4k 行 · 1 天

| 功能 | 源文件 | 行数 | 理由 |
|---|---|---|---|
| cloudflared quick tunnel | `lib/tunnel-manager.ts` | 421 | FastVibe 的 `fastvibe-setup/SKILL.md:41` 明写**不再内置** cloudflared，外网可达要自备反代；PI NEXT 这条正好补上，且能与 §4.1 的 `~/.pi/agent` 共用配置 |

**不搬**：PI NEXT 的 LAN 闸门（`proxy.ts` + `lib/lan-access.ts`）与 6 位配对（`lib/lan-pair.ts`）——FastVibe 已有自己的监听器 + 密码 + 设备令牌 + mDNS，两套并存只会打架。若要 6 位码体验，最小改法是把它加进 FastVibe 的 `src/main/server/store.ts`，而不是整包搬。

### T4 MCP 深度（FastVibe 有 mcp-manager，缺导入/目录/密钥）≈ 3.6k 行 · 3–4 天

| 功能 | 源文件 | 行数 |
|---|---|---|
| 从 Claude/Codex/Cursor/VS Code 发现并导入 | `lib/mcp-import-{core,cli,json}.ts` | 2,615 |
| 密钥处理 | `lib/mcp-secrets.ts` | 523 |
| 目录 / OAuth | `lib/mcp-catalog.ts` + `app/api/mcp/catalog*` | 468 |

### T5 移动端 ≈ 0–2 天

| 选项 | 工作量 |
|---|---|
| 保留 Flutter（**推荐**）+ 给 renderer 加 Web 入口 | 1–2 天（Web 入口见 §7 P2） |
| 额外给 Flutter 加离线阅读 | +1–2 天（可选） |

### T6 设置页增量 ≈ 1–2 天

在 FastVibe 的 `components/settings/*` 里新增「PI NEXT」分节：生图 / 联网搜索 / IM 桥 / Bot channel / 定时任务。**照 FastVibe 的 `settings-group.tsx` 行规格写**，不发明新样式。

---

## 7. 阶段与 PR 清单

```
P0 冻结与建房（0.5 天）
  → 冻结 A 计划的 L 批次（L9/L10 不再执行）
  → 裁定 §4.1 会话目录、§3 移动端形态

P1 宿主落位（1 天）
  → 在 git worktree 里建分支 `fastvibe-host`
  → FastVibe 0.19.5 源码整体进入（pnpm 工作区，与现有 npm 树不同目录）
  → 保留本仓 history；`docs/` 与 `pi参考项目/` 带过去
  → 验收：`pnpm typecheck` + `pnpm test` 全绿（FastVibe 自带）

P2 Web 入口 —— 新的 PWA（1–2 天）
  → 新增 web 构建目标（vite，input = 一个新的 web.html）
  → bootstrap：`createFastVibeApi(AppClient over WS)` 注入 window.fastvibe
  → 放宽 CSP `connect-src`；处理两个 Electron 专属值（pathForFile、app.platform/settings.initial）
  → 由 FastVibe 自己的 http server 托管静态产物
  → 验收：浏览器打开能列出会话并发出第一条真实消息（流式回收）

P3 会话目录对齐（1 天）
  → `engine/paths.ts` agentDir → `~/.pi/agent`（或走隔离 + 导入）
  → 复核 `engine/transcript-file.ts` 的原子写与 pi CLI 是否冲突
  → 验收：CLI 新建的会话在桌面端可见，反之亦然

P4 T1 工具扩展（3–4 天）—— 4 个独立 PR
  → 生图 / 联网 / 文档 / plan-todo-审批
  → 每个 PR 六件套：实现 + 设置页入口 + `.test.mjs` 随迁 + 运行时 `get_tools` 验证

P5 T2 服务类（5–7 天）—— 3 个 PR
  → IM 桥 → Bot channel → 定时任务
  → 每个 PR 必须补 remote-policy + capability 两条登记，否则宿主拒绝启动

P6 T3 + T4（4–5 天）—— 2 个 PR
  → tunnel（含设置页开关）
  → MCP 导入 / 密钥 / 目录

P7 T6 设置分节 + 打包（2–3 天）
  → 「PI NEXT」分节
  → 重新走打包链：Electron 桌面（mac/win）+ Web 产物 + Flutter（已有）

P8 收尾（1–2 天）
  → 把 PI NEXT 的 `fork:*` 不变量按主题逐条复核（可拦、可统计、有 UI 的三问）
  → 路线图归档；旧仓冻结为「core 参考」
```

**关键顺序理由**：P2 必须在 P4 之前——它证明「三种前端、一个宿主」真的成立，是所有后续工作的地基；若 P2 失败，应立即退回 A 或 C。

---

## 8. 不移植清单

| 项 | 理由 |
|---|---|
| Next.js 宿主、103 个 route、`proxy.ts`、`instrumentation*` | 宿主换成 Electron main；FastVibe 已有等价能力 |
| PI NEXT 全部 `components/**`（82k 行）与 `d-*`/`m-*` CSS | FastVibe 的 UI 直接接管 |
| V5 / V6 画板体系与 `design:*` 门禁 | 已停用；验收改为 FastVibe 对照 |
| LAN 闸门 + 6 位配对 + presence + `/api/sync` 字节游标 + Web Push | FastVibe 的 remote / mDNS / app-protocol / Flutter 本地通知覆盖同一场景；两套并存会打架 |
| PWA + Capacitor 壳 | 由 FastVibe renderer 的 Web 入口替代（能力更强，且是同一套 UI） |
| 记忆能力 | PI NEXT 的 `pi-hermes-memory` 开关是**给第三方扩展加闸**；FastVibe 有自己的 `engine/memory*.ts`，接管后无此需求 |
| Electron 原生窗口 chrome / vibrancy | 反过来变成 FastVibe 的原生能力，白拿 |

---

## 9. 验收

| 层 | 手段 |
|---|---|
| 类型 | `pnpm typecheck`（FastVibe 自带：node + web 两套 tsconfig） |
| 单测 | `pnpm test`（`node --test test/**/*.test.ts`）**＋** 随迁的 PI NEXT `.test.mjs`（同为 `node --test`，可直接跑） |
| 移动端 | `flutter analyze` + `flutter test`（21 个单测文件 + 1 集成） |
| 运行时工具可见性 | 起独立端口宿主，`curl get_tools` 确认新增工具名真的露给模型（**PI NEXT 的既有教训：编译绿 / 单测绿都不证明模型看得见**） |
| 三端连通 | Electron 窗口、浏览器（新 PWA）、Flutter app 分别发出真实消息并流式回收 |
| 会话互通 | CLI 建会话 → 桌面端可见；桌面端建会话 → CLI 可见 |
| 打包 | Electron mac/win 安装包 + Web 产物 + Flutter APK；冒烟按各自技能走 |
| 远程策略 | 新增方法全部在 remote-policy 与 capabilities 登记；宿主能启动（`assertPolicyCoverage` 不抛） |

---

## 10. 风险与回退

| 风险 | 影响 | 缓解 |
|---|---|---|
| P2（Web 入口）不成立 | 「三种前端一个宿主」破功 | 它是第一个交付物；失败即回退 A 或 C，损失 1–2 天 |
| `~/.pi/agent` 直连后 FastVibe 的转录重写与 pi CLI 冲突 | 会话文件损坏 | 改前先备份 + 只读比对一整个真实会话；不行就退回隔离 + 导入 |
| FastVibe 版本继续演进（0.19.5 是快照） | 移植区与上游脱节 | 移植全部落在 `src/main/pinext/**` + 少量登记点，保持与上游文件**零修改**（只加不改），便于 rebase |
| PI NEXT 的 `fork:*` 不变量在搬运中丢失 | 静默功能退化 | P8 逐条复核；每个移植 PR 附「三问」答复（改状态吗 / 用户看得见吗 / 提示词还是代码） |
| 两套包管理器（pnpm vs npm）并存 | 构建混乱 | 宿主 repo 用 pnpm 独占；PI NEXT 旧仓冻结，不再参与构建 |

---

## 11. 待你裁定

1. **是否执行 B′**（本计划），还是继续 A（现计划 L 批次）？
2. **会话目录**：改 FastVibe 的 `agentDir` 指回 `~/.pi/agent`（推荐），还是接受隔离 + 一次性导入？
3. **移动端**：确认保留 FastVibe 的 Flutter app，并新增 Web 入口当 PWA？还是必须保住现有 PWA / Capacitor？
4. **是否先只做 P0–P3**（约 4 天，含 Web 入口与会话对齐）？这一步不做任何功能移植，纯粹验证宿主成立——通过了再决定 T1–T6 的取舍。
