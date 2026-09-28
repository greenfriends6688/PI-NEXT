/**
 * The contract between the file viewer and a live text editor.
 *
 * fork:perf-viewer-two-modes — these three lived in `MarkdownFileEditor.tsx` while the
 * WYSIWYG markdown editor existed. The editor is gone (Preview is a read-only render
 * now) and `CodeFileEditor` is the only implementation left, so the types moved here
 * instead of forcing the viewer to keep importing a deleted module.
 */

/** A text selection reported by an editor, positioned for the quote popover. */
export interface MarkdownEditorSelection {
  text: string;
  startLine: number;
  endLine: number;
  top: number;
  left: number;
}

/** A "reveal this line/text" request coming from a chat reference. */
export interface MarkdownEditorLocationTarget {
  text: string;
  startLine?: number;
  endLine?: number;
}

/** What an editor exposes so the viewer can highlight a referenced location. */
export interface MarkdownEditorLocationApi {
  revealLocation: (target: MarkdownEditorLocationTarget) => HTMLElement[];
  clearLocation: () => void;
}
