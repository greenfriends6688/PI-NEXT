// fork:pdf-page-fragment — upstream-port marker
import assert from "node:assert/strict";
import test from "node:test";

import { openFileTab, saveFileViewerState } from "./file-tab-state.ts";

const tabA = {
  id: "file:/repo/a.ts",
  label: "a.ts",
  filePath: "/repo/a.ts",
  viewerRevision: 0,
  viewerState: {
    displayMode: "source",
    wrapLines: true,
    scrollTop: 240,
    scrollLeft: 16,
  },
};

const tabB = {
  id: "file:/repo/b.ts",
  label: "b.ts",
  filePath: "/repo/b.ts",
  viewerRevision: 0,
};

const openA = {
  fileName: "a.ts",
  filePath: "/repo/a.ts",
  tabId: "file:/repo/a.ts",
};

test("saving viewer state updates only the matching revision", () => {
  const tabs = [tabA, tabB];
  const nextState = { ...tabA.viewerState, scrollTop: 480 };
  const saved = saveFileViewerState(tabs, tabA.id, 0, nextState);

  assert.notStrictEqual(saved, tabs);
  assert.deepEqual(saved[0].viewerState, nextState);
  assert.strictEqual(saved[1], tabB);

  const stale = saveFileViewerState(saved, tabA.id, 9, tabA.viewerState);
  assert.strictEqual(stale, saved);
});

test("opening an existing tab normally preserves its state and revision", () => {
  const tabs = [tabA, tabB];
  assert.strictEqual(openFileTab(tabs, openA), tabs);
});

test("changing the source session preserves the mounted viewer and its state", () => {
  const [next] = openFileTab([tabA], { ...openA, sourceSessionId: "session-2" });
  assert.equal(next.sourceSessionId, "session-2");
  assert.equal(next.viewerRevision, 0);
  assert.strictEqual(next.viewerState, tabA.viewerState);
});

test("opening from the same source session preserves the viewer revision", () => {
  const tab = { ...tabA, sourceSessionId: "session-1" };
  const tabs = [tab];
  assert.strictEqual(
    openFileTab(tabs, { ...openA, sourceSessionId: "session-1" }),
    tabs,
  );
});

// fork:perf-viewer-two-modes — `"diff"` is no longer a display mode. It asks for the
// HEAD comparison overlay to be open; the display mode underneath is left alone.
test("changing source while forcing diff increments the revision once", () => {
  const [next] = openFileTab([tabA], {
    ...openA,
    sourceSessionId: "session-2",
    modeHint: "diff",
  });
  assert.equal(next.sourceSessionId, "session-2");
  assert.equal(next.viewerRevision, 1);
  assert.equal(next.viewerState.displayMode, "source");
  assert.equal(next.viewerState.diffOpen, true);
});

test("activating the comparison increments the revision without touching the mode", () => {
  const first = openFileTab([tabA, tabB], { ...openA, modeHint: "diff" });
  assert.equal(first[0].viewerRevision, 1);
  assert.deepEqual(first[0].viewerState, {
    displayMode: "source",
    wrapLines: true,
    scrollTop: 240,
    scrollLeft: 16,
    diffOpen: true,
  });

  // Already open: the request is satisfied, so the mounted viewer is left alone.
  assert.strictEqual(openFileTab(first, { ...openA, modeHint: "diff" }), first);

  // Dismissing the overlay (the viewer writes this back) makes the next request real.
  const dismissed = saveFileViewerState(first, tabA.id, 1, { ...tabA.viewerState, diffOpen: false });
  const second = openFileTab(dismissed, { ...openA, modeHint: "diff" });
  assert.equal(second[0].viewerRevision, 2);
  assert.equal(second[0].viewerState.diffOpen, true);
});

test("a diff hint on a preview tab keeps the mode the user picked", () => {
  const previewTab = {
    ...tabA,
    viewerState: { ...tabA.viewerState, displayMode: "preview" },
  };
  const [next] = openFileTab([previewTab], { ...openA, modeHint: "diff" });
  assert.equal(next.viewerState.displayMode, "preview");
  assert.equal(next.viewerState.diffOpen, true);
});

test("locating in an already-open preview tab preserves the editor instance", () => {
  const previewTab = {
    ...tabA,
    viewerState: { ...tabA.viewerState, displayMode: "preview" },
    initialDisplayMode: "preview",
  };
  const tabs = [previewTab];
  assert.strictEqual(openFileTab(tabs, { ...openA, modeHint: "preview" }), tabs);
});

test("locating from another source session preserves an already-open preview editor", () => {
  const previewTab = {
    ...tabA,
    sourceSessionId: "session-1",
    viewerState: { ...tabA.viewerState, displayMode: "preview" },
    initialDisplayMode: "preview",
  };
  const [next] = openFileTab([previewTab], {
    ...openA,
    sourceSessionId: "session-2",
    modeHint: "preview",
  });
  assert.equal(next.sourceSessionId, "session-2");
  assert.equal(next.viewerRevision, previewTab.viewerRevision);
  assert.strictEqual(next.viewerState, previewTab.viewerState);
});

test("a remounted viewer ignores the previous revision's late cleanup", () => {
  const reopened = openFileTab([tabA], { ...openA, modeHint: "diff" });
  const stale = saveFileViewerState(reopened, tabA.id, 0, tabA.viewerState);
  assert.strictEqual(stale, reopened);
  assert.equal(stale[0].viewerState.diffOpen, true);
});

test("a PDF page link remounts the viewer so the document jumps", () => {
  const [next] = openFileTab([tabA], { ...openA, page: 12 });
  assert.equal(next.page, 12);
  assert.equal(next.viewerRevision, 1);
  assert.strictEqual(next.viewerState, tabA.viewerState);
});

test("reopening the same PDF page keeps the viewer mounted", () => {
  const tabs = [{ ...tabA, page: 12 }];
  assert.strictEqual(openFileTab(tabs, { ...openA, page: 12 }), tabs);
});

test("opening another page of the same PDF increments the revision", () => {
  const [next] = openFileTab([{ ...tabA, page: 12 }], { ...openA, page: 13 });
  assert.equal(next.page, 13);
  assert.equal(next.viewerRevision, 1);
});

test("opening a PDF without a page fragment clears a previous jump", () => {
  const [next] = openFileTab([{ ...tabA, page: 12 }], openA);
  assert.equal(next.page, undefined);
  assert.equal(next.viewerRevision, 1);
});
