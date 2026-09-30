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

test("fork:design-system —— frontmatter 是画板 52 B 段的 pw-card：壳头 + pw-kv 键值表", () => {
  const html = render({ name: "zhaobiao-extract", description: "把招投标 Excel 逐条抽取 15 个字段" });

  assert.match(html, /^<div class="markdown-frontmatter pw-card">/, "外层是画板的 .pw-card");
  assert.match(html, /<div class="pw-card-head">/, "壳头是 .pw-card-head");
  assert.match(
    html,
    /<span class="pw-ico pw-dim"><i data-ico="braces" data-size="13"><\/i><\/span><span class="pw-mono pw-dim"[^>]*>frontmatter<\/span>/,
    "壳头是 braces 图标 + 等宽「frontmatter」小标题（画板 52 B 段逐字）",
  );
  assert.match(html, /<div class="pw-card-body"/, "正文块是 .pw-card-body");
  assert.match(html, /<dl class="markdown-frontmatter-rows pw-kv"/, "键值表是画板的 .pw-kv");
  assert.match(html, /grid-template-columns:110px minmax\(0, 1fr\)/, "键列宽 110px（画板 52 B 段的值）");
  assert.match(html, /<dt>name<\/dt><dd>zhaobiao-extract<\/dd>/, "键值行仍然是 dt / dd");
});

test("keeps title, tags and URL rendering behavior", () => {
  const html = render({
    title: "招标改",
    tags: ["招投标", "excel"],
    homepage: "https://example.com/spec",
  });

  assert.match(html, /<div class="markdown-frontmatter-title">招标改<\/div>/);
  assert.match(html, /<span class="markdown-frontmatter-tag pw-badge">招投标<\/span>/);
  assert.match(html, /<span class="markdown-frontmatter-tag pw-badge">excel<\/span>/);
  assert.match(
    html,
    /<dd><a href="https:\/\/example\.com\/spec" target="_blank" rel="noopener noreferrer">https:\/\/example\.com\/spec<\/a><\/dd>/,
    "URL 值仍然渲染成新标签页链接",
  );
  // title / tags 一旦单独成行，就不再在键值表里重复一次。
  assert.doesNotMatch(html, /<dt>title<\/dt>/);
  assert.doesNotMatch(html, /<dt>tags<\/dt>/);
});

test("carries no hand-drawn SVG", () => {
  assert.doesNotMatch(source, /<svg/);
});
