import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panel = await readFile(new URL("./ImportPanel.tsx", import.meta.url), "utf8");

/* fork:v5-landing-frame · D-21（2026-10-06）—— 桌面整页照抄画板 D-21 帧 B：
   一列卡片（扫描卡 / 第二步确认卡）。v1 画板 62 的骨架 B 与那条挤爆的工具栏一并退场。
   2026-10-07 用户裁定：卡片不再编号（「第一步/第二步」对用户没用），细选 / 冲突口径 /
   三条说明都收进 portal 弹窗，页面上只留按钮。下面锁的是**产品当前的结构**。 */

test("scanning is always an explicit action, never automatic", () => {
  // ADR 0179 D007 — 不许「启动时自动导入」。没有挂载即扫的 effect，
  // scan 只能从扫描卡卡头那枚「重新扫描」进。
  assert.doesNotMatch(panel, /useEffect/);
  assert.match(panel, /onClick=\{\(\) => void scan\(active\)\}/);
  // apply 同理：只从确认导入卡的「确认导入」进，且空选时拒绝。
  assert.match(panel, /onClick=\{\(\) => void apply\(active\)\}/);
  assert.match(panel, /if \(state\.selected\.size === 0\) return;/);
});

test("scan and apply send ids, and the panel reports three-color results", () => {
  assert.match(panel, /"\/api\/import\/scan"/);
  assert.match(panel, /"\/api\/import\/apply"/);
  // 送给 apply 的只有候选 id，从不送路径。
  assert.match(panel, /ids: \[\.\.\.state\.selected\]/);
  assert.match(panel, /summarizeResults/);
  // 界面上送出去的只有候选 id（收进「导入说明」弹窗）。
  assert.match(panel, /settings|import\.idsOnly/);
});

test("the page is one column of cards, no toolbar, no list/detail split", () => {
  // 根是一列 `d-col`（gap sp-4）。
  assert.match(panel, /<div className="d-col" style=\{\{ gap: "var\(--nx-sp-4\)" \}\}>/);
  // 骨架 B 与那条工具栏退场（工具栏正是截图里按钮竖排挤爆的那一行）。
  assert.doesNotMatch(panel, /ConfigSplitView|ConfigSidebar|ConfigDetailStack/);
  assert.doesNotMatch(panel, /toolbar=\{/);
  assert.match(panel, /import\.stepScan/);
  assert.match(panel, /className="d-card-head"/);
  assert.match(panel, /className="d-table"/);
  // 两枚路由徽标写明两段式。
  assert.match(panel, /POST \/api\/import\/scan/);
  // 2026-10-07 用户裁定：链路上的「确认导入」卡整块去掉（只剩扫描卡），
  // 确认钮落在细选弹窗 foot，结果横幅挪到页首。
  assert.doesNotMatch(panel, /import\.stepApply/);
  assert.doesNotMatch(panel, /POST \/api\/import\/apply/);
  assert.equal((panel.match(/className="d-card"/g) ?? []).length, 1);
});

test("verbose detail lives in portal modals, not in the page column", () => {
  // 细选 / 冲突口径 / 三条说明各自进弹窗，并且都 portal 到 body
  // （设置壳有 overflow 与 backdrop-filter，留在壳里的 fixed 会被裁）。
  assert.equal((panel.match(/&& createPortal\(/g) ?? []).length, 3);
  assert.match(panel, /showPick && createPortal/);
  assert.match(panel, /showConflicts && createPortal/);
  assert.match(panel, /showNotes && createPortal/);
  assert.match(panel, /className="d-modal is-open"/);
  assert.match(panel, /useDialogA11y\(\{/);
  // 页面本体里不再有统计格与三张口径卡。
  assert.doesNotMatch(panel, /className="d-statgrid"/);
  assert.doesNotMatch(panel, /className="d-grid3"/);
});

test("the table is per source and clicking a row selects that whole batch", () => {
  // 表里一行一个来源（候选 / 来源位置 / 条目数 / 最近写入）。
  assert.match(panel, /import\.colCandidate/);
  assert.match(panel, /import\.colPath/);
  assert.match(panel, /import\.colCount/);
  assert.match(panel, /import\.colWritten/);
  assert.match(panel, /activeState\.sources\.map/);
  // 点行＝勾这一行整批（`toggleGroupSelection`），行状态用画板的 `.is-on`。
  assert.match(panel, /selected: toggleGroupSelection\(activeState\.selected, row\.items\)/);
  assert.match(panel, /className=\{on \? "is-on" : undefined\}/);
  // 扫不到的来源也列一行：空列表看起来像坏了。
  assert.match(panel, /import\.sourceMissing/);
});

test("four kinds switch without losing their scan, and the confirm button is gated", () => {
  // 切页签不能丢结果：四类状态都在 `states` 里，切芯片只改 `active`。
  assert.match(panel, /states\[kind\]\.candidates/);
  assert.match(panel, /onClick=\{\(\) => setActive\(kind\)\}/);
  // 「确认导入」在一条都没勾时是灰的。
  assert.match(panel, /disabled=\{activeState\.selected\.size === 0 \|\| activeState\.applying\}/);
  assert.match(panel, /import\.confirmImport/);
  assert.match(panel, /import\.clearSelection/);
  // 旧的工具栏右端摘要卡不再出现。
  assert.doesNotMatch(panel, /import\.selectionTitle/);
});

test("the conflict modal states the one mode the apply layer actually has", () => {
  // apply 写死「跳过」，所以只画一档 —— 画一个切不动的三档分段器就是画死控件。
  assert.match(panel, /import\.conflictOnlySkip/);
  assert.match(panel, /className="d-seg"/);
  assert.match(panel, /import\.conflictSkipBody/);
  // 弹窗入口原来在卡头上那枚按钮；卡去掉后页面上没有入口了（弹窗组件仍在）。
  assert.doesNotMatch(panel, /import\.conflictButton/);
});

test("the source popover cannot be clipped by the settings scroller", () => {
  // `.d-set-main` 是 overflow-y:auto：绝对定位的 `.d-pop` 挂进去会被整块裁掉。
  assert.match(panel, /<PortalDropdown/);
  assert.match(panel, /className="d-pop-float"/);
  assert.doesNotMatch(panel, /className="d-pop is-open"/);
});

/* fork:multi-select-row（2026-10-07）—— 可多选的会话行靠 `system.css` 的
   `.d-sess:has(> .d-checkbox)` 切成两列网格（勾选盒跨两行在行首、标题与副行在右列）。
   那条规则**只在勾选盒是行的第一个子节点时**才命中，所以这一页必须与归档页发同一套
   子节点顺序。样式与原因详见 `ProjectArchivePanel.test.mjs` 里那条。 */
test("可多选的会话行与归档页同一套子节点顺序（勾选盒在行首）", () => {
  // 下标比而不是正则窗口：`className="d-sess"` 与勾选盒之间隔着 title / onClick 一串。
  const at = panel.indexOf('className="d-sess"');
  assert.ok(at > 0, "找不到 `.d-sess` 行");
  const chunk = panel.slice(at, at + 1200);
  const box = chunk.indexOf('<span role="checkbox"');
  assert.ok(box > 0, "会话行里找不到勾选盒");
  assert.ok(
    box < chunk.indexOf("d-sess-t"),
    "勾选盒必须是会话行的第一个子节点 —— 否则行会回到「勾选盒独占一行」",
  );
});