import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panel = await readFile(new URL("./ImportPanel.tsx", import.meta.url), "utf8");

/* fork:v5-landing-frame · D-21（2026-10-06）—— 桌面整页照抄画板 D-21 帧 B：
   一列卡片（扫描卡 / 冲突策略卡 / 第二步确认卡 / 三张口径卡）。v1 画板 62 的
   骨架 B 与那条挤爆的工具栏一并退场。下面锁的是**画板那一页的结构**。 */

test("scanning is always an explicit action, never automatic", () => {
  // ADR 0179 D007 — 不许「启动时自动导入」。没有挂载即扫的 effect，
  // scan 只能从扫描卡卡头那枚「重新扫描」进。
  assert.doesNotMatch(panel, /useEffect/);
  assert.match(panel, /onClick=\{\(\) => void scan\(active\)\}/);
  // apply 同理：只从第二步的「确认导入」进，且空选时拒绝。
  assert.match(panel, /onClick=\{\(\) => void apply\(active\)\}/);
  assert.match(panel, /if \(state\.selected\.size === 0\) return;/);
});

test("scan and apply send ids, and the panel reports three-color results", () => {
  assert.match(panel, /"\/api\/import\/scan"/);
  assert.match(panel, /"\/api\/import\/apply"/);
  // 送给 apply 的只有候选 id，从不送路径。
  assert.match(panel, /ids: \[\.\.\.state\.selected\]/);
  assert.match(panel, /summarizeResults/);
  // 界面上送出去的只有候选 id（画板帧 B 第二步的黄色横幅）。
  assert.match(panel, /settings|import\.idsOnly/);
});

test("the page is board D-21 frame B: one column of cards, no toolbar, no list/detail split", () => {
  // 根是一列 `d-col`（gap sp-4），卡片按画板顺序排。
  assert.match(panel, /<div className="d-col" style=\{\{ gap: "var\(--nx-sp-4\)" \}\}>/);
  // 骨架 B 与那条工具栏退场（工具栏正是截图里按钮竖排挤爆的那一行）。
  assert.doesNotMatch(panel, /ConfigSplitView|ConfigSidebar|ConfigDetailStack/);
  assert.doesNotMatch(panel, /toolbar=\{/);
  // 帧 B 的三张卡 + 末尾那张 `d-grid3` 三联卡。
  assert.match(panel, /import\.stepScan/);
  assert.match(panel, /className="d-card-head"/);
  assert.match(panel, /className="d-table"/);
  assert.match(panel, /import\.stepApply/);
  assert.match(panel, /className="d-statgrid"/);
  assert.match(panel, /className="d-grid3"/);
  // 两枚路由徽标写明两段式。
  assert.match(panel, /POST \/api\/import\/scan/);
  assert.match(panel, /POST \/api\/import\/apply/);
});

test("the table is per source and clicking a row selects that whole batch", () => {
  // 帧 B：表里一行一个来源（候选 / 来源位置 / 条目数 / 最近写入）。
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
  // 「确认导入」在一条都没勾时是灰的（帧 B 第二步的判定）。
  assert.match(panel, /disabled=\{activeState\.selected\.size === 0 \|\| activeState\.applying\}/);
  assert.match(panel, /import\.confirmImport/);
  // 清空选择仍在第二步那一行里（不再是工具栏右端）。
  assert.match(panel, /import\.clearSelection/);
  // 旧的工具栏右端摘要卡不再出现。
  assert.doesNotMatch(panel, /import\.selectionTitle/);
});

test("the conflict card states the one mode the apply layer actually has", () => {
  // apply 写死「跳过」，所以只画一档 —— 画一个切不动的三档分段器就是画死控件。
  assert.match(panel, /import\.conflictOnlySkip/);
  assert.match(panel, /className="d-seg"/);
  assert.match(panel, /import\.conflictSkipBody/);
  assert.match(panel, /className="d-badge warn"/);
});

test("the source popover cannot be clipped by the settings scroller", () => {
  // `.d-set-main` 是 overflow-y:auto：绝对定位的 `.d-pop` 挂进去会被整块裁掉。
  assert.match(panel, /<PortalDropdown/);
  assert.match(panel, /className="d-pop-float"/);
  assert.doesNotMatch(panel, /className="d-pop is-open"/);
});