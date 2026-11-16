// The chat's stats strip: what the session spent (`GET
// /api/sessions/stats`, the same rows the agent switcher shows —
// `app/api/sessions/stats/route.ts:68`) and what the run is doing.
//
// pi-next puts this on the transcript's header and on a turn's end
// (`components/ChatWindow.tsx` "usage", `lib/session-stats-format.ts`); the
// numbers are formatted by that module, so the two read alike.
//
// A streaming reply also shows its speed (`lib/stream-token-rate.ts`, pi-next's
// `MessageView` label): tokens per second, sampled every 300 ms while it
// streams and held for a few seconds after so the last value can be read.
import { cleanup, computed, effect, resource, signal, Text, untracked, View } from "nsh";
import { Badge, colors, Icon, Status } from "../../ui/kit";
import { mono } from "../../ui/fonts";
import { formatActiveDuration, formatCompactCount, formatCostShort } from "../../lib/session-stats-format";
import { agentStatePayload } from "../../api/agent";
import { sessionStats } from "../../api/sessions";
import { chatContentWidth } from "../../lib/chat-width";
import type { SessionUsageSummary } from "../../api/types";
import type { AssistantMessage } from "../../lib/types";
import {
  streamRateKey,
  streamRateStart,
  streamTokensPerSecond,
  type StreamRateStart,
} from "../../lib/stream-token-rate";
import { agentRunning, streamingMessage } from "../../state/agent";
import { t } from "../../ui/i18n";
import { selectedSessionId } from "../../state/session";

/** What `GET /api/agent/[id]` says the model's window holds now. */
type ContextUsage = { percent: number | null; contextWindow: number; tokens: number | null };

/** How often a stream's rate is measured (pi-next's 300 ms). */
const SAMPLE_MS = 300;

/** How long the last rate stays after the reply ends. */
const HOLD_MS = 5_000;

/** CJK characters count about one token each; other characters about four to a token (pi-next's estimate). */
const CJK = /[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\u{20000}-\u{2fa1f}\uac00-\ud7af]/u;

/** One small "label value" cell; `mono` for figures, as pi-next's `.usage` does. */
function Cell(props: { label: string; value: string; tint?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
      <Text style={{ fontSize: 10.5, color: colors.faint }}>{props.label}</Text>
      <Text style={{ fontSize: 10.5, fontFamily: mono, color: props.tint ?? colors.muted }}>{props.value}</Text>
    </View>
  );
}

/**
 * The tokens a streaming reply has produced so far: what pi reported (the
 * final usage, when a provider sends it along), else the characters the app
 * has, CJK weighted as pi-next's `estimateTokens` does.
 */
function streamTokens(message: AssistantMessage): number {
  const reported = message.usage?.output;
  if (typeof reported === "number" && reported > 0) return reported;
  let cjk = 0;
  let rest = 0;
  for (const block of message.content ?? []) {
    const text = block.type === "text"
      ? block.text
      : block.type === "thinking"
        ? block.thinking
        : block.type === "toolCall"
          ? (block.rawInput ?? JSON.stringify(block.input ?? {}))
          : "";
    for (const char of text) {
      if (CJK.test(char)) cjk++;
      else rest++;
    }
  }
  return cjk + rest / 4;
}

/** 42.3 · 87 for a fast model: one decimal until three digits. */
function formatRate(value: number): string {
  const rate = Math.max(0, value);
  return rate >= 100 ? String(Math.round(rate)) : rate.toFixed(1);
}

/**
 * The strip above the transcript.
 *
 * The resource's key carries the run state (`<id>:run` or `<id>:idle`), so a
 * finished turn asks the server again: the counters are the server's, not a
 * client tally, so they never drift from what the session file says.
 */
export function StatsBar() {
  const stats = resource(
    () => {
      const id = selectedSessionId();
      if (!id) return null;
      return `${id}:${agentRunning() ? "run" : "idle"}`;
    },
    async (key): Promise<{ usage: SessionUsageSummary | null; context: ContextUsage | null } | null> => {
      const id = key.slice(0, key.lastIndexOf(":"));
      // The usage rows and the live wrapper's context ring are two routes:
      // the stats are the file's totals, the context is what the model's
      // window holds right now (`GET /api/agent/[id]`'s `contextUsage`).
      const [rows, state] = await Promise.all([
        sessionStats([id]),
        agentStatePayload(id, { systemPrompt: false }).catch(() => undefined),
      ]);
      return { usage: rows[id] ?? null, context: state?.contextUsage ?? null };
    },
  );

  // A boolean, so the effect below follows a reply's start and end rather
  // than every streamed chunk (`streamingMessage` itself is read in the tick).
  const streaming = computed(() => streamingMessage() !== null);
  const rate = signal<number | null>(null);
  let sampleTimer: ReturnType<typeof setInterval> | undefined;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let sampledKey: string | null = null;
  let unkeyedStart: StreamRateStart | null = null;
  let wasStreaming = false;

  const stopSampling = (): void => {
    if (sampleTimer === undefined) return;
    clearInterval(sampleTimer);
    sampleTimer = undefined;
  };

  const sample = (): void => {
    const message = streamingMessage();
    if (!message) return;
    const tokens = streamTokens(message);
    if (tokens <= 0) return;
    const key = streamRateKey(message);
    const now = Date.now();
    if (key !== sampledKey) {
      sampledKey = key;
      rate.set(null);
    }
    const start = key === null
      ? (unkeyedStart ??= streamRateStart(null, tokens, now))
      : streamRateStart(key, tokens, now);
    const next = streamTokensPerSecond(start, tokens, now);
    if (next !== null) rate.set(next);
  };

  effect(() => {
    if (streaming()) {
      if (holdTimer !== undefined) {
        clearTimeout(holdTimer);
        holdTimer = undefined;
      }
      if (!wasStreaming) {
        wasStreaming = true;
        sampledKey = null;
        unkeyedStart = null;
        rate.set(null);
      }
      if (sampleTimer === undefined) sampleTimer = setInterval(sample, SAMPLE_MS);
      // The tick reads the stream outside this effect: a chunk must not re-run it.
      untracked(sample);
      return;
    }
    wasStreaming = false;
    sampledKey = null;
    stopSampling();
    // Keep the last value a few seconds after the stream ends (pi-next clears
    // its label at once; this leaves the number readable on a fast reply).
    if (untracked(() => rate()) !== null && holdTimer === undefined) {
      holdTimer = setTimeout(() => {
        holdTimer = undefined;
        rate.set(null);
      }, HOLD_MS);
    }
  });

  cleanup(() => {
    stopSampling();
    if (holdTimer !== undefined) clearTimeout(holdTimer);
    holdTimer = undefined;
  });

  const usage = (): SessionUsageSummary | null => stats()?.usage ?? null;
  const context = (): ContextUsage | null => stats()?.context ?? null;

  const cost = (): string | null => {
    const value = usage()?.cost;
    return typeof value === "number" ? formatCostShort(value) : null;
  };

  /**
   * Used / window · percent: the context's fill, as the ring's popup says it.
   * The session's cumulative total is not a context count, so it stands in
   * only when neither pi's used count nor a percentage can say how full the
   * window is.
   */
  const contextFill = (): { used: number; total: number; percent: number } | null => {
    const current = context();
    if (!current || current.contextWindow <= 0) return null;
    const reported = current.percent;
    const used = current.tokens
      ?? (reported !== null ? Math.round((current.contextWindow * reported) / 100) : usage()?.tokens?.total)
      ?? 0;
    const percent = reported ?? (used > 0 ? (used / current.contextWindow) * 100 : 0);
    return { used, total: current.contextWindow, percent };
  };

  const contextText = (): string | null => {
    const fill = contextFill();
    if (!fill) return null;
    return t("chat.contextUsed", {
      used: formatCompactCount(fill.used),
      total: formatCompactCount(fill.total),
      percent: String(Math.round(fill.percent)),
    });
  };

  /** Quiet until the window nears its end, then the strip's two warning colors. */
  const contextTone = (): "neutral" | "warn" | "danger" => {
    const percent = contextFill()?.percent ?? 0;
    if (percent > 90) return "danger";
    if (percent > 70) return "warn";
    return "neutral";
  };

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        height: 24,
        width: "100%",
        maxWidth: chatContentWidth(),
        alignSelf: "center",
        paddingHorizontal: 24,
        backgroundColor: "transparent",
      }}
    >
      <Icon name="chart" size={12} tint={colors.faint} />
      <If when={agentRunning()} else={<Status label={t("chat.statsIdle")} tone="neutral" />}>
        <Status label={t("chat.statsWorking")} tone="info" />
      </If>

      <If when={rate() !== null}>
        <Text style={{ fontSize: 10.5, fontFamily: mono, color: colors.accent, fontVariant: ["tabular-nums"] }}>
          {t("chat.tokenRate", { count: formatRate(rate() ?? 0) })}
        </Text>
      </If>

      <If when={stats.error()}>
        <Text style={{ fontSize: 10.5, color: colors.danger }}>{t("chat.statsUnavailable")}</Text>
      </If>
      <If when={stats.state() === "pending"}>
        <Text style={{ fontSize: 10.5, color: colors.faint }}>{t("i18n.loading")}</Text>
      </If>

      <If when={usage()}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text style={{ fontSize: 10.5, fontFamily: mono, color: colors.muted, fontVariant: ["tabular-nums"] }}>
            {t("chat.tokensInOut", {
              input: formatCompactCount(usage()?.tokens?.input ?? 0),
              output: formatCompactCount(usage()?.tokens?.output ?? 0),
            })}
          </Text>
          <If when={cost() !== null}>
            <Cell label={t("session.cost")} value={cost() ?? ""} />
          </If>
          <Cell label={t("codemode.calls")} value={formatCompactCount(usage()?.toolCalls ?? 0)} />
          <If when={(usage()?.totalActiveMs ?? 0) > 0}>
            <Cell label={t("session.totalActive")} value={formatActiveDuration(usage()?.totalActiveMs ?? 0)} />
          </If>
        </View>
      </If>

      <View style={{ flex: 1 }} />
      <If when={contextText()} else={<If when={usage()?.tokens?.total}>
        <Badge label={t("chat.contextChip", { count: formatCompactCount(usage()?.tokens?.total ?? 0) })} />
      </If>}>
        <Badge label={contextText() ?? ""} tone={contextTone()} />
      </If>
    </View>
  );
}
