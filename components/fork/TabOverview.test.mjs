import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./TabOverview.tsx", import.meta.url), "utf8");

test("fork:design-system —— 浮层是画板 31-B 的 pw-pop 长菜单", () => {
  assert.match(
    source,
    /data-tab-overview="true"[\s\S]*?className="pw-pop"/,
    "浮层壳挂 .pw-pop（外点判定仍认 data-tab-overview）",
  );
  assert.match(source, /position: "fixed"/, "仍然是 fixed 定位（宿主 tab 栏横向裁切）");
  assert.match(source, /zIndex: 400/, "层级不变");
  assert.match(source, /width: PANEL_WIDTH/, "宽度仍由 PANEL_WIDTH 给，不写死");
  assert.match(source, /const PANEL_WIDTH = 300;/, "300 宽保持不变");
  assert.match(source, /className="pw-pop-search"/, "搜索头是画板的 .pw-pop-search");
  assert.match(
    source,
    /<div className="pw-pop-search"[\s\S]*?<span className="pw-ico"><i data-ico="search" data-size="14"><\/i><\/span>/,
    "搜索头左侧是画板的 search 图标",
  );
  assert.match(source, /className="pw-pop-title"/, "分组标题是 .pw-pop-title");
  assert.ok(
    (source.match(/className="pw-pop-title"/g) ?? []).length === 2,
    "两段分组标题：「全部标签」与「最近关闭」",
  );
  assert.match(source, /className="pw-sep"/, "两段之间有 .pw-sep 分隔线");
  assert.match(
    source,
    /className=\{`pw-prow\$\{isActive \? " is-on" : ""\}`\}/,
    "标签行是 .pw-prow，当前项挂 .is-on",
  );
  assert.match(source, /className="pw-iconbtn sm"/, "每行末尾一枚 .pw-iconbtn.sm 关闭钮");
  assert.match(source, /className="pw-badge count"/, "标题行右侧是画板的 .pw-badge.count 计数");
});

test("fork:design-system —— 三个批量动作行搬到浮层底部（画板 31-B 的最后三行）", () => {
  const actions = source.slice(source.indexOf("onClick={onCloseOthers}"));
  const others = source.indexOf("onClick={onCloseOthers}");
  const all = source.indexOf("onClick={onCloseAll}");
  const clear = source.indexOf("onClick={onClearRecent}");
  const recentTitle = source.indexOf('{t("tabs.recentlyClosed")}');

  assert.ok(others > -1 && all > others && clear > all, "三个动作按 关闭其他 → 关闭全部 → 清空最近关闭 排列");
  assert.ok(others > recentTitle, "三个动作都在「最近关闭」之后，即浮层底部");
  assert.match(actions, /<span className="grow">\{t\("tabs\.closeOthers"\)\}<\/span>/);
  assert.match(actions, /<span className="grow">\{t\("tabs\.closeAll"\)\}<\/span>/);
  // 画板 31-B：清空最近关闭是 error 色的危险行（eraser 图标 + var(--error) 文字）。
  assert.match(
    source,
    /onClick=\{onClearRecent\}[\s\S]*?style=\{\{ color: "var\(--error\)" \}\}[\s\S]*?<i data-ico="eraser" data-size="14">/,
    "清空最近关闭是画板的危险行（eraser + error 色）",
  );
  // 关闭其他仍受「少于两个标签」保护，只是换成画板的禁用行表达。
  assert.match(source, /disabled=\{tabs\.length < 2\}/);
  assert.match(source, /style=\{tabs\.length < 2 \? \{ opacity: 0\.45 \} : undefined\}/, "禁用行用画板 51 的 opacity 表达");
});

test("fork:design-system —— TabGlyph 走画板 31 的图标实名，不再手绘 SVG", () => {
  const glyph = source.slice(source.indexOf("const TAB_KIND_ICON"), source.indexOf("export function TabOverview"));
  assert.match(glyph, /terminal: "terminal"/);
  assert.match(glyph, /browser: "globe"/);
  assert.match(glyph, /session: "bot"/);
  assert.match(glyph, /"git-graph": "git-branch"/);
  assert.match(glyph, /<i data-ico=\{icon\} data-size="14">/, "图标走 data-ico 水合");
  assert.doesNotMatch(glyph, /<svg/, "TabGlyph 不再手绘 SVG");
});

test("fork:design-system —— 恢复行用画板的 history 图标 + pw-btn.sm 标签", () => {
  const recent = source.slice(source.indexOf('{t("tabs.recentlyClosed")}'), source.indexOf("onClick={onCloseOthers}"));
  assert.match(recent, /<span className="pw-ico pw-dim"><i data-ico="history" data-size="14"><\/i><\/span>/);
  assert.match(recent, /<span className="pw-btn sm">\{t\("tabs\.restore"\)\}<\/span>/);
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
