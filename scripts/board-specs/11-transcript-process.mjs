// 画板 11 过程时间轴 —— 帧 B（ProcessGroup：头行 + 步骤行）
//
// 这是工具调用最常出现的地方，也是「位置对不上」的重灾区：头行的 grow / 徽标
// 位置、步骤行的图标列、参数列、耗时列。回合结束后过程是折起的，所以预设先展开。
//
// ⚠️ 步骤行有两类，值不同：普通行 2px 6px 2px 22px / center，推理行（.reasoning）
// 4px 6px 2px 22px / flex-start（board.css:380）。画板帧里**第一个**步骤是推理行，
// 所以两边都要按类成对比 —— 拿「两边各自的第一个 .pw-step」去对，对的是行类型不是样式。
const STEP_PAIR = [
  [".pw-step.reasoning", ".pw-step.reasoning"],
  [".pw-step:not(.reasoning)", ".pw-step:not(.reasoning)"],
];

export default {
  name: "过程时间轴（画板 11 · 帧 B）",
  board: "11-transcript-process.html",
  boardFrame: 1,
  app: { open: "session:first-expanded" },
  pairs: [
    ...STEP_PAIR,
    [".pw-proc", ".pw-proc"],
    [".pw-proc-head", ".pw-proc-head"],
    [".pw-proc-body", ".pw-proc-body"],
    [".pw-step-ico", ".pw-step-ico"],
    [".pw-verb", ".pw-verb"],
  ],
  knownDiffs: [
    {
      sel: ".pw-step.reasoning",
      reason:
        "**数据依赖**：会话里要有推理步骤（思考块）才有这一行。种子会话带一条思考，"
        + "真机会话看内容；没有就不存在这个节点。",
    },
  ],
  tolerance: { box: 2, fontSize: 0 },
};
