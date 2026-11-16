// The worktree switcher: the project's checkout, its linked worktrees, and the
// two ways to change them.
//
// Data is `GET /api/worktrees?cwd=` (`src/api/worktrees.ts`, route
// `app/api/worktrees/route.ts:18-52`): the main project root, every checkout
// git registered, and which one the cwd is in. The menu lists the root and
// each checkout, marks the current one, and lets a row switch to it.
//
// "New worktree…" posts `{ cwd, branch }` (`:57-96`). A branch another
// checkout already has is a 409: the route's `branch_in_use` (or
// `branch_worktree_missing` when that folder is gone) is spelled out above the
// field (`worktreeErrorText`).
//
// "Remove" asks first, then sends `DELETE { cwd, path }` (`:99-129`). Git can
// refuse a dirty checkout with 409 `dirty: true`; the same panel then offers a
// forced removal, as pi-next's `WorktreeRemoveForm` does.
//
// Switching uses the app's fresh-composer path: validate the folder
// (`POST /api/cwd/validate`) and stage it for the trust step, exactly as the
// directory browser does. A caller with its own session switcher can pass
// `onPick` instead.
//
// The look is the gallery kit (`../../ui/kit`) with the settings rows
// (`../settings/parts`): a card dialog, `listRow` for a checkout, the kit's
// `Input` / `Button` / `Badge`, and no Tailwind of our own.
//
// NSH rules (`skills/nsh/references/tsx.md`): the component body runs once,
// every changing value is read in JSX / `If` / `Each` / `resource`, and the
// worktree list is a `resource` keyed by the open flag and a revision.

import { resource, Scroll, signal, Text, View, windowSize } from "nsh";
import { Dialog, Input } from "nsh/base";
import {
  Badge,
  Button,
  colors,
  dialogCard,
  dialogText,
  dialogTitle,
  Icon,
  inputLook,
  listRow,
  mono,
  RowDivider,
  backdrop,
} from "../../ui/kit";
import { errorText, uiText } from "../../ui/errors";
import { t } from "../../ui/i18n";
import {
  createWorktree,
  listWorktrees,
  removeWorktree,
  worktreeErrorText,
  worktreeNeedsForce,
  type WorktreeInfo,
  type WorktreesResponse,
} from "../../api/worktrees";
import { validateCwd } from "../../api/cwd";
import { activeCwd, stagePendingCwd } from "../../state/session";
import { shortenPath } from "../../lib/display-path";
import { SettingsError, SettingsLoading, SettingsNote } from "../settings/parts";

const DIALOG_WIDTH = 560;

function messageOf(error: unknown): string {
  return errorText(error);
}

function worktreeName(worktree: WorktreeInfo): string {
  if (worktree.branch) return worktree.branch;
  const parts = worktree.path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? worktree.path;
}

/** The main checkout (the project root) is the one row that cannot be removed. */
function mainWorktree(data: WorktreesResponse | undefined): WorktreeInfo | undefined {
  return data?.worktrees.find((worktree) => worktree.isMain);
}

/** The checkout in use, when the list has loaded. */
function currentWorktree(data: WorktreesResponse | undefined): WorktreeInfo | undefined {
  if (!data) return undefined;
  return data.worktrees.find((worktree) => worktree.path === data.currentWorktreePath) ?? mainWorktree(data);
}

export function WorktreeMenu(props: {
  /** The folder to resolve the project from; the active fresh-session folder by default. */
  cwd?: () => string | null;
  /** Override the switch: the caller moves its own composer / session. */
  onPick?: (worktree: WorktreeInfo, data: WorktreesResponse) => void;
  /** A checkout was removed (a session there may need another folder). */
  onRemoved?: (path: string) => void;
}) {
  const open = signal(false);
  /** Bumped after a create / remove so the resource reads git again. */
  const revision = signal(0);
  const createOpen = signal(false);
  const branchName = signal("");
  const creating = signal(false);
  const createError = signal<string | null>(null);
  const switching = signal(false);
  const switchError = signal<string | null>(null);
  const removeTarget = signal<WorktreeInfo | null>(null);
  const removeDirty = signal(false);
  const removing = signal(false);
  const removeError = signal<string | null>(null);

  const folder = (): string | null => (props.cwd ? props.cwd() : activeCwd());

  const request = () => {
    const cwd = folder();
    return open() && cwd ? { cwd, revision: revision() } : null;
  };

  const data = resource(
    request,
    async (source: { cwd: string; revision: number }, info) =>
      await listWorktrees(source.cwd, { signal: info.signal }),
  );

  const refresh = (): void => {
    revision.update((value) => value + 1);
  };

  const resetForms = (): void => {
    createOpen.set(false);
    branchName.set("");
    createError.set(null);
    switchError.set(null);
    removeTarget.set(null);
    removeDirty.set(false);
    removeError.set(null);
  };

  const openMenu = (): void => {
    resetForms();
    open.set(true);
    refresh();
  };

  const close = (): void => {
    // The buttons wait while a call runs; Escape can still hide the menu, and
    // an answer that arrives afterwards only refreshes the list.
    open.set(false);
  };

  const pick = async (worktree: WorktreeInfo): Promise<void> => {
    const list = data();
    if (!list || switching()) return;
    if (worktree.path === list.currentWorktreePath) {
      open.set(false);
      return;
    }
    switching.set(true);
    switchError.set(null);
    try {
      if (props.onPick) {
        props.onPick(worktree, list);
      } else {
        const validated = await validateCwd(worktree.path);
        stagePendingCwd(validated);
      }
      open.set(false);
    } catch (cause) {
      switchError.set(messageOf(cause));
    } finally {
      switching.set(false);
    }
  };

  const create = async (): Promise<void> => {
    const cwd = folder();
    const branch = branchName().trim();
    if (!cwd || !branch || creating()) return;
    creating.set(true);
    createError.set(null);
    try {
      const created = await createWorktree(cwd, branch);
      branchName.set("");
      createOpen.set(false);
      refresh();
      const list = data();
      if (list) {
        await pick({ path: created.path, branch: created.branch, isMain: false });
      }
    } catch (cause) {
      createError.set(worktreeErrorText(cause));
    } finally {
      creating.set(false);
    }
  };

  const askRemove = (worktree: WorktreeInfo): void => {
    removeTarget.set(worktree);
    removeDirty.set(false);
    removeError.set(null);
  };

  const confirmRemove = async (force: boolean): Promise<void> => {
    const cwd = folder();
    const target = removeTarget();
    if (!cwd || !target || removing()) return;
    removing.set(true);
    removeError.set(null);
    try {
      await removeWorktree(cwd, target.path, force);
      removeTarget.set(null);
      removeDirty.set(false);
      refresh();
      props.onRemoved?.(target.path);
      if (target.path === cwd && !props.onPick) {
        // The folder the menu was opened from is gone; fall back to the
        // project root through the same trust step a switch uses.
        const root = data()?.projectRoot ?? mainWorktree(data())?.path;
        if (root) {
          try {
            stagePendingCwd(await validateCwd(root));
          } catch {
            // Keep the removed path; the caller's own guards handle it.
          }
        }
      }
    } catch (cause) {
      if (worktreeNeedsForce(cause)) {
        removeDirty.set(true);
        removeError.set(uiText("workspace.removeDirty"));
      } else {
        removeError.set(worktreeErrorText(cause));
      }
    } finally {
      removing.set(false);
    }
  };

  const branchField = inputLook({
    style: {
      flex: 1,
      height: 32,
      fontSize: 12.5,
      fontFamily: mono,
    },
  });

  const trigger = (): string => {
    const current = currentWorktree(data());
    return current ? t("sidebar.worktreePath", { path: worktreeName(current) }) : t("workspace.worktrees");
  };

  return (
    <>
      <Button
        label={trigger()}
        icon="layers"
        variant="secondary"
        size="small"
        disabled={!folder()}
        onPress={openMenu}
        accessibilityLabel={t("sidebar.switchWorktree")}
      />

      <If when={open()}>
        <Dialog
          open={open()}
          onOpenChange={(event) => {
            if (!event.open) close();
          }}
          accessibilityLabel={t("workspace.worktrees")}
          backdropStyle={backdrop()}
          style={{
            ...dialogCard(DIALOG_WIDTH),
            height: Math.max(320, Math.min(560, windowSize().height - 80)),
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={dialogTitle()}>{t("workspace.worktrees")}</Text>
              <Text style={{ ...dialogText(), paddingTop: 2 }}>
                {data()?.projectRoot ? shortenPath(data()!.projectRoot) : t("workspace.worktreesDescription")}
              </Text>
            </View>
            <Button label={t("i18n.close")} variant="ghost" size="small" disabled={creating() || removing()} onPress={close} />
          </View>

          <If when={data.loading() && data() === undefined}>
            <SettingsLoading label={t("workspace.readingWorktrees")} />
          </If>
          <If when={data.error()}>
            <SettingsError>{messageOf(data.error())}</SettingsError>
          </If>
          <If when={data()?.isGit === false}>
            <SettingsNote>{t("workspace.notGitRepository")}</SettingsNote>
          </If>
          <If when={data()?.isTopLevel === false && data()?.isGit === true}>
            <SettingsNote>{t("sidebar.openRepoRootTitle")}</SettingsNote>
          </If>
          <If when={switchError()}>
            <SettingsError>{switchError() ?? ""}</SettingsError>
          </If>

          <Scroll style={{ flex: 1, minHeight: 120 }}>
            <View style={{ paddingHorizontal: 4, paddingVertical: 2 }}>
              <Each of={data()?.worktrees ?? []} key={(worktree) => worktree.path}>
                {(worktree, index) => {
                  const current = () => data()?.currentWorktreePath === worktree().path;
                  // The project root row is the main checkout; `isMain` is git's order.
                  const row = listRow({ first: index() === 0, style: { position: "relative" } });
                  return (
                    <View {...row}>
                      <RowDivider show={index() !== 0} />
                      <View
                        style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 }}
                        onPress={() => void pick(worktree())}
                        accessibilityLabel={t("workspace.switchToWorktree", { name: worktreeName(worktree()) })}
                      >
                        <Icon
                          name={current() ? "check" : "folder"}
                          size={14}
                          tint={current() ? colors.accent : colors.muted}
                        />
                        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                          <Text
                            style={{
                              fontSize: 12.5,
                              fontWeight: current() ? "600" : "400",
                              color: current() ? colors.text : colors.muted,
                              numberOfLines: 1,
                            }}
                          >
                            {worktreeName(worktree())}
                          </Text>
                          <Text
                            style={{ fontSize: 10.5, fontFamily: mono, color: colors.faint, numberOfLines: 1 }}
                          >
                            {shortenPath(worktree().path)}
                          </Text>
                        </View>
                      </View>
                      <If when={worktree().isMain}>
                        <Badge label={t("sidebar.main")} outline />
                      </If>
                      <If when={current()}>
                        <Badge label={t("workspace.currentWorktree")} tone="accent" />
                      </If>
                      <If when={!worktree().isMain}>
                        <Button
                          label={t("i18n.remove")}
                          variant="ghost"
                          size="small"
                          disabled={switching() || creating() || removing()}
                          onPress={() => askRemove(worktree())}
                        />
                      </If>
                    </View>
                  );
                }}
              </Each>
              <If when={(data()?.worktrees.length ?? 0) === 0 && !data.loading() && !data.error()}>
                <SettingsNote>{t("workspace.noWorktrees")}</SettingsNote>
              </If>
            </View>
          </Scroll>

          <If when={removeTarget() !== null}>
            <View
              style={{
                padding: 10,
                gap: 8,
                borderTopWidth: 1,
                borderTopColor: colors.line,
                backgroundColor: colors.raised,
                borderRadius: 8,
              }}
            >
              <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.text }}>
                {t("workspace.removeWorktreeHeading", { name: removeTarget() ? worktreeName(removeTarget()!) : "" })}
              </Text>
              <Text style={{ fontSize: 11.5, lineHeight: 16, color: colors.muted }}>
                {removeDirty() ? t("workspace.removeDirty") : t("workspace.removeKeptBranch")}
              </Text>
              <If when={removeError()}>
                <SettingsError>{removeError() ?? ""}</SettingsError>
              </If>
              <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 6 }}>
                <Button
                  label={t("i18n.cancel")}
                  variant="secondary"
                  size="small"
                  disabled={removing()}
                  onPress={() => {
                    removeTarget.set(null);
                    removeDirty.set(false);
                    removeError.set(null);
                  }}
                />
                <Button
                  label={removeDirty() ? t("workspace.forceRemove") : t("i18n.remove")}
                  variant="danger"
                  size="small"
                  busy={removing()}
                  disabled={removing()}
                  onPress={() => void confirmRemove(removeDirty())}
                />
              </View>
            </View>
          </If>

          <If when={createOpen()}>
            <View
              style={{
                padding: 10,
                gap: 8,
                borderTopWidth: 1,
                borderTopColor: colors.line,
              }}
            >
              <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.text }}>{t("sidebar.newWorktree")}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Input
                  {...branchField}
                  value={branchName()}
                  placeholder={t("sidebar.branchName")}
                  autoComplete="off"
                  autoFocus
                  readonly={creating()}
                  accessibilityLabel={t("sidebar.branchName")}
                  onChange={({ value }) => {
                    branchName.set(value);
                    createError.set(null);
                  }}
                  onSubmit={() => void create()}
                />
                <Button
                  label={t("sidebar.create")}
                  variant="primary"
                  size="small"
                  busy={creating()}
                  disabled={!branchName().trim() || creating()}
                  onPress={() => void create()}
                />
                <Button
                  label={t("i18n.cancel")}
                  variant="secondary"
                  size="small"
                  disabled={creating()}
                  onPress={() => {
                    createOpen.set(false);
                    branchName.set("");
                    createError.set(null);
                  }}
                />
              </View>
              <If when={createError()}>
                <SettingsError>{createError() ?? ""}</SettingsError>
              </If>
            </View>
          </If>

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingTop: 2,
              borderTopWidth: 1,
              borderTopColor: colors.line,
            }}
          >
            <If when={!createOpen() && removeTarget() === null}>
              <Button
                label={t("sidebar.newWorktree")}
                icon="plus"
                variant="secondary"
                size="small"
                disabled={!folder() || data()?.isGit === false || creating() || removing()}
                onPress={() => {
                  createOpen.set(true);
                  branchName.set("");
                  createError.set(null);
                }}
              />
            </If>
            <View style={{ flex: 1 }} />
            <Button
              label={switching() ? t("workspace.switching") : t("i18n.close")}
              variant="secondary"
              size="small"
              disabled={switching() || creating() || removing()}
              onPress={close}
            />
          </View>
        </Dialog>
      </If>
    </>
  );
}
