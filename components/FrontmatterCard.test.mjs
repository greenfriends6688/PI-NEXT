import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { FrontmatterCard } = await jiti.import("./FrontmatterCard.tsx");

const source = await readFile(new URL("./FrontmatterCard.tsx", import.meta.url), "utf8");

const render = (data) => renderToStaticMarkup(React.createElement(FrontmatterCard, { data }));

test("renders nothing without data", () => {
  assert.equal(render(null), "");
  assert.equal(render({}), "");
});

test("fork:v5-landing —— frontmatter 是画板 D-06b 帧 B 的 d-card：壳头 + d-kv-row 键值行", () => {
  const html = render({ name: "zhaobiao-extract", description: "把招投标 Excel 逐条抽取 15 个字段" });

  assert.match(html, /^<div class="markdown-frontmatter d-card">/, "外层是画板的 .d-card");
  assert.match(html, /<div class="d-card-head">/, "壳头是 .d-card-head");
  assert.match(
    html,
    /<i data-ico="braces" data-size="14"><\/i><span class="d-grow d-mono d-t-sm">frontmatter<\/span>/,
    "壳头是 braces 图标 + .d-grow.d-mono.d-t-sm「frontmatter」小标题（画板 D-06b 帧 B 逐字）",
  );
  assert.match(html, /<div class="d-card-body d-col"/, "正文块是 .d-card-body.d-col");
  assert.match(html, /<div class="markdown-frontmatter-rows d-col">/, "键值表容器");
  assert.match(
    html,
    /<div class="markdown-frontmatter-row d-kv-row"><span>name<\/span><span>zhaobiao-extract<\/span><\/div>/,
    "键值行是 .d-kv-row / span",
  );
});

test("keeps title, tags and URL rendering behavior", () => {
  const html = render({
    title: "招标改",
    tags: ["招投标", "excel"],
    homepage: "https://example.com/spec",
  });

  assert.match(html, /<div class="d-t-b">招标改<\/div>/);
  assert.match(html, /<div class="d-tags"><span class="d-badge mute">招投标<\/span><span class="d-badge mute">excel<\/span><\/div>/);
  assert.match(
    html,
    /<span><a href="https:\/\/example\.com\/spec" target="_blank" rel="noopener noreferrer">https:\/\/example\.com\/spec<\/a><\/span>/,
    "URL 值仍然渲染成新标签页链接",
  );
  // title / tags 一旦单独成行，就不再在键值表里重复一次。
  assert.doesNotMatch(html, /<span>title<\/span>/);
  assert.doesNotMatch(html, /<span>tags<\/span>/);
});

test("fork:v5-wave-n1 —— 布尔值给中性徽章（画板 D-06b 帧 B 那一格）", () => {
  const html = render({ agent_created: false, enabled: true });

  assert.match(
    html,
    /<div class="markdown-frontmatter-row d-kv-row"><span>agent_created<\/span><span><span class="d-badge mute">false<\/span><\/span><\/div>/,
    "布尔值走 .d-badge.mute，而不是裸文本",
  );
  assert.match(html, /<span>enabled<\/span><span><span class="d-badge mute">true<\/span><\/span>/);
});

test("carries no hand-drawn SVG", () => {
  assert.doesNotMatch(source, /<svg/);
});
