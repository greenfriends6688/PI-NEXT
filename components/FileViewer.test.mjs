import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import ts from "typescript";

const source = await readFile(new URL("./FileViewer.tsx", import.meta.url), "utf8");

test("large source previews bypass the per-line syntax highlighter", () => {
  assert.match(source, /const SOURCE_HIGHLIGHT_MAX_LINES = 1_000;/);
  // fork:perf-highlighter — the huge-file fallback is also what renders while the
  // lazily imported Prism chunk is still in flight.
  assert.match(source, /const useLightweightSource = !highlighterReady \|\| sourceLines\.length > SOURCE_HIGHLIGHT_MAX_LINES/);

  // Both source trees are memoized so unrelated re-renders (panel open/close,
  // selection changes) reuse them instead of rebuilding every line element.
  assert.match(source, /const highlightedSource = useMemo\(/);

  const lightweightStart = source.indexOf("const lightweightSourceLines = useMemo(");
  const lightweightEnd = source.indexOf("[sourceLines, useLightweightSource, wrapLines]", lightweightStart);
  assert.notEqual(lightweightStart, -1);
  assert.notEqual(lightweightEnd, -1);

  const lightweightSource = source.slice(lightweightStart, lightweightEnd);
  assert.match(lightweightSource, /useLightweightSource \? sourceLines\.map\(\(line, lineIndex\) =>/);
  assert.match(lightweightSource, /className="file-source-line"/);
  assert.match(lightweightSource, /className="file-source-line-content"/);
  assert.match(lightweightSource, /style=\{FILE_LINE_NUMBER_STYLE\}/);

  // The lightweight branch still wins over the syntax highlighter inside the source stage.
  const branchStart = source.indexOf("useLightweightSource ? (");
  assert.notEqual(branchStart, -1);
  assert.match(source.slice(branchStart), /className="file-source-view is-lightweight"/);
  assert.notEqual(source.indexOf("highlightedSource", branchStart), -1);
});

test("large source fallbacks are built for every stage, not only the visible one", () => {
  // Execute the source-view calculations without mounting the file-fetching component.
  const file = ts.createSourceFile("FileViewer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const viewer = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "TextFileViewer");
  const calculations = viewer.body.statements.filter((node) =>
    ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) =>
      ["viewerContent", "sourceLines", "language", "isHtml", "isMarkdown", "hasPreview", "effectiveDisplayMode", "useLightweightSource", "lightweightSourceLines"].includes(declaration.name.getText(file)),
    ),
  ).map((node) => node.getText(file)).join("\n");
  const { outputText } = ts.transpileModule(`
    return (data, displayMode, wrapLines = false) => {
      const SOURCE_HIGHLIGHT_MAX_LINES = 1_000;
      const FILE_LINE_NUMBER_STYLE = {};
      // The lazy Prism chunk is assumed loaded here: this harness only exercises the
      // source-line calculations, not the loading state.
      const highlighterReady = true;
      const isDeletedDiff = false;
      ${calculations}
      return lightweightSourceLines;
    };
  `, { compilerOptions: { jsx: ts.JsxEmit.React } });
  const render = new Function("React", "useMemo", outputText)(React, (calculate) => calculate());
  const large = { content: "line\n".repeat(1_000), language: "text" };

  // Small files still go through the syntax highlighter.
  assert.equal(render({ ...large, content: "line\n".repeat(999) }, "source"), null);

  // fork:perf-viewer-keepalive — the source rows no longer depend on which stage is
  // on screen. The source view stays mounted while preview or diff is showing, so the
  // rows are produced for every mode instead of being rebuilt on each return.
  for (const mode of ["source", "preview", "diff"]) {
    const rows = render(large, mode);
    assert.equal(rows.length, 1_001, `${mode} must retain its source fallback`);
    assert.equal(rows[0].props["data-line-number"], 1);
    assert.equal(rows[0].props.children[1].props.children, "line");
  }
  for (const language of ["html", "markdown"]) {
    assert.equal(render({ ...large, language }, "preview").length, 1_001);
  }
  assert.equal(render(large, "source", true)[0].props.children[1].props.style.whiteSpace, "pre-wrap");
});

test("the display stages mount once and switch with hidden", () => {
  // fork:perf-viewer-keepalive — unmounting a stage threw away Prism's token tree,
  // the markdown parse and the diff DOM, so every return paid to rebuild it.
  assert.match(source, /const \[mountedStages, setMountedStages\] = useState<readonly DisplayMode\[\]>\(/);
  assert.match(source, /if \(!mountedStages\.includes\(effectiveDisplayMode\)\) \{/);
  assert.match(source, /mountedStages\.includes\("source"\)/);
  assert.match(source, /mountedStages\.includes\("preview"\)/);
  assert.match(source, /hidden=\{diffOpen \|\| effectiveDisplayMode !== "source"\}/);
  assert.match(source, /hidden=\{diffOpen \|\| effectiveDisplayMode !== "preview"\}/);

  // The old exclusive branches would short-circuit the persistent stages.
  assert.doesNotMatch(source, /\) : effectiveDisplayMode === "diff" && hasGitDiff \? \(/);
  assert.doesNotMatch(source, /\) : isHtml && effectiveDisplayMode === "preview" \? \(/);

  // The unsupported-file card stays an exclusive overlay. The live editor does not:
  // it is the surface of the Source stage, so it survives a toggle.
  assert.match(source, /\{shouldShowUnsupportedCard\(filePath\) \? \(/);
  assert.match(source, /const useCodeEditor = !isMobile && data\?\.editable === true/);
  assert.match(source, /const liveEditing = useCodeEditor && effectiveDisplayMode === "source";/);
  assert.match(source, /useCodeEditor \? \([\s\S]*?<CodeFileEditor[\s\S]*?active=\{effectiveDisplayMode === "source"\}/);
  assert.doesNotMatch(source, /\) : liveEditing && isCodeText \? \(/);
  assert.doesNotMatch(source, /\) : liveEditing \? \(/);
});

test("the preview stage is a read-only render, not an editor", () => {
  // fork:perf-viewer-two-modes — Preview used to mount the ProseMirror WYSIWYG editor for
  // an editable `.md`, and every Source↔Preview toggle rebuilt the whole document (~1.7s
  // for 27KB). The two-mode contract is that Source writes and Preview only renders.
  assert.doesNotMatch(source, /MarkdownFileEditor/);
  assert.doesNotMatch(source, /MarkdownEditorBoundary/);
  assert.doesNotMatch(source, /useMarkdownEditor/);

  const previewStage = source.slice(
    source.indexOf('data-file-stage="preview"'),
    source.indexOf('{/* A deleted file has no content'),
  );
  assert.match(previewStage, /<MarkdownFilePreview /);
  assert.match(previewStage, /<CsvPreview /);
  assert.match(previewStage, /title=\{t\("i18n\.htmlPreview"\)\}/);
  assert.doesNotMatch(previewStage, /CodeFileEditor/);

  // `.md` is editable in Source now: the old exclusion kept it out of the code editor.
  assert.doesNotMatch(source, /isCodeText = isEditableTextPath/);
});

test("the switch offers two modes and the HEAD comparison is an overlay", () => {
  // fork:perf-viewer-two-modes — `diff` is not a display mode any more. Keeping it out
  // of `displayModes` is what removes the "fetch a git diff to know whether to render
  // the button" dependency from opening a file.
  const switchBody = source.slice(
    source.indexOf("const displayModes: DisplayMode[] = ["),
    source.indexOf("const metadata = data === null"),
  );
  assert.match(switchBody, /"source"/);
  assert.match(switchBody, /hasPreview \|\| isDelimitedText \? \["preview" as const\]/);
  assert.doesNotMatch(switchBody, /"diff"/);

  // The overlay is its own layer, dismissed from its own banner.
  assert.match(source, /const updateDiffOpen = useCallback\(\(nextDiffOpen: boolean\) => \{/);
  assert.match(source, /\{diffOpen && \(/);
  // fork:v5-landing —— 横幅本体换成 `.d-banner`（类名跟随画板 D-06b 帧 B）。
  assert.match(source, /className="file-viewer-diff-banner d-banner"/);
  assert.match(source, /t\("files\.backToSource"\)/);
  // A deleted file has no content behind the overlay, so it needs a notice.
  assert.match(source, /data === null && isDeletedDiff && !diffOpen/);
});

test("the diff is parsed once per patch, not on every render", () => {
  assert.match(source, /const diff = useMemo\(\(\) => diffLines\(patch\), \[patch\]\);/);
  assert.match(source, /const segments = useMemo\(\(\) => diffSegments\(diff\), \[diff\]\);/);
});

// fix:viewer-stage-fill —— 源码层必须自己给高度。`CodeFileEditor` 的根是
// `.pw-viewer`（flex 列 + `height:100%`），挂在一个 auto 高度的
// `div[data-file-stage="source"]` 上时百分比落回 auto：编辑器只剩内容高，
// 底栏（Ln · Col / EOL · UTF-8）浮在面板中间，下面留一大片空白。
// preview 层**不能**锁高度 —— 里面的 markdown 是随内容长的，锁死就滚不动了。
test("gives the source stage a definite height; only the html preview stage is pinned", () => {
  assert.match(source, /data-file-stage="source"[^>]*style=\{\{ height: "100%", minHeight: 0 \}\}/);
  // fix:viewer-html-stage-fill（2026-10-06）—— markdown / CSV 仍是内容驱动（锁死就滚不动），
  // **只有 HTML 那一支**锁高度：它的 iframe 是 `height:100%`，挂在 auto 高度层上会落回
  // 浏览器默认的 150px，把表单切成一条窄带 + 下面一大片空白。
  assert.match(
    source,
    /data-file-stage="preview"[^>]*style=\{isHtml \? \{ height: "100%", minHeight: 0 \} : undefined\}/,
  );
});

// fix:sel-pop-nowrap —— 选中文字的浮窗不许折行（两个按钮原来会各占一行）。
test("keeps the selection popover on a single line", () => {
  assert.match(source, /flexWrap: inputOpen \? "wrap" : "nowrap",\s*\n\s*whiteSpace: inputOpen \? undefined : "nowrap",/);
  assert.match(source, /width: inputOpen \? "min\(420px, calc\(100vw - 16px\)\)" : "max-content",/);
});

// fix:sel-pop-grid —— 收起态那两枚是**带文案的动作钮**，不是方形图标钮：
// `.pw-iconbtn` 是 `display:grid; place-items:center`，图标 + 文案会被各放一格
// （上下两行），按钮撑破 35px、浮窗变两行高还多一条竖向滚动条（用户截图实测）。
// 壳与动作钮一起改回画板原件（`.pw-pop` + `.pw-btn`），与转录里那份同一套。
test("the selection popover uses the board shell and labelled buttons, not icon buttons", () => {
  const start = source.indexOf("function FileSelectionQuotePopover");
  const popover = source.slice(start, source.indexOf("\nfunction ", start + 10));
  assert.match(popover, /className="d-pop is-open"/);
  assert.doesNotMatch(popover, /boxShadow: "var\(--shadow-popover\)"/, "shell chrome comes from .d-pop, not hand-written inline");
  assert.equal((popover.match(/className="d-btn sm"/g) ?? []).length, 2, "both toolbar actions are .d-btn");
  assert.equal((popover.match(/className="d-iconbtn"/g) ?? []).length, 1, "only the close button stays an icon button");
  assert.match(popover, /data-ico="at-sign"/);
  assert.match(popover, /data-ico="git-fork"/);
  assert.doesNotMatch(popover, /<svg/, "no hand-drawn icons in the popover");
});
