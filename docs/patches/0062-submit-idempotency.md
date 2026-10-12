# 提交幂等键（requestId + fingerprint）

| | |
| --- | --- |
| 状态 | 已实现（单测 9 + 全量 `npm test` 3903 通过） |
| 来源 | XTLaw `apps/buddy/service/src/storage/turnRequestRepository.ts`（`request_id + request_fingerprint`）· `docs/xtlaw-pr-plan-2026-10-10.md` A2 |
| 新增文件 | `lib/submit-idempotency.ts`、`lib/submit-idempotency.test.mjs` |
| 上游接触面 | `lib/rpc-manager.ts`（prompt 分支接线）、`hooks/useAgentSession.ts`（发送与不明确失败留存） |

## 解决什么

`POST /api/agent/[id]` 的 prompt 原本没有幂等键。客户端只有一条**同步**软防重
（`agentRunningRef`），挡得住同标签页连点，挡不住：

1. **响应丢失后的重发**。请求发出但响应没回来（代理超时、网络抖动）时，
   `hooks/useAgentSession.ts` 判为**不明确失败**（`definitivelyRejected = false`），
   乐观消息留在界面上等 SSE 确认。用户看到消息还在，再点一次发送 ——
   服务端可能已经接受了第一次，于是跑出两轮。
2. 客户端在别处重试同一次提交。

## 怎么做

- **客户端**（`hooks/useAgentSession.ts`）：每次 `handleSend` 生成一个 `requestId`（`createSubmitRequestId()`）
  随 prompt 一起发；结果不明确时把它连同内容指纹存进 `pendingSubmitRef`。
  用户重发**内容一致**的消息时复用同一个 id；改了正文就换新 id
  （`reuseRequestIdAfterAmbiguousFailure()`，指纹不一致返回 null）。
- **服务端**（`lib/rpc-manager.ts` prompt 分支）：`SubmitDedup.begin(requestId, fingerprint)`
  在 `acquirePromptAdmission()` **之前**判：
  - 同 id 不同指纹 → `conflict`，直接报错，不跑；
  - 同 id 同指纹 → `join`，等第一次的结果（第一次被拒，join 也拒，用户能重试）；
  - 新 id → `new`，正常跑；成功 `resolve()`（条目保留 TTL），失败 `reject()`（条目**立刻删除**，
    被拒的提交没有产生 run，重试必须能继续）。

去重必须发生在准入之前：否则重复提交只会排在第一次后面，等它结束再跑一遍。

## 刻意不做

- **不用内容哈希当 requestId**。那样「用户过一会儿又发同一句 continue」会被当成重放而不跑。
  XTLaw 的 requestId 是每次提交现生成的，不是内容派生的；这里保持同样的语义。
- **不做跨进程/跨重启去重**。`SubmitDedup` 是进程内 Map + TTL（上限 128 条）。
  XTLaw 用 `turn_requests` 表，本仓没有本地 run 表；`ponytail:` 注释里标了升级路径。
- 跨标签页仍不共享 requestId（两个标签各自生成）。要覆盖它得让 requestId 在标签间共享
  （BroadcastChannel / 服务端按会话发号），本期不做。

## 验证

```
node --experimental-strip-types --test lib/submit-idempotency.test.mjs
```

覆盖：指纹稳定性与内容敏感性、图片按内容而非存在区分、id 唯一、只在指纹一致时复用、
重复提交 join 而不是起第二轮、同 id 不同内容冲突、被拒后条目作废可重试、成功后 TTL 内 join、
表有界。全量 `npm test`（3903 通过 / 8 跳过 / 0 失败）与 `tsc --noEmit` 通过。
