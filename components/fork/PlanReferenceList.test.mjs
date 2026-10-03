// fork:pr52-plan-tools —— 「从消息引用计划」的行为门禁。
//
// 这一层的价值全在**认出**与**不认出**：认出计划路径才有卡片，普通路径、URL、粘上标点的句子
// 都必须安静通过。路径识别是纯函数（lib/plan-documents.ts），这里钉的是它在界面上的后果。
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { PlanReferenceList } = await jiti.import("./PlanReferenceList.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

const CWD = "/repo/pi-web";

function render(props) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(PlanReferenceList, props)),
  );
}

test("消息里提到计划文件 → 渲染成可点的卡片", () => {
  const html = render({
    text: `计划写在 /repo/pi-web/.pi/plans/2026-10-02-login-flow.md，你看看。`,
    cwd: CWD,
    onOpenFile: () => {},
  });
  assert.match(html, /2026-10-02-login-flow\.md/);
  assert.match(html, /class="pw-filecard"/);
  assert.match(html, /role="group"/);
});

test("相对路径给了 cwd 才渲染，不给就当没提过", () => {
  const withCwd = render({ text: "见 `.pi/plans/2026-10-02-a.md`", cwd: CWD });
  assert.match(withCwd, /2026-10-02-a\.md/);
  assert.match(withCwd, /\/repo\/pi-web/, "渲染出来的必须是解析后的绝对路径");
  assert.equal(render({ text: "见 `.pi/plans/2026-10-02-a.md`" }), "");
});

test("跟计划无关的消息渲染出空（不多画一个空壳）", () => {
  assert.equal(render({ text: "普通的一句话，没有路径", cwd: CWD }), "");
  assert.equal(render({ text: "改了 src/index.ts 和 docs/plans/a.md", cwd: CWD }), "");
  assert.equal(render({ text: "https://example.com/.pi/plans/2026-10-02-a.md", cwd: CWD }), "");
  assert.equal(render({ text: "", cwd: CWD }), "");
});

test("同一份计划提到两次只出一张卡", () => {
  const once = "/repo/pi-web/.pi/plans/2026-10-02-a.md";
  const html = render({ text: `${once} 与 ${once}`, cwd: CWD });
  assert.equal(html.match(/class="pw-filecard"/g)?.length, 1);
});

test("多份计划都列出来（按消息里出现的先后）", () => {
  const html = render({
    text: "先看 /repo/pi-web/.pi/plans/2026-10-02-a.md，再看 /repo/pi-web/.pi/plans/2026-10-02-b.md",
    cwd: CWD,
  });
  const names = [...html.matchAll(/class="pw-fname">([^<]+)</g)].map((match) => match[1]);
  assert.deepEqual(names, ["2026-10-02-a.md", "2026-10-02-b.md"]);
});

test("组件不自写预览器：只把路径交给宿主回调，且回调缺省时按钮禁用", () => {
  const withHandler = render({ text: "/repo/pi-web/.pi/plans/2026-10-02-a.md", cwd: CWD, onOpenFile: () => {} });
  assert.doesNotMatch(withHandler, /disabled/);
  const withoutHandler = render({ text: "/repo/pi-web/.pi/plans/2026-10-02-a.md", cwd: CWD });
  assert.match(withoutHandler, /disabled/);
});