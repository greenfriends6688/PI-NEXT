// The `files` tab's content: the active file, or the tree on its own.
//
// The tree is the `files` tab; a file gets the full pane, never a viewer under
// the tree (pi-next's `components/AppShell.tsx` mounts the active tab only).
// The file-tab strip is separate (`./FileTabs.tsx`), so a dock that can draw
// every open file in its own tab bar can mount `FilesPane` alone;
// `screens/panel/PanelDock.tsx` puts `FileTabs` above it. `syncFileTabs` reads
// the folder's remembered tabs in an effect, so the host does not need to know
// about `prefs`.
import { effect, View } from "nsh";
import { FileTree } from "./FileTree";
import { FileView } from "./FileView";
import { activeFileTab, syncFileTabs } from "./tabs";

/**
 * The `files` tab body: the active file, else the tree. The caller draws the
 * file-tab strip above it (or the dock's own tab bar replaces it).
 */
export function FilesPane() {
  // The folder's remembered tabs are read once, again when `prefs` lands and
  // whenever another folder (session) is selected (`./tabs.ts`).
  effect(() => {
    syncFileTabs();
  });
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <If when={activeFileTab()} else={<FileTree />}>
        {(path) => <FileView path={path} />}
      </If>
    </View>
  );
}
