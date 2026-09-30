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
    { sel: ".pw-modal-body", reason: "演示帧 200px 预览列 vs 产品 340px（画板 47 帧 1 的真实值）" },
  ],
};
