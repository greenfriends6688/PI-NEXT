// 画板 44 设置 · 定时任务与记忆
//
// ⚠️ 画板 44 的表单词表是**旧口径**：它用 `.pw-input` / 直接 label+input，
// 而实现早已换成控件基件（`PwSelectBox` → `.pw-selectbox`、开关 `.pw-switch`、
// 字段壳 `.pw-field` + `.pw-label`）—— 62/40/41/42/43 的 spec 都量的是这一套。
// 这里量**壳与字段基件**（两帧共用），控件词表本身以 62 为准。
// 行/详情数据依赖（定时任务、记忆条目为空时右栏是空态）。
const SHELL = [".pw-cols", ".pw-list", ".pw-field", ".pw-label", ".pw-ctl"];

export default {
  name: "定时任务 / 记忆（画板 44 · 帧 A 定时任务）",
  board: "44-settings-cron-memory.html",
  boardFrame: 0,
  app: { open: "settings:cron" },
  selectors: [...SHELL, ".pw-detail"],
  knownDiffs: [
    {
      sel: ".pw-detail",
      reason: "**数据依赖**：右栏是选中一条之后的详情卡；没选中任何定时任务时是空态。",
    },
    {
      sel: ".pw-field",
      reason: "同 62/40 的 fork:settings-field-density 接线（标签 132px 下限、gap 6/16）；既有登记。",
    },
    {
      sel: ".pw-label",
      reason: "同 .pw-field：画板标签随内容宽，实现给 132px 下限 + 放不下换行（接线）。",
    },
  ],
  tolerance: { box: 2, fontSize: 0 },
};
