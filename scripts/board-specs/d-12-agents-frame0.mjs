// 子代理分节 · 帧 A（画板 D-12 · 内置子代理总开关 + 共同上限）
//
// fork:v5-landing · D-12（2026-10-06）—— 这一对数是「画板 dom 落进产品」的验收单：
// 帧 A 的两节（`内置子代理` / `共同上限`）在产品里逐节点同构，两边选择器**同名**，
// 所以只用 `selectors`（pairs 会退化成同名对）。
//
// 板面帧 A 里另外三块**故意不量**（产品没有那个数据面，见文件末尾的登记）：
//   · `.d-banner.warn`「这一项切换后需要重载会话」—— 板面常驻，产品只在
//     **刚切换过**时出现（`reloadNeeded`）；「需重载会话」徽标才是常驻的那一枚。
//   · `允许的运行形态` 的 `.d-seg` 三选一 + 它的三个 pane —— 产品没有这个设置。
//   · 共同上限里的「读多少历史」「结果回传方式」两行 —— 同样没有对应字段。
// 两节的位置对齐靠 `.d-set-inner > .d-set-sec:nth-of-type(n)`（产品在 profile 表
// 之前只有这两节，所以序号与板面一致）。

const OPEN_AGENTS = `
  const opener = document.querySelector(".d-side-foot button");
  if (!opener) throw new Error("设置入口没找到（.d-side-foot > button）");
  opener.click();
  await new Promise((r) => setTimeout(r, 1600));
  const row = document.querySelector('button.d-set-navitem[data-section="agents"]');
  if (!row) throw new Error("settings section not found: agents");
  row.click();
  await new Promise((r) => setTimeout(r, 2000));`;

/** fork:settings-no-explainer（用户 2026-10-06 裁定）：设置页不再摆说明性副行。
 *  `.d-set-row-s` 那一格讲的是「这个设置是什么意思 / 为什么这么设计」——产品整条删掉、
 *  板面保留，所以它是**已登记的意图**，不是「还没换肤」。要重建同样的信息，正确落点是
 *  行内状态或「会阻止你完成动作」的提示（缺项 / 错误 / 需重载），不是一格说明文字。 */
const NO_EXPLAINER = "**fork:settings-no-explainer（用户 2026-10-06 裁定）**：设置页不再摆说明性副行"
  + "（说明这个设置是什么意思的那一格）。产品整条删除、板面保留 —— 「产品里没有」是已登记的意图，"
  + "不是没换肤；要重建同样的信息，落点是行内状态或会阻止你完成动作的提示。";

export default {
  name: "子代理 · 总开关与共同上限（画板 D-12 · 帧 A）",
  board: "v5/web/boards/D-12-settings-agents.html",
  boardFrame: 0,
  app: { script: OPEN_AGENTS, settle: 2200 },
  selectors: [
    ".d-set-inner > .d-set-sec:nth-of-type(1) .d-set-sec-t",
    ".d-set-inner > .d-set-sec:nth-of-type(1) .d-set-row",
    ".d-set-inner > .d-set-sec:nth-of-type(1) .d-set-row-box",
    ".d-set-inner > .d-set-sec:nth-of-type(1) .d-set-row-t",
    ".d-set-inner > .d-set-sec:nth-of-type(1) .d-set-row-s",
    ".d-set-inner > .d-set-sec:nth-of-type(1) .d-grow-last",
    ".d-set-inner > .d-set-sec:nth-of-type(1) .d-badge",
    ".d-set-inner > .d-set-sec:nth-of-type(1) .d-switch",
    ".d-set-inner > .d-set-sec:nth-of-type(2) .d-set-sec-t",
    ".d-set-inner > .d-set-sec:nth-of-type(2) .d-set-row",
    ".d-set-inner > .d-set-sec:nth-of-type(2) .d-set-row-box",
    ".d-set-inner > .d-set-sec:nth-of-type(2) .d-set-row-t",
    ".d-set-inner > .d-set-sec:nth-of-type(2) .d-set-row-s",
    ".d-set-inner > .d-set-sec:nth-of-type(2) .d-grow-last",
    ".d-set-inner > .d-set-sec:nth-of-type(2) .d-input",
  ],
  // 行高那条差是**全局**的：板面 `.d-board` 写 `line-height: var(--nx-lh-body)` = 1.60，
  // 产品 body 命中的是仍在加载的 v1 `board.css` 的 `body.pw { line-height: var(--lh-body) }`
  // = 1.50（迁移期两套并存，v1 在后）。影响所有 v5 画板对数，与子代理这一刀无关；
  // 字号 / 高度 / 间距 / 圆角在这 15 项里逐项相同。`.d-badge` / `.d-switch` / `.d-input`
  // 三项自带行高，因此本来就一致，不登记。
  knownDiffs: [
    ...[
      ".d-set-inner > .d-set-sec:nth-of-type(1) .d-set-sec-t",
      ".d-set-inner > .d-set-sec:nth-of-type(1) .d-set-row",
      ".d-set-inner > .d-set-sec:nth-of-type(1) .d-set-row-box",
      ".d-set-inner > .d-set-sec:nth-of-type(1) .d-set-row-t",
      ".d-set-inner > .d-set-sec:nth-of-type(1) .d-set-row-s",
      ".d-set-inner > .d-set-sec:nth-of-type(1) .d-grow-last",
      ".d-set-inner > .d-set-sec:nth-of-type(2) .d-set-sec-t",
      ".d-set-inner > .d-set-sec:nth-of-type(2) .d-set-row",
      ".d-set-inner > .d-set-sec:nth-of-type(2) .d-set-row-box",
      ".d-set-inner > .d-set-sec:nth-of-type(2) .d-set-row-t",
      ".d-set-inner > .d-set-sec:nth-of-type(2) .d-set-row-s",
      ".d-set-inner > .d-set-sec:nth-of-type(2) .d-grow-last",
    ].map((sel) => ({
      sel,
      reason: "**全局行高差（与子代理落地无关）**：板面 `.d-board` 是 `line-height: var(--nx-lh-body)` = 1.60，"
        + "产品这一层命中的是**仍在运行时里加载的** v1 `board.css` 的 `body.pw { line-height: var(--lh-body) }` = 1.50。"
        + "字号 / 高度 / 间距 / 圆角逐项相同，只有继承来的行高差这一条。",
    })),
    // 上面那张表按「几何差」登记的，而这两个选择器在产品里**整个节点都没有**了 ——
    // 覆盖成真正的原因（Map 后写 wins）。
    { sel: ".d-set-inner > .d-set-sec:nth-of-type(1) .d-set-row-s", reason: NO_EXPLAINER },
    { sel: ".d-set-inner > .d-set-sec:nth-of-type(2) .d-set-row-s", reason: NO_EXPLAINER },
  ],
  tolerance: { box: 2, fontSize: 0 },
};