"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  codemodeTotalCost,
  formatCodemodeCost,
  formatCodemodeDuration,
  type CodemodeCallStatus,
  type CodemodeCallView,
} from "@/lib/codemode-view";

// The tool calls a codemode script made, listed under the script in its card.
// Those calls never reach the model as tool calls of their own, so they are
// rows inside this card, not separate cards (as in pi's TUI).

/** Calls shown before the rest are folded behind a button; the newest stay visible. */
export const CODEMODE_VISIBLE_CALLS = 20;

const STATUS_STYLE: Record<CodemodeCallStatus, { icon: string; color: string }> = {
  running: { icon: "…", color: "var(--warning)" },
  ok: { icon: "✓", color: "var(--success)" },
  error: { icon: "✗", color: "var(--error)" },
  cancelled: { icon: "⊘", color: "var(--text-dim)" },
};

function CallRow({ call }: { call: CodemodeCallView }) {
  const { t } = useI18n();
  const status = STATUS_STYLE[call.status];
  const duration = formatCodemodeDuration(call.durationMs);
  return (
    <li style={{ display: "flex", flexDirection: "column", gap: "var(--space-hair)", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--s2)", minWidth: 0 }}>
        <span
          role="img"
          aria-label={t(`codemode.status.${call.status}`)}
          title={t(`codemode.status.${call.status}`)}
          style={{ color: status.color, width: "var(--s3)", flexShrink: 0, textAlign: "center" }}
        >
          {status.icon}
        </span>
        <span style={{ color: "var(--text-muted)", fontWeight: 600, flexShrink: 0 }}>{call.name}</span>
        {call.args && (
          <span style={{ color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
            {call.args}
          </span>
        )}
        {duration && (
          <span style={{ color: "var(--text-dim)", flexShrink: 0, marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>{duration}</span>
        )}
        {call.cost !== undefined && (
          <span style={{ color: "var(--text-dim)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{formatCodemodeCost(call.cost)}</span>
        )}
      </div>
      {call.error && (
        <div style={{ color: "var(--error)", paddingLeft: "calc(var(--s3) * 1.5)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{call.error}</div>
      )}
    </li>
  );
}

export function CodemodeCallList({ calls, omitted, isError }: {
  calls: readonly CodemodeCallView[];
  /** Earlier calls a progress snapshot did not include. */
  omitted: number;
  isError: boolean;
}) {
  const { t } = useI18n();
  const [showAll, setShowAll] = useState(false);
  if (calls.length === 0 && omitted === 0) return null;
  const hidden = showAll ? 0 : Math.max(0, calls.length - CODEMODE_VISIBLE_CALLS);
  const shown = hidden > 0 ? calls.slice(hidden) : calls;
  // Folded rows still count: the total covers every call the result lists.
  const totalCost = codemodeTotalCost(calls);
  return (
    <div
      style={{
        borderTop: `1px solid ${isError ? "var(--danger-soft)" : "var(--success-soft)"}`,
        background: "var(--bg-subtle)",
        padding: "6px 10px",
        fontFamily: "var(--font-mono)",
        fontSize: "calc(12px + var(--chat-font-size-offset, 0px))",
        lineHeight: 1.5,
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-hair)",
        minWidth: 0,
      }}
    >
      <div style={{ color: "var(--text-dim)", fontFamily: "inherit", fontSize: "var(--text-meta)" }}>{t("codemode.calls")}</div>
      {omitted > 0 && (
        <div style={{ color: "var(--text-dim)" }}>{t("codemode.omittedCalls", { count: omitted })}</div>
      )}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          style={{ alignSelf: "flex-start", padding: 0, border: "none", background: "none", color: "var(--accent)", cursor: "pointer", font: "inherit" }}
        >
          {t("codemode.showEarlierCalls", { count: hidden })}
        </button>
      )}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
        {shown.map((call, index) => (
          <CallRow key={call.id || `${hidden + index}`} call={call} />
        ))}
      </ul>
      {totalCost !== null && (
        <div style={{ color: "var(--text-dim)" }}>{t("codemode.modelCost", { cost: formatCodemodeCost(totalCost) })}</div>
      )}
    </div>
  );
}
