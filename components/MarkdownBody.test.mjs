import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MarkdownBody } = await jiti.import("./MarkdownBody.tsx");
const { normalizeDisplayMath } = await jiti.import("../lib/markdown.ts");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function renderMarkdown(markdown, props = {}) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(MarkdownBody, {
        cwd: "/home/me/project",
        onOpenFile() {},
        ...props,
      }, markdown),
    ),
  );
}

test("opens non-file markdown links in a safe new tab", () => {
  const html = renderMarkdown("[docs](https://example.com/docs)");

  assert.match(
    html,
    /<a (?=[^>]*href="https:\/\/example\.com\/docs")(?=[^>]*target="_blank")(?=[^>]*rel="noopener noreferrer")[^>]*>docs<\/a>/,
  );
  assert.doesNotMatch(html, /\snode=/);
});

test("keeps local file markdown links in the app", () => {
  const relativeHtml = renderMarkdown("[file](components/MarkdownBody.tsx)");
  const fileUrlHtml = renderMarkdown("[report](file:///home/me/project/report.html)");

  assert.match(relativeHtml, /<a href="components\/MarkdownBody\.tsx">file<\/a>/);
  assert.doesNotMatch(relativeHtml, /target=|rel=|\snode=/);
  assert.match(fileUrlHtml, /<a href="file:\/\/\/home\/me\/project\/report\.html">report<\/a>/);
  assert.doesNotMatch(fileUrlHtml, /target=|rel=|\snode=/);
});

test("keeps file URLs inert without an in-app file handler", () => {
  const html = renderMarkdown("[report](file:///home/me/project/report.html)", { onOpenFile: undefined });

  assert.match(html, /<a href="" target="_blank" rel="noopener noreferrer">report<\/a>/);
});

test("keeps single-tilde CJK numeric ranges literal instead of striking them", () => {
  const html = renderMarkdown("5~7U 保证金 × 100~200倍杠杆");

  assert.doesNotMatch(html, /<del>/);
  assert.match(html, /5~7U/);
  assert.match(html, /100~200倍/);
});

test("still renders double-tilde strikethrough", () => {
  const html = renderMarkdown("~~gone~~");

  assert.match(html, /<del>gone<\/del>/);
});

test("renders backslash-escaped backticks inside inline code", () => {
  const html = renderMarkdown("`AudioManager\\`1.cs`");

  assert.match(html, /<code[^>]*>AudioManager`1\.cs<\/code>/);
  assert.doesNotMatch(html, /<\/code>1\.cs`/);
});

test("renders LaTeX parenthesis delimiters as inline math", () => {
  const html = renderMarkdown(String.raw`射线为 \(r_c = K^{-1}p\)。`);

  // fork:design-components —— 画板 10:177 的 `.pw-math` 行内公式容器。
  // `katex` 必须同时留着：katex.min.css 的 370 条 `.katex .xxx` 规则靠它。
  assert.match(html, /<span class="katex pw-math">/);
  assert.match(html, /class="katex-mathml"/);
  assert.doesNotMatch(html, /pw-math block/);
  assert.match(html, /r_c/);
});

test("renders paired LaTeX bracket delimiters as display math", () => {
  const html = renderMarkdown(String.raw`\[
P(\lambda)=o_b+\lambda r_b
\]`);
  const oneLineHtml = renderMarkdown(String.raw`\[P(\lambda)=o_b+\lambda r_b\]`);

  // fork:design-components —— 画板 10:179 的 `.pw-math block` 块级公式容器。
  assert.match(html, /<span class="katex-display pw-math block">/);
  assert.match(html, /lambda/);
  assert.match(oneLineHtml, /<span class="katex-display pw-math block">/);
});

test("renders model-emitted bracket-only formula lines as display math", () => {
  const html = renderMarkdown(String.raw`平均一致性：

[ C(x) = \frac{2}{T(T-1)} \sum_{i<j} S(\hat{y}^{(i)}, \hat{y}^{(j)}) ]`);

  assert.match(html, /<span class="katex-display pw-math block">/);
  assert.match(html, /\\sum/);
});

test("leaves an unmatched LaTeX bracket delimiter unchanged", () => {
  const markdown = String.raw`before
\[
x + y
after`;

  assert.equal(normalizeDisplayMath(markdown), markdown);
});

test("does not normalize LaTeX delimiters inside Markdown code", () => {
  const markdown = "    \\(indented\\)\n\n`code\n\\(inline\\)`\n\n```text\n\\[\nfenced\n\\]\n```";

  assert.equal(normalizeDisplayMath(markdown), markdown);
});

test("does not normalize LaTeX delimiters inside raw HTML code", () => {
  const markdown = "<code>\\(inline\\)</code>\n\n<pre>\n\\(block\\)\n</pre>";

  assert.equal(normalizeDisplayMath(markdown), markdown);
});

test("does not normalize escaped delimiters or link destinations", () => {
  const escaped = String.raw`Literal: \\(x+y\\).`;
  const link = String.raw`[docs](https://example.com/\(manual\))`;

  assert.equal(normalizeDisplayMath(escaped), escaped);
  assert.equal(normalizeDisplayMath(link), link);
});

test("previews completed Mermaid diagrams by default", () => {
  const html = renderMarkdown("```mermaid\ngraph TD\n  A --> B\n```");

  assert.match(html, /mermaid-block-loading/);
  assert.match(html, />Source</);
  assert.doesNotMatch(html, /A --&gt; B/);
});

test("keeps Mermaid source visible while the response is streaming", () => {
  const html = renderMarkdown("```mermaid\ngraph TD\n  A --> B\n```", { isStreaming: true });

  assert.doesNotMatch(html, /mermaid-block-loading/);
  assert.match(html, />Preview</);
  assert.match(html, /A --&gt; B/);
});

test("opens markdown images in the shared image preview", () => {
  const localHtml = renderMarkdown("![chart](docs/tmp/chart.png)");
  const remoteHtml = renderMarkdown("![logo](https://example.com/logo.png)");

  assert.match(localHtml, /<button[^>]+aria-label="Preview image: chart"[^>]*>/);
  assert.match(localHtml, /<img[^>]+src="\/api\/files\/home\/me\/project\/docs\/tmp\/chart\.png\?type=read"/);
  assert.match(localHtml, /<img[^>]+alt="chart"/);
  assert.match(remoteHtml, /<button[^>]+aria-label="Preview image: logo"[^>]*>/);
  assert.match(remoteHtml, /<img[^>]+src="https:\/\/example\.com\/logo\.png"/);
});

test("keeps linked markdown images as links instead of nested preview buttons", () => {
  const html = renderMarkdown("[![diagram](docs/tmp/diagram.png)](https://example.com/docs)");

  assert.match(
    html,
    /<a (?=[^>]*href="https:\/\/example\.com\/docs")(?=[^>]*target="_blank")[^>]*>/,
  );
  assert.match(html, /<img[^>]+alt="diagram"/);
  assert.doesNotMatch(html, /<a[^>]*>[\s\S]*<button/);
  assert.doesNotMatch(html, /<button[^>]*>[\s\S]*<\/a>/);
});

test("uses a generic preview label when a markdown image has no alt text", () => {
  const html = renderMarkdown("![](https://example.com/shot.png)");

  assert.match(html, /<button[^>]+aria-label="Preview image"[^>]*>/);
  assert.doesNotMatch(html, /Preview image:/);
});

test("fork:design-components — 助手正文容器是画板 10 的 .pw-md", () => {
  const html = renderMarkdown("正文");

  assert.match(html, /^<div class="pw-md">/);
  assert.doesNotMatch(html, /markdown-body/);
  assert.doesNotMatch(html, /\snode=/);
});

test("fork:design-components — 行内代码是画板 10:110 的裸 <code>", () => {
  const html = renderMarkdown("用 `useResizablePanel` 包一层");

  assert.match(html, /<code>useResizablePanel<\/code>/);
  assert.doesNotMatch(html, /markdown-inline-code/);
  assert.doesNotMatch(html, /\snode=/);
});

test("fork:design-components — 引用块用画板 10 的 .pw-quote", () => {
  const html = renderMarkdown("> 注：这一行是引用");

  assert.match(html, /<blockquote class="pw-quote">/);
  assert.doesNotMatch(html, /\snode=/);
});

test("fork:design-components — 任务清单是画板 10 的 .pw-tasklist + .box.done", () => {
  const html = renderMarkdown("- [x] 已完成\n- [ ] 未完成");

  assert.match(html, /<ul class="pw-tasklist">/);
  assert.match(html, /<li class="done"><span class="box done">/);
  assert.match(html, /<span class="box"><\/span>/);
  assert.doesNotMatch(html, /contains-task-list|task-list-item/);
  assert.doesNotMatch(html, /<input/);
  assert.doesNotMatch(html, /\snode=/);
});

test("fork:design-components — 松散任务列表项也能挂上 .box.done", () => {
  // GFM 在松散项里把 checkbox 包进首个 <p>，且 <p> 前面还跟着一个换行文本节点。
  const html = renderMarkdown("- [x] done item\n\n  more text\n");

  assert.match(html, /<ul class="pw-tasklist">/);
  assert.match(html, /<li class="done">/);
  assert.match(html, /<span class="box done">/);
  assert.doesNotMatch(html, /<input/);
});

test("fork:design-components — 代码围栏是画板 10 的 .pw-code 卡片", () => {
  const html = renderMarkdown("```ts\nconst x = 1;\n```");

  assert.match(html, /<div class="pw-code">/);
  assert.match(html, /<div class="pw-code-head">/);
  assert.match(html, /<i data-ico="file-code" data-size="13">/);
  assert.match(html, /<span class="pw-mono">ts<\/span>/);
  assert.match(html, /<button type="button" class="pw-btn sm">/);
  assert.match(html, /<i data-ico="copy" data-size="13">/);
  assert.match(html, /<pre class="pw-code-body">/);
  assert.doesNotMatch(html, /markdown-code-/);
  assert.doesNotMatch(html, /style="/);
});

test("fork:design-components — 流式中的代码块同样是 .pw-code 卡片", () => {
  const html = renderMarkdown("```ts\nconst x = 1;\n```", { isStreaming: true });

  assert.match(html, /<div class="pw-code">/);
  assert.match(html, /<pre class="pw-code-body">const x = 1;<\/pre>/);
  assert.doesNotMatch(html, /markdown-code-/);
});

test("fork:design-components — GFM 表格仍是画板 10 的 .pw-table", () => {
  const html = renderMarkdown("| a | b |\n| - | - |\n| 1 | 2 |");

  assert.match(html, /<table class="pw-table">/);
});
