import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  buildPickListExpression,
  clearBrowserPick,
  MAX_PICKABLE_ELEMENTS,
  parsePickList,
  peekBrowserPick,
  publishBrowserPick,
  scalePickBox,
  subscribeBrowserPick,
  takeBrowserPick,
  toBrowserPick,
} = await jiti.import("./browser-element-pick.ts");

// fork:element-picker —— 面板 → 输入框是一次**单次交接**：投递后被取走就没了。
// 不做单次消费的话，下次打开输入框会收到上一个页面点出来的元素。
test("a published pick is handed over exactly once", () => {
  clearBrowserPick();
  assert.equal(takeBrowserPick(), null);

  const pick = { id: "browser:t1#3", role: "button", name: "登录", snippet: "<button>登录</button>" };
  publishBrowserPick(pick);
  assert.equal(peekBrowserPick()?.id, "browser:t1#3");
  assert.deepEqual(takeBrowserPick(), pick);
  assert.equal(takeBrowserPick(), null, "取过一次之后必须为空");
});

test("subscribers are notified and unsubscribe cleanly", () => {
  clearBrowserPick();
  let hits = 0;
  const off = subscribeBrowserPick(() => { hits += 1; });
  publishBrowserPick({ id: "a", role: "r", name: "n", snippet: "" });
  assert.equal(hits, 1);
  off();
  publishBrowserPick({ id: "b", role: "r", name: "n", snippet: "" });
  assert.equal(hits, 1, "退订之后不该再收到");
  clearBrowserPick();
});

// 页面完全控制探针回的那段 JSON，而这些数字要变成我们 DOM 里的几何。
test("parsePickList rejects and clamps what the page hands us", () => {
  const viewport = { width: 1000, height: 800 };
  const good = { index: 0, role: "button", name: "登录", tag: "button", bounds: { x: 10, y: 20, width: 80, height: 30 }, snippet: "<button>" };
  const envelope = (boxes, vp = viewport) => ({ viewport: vp, boxes });

  assert.equal(parsePickList(envelope([good]), viewport).length, 1);

  // 不是对象 / 空 → 空数组，绝不抛。
  assert.deepEqual(parsePickList(null, viewport), []);
  assert.deepEqual(parsePickList({ nope: true }, viewport), []);
  assert.deepEqual(parsePickList(envelope("not-an-array"), viewport), []);

  const bad = [
    { ...good, bounds: { x: NaN, y: 0, width: 10, height: 10 } },          // NaN
    { ...good, bounds: { x: 0, y: 0, width: Infinity, height: 10 } },     // Infinity
    { ...good, bounds: { x: 0, y: 0, width: 0, height: 10 } },            // 零宽
    { ...good, bounds: { x: -500, y: 0, width: 10, height: 10 } },         // 整块在视口左外
    { ...good, bounds: { x: 5000, y: 0, width: 10, height: 10 } },         // 整块在视口右外
    { ...good, bounds: null },
  ];
  assert.equal(parsePickList(envelope(bad), viewport).length, 0);

  // 半出界的要留下（页面元素被滚出一半是常态），全出界的丢掉。
  const half = parsePickList(envelope([{ ...good, bounds: { x: -5, y: 10, width: 40, height: 20 } }]), viewport);
  assert.equal(half.length, 1);
});

// 页面可能缩放过（浏览器缩放 / 设备像素比），页面 CSS px 与 slot 像素不是同一尺度。
test("scalePickBox maps page css px onto the slot", () => {
  const box = { index: 0, role: "button", name: "x", tag: "button", bounds: { x: 10, y: 20, width: 100, height: 50 }, snippet: "" };
  // 页面视口 1000×800 装进 500×400 的 slot → 整体一半。
  const scaled = scalePickBox(box, { width: 1000, height: 800 }, { width: 500, height: 400 });
  assert.deepEqual(scaled.bounds, { x: 5, y: 10, width: 50, height: 25 });
  // 视口未知（页面没给）时原样返回，不猜比例。
  assert.deepEqual(
    scalePickBox(box, { width: 0, height: 0 }, { width: 500, height: 400 }).bounds,
    box.bounds,
  );
  // 原盒子不能被就地改坏（它在 state 里）。
  assert.equal(box.bounds.x, 10);
});

// 上限是防「一页 5000 个盒子糊成一片」，且必须真的传给页面。
test("the probe caps how many elements it offers", () => {
  const expression = buildPickListExpression();
  assert.match(expression, new RegExp(`"limit":${MAX_PICKABLE_ELEMENTS}`));
  // 上限之上再传也夹回来，而不是照单全收。
  assert.match(buildPickListExpression(9999), new RegExp(`"limit":${MAX_PICKABLE_ELEMENTS}`));
  assert.match(buildPickListExpression(5), /"limit":5/);
});

// 无名元素只有本身可交互才列 —— 否则输出是一堆分隔线（与 observe 同款取舍）。
test("the probe keeps unnamed non-interactive elements out", () => {
  const expression = buildPickListExpression();
  assert.match(expression, /if \(!name && !interactive\) continue;/);
  assert.match(expression, /visibility === 'hidden'/);
});

test("a box becomes a reference labelled like the ref system", () => {
  const box = { index: 7, role: "button", name: "登录", tag: "button", bounds: { x: 0, y: 0, width: 1, height: 1 }, snippet: "<button>登录</button>" };
  assert.deepEqual(toBrowserPick(box, "tab-1"), {
    id: "browser:tab-1#7",
    role: "button",
    name: "登录",
    snippet: "<button>登录</button>",
  });
  // 无名元素退回角色名，不留空标签。
  assert.equal(toBrowserPick({ ...box, name: "" }, "t").name, "button");
});