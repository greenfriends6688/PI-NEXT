// 画板 11 过程时间轴 —— 帧 B（ProcessGroup：头行 + 步骤行）
//
// 这是工具调用最常出现的地方，也是「位置对不上」的重灾区：头行的 grow / 徽标
// 位置、步骤行的图标列、参数列、耗时列。回合结束后过程是折起的，所以预设先展开。
//
// ⚠️ 步骤行有两类，值不同：普通行 2px 6px 2px 22px / center，推理行（.reasoning）
// 4px 6px 2px 22px / flex-start（board.css:380）。画板帧里**第一个**步骤是推理行，
// 所以两边都要按类成对比 —— 拿「两边各自的第一个 .pw-step」去对，对的是行类型不是样式。
// fork:v5-old-layer（2026-10-04）—— 产品侧已换 v5：ProcessGroup.tsx:927/949 的步骤流
// 是 `.d-steps` / `.d-step`（图标 `.d-step-ico`、正文 `.d-step-body`、耗时 `.d-step-meta`）。
// 画板侧仍取 v1 的 pw-*。注意 v5 **没有** `reasoning` 修饰档（推理行只是图标不同），
// 所以按类型配对的那一段并成一条「第一条 vs 第一条」。
const STEP_PAIR = [[".pw-step", ".d-step"]];

export default {
  name: "过程时间轴（画板 11 · 帧 B）",
  board: "11-transcript-process.html",
  boardFrame: 1,
  app: { open: "session:first-expanded" },
  pairs: [
    ...STEP_PAIR,
    // `.pw-proc` 外壳 → `.d-steps`（竖线串起的那条 ol）
    [".pw-proc", ".d-steps"],
    // 过程卡头 → 画板 D-03d 的 `.d-card-head`（ChatWindow.tsx:587）
    [".pw-proc-head", ".d-card-head"],
    // 展开正文 → `.d-step-body`（ProcessGroup.tsx:964；v5 里它是 .d-step 的子元素，
    // 不再是 v1 那个独立的 .pw-proc-body 盒）
    [".pw-proc-body", ".d-step-body"],
    [".pw-step-ico", ".d-step-ico"],
    // v5 没有单独的「动词」件，行内文字走 `.d-t-b`（ProcessGroup.tsx:965）
    [".pw-verb", ".d-step-body .d-t-b"],
  ],
  knownDiffs: [
    {
      sel: ".d-step",
      reason:
        "**数据依赖**：会话里要有推理步骤（思考块）才有这一行。种子会话带一条思考，"
        + "真机会话看内容；没有就不存在这个节点。",
    },
  ],
  tolerance: { box: 2, fontSize: 0 },
};
