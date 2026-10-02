# 会话与流正确性

| | |
| --- | --- |
| 状态 | 实现中（本条目随最后一批合并更新） |
| 上游依据 | `19774b8`(#1023) · `7303179`(#1009) · `f5e768e`(#1016) · `9ede521`(#1017) · `c8ff7e8`(#987) · `00156d5`(#990) · `2a71c57`(#991) · `6b0c6a5`(#997) |

## 会话正在跑时也能 fork（#1023）

上游不再走 `AgentSession.fork()`（它原地替换 session、跑着的 run 会被 abort），而是
单独开一个 `SessionManager` 读源文件 + `createBranchedSession()`，源会话的内存态永不被改，
因此运行中也允许 fork。配套：**in-session branch 在运行中必须锁住**（`navigateTree()` 会拒绝，
且运行中改 leaf 会把实时 run 渲染到别的分支下）。

⚠️ **本仓的硬不变量**：`AGENTS.md`「Fork must destroy the wrapper immediately」——
fork 后必须销毁 wrapper，否则 next 请求会拿到已 fork 的状态、后续 fork 产出损坏的
`parentSession` 链。改这块代码前先读那一节。

## 其它

- **#1009**：编辑历史消息时「取消」不应已经建出新分支——只在真正发送时才分支。
- **#1016/#1017**：子进程自开 session 时按 Stop 也能停、steer 不排队；
  关掉空闲关停后 Stop 收不回来的 run 也会按默认延时回收。
- **#987/#990/#991**：「结果已取走」标记**按 run 而不是按 session** 记；重启后残留的
  running 子代理报为「已中断」；恢复的 run 回来时文案说明是恢复的。
- **#997**：每客户端 SSE backlog 封顶。
