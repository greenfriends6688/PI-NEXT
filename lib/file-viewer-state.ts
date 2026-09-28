// fork:perf-viewer-two-modes — `"diff"` used to be a third display mode alongside
// `source` and `preview`. It is now an entry-driven overlay on top of them (opened
// from the Git changes panel, the Git graph, or the toolbar toggle, and remembered per
// tab as `FileViewerState.diffOpen`), because it is not a way of looking at a file —
// it is one comparison against HEAD. The switch offers two modes.
export type FileViewerDisplayMode = "source" | "preview";

export interface FileViewerState {
  displayMode: FileViewerDisplayMode;
  wrapLines: boolean;
  scrollTop: number;
  scrollLeft: number;
  /** The "compare against HEAD" overlay is open for this tab. */
  diffOpen?: boolean;
}

/**
 * Coerce a persisted or requested mode into a display mode.
 *
 * Tab state is persisted, so a value written by an older build reaches this at
 * runtime: `"diff"` (and anything else unusable) falls back to `"source"` instead of
 * leaking into component state, where it would render no stage at all.
 */
export function normalizeDisplayMode(value: unknown): FileViewerDisplayMode {
  return value === "preview" ? "preview" : "source";
}

export function resolveInitialFileDisplayMode(
  initialState?: FileViewerState,
  initialDisplayMode?: FileViewerDisplayMode,
): FileViewerDisplayMode {
  return normalizeDisplayMode(initialState?.displayMode ?? initialDisplayMode);
}
