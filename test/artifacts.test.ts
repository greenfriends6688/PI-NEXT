import test from "node:test";
import assert from "node:assert/strict";
import {
  ARTIFACT_FENCE,
  collectArtifacts,
  encodeArtifactsForMarkdown,
  parseArtifacts,
  shouldInlineArtifact,
} from "../src/shared/artifacts.ts";

/**
 * The directive is a line scanner, and these are the shapes a real reply arrives in: the
 * closed one, the one still streaming, the Markdown artifact that nests a fence of its own,
 * and the one a model wrote without the closing `:::` at all.
 *
 * The rule that matters most is the negative one: an unclosed artifact is **not** an artifact.
 * A half-written page drawn as a page is worse than the source that will become it.
 */

const closed = `Here is the chart:

:::artifact{identifier="revenue" type="html" title="Revenue by month"}
\`\`\`html
<canvas id="c"></canvas>
<script>draw()</script>
\`\`\`
:::

And that is it.`;

test("a closed directive is one artifact, and the prose around it stays put", () => {
  const found = parseArtifacts(closed);
  assert.equal(found.length, 1);
  assert.deepEqual(
    { ...found[0]!.artifact, version: undefined },
    {
      identifier: "revenue",
      title: "Revenue by month",
      type: "html",
      language: "html",
      body: '<canvas id="c"></canvas>\n<script>draw()</script>',
      version: undefined,
    },
  );
  assert.equal(found[0]!.line, 2);
});

test("an artifact still being written is source, not a page", () => {
  // The directive alone, with the fence still open: this is a reply mid-stream, and drawing
  // a half-written page is worse than showing the code that will become it.
  assert.deepEqual(parseArtifacts(`:::artifact{identifier="x" type="html"}\n\`\`\`html\n<p>still writing`), []);
  assert.deepEqual(parseArtifacts(`:::artifact{identifier="x"}`), []);
  assert.deepEqual(parseArtifacts("no directive here"), []);
  assert.deepEqual(parseArtifacts(":::artifact{identifier=\"x\"}\nnot a fence\n:::"), []);
});

test("a markdown artifact may nest a fence of its own at the same length", () => {
  const text = [
    ':::artifact{identifier="guide" type="markdown" title="Guide"}',
    "```markdown",
    "# Guide",
    "",
    "```js",
    "console.log(1)",
    "```",
    "```",
    ":::",
  ].join("\n");
  const found = parseArtifacts(text);
  assert.equal(found.length, 1);
  // The fence that ends it is the one followed by `:::`, not the nested one.
  assert.equal(found[0]!.artifact.body, "# Guide\n\n```js\nconsole.log(1)\n```");
  assert.equal(found[0]!.artifact.type, "markdown");
});

test("the closing `:::` may be missing: the fence itself ends it", () => {
  // Once the inner fence has closed the content is complete; only the trailer is missing, so
  // there is a page to draw and the reader should get it rather than the source.
  const text = ':::artifact{identifier="x" type="svg"}\n```svg\n<svg/>\n```\n\nAfter.';
  const found = parseArtifacts(text);
  assert.equal(found.length, 1);
  assert.equal(found[0]!.artifact.body, "<svg/>");
  assert.equal(found[0]!.endLine, 4);
  // A `:::` that follows anyway is consumed with the artifact, not left in the prose.
  const withTrailer = parseArtifacts(':::artifact{identifier="x" type="svg"}\n```svg\n<svg/>\n```\n:::\nAfter.');
  assert.equal(withTrailer[0]!.endLine, 5);
});

test("the type comes from the directive, or from the fence, or is code", () => {
  const of = (directive: string, fence: string): string => parseArtifacts(`${directive}\n\`\`\`${fence}\nx\n\`\`\`\n:::`)[0]!.artifact.type;
  assert.equal(of(':::artifact{identifier="a" type="react"}', "jsx"), "react");
  assert.equal(of(':::artifact{identifier="a" type="application/vnd.ant.react"}', "jsx"), "react");
  assert.equal(of(':::artifact{identifier="a" type="image/svg+xml"}', "svg"), "svg");
  assert.equal(of(':::artifact{identifier="a"}', "mermaid"), "mermaid");
  assert.equal(of(':::artifact{identifier="a"}', "jsx"), "react");
  assert.equal(of(':::artifact{identifier="a"}', "python"), "code");
  assert.equal(of(':::artifact{identifier="a" type="nonsense"}', "python"), "code");
});

test("an identifier that is missing or empty still gets one the panel can key on", () => {
  const noId = parseArtifacts(':::artifact{type="html"}\n```html\nx\n```\n:::')[0]!.artifact;
  assert.equal(noId.identifier, "block-1");
  assert.equal(noId.title, "Artifact");
  const empty = parseArtifacts(':::artifact{identifier="  " title="Mine"}\n```html\nx\n```\n:::')[0]!.artifact;
  assert.equal(empty.identifier, "block-1");
  assert.equal(empty.title, "Mine");
});

test("two artifacts, and the same identifier twice, are two versions", () => {
  const text = `${closed}\n\n${closed.replace('id="c"', 'id="c2"')}`;
  const found = parseArtifacts(text);
  assert.equal(found.length, 2);
  const versions = collectArtifacts([text]);
  assert.equal(versions.get("revenue")!.length, 2);
  assert.deepEqual(versions.get("revenue")!.map((item) => item.version), [1, 2]);
  assert.ok(versions.get("revenue")![1]!.body.includes('id="c2"'), "the newest version is the revision");
});

test("versions are collected in transcript order across replies", () => {
  const first = ':::artifact{identifier="doc" type="markdown"}\n```markdown\none\n```\n:::';
  const second = ':::artifact{identifier="doc" type="markdown"}\n```markdown\ntwo\n```\n:::';
  const versions = collectArtifacts(["", first, second, ""]);
  assert.deepEqual(versions.get("doc")!.map((item) => [item.version, item.body]), [[1, "one"], [2, "two"]]);
  assert.equal(collectArtifacts([]).size, 0);
});

test("encoding turns an artifact into one fence the renderer can route", () => {
  const encoded = encodeArtifactsForMarkdown(closed);
  assert.ok(encoded.includes(`\`\`\`${ARTIFACT_FENCE}`));
  const lines = encoded.split("\n");
  const at = lines.findIndex((line) => line === `\`\`\`${ARTIFACT_FENCE}`);
  assert.deepEqual(JSON.parse(lines[at + 1]!), {
    identifier: "revenue",
    title: "Revenue by month",
    type: "html",
    language: "html",
  });
  assert.ok(encoded.includes("Here is the chart:"), "the prose stays");
  assert.ok(encoded.includes("And that is it."));
  assert.ok(!encoded.includes(":::artifact"), "the directive itself is gone");

  // Text without an artifact is returned as the same string, so a memoised block still skips.
  const plain = "just a sentence\n\n```js\nx\n```\n";
  assert.equal(encodeArtifactsForMarkdown(plain), plain);
});

test("what draws inline and what needs the panel", () => {
  const of = (type: Parameters<typeof shouldInlineArtifact>[0]["type"], size: number) =>
    shouldInlineArtifact({ identifier: "a", title: "a", type, body: "x".repeat(size) });
  assert.equal(of("mermaid", 100), true);
  assert.equal(of("svg", 100), true);
  assert.equal(of("markdown", 100), true);
  assert.equal(of("html", 100), true, "a small page is quiet enough to draw");
  assert.equal(of("html", 10_000), false, "a large page gets the panel");
  assert.equal(of("react", 10), false, "a component always gets the panel — it runs code");
  assert.equal(of("code", 10), false, "code is read, not drawn");
  assert.equal(of("mermaid", 40_000), false);
});
