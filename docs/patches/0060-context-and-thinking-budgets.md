# 设置页压缩预算与思考档 token 预算

| | |
| --- | --- |
| 状态 | 已实现（单测 40；合并时全量 2655 pass / 0 fail，设计门禁全绿） |
| 上游依据 | pi 0.87 `settings-manager.d.ts` 的字段定义（上游 pi-web 也没做这些控件） |
| 零新增类 | diff 里 12 个 `pw-` 串逐个回查 `board.css`，**全部已存在**，`board.css` 零改动；落在画板 40 帧 1 右栏与 62 帧 C 右栏，DIVERGENCE 新增 Y/Z 两节 |

## 审计勘误（重要）

`compaction.modelOverrides` **不是**审计说的「用哪个模型做压缩」，而是
`Record<"provider/id", {reserveTokens?, keepRecentTokens?}>` 的**每模型预算覆盖**，
全树没有 `compactionModel`。

## 逐字段的 SDK setter 结论

| 字段 | setter | 写入路径 |
| --- | --- | --- |
| `compaction.enabled` | **有** `setCompactionEnabled()` | SDK + `flush()` + `drainErrors()` |
| `compaction.{reserveTokens,keepRecentTokens,modelOverrides}` | 只有 getter | 自写 |
| `branchSummary.reserveTokens` | 只有 getter | 自写 |
| `thinkingBudgets.{minimal,low,medium,high}` | **连 setter 名都不存在**（只有 `getThinkingBudgets()`） | 自写 |

「自写」= 照抄 `lib/retry-settings.ts` 已趟通的路子：`proper-lockfile` 锁 `settings.json`
**本身**（SDK 的 `FileSettingsStorage.acquireLockSyncWithRetry` 用的是同一把锁，两边写互斥）
→ 锁内 re-read → 只换目标顶层键 → 原子写 0600。GET 不建文件；读不出来抛 ReadError → 422、
控件全禁用、**不盖默认值**。

**没有「本 SDK 写不了」的字段。** `off/xhigh/max` 三个预算键明确 400 而非补齐
（pi 本身没有）。`thinkingBudgets` 只写与内建默认不同的值、同值删键（幂等）。

## 只能人眼验的四处

`verify:boards` 跑不了（主仓占着 30141 与 `.next`），所以：① 两块在 40 帧 1 / 62 帧 C
右栏的行高与间距；② `p.pw-hint` 的 `margin:0`（画板显式写、产品靠 Tailwind preflight，
照画板 41 先例）；③ 模型覆盖行 2×90px + 22px 图标钮在 420px 列与 ≤640px `flex-wrap` 下不溢出；
④ 数值框 `step=1024` 时输入非倍数值的浏览器校验态。
