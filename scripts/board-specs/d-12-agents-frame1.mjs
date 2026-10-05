// 子代理分节 · 帧 B（画板 D-12 · profile 表格 + 单个 profile 的细节）
//
// fork:v5-landing · D-12（2026-10-06）—— v1 的主从两栏（`.d-set-nav` 左栏 + `d-sess`
// 列表行）退场成画板 D-12 的一列：profile 表在第 3 节、细节在第 4 节，所以板面与产品
// 的 `.d-set-sec` 序号**不同**，靠 pairs 逐条对位（同名选择器 + 序号改写）。
//
// 不量、且**必须不量**的四样（登记在文件末尾）：
//   · 细节块板面没有「标题 + 徽标 + 路径 + 创建副本/删除/启用开关」这一行头 —— 产品的
//     只读档需要它（只读说明文案指的就是标题右侧那个开关），形态仍取 `.d-t-title` /
//     `.d-badge` / `.d-mono` / `.d-btn` / `.d-switch` 那一族；
//   · 板面细节里的「描述」是 `rows=3` 的 `.d-textarea`，产品是一行 `.d-input`（真数据
//     都是一句话，长描述在系统指令那一栏）；
//   · 板面页脚那枚「删除该 profile」按钮 —— 产品的页脚是设置壳的「确定」，删除落在
//     细节头那一行（同一枚 `d-btn.danger`，只是位置不同）；
//   · 板面帧 B 的 `ext:` 未解析告警 —— 产品没有 ext: 解析面（帧 D 那一节整节没落）。

const OPEN_AGENTS = `
  const opener = document.querySelector(".d-side-foot button");
  if (!opener) throw new Error("设置入口没找到（.d-side-foot > button）");
  opener.click();
  await new Promise((r) => setTimeout(r, 1600));
  const row = document.querySelector('button.d-set-navitem[data-section="agents"]');
  if (!row) throw new Error("settings section not found: agents");
  row.click();
  await new Promise((r) => setTimeout(r, 2000));
  // 表格行要看选中态：点第一行（非隐藏宿主里的第一条）。
  const first = [...document.querySelectorAll(".settings-section-host:not([hidden]) .d-table tbody tr")]
    .find((tr) => !tr.closest("[hidden]"));
  if (first) { first.click(); await new Promise((r) => setTimeout(r, 1200)); }`;

const S1 = ".d-set-inner > .d-set-sec:nth-of-type(1)";
const S2 = ".d-set-inner > .d-set-sec:nth-of-type(2)";
const A3 = ".d-set-inner > .d-set-sec:nth-of-type(3)";
const A4 = ".d-set-inner > .d-set-sec:nth-of-type(4)";

/** 行高那条差是**全局**的（板面 `.d-board` 写 `line-height: var(--nx-lh-body)` = 1.6，
 *  产品 body 命中的是仍在加载的 v1 `board.css` 的 `body.pw { line-height: var(--lh-body) }`
 *  = 1.5）。它影响所有 v5 画板对数、且与子代理这一刀无关，逐条登记免得淹没真差异。 */
const LH_GAP = "**全局行高差（与子代理落地无关）**：板面 `.d-board` 是 "
  + "`line-height: var(--nx-lh-body)` = 1.60，产品这一层命中的是**仍在运行时里加载的** "
  + "v1 `board.css` 的 `body.pw { line-height: var(--lh-body) }` = 1.50（迁移期两套并存，"
  + "v1 在后）。字号 / 高度 / 间距 / 圆角逐项相同，只有继承来的行高差这一条。";

export default {
  name: "子代理 · profile 表与细节（画板 D-12 · 帧 B）",
  board: "v5/web/boards/D-12-settings-agents.html",
  boardFrame: 1,
  app: { script: OPEN_AGENTS, settle: 2400 },
  pairs: [
    // profile 节：标签行 + 表格
    [`${S1} .d-set-row`, `${A3} .d-set-row`],
    [`${S1} .d-set-row-box`, `${A3} .d-set-row-box`],
    [`${S1} .d-set-row-t`, `${A3} .d-set-row-t`],
    [`${S1} .d-set-row-s`, `${A3} .d-set-row-s`],
    [`${S1} .d-grow-last`, `${A3} .d-grow-last`],
    [`${S1} .d-btn.primary`, `${A3} .d-btn.primary`],
    [`${S1} .d-card`, `${A3} .d-card`],
    [`${S1} .d-table`, `${A3} .d-table`],
    [`${S1} .d-table th`, `${A3} .d-table th`],
    [`${S1} .d-table tbody tr`, `${A3} .d-table tbody tr`],
    [`${S1} .d-table tbody td`, `${A3} .d-table tbody td`],
    // 细节节：两列字段 + 设置行
    [`${S2} .d-grid2`, `${A4} .d-grid2`],
    [`${S2} .d-grid2 .d-field`, `${A4} .d-grid2 .d-field`],
    [`${S2} .d-field-t`, `${A4} .d-field-t`],
    [`${S2} .d-set-row`, `${A4} .d-set-row`],
    [`${S2} .d-set-row-box`, `${A4} .d-set-row-box`],
    [`${S2} .d-set-row-t`, `${A4} .d-set-row-t`],
    [`${S2} .d-set-row-s`, `${A4} .d-set-row-s`],
    [`${S2} .d-grow-last`, `${A4} .d-grow-last`],
  ],
  knownDiffs: [
    ...[
      `${A3} .d-set-row`, `${A3} .d-set-row-box`, `${A3} .d-set-row-t`, `${A3} .d-set-row-s`,
      `${A3} .d-grow-last`, `${A3} .d-btn.primary`, `${A3} .d-card`, `${A3} .d-table`,
      `${A3} .d-table th`, `${A3} .d-table tbody tr`, `${A3} .d-table tbody td`,
      `${A4} .d-grid2`, `${A4} .d-grid2 .d-field`, `${A4} .d-field-t`,
      `${A4} .d-set-row`, `${A4} .d-set-row-box`, `${A4} .d-set-row-t`,
      `${A4} .d-set-row-s`, `${A4} .d-grow-last`,
    ].map((sel) => ({ sel, reason: LH_GAP })),
  ],
  tolerance: { box: 2, fontSize: 0 },
};