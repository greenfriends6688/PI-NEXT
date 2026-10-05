import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const {
  DEFAULT_EXPANDED_WIDGET_LINES,
  ExtensionWidgets,
  extensionWidgetSlot,
  formatExtensionWidgetContent,
  getNextExpandedWidgetKey,
  getUpdatedExtensionWidgetKeys,
  snapshotExtensionWidgetContents,
} = await jiti.import("./ExtensionWidgets.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function renderWidgets(props) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ExtensionWidgets, props),
    ),
  );
}

test("renders short extension widgets without a truncation marker", () => {
  const html = renderWidgets({
    widgets: [{ key: "short", lines: ["first", "second"], placement: "aboveEditor" }],
  });

  assert.match(html, /first\nsecond/);
  assert.doesNotMatch(html, /widget truncated/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /class="extension-widget-placement"[^>]*><i data-ico="chevron-up"/);
  assert.doesNotMatch(html, /[\u2191\u2193]/);
});

test("collapses long widgets by default", () => {
  const lines = Array.from(
    { length: 12 },
    (_, index) => `line-${index + 1}`,
  );
  const html = renderWidgets({
    widgets: [{ key: "long", lines, placement: "belowEditor" }],
  });

  assert.ok(lines.length > DEFAULT_EXPANDED_WIDGET_LINES);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /class="extension-widget-placement"[^>]*><i data-ico="chevron-down"/);
  assert.doesNotMatch(html, /<pre/);
  assert.doesNotMatch(html, /line-1/);
  assert.doesNotMatch(html, /line-10/);
  assert.doesNotMatch(html, /line-12/);
});

test("keeps all widget lines available for the scrollable expanded panel", () => {
  const lines = Array.from(
    { length: 12 },
    (_, index) => `line-${index + 1}`,
  );
  const content = formatExtensionWidgetContent(lines);

  assert.match(content, /line-10/);
  assert.match(content, /line-12/);
  assert.doesNotMatch(content, /widget truncated/);
});

test("keeps compact widgets expanded by default", () => {
  const lines = Array.from(
    { length: DEFAULT_EXPANDED_WIDGET_LINES },
    (_, index) => `line-${index + 1}`,
  );
  const html = renderWidgets({
    widgets: [{ key: "compact", lines, placement: "aboveEditor" }],
  });

  assert.match(html, /aria-expanded="true"/);
  // 展开面板 = v5 画板 D-02b 插件浮窗里的扩展 widget 卡：.d-card + .d-card-head + .d-card-body。
  assert.match(html, /class="extension-widget-panel d-card"/);
  assert.match(html, /class="d-card-head"/);
  assert.match(html, /<pre class="d-card-body/);
});

test("expands at most one compact widget", () => {
  const html = renderWidgets({
    widgets: [
      { key: "first", lines: ["one", "two"], placement: "aboveEditor" },
      { key: "second", lines: ["three", "four"], placement: "belowEditor" },
    ],
  });

  assert.equal((html.match(/aria-expanded="true"/g) ?? []).length, 1);
  assert.equal((html.match(/<section/g) ?? []).length, 1);
  assert.match(html, /aria-labelledby="[^"]*trigger-0"/);
  assert.doesNotMatch(html, /aria-labelledby="[^"]*trigger-1"/);
});

test("switching widgets closes the previously expanded widget", () => {
  assert.equal(getNextExpandedWidgetKey(null, "first"), "first");
  assert.equal(getNextExpandedWidgetKey("first", "second"), "second");
  assert.equal(getNextExpandedWidgetKey("second", "second"), null);
});

test("detects only existing widgets whose line content changed", () => {
  const previous = snapshotExtensionWidgetContents([
    { key: "changed", lines: ["one"], placement: "aboveEditor" },
    { key: "same", lines: ["ready"], placement: "belowEditor" },
    { key: "removed", lines: ["gone"], placement: "belowEditor" },
  ]);
  const next = snapshotExtensionWidgetContents([
    { key: "same", lines: ["ready"], placement: "aboveEditor" },
    { key: "changed", lines: ["one", "two"], placement: "belowEditor" },
    { key: "added", lines: ["new"], placement: "aboveEditor" },
  ]);

  assert.deepEqual(getUpdatedExtensionWidgetKeys(previous, next), ["changed"]);
  assert.deepEqual(getUpdatedExtensionWidgetKeys(null, next), []);
});

test("compares widget lines without delimiter collisions", () => {
  const previous = new Map([["status", ["one", "two"]]]);
  const next = new Map([["status", ["one\ntwo"]]]);

  assert.deepEqual(getUpdatedExtensionWidgetKeys(previous, next), ["status"]);
});

test("keeps one-line widgets compact but expandable", () => {
  const html = renderWidgets({
    widgets: [{ key: "single-line-widget", lines: ["ready"], placement: "belowEditor" }],
  });

  assert.match(html, /extension-widget-triggers/);
  // fork:design-components —— 方位指示改画板图标槽（下方 = chevron-down），
  // 不再是手绘的 8×6 三角 svg，也不许退回 ↑ ↓ 符号字形。
  assert.match(html, /class="extension-widget-placement"[^>]*><i data-ico="chevron-down"/);
  assert.doesNotMatch(html, /<svg/);
  assert.doesNotMatch(html, /[\u2191\u2193]/);
  assert.match(html, /Below editor widget/);
  assert.match(html, /<button[^>]*class="extension-widget-trigger/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /title="single-line-widget - Below editor widget - Expand"/);
  assert.match(html, /extension-widget-key/);
  assert.match(html, /extension-widget-update-pulse/);
  assert.doesNotMatch(html, /extension-widget-preview/);
  assert.doesNotMatch(html, /extension-widget-line-count/);
  assert.doesNotMatch(html, />ready</);
  assert.doesNotMatch(html, /<pre/);
});

test("keeps empty widgets non-interactive", () => {
  const html = renderWidgets({
    widgets: [{ key: "empty-widget", lines: [], placement: "aboveEditor" }],
  });

  assert.match(html, /<div class="extension-widget-trigger/);
  assert.doesNotMatch(html, /<button/);
  assert.doesNotMatch(html, /aria-expanded/);
  assert.match(html, /title="empty-widget - Above editor widget"/);
});

/* fork:v5-boards D-25 帧 C/D —— 扩展块的插槽语义 + 收放轨道（D-27 帧 D / D-29 帧 E）。 */
test("the widget slot comes from the extension's real placement", () => {
  assert.equal(extensionWidgetSlot("aboveEditor"), "chat.composer.top");
  assert.equal(extensionWidgetSlot("belowEditor"), "chat.list.end");

  const html = renderWidgets({
    widgets: [
      { key: "above", lines: ["one", "two"], placement: "aboveEditor" },
      { key: "below", lines: ["three", "four"], placement: "belowEditor" },
    ],
  });

  // 默认展开第一个（2 行 ≤ 3 行）：只有它标插槽名，另一个要展开才标。
  assert.equal((html.match(/class="d-slotname"/g) ?? []).length, 1);
  assert.match(html, /class="d-slotname">chat\.composer\.top</);
  // 帧 C 的「撞车怎么办」列 + 动作列 + 帧 D 的悬浮区都挂在真卡上。
  assert.match(html, /class="d-slotmark">/);
  assert.match(html, /class="d-slotact">/);
  assert.match(html, /d-slotoverlay/);
});

test("a widget panel rides the .d-row-x grid track, and an empty widget is a slot card", () => {
  const html = renderWidgets({
    widgets: [{ key: "compact", lines: ["one", "two"], placement: "aboveEditor" }],
  });
  // 展开 = is-open；轨道层永远在，裁掉溢出的是 .d-row-x-track。
  assert.match(html, /class="d-row-x is-open"/);
  assert.match(html, /class="d-row-x-track"/);
  assert.match(html, /class="extension-widget-panel d-card"/);

  const emptyHtml = renderWidgets({
    widgets: [{ key: "empty", lines: [], placement: "belowEditor" }],
  });
  assert.match(emptyHtml, /class="extension-widget-trigger d-slotcard"/);
});
