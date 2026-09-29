import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { NewSessionHome } = await jiti.import("./NewSessionHome.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function render(props) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(NewSessionHome, props)),
  );
}

test("shows the project name and one card per starter", () => {
  const html = render({ cwd: "/Users/me/projects/pi-web", isMobile: false, onInsertPrompt: () => {} });

  // Title uses the basename, not the full path.
  assert.match(html, /pi-web/);
  assert.doesNotMatch(html, /\/Users\/me\/projects\/pi-web\?/);
  assert.equal((html.match(/<button/g) ?? []).length, 4);
  // fork:design-components —— 起始卡直接用画板 01 的 .pw-starters/.pw-starter 组件，
  // 桌面端 2×2 列布局由 board.css 的类规则承担（不再是内联 style）。
  assert.match(html, /pw-starters/);
  // 注意 .pw-starters 容器名也含 pw-starter 子串，用引号边界只数按钮本身。
  assert.equal((html.match(/pw-starter"/g) ?? []).length, 4);
});

test("falls back to the generic title without a cwd and stacks cards on mobile", () => {
  const html = render({ cwd: null, isMobile: true, onInsertPrompt: () => {} });

  // 移动端单列堆叠（设计 60 画板的同构约定：放不下就折成一列）。
  assert.match(html, /grid-template-columns:1fr;/);
  assert.equal((html.match(/<button/g) ?? []).length, 4);
});
