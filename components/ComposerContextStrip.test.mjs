// fork:v5-skin D-04 —— 引用芯片条换画板 DOM 后，守的等价约束：
// 容器 .d-chips、芯片 .d-chipbtn（选中 .is-on）、移除钮 .d-iconbtn，
// 图标一律 <i data-ico>，不再有自有颜色/边框/字号，也不再有手绘 SVG。
// 交互契约（定位、打开引用、移除、清选区）不许跟着视觉一起被删掉。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ComposerContextStrip.tsx", import.meta.url), "utf8");
// 注释里会写到类名和 SVG 说法，断言前先剥掉。
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("芯片条挂在画板 D-04 的 .d-chips 上，每枚是 .d-chipbtn", () => {
  assert.match(code, /className="d-chips"/, "容器应当是 .d-chips");
  assert.match(code, /`d-chipbtn\$\{active \? " is-on" : ""\}`/, "芯片本体应当是 .d-chipbtn，高亮那枚挂 .is-on");
  assert.match(code, /className="d-iconbtn"/, "移除钮应当是 .d-iconbtn");
});

test("芯片内容是画板写法：data-ico 图标 + 文案", () => {
  assert.match(code, /<i data-ico=\{icon\} data-size="12">/, "图标要走画板的 <i data-ico>");
  assert.match(code, /data-ico="x" data-size="11"/, "移除钮的图标取画板的 x");
  assert.match(code, /icon="quote"/, "选区引用用 quote 图标");
  assert.match(code, /icon="message-square"/, "会话引用用 message-square 图标");
});

test("零手绘 SVG、零自有视觉类", () => {
  assert.doesNotMatch(code, /<svg/, "图标一律走 <i data-ico>，不许再手绘 SVG");
  for (const [literal, name] of [
    [/"background:/, "background"],
    [/"border:/, "border"],
    [/borderRadius/, "borderRadius"],
    [/boxShadow/, "boxShadow"],
    [/fontSize/, "fontSize"],
    [/"color:/, "color"],
  ]) {
    assert.doesNotMatch(code, literal, `组件里不该再出现 ${name}（视觉归 system.css）`);
  }
});

test("交互没丢：定位 / 打开引用 / 移除 / 点芯片先清文本选区", () => {
  assert.match(code, /onLocate\(context\)/, "点芯片仍然定位选区");
  assert.match(code, /onOpenSessionReference\?\.\(reference\)/, "点芯片仍然打开会话引用");
  assert.match(code, /onRemove\(context\.id\)/, "选区引用的移除回调没变");
  assert.match(code, /onRemoveSessionReference\?\.\(reference\.id\)/, "会话引用的移除回调没变");
  assert.match(code, /window\.getSelection\(\)\?\.removeAllRanges\(\)/, "点芯片前仍要先清掉文本选区");
  assert.match(code, /aria-label=\{removeLabel\}/, "移除钮仍带 aria-label");
  assert.match(code, /pointerEvents: active \? "auto" : "none"/, "移除钮仍是悬停 / 聚焦才可点");
});

test("i18n key 一个没动", () => {
  for (const key of [
    "chat.quotedContext",
    "chat.quotedContextLabel",
    "chat.sessionReferenceLabel",
    "chat.removeQuotedContext",
    "chat.removeSessionReference",
  ]) {
    assert.ok(code.includes(`"${key}"`), `缺少 ${key}`);
  }
});
