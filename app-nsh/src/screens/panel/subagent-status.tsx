// A subagent tab's status dot: the run's own record, read from
// `GET /api/subagents/[id]` and polled while the run still moves.
//
// The status also comes from the session row's relation when the server kept
// no live run record (a restart settles it), but this dot follows the route
// the panel's controls use, so its colour and the Steer/Abort buttons agree.
import { cleanup, effect, resource, signal, View } from "nsh";
import { isSubagentActiveStatus, subagentRun } from "../../api/subagents";
import { colors, Spinner } from "../../ui/kit";
import { t } from "../../ui/i18n";
import type { SubagentSessionStatus } from "../../api/types";

/** Bumped after steer / abort so every open dot reads the new status now. */
export const subagentStatusRevision = signal(0);

export function bumpSubagentStatus(): void {
  subagentStatusRevision.update((revision) => revision + 1);
}

/** The status label, from pi-next's agent switcher. */
export function subagentStatusLabel(status: SubagentSessionStatus | null): string | null {
  if (status === null) return null;
  switch (status) {
    case "starting":
      return t("agentSwitcher.status.starting");
    case "queued":
    case "running":
      return t("agentSwitcher.status.running");
    case "completed":
      return t("agentSwitcher.status.completed");
    case "failed":
      return t("agentSwitcher.status.failed");
    case "aborted":
      return t("agentSwitcher.status.aborted");
    case "interrupted":
      return t("agentSwitcher.status.interrupted");
  }
}

/** The tone of a status, as pi-next's `statusColor` (running is the accent). */
export function subagentStatusColor(status: SubagentSessionStatus | null): string {
  if (status === "starting" || status === "queued" || status === "running") return colors.accent;
  if (status === "completed") return colors.up;
  if (status === "failed") return colors.danger;
  if (status === "aborted" || status === "interrupted") return colors.warn;
  return colors.faint;
}

/** The run record of one subagent, read again when the revision moves. */
export function useSubagentRun(sessionId: string) {
  return resource(
    () => ({ id: sessionId, revision: subagentStatusRevision() }),
    async (asked, info) => {
      try {
        return await subagentRun(asked.id, { signal: info.signal });
      } catch {
        // No live run record: the tab still shows the transcript; the dot is quiet.
        return null;
      }
    },
  );
}

/** The dot before a subagent tab's name (6 points, as the sidebar's). */
export function AgentStatusDot(props: { sessionId: string }) {
  const run = useSubagentRun(props.sessionId);
  const status = () => run()?.status ?? null;

  // A run that is going changes state on its own; read again every 3 s until
  // it settles. `cleanup` stops the timer when the tab or the dock goes.
  effect(() => {
    if (!isSubagentActiveStatus(status())) return;
    const timer = setInterval(() => void run.refetch(), 3000);
    cleanup(() => clearInterval(timer));
  });

  return (
    <View
      accessibilityLabel={subagentStatusLabel(status()) ?? t("agentSwitcher.subagent")}
      style={{
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: subagentStatusColor(status()),
      }}
    />
  );
}

/** A spinner beside a control while the status is still moving. */
export function AgentStatusSpinner(props: { status: SubagentSessionStatus | null }) {
  return (
    <View style={{ width: 12, height: 12, alignItems: "center", justifyContent: "center" }}>
      <If when={isSubagentActiveStatus(props.status)}>
        <Spinner size={12} tint={colors.accent} />
      </If>
    </View>
  );
}
