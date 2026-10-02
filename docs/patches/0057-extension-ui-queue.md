# 扩展 UI 按 id 排队 + 压缩相位

| | |
| --- | --- |
| 状态 | 已实现（单测 8 条新增；合并时全量 2546 pass / 0 fail） |
| 上游依据 | `70470ca` · `e17d2cc`（扩展 UI 排队）、`2e66e40`（#1008 压缩相位） |
| fork 标记 | `grep -rn "extension-ui-queue\|extensionUiQueue" hooks components lib` |

## 问题

`hooks/useAgentSession.ts` 是**单槽** `useState`：两个工具并行跑、各自被权限扩展 gate 住时，
后一个请求顶掉前一个，**前一个的服务端 future 永远不 resolve**——请求永久挂死。
我们的 `lib/approval-extension.ts` 是这类交互的主要来源，所以这是真 bug 不是新功能。

## 改法

- 新增 `lib/extension-ui-queue.ts`：两条按 `id` 排队的队列（dialog / custom panel）。
  响应、取消、`extension_ui_closed` 各摘自己那个 id；custom 面板原地 upsert；
  换工具预设重建 wrapper 时清队列。
- **`extension_ui_closed` 原来只摘对话框，custom 面板关不掉**——顺带修掉的第二个 bug。
- 陈旧 id 裁剪：上游靠服务端在 `connected` 里带 `pendingExtensionUiIds`，那要改
  `lib/rpc-manager.ts`（当时不在改动面内），改用服务端**本来就会发的重放**
  （`onEvent()` 订阅时重放每条待决请求）——客户端开「重放窗口」收集 id 后裁剪。
  窗口提前收口是安全的：被误裁的请求会被重放重新入队。**日后能改服务端就换成上游写法。**
- 压缩相位：`phaseLabel`/`phaseKeyOf` 纯函数化进 `components/fork/PhaseRoll.tsx`，
  `isCompacting` 压过 `waiting_model` 及一切相位，且是**独立相位身份** `"compacting"`。

## 验收缺口

**多格叠放没有画板背书**：单格时几何与改动前逐像素同形，但两个审批框同屏时是 `.map()`
堆叠 + `overflowY: auto`，画板 50 没有这一形态，`verify:boards` 当时跑不了（主仓占着
30141 与 `.next`）。**评审时要人眼过一眼。**
