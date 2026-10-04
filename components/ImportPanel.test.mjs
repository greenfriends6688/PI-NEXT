import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panel = await readFile(new URL("./ImportPanel.tsx", import.meta.url), "utf8");

test("scanning is always an explicit action, never automatic", () => {
  // ADR 0179 D007 — 不许「启动时自动导入」。没有挂载即扫的 effect，
  // scan 只能从页头的「扫描」按钮进。
  assert.doesNotMatch(panel, /useEffect/);
  assert.match(panel, /onClick=\{\(\) => void scan\(active\)\}/);
  // apply 同理：只从「导入所选」按钮进，且空选时拒绝。
  assert.match(panel, /onClick=\{\(\) => void apply\(active\)\}/);
  assert.match(panel, /if \(state\.selected\.size === 0\) return;/);
});

test("scan and apply send ids, and the panel reports three-color results", () => {
  assert.match(panel, /"\/api\/import\/scan"/);
  assert.match(panel, /"\/api\/import\/apply"/);
  // 送给 apply 的只有候选 id，从不送路径。
  assert.match(panel, /ids: \[\.\.\.state\.selected\]/);
  assert.match(panel, /summarizeResults/);
});

test("all four kind panels stay mounted and switch via hidden", () => {
  // 切 tab 不能丢扫描结果：四个面板常驻，只切 hidden。
  const hiddenSwitches = panel.match(/hidden=\{kind !== active\}/g) ?? [];
  assert.ok(hiddenSwitches.length >= 2, "list and detail columns both keep all kinds mounted");
  assert.match(panel, /IMPORT_KINDS\.map\(\(kind\) => \(\s*<div key=\{kind\} hidden=/);
});

test("the selection summary lives in the toolbar, not a floating right card", () => {
  // 画板 62 落位表：右侧「本次选择」浮卡与搜索框不对齐 → 摘要进工具栏右端。
  const toolbar = panel.slice(panel.indexOf("toolbar={"), panel.indexOf("fill\n") > -1 ? panel.indexOf("fill\n") : panel.length);
  assert.match(toolbar, /import\.selectedOf/);
  assert.match(toolbar, /import\.clearSelection/);
  assert.match(toolbar, /import\.applySelected/);
  assert.match(toolbar, /<span className="d-grow"/);
  // 旧的右列浮卡（pw-kv 摘要 + inline 按钮行）不再出现。
  assert.doesNotMatch(panel, /import\.selectionTitle/);
});

test("the page uses skeleton B primitives", () => {
  // 列表 300 + 详情 760（.pw-cols 默认轨道），fill=两列各自滚。
  assert.match(panel, /<ConfigSplitView>/);
  assert.match(panel, /<ConfigSidebar>/);
  assert.match(panel, /<ConfigDetailStack>/);
  assert.match(panel, /\n\s*fill\n?\s*>/);
  // 页级动作「扫描」在页头（SettingsPage actions），不在内容区。
  const head = panel.slice(panel.indexOf("<SettingsPage"), panel.indexOf("toolbar={"));
  assert.match(head, /import\.scan/);
  // 分组标题带「全选」（画板 D-21 的分组标题形态）。
  assert.match(panel, /className="d-set-sec-t d-row"/);
  assert.match(panel, /import\.selectAll/);
});
