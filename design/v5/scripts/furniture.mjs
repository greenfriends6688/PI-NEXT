/* 画板家具 / 纯说明性类 —— **唯一来源**。
 *
 * 这些类只属于「摆拍的台子」（画板外框、场景、注释、主题开关），不是产品 DOM：
 * 落地进度与帧级判定都必须把它们排除，否则清单永远显示「还差 561 个类」，
 * 而那 561 里 470 个是家具 —— 假进度条比没有进度条更误导。
 *
 * 用它的两处：`scripts/v5-frame-regression.mjs`（帧级判定）与
 * `design/v5/scripts/land-status.mjs`（类级清单）。要加家具先加这里。
 */
export const BOARD_FURNITURE = new Set([
  // web 家具
  "d-board", "d-board-head", "d-scene", "d-frame", "d-frame-body", "d-frame-label",
  "d-theme-toggle", "d-tags", "d-tag", "d-notes", "d-grow", "d-sheet", "d-fade", "d-fade-tail",
  // pwa 家具
  "m-board", "m-board-head", "m-scene", "m-frame", "m-frame-body", "m-frame-label",
  "m-theme-toggle", "m-notes", "m-grow", "m-fade", "m-fade-tail", "m-statusbar", "m-homebar",
  "m-phone", "m-phone-inner", "m-doc-tags", "m-doc-tag",
]);
