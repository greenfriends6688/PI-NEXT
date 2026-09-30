// SW-13 皮肤工作室外壳（2026-09-30 接 pw-modal 后补规格）
export default {
  name: "皮肤工作室外壳（画板 47 · 帧按实现）",
  board: "47-skin-studio.html",
  boardFrame: 1,
  app: { open: "settings:general" },
  selectors: [
    ".pw-modal",
    ".pw-modal-head",
    ".pw-tabs",
    ".pw-tab",
    ".pw-modal-body",
    ".pw-field",
    ".pw-radio",
    ".pw-selectbox",
    ".pw-modal-foot",
  ],
  // 画板的 shell 帧是 200px 演示列，产品内容行是 1fr + 340px（帧 1 的真实布局）。
  knownDiffs: [
    {
      sel: ".pw-field",
      reason:
        "fork:settings-field-density 接线（标签 132px 下限 + 控件放不下换行），settings.css 有注释登记；画板 40 的 spec 也登记过同一条",
    },
    {
      sel: ".pw-radio",
      reason:
        "画板帧的 `.pw-radio` 容器继承正文 13px；产品容器继承 12px，**芯片本身**（`.pw-radio > span`）两边都是 `--text-meta`(11px) 一致",
    },
    {
      sel: ".pw-modal",
      reason:
        "**真差距，未修**：皮肤工作室在产品里已经不是 `.pw-modal` 结构（半径 0、头部 display:none），画板 47 画的是模态框外壳。登记为待办：要么把产品改回模态，要么按实际结构重画 47",
    },
    {
      sel: ".pw-modal-head",
      reason:
        "同上",
    },
    {
      sel: ".pw-modal-foot",
      reason:
        "同上（产品已无这个节点）",
    },
    { sel: ".pw-modal-body", reason: "演示帧 200px 预览列 vs 产品 340px（画板 47 帧 1 的真实值）" },
  ],
};
