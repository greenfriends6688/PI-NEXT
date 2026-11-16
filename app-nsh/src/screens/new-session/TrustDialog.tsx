// The trust step before a fresh composer moves into a project. A folder that
// needs trust is not usable (its `.pi/mcp.json`, extensions, skills, project
// settings and prompts stay dormant) until `trust.json` records a decision;
// this dialog reads the status, lists what trusting would connect, and either
// accepts the folder or sends the user back to the directory browser.
//
// `GET /api/project-trust?cwd=` (`app/api/project-trust/route.ts:56-73`)
// carries `ProjectTrustStatus` plus the project's `.pi/mcp.json` listing
// (`lib/api-types.ts:116-147`, `:787-812`): the listing reads files only, so
// showing it spawns nothing. The dialog is shown only while
// `requiresTrust && !trusted`; a fresh folder or one inside a trusted tree
// reports `trusted: true` and the folder is accepted without a dialog.
// `POST /api/project-trust` (`:75-100`) writes the decision; a refusal keeps
// its `{ error, reason }` (`mcp.reason.*` conditions), and Cancel/Escape puts
// the directory browser back at the rejected folder.
//
// The look is the gallery kit (`../../ui/kit`) with the settings lines
// (`../settings/parts`): a card dialog, `dialogTitle` / `dialogText`, the
// path in the settings' code style, an inset list of server names and the
// kit's buttons.

import { effect, resource, Scroll, signal, Text, View, windowSize } from "nsh";
import { Dialog } from "nsh/base";
import { ApiError } from "../../api/client";
import {
  loadProjectTrust,
  projectTrustListingFromError,
  trustProject,
  type ProjectMcpListing,
  type ProjectTrustResponse,
} from "../../api/trust";
import {
  activeCwd,
  acceptPendingCwd,
  clearPendingCwd,
  openCwdPicker,
  pendingCwd,
  type PendingCwd,
} from "../../state/session";
import {
  Badge,
  backdrop,
  Button,
  colors,
  dialogCard,
  dialogText,
  dialogTitle,
  Icon,
  insetSurface,
  mono,
} from "../../ui/kit";
import { errorText } from "../../ui/errors";
import { t } from "../../ui/i18n";
import { SettingsError, SettingsNote, settingsCode } from "../settings/parts";

/** A card dialog's width; the trust listing stays readable at 520. */
const DIALOG_WIDTH = 520;

/** Why a project-trust read failed, with the listing an unreadable store still carries. */
interface TrustRead {
  folder: PendingCwd;
  status?: ProjectTrustResponse;
  error?: string;
  listing?: ProjectMcpListing;
}

function messageOf(error: unknown): string {
  return errorText(error);
}

export function TrustDialog() {
  // The whole pending folder is the resource's source: a new selection (even
  // the same path chosen again) is a new object, so an older answer can never
  // decide the newer folder.
  const loaded = resource(
    () => pendingCwd(),
    async (folder: PendingCwd, info): Promise<TrustRead> => {
      try {
        return { folder, status: await loadProjectTrust(folder.cwd, { signal: info.signal }) };
      } catch (error) {
        return {
          folder,
          error: messageOf(error),
          listing: projectTrustListingFromError(error),
        };
      }
    },
  );

  /** The answer for the folder on the screen now, never a previous one's. */
  const current = (): TrustRead | undefined => {
    const read = loaded();
    return read && read.folder === pendingCwd() ? read : undefined;
  };

  const status = () => current()?.status;
  const listing = (): ProjectMcpListing | undefined => current()?.listing;
  const servers = () => status()?.mcpServers ?? listing()?.mcpServers ?? [];
  const mcpFile = () => status()?.mcpFile ?? listing()?.mcpFile;
  const readError = () => current()?.error ?? "";
  const trusting = signal(false);
  const trustError = signal<string | null>(null);

  // A failure belongs to the folder it was asked for: a new selection starts clean.
  effect(() => {
    pendingCwd();
    trustError.set(null);
  });

  // No decision needed: the folder becomes the fresh composer's cwd at once.
  // Reading the resource here is the only place the answer is applied, so a
  // stale answer (guarded by `current()`) cannot move the composer.
  effect(() => {
    const read = current();
    if (!read || read.error || !read.status) return;
    if (!read.status.requiresTrust || read.status.trusted) acceptPendingCwd();
  });

  const needed = (): boolean => {
    const state = status();
    return state !== undefined && state.requiresTrust && !state.trusted;
  };
  const open = (): boolean =>
    pendingCwd() !== null && (needed() || current()?.error !== undefined);

  const visibleError = (): string => trustError() ?? readError() ?? current()?.listing?.mcpError ?? "";

  const cancel = (): void => {
    if (trusting()) return;
    const folder = pendingCwd();
    clearPendingCwd();
    // "Not now": back to the browser at the folder that was refused.
    openCwdPicker(folder?.cwd ?? activeCwd());
  };

  const confirm = async (): Promise<void> => {
    const folder = pendingCwd();
    if (!folder || trusting()) return;
    trusting.set(true);
    trustError.set(null);
    try {
      const result = await trustProject(folder.cwd);
      // A Cancel or another pick while the request ran wins over its answer.
      if (pendingCwd() !== folder) return;
      if (!result.requiresTrust || result.trusted) {
        acceptPendingCwd();
        return;
      }
      loaded.refetch();
    } catch (error) {
      if (pendingCwd() !== folder) return;
      // The folder stopped needing trust in between: there is nothing to ask.
      if (error instanceof ApiError && error.reason === "trust-not-required") {
        acceptPendingCwd();
        return;
      }
      trustError.set(messageOf(error));
    } finally {
      trusting.set(false);
    }
  };

  const canTrust = (): boolean => status() !== undefined && !trusting();

  return (
    <Dialog
      open={open()}
      animation="fade"
      role="alertdialog"
      accessibilityLabel={t("trust.dialogTitle")}
      accessibilityDescription={t("trust.dialogBody")}
      closeOnEscape={!trusting()}
      closeOnBackdropPress={!trusting()}
      onOpenChange={(event) => {
        if (!event.open) cancel();
      }}
      backdropStyle={backdrop()}
      style={{ ...dialogCard(DIALOG_WIDTH), maxHeight: Math.max(240, Math.min(620, windowSize().height - 48)) }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        <View style={{ paddingTop: 2 }}>
          <Icon name="lock" size={18} tint={colors.muted} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Text style={dialogTitle()}>{t("trust.dialogTitle")}</Text>
          <Text style={dialogText()}>{t("trust.dialogBody")}</Text>
        </View>
      </View>

      <View style={{ ...insetSurface(), paddingHorizontal: 10, paddingVertical: 8 }}>
        <Text style={{ ...settingsCode(), fontSize: 11.5, numberOfLines: 2 }}>
          {pendingCwd()?.cwd ?? ""}
        </Text>
      </View>

      <View style={{ gap: 5 }}>
        <Text style={{ fontSize: 11.5, fontWeight: "600", color: colors.text }}>
          {t("trust.connectHeading")}
        </Text>
        <If when={servers().length > 0}>
          <Scroll style={{ maxHeight: 220 }}>
            <View style={{ ...insetSurface(), padding: 8, gap: 6 }}>
              <Each of={servers()} key={(server) => server.name}>
                {(server) => (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Icon name="code" size={12} tint={colors.muted} />
                    <Text style={{ flex: 1, minWidth: 0, fontSize: 12, fontFamily: mono, color: colors.text, numberOfLines: 1 }}>
                      {server().name}
                    </Text>
                    <If when={server().transport !== undefined}>
                      <Badge label={server().transport!} />
                    </If>
                    <If when={server().invalidError !== undefined}>
                      <Badge label={t("mcp.stateShort.invalid")} tone="warn" />
                    </If>
                  </View>
                )}
              </Each>
            </View>
          </Scroll>
        </If>
        <If when={servers().length === 0 && (status()?.mcpError ?? listing()?.mcpError) === undefined}>
          <SettingsNote>
            {mcpFile()?.exists ? t("trust.mcp.none") : t("trust.mcp.noFile")}
          </SettingsNote>
        </If>
        <If when={mcpFile()?.problems !== undefined && (mcpFile()?.problems.length ?? 0) > 0}>
          <Each of={mcpFile()?.problems ?? []} key="index">
            {(problem) => <SettingsNote tone="warn">{problem().error}</SettingsNote>}
          </Each>
        </If>
        <If when={(status()?.mcpError ?? listing()?.mcpError) !== undefined}>
          <SettingsError>{status()?.mcpError ?? listing()?.mcpError ?? ""}</SettingsError>
        </If>
      </View>

      <If when={visibleError()}>
        <SettingsError>{visibleError()}</SettingsError>
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
        <If when={current()?.error !== undefined && !trusting()}>
          <Button label={t("changes.retry")} variant="secondary" size="small" onPress={() => loaded.refetch()} />
        </If>
        <View style={{ flex: 1 }} />
        <Button
          label={t("trust.cancel")}
          variant="secondary"
          size="small"
          disabled={trusting()}
          onPress={cancel}
        />
        <Button
          label={t("trust.trustProject")}
          variant="primary"
          size="small"
          busy={trusting()}
          disabled={!canTrust() || !needed() || trusting()}
          onPress={() => void confirm()}
        />
      </View>
    </Dialog>
  );
}
