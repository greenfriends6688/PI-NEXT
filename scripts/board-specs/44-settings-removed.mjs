// 画板 44（定时任务 / 记忆）—— **产品侧已于 2026-10-01 下线**（用户裁定：删分节 + 停掉执行器）。
//
// 这两份设计画板**没有**被删（设计资产不随实现删），但产品里已没有这两个分节，
// 也没有它们的任何替代形态 —— 所以对位规格只能是「记录已下线」，不能量化对位。
//
// 为什么留这份而不是直接删掉 spec：画板还在、check-boards 仍在扫它们，
// 若把对位规格一并删干净，将来有人「按画板把这两个分节做回来」时会以为没人管过；
// 留一份显式的下线记录，可以在实现再次落地时立刻看到「画板在这、当时为什么下线」。
// 等哪天要把这两个分节做回来，把本文件删掉并重建 `44-settings-cron-memory.mjs` 即可。
export default {
  name: "已下线（画板 44 · 定时任务 / 记忆）",
  board: "44-settings-cron-memory.html",
  selectors: [".pw-frame-label"],
  knownDiffs: [
    {
      sel: ".pw-frame-label",
      reason:
        "**已下线**：产品侧的分节、API 路由、lib 实现（cron-* / pi-memory / memory-catalog / "
        + "memory-refresh）与 agent 侧的定时任务工具全部删除 —— 用户 2026-10-01 拍板，"
        + "含停掉调度器（instrumentation-node 的 startCronScheduler）。画板保留作为设计资产。",
    },
  ],
};
