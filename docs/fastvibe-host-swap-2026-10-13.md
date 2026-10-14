# FastVibe 宿主方案评估（壳 FastVibe × 核 PI NEXT）

日期：2026-10-13  
触发：用户提出「直接逐步替换成 fastvibe-0.19.5 2，壳子用 fastvibe、里面核心用 PI NEXT，或在 fastvibe 基础上加功能」  
本文是**决策文档**，不是执行台账。执行台账仍是 `docs/fastvibe-imitation-plan-2026-10-13.md`。

---

## 0. 一页结论

**技术上可行，而且比「逐页手抄 UI」在结构上更干净 —— 但它不是「换壳」，是换宿主 repo。**

先把三个实测数字放上来（本轮 subagent 实测，非估算）：

| | 行数 | 关键事实 |
|---|---|---|
| PI NEXT `lib/**` | **84,000**（411 文件） | **零 `next/server` import**；纯 Node/TS |
| PI NEXT `app/api/**` | 9,718（103 个 route） | 薄胶水（`NextResponse.json` → `Response.json`）；`proxy.ts` 64 行是唯一 middleware |
| PI NEXT UI `components/**` | ~82,000（173 tsx） | 两个方案里**都会被丢掉** |
| FastVibe renderer | **46,593**（148 tsx） | **零 Electron import**；只依赖注入全局 `window.fastvibe` |
| FastVibe `src/main` | 43,310（173 文件） | 它自己的 engine，覆盖与 PI NEXT lib 大量重叠 |
| FastVibe IPC 通道 | **215** | 适配面就在这里 |

**结论**：用户的想法可以落地，但真正的成本不在壳、也不在 UI，而在 **215 个 IPC 通道的适配**。因此建议先做 1 天 spike 把它变成一个数字，再决定 —— 见 §4。

---

## 1. 为什么技术上成立

### 1.1 PI NEXT 的 core 是框架无关的（可搬）

`grep -rn 'from "next/server"\|NextRequest\|NextResponse' lib/` → **0 命中**。

Next.js 只出现在：
- `app/api/**/route.ts` × 103（9.7k 行，绝大多数 handler 收的是普通 `Request`、返的是普通 `Response`；只用 `NextResponse.json` 省事）
- `proxy.ts`（64 行，LAN 闸门 middleware，body 只是调 `lib/lan-access.ts` 的纯函数）
- `instrumentation.ts` / `instrumentation-node.ts`（67 行，启动 scheduler / channel autostart / tunnel / SIGTERM，换宿主时手动从 `main()` 调即可）
- 客户端 `components/**` 里 3 个 `next/*`（跟本议题无关）

**所以 `lib/**` 84k 行几乎可以逐字搬到任何 Node 宿主**，机械工作只有 `@/lib` 别名与 pi SDK 可解析性。

### 1.2 FastVibe 的壳是框架无关的（可搬）

- `src/renderer/src` **零 Electron import**（全量 grep 只剩 1 处注释、1 处 fixture 字符串）。
- 全部后端调用走 `window.fastvibe.<group>.<method>()`（~275 处 / 66 文件）。
- `window.fastvibe` 由 `src/shared/api.ts` 的 `createFastVibeApi(t: ApiTransport)` 构造 —— 该文件自己写着：
  > "The desktop preload reaches Main over Electron IPC; the web client reaches the same Main over a WebSocket… Nothing Electron-specific belongs here."
- `src/shared/app-client.ts` 是**浏览器安全**的 App Protocol 客户端（无 Node 依赖）。
- `src/main/server/server.ts` 是 Node `http` + `ws` 的 App Protocol 服务端，注释写着 "Deliberately free of Electron… what would let this run without a GUI later"，默认 loopback、可开 LAN。
- 已经有纯浏览器 mock 入口 `src/renderer/mock.html` + `mock/preview.ts`（1024 行处安装 fixture `window.fastvibe`），证明 UI 在浏览器里能跑起来。

**这个 seam 正是「壳 FastVibe + 核 PI NEXT」的接缝所在。**

---

## 2. 三条路的成本对比

| | 保留 | 丢掉 | 主要工作量 | 交付形态 |
|---|---|---|---|---|
| **A** 现计划（L1–L8 已落） | PI NEXT 全部 lib + 103 route + Next 宿主 | PI NEXT 82k 行 UI | **手抄 FastVibe 46.6k 行 UI**（57 PR）；结果是「像」，不会「是」，且会持续漂移 | 浏览器 + LAN + PWA + 手机（不变） |
| **B** 换宿主（用户想法·其一） | FastVibe renderer + 它自己的 main/engine | PI NEXT 宿主与 UI | 在 FastVibe main 里补 PI NEXT 独有功能 ≈ 15–25k 行 lib + 其 UI；**且两边 engine 大量重叠**，要逐块裁定谁赢 | Electron 桌面 + Flutter 手机（换栈） |
| **C** 混合（壳 FastVibe + 核 PI NEXT，用户想法·其二） | FastVibe renderer 46.6k + PI NEXT `lib/**` 84k | PI NEXT UI + Next 宿主 | **实现 215 个 IPC 通道**（多数是薄委托，因为两边都是 pi SDK 包装） | renderer 可同时出 Electron 与 Web（走 §1.2 的 transport 接缝） |

**重叠区的现实**：FastVibe `src/main` 43.3k 行里，会话管理 / 模型 / provider / MCP / skill / subagent / 终端 / 转录 这些与 PI NEXT lib 是**同一件事的两份实现**。B 方案要么删掉 PI NEXT 那份、要么删掉 FastVibe 那份 —— 无论哪个方向，都要逐块比对行为（PI NEXT 的 AGENTS.md 里 `fork:*` 那几十条不变量都挂在这些块上）。

**215 通道的分组**（FastVibe `src/shared/ipc.ts`，去重后）：

```
engine 67   workspace 25   providers 21   ssh 15      conversations 15
remote 10   computer 9     window 6       settings 6  decision 6
browser 6   update 5       projects 5     memory 5    dag 5
account 5   app 3          models-dev 2   stats 1                    = 215
```

其中 `engine / conversations / providers / settings / workspace / projects / app / stats` 与 PI NEXT 有直接对应（都包 pi SDK），是**薄委托**；`dag / ssh / computer / remote / account / memory / decision` 是 FastVibe 独有面，C 方案下要么保留它的实现、要么砍掉对应 UI。

---

## 3. 两个必须先定的硬约束（产品取舍，不是技术细节）

### 3.1 会话目录：共用还是隔离

- **PI NEXT**：与 pi CLI / TUI 共用 `~/.pi/agent/sessions`，这是刻意的设计（web / CLI / TUI 看到同一份会话与分支）。
- **FastVibe**：**刻意隔离** —— `agentDir = <userData>/runtime/engine/agent`，注释写着 "FastVibe never uses this as its runtime"。它只额外提供「同步 pi 配置」写 `~/.pi/agent`，以及一个 pi 会话**导入器**。

**选 FastVibe 宿主 = 放弃与 CLI/TUI 的实时互通**（有导入路径，不是实时）。

### 3.2 交付形态：Web/LAN/PWA/手机 ⇄ Electron/Flutter/WebRTC

- PI NEXT：浏览器 + LAN（loopback 闸门 + 6 位配对 + tunnel）+ PWA + Capacitor + 手机同步协议。
- FastVibe：Electron 桌面（原生 vibrancy / 自绘标题栏）+ Flutter 手机 + 自有 WebRTC/TURN 中继（依赖它的云服务）。

选 FastVibe 宿主 = 换一整套移动/远程栈。**注意 C 方案下 renderer 本身能出 Web 版**（§1.2），所以 3.2 的损失比 B 方案小 —— 但仍要自己补 LAN/配对/PWA，因为那是 PI NEXT 在 FastVibe **壳之外**的东西。

---

## 4. 建议：先做 1 天 spike，不做任何迁移

把最大的未知（215 通道适配成本）变成数字，再决定 A / B / C。**spike 期间不改任何现有代码、不建分支合并。**

### Spike 定义（可判定的完成标准）

1. 起一个最小 Node `http` 服务（可直接复用 FastVibe `src/main/server/server.ts`，或先按 `src/shared/app-protocol.ts` 手写 100 行）。
2. 用 `createFastVibeApi(transport)` 实现 **12 个通道**，背后接 PI NEXT：
   - `engine:get-state`、`engine:submit-prompt`、`engine:get-messages`、`engine:abort`、`engine:get-models`、`engine:set-model` → `lib/rpc-manager.ts`
   - `conversations:list` → `lib/session-reader.ts`
   - `providers:list`、`settings:get`、`settings:set` → PI NEXT 对应 lib
   - `engine:new-session`、`workspace:git-status`（或同类）
3. 让 FastVibe renderer 在**浏览器**里（`mock.html` 换成真 transport，放宽 CSP `connect-src`）**发出第一条真实消息并流式收回来**。
4. 产出两页纸：单通道平均成本 × 215 的推算；`dag/ssh/computer/remote/account/memory/decision` 这 8 组共 61 个通道的可砍清单。

### 判定口径

- 若 12 通道里 ≥ 8 个能在 1 天内薄委托跑通 → C 方案的成本主要在「补 FastVibe 独有面的 UI」，可继续。
- 若多数通道需要重新实现行为（而非委托）→ C 的成本与 B 等价，此时应直接选 B 或回到 A。

---

## 5. 与现计划的关系

- 本文**不取代** `docs/fastvibe-imitation-plan-2026-10-13.md`。A 方案已落 L1–L8（浮岛壳 / 侧栏 / 设置 / 转录 / 浮层 / 错误页），这些改动在 B/C 方案里**不会浪费** —— 因为它们改的是「形态规范」（Tailwind + shadcn + Hugeicons + 24 主题 + 浮岛几何），而 B/C 方案同样吃这套规范（FastVibe 就是它的来源）。
- 若选 C：现计划的 H 批次（换基座）直接复用；L 批次（逐页抄 UI）**取消**，改为「把 FastVibe renderer 接上 PI NEXT 核」。
- 若选 B：现计划的 L 批次也取消，但 PI NEXT 独有功能的移植清单要重新盘（IM / 生图 / 联网 / LAN / 同步 / 文档工具 / MCP 深度）。

---

## 6. 待用户裁定

1. 会话目录：接受 FastVibe 的隔离（+导入器），还是必须保住 `~/.pi/agent` 实时互通？（这一条基本一票否决 B/C 的「纯 FastVibe 宿主」形态）
2. 移动端：接受换成 Flutter App，还是必须保住现有 PWA / Capacitor / 手机同步？
3. 是否先跑 §4 的 spike？
