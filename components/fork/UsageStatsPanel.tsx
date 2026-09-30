"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ConfigButton, SettingsPage } from "../SettingsUi";
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

/** 画板 45 §用量统计 的 `.pw-stat`：标签在上、等宽数值居中、一行补充。
 *  fork:settings-frame（画板 62）—— `wide` 让一张卡横跨整行（两列栅格下 9 张卡
 *  会剩最后一张孤零零占半行；把「Token」这张最长的撑满，2×4 + 1 就齐了）。 */
function StatCard({ label, value, hint, wide = false }: { label: string; value: string; hint?: ReactNode; wide?: boolean }): ReactNode {
  return (
    <div className={`pw-stat${wide ? " is-wide" : ""}`}>
      <span className="k">{label}</span>
      <span className="v">{value}</span>
      {hint ? <span className="s">{hint}</span> : null}
    </div>
  );
}

/** 画板 45 §用量统计 的 `.pw-stats-grid`：默认四列栅格。
 *  fork:settings-frame（画板 62）—— 两栏块流里一栏只有 570，四列会挤成 130px 一卡，
 *  这时改用 `.is-2col`（两列）。 */
function StatGrid({ columns = 4, children }: { columns?: 2 | 4; children: ReactNode }): ReactNode {
  return <div className={`pw-stats-grid${columns === 2 ? " is-2col" : ""}`}>{children}</div>;
}

export function UsageStatsPanel(): ReactNode {
  const { t, locale } = useI18n();
  const [range, setRange] = useState<UsageRange>("30d");
  const [metric, setMetric] = useState<"sessions" | "tokens">("sessions");
  const [summary, setSummary] = useState<UsageStatsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // fork:usage-year-heatmap — 热力图固定看最近 12 个月，不跟着上面的区间按钮缩。
  // 7 天/30 天的窗口画出来只有四五列，一整年的节奏（哪几周在忙、哪段断了）全看不见。
  // 第二次请求走的是同一份文件缓存，实测 5ms 上下。
  const [yearSummary, setYearSummary] = useState<UsageStatsSummary | null>(null);

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

  const loadYear = useCallback(async () => {
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const query = new URLSearchParams({ range: "1y" });
      if (timeZone) query.set("tz", timeZone);
      const response = await fetch(`/api/usage-stats?${query.toString()}`, { cache: "no-store" });
      const data = await response.json() as UsageStatsSummary;
      if (!response.ok || !Array.isArray(data.days)) return;
      setYearSummary(data);
    } catch {
      // 热力图退回到当前区间的数据，不因此报错。
    }
  }, []);

  useEffect(() => {
    void load(range);
    // 「1 年」与「全部」自己就够画热力图了（后者至少不短于它），不再多打一次接口。
    if (range !== "1y" && range !== "all") void loadYear();
  }, [load, loadYear, range]);

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
  // 热力图的数据源：默认最近 12 个月（选了「1 年 / 全部」就是它自己）。
  const heatmapDays = summary && (range === "1y" || range === "all")
    ? summary.days
    : (yearSummary?.days ?? summary?.days ?? []);

  return (
    /* fork:settings-frame（画板 62）—— 用量页的三件套。
       页头原来是一枚旧类名 h2（`.settings-general-title`），够不到 board.css 的
       `.pw-sbody > h2`；周期芯片与「刷新」原本挤在内容区第一行、和统计卡连在一起。
       现在周期芯片 + 刷新 + 扫描进度进工具栏，统计与图表分两栏（570 × 2）——
       热力图原来拉满 1100，九张卡排成 4+4+1（末行孤一张）。 */
    <SettingsPage
      title={t("usage.title")}
      sub={t("usage.subtitle")}
      toolbar={
        <>
          <span className="pw-radio">
            {RANGE_ORDER.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={range === option}
                className={range === option ? "is-on" : undefined}
                onClick={() => setRange(option)}
              >
                {t(RANGE_KEYS[option])}
              </button>
            ))}
          </span>
          <span className="pw-grow" aria-hidden="true" />
          {summary && (
            <span className="pw-hint">
              {t("usage.scannedHint", { files: summary.scanned.files, parsed: summary.scanned.parsed })}
            </span>
          )}
          <ConfigButton size="small" disabled={loading} onClick={() => void load(range)}>
            {t("usage.refresh")}
          </ConfigButton>
        </>
      }
    >
      {loading && !summary && (
        <p role="status" className="pw-hint">{t("usage.loading")}</p>
      )}
      {error && <p role="alert" className="pw-alert">{t("usage.error")} {error}</p>}

      {summary && derived && (
        <>
          <div className="pw-grid2">
          <div>
          <section className="settings-general-section" style={{ marginTop: 0 }}>
            <StatGrid columns={2}>
              <StatCard
                label={t("usage.tokens")}
                value={formatCompact(summary.totals.tokens, locale)}
                hint={tokenKinds.map((kind) => `${kind.label} ${formatCompact(kind.value, locale)}`).join(" · ")}
                wide
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
          </div>

          <div>
            {hasActivity && (
            <>
              {summary.models.length > 0 && (
                <section className="settings-general-section">
                  <div className="pw-cell">
                    <h4>
                      <span className="pw-ico"><i data-ico="chart-pie" data-size="14"></i></span>
                      {t("usage.byModel")}
                    </h4>
                    <UsageShareBar
                      slices={summary.models.slice(0, 6).map((model) => ({ key: model.model, tokens: model.tokens, share: model.share }))}
                      label={t("usage.modelShare")}
                    />
                    <div className="pw-list" style={{ marginTop: "var(--s2)" }}>
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
                  </div>
                </section>
              )}

              <section className="settings-general-section">
                <div className="pw-cell">
                  <h4>
                    <span className="pw-ico"><i data-ico="activity" data-size="14"></i></span>
                    {t("usage.requestsErrors")}
                  </h4>
                  <UsageRequestsErrors
                    days={summary.days}
                    label={t("usage.requestsErrors")}
                    requestsLabel={t("usage.requestsLegend")}
                    errorsLabel={t("usage.errorsLegend")}
                  />
                </div>
              </section>
            </>
            )}
          </div>
          </div>

          {/* fork:settings-frame（画板 62）—— 热力图单独占**一整行**（1160）。
              放进 570 的一栏时，那张「53 周 × 14px ≈ 742px」的年度网格只有前 514px 可见，
              而**最近的活动全在最右端**（今天在最后一列）—— 用户看到的就是一整片
              空白灰格子，第一反应是「这页是假数据吧」。整行放得下，12 个月标签也齐。 */}
          {hasActivity && (
            <section className="settings-general-section">
              <div className="pw-cell">
                <h4>
                  <span className="pw-ico"><i data-ico="calendar-days" data-size="14"></i></span>
                  {t("usage.heatmap")}
                </h4>
                <div className="pw-inline" style={{ marginTop: "var(--s2)" }}>
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
                  <span className="pw-grow" />
                </div>
                <UsageHeatmap
                  days={heatmapDays}
                  metric={metric}
                  label={t("usage.heatmap")}
                  lessLabel={t("usage.less")}
                  moreLabel={t("usage.more")}
                />
              </div>
            </section>
          )}

          {hasActivity && (
          <div className="pw-grid2">
          <div>
              <section className="settings-general-section">
                <div className="pw-cell">
                  <h4>
                    <span className="pw-ico"><i data-ico="chart-column" data-size="14"></i></span>
                    {t("usage.dailyTokens")}
                  </h4>
                  <UsageDailyBars days={summary.days} label={t("usage.dailyTokens")} />
                </div>
              </section>
          </div>

          <div>
              {projects.length > 0 && (
                <section className="settings-general-section">
                  <div className="pw-cell">
                    <h4>
                      <span className="pw-ico"><i data-ico="folder" data-size="14"></i></span>
                      {t("usage.byProject")}
                    </h4>
                    <div className="pw-list" style={{ marginTop: "var(--s2)" }}>
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
                      <p className="pw-muted" style={{ marginTop: "var(--s2)" }}>{t("usage.moreProjects", { count: projects.length - 8 })}</p>
                    )}
                  </div>
                </section>
              )}
          </div>
          </div>
          )}
        </>
      )}
    </SettingsPage>
  );
}
