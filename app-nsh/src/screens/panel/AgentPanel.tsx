// A subagent run's tab: its transcript, read-only, beside steer and abort.
//
// pi-next's `components/AgentSessionPanel.tsx` opens the child with the same
// `ChatWindow` the main chat uses, so a subagent can be talked to directly.
// This app's main chat owns one session's live store, so the dock keeps the
// run read-only and offers the two controls the run route has
// (`POST /api/subagents/[id]`): steer the run, or abort it. The transcript is
// `SessionTranscript`, the same file reader the side tab uses.
import { resource, signal, Text, View } from "nsh";
import { Input } from "nsh/base";
import { readSession } from "../../api/sessions";
import { abortSubagent, isSubagentActiveStatus, steerSubagent } from "../../api/subagents";
import { errorText } from "../../ui/errors";
import { t } from "../../ui/i18n";
import { Button, colors, inputLook, type Tone, Status } from "../../ui/kit";
import { activeCwd } from "../../state/session";
import { SessionTranscript } from "../chat/SessionTranscript";
import { chooseSession } from "../shell/state";
import {
  bumpSubagentStatus,
  subagentStatusLabel,
  useSubagentRun,
} from "./subagent-status";

/** Status → the kit's tone (the dot's own colors are in `subagent-status`). */
function statusTone(status: string | null): Tone {
  if (status === "starting" || status === "queued" || status === "running") return "accent";
  if (status === "completed") return "up";
  if (status === "failed") return "danger";
  if (status === "aborted" || status === "interrupted") return "warn";
  return "neutral";
}

export function AgentPanel(props: { sessionId: string; name?: string }) {
  const run = useSubagentRun(props.sessionId);
  const view = resource(
    () => props.sessionId,
    async (sessionId, info) => readSession(sessionId, { summaryTree: true, signal: info.signal }),
  );
  const steerText = signal("");
  const pending = signal(false);
  const failure = signal<string | null>(null);

  const status = () => run()?.status ?? null;
  const active = () => isSubagentActiveStatus(status());
  const title = () => (props.name ?? "").trim()
    || (run()?.description ?? "").trim()
    || (view()?.info?.name ?? "").trim()
    || t("agentSwitcher.subagent");

  const steer = async (): Promise<void> => {
    const message = steerText().trim();
    if (!message || pending() || !active()) return;
    pending.set(true);
    failure.set(null);
    try {
      await steerSubagent(props.sessionId, message);
      steerText.set("");
      bumpSubagentStatus();
    } catch (error) {
      failure.set(errorText(error));
    } finally {
      pending.set(false);
    }
  };

  const abort = async (): Promise<void> => {
    if (pending() || !active()) return;
    pending.set(true);
    failure.set(null);
    try {
      await abortSubagent(props.sessionId);
      bumpSubagentStatus();
    } catch (error) {
      failure.set(errorText(error));
    } finally {
      pending.set(false);
    }
  };

  const openInMainChat = () => {
    const info = view()?.info;
    chooseSession(
      props.sessionId,
      info?.cwd ?? activeCwd() ?? "",
      title(),
    );
  };

  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <View
        style={{
          flexShrink: 0,
          gap: 6,
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderBottomWidth: 1,
          borderBottomColor: colors.line,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={{ fontSize: 12, fontWeight: "600", color: colors.text, numberOfLines: 1 }}>
              {title()}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <Status label={subagentStatusLabel(status()) ?? t("agentSwitcher.subagent")} tone={statusTone(status())} />
              <If when={run()?.profile}>
                {(profile) => <Text style={{ fontSize: 10.5, color: colors.faint }}>{profile()}</Text>}
              </If>
            </View>
          </View>
          <Button label={t("subagent.openInMainChat")} variant="ghost" size="small" icon="external" onPress={openInMainChat} />
        </View>
        <Text style={{ fontSize: 10.5, color: colors.faint }}>{t("subagent.readOnly")}</Text>
      </View>

      <SessionTranscript sessionId={props.sessionId} />

      <View
        style={{
          flexShrink: 0,
          gap: 6,
          padding: 10,
          borderTopWidth: 1,
          borderTopColor: colors.line,
          backgroundColor: colors.surface,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Input
              {...inputLook({ style: { height: 30, borderRadius: 8, paddingHorizontal: 8, fontSize: 12 } })}
              value={steerText()}
              onChange={({ value }) => steerText.set(value)}
              onSubmit={() => void steer()}
              placeholder={t("subagent.steerPlaceholder")}
              accessibilityLabel={t("subagent.steerPlaceholder")}
              disabled={!active() || pending()}
            />
          </View>
          <Button
            label={t("subagent.steer")}
            variant="secondary"
            size="small"
            busy={pending()}
            disabled={!active() || pending() || steerText().trim() === ""}
            onPress={() => void steer()}
          />
          <Button
            label={t("subagent.abort")}
            variant="danger"
            size="small"
            disabled={!active() || pending()}
            onPress={() => void abort()}
          />
        </View>
        <If when={failure()}>
          {(message) => <Text style={{ fontSize: 11, color: colors.danger }}>{message()}</Text>}
        </If>
      </View>
    </View>
  );
}
