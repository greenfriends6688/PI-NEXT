import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./BrowserPanel.tsx", import.meta.url), "utf8");

test("fork:design-system SW-06 —— 地址栏挂画板 31 的 .pw-url", () => {
  const bar = source.slice(source.indexOf('className="pw-browser-bar"'));

  assert.match(bar, /className="pw-url"/, "地址栏 input 挂 .pw-url");
  assert.doesNotMatch(bar, /className="pw-input"/, "旧的 .pw-input 写法已退役");
  // .pw-url 在画板里是 span（等宽、面板底、细边框）；产品是 input，只补布局值。
  // fork:board-diff-2026-10-01 —— 原来的 `font: "inherit"` 把 board.css:605 的等宽 11px
  // 顶成了无衬线 13px（`31-terminal-browser-git` 的 spec 报出 fontSize 13≠11 /
  // fontFamily 无引号）。现在**字体与字号都交给 .pw-url**，input 只补 min-width。
  assert.match(
    bar,
    /className="pw-url"[\s\S]*?style=\{\{ minWidth: 0 \}\}/,
    "input 只补 min-width，字体/字号/面板底全交给 .pw-url",
  );
  // 同上，但只查 .pw-url 元素**自身**的那一段（后面可能还有别的 input 合法地补字体）。
  const urlEl = bar.slice(bar.indexOf('className="pw-url"'), bar.indexOf('className="pw-url"') + 200);
  assert.doesNotMatch(urlEl, /font: "inherit"/, ".pw-url 不许再用 font:inherit 压掉画板的等宽");
  assert.doesNotMatch(urlEl, /fontSize:/, ".pw-url 的字号由 board.css 给");
});

test("keeps the browser bar primitives around it untouched", () => {
  const bar = source.slice(source.indexOf('className="pw-browser-bar"'));

  assert.ok((bar.match(/className="pw-iconbtn sm"/g) ?? []).length >= 4, "前进 / 后退 / 刷新 / 新窗口仍是 .pw-iconbtn.sm");
  assert.match(bar, /<i data-ico="arrow-left" data-size="14">/);
  assert.match(bar, /<i data-ico="rotate-cw" data-size="14">/);
  assert.match(bar, /<i data-ico="external-link" data-size="14">/);
  assert.match(bar, /className="pw-browser-bar"/, "头行是画板 31 的 .pw-browser-bar");
});

test("keeps navigation behavior: Enter, history and viewport presets", () => {
  assert.match(
    source,
    /if \(event\.key !== "Enter" \|\| event\.nativeEvent\.isComposing\) return;[\s\S]*?navigate\(draft\)/,
    "回车提交仍然跳过输入法组字",
  );
  assert.match(source, /disabled=\{historyIndex <= 0\}/, "后退在无历史时禁用");
  assert.match(source, /disabled=\{historyIndex >= history\.length - 1\}/, "前进在末尾时禁用");
  assert.match(source, /disabled=\{!currentUrl\}/, "刷新在没有地址时禁用");
  // fork:design-system SW-06 —— 视口预设从原生 select 换成画板 31 的 .pw-chipbtn +
  // PortalDropdown（.pw-pop 列表）；预设五项与右缘对齐照旧。
  assert.match(source, /data-ico=\{viewport === null \? "maximize-2" : "smartphone"\}/, "触发钮随状态换图标");
  assert.match(source, /value: 1280/, "视口预设五项仍在");
  assert.match(source, /align="right"/, "预设下拉右缘对齐触发点（PortalDropdown 只收 left/right）");
  assert.match(source, /aria-disabled=\{!currentUrl\}/, "无地址时外链按钮仍标记为不可用");
  assert.match(source, /sandbox="allow-scripts allow-same-origin/, "iframe 沙箱不变");
});
