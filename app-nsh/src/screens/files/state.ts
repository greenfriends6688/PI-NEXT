// The files pane's smaller switches: whether the tree lists what Git ignores,
// and the error text its rows show. The open-file store lives in `./tabs.ts`
// (`openFileTab` / `openFileTabs` / `activeFileTab`), shared by the tree, the
// viewer and the shell's tab strip.
//
// `openFilePath` / `openFile` stay as the old names for that store, so a link
// written against the pre-tab API keeps working: it opens (or closes) the
// tabbed viewer rather than a second viewer under the tree.
import { signal } from "nsh";
import { errorText } from "../../ui/errors";
import { activeFileTab, closeAllFileTabs, openFileTab } from "./tabs";

/** The file tab on screen (`./tabs.ts`), or `null` for the tree. */
export const openFilePath = activeFileTab;

/** The tree's "show hidden" switch (`?type=list&hidden=1`). */
export const hiddenFilesShown = signal(false);

/**
 * The changed file whose diff the Changes pane shows. The tree's diff button
 * writes it and opens that tab, so a file's diff is one press from its row
 * (`ChangesView` selects rows through the same signal).
 */
export const changeSelection = signal<string | null>(null);

/** Shows `path` in a file tab; `null` closes every file tab and shows the tree. */
export function openFile(path: string | null): void {
  if (path === null) closeAllFileTabs();
  else openFileTab(path);
}

/** A thrown value as a line the UI can show (`ui/errors.ts`). */
export { errorText };
