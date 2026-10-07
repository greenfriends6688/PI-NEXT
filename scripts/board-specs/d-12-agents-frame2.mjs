// 子代理分节 · 帧 C（画板 D-12 · 工具白名单）
//
// fork:v5-landing · D-12（2026-10-06）—— 白名单从「工具 + 加载技能/扩展」一排芯片
// 变成画板帧 C 的两组：内置工具一块、外置资源（技能与扩展）一块，下面是计数徽标行
// 与 `bash` 的单独警告。产品把它作为**弹窗里的第 2 节**（前面四节：内置子代理 / 共同上限 /
// profile 表 / 细节 —— 后两节在弹窗里，所以产品侧选择器多一层 `.d-modal`），板面帧 C
// 里它是第 1 节，所以靠 pairs 换序号。
//
// 不量的三样（登记在文件末尾）：板面帧 C 的「越权时怎么办」三行（产品没有越权策略
// 设置面 —— `lib/approval-policy.ts` 是会话内批准，不是这里的开关）、外置工具那一组
// （产品这一组是「加载技能 / 加载扩展」，不是 MCP 工具芯片）、以及 `shell` 那一枚
// （产品的对应工具叫 `bash`）。

const OPEN_AGENTS = `
  const opener = document.querySelector(".d-side-foot button");
  if (!opener) throw new Error("设置入口没找到（.d-side-foot > button）");
  opener.click();
  await new Promise((r) => setTimeout(r, 1600));
  const row = document.querySelector('button.d-set-navitem[data-section="agents"]');
  if (!row) throw new Error("settings section not found: agents");
  row.click();
  await new Promise((r) => setTimeout(r, 2000));
  const first = [...document.querySelectorAll(".settings-section-host:not([hidden]) .d-table tbody tr")]
    .find((tr) => !tr.closest("[hidden]"));
  if (first) { first.click(); await new Promise((r) => setTimeout(r, 1200)); }`;

const B1 = ".d-set-inner > .d-set-sec:nth-of-type(1)";
/* fork:agents-detail-modal（2026-10-07 用户裁定）—— 细节（含工具白名单那一节）从
   页面内联搬进了弹窗，所以产品侧从 `nth-of-type(5)` 改成「弹窗里第 2 节」。 */
const A5 = ".d-modal .d-set-inner > .d-set-sec:nth-of-type(2)";

/** 行高那条差是**全局**的：板面 `.d-board` 写 `line-height: var(--nx-lh-body)` = 1.60，
 *  产品 body 命中的是仍在加载的 v1 `board.css` 的 `body.pw { line-height: var(--lh-body) }`
 *  = 1.50。影响所有 v5 画板对数，与子代理这一刀无关。 */
const LH_GAP = "**全局行高差（与子代理落地无关）**：板面 `.d-board` 是 "
  + "`line-height: var(--nx-lh-body)` = 1.60，产品这一层命中的是**仍在运行时里加载的** "
  + "v1 `board.css` 的 `body.pw { line-height: var(--lh-body) }` = 1.50（迁移期两套并存，"
  + "v1 在后）。字号 / 高度 / 间距 / 圆角逐项相同，只有继承来的行高差这一条。";

export default {
  name: "子代理 · 工具白名单（画板 D-12 · 帧 C）",
  board: "v5/web/boards/D-12-settings-agents.html",
  boardFrame: 2,
  app: { script: OPEN_AGENTS, settle: 2400 },
  pairs: [
    [`${B1} .d-set-sec-t`, `${A5} .d-set-sec-t`],
    [`${B1} .d-field`, `${A5} .d-field`],
    [`${B1} .d-field-t`, `${A5} .d-field-t`],
    [`${B1} .d-chips`, `${A5} .d-chips`],
    [`${B1} .d-chipbtn`, `${A5} .d-chipbtn`],
    [`${B1} .d-row`, `${A5} .d-row`],
    [`${B1} .d-badge.ok`, `${A5} .d-badge.ok`],
    [`${B1} .d-banner.warn`, `${A5} .d-banner.warn`],
  ],
  knownDiffs: [
    ...[
      `${A5} .d-set-sec-t`, `${A5} .d-field`, `${A5} .d-field-t`, `${A5} .d-chips`,
      `${A5} .d-row`, `${A5} .d-banner.warn`,
    ].map((sel) => ({ sel, reason: LH_GAP })),
  ],
  tolerance: { box: 2, fontSize: 0 },
};