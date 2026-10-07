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

test("one card per starter, and no empty-state title", () => {
  const html = render({ cwd: "/Users/me/projects/pi-web", isMobile: false, onInsertPrompt: () => {} });

  // 空态标题（「在 pi-web 里做点什么？」）2026-10-07 用户裁定去掉，连同它读的
  // `cwd` basename —— 现在这一块只剩品牌行 + 一句提示 + 四张起步卡。
  assert.doesNotMatch(html, /pi-web/);
  assert.doesNotMatch(html, /d-empty-t/);
  assert.equal((html.match(/<button/g) ?? []).length, 4);
  // fork:v5-landing-frame —— 起步卡直接用画板 **D-01 帧 D** 的网格与卡片：
  // `.d-cardgrid`（`auto-fill` + 220px 下限，窄栏自己塌成一列）› `button.d-setcard`
  // （图标 + `.d-set-row-t` 标题 + `.d-set-row-s` 一句说明 + 行尾 `zap`）。
  // 旧的 `.d-grid2` › `.d-store-card` 是插件商店的件，已退役。
  assert.match(html, /class="d-cardgrid/);
  assert.equal((html.match(/class="d-setcard"/g) ?? []).length, 4);
  assert.equal((html.match(/class="d-set-row-t"/g) ?? []).length, 4);
  assert.equal((html.match(/class="d-set-row-s"/g) ?? []).length, 4);
  assert.doesNotMatch(html, /d-store-card|d-grid2/);
});

test("stacks cards on mobile without an inline column override", () => {
  const html = render({ cwd: null, isMobile: true, onInsertPrompt: () => {} });

  // 单列堆叠不再靠内联 `gridTemplateColumns: "1fr"`：`.d-cardgrid` 的
  // `repeat(auto-fill, minmax(220px, 1fr))` 在窄栏（手机 390 / 开了右栏的桌面）
  // 自然只有一列 —— 所以断言的是容器类，而不是一条会压住 CSS 的内联几何。
  assert.match(html, /class="d-cardgrid/);
  assert.doesNotMatch(html, /grid-template-columns/);
  assert.equal((html.match(/<button/g) ?? []).length, 4);
});
