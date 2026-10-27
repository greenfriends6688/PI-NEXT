import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { TurnWrittenFiles } = await jiti.import("./TurnWrittenFiles.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function render(props) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(TurnWrittenFiles, props)),
  );
}

test("shows one file-name chip per written file, without a summary pill", () => {
  const html = render({
    files: [
      { filePath: "/abs/out/report.html", additions: 18, deletions: 6 },
      { filePath: "/abs/out/data.json", additions: 2, deletions: 0 },
    ],
    onOpenFile() {},
  });
  // The names are the content; the old "N files edited" card is gone.
  assert.doesNotMatch(html, /filecard/);
  assert.match(html, /class="chip written-file-chip"/);
  assert.match(html, /title="\/abs\/out\/report\.html"/);
  assert.match(html, /title="\/abs\/out\/data\.json"/);
  assert.match(html, />report\.html</);
  assert.match(html, />data\.json</);
});

test("renders nothing when no files were written", () => {
  assert.equal(render({ files: [], onOpenFile() {} }), "");
});
