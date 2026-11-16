// The changes panel: `git status` on the left, one file's `git diff` on the right.
//
//   GET /api/git/status?cwd=      `GitStatus`  (src/api/git.ts; `lib/git-types.ts`)
//   GET /api/git/diff?cwd=&path=  `{ supported, status?, patch? }`
//
// `nsh/base`'s `DiffView` draws the patch: it parses the unified diff itself
// (`DiffViewProps.patch`), numbers each side as the files have it, collapses
// the unchanged lines and highlights what changed within a line. Its colors are
// the kit's `diffViewStyles()` (added lines on the `up` tint, deleted on the
// `down` tint, the words a stronger tint of the same tone) and each change's
// first row carries its counts, tinted by `diffHunkTone()` — the tone of the
// row the actions would sit on, read only: this panel never reverts or keeps.
//
// The look is the gallery's (`ui/kit`): the panel is a section surface, its
// toolbar `Press` icon buttons, the file rows `plainRow` (a hairline between
// them), the states `Inset`s of `Caption`s, a Git failure the theme's danger
// tint. Numbers are pi-next's `.changes-panel__head` / `.tree-row__badge` /
// `.dline` (`app/v5/panel.css:180-760`): a 34-point head, a status badge 16
// points high with a 4-point dot, diff rows at 11.5 over 19 points.
//
// Statuses are colored with the tokens `theme.json` defines: there is no
// "success" or "warning" token, so an addition is the `up` tone, a deletion or
// a conflict the `down` one, a modification `warn` and a rename the brand's.

import { computed, resource, Scroll, Text, View } from "nsh";
import { DiffView } from "nsh/base";
import type { DiffHunk, DiffViewStyles } from "nsh/base";
import {
  getGitFileDiff,
  getGitStatus,
  type GitFileDiff,
  type GitFileStatus,
  type GitFileStatusKind,
  type GitStatus,
} from "../../api/git";
import { displayPathWithin, shortenPath } from "../../lib/display-path";
import { activeCwd } from "../../state/session";
import { t } from "../../ui/i18n";
import {
  alpha,
  Button,
  Caption,
  colors,
  diffHunkTone,
  diffViewStyles,
  Icon,
  Inset,
  mono,
  plainRow,
  Press,
  sectionSurface,
  solidTint,
  toneColor,
  toneTint,
  type IconName,
  type Tone,
} from "../../ui/kit";
import { wide } from "../../ui/kit/demo";
import { changeSelection, errorText } from "./state";

/** A Git status in the theme's tokens (`theme.json` has no "success"). */
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
 * A changed file's badge: pi-next's `.tree-row__badge` (16 points high,
 * 4-point corners, a 4-point dot then the one-letter code at 9.5 points
 * semibold, on the inset fill) in its status's tone.
 */
function ChangeBadge(props: { status: GitFileStatus }) {
  const tone = () => statusTone(props.status.status);
  return (
    <View
      accessibilityLabel={`${props.status.code}: ${t(STATUS_KEYS[props.status.status])}`}
      style={{
        height: 16,
        minWidth: 16,
        flexShrink: 0,
        paddingHorizontal: 4,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        borderRadius: 4,
        backgroundColor: colors.inset,
      }}
    >
      <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: toneColor(tone()) }} />
      <Text style={{ fontSize: 9.5, fontWeight: "600", letterSpacing: 0.2, color: toneColor(tone()) }}>{props.status.code}</Text>
    </View>
  );
}

/** A toolbar's icon button: 26 × 26 with a 14-point glyph (pi-next's head buttons). */
function ToolbarButton(props: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Press
      onPress={props.onPress}
      accessibilityLabel={props.label}
      style={{ width: 26, height: 26, alignItems: "center", justifyContent: "center", borderRadius: 7 }}
      hoverStyle={{ backgroundColor: alpha(colors.text, 0.05) }}
    >
      <Icon name={props.icon} size={14} tint={colors.faint} />
    </Press>
  );
}

/** The changes of `activeCwd()`, or of `cwd` when the shell passes one. */
export function ChangesView(props: { cwd?: () => string | null } = {}) {
  const cwd = computed(() => (props.cwd ? props.cwd() : activeCwd()));
  const statusRead = resource(
    computed(() => cwd()),
    async (directory, info) => ({
      cwd: directory,
      status: await getGitStatus(directory, { signal: info.signal }),
    }),
  );
  /** The repository's changes; another project's (kept while the next load runs) are not. */
  const status = computed<GitStatus | null>(() => {
    const value = statusRead();
    return value && value.cwd === cwd() ? value.status : null;
  });

  /** The file whose diff is open (an absolute path, as `status` reports it). */
  const selected = changeSelection;
  /** That file, while it is still one of the changed ones (a reload may drop it). */
  const shown = computed(() => {
    const path = selected();
    if (!path) return null;
    return (status()?.files ?? []).some((file) => file.filePath === path) ? path : null;
  });

  const diffRead = resource(
    computed(() => {
      const directory = cwd();
      const path = shown();
      return directory && path ? { cwd: directory, path } : null;
    }),
    async (asked, info) => ({
      path: asked.path,
      diff: await getGitFileDiff(asked.cwd, asked.path, { signal: info.signal }),
    }),
  );
  /** The open file's diff; a diff read for another file is not one (`resource` keeps its value while loading). */
  const diff = computed<GitFileDiff | null>(() => {
    const value = diffRead();
    return value && value.path === shown() ? value.diff : null;
  });

  const files = computed(() => status()?.files ?? []);
  const repositoryRoot = computed(() => status()?.repositoryRoot ?? cwd() ?? "");
  const title = computed(() => {
    const root = cwd();
    return root ? shortenPath(root) : t("changes.title");
  });

  /** A changed file's path as `./relative` inside the repository. */
  function relative(filePath: string): string {
    return displayPathWithin(filePath, repositoryRoot());
  }

  return (
    // The panel's frame: the kit's section surface, filled (`Card` sizes to its
    // content, as the gallery's own full-height panels note).
    <View style={{ ...sectionSurface(), flex: 1, minHeight: 0, overflow: "hidden" }}>
      {/* pi-next's `.changes-panel__head`: 34 points, 0 8 0 12, gap 8. */}
      <View
        style={{
          height: 34,
          flexShrink: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingStart: 12,
          paddingEnd: 8,
          borderBottomWidth: 1,
          borderBottomColor: colors.line,
        }}
      >
        <Text style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: colors.muted, numberOfLines: 1 }}>{title()}</Text>
        {/* The count pill's numbers: changed files, additions, deletions. */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ fontSize: 10.5, color: colors.muted, fontVariant: ["tabular-nums"] }}>{t("files.changedFiles", { count: files().length })}</Text>
          <Text style={{ fontSize: 10.5, color: colors.up, fontVariant: ["tabular-nums"] }}>{`+${status()?.additions ?? 0}`}</Text>
          <Text style={{ fontSize: 10.5, color: colors.down, fontVariant: ["tabular-nums"] }}>{`−${status()?.deletions ?? 0}`}</Text>
        </View>
        <ToolbarButton icon="undo" label={t("i18n.refresh")} onPress={() => statusRead.refetch()} />
      </View>

      <If when={!cwd()}>
        <Inset padding={12}>
          <Caption label={t("files.noWorkingDirectory")} />
        </Inset>
      </If>

      {/* Git itself could not be read: the route puts the message in the body. */}
      <If when={status()?.error}>
        {(message) => (
          <View style={{ padding: 12 }}>
            <View
              style={{
                gap: 5,
                padding: 11,
                borderWidth: 1,
                borderColor: alpha(colors.danger, 0.38),
                borderRadius: 10,
                backgroundColor: toneTint("danger"),
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: "600", color: colors.danger }}>{message()}</Text>
              <If when={status()?.hint}>
                {(hint) => (
                  <Text style={{ fontFamily: mono, fontSize: 10.5, lineHeight: 16, color: colors.muted, userSelect: "text" }}>{hint()}</Text>
                )}
              </If>
              <Button label={t("changes.retry")} variant="secondary" size="small" onPress={() => statusRead.refetch()} />
            </View>
          </View>
        )}
      </If>

      <If when={status()?.isGitRepository === false && !status()?.error}>
        <Inset padding={12}>
          <Caption label={t("changes.notRepository")} />
        </Inset>
      </If>
      <If when={statusRead.error()}>
        {(error) => (
          <Inset padding={12}>
            <Text style={{ fontSize: 11.5, color: colors.danger }}>{errorText(error())}</Text>
          </Inset>
        )}
      </If>

      <If when={status()?.isGitRepository === true && !status()?.error}>
        <View style={{ flex: 1, minHeight: 0, flexDirection: "row" }}>
          {/* The changed files: pi-next's review rows, 30 points high (the kit's
              compact row is 32), a hairline between them. */}
          <View style={{ width: 256, minHeight: 0, borderRightWidth: 1, borderRightColor: colors.line }}>
            <If when={files().length === 0}>
              <Inset padding={12}>
                <Caption label={t("files.noChanges")} />
              </Inset>
            </If>
            <Scroll style={{ flex: 1, minHeight: 0 }}>
              <View style={{ paddingVertical: 6, paddingHorizontal: 6 }}>
                <Each of={files()} key={(file) => file.filePath}>
                  {(file, index) => (
                    <Press
                      onPress={() => selected.set(file().filePath)}
                      accessibilityLabel={relative(file().filePath)}
                      accessibilityState={{ selected: shown() === file().filePath }}
                      style={{
                        ...plainRow({ first: index() === 0, dense: true }),
                        paddingHorizontal: 6,
                        borderRadius: 7,
                        backgroundColor: shown() === file().filePath ? toneTint("accent") : undefined,
                      }}
                      hoverStyle={{ backgroundColor: alpha(colors.text, 0.05) }}
                    >
                      <ChangeBadge status={file()} />
                      <Text
                        style={{
                          flex: 1,
                          minWidth: 0,
                          fontSize: 12.5,
                          numberOfLines: 1,
                          color: shown() === file().filePath ? colors.text : colors.muted,
                        }}
                      >
                        {relative(file().filePath)}
                      </Text>
                    </Press>
                  )}
                </Each>
              </View>
            </Scroll>
          </View>

          <View style={{ flex: 1, minHeight: 0 }}>
            <If
              when={shown()}
              else={
                <Inset padding={12}>
                  <Caption label={t("files.chooseFileToDiff")} />
                </Inset>
              }
            >
              <DiffBody diff={diff} diffError={diffRead.error} diffLoading={diffRead.loading} />
            </If>
          </View>
        </View>
      </If>
    </View>
  );
}

/** A `DiffView`'s colors and type: the kit's tones, pi-next's `.dline` metrics. */
function diffStyles(): DiffViewStyles {
  return {
    ...diffViewStyles(),
    // pi-next's `.dline__no`: 10.5 points, tabular (its gutter pads 6 from the number).
    lineNumber: { fontSize: 10.5, color: colors.faint, fontVariant: ["tabular-nums"] },
    // pi-next's `.dline.hunk`: the code's own row on the field's fill.
    separator: {
      backgroundColor: colors.inset,
      paddingHorizontal: 10,
      paddingVertical: 4,
      fontFamily: mono,
      fontSize: 11.5,
      color: colors.muted,
    },
  };
}

/** One file's patch, drawn by `nsh/base`'s `DiffView`. */
function DiffBody(props: { diff: () => GitFileDiff | null; diffError: () => unknown; diffLoading: () => boolean }) {
  /** The patch text, while the file has one (a binary or an untracked file has none). */
  const patch = computed(() => {
    const value = props.diff();
    return value?.supported && value.patch ? value.patch : null;
  });
  /** The diff's layout: side by side where there is room, one column otherwise. */
  const layout = computed(() => (wide() ? "split" : "unified"));
  /** The last error, if the read failed (a message in the diff's own box). */
  const failed = computed(() => {
    const value = props.diff();
    return value?.error ?? null;
  });

  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <If when={props.diffError()}>
        {(error) => (
          <Inset padding={12}>
            <Text style={{ fontSize: 11.5, color: colors.danger }}>{errorText(error())}</Text>
          </Inset>
        )}
      </If>
      <If when={failed()}>
        {(message) => (
          <Inset padding={12}>
            <Text style={{ fontSize: 11.5, color: colors.danger }}>{message()}</Text>
          </Inset>
        )}
      </If>
      <If when={props.diffLoading() && !patch()}>
        <Inset padding={12}>
          <Caption label={t("files.loadingDiff")} />
        </Inset>
      </If>
      <If when={props.diff() && !patch() && !failed()}>
        <Inset padding={12}>
          <Caption label={t("files.noTextDiff")} />
        </Inset>
      </If>

      <If when={patch()}>
        {(text) => (
          <DiffView
            style={{ flex: 1, minHeight: 0 }}
            patch={text()}
            layout={layout()}
            indicators="classic"
            // pi-next's diff text: 11.5 over 19-point rows (1.65).
            fontSize={11.5}
            lineHeight={19}
            // The diff's font: the app's monospaced list (a Latin mono face,
            // then the Chinese one its glyphs come from), not the theme's
            // one-family `font-mono`.
            fontFamily={mono}
            styles={diffStyles()}
            renderHunkActions={(hunk) => <HunkCounts hunk={hunk} layout={layout()} />}
          />
        )}
      </If>
    </View>
  );
}

/**
 * What a change's first row carries at its end, where the actions would sit: its
 * added and deleted lines, on the tone of that row (`diffHunkTone`: split, an
 * added line unless the change only deletes; unified, a deleted one unless it
 * only adds). Read only — this panel reverts nothing.
 */
function HunkCounts(props: { hunk: DiffHunk; layout: "split" | "unified" }) {
  return (
    <View
      style={{
        height: 20,
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: 6,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: 5,
        backgroundColor: solidTint(diffHunkTone(props.hunk, props.layout) ?? "neutral"),
      }}
    >
      <Text style={{ fontFamily: mono, fontSize: 10.5, color: colors.up, fontVariant: ["tabular-nums"] }}>{`+${props.hunk.newLines}`}</Text>
      <Text style={{ fontFamily: mono, fontSize: 10.5, color: colors.down, fontVariant: ["tabular-nums"] }}>{`−${props.hunk.oldLines}`}</Text>
    </View>
  );
}
