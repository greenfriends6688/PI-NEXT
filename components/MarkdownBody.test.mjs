import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MarkdownBody } = await jiti.import("./MarkdownBody.tsx");
const { markdownPreviewRehypePlugins, markdownPreviewRemarkPlugins, normalizeDisplayMath } = await jiti.import("../lib/markdown.ts");
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

test("fork:fix-user-line-breaks — 只有 keepLineBreaks 才把行尾变成 <br>（#680 / #1015）", () => {
  assert.match(renderMarkdown("one\ntwo"), /<p>one\ntwo<\/p>/);
  assert.doesNotMatch(renderMarkdown("one\ntwo"), /<br/);

  for (const markdown of ["one\ntwo", "one\r\ntwo", "one\rtwo", "one   \t\n   two"]) {
    assert.match(renderMarkdown(markdown, { keepLineBreaks: true }), /<p>one<br\/>two<\/p>/, JSON.stringify(markdown));
  }
});

test("fork:fix-user-line-breaks — 紧列表项与标题里的换行也保留", () => {
  const ordered = renderMarkdown("1. 看门狗的原理是（ ）\nA. 监控温度\nB. 计数器\n2. 下一题", { keepLineBreaks: true });
  const nested = renderMarkdown("- outer\n  more\n  - inner\n- next", { keepLineBreaks: true });
  const heading = renderMarkdown("Heading one\nheading two\n===", { keepLineBreaks: true });

  assert.match(ordered, /<li>看门狗的原理是（ ）<br\/>A\. 监控温度<br\/>B\. 计数器<\/li>/);
  assert.match(ordered, /<li>下一题<\/li>/);
  // 嵌套列表前那个换行分隔的是块，不该变成 <br>。
  assert.match(nested, /<li>outer<br\/>more\n<ul>\n<li>inner<\/li>/);
  assert.match(heading, /<h1>Heading one<br\/>heading two<\/h1>/);
  assert.doesNotMatch(renderMarkdown("- alpha\n\n- beta", { keepLineBreaks: true }), /<br/);
});

test("fork:fix-user-line-breaks — 硬换行只渲染一次", () => {
  // remark-rehype 把 mdast break 写成 <br> 加一个 "\n"，pre-wrap 会把后者再渲染一遍。
  const html = renderMarkdown("trailing spaces  \nbackslash\\\nend", { keepLineBreaks: true });

  assert.match(html, /<p>trailing spaces<br\/>backslash<br\/>end<\/p>/);
});

test("fork:fix-user-line-breaks — 代码与公式的行尾原样保留", () => {
  const code = renderMarkdown("```\nfirst\nsecond\n```", { keepLineBreaks: true });
  const math = renderMarkdown("$$\nx = 1\ny = 2\n$$", { keepLineBreaks: true });
  const emphasis = renderMarkdown("*one\ntwo* `a b`", { keepLineBreaks: true });

  assert.doesNotMatch(code, /<br/);
  assert.match(code, /first[\s\S]*\n[\s\S]*second/);
  assert.doesNotMatch(math, /<br/);
  assert.match(math, /<annotation encoding="application\/x-tex">x = 1\ny = 2<\/annotation>/);
  assert.match(emphasis, /<em>one<br\/>two<\/em>/);
});

test("fork:fix-user-line-breaks — 打开 raw-text 标签的块保持默认渲染", () => {
  // 未闭合的 <textarea> / <script> 后面跟一个 <br> 会提前结束 rehype-raw 的
  // raw-text 状态，整块内容要么被粘在一起要么直接消失。
  for (const markdown of [
    "Use a <textarea> here\nand a button\nplease",
    "Set <title>My\nPage</title> first\nthen deploy",
    "add <script>a()\nb()</script> to the page\nthen reload",
    "some *<style>x\ny</style>* then\nnext",
  ]) {
    assert.equal(renderMarkdown(markdown, { keepLineBreaks: true }), renderMarkdown(markdown));
  }

  assert.match(renderMarkdown("normal <kbd>Ctrl</kbd>\nline two", { keepLineBreaks: true }), /<\/kbd><br\/>line two/);
  const list = renderMarkdown("- item <textarea>\n  more\n- two\n  lines", { keepLineBreaks: true });
  assert.match(list, /<li>two<br\/>lines<\/li>/);
});

test("fork:cjk-autolink — 紧跟 URL 的中文标点不再被吞进链接（#971 / #972）", () => {
  const html = renderMarkdown("开 http://localhost:4321，或直接开 library/x.png。");

  assert.match(html, /<a (?=[^>]*href="http:\/\/localhost:4321")[^>]*>http:\/\/localhost:4321<\/a>/);
  assert.match(html, /<\/a>，或直接开 library\/x\.png。/);
  assert.doesNotMatch(html, /%EF%BC%8C/);
});

test("fork:cjk-autolink — 行尾的中文句号停在链接外", () => {
  const html = renderMarkdown("见 https://example.com/docs。");

  assert.match(html, /<a (?=[^>]*href="https:\/\/example\.com\/docs")[^>]*>https:\/\/example\.com\/docs<\/a>/);
  assert.match(html, /<\/a>。/);
});

test("fork:cjk-autolink — 显式链接、CJK 路径与查询串原样保留（#971 / #972）", () => {
  const explicit = renderMarkdown("[文档](https://example.com/docs)，说明");
  assert.match(explicit, /<a (?=[^>]*href="https:\/\/example\.com\/docs")[^>]*>文档<\/a>/);
  assert.match(explicit, /<\/a>，说明/);

  const cjkPath = renderMarkdown("https://zh.wikipedia.org/wiki/中文条目");
  assert.match(cjkPath, /href="https:\/\/zh\.wikipedia\.org\/wiki\/%E4%B8%AD%E6%96%87%E6%9D%A1%E7%9B%AE"/);

  const query = renderMarkdown("https://a.com/p?a=1&b=2，后面");
  assert.match(query, /href="https:\/\/a\.com\/p\?a=1&amp;b=2"/);
  assert.match(query, /<\/a>，后面/);
});

test("fork:currency-math — 段落换行两侧的价格与粗体标题都保住（#976）", () => {
  const html = renderMarkdown("**3. Membership — $20/mo (+tax)**\nOne free hour monthly. Waives the $6 activation fee.\n→ https://example.com/pricing");

  assert.match(html, /<strong>3\. Membership — \$20\/mo \(\+tax\)<\/strong>/);
  assert.match(html, /One free hour monthly\. Waives the \$6 activation fee\./);
  assert.match(html, /href="https:\/\/example\.com\/pricing"/);
  assert.doesNotMatch(html, /class="katex|\*\*/);
});

test("fork:currency-math — 相邻金额、区间与小数都算货币（#976）", () => {
  for (const prices of ["$15+$15", "$20–$30", "$1,200.50 or $900.00", "**$20** and *$6*", "US$20 / CA$30"]) {
    const html = renderMarkdown(prices);
    assert.doesNotMatch(html, /class="katex/, prices);
    assert.equal((html.match(/\$/g) ?? []).length, 2, prices);
  }
});

test("fork:currency-math — 价格不会把同段里后面的公式吞掉（#976）", () => {
  const html = renderMarkdown("Pay $20 for the $x + 1$ option, or $30 for $2x + 3$.");

  assert.match(html, /Pay \$20 for the/);
  assert.match(html, /or \$30 for/);
  assert.equal((html.match(/class="katex pw-math"/g) ?? []).length, 2);
  assert.match(html, /<annotation encoding="application\/x-tex">x \+ 1<\/annotation>/);
  assert.match(html, /<annotation encoding="application\/x-tex">2x \+ 3<\/annotation>/);
});

test("fork:currency-math — 真正的单美元公式仍照常渲染（#976）", () => {
  for (const math of ["$x + y$", "$2 + 2 = 4$", "$20$", "$ x + y $", "$x $", "$ x$", "$x$2", "$x +\ny$", "$$x + y$$"]) {
    const html = renderMarkdown(math);
    assert.match(html, /class="katex/, math);
    assert.doesNotMatch(html, /katex-error/, math);
  }
});

test("fork:currency-math — 文件预览与缩略图用同一套货币安全规则（#976）", () => {
  const html = renderToStaticMarkup(React.createElement(ReactMarkdown, {
    remarkPlugins: markdownPreviewRemarkPlugins,
    rehypePlugins: markdownPreviewRehypePlugins,
  }, "**Price: $20/month**\nPlus a $6 fee. Formula: $2 + 2 = 4$."));
  assert.match(html, /<strong>Price: \$20\/month<\/strong>/);
  assert.match(html, /Plus a \$6 fee/);
  // 预览链路不走 MarkdownBody 的 span 渲染器，类名就是 rehype-katex 的原样输出。
  assert.equal((html.match(/class="katex"/g) ?? []).length, 1);
});

test("fork:currency-math — 转义货币、代码与链接目标原样保留（#976）", () => {
  const html = renderMarkdown("Prices: \\$20 and \\$6. Code: `$20 + $6`. [Price](https://example.com/$20/$6)");
  assert.doesNotMatch(html, /class="katex/);
  assert.match(html, /Prices: \$20 and \$6\./);
  assert.match(html, /<code[^>]*>\$20 \+ \$6<\/code>/);
  assert.match(html, /href="https:\/\/example\.com\/\$20\/\$6"/);
  const fenced = renderMarkdown("```text\n$20 + $6\n```");
  assert.doesNotMatch(fenced, /class="katex/);
});

test("fork:currency-math — 货币文本照常过 HTML / URL 消毒（#976）", () => {
  const html = renderMarkdown('$20 <img src="x" onerror="alert(1)"> $6 [click](javascript:alert(1))');
  assert.doesNotMatch(html, /onerror|javascript:|class="katex/);
  assert.match(html, /\$20/);
  assert.match(html, /\$6/);
});

// fork:proma-34-mention —— 图片文件的 mention 芯片可点开 ImagePreview 灯箱。
test("image file mentions render as a preview chip; other mentions stay plain spans", () => {
  const html = renderMarkdown("看 @assets/logo.ico 和 @src/chat.tsx", {
    highlightMentions: true,
    mentionValidators: { fileExists: () => true },
  });

  // 图片 chip：带 data-mention-previewable，且被预览触发按钮包住（灯箱打开时才渲染 <img>，
  // SSR 里只看得到按钮与 aria-label）。
  assert.match(html, /data-mention-previewable="true"/);
  assert.match(html, /aria-label="Preview image: assets\/logo\.ico"/);
  assert.match(html, /<button[^>]*><span[^>]*data-mention-previewable="true"[^>]*>@assets\/logo\.ico<\/span><\/button>/);
  // 非图片 mention 不挂预览属性，仍是裸 span。
  const nonPreviewable = html.split("data-mention-value=\"src/chat.tsx\"")[0];
  assert.ok(!/data-mention-value="src\/chat\.tsx"[^>]*data-mention-previewable/.test(html));
  assert.match(nonPreviewable, /pw-tok-ref/);
});

// fork:table-wrap-2026-10-02 —— 表格填满容器，不再按最长一格定宽（否则 CJK 长句把整张
// 表撑出容器、其余行留下一大片空白，见 app/globals.css 同名注释里的实测数字）。
test("GFM tables fill the scroll container instead of sizing to the longest cell", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.markdown-table-wrap > table \{ width: 100%; \}/);
  assert.doesNotMatch(css, /\.markdown-table-wrap > table \{ width: max-content; \}/);
  // 外层仍负责真的装不下时的横滚（列多的表格）。
  assert.match(css, /\.markdown-table-wrap \{[\s\S]*?overflow-x: auto;/);

  // 渲染层：两列表仍然是两个 th + 每行两个 td（之前那个空白块不是渲染出来的）。
  const html = renderMarkdown("| 端口 | 状态 |\n|---|---|\n| 30155 | 已关 |\n| 30141 | 长句子 |");
  assert.equal((html.match(/<th[\s>]/g) ?? []).length, 2); // 不含 <thead>
  assert.equal((html.match(/<td[^>]*>/g) ?? []).length, 4);
});
