import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./TabOverview.tsx", import.meta.url), "utf8");

test("fork:v5-landing —— 浮层是画板 D-02c 帧 C 的 d-pop-float 长菜单", () => {
  assert.match(
    source,
    /data-tab-overview="true"[\s\S]*?className="d-pop-float"/,
    "浮层壳挂 .d-pop-float（外点判定仍认 data-tab-overview）",
  );
  assert.match(source, /position: "fixed"|top: anchor\.top/, "仍然是 fixed 定位（宿主 tab 栏横向裁切）");
  assert.match(source, /zIndex: 400/, "层级不变");
  assert.match(source, /width: PANEL_WIDTH/, "宽度仍由 PANEL_WIDTH 给，不写死");
  // fork:board-diff-2026-10-01 —— 宽度从 300 对齐到画板 31 第三节样张的 340。
  assert.match(source, /const PANEL_WIDTH = 340;/, "340 宽对齐画板样张");
  assert.match(source, /className="d-searchfield"/, "搜索头是画板的 .d-searchfield");
  assert.match(
    source,
    /<div className="d-searchfield"[\s\S]*?<i data-ico="search" data-size="13"><\/i>/,
    "搜索头左侧是画板的 search 图标（直接 <i>，与画板原文一致）",
  );
  assert.match(source, /className="d-pop-title"/, "分组标题是 .d-pop-title");
  assert.ok(
    (source.match(/className="d-pop-title"/g) ?? []).length === 2,
    "两段分组标题：「全部标签」与「最近关闭」",
  );
  assert.match(source, /className="d-sep"/, "两段之间有 .d-sep 分隔线");
  assert.match(
    source,
    /className=\{`d-trow d-grow\$\{isActive \? " is-on" : ""\}`\}/,
    "标签行是 .d-trow.d-grow，当前项挂 .is-on",
  );
  assert.match(source, /className="d-iconbtn"/, "每行末尾一枚 .d-iconbtn 关闭钮");
  assert.match(source, /className="d-badge mute"/, "标题行右侧是画板的 .d-badge.mute 计数");
});

test("fork:v5-landing —— 三个批量动作行搬到浮层底部（画板 D-02c 帧 C 的最后三行）", () => {
  const actions = source.slice(source.indexOf("onClick={onCloseOthers}"));
  const others = source.indexOf("onClick={onCloseOthers}");
  const all = source.indexOf("onClick={onCloseAll}");
  const clear = source.indexOf("onClick={onClearRecent}");
  const recentTitle = source.indexOf('{t("tabs.recentlyClosed")}');

  assert.ok(others > -1 && all > others && clear > all, "三个动作按 关闭其他 → 关闭全部 → 清空最近关闭 排列");
  assert.ok(others > recentTitle, "三个动作都在「最近关闭」之后，即浮层底部");
  assert.match(actions, /<span className="d-grow">\{t\("tabs\.closeOthers"\)\}<\/span>/);
  assert.match(actions, /<span className="d-grow">\{t\("tabs\.closeAll"\)\}<\/span>/);
  // 画板 D-02c：清空最近关闭是 error 色的危险行（eraser 图标 + .danger 文字色）。
  assert.match(
    source,
    /onClick=\{onClearRecent\}[\s\S]*?className="d-menu-row danger"[\s\S]*?<i data-ico="eraser" data-size="14">/,
    "清空最近关闭是画板的危险行（eraser + .danger）",
  );
  // 关闭其他仍受「少于两个标签」保护。
  assert.match(source, /disabled=\{tabs\.length < 2\}/);
});

test("fork:v5-landing —— TabGlyph 走画板图标实名，不再手绘 SVG", () => {
  const glyph = source.slice(source.indexOf("const TAB_KIND_ICON"), source.indexOf("export function TabOverview"));
  assert.match(glyph, /terminal: "terminal"/);
  assert.match(glyph, /browser: "globe"/);
  assert.match(glyph, /session: "bot"/);
  assert.match(glyph, /"git-graph": "git-branch"/);
  assert.match(glyph, /<i data-ico=\{icon\} data-size="14">/, "图标走 data-ico 水合");
  assert.doesNotMatch(glyph, /<svg/, "TabGlyph 不再手绘 SVG");
});

test("fork:v5-landing —— 恢复行用画板的 history 图标 + d-btn.sm 标签", () => {
  const recent = source.slice(source.indexOf('{t("tabs.recentlyClosed")}'), source.indexOf("onClick={onCloseOthers}"));
  assert.match(recent, /<i data-ico="history" data-size="14"><\/i>/);
  assert.match(recent, /className="d-btn sm"/);
});

test("carries no hand-drawn SVG anywhere in the file", () => {
  assert.doesNotMatch(source, /<svg/);
});

test("keeps search focus, outside-click and Escape behavior", () => {
  assert.match(source, /const frame = requestAnimationFrame\(\(\) => inputRef\.current\?\.focus\(\)\)/);
  assert.match(source, /setQuery\(""\)/, "每次打开清空上一次查询");
  assert.match(source, /target\?\.closest\("\[data-tab-overview\]"\)/);
  assert.match(source, /target\?\.closest\("\[data-tab-overview-trigger\]"\)/);
  assert.match(source, /event\.key === "Escape"[\s\S]*?onClose\(\)/);
  assert.match(source, /onClick=\{\(\) => \{ onSelectTab\(tab\.id\); onClose\(\); \}\}/);
  assert.match(source, /onClick=\{\(\) => \{ onRestore\(tab\); onClose\(\); \}\}/);
});
