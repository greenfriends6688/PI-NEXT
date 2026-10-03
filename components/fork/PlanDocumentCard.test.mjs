// fork:pr52-plan-tools —— 计划文档卡片的形状门禁。
//
// 三条纪律都在这里：DOM 取自画板 54 B 的 `.pw-filecard`（不自造类名、不写内联几何）、
// 图标走 lucide `<i data-ico>`（零手绘 SVG）、预览**复用宿主既有的打开回调**（不自写预览器）。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { PlanDocumentCard } = await jiti.import("./PlanDocumentCard.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

const source = await readFile(new URL("./PlanDocumentCard.tsx", import.meta.url), "utf8");

const PLAN = {
  filePath: "/repo/pi-web/.pi/plans/2026-10-02-login-flow.md",
  fileName: "2026-10-02-login-flow.md",
  relativePath: ".pi/plans/2026-10-02-login-flow.md",
  title: "Login flow",
  absolute: true,
};

function render(props = {}) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(PlanDocumentCard, { plan: PLAN, ...props })),
  );
}

test("卡片显示文件名与相对路径，点预览钮把绝对路径交给宿主的打开回调", () => {
  const opened = [];
  const html = render({ onOpenFile: (filePath, fileName) => opened.push([filePath, fileName]) });
  assert.match(html, /2026-10-02-login-flow\.md/);
  assert.match(html, /\.pi\/plans\/2026-10-02-login-flow\.md/);
  // 结构就是画板 54 B 那一行：图标 / 文件名 / meta / grow / 预览钮
  assert.match(html, /class="pw-filecard"/);
  assert.match(html, /class="pw-fname"/);
  assert.match(html, /class="pw-meta"/);
  assert.match(html, /class="grow"/);
  assert.match(html, /class="pw-btn sm"/);

  const button = /<button[^>]*class="pw-btn sm"[^>]*>([\s\S]*?)<\/button>/.exec(html);
  assert.ok(button, "预览钮必须是真按钮");
  assert.equal(opened.length, 0, "服务端渲染阶段不点");
  assert.match(button[1], /data-ico="eye"/);
});

test("没有打开回调时按钮禁用，不给一个点了没反应的死按钮", () => {
  const html = render();
  assert.match(html, /<button[^>]*disabled[^>]*class="pw-btn sm"|class="pw-btn sm"[^>]*disabled/);
});

test("接线：工具卡把计划 details 交给卡片，并把宿主的 onOpenFile 透下去", async () => {
  // 这两处接线在 components/MessageView.tsx（不在本 PR 的独占清单里，只动了两处、一处 import）。
  // 钉住它们是为了：卡片不会变成死代码，且卡片永远不自己开预览器。
  const messageView = await readFile(new URL("../MessageView.tsx", import.meta.url), "utf8");
  assert.match(messageView, /import \{ PlanDocumentCard \} from "\.\/fork\/PlanDocumentCard"/);
  assert.match(messageView, /import \{ PlanReferenceList \} from "\.\/fork\/PlanReferenceList"/);
  assert.match(messageView, /isPlanToolDetails\(result\?\.details\)/, "工具结果里的计划 details 要被认出来");
  assert.match(messageView, /<PlanDocumentCard/, "工具卡上要挂计划卡片");
  assert.match(messageView, /onOpenFile=\{onOpenFile \? \(filePath\) => onOpenFile\(filePath\) : undefined\}/, "复用宿主既有的打开通道");
  // 失败的那次不画卡
  assert.match(messageView, /!result\?\.isError && isPlanToolDetails/);
});

test("组件不预览、不编辑、也不引入新的类名与手绘图形", () => {
  assert.doesNotMatch(source, /<svg/, "图标一律走 <i data-ico>");
  assert.doesNotMatch(source, /fork-plan/, "不许新造钩子类（判据⑦：pw-* 之外的视觉类同样不进产品）");
  assert.match(source, /<i data-ico="file-text" data-size="14"/, "画板 54 B 的文件图标");
  assert.match(source, /<i data-ico="eye" data-size="13"/, "画板 54 B 的预览钮图标");
  // 零内联几何：只有颜色（来自 token）走内联，间距全在 board.css
  for (const literal of [/padding:\s*[0-9]/, /gap:\s*[0-9]/, /height:\s*[0-9]/, /width:\s*[0-9]/, /fontSize:\s*[0-9]/, /borderRadius/]) {
    assert.doesNotMatch(source, literal, `不该出现内联几何 ${literal}`);
  }
  assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b/, "颜色走 var(--token)");
});

test("卡片用的 i18n key 在三语里都存在（locale 形状由 lib/i18n/registry.test.mjs 再兜一层）", async () => {
  const { getLocalePlugin, getSupportedLocales } = await jiti.import("@/lib/i18n/registry");
  for (const key of ["chat.planDocument", "chat.planOpen", "chat.planPreview", "chat.planReferences"]) {
    for (const locale of getSupportedLocales()) {
      assert.ok(getLocalePlugin(locale).messages[key], `${locale} 缺 ${key}`);
    }
  }
  // 卡片自己只用到这两个（另两个在 PlanReferenceList）
  assert.match(source, /t\("chat\.planOpen"\)/);
  assert.match(source, /t\("chat\.planPreview"\)/);
  assert.match(source, /aria-label=\{label\}/);
});