// The file tree: one `?type=list` per directory, read when the folder opens.
//
// NSH pieces this follows:
//   nsh-main/crates/nsh-base/src/tree.rs:432-489   `TreeProps`: `items`
//                                                  (`TreeItem`, tree.rs:120-142),
//                                                  controlled `expanded` +
//                                                  `onExpandedChange`, `selected` +
//                                                  `onSelectedChange`, `onAction`,
//                                                  `itemClass`, `renderItem`
//                                                  (`TreeEntry`, tree.rs:127-150)
//   nsh-main/docs/dev/scrolling-and-lists.md:1-30   the rows are virtualized: only
//                                                  those in view exist
//
// The look is the gallery's (`ui/kit`): a row is `TreeRow` (its chevron, its
// folder/file icon, its label indented by `treeIndent`) inside `treeItemClass`
// (hover, selection, the keyboard's ring, dimmed when disabled); the panel is a
// section surface with a toolbar of `Press` icon buttons; the states under it
// are `Inset`s of `Caption`s. Numbers are pi-next's `.filetree__head` /
// `.tree-row` (`app/v5/panel.css:481-600`): a 34-point toolbar (0 8 0 12, gap
// 2), 26 × 26 head buttons with 14-point glyphs, the list padded 4 / 6 / 8, and
// a change badge 16 points high (4-point corners, a 4-point dot, 9.5-point
// code) with the folder dot 5 points across. `treeIndent` is 14, pi-next's
// `.tree-guides > span` width, exactly.
//
// Two consequences of the component's shape drive this file:
//   - A `TreeItem` with no `children` is a leaf: it cannot be expanded, so its
//     directory could never load. Every folder therefore always has at least
//     one child: a disabled placeholder row until the listing arrives.
//   - `renderItem` draws a row once per item and keeps it, so it may only read
//     the `TreeEntry` it is given; the row's state (selected, expanded) reaches
//     it through `group-*` variants on `itemClass` (`group-aria-expanded:` on
//     the chevron).
//
// Rows load on expand only (and again for a project's remembered open folders
// when the tab comes back): the first look at a project reads one directory.
// `git status` is read once per project for the rows' change badges (a file's
// code, a folder's dot); it fails quietly, a tree that lists files without Git.

import { computed, effect, platform, resource, signal, Text, untracked, View } from "nsh";
import { Tree } from "nsh/base";
import type { TreeEntry, TreeItem } from "nsh/base";
import { listFiles, type FileEntry } from "../../api/files";
import { getGitStatus, type GitFileStatus, type GitFileStatusKind } from "../../api/git";
import { shortenPath } from "../../lib/display-path";
import { activeCwd, insertComposerText, selectedSessionId } from "../../state/session";
import { t } from "../../ui/i18n";
import {
  alpha,
  Caption,
  colors,
  Icon,
  Inset,
  Press,
  sectionSurface,
  toneColor,
  TreeRow,
  treeItemClass,
  type IconName,
  type Tone,
} from "../../ui/kit";
import { changeSelection, errorText, hiddenFilesShown } from "./state";
import { activeFileTab, openFileTab } from "./tabs";
import { openPanelTab } from "../panel/state";
import { buildAtMentionText } from "../../lib/file-fuzzy";

/** Joins a directory and one of its entries (`/` always: the API's separator). */
function childPath(directory: string, name: string): string {
  return `${directory.replace(/[/\\]+$/, "")}/${name}`;
}

/** The last part of a path, a project's name in the toolbar (`getFileName`). */
function baseName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  return trimmed.split(/[/\\]/).pop() || trimmed;
}

/** The directory above a path (the app's separator, `/`). */
function parentPath(path: string): string {
  return path.replace(/[/\\][^/\\]+$/, "");
}

/**
 * A toolbar's icon button: pi-next's `.filetree__head` button, 26 × 26 with a
 * 14-point glyph, filled while it is on (`behind`); `Press` gives the pointer's
 * fill and the keyboard's ring.
 */
function ToolbarButton(props: { icon: IconName; label: string; on?: boolean; onPress: () => void }) {
  return (
    <Press
      onPress={props.onPress}
      accessibilityLabel={props.label}
      accessibilityState={{ selected: props.on }}
      style={{
        width: 26,
        height: 26,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 7,
        backgroundColor: props.on ? alpha(colors.text, 0.07) : "transparent",
      }}
      hoverStyle={{ backgroundColor: alpha(colors.text, 0.05) }}
    >
      <Icon name={props.icon} size={14} tint={props.on ? colors.text : colors.faint} />
    </Press>
  );
}

/** A Git status in the theme's tokens: `theme.json` has no "success", so an
 * addition is the `up` tone, a deletion or a conflict `down` (the danger tone),
 * a modification `warn` and a rename the brand's. */
function statusTone(status: GitFileStatusKind): Tone {
  if (status === "added") return "up";
  if (status === "deleted" || status === "conflict") return "danger";
  if (status === "modified") return "warn";
  if (status === "renamed") return "accent";
  return "neutral";
}

/** A Git status's name, for the badge's screen-reader label. */
const STATUS_KEYS: Record<GitFileStatusKind, string> = {
  modified: "files.modified",
  added: "files.added",
  deleted: "files.deleted",
  renamed: "files.renamed",
  untracked: "files.untracked",
  conflict: "files.conflict",
};

/**
 * A changed file's badge: pi-next's `.tree-row__badge` (16 points high, 4-point
 * corners, a 4-point dot then the one-letter code at 9.5 points semibold, on
 * the inset fill) in its status's tone.
 */
function ChangeBadge(props: { status: GitFileStatus }) {
  return (
    <View
      accessibilityLabel={`${props.status.code}: ${t(STATUS_KEYS[props.status.status])}`}
      style={{
        height: 16,
        minWidth: 16,
        marginEnd: 8,
        paddingHorizontal: 4,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        borderRadius: 4,
        backgroundColor: colors.inset,
      }}
    >
      <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: toneColor(statusTone(props.status.status)) }} />
      <Text style={{ fontSize: 9.5, fontWeight: "600", letterSpacing: 0.2, color: toneColor(statusTone(props.status.status)) }}>
        {props.status.code}
      </Text>
    </View>
  );
}

/**
 * A disabled row standing in for a folder's children before they are read (or
 * while the read is on its way) so the item counts as a folder. Item ids are
 * the app's (`tree.rs:129-133`), and a NUL cannot be in a path.
 */
function placeholder(path: string, label: string): TreeItem {
  return { id: `${path}\u0000${label}`, label, disabled: true };
}

/**
 * Each project's open folders, for the life of the run. Opening a file puts
 * its tab on screen and unmounts the tree (only one tab is mounted, as
 * pi-next's panel does); coming back should land on the same folders rather
 * than a collapsed root. The listings are read again, as pi-next re-reads a
 * folder it reopens.
 */
const EXPANDED_MEMORY_LIMIT = 20;
const expandedByCwd = new Map<string, string[]>();

function rememberExpanded(cwd: string, ids: readonly string[]): void {
  expandedByCwd.delete(cwd);
  if (ids.length > 0) expandedByCwd.set(cwd, [...ids]);
  for (const oldest of expandedByCwd.keys()) {
    if (expandedByCwd.size <= EXPANDED_MEMORY_LIMIT) break;
    expandedByCwd.delete(oldest);
  }
}

export function FileTree() {
  /** Each directory's listing, by absolute directory path. */
  const listings = signal<Record<string, FileEntry[]>>({});
  /** A directory's read failed: the message, shown on a row under it. */
  const failures = signal<Record<string, string>>({});
  /** Directories whose read is on its way. */
  const pending = signal<string[]>([]);
  /** The expanded items' ids (`Tree`'s controlled `expanded`). */
  const expanded = signal<string[]>([]);
  /**
   * The row the tree shows selected (`Tree`'s controlled `selected`). It is the
   * tree's own cursor, not the open file: the arrows move it row by row, and
   * opening is `onAction` (`tree.rs:511-519`, "Open a file here, not in
   * `onSelectedChange`, which the arrows report row by row").
   */
  const selected = signal<string | null>(null);
  /** Bumped by the toolbar's reload: every listing is read again. */
  const reloads = signal(0);
  /**
   * Bumped whenever the listings stop counting (another project, another
   * "show hidden" answer): a read that started before it writes nothing.
   */
  let generation = 0;

  // `?type=list` of one directory, once. Reads of `pending`/`listings` here are
  // the guard's, so the callers run it untracked (`load` writes as it goes).
  async function load(directory: string): Promise<void> {
    if (pending().includes(directory) || listings()[directory]) return;
    const started = generation;
    pending.set([...pending(), directory]);
    try {
      const listed = await listFiles(directory, {
        hidden: hiddenFilesShown(),
        sessionId: selectedSessionId(),
      });
      if (started !== generation) return;
      listings.set({ ...listings(), [directory]: listed.entries });
      const next = { ...failures() };
      delete next[directory];
      failures.set(next);
    } catch (error) {
      if (started !== generation) return;
      failures.set({ ...failures(), [directory]: errorText(error) });
    } finally {
      if (started === generation) pending.set(pending().filter((dir) => dir !== directory));
    }
  }

  /** Every directory the loaded listings name: what a selected id has to miss to be a file. */
  const directoryIds = computed(() => {
    const ids = new Set<string>();
    for (const directory of Object.keys(listings())) {
      for (const entry of listings()[directory]) {
        if (entry.isDir) ids.add(childPath(directory, entry.name));
      }
    }
    return ids;
  });

  /** A directory's children, from its listing once it is expanded and read. */
  function childrenOf(path: string): TreeItem[] {
    if (!expanded().includes(path)) return [placeholder(path, "…")];
    const failure = failures()[path];
    if (failure) return [placeholder(path, t("files.couldNotReadFolder"))];
    const entries = listings()[path];
    if (!entries) return [placeholder(path, "…")];
    if (entries.length === 0) return [placeholder(path, t("files.emptyFolder"))];
    return level(path);
  }

  /** One listing as tree items (directories first, as the server sorts them). */
  function level(directory: string): TreeItem[] {
    const entries = listings()[directory];
    if (!entries) return [];
    return entries.map((entry) => {
      const path = childPath(directory, entry.name);
      // A file's label is its name; the viewer shortens the whole path.
      return entry.isDir
        ? { id: path, label: entry.name, children: childrenOf(path) }
        : { id: path, label: entry.name };
    });
  }

  const items = computed<TreeItem[]>(() => {
    const root = activeCwd();
    return root ? level(root) : [];
  });

  const rootTitle = computed(() => {
    const root = activeCwd();
    return root ? baseName(root) : t("files.paneTitle");
  });

  /**
   * The project's path, shortened: the toolbar names the folder (pi-next's
   * `.filetree__title`), the tree says where it is for screen readers.
   */
  const rootPath = computed(() => {
    const root = activeCwd();
    return root ? shortenPath(root) : "";
  });

  const rootFailure = computed(() => {
    const root = activeCwd();
    return root ? failures()[root] ?? null : null;
  });

  const rootLoading = computed(() => {
    const root = activeCwd();
    return root !== null && !listings()[root] && pending().includes(root);
  });

  /**
   * `git status` of the project, once per project: the rows' change badges. A
   * folder that does not answer (no Git, not a checkout) leaves the tree as it
   * is: the reads carry what a listing carries, no message.
   */
  const gitRead = resource(computed(() => activeCwd()), async (directory, info) => ({
    cwd: directory,
    status: await getGitStatus(directory, { signal: info.signal }).catch(() => null),
  }));

  /** The changed files by absolute path, and the folders that hold one. */
  const changes = computed(() => {
    const files = new Map<string, GitFileStatus>();
    const folders = new Set<string>();
    const read = gitRead();
    const root = activeCwd();
    if (read && read.cwd === root && read.status?.isGitRepository) {
      for (const file of read.status.files) {
        files.set(file.filePath, file);
        for (let parent = parentPath(file.filePath); parent.length > (root?.length ?? 0); parent = parentPath(parent)) {
          folders.add(parent);
        }
      }
    }
    return { files, folders };
  });

  // Where the tree starts: the project's directory, and again whenever another
  // project is chosen, "show hidden" flips, or the toolbar reloads. Within a
  // project the expanded folders are kept and read again; after a tab switch
  // (the tree unmounted, a file shown) they come back from `expandedByCwd`.
  let shownRoot: string | null = null;
  effect(() => {
    const root = activeCwd();
    // Depend on the switch and the reload; the reads below are what they change.
    void hiddenFilesShown();
    void reloads();
    untracked(() => {
      const sameRoot = root === shownRoot && root !== null;
      if (shownRoot !== null && shownRoot !== root) rememberExpanded(shownRoot, expanded());
      shownRoot = root;
      generation += 1;
      if (!sameRoot) expanded.set(root ? expandedByCwd.get(root) ?? [] : []);
      listings.set({});
      failures.set({});
      pending.set([]);
      if (!root) return;
      const directories = [root, ...expanded()];
      for (const directory of directories) void load(directory);
    });
  });

  function toggleHidden(): void {
    hiddenFilesShown.set(!hiddenFilesShown());
  }

  // The active file tab is the tree's selected row as well (pi-next's `is-on`):
  // a press on a row sets both, and a link that opens a file elsewhere moves
  // the selection to that file's row.
  effect(() => {
    const path = activeFileTab();
    if (path) selected.set(path);
  });

  /** The project-relative path a row's `@mention` carries. */
  function mentionPath(path: string): string {
    const root = activeCwd();
    if (!root) return path;
    const prefix = `${root.replace(/[/\\]+$/, "")}/`;
    return path.startsWith(prefix) ? path.slice(prefix.length) : path;
  }

  /** An @mention of the row, into the composer (the web tree's hover action). */
  function mentionRow(entry: TreeEntry): void {
    insertComposerText(buildAtMentionText(mentionPath(entry.id), entry.folder));
  }

  /** The row's diff, in the Changes pane (only a changed file has one). */
  function showDiff(path: string): void {
    changeSelection.set(path);
    openPanelTab({ kind: "changes" });
  }

  /** A row action: quiet until the row is under the pointer (always on a touch screen). */
  const rowActionClass = platform.desktop ? "opacity-0 group-hover:opacity-100" : "opacity-100";

  /** A row action's button: 20 × 20, the row's hover reveals it. */
  function RowAction(props: { label: string; icon?: IconName; glyph?: string; onPress: () => void }) {
    return (
      <View
        role="button"
        accessibilityLabel={props.label}
        onPress={props.onPress}
        class={rowActionClass}
        style={{ width: 20, height: 20, marginEnd: 2, alignItems: "center", justifyContent: "center", borderRadius: 5 }}
        hoverStyle={{ backgroundColor: alpha(colors.text, 0.08) }}
      >
        {props.icon
          ? <Icon name={props.icon} size={12} tint={colors.muted} />
          : <Text style={{ fontSize: 11.5, fontWeight: "600", fontFamily: "monospace", color: colors.muted }}>{props.glyph}</Text>}
      </View>
    );
  }

  /** A row: `TreeRow`'s chevron, icon and label, then the change badge or the folder's dot. */
  function renderEntry(entry: TreeEntry) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <TreeRow entry={entry} />
        </View>
        <RowAction label={t("files.mentionFile")} glyph="@" onPress={() => mentionRow(entry)} />
        <If when={!entry.folder && changes().files.get(entry.id)}>
          <RowAction label={t("files.openDiff")} icon="diff" onPress={() => showDiff(entry.id)} />
        </If>
        <If when={entry.folder ? null : changes().files.get(entry.id)}>
          {(status) => <ChangeBadge status={status()} />}
        </If>
        <If when={entry.folder && changes().folders.has(entry.id)}>
          {/* pi-next's `.tree-row__change-dot`: a 14-point box with a 5-point dot. */}
          <View
            accessibilityLabel={t("files.containsChangedFiles")}
            style={{ width: 14, height: 14, marginEnd: 8, alignItems: "center", justifyContent: "center" }}
          >
            <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.warn }} />
          </View>
        </If>
      </View>
    );
  }

  return (
    // The panel's frame: the kit's section surface, filled (`Card` sizes to its
    // content, as the gallery's own full-height panels note).
    <View style={{ ...sectionSurface(), flex: 1, minHeight: 0, overflow: "hidden" }}>
      {/* pi-next's `.filetree__head`: 34 points, 0 8 0 12, gap 2. */}
      <View
        style={{
          height: 34,
          flexShrink: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: 2,
          paddingStart: 12,
          paddingEnd: 8,
          borderBottomWidth: 1,
          borderBottomColor: colors.line,
        }}
      >
        <Text style={{ flex: 1, minWidth: 0, fontSize: 11, letterSpacing: 0.2, color: colors.muted, numberOfLines: 1 }}>
          {rootTitle()}
        </Text>
        <ToolbarButton icon="undo" label={t("sidebar.refreshExplorer")} onPress={() => reloads.set(reloads() + 1)} />
        <ToolbarButton
          icon={hiddenFilesShown() ? "eye" : "eye-off"}
          label={hiddenFilesShown() ? t("files.hideIgnoredFiles") : t("sidebar.showIgnoredFiles")}
          on={hiddenFilesShown()}
          onPress={toggleHidden}
        />
      </View>

      <If when={!activeCwd()}>
        <Inset padding={12}>
          <Caption label={t("files.noWorkingDirectory")} />
        </Inset>
      </If>
      <If when={rootFailure()}>
        {(message) => (
          <Inset padding={12}>
            <Text style={{ fontSize: 11.5, color: colors.danger }}>{message()}</Text>
          </Inset>
        )}
      </If>
      <If when={rootLoading()}>
        <Inset padding={12}>
          <Caption label={t("i18n.loading")} />
        </Inset>
      </If>

      <Tree
        style={{ flex: 1, minHeight: 0 }}
        // pi-next's `.filetree-rows`: padding 4 / 6 / 8.
        listStyle={{ paddingTop: 4, paddingBottom: 8, paddingHorizontal: 6 }}
        accessibilityLabel={rootPath() || t("files.paneTitle")}
        items={items()}
        expanded={expanded()}
        selected={selected()}
        itemClass={treeItemClass}
        renderItem={renderEntry}
        onExpandedChange={(event) => {
          const before = expanded();
          expanded.set(event.expanded);
          const root = activeCwd();
          if (root) rememberExpanded(root, event.expanded);
          // Only what just opened is read; a folder collapsed again keeps its
          // listing (the next expand shows it at once).
          for (const id of event.expanded) {
            if (!before.includes(id)) void load(id);
          }
        }}
        onSelectedChange={(event) => {
          selected.set(event.selected);
          // A file's selection opens it in its own tab, as pi-next's tree
          // does (`components/FileExplorer.tsx` → `openFileTab`); a folder is
          // left to `onAction` (it expands there). An already open file is
          // activated again rather than added twice.
          const id = event.selected;
          if (id !== null && !directoryIds().has(id)) {
            openFileTab(id);
          }
        }}
        onAction={(event) => {
          if (directoryIds().has(event.id)) return;
          selected.set(event.id);
          openFileTab(event.id);
        }}
      />
    </View>
  );
}
