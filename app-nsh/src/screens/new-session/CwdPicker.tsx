// The directory browser behind "Change…" and "New folder": a breadcrumb, the
// readable subdirectories (the Windows drives where the server has none), a
// path field, a "New folder" form and the Select that commits a folder.
//
// The data is `GET /api/cwd/browse` (`src/api/cwd.ts`, route
// `app/api/cwd/browse/route.ts:19-52`): the answer names the resolved folder,
// its parent (null at a root) and its readable children; on Windows, a browse
// with no path answers `{ path: "", parentPath: null, drives, directories: [] }`
// (`:20-25`). "New folder" posts `{ path, name }` (`:54-77`) and opens the
// created folder, as pi-next's DirectoryPicker does, so Select stays the one
// commit point.
//
// Selecting runs `POST /api/cwd/validate` (`route.ts:15-45`); its normalized
// `cwd`, `projectRoot` and `projectKey` go to `state/session.ts` as the pending
// folder. The trust dialog then reads `/api/project-trust` and either accepts
// it or asks before the fresh composer moves there.
//
// The look is the gallery kit (`../../ui/kit`) with the shared settings lines
// (`../settings/parts`): a card dialog, the field look for the path and folder
// name, `listRow` for folders, and the kit's buttons. No Tailwind of our own.

import { effect, platform, resource, Scroll, signal, Text, untracked, View, windowSize } from "nsh";
import { Dialog, Input } from "nsh/base";
import {
  backdrop,
  Badge,
  Button,
  colors,
  dialogCard,
  dialogText,
  dialogTitle,
  focusRing,
  Icon,
  inputLook,
  insetSurface,
  listRow,
  mono,
  Tip,
} from "../../ui/kit";
import { errorText } from "../../ui/errors";
import { t } from "../../ui/i18n";
import { pickSystemFolder, systemFolderAvailable } from "../../lib/system-folder";
import { browseDirectory, createDirectory, validateCwd, type DirectoryEntry } from "../../api/cwd";
import {
  closeCwdPicker,
  cwdPickerCreate,
  cwdPickerOpen,
  cwdPickerStart,
  stagePendingCwd,
} from "../../state/session";
import { SettingsError, SettingsLoading, SettingsNote, settingsCode } from "../settings/parts";

/** pi-next's directory picker is 520 wide and at most 620 high. */
const PICKER_WIDTH = 520;
const PICKER_MAX_HEIGHT = 620;

/** One breadcrumb step: its name and the path it opens. */
interface Crumb {
  label: string;
  path: string;
}

/** Why a path cannot be shown: the route's words, or the transport's. */
function messageOf(error: unknown): string {
  if (error === null || error === undefined) return "";
  return errorText(error);
}

/** A Windows drive root ("C:\\", "C:/", "C:") or a UNC path. */
function isWindowsDriveRoot(path: string): boolean {
  return /^[a-zA-Z]:[\\/]?$/.test(path);
}

function isWindowsPath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

/**
 * The path split into clickable steps: `/a/b` → `/`, `a`, `b`;
 * `C:\\Users\\me` → `C:\\`, `Users`, `me`. The separator is the path's own (a
 * Windows path keeps `\\`). A UNC path's first step is its
 * `\\\\server\\share` prefix, which cannot be rebuilt from empty parts.
 */
function breadcrumbs(path: string): Crumb[] {
  if (!path) return [];
  const windows = isWindowsPath(path);
  const separator = windows ? "\\" : "/";
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length === 0) return [{ label: separator, path: separator }];

  if (windows && path.startsWith("\\\\")) {
    const share = parts.slice(0, 2).join(separator);
    const crumbs: Crumb[] = [{ label: `\\\\${share}`, path: `\\\\${share}` }];
    let current = `\\\\${share}`;
    for (const part of parts.slice(2)) {
      current = `${current}${separator}${part}`;
      crumbs.push({ label: part, path: current });
    }
    return crumbs;
  }

  if (windows) {
    const drive = parts[0];
    const root = `${drive}${separator}`;
    const crumbs: Crumb[] = [{ label: root, path: root }];
    let current = drive;
    for (const part of parts.slice(1)) {
      current = `${current}${separator}${part}`;
      crumbs.push({ label: part, path: current });
    }
    return crumbs;
  }

  const crumbs: Crumb[] = [{ label: separator, path: separator }];
  let current = "";
  for (const part of parts) {
    current = `${current}${separator}${part}`;
    crumbs.push({ label: part, path: current });
  }
  return crumbs;
}

/** A folder row: double-click opens it with a pointer, one tap on a touch screen. */
function FolderRow(props: { entry: () => DirectoryEntry; first: boolean; onOpen: (path: string) => void }) {
  const row = listRow({ first: props.first });
  return (
    <View
      {...row}
      onPress={(event) => {
        if (!platform.desktop || event.clickCount >= 2) props.onOpen(props.entry().path);
      }}
      accessibilityLabel={t("directoryPicker.folderLabel", { name: props.entry().name })}
      accessibilityHint={t("directoryPicker.doubleClickToOpen")}
      tooltip={<Tip label={props.entry().path} />}
    >
      <Icon name="folder" size={14} tint={colors.muted} />
      <Text style={{ flex: 1, minWidth: 0, fontSize: 12, fontFamily: mono, color: colors.text, numberOfLines: 1 }}>
        {props.entry().name}
      </Text>
    </View>
  );
}

export function CwdPicker() {
  /** The folder to load; its revision forces a reload of the same path. */
  const location = signal<{ path: string | null; revision: number } | null>(null);
  let revision = 0;
  /** Answers an in-flight Select after the picker closed or opened another folder. */
  let selection = 0;
  const pathInput = signal("");
  const validating = signal(false);
  const validateError = signal<string | null>(null);
  const createOpen = signal(false);
  const createName = signal("");
  const creating = signal(false);
  const createError = signal<string | null>(null);
  const systemPicking = signal(false);

  const listing = resource(
    () => (cwdPickerOpen() ? location() : null),
    async (request: { path: string | null; revision: number }, info) =>
      await browseDirectory(request.path, { signal: info.signal }),
  );

  const close = (): void => {
    selection += 1;
    closeCwdPicker();
  };

  const go = (path?: string | null): void => {
    selection += 1;
    createOpen.set(false);
    createError.set(null);
    validateError.set(null);
    const next = path ?? null;
    pathInput.set(next ?? "");
    location.set({ path: next, revision: ++revision });
  };

  // Opening starts at the requested folder (or the server's start: home, or
  // the drives on Windows). Closing drops the location so the next opening
  // always loads afresh.
  effect(() => {
    if (!cwdPickerOpen()) {
      selection += 1;
      validating.set(false);
      createOpen.set(false);
      createName.set("");
      createError.set(null);
      validateError.set(null);
      if (untracked(() => location()) !== null) location.set(null);
      return;
    }
    selection += 1;
    validating.set(false);
    const start = cwdPickerStart();
    if (cwdPickerCreate()) createOpen.set(true);
    pathInput.set(start ?? "");
    location.set({ path: start, revision: ++revision });
  });

  // The resolved path is what the field shows once a load lands; a typed path
  // stays as typed until Go.
  effect(() => {
    const data = listing();
    if (!data || listing.loading()) return;
    pathInput.set(data.path);
  });

  const currentPath = (): string => listing()?.path ?? "";
  const drives = (): DirectoryEntry[] | undefined => listing()?.drives;
  const directories = (): DirectoryEntry[] => listing()?.directories ?? [];
  const canGoUp = (): boolean =>
    Boolean(listing()?.parentPath) || isWindowsDriveRoot(currentPath());
  const canSelect = (): boolean =>
    Boolean(listing()?.path) &&
    pathInput().trim() === currentPath() &&
    !listing.loading() &&
    !validating();

  /**
   * The system's own folder chooser (`lib/system-folder.ts`): the same dialog
   * "Change…" opens, used here to jump the browser to a folder Finder knows.
   * A cancel changes nothing; an unavailable chooser leaves the browser as is.
   */
  const pickInSystem = async (): Promise<void> => {
    if (systemPicking()) return;
    systemPicking.set(true);
    validateError.set(null);
    try {
      const picked = await pickSystemFolder(t("directoryPicker.selectDirectory"));
      if (picked.status === "picked") go(picked.path);
    } finally {
      systemPicking.set(false);
    }
  };

  const goUp = (): void => {
    const parent = listing()?.parentPath ?? null;
    if (parent) {
      go(parent);
      return;
    }
    // A Windows drive's root goes back to the drive picker (no path).
    if (isWindowsDriveRoot(currentPath())) go(null);
  };

  const select = async (): Promise<void> => {
    if (!canSelect()) return;
    const cwd = currentPath();
    const token = ++selection;
    validating.set(true);
    validateError.set(null);
    try {
      const validated = await validateCwd(cwd);
      // Closed, reopened or navigated meanwhile: nobody asks for this answer.
      if (token !== selection || !cwdPickerOpen()) return;
      stagePendingCwd(validated);
      close();
    } catch (error) {
      if (token === selection) validateError.set(messageOf(error));
    } finally {
      if (token === selection) validating.set(false);
    }
  };

  const createFolder = async (): Promise<void> => {
    const parent = currentPath();
    const name = createName().trim();
    if (!parent || !name || creating()) return;
    creating.set(true);
    createError.set(null);
    try {
      const created = await createDirectory(parent, name);
      createName.set("");
      go(created.path);
    } catch (error) {
      createError.set(messageOf(error));
    } finally {
      creating.set(false);
    }
  };

  const error = (): string =>
    validateError() ?? createError() ?? messageOf(listing.error());

  const field = inputLook({
    style: () => ({
      flex: 1,
      height: 34,
      fontSize: 12,
      fontFamily: mono,
    }),
  });
  const nameField = inputLook({
    style: () => ({ width: "100%", height: 34, fontSize: 12, fontFamily: mono }),
  });
  const crumbStyle = {
    height: 24,
    paddingHorizontal: 6,
    borderRadius: 6,
    justifyContent: "center" as const,
  };

  return (
    <Dialog
      open={cwdPickerOpen()}
      animation="fade"
      accessibilityLabel={t("directoryPicker.selectDirectory")}
      closeOnEscape={true}
      closeOnBackdropPress={true}
      onOpenChange={(event) => {
        if (!event.open) close();
      }}
      backdropStyle={backdrop()}
      style={{ ...dialogCard(PICKER_WIDTH), height: Math.max(240, Math.min(PICKER_MAX_HEIGHT, windowSize().height - 48)) }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={dialogTitle()}>{t("directoryPicker.selectDirectory")}</Text>
          <Text style={{ ...dialogText(), paddingTop: 2 }}>
            {t("directoryPicker.intro")}
          </Text>
        </View>
        <Button label={t("i18n.close")} variant="ghost" size="small" onPress={close} />
      </View>

      {/* Breadcrumb: each earlier folder opens it. */}
      <Scroll horizontal style={{ flexShrink: 0, maxHeight: 30 }} contentStyle={{ flexDirection: "row", alignItems: "center", gap: 1 }}>
        <Each of={breadcrumbs(currentPath())} key={(crumb) => crumb.path}>
          {(crumb, index) => (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 1 }}>
              <If when={index() > 0}>
                <Text style={{ fontSize: 11, color: colors.faint }}>
                  {isWindowsPath(currentPath()) ? "\\" : "/"}
                </Text>
              </If>
              <View
                onPress={() => go(crumb().path)}
                hoverStyle={{ backgroundColor: colors.raised }}
                focusVisibleStyle={focusRing()}
                style={crumbStyle}
              >
                <Text style={{ fontSize: 11.5, fontFamily: mono, color: colors.text, numberOfLines: 1 }}>
                  {crumb().label}
                </Text>
              </View>
            </View>
          )}
        </Each>
        <If when={drives() !== undefined}>
          <Badge label={t("directoryPicker.drives")} />
        </If>
      </Scroll>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <Button
          label={t("directoryPicker.up")}
          icon="back"
          variant="secondary"
          size="small"
          disabled={!canGoUp() || listing.loading()}
          onPress={goUp}
        />
        <Input
          {...field}
          value={pathInput()}
          placeholder={t("directoryPicker.pathPlaceholder")}
          autoComplete="off"
          accessibilityLabel={t("directoryPicker.directoryPath")}
          onChange={({ value }) => {
            pathInput.set(value);
            validateError.set(null);
            createError.set(null);
          }}
          onSubmit={() => {
            const candidate = pathInput().trim();
            if (candidate) go(candidate);
          }}
        />
        <Button
          label={t("directoryPicker.go")}
          variant="secondary"
          size="small"
          disabled={listing.loading() || !pathInput().trim()}
          onPress={() => {
            const candidate = pathInput().trim();
            if (candidate) go(candidate);
          }}
        />
        <If when={systemFolderAvailable()}>
          <Button
            label={t("directoryPicker.chooseInSystem")}
            variant="secondary"
            size="small"
            busy={systemPicking()}
            disabled={systemPicking()}
            onPress={() => void pickInSystem()}
          />
        </If>
      </View>

      <Scroll style={{ flex: 1, minHeight: 120, maxHeight: 260 }}>
        <View style={{ paddingHorizontal: 8, paddingVertical: 4, gap: 0 }}>
          <If when={listing.loading() || (location() === null && cwdPickerOpen())}>
            <SettingsLoading label={t("directoryPicker.loadingDirectories")} />
          </If>

          <If when={drives() !== undefined}>
            <Each of={drives() ?? []} key={(drive) => drive.path}>
              {(drive, index) => (
                <View
                  {...listRow({ first: index() === 0 })}
                  onPress={(event) => {
                    if (!platform.desktop || event.clickCount >= 2) go(drive().path);
                  }}
                  accessibilityLabel={t("directoryPicker.driveLabel", { name: drive().name })}
                  accessibilityHint={t("directoryPicker.doubleClickToOpen")}
                >
                  <Icon name="folder-open" size={14} tint={colors.muted} />
                  <Text style={{ flex: 1, minWidth: 0, fontSize: 12, fontFamily: mono, color: colors.text }}>
                    {drive().name}
                  </Text>
                </View>
              )}
            </Each>
            <If when={(drives() ?? []).length === 0 && error() === ""}>
              <SettingsNote>{t("directoryPicker.noDrives")}</SettingsNote>
            </If>
          </If>

          <If when={drives() === undefined}>
            <Each of={directories()} key={(entry) => entry.path}>
              {(entry, index) => (
                <FolderRow entry={entry} first={index() === 0} onOpen={go} />
              )}
            </Each>
            <If when={directories().length === 0 && !listing.loading() && error() === ""}>
              <SettingsNote>{t("directoryPicker.noSubdirectories")}</SettingsNote>
            </If>
          </If>
        </View>
      </Scroll>

      <If when={createOpen()}>
        <View style={{ ...insetSurface(), flexShrink: 0, padding: 10, gap: 8 }}>
          <Text style={{ fontSize: 11.5, color: colors.muted }}>
            {t("directoryPicker.newFolderIn")} <Text style={{ ...settingsCode(), fontSize: 11.5 }}>{currentPath() || "—"}</Text>
          </Text>
          <Input
            {...nameField}
            value={createName()}
            placeholder={t("directoryPicker.directoryName")}
            autoComplete="off"
            autoFocus
            accessibilityLabel={t("directoryPicker.directoryName")}
            onChange={({ value }) => {
              createName.set(value);
              createError.set(null);
            }}
            onSubmit={() => void createFolder()}
          />
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 6 }}>
            <Button
              label={t("i18n.cancel")}
              variant="secondary"
              size="small"
              disabled={creating()}
              onPress={() => {
                createOpen.set(false);
                createName.set("");
                createError.set(null);
              }}
            />
            <Button
              label={t("directoryPicker.create")}
              variant="primary"
              size="small"
              busy={creating()}
              disabled={!currentPath() || !createName().trim() || creating()}
              onPress={() => void createFolder()}
            />
          </View>
        </View>
      </If>

      <If when={error()}>
        <SettingsError>{error()}</SettingsError>
      </If>

      <View
        style={{
          flexShrink: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingTop: 2,
          borderTopWidth: 1,
          borderTopColor: colors.line,
        }}
      >
        <Button
          label={t("directoryPicker.newDirectory")}
          icon="plus"
          variant="secondary"
          size="small"
          disabled={!currentPath() || listing.loading()}
          onPress={() => {
            createOpen.set(true);
            createName.set("");
            createError.set(null);
          }}
        />
        <View style={{ flex: 1 }} />
        <Button label={t("i18n.cancel")} variant="secondary" size="small" onPress={close} />
        <Button
          label={t("directoryPicker.selectThisFolder")}
          variant="primary"
          size="small"
          busy={validating()}
          disabled={!canSelect() || validating()}
          onPress={() => void select()}
        />
      </View>
    </Dialog>
  );
}
