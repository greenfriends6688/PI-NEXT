import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { MermaidBlock, CodeBlock, downloadMermaidSvg } = await jiti.import("./MermaidBlock.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

// Simple sequenceDiagram for testing
const mermaidSrc = `sequenceDiagram
    Alice->>Bob: Hello
    Bob-->>Alice: Hi`;

function renderMermaid(props) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(MermaidBlock, props),
    ),
  );
}

test("MermaidBlock renders source by default", () => {
  const html = renderMermaid({ code: mermaidSrc });

  assert.match(html, />Preview</);
  assert.match(html, /Alice/);
  assert.doesNotMatch(html, /mermaid-block-loading/);
});

test("MermaidBlock can render preview by default", () => {
  const html = renderMermaid({ code: mermaidSrc, defaultPreview: true });

  assert.match(html, />Source</);
  assert.match(html, /mermaid-block-loading/);
  assert.doesNotMatch(html, /Alice/);
});

test("MermaidBlock with isStreaming falls back to source view", () => {
  const html = renderMermaid({ code: mermaidSrc, isStreaming: true, defaultPreview: true });

  assert.match(html, /disabled/);
  assert.match(html, />Preview</);
  assert.match(html, /Alice/);
  assert.match(html, /-&gt;&gt;/);
});

test("MermaidBlock renders empty graph without error", () => {
  const html = renderMermaid({ code: "graph TD", defaultPreview: true });

  assert.doesNotMatch(html, /mermaid-block-error/);
  assert.match(html, /mermaid-block-loading/);
});

function renderCode(props) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(CodeBlock, props),
    ),
  );
}

test("CodeBlock renders code without waiting for the lazy highlighter chunk", () => {
  // fork:perf-highlighter — Prism (with every language) lives in its own chunk loaded
  // on demand, so the first render of a code block is plain monospace. This is the
  // contract the tests can see statically: the code is there, the tokens are not.
  const html = renderCode({ code: "const x = 1;", lang: "javascript" });

  assert.doesNotMatch(html, /class="token/);
  assert.match(html, /const x = 1;/);
});

test("CodeBlock loads the highlighter lazily instead of bundling it", () => {
  const source = readFileSync(new URL("./MermaidBlock.tsx", import.meta.url), "utf8");
  const lazy = readFileSync(new URL("./useLazyHighlighter.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /^import .*react-syntax-highlighter/m);
  assert.match(lazy, /dynamic\(\(\) => import\("\.\/AsyncCodeHighlighter"\)/);

  const highlighter = readFileSync(new URL("./AsyncCodeHighlighter.tsx", import.meta.url), "utf8");
  // Themes one file at a time: the `styles/prism` barrel re-exports ~200 of them.
  assert.match(highlighter, /styles\/prism\/vs"/);
  assert.match(highlighter, /styles\/prism\/vsc-dark-plus"/);
  assert.doesNotMatch(highlighter, /styles\/prism"/);
});

test("CodeBlock renders plain text without tokenization while streaming", () => {
  const html = renderCode({ code: "const x = 1;", lang: "javascript", isStreaming: true });

  assert.doesNotMatch(html, /class="token/);
  assert.match(html, /const x = 1;/);
});

test("fork:design-components — CodeBlock 是画板 10 的 .pw-code 卡片", () => {
  const html = renderCode({ code: "const x = 1;", lang: "ts" });

  assert.match(html, /<div class="pw-code">/);
  assert.match(html, /<div class="pw-code-head">/);
  assert.match(html, /<i data-ico="file-code" data-size="13">/);
  assert.match(html, /<span class="pw-mono">ts<\/span>/);
  assert.match(html, /<span class="grow"><\/span>/);
  assert.match(html, /<button type="button" class="pw-btn sm">/);
  assert.match(html, /<pre class="pw-code-body">/);
  // 卡片上不许再留 markdown-* 自有类，也不许有内联视觉值。
  assert.doesNotMatch(html, /markdown-/);
  assert.doesNotMatch(html, /style="/);
});

test("fork:design-components — 复制钮在成功后换成 check 图标（与画板 10:156 一致）", () => {
  const source = readFileSync(new URL("./MermaidBlock.tsx", import.meta.url), "utf8");

  assert.match(source, /<i data-ico=\{copied \? "check" : "copy"\} data-size="13">/);
  assert.match(source, /copied \? t\("i18n\.copied"\) : t\("i18n\.copy"\)/);
});

test("fork:design-components — Mermaid 图形态的头也是 .pw-code-head", () => {
  const html = renderMermaid({ code: mermaidSrc, defaultPreview: true });

  assert.match(html, /<div class="pw-code">/);
  assert.match(html, /<div class="pw-code-head">/);
  assert.match(html, /<i data-ico="git-fork" data-size="13">/);
  assert.match(html, /<span class="pw-mono">mermaid<\/span>/);
  assert.match(html, /<i data-ico="code" data-size="13">/);
  assert.doesNotMatch(html, /markdown-/);
});

test("fork:design-components — 缩放器工具条用 lucide data-ico，不再手绘 svg", () => {
  const source = readFileSync(new URL("./MermaidBlock.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(source, /<svg/);
  // 画板 10 帧 C：缩放器里 minus/plus 是 13，右侧 maximize-2 / x 是 14。
  for (const name of ["minus", "plus"]) {
    assert.match(source, new RegExp(`<i data-ico="${name}" data-size="13">`));
  }
  for (const name of ["maximize-2", "x"]) {
    assert.match(source, new RegExp(`<i data-ico="${name}" data-size="14">`));
  }
  assert.match(source, /className="pw-modal"/, "缩放查看器挂画板 .pw-modal 壳");
  assert.match(source, /className="pw-card-foot"/, "脚注是画板 .pw-card-foot");
});

test("fork:design-components — 高亮 token 映射到画板 10 的 .pw-tok-* 分层", async () => {
  const { default: AsyncCodeHighlighter } = await jiti.import("./AsyncCodeHighlighter.tsx");
  const html = renderToStaticMarkup(
    React.createElement(AsyncCodeHighlighter, { language: "javascript" }, "const x = 1;\n// note"),
  );

  assert.match(html, /<pre class="pw-code-body">/);
  assert.match(html, /<span class="ln">1<\/span>/);
  assert.match(html, new RegExp('class="pw-tok-key">const<'));
  assert.match(html, new RegExp('class="pw-tok-num">1<'));
  assert.match(html, new RegExp('class="pw-tok-com">// note<'));
  // 不许残留 RSH 的 prismjs 类、内联色或 token 类。
  assert.doesNotMatch(html, /prismjs/);
  assert.doesNotMatch(html, /class="token/);
  assert.doesNotMatch(html, /style="/);
});

test("MermaidBlock handles Chinese characters in diagram", () => {
  const chineseMermaid = `sequenceDiagram
    participant PC as PC客户端
    PC->>SV: 请求登录`;

  const html = renderMermaid({ code: chineseMermaid, defaultPreview: true });

  assert.doesNotMatch(html, /mermaid-block-error/);
  assert.match(html, /mermaid-block/);
});

test("downloadMermaidSvg downloads XML-serialized SVG and releases its URL", async () => {
  const originalDocument = globalThis.document;
  const originalXMLSerializer = globalThis.XMLSerializer;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const svgElement = { nodeName: "svg" };
  const serializedSvg = '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">first<br />second</div></foreignObject></svg>';
  const link = { href: "", download: "", clicked: false, click() { this.clicked = true; } };
  let downloadedBlob;
  globalThis.document = { createElement: () => link };
  globalThis.XMLSerializer = class {
    serializeToString(element) {
      assert.equal(element, svgElement);
      return serializedSvg;
    }
  };
  URL.createObjectURL = (blob) => {
    assert.equal(blob.type, "image/svg+xml;charset=utf-8");
    downloadedBlob = blob;
    return "blob:mermaid";
  };
  let revoked = null;
  URL.revokeObjectURL = (url) => { revoked = url; };

  try {
    downloadMermaidSvg(svgElement);
    assert.equal(await downloadedBlob.text(), serializedSvg);
    assert.equal(link.href, "blob:mermaid");
    assert.equal(link.download, "mermaid-diagram.svg");
    assert.equal(link.clicked, true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(revoked, "blob:mermaid");
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalXMLSerializer === undefined) delete globalThis.XMLSerializer;
    else globalThis.XMLSerializer = originalXMLSerializer;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});
