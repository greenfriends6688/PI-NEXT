// The session sidebar's row menus, in the gallery's menu look (`ui/kit`):
// `menuPopup` for the popup's surface and its backdrop, `menuItemLook` for a
// row, `MenuLabel` for a group's title, `menuSeparator` between the actions
// and the destructive one. pi-next's `SidebarMenu` offers the same entries
// (`lib/sidebar-actions.ts:40-79`): Pin / Unpin, Rename…, Fork, Archive (or
// Unarchive in the archive), Delete — and a project group's Rename…, Move
// up/down and Pin/Unpin (`SessionSidebar.tsx:2131-2250`).
//
// The menus are `nsh/base`'s `ContextMenu`s about their trigger: the secondary
// button on a desktop, a held finger on a touch screen (pi-next opens a row's
// menu the same way, `SessionTree.tsx:762`). Rename asks in a card dialog
// (`dialogCard`) with one field; Delete asks first, as pi-next does.
//
// NSH rules (`skills/nsh/references/tsx.md`): the component body runs once,
// every changing value is a binding read in JSX, `If` / `Each` for conditions.
//
// The project group menu also has "Archive sessions older than 7 days" (a
// confirmed bulk archive, in `SESSION_UI_IDS_PER_REQUEST` parts), "Delete all
// sessions" (a confirmed `POST /api/sessions/delete`, which keeps the running
// ones and says how many) and "Open in a new tab": the desktop shell opens no
// tabs, so it hands the project to the server's own web UI in the browser
// (`?cwd=`, the same deep link pi-next's new tab used).
// TODO(nsh): the archive view's bulk deletes are not here yet.

import { computed, signal, Text, View, WebView, windowSize } from "nsh";
import type { JSX } from "nsh";
import { ContextMenu, Dialog, Input, MenuItem, MenuSeparator } from "nsh/base";
import { autoNameSession, fetchSessionExport, saveSessionExport } from "../../api/misc";
import { deleteSession, forkSession, renameSession, type SessionInfo } from "../../api/sessions";
import { api, withToken } from "../../api/client";
import { openUrl } from "nsh";
import { selectSession, selectedSessionId } from "../../state/session";
import {
  backdrop,
  Button,
  colors,
  dialogCard,
  dialogText,
  dialogTitle,
  Icon,
  inputLook,
  menuItemGlyph,
  menuItemLabel,
  menuItemLook,
  menuPopup,
  menuSeparator,
  MenuLabel,
  type IconName,
} from "../../ui/kit";
import { sans } from "../../ui/fonts";
import { t } from "../../ui/i18n";
import { pushToast } from "../overlays/state";
import { openSideChatTab } from "../panel/actions";
import { chooseSession } from "../shell/state";
import {
  archiveSession,
  archiveSessions,
  collapsedGroups,
  deleteSessions,
  errorText,
  runningIds,
  forgetSession,
  isSessionPinned,
  moveProject,
  pinProject,
  pinSession,
  projectNameOf,
  renameProject,
  sessionTitleOf,
  setActionError,
  uiStateError,
  type SidebarGroup,
} from "./state";

/** Where a row sits: the pinned band, a project group, or the archive view. */
export type SessionMenuContext = "pinned" | "group" | "archive";

/** One entry of a menu: the kit's row, a leading glyph, a label. */
function MenuRow(props: {
  label: string;
  icon: IconName;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  const look = menuItemLook();
  return (
    <MenuItem
      disabled={props.disabled}
      onSelect={props.onSelect}
      style={look.style}
      hoverStyle={look.hoverStyle}
      focusStyle={look.focusStyle}
      activeStyle={look.activeStyle}
      disabledStyle={look.disabledStyle}
      accessibilityLabel={props.label}
    >
      <Icon name={props.icon} {...menuItemGlyph({ danger: props.danger })} />
      <Text style={menuItemLabel({ danger: props.danger })}>{props.label}</Text>
    </MenuItem>
  );
}

/**
 * A card dialog that asks for one line of text (`dialogCard`): the title, the
 * field, an inline error and Cancel / confirm. `open`, `value`, `busy` and
 * `error` are accessors so the dialog follows the store the caller keeps.
 */
function PromptDialog(props: {
  open: () => boolean;
  title: string;
  placeholder: string;
  value: () => string;
  onChange: (value: string) => void;
  confirmLabel: string;
  busy: () => boolean;
  error: () => string | null;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={props.open()}
      onOpenChange={(event) => {
        if (!event.open) props.onClose();
      }}
      accessibilityLabel={props.title}
      backdropStyle={backdrop()}
      style={dialogCard(340)}
    >
      <Text style={dialogTitle()}>{props.title}</Text>
      <Input
        {...inputLook({ style: { height: 32, borderRadius: 8, paddingHorizontal: 10, fontSize: 13, fontFamily: sans } })}
        value={props.value()}
        onChange={({ value }) => props.onChange(value)}
        onSubmit={() => props.onSubmit()}
        placeholder={props.placeholder}
        accessibilityLabel={props.placeholder}
      />
      <If when={props.error()}>
        <Text style={{ fontSize: 12, color: colors.danger }}>{props.error() ?? ""}</Text>
      </If>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
        <Button label={t("i18n.cancel")} variant="secondary" size="small" onPress={props.onClose} />
        <Button
          label={props.confirmLabel}
          size="small"
          busy={props.busy()}
          disabled={props.busy()}
          onPress={props.onSubmit}
        />
      </View>
    </Dialog>
  );
}

/** A card dialog that asks before something cannot be undone (a delete). */
function ConfirmDialog(props: {
  open: () => boolean;
  title: string;
  text: string;
  confirmLabel: string;
  busy: () => boolean;
  error: () => string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={props.open()}
      onOpenChange={(event) => {
        if (!event.open) props.onClose();
      }}
      accessibilityLabel={props.title}
      backdropStyle={backdrop()}
      style={dialogCard(340)}
    >
      <Text style={dialogTitle()}>{props.title}</Text>
      <Text style={dialogText()}>{props.text}</Text>
      <If when={props.error()}>
        <Text style={{ fontSize: 12, color: colors.danger }}>{props.error() ?? ""}</Text>
      </If>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
        <Button label={t("i18n.cancel")} variant="secondary" size="small" onPress={props.onClose} />
        <Button
          label={props.confirmLabel}
          variant="danger"
          size="small"
          busy={props.busy()}
          disabled={props.busy()}
          onPress={props.onConfirm}
        />
      </View>
    </Dialog>
  );
}

/**
 * A session row's menu about the row itself: the secondary button (desktop)
 * or a held finger (touch) on `children` opens it. A transient session has no
 * file yet — rename, fork, pin, archive and delete would all act on a missing
 * one — so it gets no menu, as `sessionMenuEntries` gives it none.
 *
 * `onChanged` reloads the list after a rename, a fork or a delete; archive and
 * pin go through the server state the panel already watches.
 */
export function SessionRowMenu(props: {
  session: () => SessionInfo;
  context: () => SessionMenuContext;
  /** A run is going: Archive waits for it to end, as pi-next disables it. */
  running: () => boolean;
  onChanged: () => void;
  children: JSX.Element;
}) {
  const renaming = signal(false);
  const renameText = signal("");
  const confirmingDelete = signal(false);
  const busy = signal(false);
  const error = signal<string | null>(null);
  const exporting = signal(false);
  const exportOpen = signal(false);
  const exportHtml = signal("");
  const exportFileName = signal("");
  const exportPath = signal<string | null>(null);
  const exportError = signal<string | null>(null);
  const autoNaming = signal(false);
  const sideBusy = signal(false);
  const popup = menuPopup();

  const beginRename = () => {
    renameText.set(sessionTitleOf(props.session()));
    error.set(null);
    renaming.set(true);
  };

  const submitRename = async () => {
    const session = props.session();
    const name = renameText().trim();
    if (!name) {
      error.set(t("sidebar.sessionNeedsName"));
      return;
    }
    if (name === sessionTitleOf(session)) {
      renaming.set(false);
      return;
    }
    busy.set(true);
    try {
      await renameSession(session.id, name);
      renaming.set(false);
      setActionError(null);
      props.onChanged();
    } catch (cause) {
      error.set(errorText(cause));
    } finally {
      busy.set(false);
    }
  };

  const submitDelete = async () => {
    const session = props.session();
    busy.set(true);
    try {
      await deleteSession(session.id);
      confirmingDelete.set(false);
      // Hide it before the list reloads, so the panel opens the next session
      // rather than the one that is gone.
      forgetSession(session.id);
      if (selectedSessionId() === session.id) selectSession(null);
      setActionError(null);
      props.onChanged();
    } catch (cause) {
      error.set(errorText(cause));
    } finally {
      busy.set(false);
    }
  };

  const fork = async () => {
    const session = props.session();
    try {
      const created = await forkSession(session.id);
      setActionError(null);
      chooseSession(created.session.id, created.session.cwd, sessionTitleOf(created.session));
      props.onChanged();
    } catch (cause) {
      setActionError(errorText(cause));
    }
  };

  const exportSession = async (): Promise<void> => {
    const session = props.session();
    if (exporting()) return;
    exporting.set(true);
    exportError.set(null);
    try {
      const exported = await fetchSessionExport(session.id);
      let saved: string | null = null;
      let saveError: string | null = null;
      try {
        saved = await saveSessionExport(exported);
      } catch (cause) {
        // The HTML is still here to preview; only the copy on disk failed
        // (NSH's fs writes at most 8 MiB and grants the app's data directory).
        saveError = t("sidebar.exportSaveFailed", { error: errorText(cause) });
      }
      exportHtml.set(exported.html);
      exportFileName.set(exported.fileName);
      exportPath.set(saved);
      exportError.set(saveError);
      exportOpen.set(true);
      setActionError(null);
    } catch (cause) {
      setActionError(t("sidebar.exportFailed", { error: errorText(cause) }));
    } finally {
      exporting.set(false);
    }
  };

  const autoName = async (): Promise<void> => {
    const session = props.session();
    if (autoNaming()) return;
    autoNaming.set(true);
    try {
      const result = await autoNameSession(session.id);
      setActionError(null);
      pushToast(t("sidebar.sessionNamedToast", { title: result.title }), { title: t("title.updated") });
      // The route invalidates the server's list cache; reload the rows so the
      // new title shows in the sidebar.
      props.onChanged();
    } catch (cause) {
      pushToast(errorText(cause), { title: t("title.failed"), tone: "danger", durationMs: 0 });
    } finally {
      autoNaming.set(false);
    }
  };

  const openSideChat = async () => {
    const session = props.session();
    if (sideBusy()) return;
    sideBusy.set(true);
    try {
      if (await openSideChatTab(session.id)) props.onChanged();
    } finally {
      sideBusy.set(false);
    }
  };

  const togglePin = async () => {
    const session = props.session();
    if (await pinSession(session.id, !isSessionPinned(session))) props.onChanged();
  };

  const setArchived = async (archived: boolean) => {
    const session = props.session();
    if (await archiveSession(session.id, archived)) props.onChanged();
  };

  return (
    <>
      <If when={!props.session().transient} else={props.children}>
        <ContextMenu
          trigger={props.children}
          popupStyle={popup.popupStyle}
          popupStartingStyle={popup.popupStartingStyle}
          backdropStyle={popup.backdropStyle}
        >
          {/* The archive view's way back, and its pin (which restores). */}
          <If when={props.context() === "archive"}>
            <MenuRow label={t("sidebar.unarchive")} icon="layers" onSelect={() => void setArchived(false)} />
            <MenuRow label={t("sidebar.pin")} icon="star" onSelect={() => void togglePin()} />
          </If>
          <If when={props.context() !== "archive"}>
            <MenuRow
              label={isSessionPinned(props.session()) ? t("sidebar.unpin") : t("sidebar.pin")}
              icon="star"
              onSelect={() => void togglePin()}
            />
          </If>
          <MenuRow label={t("sidebar.rename")} icon="text" onSelect={beginRename} />
          <MenuRow label={t("sidebar.fork")} icon="replace" onSelect={() => void fork()} />
          <MenuRow
            label={sideBusy() ? t("i18n.loading") : t("sideChat.new")}
            icon="chat"
            disabled={sideBusy()}
            onSelect={() => void openSideChat()}
          />
          <MenuRow
            label={exporting() ? t("sidebar.exportingHtml") : t("sidebar.exportHtml")}
            icon="download"
            disabled={exporting() || autoNaming()}
            onSelect={() => void exportSession()}
          />
          <MenuRow
            label={autoNaming() ? t("title.generating") : t("title.generate")}
            icon="spark"
            disabled={autoNaming() || exporting()}
            onSelect={() => void autoName()}
          />
          <If when={props.context() !== "archive"}>
            <MenuRow
              label={t("sidebar.archive")}
              icon="layers"
              disabled={props.running()}
              onSelect={() => void setArchived(true)}
            />
          </If>
          <MenuSeparator style={menuSeparator()} />
          <MenuRow
            label={t("sidebar.delete")}
            icon="trash"
            danger
            onSelect={() => {
              error.set(null);
              confirmingDelete.set(true);
            }}
          />
        </ContextMenu>
      </If>

      <If when={renaming()}>
        <PromptDialog
          open={() => renaming()}
          title={t("sidebar.renameSession")}
          placeholder={t("sidebar.sessionName")}
          value={() => renameText()}
          onChange={(value) => renameText.set(value)}
          confirmLabel={t("sidebar.rename")}
          busy={() => busy()}
          error={() => error()}
          onSubmit={() => void submitRename()}
          onClose={() => renaming.set(false)}
        />
      </If>
      <If when={confirmingDelete()}>
        <ConfirmDialog
          open={() => confirmingDelete()}
          title={t("sidebar.deleteSession", { title: sessionTitleOf(props.session()) })}
          text={t("sidebar.deleteArchivedMessage")}
          confirmLabel={t("sidebar.delete")}
          busy={() => busy()}
          error={() => error()}
          onConfirm={() => void submitDelete()}
          onClose={() => confirmingDelete.set(false)}
        />
      </If>

      <If when={exportOpen()}>
        <Dialog
          open={exportOpen()}
          onOpenChange={(event) => {
            if (event.open) return;
            exportOpen.set(false);
            // A whole transcript can be several megabytes; release it.
            exportHtml.set("");
          }}
          accessibilityLabel={t("sidebar.sessionExported")}
          backdropStyle={backdrop()}
          style={{ ...dialogCard(760), height: Math.max(360, Math.min(640, windowSize().height - 80)) }}
        >
          <View style={{ gap: 2 }}>
            <Text style={dialogTitle()}>{t("sidebar.sessionExported")}</Text>
            <Text style={dialogText()}>
              {exportPath()
                ? t("sidebar.exportSavedTo", { path: exportPath() ?? "" })
                : exportFileName()
                  ? t("sidebar.exportNoDirectory", { file: exportFileName() })
                  : t("sidebar.exportGenerating")}
            </Text>
            <If when={exportError()}>
              <Text style={{ fontSize: 12, color: colors.danger }}>{exportError() ?? ""}</Text>
            </If>
          </View>
          <WebView
            html={exportHtml()}
            accessibilityLabel={t("sidebar.exportPreview")}
            style={{ flex: 1, minHeight: 220, borderRadius: 8 }}
          />
          <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
            <Button
              label={t("i18n.close")}
              variant="secondary"
              size="small"
              onPress={() => {
                exportOpen.set(false);
                exportHtml.set("");
              }}
            />
          </View>
        </Dialog>
      </If>
    </>
  );
}

/**
 * A project group's menu about its header: Rename… (a display name, stored on
 * the server), Move up / Move down (the stored project order), Pin / Unpin
 * project, and "Archive sessions older than 7 days" (asked first, then sent in
 * parts). `order` is the project order on screen, so a move saves the band's
 * unsaved keys first and lands where the user saw it.
 */
export function ProjectHeaderMenu(props: {
  group: () => SidebarGroup;
  order: () => string[];
  /** Root ids a "Archive sessions older than 7 days" click would archive (the panel computes them). */
  olderIds: () => string[];
  /** Every session id of this project, subagents included: what "Delete all sessions" removes. */
  allIds: () => string[];
  children: JSX.Element;
}) {
  const renaming = signal(false);
  const renameText = signal("");
  const busy = signal(false);
  const error = signal<string | null>(null);
  const confirmingArchive = signal(false);
  const archiveIds = signal<string[]>([]);
  const archiveBusy = signal(false);
  const archiveError = signal<string | null>(null);
  const olderCount = computed(() => props.olderIds().length);
  const confirmingDeleteAll = signal(false);
  const deleteAllIds = signal<string[]>([]);
  const deleteAllBusy = signal(false);
  const deleteAllError = signal<string | null>(null);
  const deleteAllCount = computed(() => props.allIds().length);
  /** The ones the server will keep: a running session is never deleted. */
  const runningCount = computed(() => props.allIds().filter((id) => runningIds().includes(id)).length);
  const popup = menuPopup();

  const index = () => props.order().indexOf(props.group().key);
  const canMoveUp = () => index() > 0;
  const canMoveDown = () => index() >= 0 && index() < props.order().length - 1;

  const beginRename = () => {
    renameText.set(props.group().name);
    error.set(null);
    renaming.set(true);
  };

  const submitRename = async () => {
    const group = props.group();
    busy.set(true);
    try {
      // The write's refusal is the panel's banner; keep the dialog open with it.
      if (await renameProject(group.key, group.root, renameText())) {
        renaming.set(false);
        setActionError(null);
      } else {
        error.set(uiStateError() ?? t("sidebar.renameProjectFailed"));
      }
    } finally {
      busy.set(false);
    }
  };

  const move = async (position: "before" | "after") => {
    const order = props.order();
    const at = order.indexOf(props.group().key);
    const anchor = position === "before" ? order[at - 1] : order[at + 1];
    if (anchor === undefined) return;
    await moveProject(props.group().key, anchor, position, order);
  };

  // A bulk archive asks first, as pi-next's question does: it takes every
  // family of this project idle for seven days, not the row under the pointer.
  /**
   * "Delete all sessions": every id of the project, confirmed first. Running
   * sessions are kept by the server, which reports them back.
   */
  const beginDeleteAll = () => {
    const ids = props.allIds();
    if (ids.length === 0) return;
    deleteAllIds.set(ids);
    deleteAllError.set(null);
    confirmingDeleteAll.set(true);
  };

  const submitDeleteAll = async () => {
    deleteAllBusy.set(true);
    try {
      const result = await deleteSessions(deleteAllIds());
      if (!result) {
        deleteAllError.set(uiStateError() ?? t("sidebar.deleteFailed"));
        return;
      }
      confirmingDeleteAll.set(false);
      setActionError(null);
      if (result.running > 0) {
        pushToast(t("sidebar.deleteProjectSessionsRunning", { count: result.running }), { tone: "warn" });
      }
    } finally {
      deleteAllBusy.set(false);
    }
  };

  /** "Open in a new tab": the same project in the server's own web UI, in the browser. */
  const openInBrowserTab = () => {
    const url = withToken(
      api.base(),
      `/?cwd=${encodeURIComponent(props.group().root)}`,
      api.token(),
    );
    void openUrl(url).catch(() => undefined);
  };

  const beginArchiveOlder = () => {
    const ids = props.olderIds();
    if (ids.length === 0) return;
    archiveIds.set(ids);
    archiveError.set(null);
    confirmingArchive.set(true);
  };

  const submitArchiveOlder = async () => {
    archiveBusy.set(true);
    try {
      if (await archiveSessions(archiveIds())) {
        confirmingArchive.set(false);
        setActionError(null);
      } else {
        archiveError.set(uiStateError() ?? t("sidebar.archiveFailed"));
      }
    } finally {
      archiveBusy.set(false);
    }
  };

  return (
    <>
      <ContextMenu
        trigger={props.children}
        popupStyle={popup.popupStyle}
        popupStartingStyle={popup.popupStartingStyle}
        backdropStyle={popup.backdropStyle}
      >
        <MenuLabel text={t("workspace.project")} />
        <MenuRow label={t("sidebar.renameProject")} icon="text" onSelect={beginRename} />
        <MenuRow
          label={t("sidebar.moveProjectUp")}
          icon="chevron-up"
          disabled={!canMoveUp()}
          onSelect={() => void move("before")}
        />
        <MenuRow
          label={t("sidebar.moveProjectDown")}
          icon="chevron-down"
          disabled={!canMoveDown()}
          onSelect={() => void move("after")}
        />
        <MenuRow
          label={t("sidebar.collapseOtherGroups")}
          icon="collapsible"
          onSelect={() => collapsedGroups.set(props.order().filter((key) => key !== props.group().key))}
        />
        <MenuRow
          label={t("sidebar.expandAllGroups")}
          icon="layers"
          onSelect={() => collapsedGroups.set([])}
        />
        <MenuRow
          label={t("sidebar.openInNewTab")}
          icon="external"
          onSelect={openInBrowserTab}
        />
        <MenuSeparator style={menuSeparator()} />
        <MenuRow
          label={props.group().pinned ? t("sidebar.unpinProject") : t("sidebar.pinProject")}
          icon="star"
          onSelect={() => void pinProject(props.group().key, props.group().root, !props.group().pinned)}
        />
        <MenuSeparator style={menuSeparator()} />
        <MenuRow
          label={t("sidebar.archiveOlderThanWeek", { count: olderCount() })}
          icon="layers"
          disabled={olderCount() === 0}
          onSelect={beginArchiveOlder}
        />
        <MenuSeparator style={menuSeparator()} />
        <MenuRow
          label={t("sidebar.deleteProjectSessions", { count: deleteAllCount() })}
          icon="trash"
          disabled={deleteAllCount() === 0}
          onSelect={beginDeleteAll}
        />
      </ContextMenu>

      <If when={renaming()}>
        <PromptDialog
          open={() => renaming()}
          title={t("sidebar.renameProjectHeading")}
          placeholder={projectNameOf(props.group().root)}
          value={() => renameText()}
          onChange={(value) => renameText.set(value)}
          confirmLabel={t("sidebar.rename")}
          busy={() => busy()}
          error={() => error()}
          onSubmit={() => void submitRename()}
          onClose={() => renaming.set(false)}
        />
      </If>
      <If when={confirmingArchive()}>
        <ConfirmDialog
          open={() => confirmingArchive()}
          title={t("sidebar.archiveOlderHeading")}
          text={t("sidebar.archiveOlderMessage", { count: archiveIds().length, name: props.group().name })}
          confirmLabel={t("sidebar.archive")}
          busy={() => archiveBusy()}
          error={() => archiveError()}
          onConfirm={() => void submitArchiveOlder()}
          onClose={() => confirmingArchive.set(false)}
        />
      </If>
      <If when={confirmingDeleteAll()}>
        <ConfirmDialog
          open={() => confirmingDeleteAll()}
          title={t("sidebar.deleteProjectSessionsHeading", { name: props.group().name })}
          text={`${t("sidebar.deleteProjectSessionsMessage")}\n${t("sidebar.deleteProjectSessionsRunning", { count: runningCount() })}`}
          confirmLabel={t("sidebar.delete")}
          busy={() => deleteAllBusy()}
          error={() => deleteAllError()}
          onConfirm={() => void submitDeleteAll()}
          onClose={() => confirmingDeleteAll.set(false)}
        />
      </If>
    </>
  );
}
