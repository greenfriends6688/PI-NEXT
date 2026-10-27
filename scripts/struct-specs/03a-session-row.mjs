// 03a 会话行：板侧一条会话 `.srow.is-sub`（当前打开那条），产品侧同一条。
//
// 已收敛：板 6 节点 / 产品 6 节点 · 0 结构偏差。
// 唯一保留：板是 `button`、产品是 `a` —— 产品这条是真链接（中键 / ⌘-点击在新标签打开），
// 照 V5「静态件→可点件，div→button，保留原类名」的同一口径，标签随能力走，
// 类名与内部结构两边一致。登记在 DIVERGENCE，不当作待修偏差。
export default {
  name: "03a 会话行",
  board: "parts/03-side-list.html",
  boardRoot: ".side__list button.srow.is-sub.is-sel",
  appUrl: "http://127.0.0.1:30141/?session=01a16df7-be77-7480-964b-41159805256c",
  appRoot: ".srow.is-sub.is-sel",
  settleMs: 8000,
  viewport: { width: 1440, height: 900 },
  knownDiffs: [{ kind: "TAG", why: "产品行是真链接（a），板是 button；类名与内部结构一致" }],
};
