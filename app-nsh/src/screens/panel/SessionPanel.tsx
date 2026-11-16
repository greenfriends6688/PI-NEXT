// The session tab: who this session is, what it has spent, and the three
// actions pi-next keeps on its session-info panel (rename, fork, export).
//
// Sources, read by id so a side chat or a subagent can be inspected the same
// way: `GET /api/sessions/[id]` (info, path, cwd, branch, model, thinking
// level, stats), `POST /api/sessions/stats` (the toolbar's usage summary),
// `PATCH /api/sessions/[id]` (rename), `POST /api/sessions/[id]/fork` (fork)
// and the export routes under `/api/sessions/[id]/export`.
import { Clipboard, computed, resource, signal, Text, View } from "nsh";
import { Scroll } from "nsh";
import { Input } from "nsh/base";
import { forkSession, readSession, renameSession, sessionStats } from "../../api/sessions";
import { fetchSessionExport, saveSessionExport } from "../../api/misc";
import { errorText } from "../../ui/errors";
import { t } from "../../ui/i18n";
import { formatActiveDuration, formatCompactCount, formatCostShort } from "../../lib/session-stats-format";
import { Button, colors, Icon, inputLook, mono } from "../../ui/kit";
import { selectedSessionId } from "../../state/session";
import { chooseSession, sessionTitle } from "../shell/state";
import { pushToast } from "../overlays/state";
import {
  SettingsCard,
  SettingsError,
  SettingsLoading,
  SettingsNote,
  SettingsRow,
  settingsCode,
} from "../settings/parts";

/** A quiet value line (a path, an id) with its copy action. */
function CopyRow(props: {
  first?: boolean;
  label: string;
  value: string;
  copyLabel: string;
}) {
  const copy = () => {
    void Clipboard.writeText(props.value);
    pushToast(t("session.copied"), { title: props.copyLabel });
  };
  return (
    <SettingsRow first={props.first} label={props.label}>
      <View style={{ flex: 1, minWidth: 0, marginRight: 8 }}>
        <Text style={{ ...settingsCode(), numberOfLines: 1 }}>{props.value}</Text>
      </View>
      <Button label={props.copyLabel} variant="ghost" size="small" icon="copy" onPress={copy} />
    </SettingsRow>
  );
}

export function SessionPanel() {
  const id = () => selectedSessionId();
  const revision = signal(0);
  const renaming = signal(false);
  const renameText = signal("");
  const busy = signal(false);
  const actionError = signal<string | null>(null);
  const exporting = signal(false);

  const source = computed(() => {
    const sessionId = id();
    return sessionId ? { id: sessionId, revision: revision() } : null;
  });
  const view = resource(source, async (asked, info) =>
    readSession(asked.id, { summaryTree: true, signal: info.signal }),
  );
  const usage = resource(source, async (asked, info) => {
    const rows = await sessionStats([asked.id], { signal: info.signal });
    return rows[asked.id] ?? null;
  });

  const info = computed(() => view()?.info ?? null);
  const title = () => (info()?.name ?? "").trim() || t("sidebar.untitledSession");
  const model = () => {
    const current = usage()?.model ?? view()?.context.model ?? null;
    return current ? `${current.provider}/${current.modelId}` : null;
  };
  const thinking = () => usage()?.thinkingLevel ?? view()?.context.thinkingLevel ?? null;
  const tokens = () => numberOrZero(view()?.stats.tokens.total ?? usage()?.tokens.total);
  const cost = () => view()?.stats.cost ?? usage()?.cost ?? 0;
  const toolCalls = () => view()?.stats.toolCalls ?? usage()?.toolCalls ?? 0;
  const activeMs = () => view()?.totalActiveMs ?? usage()?.totalActiveMs ?? 0;

  const refresh = () => revision.update((value) => value + 1);

  const beginRename = () => {
    renameText.set(title());
    actionError.set(null);
    renaming.set(true);
  };

  const submitRename = async () => {
    const sessionId = id();
    const name = renameText().trim();
    if (!sessionId) return;
    if (!name) {
      actionError.set(t("sidebar.sessionNeedsName"));
      return;
    }
    busy.set(true);
    try {
      await renameSession(sessionId, name);
      sessionTitle.set(name);
      renaming.set(false);
      actionError.set(null);
      refresh();
    } catch (error) {
      actionError.set(errorText(error));
    } finally {
      busy.set(false);
    }
  };

  const fork = async () => {
    const sessionId = id();
    if (!sessionId || busy()) return;
    busy.set(true);
    actionError.set(null);
    try {
      const created = await forkSession(sessionId);
      const createdTitle = (created.session.name ?? "").trim() || title();
      chooseSession(created.session.id, created.session.cwd, createdTitle);
      pushToast(t("sidebar.forkedToast", { title: createdTitle }), { title: t("sidebar.fork") });
    } catch (error) {
      actionError.set(errorText(error));
    } finally {
      busy.set(false);
    }
  };

  const exportSession = async () => {
    const sessionId = id();
    if (!sessionId || exporting()) return;
    exporting.set(true);
    actionError.set(null);
    try {
      const exported = await fetchSessionExport(sessionId);
      let saved: string | null = null;
      try {
        saved = await saveSessionExport(exported);
      } catch (error) {
        actionError.set(t("sidebar.exportSaveFailed", { error: errorText(error) }));
        return;
      }
      pushToast(
        saved
          ? t("sidebar.exportSavedTo", { path: saved })
          : t("sidebar.exportNoDirectory", { file: exported.fileName }),
        { title: t("sidebar.sessionExported") },
      );
    } catch (error) {
      actionError.set(t("sidebar.exportFailed", { error: errorText(error) }));
    } finally {
      exporting.set(false);
    }
  };

  return (
    <If when={id()} else={<View style={{ padding: 12 }}><SettingsNote>{t("files.noWorkingDirectory")}</SettingsNote></View>}>
      <Scroll style={{ flex: 1, minHeight: 0 }} contentStyle={{ padding: 12, gap: 14 }}>
        <If when={view.error()}>
          <SettingsError>{errorText(view.error())}</SettingsError>
        </If>
        <If when={view.state() === "pending"}>
          <SettingsLoading label={t("i18n.loading")} />
        </If>

        <SettingsCard title={t("session.info")}>
          <If when={renaming()} else={<SettingsRow first label={t("session.name")}><Text style={{ fontSize: 13, color: colors.text, numberOfLines: 1 }}>{title()}</Text></SettingsRow>}>
            <View style={{ paddingVertical: 8, gap: 6 }}>
              <Input
                {...inputLook({ style: { height: 32, borderRadius: 8, paddingHorizontal: 10, fontSize: 13 } })}
                value={renameText()}
                onChange={({ value }) => renameText.set(value)}
                accessibilityLabel={t("sidebar.renameSession")}
              />
              <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 6 }}>
                <Button label={t("i18n.cancel")} variant="ghost" size="small" onPress={() => renaming.set(false)} />
                <Button label={t("i18n.save")} variant="secondary" size="small" busy={busy()} disabled={busy()} onPress={() => void submitRename()} />
              </View>
            </View>
          </If>
          <SettingsRow label={t("session.model")}>
            <Text style={{ fontFamily: mono, fontSize: 12, color: colors.muted, numberOfLines: 1 }}>
              {model() ?? t("session.inMemory")}
            </Text>
          </SettingsRow>
          <If when={thinking()}>
            {(level) => (
              <SettingsRow label={t("agents.thinking")}>
                <Text style={{ fontSize: 12, color: colors.muted }}>{level()}</Text>
              </SettingsRow>
            )}
          </If>
          <CopyRow label={t("session.id")} value={id() ?? ""} copyLabel={t("session.copyId")} />
        </SettingsCard>

        <SettingsCard title={t("session.total")}>
          <SettingsRow first label={t("session.messages")}>
            <Text style={{ fontFamily: mono, fontSize: 12, color: colors.muted }}>{String(view()?.stats.totalMessages ?? 0)}</Text>
          </SettingsRow>
          <SettingsRow label={t("session.tokens")}>
            <Text style={{ fontFamily: mono, fontSize: 12, color: colors.muted }}>{formatCompactCount(tokens())}</Text>
          </SettingsRow>
          <SettingsRow label={t("session.cost")}>
            <Text style={{ fontFamily: mono, fontSize: 12, color: colors.muted }}>{formatCostShort(cost()) ?? "—"}</Text>
          </SettingsRow>
          <SettingsRow label={t("session.totalActive")}>
            <Text style={{ fontFamily: mono, fontSize: 12, color: colors.muted }}>{formatActiveDuration(activeMs())}</Text>
          </SettingsRow>
          <SettingsRow label={t("session.toolCalls")}>
            <Text style={{ fontFamily: mono, fontSize: 12, color: colors.muted }}>{formatCompactCount(toolCalls())}</Text>
          </SettingsRow>
        </SettingsCard>

        <SettingsCard title={t("session.projectSection")}>
          <CopyRow first label={t("session.file")} value={view()?.filePath ?? ""} copyLabel={t("session.copyFile")} />
          <CopyRow label={t("session.projectDir")} value={info()?.cwd ?? ""} copyLabel={t("session.copyProjectDir")} />
          <If when={info()?.branch}>
            {(branch) => <CopyRow label={t("session.gitBranch")} value={branch()} copyLabel={t("session.copyGitBranch")} />}
          </If>
        </SettingsCard>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          <Button label={t("sidebar.rename")} variant="secondary" size="small" icon="text" onPress={beginRename} />
          <Button label={t("sidebar.fork")} variant="secondary" size="small" icon="replace" busy={busy()} disabled={busy()} onPress={() => void fork()} />
          <Button
            label={exporting() ? t("sidebar.exportingHtml") : t("sidebar.exportHtml")}
            variant="secondary"
            size="small"
            icon="download"
            busy={exporting()}
            disabled={exporting()}
            onPress={() => void exportSession()}
          />
        </View>

        <If when={actionError()}>
          {(message) => <SettingsError>{message()}</SettingsError>}
        </If>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Icon name="system" size={10} tint={colors.faint} />
          <Text style={{ fontSize: 10.5, color: colors.faint }}>{id() ?? ""}</Text>
        </View>
      </Scroll>
    </If>
  );
}

/** A finite number, else 0 (the server can omit a token counter). */
function numberOrZero(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
