// fork:pdf-page-fragment — upstream-port marker
import type { FileViewerState } from "@/lib/file-viewer-state";
import type { Tab } from "./TabBar";

interface OpenFileTabInput {
  fileName: string;
  filePath: string;
  /**
   * `"preview"` is a display-mode request; `"diff"` is not a mode any more — it asks
   * for the HEAD comparison overlay to be open (fork:perf-viewer-two-modes).
   */
  modeHint?: "preview" | "diff";
  page?: number;
  sourceSessionId?: string | null;
  tabId: string;
}

export function openFileTab(tabs: Tab[], input: OpenFileTabInput): Tab[] {
  const existing = tabs.find((tab) => tab.id === input.tabId);
  if (!existing) {
    return [...tabs, {
      id: input.tabId,
      label: input.fileName,
      filePath: input.filePath,
      sourceSessionId: input.sourceSessionId,
      initialDisplayMode: input.modeHint === "preview" ? "preview" : undefined,
      page: input.page,
      viewerState: input.modeHint ? {
        displayMode: input.modeHint === "preview" ? "preview" : "source",
        wrapLines: false,
        scrollTop: 0,
        scrollLeft: 0,
        diffOpen: input.modeHint === "diff",
      } : undefined,
      viewerRevision: 0,
    }];
  }

  const sourceChanged = Boolean(
    input.sourceSessionId && existing.sourceSessionId !== input.sourceSessionId,
  );
  const sourceUnchanged = !sourceChanged;
  const previewAlreadyActive = input.modeHint === "preview"
    && (existing.viewerState?.displayMode === "preview" || existing.initialDisplayMode === "preview");
  const diffAlreadyActive = input.modeHint === "diff" && existing.viewerState?.diffOpen === true;
  const hintAlreadySatisfied = input.modeHint === "preview"
    ? previewAlreadyActive
    : input.modeHint === "diff" ? diffAlreadyActive : true;
  const pageChanged = existing.page !== input.page;
  if (sourceUnchanged && hintAlreadySatisfied && !pageChanged) return tabs;

  return tabs.map((tab) => {
    if (tab.id !== input.tabId) return tab;
    const next: Tab = { ...tab };
    let bumpRevision = false;
    if (sourceChanged) {
      // Source swap alone keeps the mounted viewer (only identity metadata moves).
      next.sourceSessionId = input.sourceSessionId;
    }
    if (pageChanged) {
      next.page = input.page;
      bumpRevision = true;
    }
    if (input.modeHint === "preview" && !previewAlreadyActive) {
      next.initialDisplayMode = "preview";
      next.viewerState = {
        displayMode: "preview",
        wrapLines: tab.viewerState?.wrapLines ?? false,
        scrollTop: 0,
        scrollLeft: 0,
        diffOpen: tab.viewerState?.diffOpen,
      };
      bumpRevision = true;
    }
    if (input.modeHint === "diff" && !diffAlreadyActive) {
      // The overlay is viewer state, so the request has to arrive before the viewer
      // mounts — the revision bump is what remounts it (same mechanism the preview
      // hint already uses). The user closes it from the banner, which writes
      // `diffOpen: false` back through `onStateChange`.
      next.viewerState = {
        displayMode: tab.viewerState?.displayMode ?? "source",
        wrapLines: tab.viewerState?.wrapLines ?? false,
        scrollTop: tab.viewerState?.scrollTop ?? 0,
        scrollLeft: tab.viewerState?.scrollLeft ?? 0,
        diffOpen: true,
      };
      bumpRevision = true;
    }
    if (bumpRevision) next.viewerRevision = (tab.viewerRevision ?? 0) + 1;
    return next;
  });
}

export function saveFileViewerState(
  tabs: Tab[],
  tabId: string,
  viewerRevision: number,
  viewerState: FileViewerState,
): Tab[] {
  const index = tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1 || (tabs[index].viewerRevision ?? 0) !== viewerRevision) return tabs;

  const next = [...tabs];
  next[index] = { ...next[index], viewerState };
  return next;
}
