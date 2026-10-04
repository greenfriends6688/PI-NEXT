// 画板 10 转录正文 —— 帧 B（助手富文本：标题 / 段落 / 列表 / 任务清单 / 行内码）
//
// 与 `10-transcript-text.mjs`（帧 A 用户气泡）同属画板 10：boad-diff 一份 spec
// 只取一个 frame，所以按画板 62 的先例拆成两份文件。
// fork:v5-old-layer（2026-10-04）—— MarkdownBody.tsx:152 把 GFM 任务清单写成
// 画板的 `.d-tasklist`（`.pw-tasklist` 已从 DOM 退场）；`.pw-md` → `.d-md`。
const SAME = [
  [".pw-md", ".d-md"],
  [".pw-tasklist", ".d-tasklist"],
];

export default {
  name: "转录正文（画板 10 · 帧 B 助手富文本）",
  board: "10-transcript-text.html",
  boardFrame: 1,
  app: { open: "session:first" },
  pairs: SAME,
  knownDiffs: [
    {
      sel: ".d-tasklist",
      reason:
        "**数据依赖**：任务清单是**内容**决定的 —— 这一会话的助手正文里没有 `- [ ]`，"
        + "就没有 `.pw-tasklist`。种子里带一条（verify-boards-live 的 richFinal），"
        + "对着带清单的会话跑时它会出现并逐项对位。",
    },
  ],
  tolerance: { box: 2, fontSize: 0 },
};
