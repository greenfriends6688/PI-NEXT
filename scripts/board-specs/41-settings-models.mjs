// SW-08 模型分节 —— 画板 41 帧 0（供应商列表 + 详情）
export default {
  name: "模型分节（画板 41 · 帧 0）",
  board: "41-settings-models.html",
  boardFrame: 0,
  app: { open: "settings:模型" },
  selectors: [
    ".pw-settings",
    ".pw-snav",
    ".pw-sbody",
    ".pw-cols",
    ".pw-list",
    ".pw-litem",
    ".pw-lname",
    ".pw-lsub",
    ".pw-group-title",
    ".pw-detail",
    ".pw-kv",
    ".pw-stats-grid",
    ".pw-stat",
    ".pw-field",
    ".pw-label",
    ".pw-btn",
    ".pw-badge",
  ],
  knownDiffs: [
    {
      sel: ".pw-field",
      reason:
        "fork:settings-field-density 接线（标签 132px 下限 + 控件放不下换行），settings.css 有注释登记；画板 40 的 spec 也登记过同一条",
    },
    {
      sel: ".pw-detail",
      reason:
        "**数据依赖**：这一帧量的是「选中一个供应商」之后的详情卡；自动对位跑在没有选中任何供应商的状态，右列是空态 —— 不是漂移",
    },
    {
      sel: ".pw-kv",
      reason:
        "同上（供应商详情的属性表）",
    },
    {
      sel: ".pw-stats-grid",
      reason:
        "同上（用量摘要的统计卡网格）",
    },
    {
      sel: ".pw-stat",
      reason:
        "同上（单张统计卡）",
    },
    {
      sel: ".pw-litem",
      reason:
        "**数据依赖**：种子环境（verify-boards-live 的临时 agent 目录）里 0 个供应商，"
        + "左列列表一行都没有；对着本机真服务跑时会列出来并逐项对位。",
    },
    {
      sel: ".pw-lname",
      reason: "同上（供应商行的名字列，随 .pw-litem 一起才有）",
    },
    {
      sel: ".pw-lsub",
      reason: "同上（供应商行的副标题列）",
    },
  ],
};
