// The fresh composer's project bar: the folder the first message starts in and
// the ways to change it. It is the row above the composer on the welcome page
// (`screens/new-session/FreshSession.tsx`), as pi-next's `NewSessionContextBar`
// sits above a fresh composer; sending is the composer's job, not this bar's.
//
// The folder comes from `state/session.ts` (`activeCwd`), which a previous
// session leaves behind, so "+ New session" starts in the project last used.
// The project pill opens a menu of the projects the sidebar already lists,
// today's default directory, and the system's folder chooser (Finder on macOS;
// a platform without one falls back to the app's directory browser). Either
// folder is validated and goes through the trust step.
//
// The look is the gallery kit (`../../ui/kit`): a project pill as the menu's
// trigger, the worktree menu beside it, the path in the mono face, and the
// Composer's slash palette look for the menu.

import { effect, resource, Scroll, signal, Text, untracked, View } from "nsh";
import { Menu, MenuItem, MenuSeparator } from "nsh/base";

import { WorktreeMenu } from "./WorktreeMenu";
import { createDefaultCwd, getHome, validateCwd } from "../../api/cwd";
import { listSessions, type SessionInfo } from "../../api/sessions";
import { readUiState, type SessionUiState } from "../../api/ui-state";
import { chatContentWidth } from "../../lib/chat-width";
import { shortenPath } from "../../lib/display-path";
import { activeCwd, openCwdPicker, pendingCwd, stagePendingCwd } from "../../state/session";
import { pickSystemFolder } from "../../lib/system-folder";
import {
  colors,
  Icon,
  menuItemLabel,
  menuItemLook,
  menuItemNote,
  menuPopup,
  menuSeparator,
  MenuLabel,
  mono,
  popoverLook,
  Press,
} from "../../ui/kit";
import { errorText } from "../../ui/errors";
import { t } from "../../ui/i18n";
import { SettingsError, SettingsNote } from "../settings/parts";
import { projectRootOf, projectTitle, workspaceKeyOf } from "../sidebar/state";

function messageOf(error: unknown): string {
  return errorText(error);
}

/** Last path segment (a project's name in the bar). */
function leafName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** One project row: its stable key, the folder it switches to, and its display name. */
interface ProjectChoice {
  key: string;
  root: string;
  name: string;
  /** The newest activity of its sessions, for the order of projects without a saved place. */
  modified: string;
  /** Its first appearance in the list, which keeps equal times in the list's own order. */
  index: number;
}

/**
 * The sidebar's projects, from the same session list and server state it reads:
 * one row per `workspaceKeyOf`, the folder from `projectRootOf`, the name from
 * `projectTitle` (the user's rename, else the folder's). `projectOrder` comes
 * first; the projects it does not name follow, most recently used first, as
 * pi-next's `getRecentProjects` sorts them.
 */
function projectChoicesOf(
  sessions: readonly SessionInfo[],
  state: SessionUiState | null,
): ProjectChoice[] {
  const byKey = new Map<string, Omit<ProjectChoice, "name">>();
  for (const session of sessions) {
    const key = workspaceKeyOf(session);
    if (!key) continue;
    const root = projectRootOf(session);
    if (!root) continue;
    const previous = byKey.get(key);
    if (!previous) {
      byKey.set(key, { key, root, modified: session.modified, index: byKey.size });
      continue;
    }
    // The newest session names the project's folder, as the recent-projects
    // list does; a summary row's `modified` is still the order the list gave.
    if (session.modified > previous.modified) {
      previous.modified = session.modified;
      previous.root = root;
    }
  }

  const rank = new Map<string, number>();
  for (const [index, key] of (state?.projectOrder ?? []).entries()) {
    // The first place a key has wins, so a duplicate cannot demote it.
    if (!rank.has(key)) rank.set(key, index);
  }
  return [...byKey.values()]
    .sort((a, b) => {
      const aRank = rank.get(a.key);
      const bRank = rank.get(b.key);
      if (aRank !== undefined && bRank !== undefined) return aRank - bRank;
      if (aRank !== undefined) return -1;
      if (bRank !== undefined) return 1;
      return b.modified.localeCompare(a.modified) || a.index - b.index;
    })
    .map((project) => ({ ...project, name: projectTitle(state, project.key, project.root) }));
}

/** A project key as a test id: a path's separators and spaces would make the id unreadable. */
function projectChoiceTestID(key: string): string {
  const safe = key.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `project-choice:${safe || "project"}`;
}

export function NewSessionBar() {
  const selecting = signal(false);
  const error = signal<string | null>(null);

  // A failure belongs to the folder it happened in (or to a folder change).
  effect(() => {
    activeCwd();
    pendingCwd();
    untracked(() => error.set(null));
  });

  // The home folder shows the current path as ~. A failed read is harmless:
  // the path still shows, shortened by the display-only fallback.
  const home = resource(async (info) => {
    try {
      return (await getHome({ signal: info.signal })).home;
    } catch {
      return "";
    }
  });

  const displayPath = (path: string): string => {
    const homeDir = home();
    if (homeDir && (path === homeDir || path.startsWith(`${homeDir}/`) || path.startsWith(`${homeDir}\\`))) {
      return `~${path.slice(homeDir.length)}`;
    }
    return shortenPath(path);
  };

  const displayCwd = (): string => {
    const path = activeCwd();
    return path ? displayPath(path) : "";
  };

  // The projects the sidebar has sessions for. A failed read is quiet: the
  // menu still offers the default directory and "Open another project…", so a
  // first-run user is never stuck without a folder.
  const projects = resource(async (info) => {
    const [sessions, state] = await Promise.all([
      listSessions({ summary: true })
        .then((list) => list.sessions)
        .catch(() => [] as SessionInfo[]),
      readUiState({ signal: info.signal }).catch(() => null),
    ]);
    return projectChoicesOf(sessions, state);
  });

  // Read once while the bar mounts: the menu opens on a press and must already
  // hold its rows, and a resource first read inside the popup would start its
  // read only after the popup had drawn an empty list.
  projects();

  const choices = (): ProjectChoice[] => projects() ?? [];

  const busy = () => selecting() || pendingCwd() !== null;

  /** The project in use: its own root, or the key a session there reported. */
  const isCurrentProject = (project: ProjectChoice): boolean => {
    const cwd = activeCwd();
    return cwd !== null && (project.root === cwd || project.key === cwd);
  };

  /**
   * The project pill's menu opens the system's folder chooser (Finder on
   * macOS); a platform without one — or a chooser that answers nothing — falls
   * back to the app's directory browser. The chosen folder goes through
   * validation and the trust step, as any move.
   */
  const pickProjectFolder = async (): Promise<void> => {
    if (busy()) return;
    error.set(null);
    selecting.set(true);
    try {
      const picked = await pickSystemFolder(t("directoryPicker.selectDirectory"));
      if (picked.status === "unavailable") {
        openCwdPicker(activeCwd());
        return;
      }
      if (picked.status === "cancelled") return;
      stagePendingCwd(await validateCwd(picked.path));
    } catch (cause) {
      error.set(messageOf(cause));
    } finally {
      selecting.set(false);
    }
  };

  /**
   * A project row moves the fresh composer to that project's root. The trust
   * dialog decides whether it may be used; the row for the folder already in
   * use does nothing, as a press on the project in use does in pi-next.
   */
  const chooseProject = async (project: ProjectChoice): Promise<void> => {
    if (busy() || project.root === activeCwd()) return;
    error.set(null);
    selecting.set(true);
    try {
      stagePendingCwd(await validateCwd(project.root));
    } catch (cause) {
      error.set(messageOf(cause));
    } finally {
      selecting.set(false);
    }
  };

  /**
   * "Use default directory" asks the server to make today's `~/pi-cwd`
   * folder, then validates it like any other pick, so the trust step and the
   * file allow-list see the same folder the session will run in.
   */
  const useDefaultDirectory = async (): Promise<void> => {
    if (busy()) return;
    error.set(null);
    selecting.set(true);
    try {
      const created = await createDefaultCwd();
      stagePendingCwd(await validateCwd(created.cwd));
    } catch (cause) {
      error.set(messageOf(cause));
    } finally {
      selecting.set(false);
    }
  };

  const popup = menuPopup({ side: "top", minWidth: 320 });
  const surface = popoverLook({ compact: true });
  const projectRow = menuItemLook({ tall: true });
  const actionRow = menuItemLook();

  return (
    <View
      style={{
        width: "100%",
        maxWidth: chatContentWidth(),
        alignSelf: "center",
        paddingHorizontal: 24,
        paddingBottom: 6,
        gap: 6,
      }}
    >
      {/* The project row, as the web's `NewSessionContextBar`: the project as
          a pill (a press opens its menu), its worktrees beside it, and the rest
          of the folder actions inside that menu — a row, not a card of its own. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Menu
          placement="top"
          align="start"
          offset={8}
          trigger={
            <Press
              disabled={busy()}
              accessibilityLabel={t("workspace.changeFolder")}
              style={{
                flexShrink: 1,
                minWidth: 0,
                maxWidth: 380,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                height: 34,
                paddingHorizontal: 10,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colors.fieldBorder,
                backgroundColor: colors.field,
              }}
              hoverStyle={busy() ? undefined : { backgroundColor: colors.raised, borderColor: colors.faint }}
            >
              <Icon name="folder" size={15} tint={activeCwd() ? colors.accent : colors.faint} />
              <View testID="new-session-project" style={{ flex: 1, minWidth: 0 }}>
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: "600",
                    color: activeCwd() ? colors.text : colors.muted,
                    numberOfLines: 1,
                  }}
                >
                  {activeCwd() ? leafName(activeCwd()!) : t("workspace.noFolderSelected")}
                </Text>
                <Text style={{ fontSize: 10, fontFamily: mono, color: colors.faint, numberOfLines: 1 }}>
                  {activeCwd() ? displayCwd() : t("workspace.pickFolderToStart")}
                </Text>
              </View>
              <Icon name="chevron-down" size={9} tint={colors.faint} />
            </Press>
          }
          popupStyle={{ ...popup.popupStyle, ...surface }}
          popupStartingStyle={popup.popupStartingStyle}
          backdropStyle={popup.backdropStyle}
          onOpenChange={({ open }) => {
            // Sessions and their names change outside this page (the CLI, the
            // sidebar's rename): every opening asks the server again.
            if (open) projects.refetch();
          }}
        >
          <View testID="new-session-project-menu" style={{ gap: 2 }}>
            <If when={choices().length > 0}>
              <MenuLabel text={t("sidebar.projects")} />
              {/* The project list scrolls inside a capped well so the two
                  actions under it ("Use default directory", "Open another
                  project…") stay on screen with a long history of projects. */}
              <Scroll style={{ maxHeight: 300 }} scrollbar={false}>
              <View style={{ gap: 2 }}>
                <Each of={choices()} key={(project: ProjectChoice) => project.key}>
                  {(project) => (
                    <MenuItem
                      testID={projectChoiceTestID(project().key)}
                      disabled={busy()}
                      onSelect={() => void chooseProject(project())}
                      accessibilityLabel={`${project().name}, ${project().root}`}
                      style={projectRow.style}
                      hoverStyle={projectRow.hoverStyle}
                      focusStyle={projectRow.focusStyle}
                      activeStyle={projectRow.activeStyle}
                      disabledStyle={projectRow.disabledStyle}
                    >
                      <View style={{ width: 14, paddingTop: 2, alignItems: "center" }}>
                        <If when={isCurrentProject(project())}>
                          <Icon name="check" size={14} tint={colors.accent} />
                        </If>
                      </View>
                      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                        <Text
                          style={{
                            ...menuItemLabel(),
                            fontWeight: isCurrentProject(project()) ? "600" : "400",
                          }}
                        >
                          {project().name}
                        </Text>
                        <Text style={{ ...menuItemNote(), fontSize: 10.5, fontFamily: mono }}>
                          {displayPath(project().root)}
                        </Text>
                      </View>
                    </MenuItem>
                  )}
                </Each>
              </View>
              </Scroll>
            </If>

            <If when={choices().length > 0}>
              <MenuSeparator style={menuSeparator()} />
            </If>

            <MenuItem
              testID="project-default-dir"
              disabled={busy()}
              onSelect={() => void useDefaultDirectory()}
              accessibilityLabel={t("sidebar.useDefaultDirectory")}
              style={actionRow.style}
              hoverStyle={actionRow.hoverStyle}
              focusStyle={actionRow.focusStyle}
              activeStyle={actionRow.activeStyle}
              disabledStyle={actionRow.disabledStyle}
            >
              <Icon name="folder" size={14} tint={colors.muted} />
              <Text style={menuItemLabel()}>{t("sidebar.useDefaultDirectory")}</Text>
            </MenuItem>
            <MenuItem
              testID="project-browse"
              disabled={busy()}
              onSelect={() => void pickProjectFolder()}
              accessibilityLabel={t("sidebar.openOtherProject")}
              style={actionRow.style}
              hoverStyle={actionRow.hoverStyle}
              focusStyle={actionRow.focusStyle}
              activeStyle={actionRow.activeStyle}
              disabledStyle={actionRow.disabledStyle}
            >
              <Icon name="folder-open" size={14} tint={colors.muted} />
              <Text style={menuItemLabel()}>{t("sidebar.openOtherProject")}</Text>
            </MenuItem>
          </View>
        </Menu>

        <WorktreeMenu />

        <View style={{ flex: 1 }} />
      </View>

      <If when={pendingCwd() !== null}>
        <SettingsNote>{t("workspace.checkingTrustDetail")}</SettingsNote>
      </If>
      <If when={error()}>
        <SettingsError>{error() ?? ""}</SettingsError>
      </If>
    </View>
  );
}
