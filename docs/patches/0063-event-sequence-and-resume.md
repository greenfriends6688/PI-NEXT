# 事件序号 + 断线续传 + 缺口对账

| | |
| --- | --- |
| 状态 | 已实现（新增单测 25 + 全量 `npm test` 3918 通过 / 8 跳过 / 0 失败） |
| 来源 | XTLaw `service/src/events/*`（每 run 单调 `sequence` + `afterSequence` 增量 + `hasChatRunEventSequenceGap`）· `docs/xtlaw-pr-plan-2026-10-10.md` A1 |
| 新增文件 | `lib/agent-event-log.ts`、`lib/agent-event-log.test.mjs` |
| 上游接触面 | `lib/agent-event-stream.ts`、`lib/agent-event-connection.ts`、`lib/agent-event-wire.ts`、`lib/rpc-manager.ts`、`hooks/useAgentSession.ts`、`app/api/agent/[id]/events/route.ts` |

## 解决什么

SSE 事件原本没有序号，重连时服务端只重发 `connected` + 流式消息快照：

- **断线期间已经跑完的工具调用永远不出现** —— 客户端要到这一轮结束
  （`agent_end` / `agent_settled` 里的 `loadSession()`）才从文件里补上。长时间多工具的一轮
  加上中途息屏/切网，界面就会一直缺内容。
- 客户端**无法知道自己漏了东西**：没有游标，也没有缺口判据。

## 怎么做

**序号在 wrapper 里分配，不在 SSE 流里**（`lib/rpc-manager.ts` 的 `emit`）。这一点是关键：
只有在这里编号，**没有客户端连着的时候事件也进了缓冲**，重连才补得出来。

- `AgentEventLog`（新，纯逻辑）：给每条**权威事件**一个会话内单调递增的 `seq`，同时存下
  已经序列化好的 SSE 负载（避免在流里再 stringify 一次）。缓冲有界（默认 500 条 / 4 MB），
  滚过之后 `replayAfter()` 如实回报 `complete: false`。
- **可重建的增量不编号**（`*_delta`、`tool_execution_update`）：它们本来就会在背压下被丢
  （#997 的水位逻辑），给它们编号只会制造假缺口；它们的 `*_end` 会带权威内容补回来。
  判据 `isDroppableEvent()` 从 `agent-event-stream.ts` 移到 `agent-event-wire.ts`，
  「丢不丢」和「编不编号」从此共用同一处定义。
- **SSE 流**（`agent-event-stream.ts`）：权威事件写 `id: <seq>`；`?lastEventId=<seq>` 带回来
  时先补发 `seq > lastEventId` 的缓冲，**补得齐就不再发快照**（补上的事件里已经有它的
  `message_start`）。补不齐就退回原来的快照通路。`session.onEvent` 换成 `onClientEvent`：
  订阅到的是**已投影**的事件，权威事件带 `seq`；待决审批/进行中工具仍在订阅时重放一次
  （不带 seq），那是全新连接拿到它们的唯一途径。
- **客户端**（`agent-event-connection.ts`）：记住每个会话收到的最大 `seq`，重连时作为
  `lastEventId` 带回去；`seq > known + 1` 就报缺口（不带 seq 的增量既不移动游标也不报缺口）。
- **缺口补偿**（`hooks/useAgentSession.ts`）：跳档时若**当前没在跑**就重读一次转写
  （revision 一定变了，普通 `loadSession` 就会整份替换 —— 不带 `force`，见下）；
  跑着的时候不重读（文件里还没有在途消息，会抹掉流式气泡），交给这一轮结束时本来就有的
  `loadSession`。

## 刻意不做

- **不在服务端做无缓冲的重放**。重放窗口就是那 4 MB 缓冲；滚过了就老实退回快照通路，
  不假装补齐（`replayAfter().complete === false`）。
- **不用 `EventSource` 自带的 Last-Event-ID**。本仓的重连是自己造新 `EventSource`，浏览器的
  per-instance 游标带不过去，所以显式用查询参数传。
- **不给 `connected` 加 seq**。客户端只认「第一条带 seq 的事件」作基线，避免快照通路下
  缓冲事件序号与基线不一致而误报缺口。
- **缺口补偿不带 `force`**。`hooks/useAgentSession.test.mjs` 有一条守卫：`useAgentSession.ts`
  里 `{ force: true }` 只允许两处（挂载 + 设置里重载），第三处就是又一处静默探盘。

## 验证

```
node --experimental-strip-types --test lib/agent-event-log.test.mjs \
  lib/agent-event-stream.test.mjs lib/agent-event-connection.test.mjs
```

- `agent-event-log`：编号单调、负载带 seq、按游标重放、缓冲滚过报 incomplete、字节预算、
  空日志/非法游标。
- `agent-event-stream`：只有权威事件带 `id:` 与 `seq`；带游标重连补发漏掉的权威事件且不再
  发快照；缓冲滚过时退回快照。原有的背压/丢弃/压缩状态用例全部保留通过。
- `agent-event-connection`：重连带回上次的 seq、换会话不串游标、首条事件设基线不报缺口、
  跳档报缺口、不带 seq 的增量不移动游标也不报缺口。

全量 `npm test`（3918 通过 / 8 跳过 / 0 失败）与 `tsc --noEmit`、变更文件 ESLint 通过。
