"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { PwaBanner, PwaPage, PwaPickBar, PwaSetRow } from "@/components/pwa/PwaPage";
import { SettingsPage } from "../SettingsUi";
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

/** 画板 D-19 帧 A 的 `.d-stat`：图标行 + 标签 + 徽章，等宽数值，一行补充。
 *  fork:settings-frame（画板 62）—— `wide` 让一张卡横跨整行（两列栅格下 9 张卡
 *  会剩最后一张孤零零占半行；把「Token」这张最长的撑满，2×4 + 1 就齐了）。 */
function StatCard({ label, value, hint, wide = false }: { label: string; value: string; hint?: ReactNode; wide?: boolean }): ReactNode {
  return (
    <div className="d-stat" style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <span className="d-t-xs d-t-faint d-grow">{label}</span>
      <span className="d-t-title d-num">{value}</span>
      {hint ? <span className="d-t-xs d-t-faint">{hint}</span> : null}
    </div>
  );
}

/** 画板 D-19 帧 A 的 `.d-statgrid`：默认四列；两栏块流里一栏只有 570，
 *  四列会挤成 130px 一卡，这时改用 `.d-grid2`（两列）。 */
function StatGrid({ columns = 4, children }: { columns?: 2 | 4; children: ReactNode }): ReactNode {
  return <div className={columns === 2 ? "d-grid2" : "d-statgrid"}>{children}</div>;
}

export function UsageStatsPanel(): ReactNode {
  const { t, locale } = useI18n();
  const mobile = useIsMobile();
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

  // fork:v5-landing Wave B · M-09 帧 C · 用量 ——
  // 手机上这是一个**独立一级页**，只回答「这个月烧了多少」：口径与数字在同一屏，
  // 三块图（每日柱 / 活跃热力 / 模型占比）读的还是同一份会话文件，**没有任何一项
  // 是编的**（不造 TTFT、不造输出速度 —— 会话文件里根本没有这两个样本）。
  if (mobile) {
    return (
      <PwaPage
        title={t("usage.title")}
        actions={
          <button
            type="button"
            className="m-top-btn"
            title={t("usage.refresh")}
            aria-label={t("usage.refresh")}
            disabled={loading}
            onClick={() => void load(range)}
          >
            <i data-ico="refresh-cw" data-size="16" aria-hidden="true" />
          </button>
        }
      >
        <div className="m-cardgroup">
          <PwaPickBar
            options={RANGE_ORDER.map((option) => ({ value: option, label: t(RANGE_KEYS[option]) }))}
            value={range}
            onChange={(next) => setRange(next as UsageRange)}
          />
          <PwaSetRow
            icon="sigma"
            label={t("usage.tokens")}
            sub={tokenKinds.map((kind) => `${kind.label} ${formatCompact(kind.value, locale)}`).join(" · ")}
            trailing={<span className="m-t-lg m-t-b">{formatCompact(totals?.tokens ?? 0, locale)}</span>}
          />
          <PwaSetRow
            icon="percent"
            label={t("usage.cost")}
            sub={summary ? t("usage.scannedHint", { files: summary.scanned.files, parsed: summary.scanned.parsed }) : undefined}
            trailing={<span className="m-t-lg m-t-b">{formatCost(totals?.cost ?? 0, locale)}</span>}
          />
          <PwaSetRow
            icon="activity"
            label={t("usage.messages")}
            sub={t("usage.sessionsCount", { count: totals?.sessions ?? 0 })}
            trailing={<span className="m-t-lg m-t-b">{formatCompact(totals?.messages ?? 0, locale)}</span>}
          />
          <PwaSetRow
            icon="triangle-alert"
            label={t("usage.successRate")}
            sub={derived ? t("usage.failures", { count: derived.errors }) : undefined}
            trailing={
              <span className="m-badge ok">
                {derived ? `${(derived.successRate * 100).toFixed(0)}%` : "—"}
              </span>
            }
          />
          {derived && (
            <PwaSetRow
              icon="calendar-days"
              label={t("usage.activeDays")}
              sub={`${t("usage.streak")} ${formatCompact(derived.streak, locale)} · ${t("usage.cacheTokens")} ${formatCompact(totals?.tokensByKind.cacheRead ?? 0, locale)}`}
            />
          )}
        </div>

        {loading && !summary && <p role="status" className="m-t-xs m-t-faint">{t("usage.loading")}</p>}
        {error && <PwaBanner icon="triangle-alert" tone="err" role="alert">{`${t("usage.error")} ${error}`}</PwaBanner>}
        {summary && !hasActivity && <PwaBanner icon="info">{t("usage.empty")}</PwaBanner>}

        {summary && derived && hasActivity && (
          <>
            <div className="m-cardgroup">
              <UsageDailyBars days={summary.days} label={t("usage.dailyTokens")} />
            </div>

            <div className="m-cardgroup">
              <PwaSetRow
                label={t("usage.metricTokens")}
                sub={t("usage.subtitle")}
                trailing={
                  <span className="m-hist-row">
                    <button
                      type="button"
                      className={`m-picktag${metric === "sessions" ? " is-on" : ""}`}
                      aria-pressed={metric === "sessions"}
                      onClick={() => setMetric("sessions")}
                    >
                      {t("usage.metricSessions")}
                    </button>
                    <button
                      type="button"
                      className={`m-picktag${metric === "tokens" ? " is-on" : ""}`}
                      aria-pressed={metric === "tokens"}
                      onClick={() => setMetric("tokens")}
                    >
                      {t("usage.metricTokens")}
                    </button>
                  </span>
                }
              />
              <UsageHeatmap
                days={heatmapDays}
                metric={metric}
                label={t("usage.heatmap")}
                metricLabel={metric === "sessions" ? t("usage.metricSessions") : t("usage.metricTokens")}
                lessLabel={t("usage.less")}
                moreLabel={t("usage.more")}
              />
            </div>

            <div className="m-cardgroup">
              <UsageRequestsErrors
                days={summary.days}
                label={t("usage.requestsErrors")}
                requestsLabel={t("usage.requestsLegend")}
                errorsLabel={t("usage.errorsLegend")}
              />
            </div>

            {summary.models.length > 0 && (
              <div className="m-cardgroup">
                <PwaSetRow
                  icon="chart-pie"
                  label={t("usage.byModel")}
                  sub={derived.topModel ? t("usage.topModel") : undefined}
                />
                <UsageShareBar
                  slices={summary.models.slice(0, 6).map((model) => ({ key: model.model, tokens: model.tokens, share: model.share }))}
                  label={t("usage.modelShare")}
                />
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
            )}

            {projects.length > 0 && (
              <div className="m-cardgroup">
                <PwaSetRow icon="folder" label={t("usage.byProject")} />
                {projects.slice(0, 8).map((project) => (
                  <UsageListRow
                    key={project.project || "unknown"}
                    title={projectName(project.project)}
                    meta={`${t("usage.sessionsCount", { count: project.sessions })} · ${t("usage.requests", { count: project.messages })} · ${formatCost(project.cost, locale)}`}
                    trailing={`${formatCompact(project.tokens, locale)} tok`}
                  />
                ))}
                {projects.length > 8 && (
                  <PwaSetRow
                    label={t("usage.moreProjects", { count: projects.length - 8 })}
                  />
                )}
              </div>
            )}
          </>
        )}
      </PwaPage>
    );
  }

  return (
    /* fork:settings-frame（画板 62）—— 用量页的三件套。
       「刷新」按 62 落位表是**页级动作**（页头右端；DOM 抄画板 45 §用量的页头动作
       `pw-btn outline sm` + refresh-cw），不是工具栏按钮。工具栏只留周期芯片
       （筛选）与扫描计数 —— 62 的页头规则：计数进工具栏的等宽读数，不进 sub。 */
    <SettingsPage
      title={t("usage.title")}
      sub={t("usage.subtitle")}
      actions={
        <button
          type="button"
          className="d-btn ghost sm"
          disabled={loading}
          onClick={() => void load(range)}
        >
          <i data-ico="refresh-cw" data-size="13" aria-hidden="true" />
          {t("usage.refresh")}
        </button>
      }
      toolbar={
        <>
          <span className="d-seg">
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
          <span className="d-grow" aria-hidden="true" />
          {summary && (
            <span className="d-mono d-t-faint">
              {t("usage.scannedHint", { files: summary.scanned.files, parsed: summary.scanned.parsed })}
            </span>
          )}
        </>
      }
    >
      {loading && !summary && (
        <p role="status" className="d-t-xs d-t-faint">{t("usage.loading")}</p>
      )}
      {error && <p role="alert" className="d-banner err">{t("usage.error")} {error}</p>}

      {summary && derived && (
        <>
          {/* 第一段两栏：左 = 九张统计卡（is-wide 首卡撑满 → 1 + 2×4，末行不孤），
              右 = 按模型 / 请求与错误。图表容器是画板 45 的 `.pw-cell` + `h4`，
              不再套产品自绘的 `.settings-general-section`（那层 --border/--radius-lg
              壳与 `.pw-cell` 的画板边框叠成双框，DIVERGENCE 145 的登记残留）。 */}
          <div className="d-grid2">
          <div>
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

            {!hasActivity && (
              <p role="status" className="d-t-xs d-t-faint">{t("usage.empty")}</p>
            )}
          </div>

          <div>
            {hasActivity && (
            <>
              {summary.models.length > 0 && (
                <div className="d-chart">
                  <div className="d-chart-head">
                    <i data-ico="chart-pie" data-size="14" aria-hidden="true" />
                    {t("usage.byModel")}
                  </div>
                  <div className="d-card-body d-col" style={{ gap: "var(--nx-sp-2)" }}>
                  <UsageShareBar
                    slices={summary.models.slice(0, 6).map((model) => ({ key: model.model, tokens: model.tokens, share: model.share }))}
                    label={t("usage.modelShare")}
                  />
                  <div className="d-col">
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
                </div>
              )}

              <div className="d-chart" style={summary.models.length > 0 ? { marginTop: "var(--nx-sp-3)" } : undefined}>
                <div className="d-chart-head">
                  <i data-ico="activity" data-size="14" aria-hidden="true" />
                  {t("usage.requestsErrors")}
                </div>
                <div className="d-card-body">
                <UsageRequestsErrors
                  days={summary.days}
                  label={t("usage.requestsErrors")}
                  requestsLabel={t("usage.requestsLegend")}
                  errorsLabel={t("usage.errorsLegend")}
                />
                </div>
              </div>
            </>
            )}
          </div>
          </div>

          {/* fork:settings-frame（画板 62）—— 热力图单独占**一整行**（1160）。
              放进 570 的一栏时，那张「53 周 × 14px ≈ 742px」的年度网格只有前 514px 可见，
              而**最近的活动全在最右端**（今天在最后一列）—— 用户看到的就是一整片
              空白灰格子，第一反应是「这页是假数据吧」。整行放得下，12 个月标签也齐。
              整行块的 `margin-top:var(--s3)` 抄画板 45 §按项目 的整行 `.pw-cell`。 */}
          {hasActivity && (
            <div className="d-chart" style={{ marginTop: "var(--nx-sp-3)" }}>
              <div className="d-chart-head">
                <i data-ico="calendar-days" data-size="14" aria-hidden="true" />
                {t("usage.heatmap")}
              </div>
              <div className="d-card-body">
              <div className="d-row" style={{ marginTop: "var(--nx-sp-2)" }}>
                <span className="d-seg">
                  <button
                    type="button"
                    className={metric === "sessions" ? "is-on" : undefined}
                    aria-pressed={metric === "sessions"}
                    onClick={() => setMetric("sessions")}
                  >
                    {t("usage.metricSessions")}
                  </button>
                  <button
                    type="button"
                    className={metric === "tokens" ? "is-on" : undefined}
                    aria-pressed={metric === "tokens"}
                    onClick={() => setMetric("tokens")}
                  >
                    {t("usage.metricTokens")}
                  </button>
                </span>
                <span className="d-grow" />
              </div>
              <UsageHeatmap
                days={heatmapDays}
                metric={metric}
                label={t("usage.heatmap")}
                lessLabel={t("usage.less")}
                moreLabel={t("usage.more")}
              />
              </div>
            </div>
          )}

          {hasActivity && (
          <div className="d-grid2" style={{ marginTop: "var(--nx-sp-3)" }}>
          <div>
              <div className="d-chart">
                <div className="d-chart-head">
                  <i data-ico="chart-column" data-size="14" aria-hidden="true" />
                  {t("usage.dailyTokens")}
                </div>
                <div className="d-card-body">
                <UsageDailyBars days={summary.days} label={t("usage.dailyTokens")} />
                </div>
              </div>
          </div>

          <div>
              {projects.length > 0 && (
                <div className="d-chart">
                  <div className="d-chart-head">
                    <i data-ico="folder" data-size="14" aria-hidden="true" />
                    {t("usage.byProject")}
                  </div>
                  <div className="d-card-body d-col" style={{ gap: "var(--nx-sp-2)" }}>
                  <div className="d-col">
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
                    <p className="d-t-xs d-t-faint">{t("usage.moreProjects", { count: projects.length - 8 })}</p>
                  )}
                  </div>
                </div>
              )}
          </div>
          </div>
          )}
        </>
      )}
    </SettingsPage>
  );
}
