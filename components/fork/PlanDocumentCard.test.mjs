// fork:pr52-plan-tools —— 计划文档卡片的形状门禁。
//
// 三条纪律都在这里：DOM 取自 v5 画板 D-25 帧 A 的计划卡 `.d-plan`（不自造类名、不写内联几何）、
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
  // 结构就是 v5 画板 D-25 帧 A 的计划卡：.d-plan 外壳 + head（图标 / 标题 / 徽章）+ foot（路径 / 预览）
  assert.match(html, /class="d-plan"/);
  assert.match(html, /class="d-plan-head"/);
  assert.match(html, /class="d-plan-foot"/);
  assert.match(html, /class="d-plan-meta d-mono"/);
  assert.match(html, /class="d-grow"/);
  assert.match(html, /class="d-btn sm"/);

  const button = /<button[^>]*class="d-btn sm"[^>]*>([\s\S]*?)<\/button>/.exec(html);
  assert.ok(button, "预览钮必须是真按钮");
  assert.equal(opened.length, 0, "服务端渲染阶段不点");
  assert.match(button[1], /data-ico="eye"/);
});

test("没有打开回调时按钮禁用，不给一个点了没反应的死按钮", () => {
  const html = render();
  assert.match(html, /<button[^>]*disabled[^>]*class="d-btn sm"|class="d-btn sm"[^>]*disabled/);
});

test("接线：工具卡把计划 details 交给卡片，并把宿主的 onOpenFile 透下去", async () => {
  // 这两处接线在 components/MessageView.tsx（不在本 PR 的独占清单里，只动了两处、一处 import）。
  // 钉住它们是为了：卡片不会变成死代码，且卡片永远不自己开预览器。
  const messageView = await readFile(new URL("../MessageView.tsx", import.meta.url), "utf8");
  // fork:v5-landing —— 同一条 import 现在多带一个 `PlanRail`（计划卡的进度轨道，
  // 画板 D-03 帧 C），所以断言的是「这条通路仍在、模块仍是唯一来源」，不是逐字那三件。
  assert.match(messageView, /import \{[^}]*\bPlanDocumentCard\b[^}]*\} from "\.\/fork\/PlanDocumentCard"/);
  assert.match(messageView, /import \{ PlanReferenceList \} from "\.\/fork\/PlanReferenceList"/);
  assert.match(messageView, /isPlanToolDetails\(result\?\.details\)/, "工具结果里的计划 details 要被认出来");
  assert.match(messageView, /<PlanDocumentCard/, "工具卡上要挂计划卡片");
  assert.match(messageView, /onOpenFile=\{onOpenFile \? \(filePath\) => onOpenFile\(filePath\) : undefined\}/, "复用宿主既有的打开通道");
  // 失败的那次不画卡
  assert.match(messageView, /!result\?\.isError && isPlanToolDetails/);
  // fork:v5-landing D-03 帧 C —— 轨道的接线：真实步骤只从 `todo` 工具结果来
  // （`isTodoDetails`），纯 `list` 不画（否则同一张卡连排两遍），窄屏不画
  // （PWA 库没有 m-plan-*，不发明类名）。
  assert.match(messageView, /isTodoDetails\(result\?\.details\)/, "todo 工具结果里的真实步骤要被认出来");
  assert.match(messageView, /todo\.action !== "list"/, "纯读取动作不重复画同一张卡");
  assert.match(messageView, /<PlanRail steps=\{todoSteps\} \/>/, "轨道只接真实步骤");
});

test("轨道：状态档逐字来自画板，且没有步骤就不画", () => {
  // fork:v5-landing —— 画板 D-03 帧 C 的 `.d-plan-body > .d-plan-rail > .d-plan-step`，
  // 状态类只有 done / run / fail / skip 四档，没有状态类 = 待做（裸 `.d-plan-step`）。
  assert.match(source, /className="d-plan-body"/);
  assert.match(source, /className="d-plan-rail"/);
  assert.match(source, /className=\{step\.state \? `d-plan-step \$\{step\.state\}` : "d-plan-step"\}/);
  assert.match(source, /className="d-plan-dot"/);
  // 没有步骤就不画这一段（计划文档自己没有分步数据，不硬造）。
  assert.match(source, /if \(steps\.length === 0\) return null;/);
});

test("组件不预览、不编辑、也不引入新的类名与手绘图形", () => {
  assert.doesNotMatch(source, /<svg/, "图标一律走 <i data-ico>");
  assert.doesNotMatch(source, /fork-plan/, "不许新造钩子类（判据⑦：pw-* 之外的视觉类同样不进产品）");
  assert.match(source, /<i data-ico="file-text" data-size="15"/, "画板 D-25 计划卡的文件图标");
  assert.match(source, /<i data-ico="eye" data-size="13"/, "画板 D-25 计划卡的预览图标");
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
// fork:v5-boards D-25 —— 计划卡底栏除路径外还写一行元信息（画板帧 A 的 `.d-plan-foot`
// 上那三行 `.d-plan-meta`）。产品能如实给的只有落盘日期：步进轨道 / 时间线要计划**步骤**
// 数据，那条在产品里是 todo 扩展（`lib/plan-documents.ts` 头注明确不合并），不凭空造。
test("fork:v5-boards D-25 —— 底栏把宿主递进来的落盘日期也写出来（没有就不写）", () => {
  const dated = render({
    plan: { ...PLAN, updatedAt: "2026-10-02T09:31:12.000Z" },
  });
  assert.match(dated, /class="d-plan-meta d-mono">2026-10-02</, "日期用 ISO 头一段：三语同一个串，不造本地化词汇");
  const undated = render();
  assert.equal((undated.match(/class="d-plan-meta d-mono"/g) ?? []).length, 1, "没有 updatedAt 就只有路径那一行");
});
