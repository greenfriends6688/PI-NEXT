import assert from "node:assert/strict";
import test from "node:test";

import { normalizeDisplayMode, resolveInitialFileDisplayMode } from "./file-viewer-state.ts";

test("a restored display mode wins over a stale open hint", () => {
  const state = {
    displayMode: "source",
    wrapLines: true,
    scrollTop: 80,
    scrollLeft: 0,
  };

  assert.equal(resolveInitialFileDisplayMode(state, "preview"), "source");
});

test("a display mode written by the three-mode build falls back to source", () => {
  // fork:perf-viewer-two-modes — `"diff"` was a third display mode and it is an
  // overlay now. Tab state is persisted, so an older value reaches this at runtime;
  // leaking it into component state would render no stage at all.
  assert.equal(normalizeDisplayMode("diff"), "source");
  assert.equal(normalizeDisplayMode("nonsense"), "source");
  assert.equal(normalizeDisplayMode(undefined), "source");
  assert.equal(normalizeDisplayMode("preview"), "preview");

  const legacy = { displayMode: "diff", wrapLines: false, scrollTop: 0, scrollLeft: 0 };
  assert.equal(resolveInitialFileDisplayMode(legacy), "source");
  assert.equal(resolveInitialFileDisplayMode(undefined, "diff"), "source");
});

test("the open hint is used only before viewer state has been saved", () => {
  assert.equal(resolveInitialFileDisplayMode(undefined, "preview"), "preview");
  assert.equal(resolveInitialFileDisplayMode(), "source");
});
