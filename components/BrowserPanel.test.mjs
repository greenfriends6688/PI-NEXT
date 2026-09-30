import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./BrowserPanel.tsx", import.meta.url), "utf8");

test("fork:design-system SW-06 —— 地址栏挂画板 31 的 .pw-url", () => {
  const bar = source.slice(source.indexOf('className="pw-viewer-head"'));

  assert.match(bar, /className="pw-url"/, "地址栏 input 挂 .pw-url");
  assert.doesNotMatch(bar, /className="pw-input"/, "旧的 .pw-input 写法已退役");
  // .pw-url 在画板里是 span（等宽、面板底、细边框）；产品是 input，只归零 UA 行为样式。
  assert.match(
    bar,
    /className="pw-url"[\s\S]*?style=\{\{ font: "inherit", minWidth: 0 \}\}/,
    "input 只补字体继承与 min-width，视觉值全交给 .pw-url",
  );
});

test("keeps the browser bar primitives around it untouched", () => {
  const bar = source.slice(source.indexOf('className="pw-viewer-head"'));

  assert.ok((bar.match(/className="pw-iconbtn sm"/g) ?? []).length >= 4, "前进 / 后退 / 刷新 / 新窗口仍是 .pw-iconbtn.sm");
  assert.match(bar, /<i data-ico="arrow-left" data-size="14">/);
  assert.match(bar, /<i data-ico="rotate-cw" data-size="14">/);
  assert.match(bar, /<i data-ico="external-link" data-size="14">/);
  assert.match(bar, /className="pw-viewer-head"/, "头行仍是 .pw-viewer-head（本轮不动）");
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
  assert.match(source, /<option value="fill">/, "视口预设五项仍在（原生 select 本轮不动）");
  assert.match(source, /<option value="1280">/);
  assert.match(source, /aria-disabled=\{!currentUrl\}/, "无地址时外链按钮仍标记为不可用");
  assert.match(source, /sandbox="allow-scripts allow-same-origin/, "iframe 沙箱不变");
});
