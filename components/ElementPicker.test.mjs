import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panel = await readFile(new URL("./BrowserPanel.tsx", import.meta.url), "utf8");
const input = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/fork-ui.css", import.meta.url), "utf8");
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const panelCode = strip(panel);
const inputCode = strip(input);

// fork:element-picker —— 拾取器的接线形状。三条约束都是被本仓边界逼出来的，
// 写成测试是因为它们都是「看起来能跑、实际会静默坏掉」的那种。
test("the picker reuses the extract op instead of adding a protocol op", () => {
  // BROWSER_HOST_OPS 里没有 executeScript，任意 JS 不在协议面内。
  assert.match(panelCode, /op: "extract"/);
  assert.match(panelCode, /payload: \{ expression: buildPickListExpression\(\) \}/);
  // 只在 managed 面画这枚钮：Web / iframe 面拿不到页面内部几何。
  assert.match(panelCode, /surface === "managed" && \(/);
});

test("boxes are scaled from page css px onto the slot, not used raw", () => {
  assert.match(panelCode, /scalePickBox\(raw, pickViewport, slotRect\)/);
  // slot 尺寸来自已有的 reportLayout（挂在 ResizeObserver 上），不另挂观察者。
  assert.match(panelCode, /setSlotRect\(\{ width: rect\.width, height: rect\.height \}\)/);
});

test("picking publishes a pick and hands it to the composer once", () => {
  // 交接用的是**未缩放**的原盒子（id / snippet 与缩放无关），
  // 缩放只作用于画在屏幕上的几何。
  assert.match(panelCode, /publishBrowserPick\(toBrowserPick\(box, tab\.id\)\)/);
  assert.match(panelCode, /onClick=\{\(\) => choosePick\(raw\)\}/);
  // 输入框订阅 + 单次取走：取走即清，不给下个会话留陈旧元素。
  assert.match(inputCode, /subscribeBrowserPick\(\(\) => \{\s*const pick = takeBrowserPick\(\);/);
  // 面板失败要就地说一句，不静默吞（否则用户以为按钮坏了）。
  assert.match(panelCode, /\{pickError && <p className="fork-browser-surface-note">\{pickError\}<\/p>\}/);
});

test("the overlay is a private fork- layer, not new pw- classes", () => {
  assert.match(css, /\.fork-browser-pick\b/);
  assert.match(css, /\.fork-browser-pick-box/);
  // 覆盖层铺满 slot 并接管指针；高亮画在我们这份 DOM 里，页面脚本不参与。
  assert.match(css, /\.fork-browser-pick\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;/);
  assert.doesNotMatch(css, /\.pw-[a-z-]*pick/);
});

// fork:browser-viewport / fork:browser-page-info —— 两个都是**条件渲染**的新控件，
// 它们的存在不该让画板 31 的对位漂移。下面把那两个前提钉成测试。

test("the viewport preset stays the first .pw-chipbtn in the bar", () => {
  // 画板 31 那一帧里 `.pw-chipbtn` 只有一枚（视口预设），而
  // `scripts/board-specs/31-terminal-browser-git.mjs` 按「第一个 `.pw-chipbtn`」配对。
  // 把缩放芯片插在它前面，那条 spec 就变成拿缩放芯片去对视口预设。
  const bar = panel.slice(panel.indexOf('className="pw-browser-bar"'));
  const preset = bar.indexOf("ref={viewportAnchorRef}");
  const zoom = bar.indexOf("BROWSER_VIEWPORT_ZOOM_OPTIONS.map");
  assert.ok(preset > 0 && zoom > 0, "两枚都要在头行里");
  assert.ok(preset < zoom, "视口预设必须排在缩放档之前");
});

test("the free-size control only renders in free-size mode", () => {
  // 它内含两个 `.pw-input`，默认渲染会把画板 31 量到的头行高度顶高一截。
  // 从 `className="pw-chipbtn"`（视口预设那枚）之后开始切，避免切到别的同名串。
  const bar = panel.slice(panel.indexOf('className="pw-browser-bar"'));
  const size = bar.indexOf("fork-browser-size");
  assert.ok(size > 0, "宽高框在头行里");
  // 它必须整段挂在 `{viewportSize && …}` 里面。
  assert.match(bar.slice(Math.max(0, size - 400), size), /\{viewportSize && \(/, "宽高框必须挂在 viewportSize 上");
});

test("the title row only renders when a title was actually read", () => {
  // iframe 面拿不到页面内部几何 ⇒ refreshPageInfo 直接 return ⇒ title 恒空 ⇒
  // 整行不渲染 ⇒ 画板 31（跑在 Web/生产上）看不到它，不需要补帧。
  // 反过来：去掉这个守卫就会让 `.pw-browser` 多出 20px + 一条发丝边，spec 立刻报漂移。
  const row = panel.slice(panel.indexOf('className="pw-browser"'));
  assert.match(row.slice(0, 900), /\{pageInfo\.title && \(/, "标题行必须挂在 title 上");
  const probe = panel.slice(panel.indexOf("const refreshPageInfo"));
  assert.match(probe.slice(0, 400), /surface !== "managed"[\s\S]*return;/, "iframe 面必须直接返回，不去探");
});
