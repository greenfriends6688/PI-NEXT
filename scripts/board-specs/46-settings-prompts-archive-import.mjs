// SW-12 命令 / 归档 / 导入（2026-09-30 重写后补规格）
export default {
  name: "命令 / 归档 / 导入（画板 46）",
  board: "46-settings-prompts-archive-import.html",
  boardFrame: 0,
  app: { open: "settings:prompts" },
  selectors: [
    ".pw-inline",
    ".pw-cols",
    ".pw-list",
    ".pw-litem",
    ".pw-detail",
    ".pw-field",
    ".pw-ctl",
    ".pw-textarea",
    ".pw-sec-title",
    ".pw-badge",
  ],
  knownDiffs: [
    {
      sel: ".pw-inline",
      reason:
        "产品接线层给可点行归零 UA（fork-ui.css 的 `button.pw-*` 清单），gap/padding 由所在行的接线块出；画板是静态 span",
    },
    {
      sel: ".pw-litem",
      reason:
        "**数据依赖**：本机 0 条自定义命令 → 列表是空态，没有 `.pw-litem`",
    },
    {
      sel: ".pw-detail",
      reason:
        "同上（没选中任何命令 → 详情是空态）",
    },
    {
      sel: ".pw-field",
      reason:
        "同上（编辑器的字段行）",
    },
    {
      sel: ".pw-ctl",
      reason:
        "同上",
    },
    {
      sel: ".pw-textarea",
      reason:
        "同上（命令正文编辑器）",
    },
    {
      sel: ".pw-sec-title",
      reason:
        "同上",
    },
  ],
};
