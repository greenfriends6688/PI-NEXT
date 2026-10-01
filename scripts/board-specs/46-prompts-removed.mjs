// 画板 46（自定义命令 / 归档历史 / 从其它 agent 导入）—— 其中**「自定义命令」分节已下线**，
// 归档与导入两个分节仍在（各自有 `46-frame1` / `4x-46-frame2` 等规格在对位）。
//
// 2026-10-01 用户裁定删除「自定义命令」分节：组件 `PromptsConfig` + `lib/prompt-files`
// + `app/api/prompts` 全部移除，导航里也没了。画板 46 本体保留。
//
// 留这份记录而不是把 spec 删干净的理由同 `44-settings-removed.mjs`：
// 画板还在，将来若要恢复这个分节，立刻能看到「画板在这、当时为什么下线」。
export default {
  name: "已下线（画板 46 · 自定义命令）",
  board: "46-settings-prompts-archive-import.html",
  selectors: [".pw-frame-label"],
  knownDiffs: [
    {
      sel: ".pw-frame-label",
      reason:
        "**已下线**：自定义命令分节的产品实现（PromptsConfig / prompt-files / api/prompts）"
        + "于 2026-10-01 按用户裁定删除。同一画板里的「归档历史」「从其它 agent 导入」两节仍在。",
    },
  ],
};
