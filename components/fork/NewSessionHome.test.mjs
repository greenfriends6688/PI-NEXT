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
  // fork:v5-landing —— 起始卡直接用画板 **D-01 帧 A** 的 .d-grid2 > .d-store-card 组件：
  // 封面图标 + 标题 + 描述 + 「一键填入」页脚，桌面端 2×2 列由 system.css 承担。
  assert.match(html, /d-grid2/);
  assert.equal((html.match(/d-store-card"/g) ?? []).length, 4);
  assert.equal((html.match(/d-store-cover/g) ?? []).length, 4);
  assert.equal((html.match(/d-store-foot/g) ?? []).length, 4);
});

test("falls back to the generic title without a cwd and stacks cards on mobile", () => {
  const html = render({ cwd: null, isMobile: true, onInsertPrompt: () => {} });

  // 移动端单列堆叠（设计 60 画板的同构约定：放不下就折成一列）。
  assert.match(html, /grid-template-columns:1fr;/);
  assert.equal((html.match(/<button/g) ?? []).length, 4);
});
