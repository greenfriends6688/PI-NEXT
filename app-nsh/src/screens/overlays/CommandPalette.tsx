// ⌘K / Ctrl+K: the command palette.
//
// pi-next's palette (components/CommandPalette.tsx) filtered its own list,
// moved a selected row with the arrows and ran it on Return. Here `nsh/base`'s
// `Command` owns all of that natively: the query filters by label and
// keywords, the arrows move past disabled rows, Return chooses, Escape clears
// the query and then reports `onCancel`. Every pixel is the kit's
// (`commandClasses`, `CommandRow`, `CommandHeading`, `CommandEmpty`, `Kbd`)
// on the shared popup surface, sized as pi-next's `app/v5/palette.css`:
// 560 wide, 16 vh from the top, a 48-point search bar, 40-point rows, 11-point
// section headings and keys in the footer.
//
// The open flag lives in `state.ts`, so the shell only mounts this component
// once; `keymap.bind` in its body is removed with it (`docs/dev/js-modules.md`).
// pi-next's focus restore on close is `Dialog`'s (`nsh-platform-web`'s
// `present()` remembers the opener and returns focus; the native layers do
// the same).
import { keymap, platform, Text, View, windowSize } from "nsh";
import { Command, Dialog, type CommandItem, type CommandRef } from "nsh/base";
import { abortComposer } from "../../state/composer";
import { agentRunning, sendAgentCommand } from "../../state/agent";
import { activeFileTab, showFilesTab } from "../files/tabs";
import {
  openSettings,
  rightPane,
  selectSession,
  selectedSessionId,
  showRightPane,
} from "../../state/session";
import {
  backdrop,
  colors,
  CommandEmpty,
  CommandHeading,
  CommandRow,
  commandClasses,
  Icon,
  type IconName,
  Kbd,
  popupSurface,
} from "../../ui/kit";
import { errorText, uiText } from "../../ui/errors";
import { t } from "../../ui/i18n";
import { commandCount, commandOpen, closeCommand, pushToast, toggleCommand } from "./state";

/** What a palette row shows beside its label: an icon and a quiet detail line. */
interface CommandLook {
  icon: IconName;
  detailKey: string;
}

/**
 * The commands are real actions of this app, in pi-next's groups. A command
 * that cannot run now is `disabled` (its keys pass over it) rather than
 * hidden, as pi-next disabled "Share" while there was nothing to share.
 */
const LOOKS: Record<string, CommandLook> = {
  "new-session": { icon: "plus", detailKey: "commandPalette.detailNewSession" },
  "stop-run": { icon: "pause", detailKey: "commandPalette.detailStopRun" },
  compact: { icon: "layers", detailKey: "commandPalette.detailCompact" },
  "pane-files": { icon: "folder", detailKey: "commandPalette.detailFiles" },
  "pane-changes": { icon: "diff", detailKey: "commandPalette.detailChanges" },
  "pane-terminal": { icon: "terminal", detailKey: "commandPalette.detailTerminal" },
  settings: { icon: "sliders", detailKey: "commandPalette.detailSettings" },
};

/** The rows, built from the app's state (read in the JSX binding below). */
function commands(): CommandItem[] {
  const sessionId = selectedSessionId();
  const running = agentRunning();
  const pane = rightPane();
  const list: CommandItem[] = [
    { id: "new-session", label: t("commandPalette.newSession"), group: t("commandPalette.groupSession"), keywords: ["chat", "create", "start"] },
  ];
  if (sessionId) {
    list.push(
      { id: "stop-run", label: t("commandPalette.stopRun"), group: t("commandPalette.groupSession"), keywords: ["abort", "cancel", "interrupt"], disabled: !running },
      { id: "compact", label: t("commandPalette.compactConversation"), group: t("commandPalette.groupSession"), keywords: ["summarize", "context", "tokens"] },
    );
  }
  list.push(
    { id: "pane-files", label: t("commandPalette.showFiles"), group: t("commandPalette.groupView"), keywords: ["browse", "folder"], checked: pane === "files" && activeFileTab() === null },
    { id: "pane-changes", label: t("commandPalette.showChanges"), group: t("commandPalette.groupView"), keywords: ["diff", "git"], checked: pane === "changes" },
    { id: "pane-terminal", label: t("commandPalette.showTerminal"), group: t("commandPalette.groupView"), keywords: ["shell", "console"], checked: pane === "terminal" },
    { id: "settings", label: t("commandPalette.openSettings"), group: t("commandPalette.groupApp"), keywords: ["preferences", "models", "mcp"] },
  );
  return list;
}

/** Runs a row; the palette closes first, as pi-next closes before `onSelect`. */
function runCommand(id: string): void {
  closeCommand();
  const sessionId = selectedSessionId();
  switch (id) {
    case "new-session":
      selectSession(null);
      return;
    case "stop-run":
      if (sessionId) void abortComposer(sessionId);
      return;
    case "compact":
      void sendAgentCommand({ type: "compact" }).catch((error: unknown) => {
        pushToast(uiText("chat.compactionFailed", { message: errorText(error) }), { tone: "danger" });
      });
      return;
    case "pane-files":
      showFilesTab();
      return;
    case "pane-changes":
      if (rightPane() !== "changes") showRightPane("changes");
      return;
    case "pane-terminal":
      if (rightPane() !== "terminal") showRightPane("terminal");
      return;
    case "settings":
      openSettings();
      return;
    default:
      return;
  }
}

/** pi-next's 16 vh above the panel under a pointer, its 8 vh (at least 52) on a touch screen. */
function topInset(): number {
  const height = windowSize().height;
  return platform.desktop ? Math.max(52, Math.round(height * 0.16)) : Math.max(52, Math.round(height * 0.08));
}

/** The panel's room: at most 520, never past the window below `topInset()`. */
function panelHeight(): number {
  return Math.max(260, Math.min(520, windowSize().height - topInset() - 24));
}

/** The keys' hints, as pi-next's `.pal-foot` (38 points, 11-point labels). */
function PaletteFooter() {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 38,
        paddingHorizontal: 12,
        borderTopWidth: 1,
        borderTopColor: colors.line,
      }}
    >
      <Kbd label="↑" />
      <Kbd label="↓" />
      <Text style={{ fontSize: 11, color: colors.faint }}>{t("commandPalette.select")}</Text>
      <Kbd label="↵" />
      <Text style={{ fontSize: 11, color: colors.faint }}>{t("commandPalette.run")}</Text>
      <Kbd label="Esc" />
      <Text style={{ fontSize: 11, color: colors.faint }}>{t("commandPalette.close")}</Text>
      <If when={commandCount() > 0}>
        <Text style={{ marginLeft: "auto", fontSize: 11, color: colors.muted, fontVariant: ["tabular-nums"] }}>
          {t("commandPalette.resultCount", { count: commandCount() })}
        </Text>
      </If>
    </View>
  );
}

/** The palette. Mount it once (the shell keeps it mounted); it is its own ⌘K binding. */
export function CommandPalette() {
  let palette: CommandRef | undefined;

  // `Command` filters natively, so the matched count comes back as a promise.
  // TODO(nsh): verify that `matchedCount()` resolves on the first frame after
  // the panel opens; the count in the footer is best-effort until it does.
  const syncCount = () => {
    void palette
      ?.matchedCount()
      .then((count) => commandCount.set(count))
      .catch(() => undefined);
  };

  // The binding belongs to this component: `keymap.bind` made while a
  // component renders is removed with it (`docs/dev/js-modules.md`).
  keymap.bind("mod+k", toggleCommand);

  // TODO(nsh): `Command` spends the first Escape clearing a non-empty query
  // and only then reports `onCancel`, while pi-next closes the palette on any
  // Escape. Once the palette owns the query, bind Escape only while this
  // dialog is the top layer (pi's `lib/stacked-dialog.ts`), not globally.
  // TODO(nsh): verify the 16 vh offset on every platform: `Dialog` owns the
  // layer and this style pads its popup.

  return (
    <Dialog
      open={commandOpen()}
      animation="fade"
      accessibilityLabel={t("commandPalette.label")}
      closeOnEscape={true}
      closeOnBackdropPress={true}
      onOpenChange={(event) => {
        if (!event.open) closeCommand();
      }}
      onOpen={() => {
        // The panel is made in this same turn; count after it exists.
        setTimeout(syncCount, 0);
      }}
      backdropStyle={{ ...backdrop(), backdropFilter: "blur(8px)" }}
      style={{
        width: "100%",
        alignItems: "center",
        paddingTop: topInset(),
        paddingHorizontal: 16,
        paddingBottom: 16,
      }}
    >
      <View style={{ width: 560, maxWidth: "100%" }}>
        <Command
          ref={(ref) => {
            palette = ref;
          }}
          items={commands()}
          autoFocus
          placeholder={t("commandPalette.searchPlaceholderCommands")}
          accessibilityLabel={t("commandPalette.groupCommands")}
          searchAccessibilityLabel={t("commandPalette.searchPlaceholder")}
          class={commandClasses.root}
          // `popupSurface` is the floating tier every menu shares; the
          // palette's own rows pad themselves (`commandClasses.list`), so the
          // surface's 4 points are dropped.
          style={[popupSurface(), { padding: 0, height: panelHeight(), borderRadius: 12 }]}
          searchBarClass={commandClasses.searchBar}
          // pi-next's `.pal-search` is 48 points; the kit's field is 44.
          searchBarStyle={{ height: 48 }}
          searchClass={commandClasses.search}
          searchStyle={{ height: 48, fontSize: 13.5 }}
          listClass={commandClasses.list}
          groupClass={commandClasses.group}
          separatorClass={commandClasses.separator}
          itemClass={commandClasses.item}
          searchPrefix={<Icon name="search" size={16} tint={colors.muted} />}
          searchSuffix={<Kbd label="Esc" />}
          empty={<CommandEmpty label={t("commandPalette.empty")} />}
          footer={<PaletteFooter />}
          renderGroup={(group) => <CommandHeading group={group} />}
          renderItem={(entry) => (
            <CommandRow
              entry={entry}
              icon={LOOKS[entry.id]?.icon}
              // A detail makes the row 40 points, pi-next's `.pal-row` height.
              detail={LOOKS[entry.id] ? t(LOOKS[entry.id].detailKey) : undefined}
            />
          )}
          onSelect={({ id }) => runCommand(id)}
          onHighlightChange={() => syncCount()}
          onQueryChange={() => syncCount()}
          onCancel={() => closeCommand()}
        />
      </View>
    </Dialog>
  );
}
