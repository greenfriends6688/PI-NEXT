"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ConfigButton } from "../SettingsUi";
import { TEXT } from "@/lib/typography";
import {
  UsageDailyBars,
  UsageHeatmap,
  UsageListRow,
  UsageRequestsErrors,
  UsageShareBar,
} from "./usage-charts";
import type { UsageRange, UsageStatsSummary } from "@/lib/usage-stats";

/*
 * fork:usage-dashboard — the "Usage" settings section, laid out like the reference
 * dashboard (musepi stats): a card grid on top, then the year heatmap, the model
 * share bar + list, a requests/errors scatter, daily token bars and a per-project list.
 *
 * Data comes from `GET /api/usage-stats`, which aggregates `lib/usage-stats` numbers
 * across every session file and caches per-file results by (size, mtimeMs). The panel
 * is read-only: the only source of truth is the session files themselves.
 *
 * Metrics the session files cannot answer are deliberately absent rather than faked —
 * there is no first-token latency or output-speed sample in the `.jsonl` format, and
 * "errors" can only mean failed tool results (`isError` on a toolResult entry).
 */

const RANGE_KEYS: Record<UsageRange, string> = {
  "7d": "usage.range7d",
  "30d": "usage.range30d",
  "1y": "usage.range1y",
  all: "usage.rangeAll",
};

const RANGE_ORDER: readonly UsageRange[] = ["7d", "30d", "1y", "all"];

function formatCompact(value: number, locale: string): string {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return new Intl.NumberFormat(locale).format(Math.round(value));
}

function formatCost(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

/** The tail of a session's cwd, which is what a project is recognisable by. */
function projectName(cwd: string): string {
  if (!cwd) return "—";
  const parts = cwd.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: ReactNode }): ReactNode {
  return (
    <div
      style={{
        display: "grid",
        gap: 3,
        alignContent: "start",
        padding: "12px 13px",
        border: "1px solid var(--border-faint)",
        borderRadius: "var(--radius-lg)",
        background: "var(--bg-panel)",
        minWidth: 0,
      }}
    >
      <strong style={{ fontSize: TEXT.xl, color: "var(--text)", fontVariantNumeric: "tabular-nums", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {value}
      </strong>
      <span style={{ fontSize: TEXT.xs, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      {hint && (
        <span style={{ fontSize: TEXT["2xs"], color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{hint}</span>
      )}
    </div>
  );
}

function StatGrid({ children }: { children: ReactNode }): ReactNode {
  return (
    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
      {children}
    </div>
  );
}

export function UsageStatsPanel(): ReactNode {
  const { t, locale } = useI18n();
  const [range, setRange] = useState<UsageRange>("30d");
  const [metric, setMetric] = useState<"sessions" | "tokens">("sessions");
  const [summary, setSummary] = useState<UsageStatsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextRange: UsageRange) => {
    setLoading(true);
    setError(null);
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const query = new URLSearchParams({ range: nextRange });
      if (timeZone) query.set("tz", timeZone);
      const response = await fetch(`/api/usage-stats?${query.toString()}`, { cache: "no-store" });
      const data = await response.json() as UsageStatsSummary & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      if (!Array.isArray(data.days) || !Array.isArray(data.models) || !data.totals) {
        throw new Error("Malformed usage response");
      }
      setSummary(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(range);
  }, [load, range]);

  const totals = summary?.totals;
  const hasActivity = (totals?.tokens ?? 0) > 0 || (totals?.sessions ?? 0) > 0;

  // 卡片里那几个「从 days 推出来」的数字：活跃天数、当前连续天数、失败数。
  const derived = useMemo(() => {
    if (!summary) return null;
    let activeDays = 0;
    let errors = 0;
    let toolResults = 0;
    for (const day of summary.days) {
      if (day.sessions > 0 || day.messages > 0 || day.tokens > 0) activeDays += 1;
      errors += day.errors;
      toolResults += day.toolResults;
    }
    // 当前连续天数：从最后一天往回数（今天没有活动就从昨天开始，不算断）。
    let streak = 0;
    for (let index = summary.days.length - 1; index >= 0; index -= 1) {
      const day = summary.days[index];
      const busy = day.sessions > 0 || day.messages > 0 || day.tokens > 0;
      if (busy) { streak += 1; continue; }
      if (index === summary.days.length - 1) continue;
      break;
    }
    const topModel = summary.models[0] ?? null;
    return {
      activeDays,
      streak,
      errors,
      toolResults,
      topModel,
      // 「工具成功率」= 没失败的工具结果占全部工具结果的比例；区间内没有工具调用时
      // 没有样本可言，按 100% 显示而不是 NaN。
      successRate: toolResults > 0 ? Math.max(0, 1 - errors / toolResults) : 1,
    };
  }, [summary]);

  const tokenKinds = useMemo(() => {
    if (!totals) return [];
    return [
      { label: t("usage.inputTokens"), value: totals.tokensByKind.input },
      { label: t("usage.outputTokens"), value: totals.tokensByKind.output },
      { label: t("usage.cacheReadTokens"), value: totals.tokensByKind.cacheRead },
      { label: t("usage.cacheWriteTokens"), value: totals.tokensByKind.cacheWrite },
    ];
  }, [t, totals]);

  const projects = summary?.projects ?? [];

  return (
    <div className="settings-general">
      <h2 className="settings-general-title">{t("usage.title")}</h2>
      <p className="settings-chat-range-hint" style={{ marginTop: -6 }}>{t("usage.subtitle")}</p>

      <section className="settings-general-section">
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {RANGE_ORDER.map((option) => (
            <ConfigButton
              key={option}
              variant={range === option ? "primary" : "secondary"}
              size="small"
              aria-pressed={range === option}
              onClick={() => setRange(option)}
            >
              {t(RANGE_KEYS[option])}
            </ConfigButton>
          ))}
          <span style={{ flex: 1 }} />
          <ConfigButton variant="ghost" size="small" disabled={loading} onClick={() => void load(range)}>
            {t("usage.refresh")}
          </ConfigButton>
        </div>
        {summary && (
          <p className="settings-chat-range-hint" style={{ marginBottom: 0 }}>
            {t("usage.scannedHint", { files: summary.scanned.files, parsed: summary.scanned.parsed })}
          </p>
        )}
      </section>

      {loading && !summary && (
        <p role="status" className="settings-chat-range-hint">{t("usage.loading")}</p>
      )}
      {error && <p role="alert" className="settings-general-error">{t("usage.error")} {error}</p>}

      {summary && derived && (
        <>
          <section className="settings-general-section">
            <StatGrid>
              <StatCard
                label={t("usage.tokens")}
                value={formatCompact(summary.totals.tokens, locale)}
                hint={tokenKinds.map((kind) => `${kind.label} ${formatCompact(kind.value, locale)}`).join(" · ")}
              />
              <StatCard label={t("usage.sessions")} value={formatCompact(summary.totals.sessions, locale)} />
              <StatCard label={t("usage.messages")} value={formatCompact(summary.totals.messages, locale)} />
              <StatCard label={t("usage.activeDays")} value={formatCompact(derived.activeDays, locale)} />
              <StatCard label={t("usage.streak")} value={formatCompact(derived.streak, locale)} />
              <StatCard
                label={t("usage.topModel")}
                value={derived.topModel ? derived.topModel.model : "—"}
                hint={derived.topModel ? t("usage.share", { percent: (derived.topModel.share * 100).toFixed(1) }) : undefined}
              />
              <StatCard label={t("usage.cacheTokens")} value={formatCompact(summary.totals.tokensByKind.cacheRead, locale)} />
              <StatCard
                label={t("usage.successRate")}
                value={`${(derived.successRate * 100).toFixed(0)}%`}
                hint={t("usage.failures", { count: derived.errors })}
              />
              <StatCard label={t("usage.cost")} value={formatCost(summary.totals.cost, locale)} />
            </StatGrid>
          </section>

          {!hasActivity && (
            <p role="status" className="settings-chat-range-hint">{t("usage.empty")}</p>
          )}

          {hasActivity && (
            <>
              <section className="settings-general-section">
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <h3 className="settings-general-heading" style={{ margin: 0 }}>{t("usage.heatmap")}</h3>
                  <span style={{ flex: 1 }} />
                  <ConfigButton
                    variant={metric === "sessions" ? "primary" : "ghost"}
                    size="small"
                    aria-pressed={metric === "sessions"}
                    onClick={() => setMetric("sessions")}
                  >
                    {t("usage.metricSessions")}
                  </ConfigButton>
                  <ConfigButton
                    variant={metric === "tokens" ? "primary" : "ghost"}
                    size="small"
                    aria-pressed={metric === "tokens"}
                    onClick={() => setMetric("tokens")}
                  >
                    {t("usage.metricTokens")}
                  </ConfigButton>
                </div>
                <UsageHeatmap
                  days={summary.days}
                  metric={metric}
                  label={t("usage.heatmap")}
                  lessLabel={t("usage.less")}
                  moreLabel={t("usage.more")}
                />
              </section>

              {summary.models.length > 0 && (
                <section className="settings-general-section">
                  <h3 className="settings-general-heading">{t("usage.byModel")}</h3>
                  <UsageShareBar
                    slices={summary.models.slice(0, 6).map((model) => ({ key: model.model, tokens: model.tokens, share: model.share }))}
                    label={t("usage.modelShare")}
                  />
                  <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
                    {summary.models.slice(0, 8).map((model) => (
                      <UsageListRow
                        key={model.model}
                        accent
                        title={model.model}
                        meta={`${t("usage.requests", { count: model.messages })} · ${formatCompact(model.tokens, locale)} tok · ${formatCost(model.cost, locale)}`}
                        trailing={`${(model.share * 100).toFixed(1)}%`}
                      />
                    ))}
                  </div>
                </section>
              )}

              <section className="settings-general-section">
                <h3 className="settings-general-heading">{t("usage.requestsErrors")}</h3>
                <UsageRequestsErrors
                  days={summary.days}
                  label={t("usage.requestsErrors")}
                  requestsLabel={t("usage.requestsLegend")}
                  errorsLabel={t("usage.errorsLegend")}
                />
              </section>

              <section className="settings-general-section">
                <h3 className="settings-general-heading">{t("usage.dailyTokens")}</h3>
                <UsageDailyBars days={summary.days} label={t("usage.dailyTokens")} />
              </section>

              {projects.length > 0 && (
                <section className="settings-general-section">
                  <h3 className="settings-general-heading">{t("usage.byProject")}</h3>
                  <div style={{ display: "grid", gap: 6 }}>
                    {projects.slice(0, 8).map((project) => (
                      <UsageListRow
                        key={project.project || "unknown"}
                        title={projectName(project.project)}
                        meta={`${t("usage.sessionsCount", { count: project.sessions })} · ${t("usage.requests", { count: project.messages })} · ${formatCost(project.cost, locale)}`}
                        trailing={`${formatCompact(project.tokens, locale)} tok`}
                      />
                    ))}
                  </div>
                  {projects.length > 8 && (
                    <p className="settings-chat-range-hint">{t("usage.moreProjects", { count: projects.length - 8 })}</p>
                  )}
                </section>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
