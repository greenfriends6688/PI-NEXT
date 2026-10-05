"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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

/* fork:v5-landing 逐帧核对（M-09 帧 C）—— 画板那一屏的最后一件是 `.m-banner`：
 * 「缓存命中不计费，但计入 token：命中 71% 的部分在柱状图里已经扣掉。」
 * 口径行必须与图**同屏**，否则数字会被当成账单。产品此前只有柱状图副行上的
 * 一句 `usage.subtitle`，屏尾没有这条横幅。
 * 走本地三语表而不是改 `lib/i18n/messages/**`（口径与 `components/pwa/settingsHub.ts`、
 * `components/fork/McpLogModal.tsx`、`ThemeSkinStudio` 同一做法）。 */
const CACHE_BILLING_NOTE: Record<string, string> = {
  en: "Cached hits are not billed but still count as tokens; the cached portion is already deducted from the bars.",
  "zh-CN": "缓存命中不计费，但计入 token：命中的那部分在柱状图里已经扣掉。",
  "zh-TW": "快取命中不计費，但計入 token：命中的那部分在柱狀圖裡已經扣掉。",
};

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

/* fork:v5-landing · D-19 —— `.d-stat` 抄画板帧 A 的原文：顶行是
   `<div class="d-row">` = 图标 + 标签 + 徽章，下面才是等宽大数与补充行。
   产品此前只发「标签 / 数值 / 补充」三层，所以图标与徽章（区间、口径、健康度）
   全都无处落位 —— 徽章承载的正是画板那句「范围切换是同一套结构换数字」的证据。 */
function StatCard({
  icon,
  label,
  badge,
  tone = "mute",
  value,
  hint,
}: {
  icon: string;
  label: string;
  badge?: string;
  tone?: "ok" | "warn" | "mute" | "info";
  value: string;
  hint?: string;
}): ReactNode {
  return (
    <div className="d-stat">
      <div className="d-row">
        <i data-ico={icon} data-size="13" aria-hidden="true" />
        <span className="d-t-xs d-t-faint d-grow">{label}</span>
        {badge ? <span className={`d-badge ${tone}`}>{badge}</span> : null}
      </div>
      <div className="d-t-title d-num">{value}</div>
      {hint ? <div className="d-t-xs d-t-faint">{hint}</div> : null}
    </div>
  );
}

/** 精确计数（18,642）；`formatCompact` 留给空间不够的地方。 */
function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(Math.round(value));
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
    const { totals } = summary;
    // fork:v5-landing · D-19 帧 A/C —— 卡片与「每日费用」那几个派生数全部来自
    // 同一份 summary，没有第二次采样：日均按**有花费的天数**算（把没花钱的休假日
    // 摊进分母会让日均偏低，而看板要回答的正是「花钱那天平均多少」）。
    let spentDays = 0;
    let busiest = summary.days[0] ?? null;
    let quietest: UsageStatsSummary["days"][number] | null = null;
    for (const day of summary.days) {
      if (day.cost <= 0) continue;
      spentDays += 1;
      if (!busiest || day.cost > busiest.cost) busiest = day;
      if (!quietest || day.cost < quietest.cost) quietest = day;
    }
    const unbound = summary.projects.find((project) => !project.project) ?? null;
    return {
      activeDays,
      streak,
      errors,
      toolResults,
      topModel,
      // 「工具成功率」= 没失败的工具结果占全部工具结果的比例；区间内没有工具调用时
      // 没有样本可言，按 100% 显示而不是 NaN。
      successRate: toolResults > 0 ? Math.max(0, 1 - errors / toolResults) : 1,
      costPerDay: spentDays > 0 ? totals.cost / spentDays : 0,
      perMessage: totals.messages > 0 ? totals.tokens / totals.messages : 0,
      perSession: totals.sessions > 0 ? totals.tokens / totals.sessions : 0,
      cacheHitRate: totals.tokens > 0 ? totals.tokensByKind.cacheRead / totals.tokens : 0,
      // 画板帧 C 的「每日费用」两行：最高/最低一天（都取自当前区间，图与左边的
      // 每日 token 柱条共用同一条时间轴）。区间内一分钱没花时两行都不渲染。
      busiest: spentDays > 0 ? busiest : null,
      quietest,
      unbound,
      projectCount: summary.projects.length,
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
  // fork:v5-landing · D-19 帧 B —— 「重播入场」是真接线：换 key 让子树整体重挂载，
  // CSS 动画随之从头跑（画板 demo.js 里是 `animation:none` + 强制回流，React 里
  // key 变更就是同一件事，且不碰 DOM style）。
  const [replay, setReplay] = useState(0);
  const replayButton = (
    <button type="button" className="d-btn sm" onClick={() => setReplay((value) => value + 1)}>
      <i data-ico="rotate-cw" data-size="13" aria-hidden="true" />
      {t("usage.replay")}
    </button>
  );
  // 热力图的数据源：默认最近 12 个月（选了「1 年 / 全部」就是它自己）。
  const heatmapDays = summary && (range === "1y" || range === "all")
    ? summary.days
    : (yearSummary?.days ?? summary?.days ?? []);
  // 画板帧 B 的「最费的四天」与热力图**同源**（同一份 days），所以它排在热力图
  // 正下方而不是跟着上面的区间按钮缩 —— 帧标签原话：「按 token 排序，与热力图同源」。
  const topDays = useMemo(
    () => [...heatmapDays].filter((day) => day.tokens > 0).sort((a, b) => b.tokens - a.tokens).slice(0, 4),
    [heatmapDays],
  );
  const topDayMax = Math.max(1, ...topDays.map((day) => day.tokens));

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

            {/* fork:v5-landing 逐帧核对（M-09 帧 C）—— 画板那一屏的最后一件是
                `.m-banner` 口径横幅（缓存命中不计费但计入 token，图里已扣）。
                产品此前屏尾只有一段空白，图与口径不同屏。 */}
            <PwaBanner icon="info">
              {CACHE_BILLING_NOTE[locale] ?? CACHE_BILLING_NOTE.en}
            </PwaBanner>
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
        /* fork:v5-boards D-27 帧 A / D-28 帧 B —— 「还在等」才配流光：用量页在
           拉首屏数据时把 loading 文案包进 `.d-shimmer`（颜色 + background-clip:text
           由类给，文字本体不动）；拿到数据后这行消失，不留下一条常驻动效。 */
        <p role="status" className="d-t-xs d-t-faint">
          <span className="d-shimmer">{t("usage.loading")}</span>
        </p>
      )}
      {error && <p role="alert" className="d-banner err">{t("usage.error")} {error}</p>}

{summary && derived && (
        <>
          {/* fork:v5-landing · D-19 —— 整块按画板四帧的顺序单列排下去：
              帧 A 统计卡 → 帧 A §模型占比 / §口径说明 → 帧 B 热力图 + 最费的天 →
              帧 C 每日 token + 输入输出拆分 / 每日费用 → 帧 D 请求与错误 + 按项目。
              分节间距由这一层的 `d-col gap:sp-6` 给（画板 `.d-set-inner` 同款）。 */}
          <div className="d-col" style={{ gap: "var(--nx-sp-6)" }}>
            {/* 帧 A · `.d-statgrid`：第一行四张就是画板那四张（总 token / 总费用 /
                消息数 / 工具成功率），第二行是产品本来就有的四个数（会话 / 缓存 /
                活跃天数 / 项目数）—— 同一张 `.d-stat` 卡片，不另起样式。
                徽章是这轮新增的落位：区间 / 计价口径 / 健康度以前无处安放。 */}
            <div className="d-statgrid">
              <StatCard
                icon="sigma"
                label={t("usage.tokens")}
                badge={t(RANGE_KEYS[range])}
                value={formatCompact(summary.totals.tokens, locale)}
                hint={tokenKinds.map((kind) => `${kind.label} ${formatCompact(kind.value, locale)}`).join(" · ")}
              />
              <StatCard
                icon="percent"
                label={t("usage.cost")}
                badge={t("usage.localPricing")}
                value={formatCost(summary.totals.cost, locale)}
                hint={t("usage.perDay", { amount: formatCost(derived.costPerDay, locale) })}
              />
              <StatCard
                icon="activity"
                label={t("usage.messages")}
                badge={formatCompact(summary.totals.messages, locale)}
                value={formatCount(summary.totals.messages, locale)}
                hint={t("usage.perMessage", { tokens: formatCompact(derived.perMessage, locale) })}
              />
              <StatCard
                icon="circle-check"
                label={t("usage.successRate")}
                badge={derived.successRate >= 0.95 ? t("usage.healthy") : t("usage.needsAttention")}
                tone={derived.successRate >= 0.95 ? "ok" : "warn"}
                value={`${(derived.successRate * 100).toFixed(0)}%`}
                hint={t("usage.failures", { count: derived.errors })}
              />
              <StatCard
                icon="messages-square"
                label={t("usage.sessions")}
                badge={formatCompact(summary.totals.sessions, locale)}
                value={formatCount(summary.totals.sessions, locale)}
                hint={t("usage.perSession", { tokens: formatCompact(derived.perSession, locale) })}
              />
              <StatCard
                icon="database"
                label={t("usage.cacheTokens")}
                badge={t("usage.hitRate", { percent: (derived.cacheHitRate * 100).toFixed(0) })}
                value={formatCompact(summary.totals.tokensByKind.cacheRead, locale)}
                hint={t("usage.cacheWriteHint", { tokens: formatCompact(summary.totals.tokensByKind.cacheWrite, locale) })}
              />
              <StatCard
                icon="calendar-days"
                label={t("usage.activeDays")}
                value={formatCount(derived.activeDays, locale)}
                hint={`${t("usage.streak")} ${formatCount(derived.streak, locale)}`}
              />
              <StatCard
                icon="folder"
                label={t("usage.projects")}
                badge={formatCompact(derived.projectCount, locale)}
                value={formatCount(derived.projectCount, locale)}
                hint={derived.unbound ? t("usage.unboundHint", { count: derived.unbound.sessions }) : undefined}
              />
            </div>

            {!hasActivity && (
              <p role="status" className="d-t-xs d-t-faint">{t("usage.empty")}</p>
            )}

            {hasActivity && (
              <>
                {/* 帧 A · §模型占比：`.d-card` 里每个模型一行（名字 / token / 费用）
                    + 一条 `.d-bar`。条形按 token 而不是费用 —— 画板把这句话印在
                    最后一行，否则用户会照条的宽度去读钱。 */}
                {summary.models.length > 0 && (
                  <div className="d-set-sec">
                    <div className="d-set-sec-t">{t("usage.byModel")}</div>
                    <div className="d-card">
                      <div className="d-card-body d-col" style={{ gap: "var(--nx-sp-3)" }}>
                        {summary.models.slice(0, 6).map((model) => (
                          <div className="d-col" key={model.model} style={{ gap: "var(--nx-sp-2)" }}>
                            <div className="d-row d-t-xs">
                              <span className="d-grow d-mono" title={model.model}>{model.model}</span>
                              <span className="d-t-dim d-mono">{formatCompact(model.tokens, locale)}</span>
                              <span className="d-t-faint d-mono">{formatCost(model.cost, locale)}</span>
                            </div>
                            <div className="d-bar">
                              <i style={{ width: `${(model.share * 100).toFixed(1)}%` }} />
                            </div>
                          </div>
                        ))}
                        <div className="d-t-xs d-t-faint">{t("usage.byTokensNote")}</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 帧 A · §口径说明：三条 `.d-set-row`，右槽一枚徽章。口径必须与
                    数字同屏 —— 这页报的是钱，错一条口径比少一个指标危险。 */}
                <div className="d-set-sec">
                  <div className="d-set-sec-t">{t("usage.caliberTitle")}</div>
                  <div className="d-set-row">
                    <div className="d-set-row-box">
                      <div className="d-set-row-t">{t("usage.caliberCacheTitle")}</div>
                      <div className="d-set-row-s">{t("usage.caliberCacheNote")}</div>
                    </div>
                    <span className="d-grow-last">
                      <span className="d-badge ok">
                        {t("usage.hitRate", { percent: (derived.cacheHitRate * 100).toFixed(0) })}
                      </span>
                    </span>
                  </div>
                  <div className="d-set-row">
                    <div className="d-set-row-box">
                      <div className="d-set-row-t">{t("usage.caliberFailedTitle")}</div>
                      <div className="d-set-row-s">{t("usage.caliberFailedNote")}</div>
                    </div>
                    <span className="d-grow-last">
                      <span className="d-badge mute">{t("usage.failures", { count: derived.errors })}</span>
                    </span>
                  </div>
                  <div className="d-set-row">
                    <div className="d-set-row-box">
                      <div className="d-set-row-t">{t("usage.caliberReadonlyTitle")}</div>
                      <div className="d-set-row-s">{t("usage.caliberReadonlyNote")}</div>
                    </div>
                    <span className="d-grow-last">
                      <span className="d-badge info">{t("usage.notBilled")}</span>
                    </span>
                  </div>
                </div>

                {/* 帧 B · 年度活跃热力图：`.d-chart` > `.d-chart-head`（图标 + 标题
                    + 口径 + 重播）+ `.d-chart-body` > `.d-heat`。热力图固定看最近
                    12 个月，不跟上面的区间按钮缩（7 天窗口只有四五列，一整年的节奏
                    全看不见）；「最费的天」与它同源，所以排在正下方。 */}
                <div className="d-chart">
                  <div className="d-chart-head">
                    <i data-ico="calendar-days" data-size="15" aria-hidden="true" />
                    <span className="d-grow">{t("usage.heatmap")}</span>
                    <span className="d-t-xs d-t-faint">{t("usage.heatmapNote")}</span>
                    {replayButton}
                  </div>
                  <div className="d-chart-body" key={`heat-${replay}`}>
                    <div className="d-row">
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
                      <span className="d-grow" aria-hidden="true" />
                    </div>
                    <UsageHeatmap
                      days={heatmapDays}
                      metric={metric}
                      label={t("usage.heatmap")}
                      metricLabel={metric === "sessions" ? t("usage.metricSessions") : t("usage.metricTokens")}
                      lessLabel={t("usage.less")}
                      moreLabel={t("usage.more")}
                    />
                  </div>
                </div>

                {topDays.length > 0 && (
                  <div className="d-chart">
                    <div className="d-chart-head">
                      <i data-ico="flame" data-size="15" aria-hidden="true" />
                      <span className="d-grow">{t("usage.topDays")}</span>
                      <span className="d-t-xs d-t-faint">{t("usage.topDaysNote")}</span>
                    </div>
                    <div className="d-chart-body d-col" style={{ gap: "var(--nx-sp-3)" }}>
                      {topDays.map((day) => (
                        <div className="d-row d-t-sm" key={day.day}>
                          <span className="d-t-faint d-mono">{day.day}</span>
                          <span className="d-bar d-grow">
                            <i style={{ width: `${Math.max(4, Math.round((day.tokens / topDayMax) * 100))}%` }} />
                          </span>
                          <span className="d-mono d-t-b">{formatCompact(day.tokens, locale)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 帧 C · 每日 token：柱条自基线长起、逐根错峰（`.d-bars` + `.d-bar-rise`）。*/}
                <div className="d-chart">
                  <div className="d-chart-head">
                    <i data-ico="chart-column-increasing" data-size="15" aria-hidden="true" />
                    <span className="d-grow">{t("usage.dailyTokens")}</span>
                    <span className="d-t-xs d-t-faint">{t(RANGE_KEYS[range])}</span>
                    {replayButton}
                  </div>
                  <div className="d-chart-body" key={`bars-${replay}`}>
                    <UsageDailyBars days={summary.days} label={t("usage.dailyTokens")} />
                  </div>
                </div>

                {/* 帧 C · 输入/输出拆分 + 每日费用 */}
                <div className="d-grid2">
                  <div className="d-chart">
                    <div className="d-chart-head">
                      <i data-ico="sigma" data-size="15" aria-hidden="true" />
                      <span className="d-grow">{t("usage.tokenSplit")}</span>
                    </div>
                    <div className="d-chart-body d-col" style={{ gap: "var(--nx-sp-2)" }}>
                      {tokenKinds.map((kind) => (
                        <Fragment key={kind.label}>
                          <div className="d-row">
                            <span className="d-grow d-t-sm d-t-dim">{kind.label}</span>
                            <span className="d-t-sm d-num d-mono">{formatCount(kind.value, locale)}</span>
                          </div>
                          <div className="d-bar">
                            <i style={{ width: `${summary.totals.tokens > 0 ? ((kind.value / summary.totals.tokens) * 100).toFixed(1) : "0"}%` }} />
                          </div>
                        </Fragment>
                      ))}
                      <div className="d-t-xs d-t-faint">{t("usage.cacheSplitNote")}</div>
                    </div>
                  </div>

                  <div className="d-chart">
                    <div className="d-chart-head">
                      <i data-ico="percent" data-size="15" aria-hidden="true" />
                      <span className="d-grow">{t("usage.dailyCost")}</span>
                      <span className="d-t-xs d-t-faint">{t(RANGE_KEYS[range])}</span>
                    </div>
                    <div className="d-chart-body d-col" style={{ gap: "var(--nx-sp-2)" }}>
                      {derived.busiest && (
                        <div className="d-set-row">
                          <div className="d-set-row-box">
                            <div className="d-set-row-t">{t("usage.busiestDay")}</div>
                            <div className="d-set-row-s">
                              {`${derived.busiest.day} · ${t("usage.requests", { count: derived.busiest.messages })} · ${formatCompact(derived.busiest.tokens, locale)}`}
                            </div>
                          </div>
                          <span className="d-grow-last d-t-b d-num">{formatCost(derived.busiest.cost, locale)}</span>
                        </div>
                      )}
                      {derived.quietest && (
                        <div className="d-set-row">
                          <div className="d-set-row-box">
                            <div className="d-set-row-t">{t("usage.quietestDay")}</div>
                            <div className="d-set-row-s">
                              {`${derived.quietest.day} · ${t("usage.requests", { count: derived.quietest.messages })} · ${formatCompact(derived.quietest.tokens, locale)}`}
                            </div>
                          </div>
                          <span className="d-grow-last d-t-b d-num">{formatCost(derived.quietest.cost, locale)}</span>
                        </div>
                      )}
                      <div className="d-banner">
                        <i data-ico="info" data-size="14" aria-hidden="true" />
                        <span>{t("usage.budgetNote")}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 帧 D · 请求与错误（两条序列共用一个 max）+ 按项目表。
                    画板帧 D 左边那张是**逐条请求**的明细表；`.jsonl` 只按天聚合，
                    没有逐条请求这一层，所以这里留真实存在的两条日序列，不编明细。
                    「未绑定工作区」单列成一行，不按比例摊给别的项目。 */}
                <div className="d-grid2">
                  <div className="d-chart">
                    <div className="d-chart-head">
                      <i data-ico="activity" data-size="15" aria-hidden="true" />
                      <span className="d-grow">{t("usage.requestsErrors")}</span>
                      <span className="d-t-xs d-t-faint">{t(RANGE_KEYS[range])}</span>
                    </div>
                    <div className="d-chart-body" key={`req-${replay}`}>
                      <UsageRequestsErrors
                        days={summary.days}
                        label={t("usage.requestsErrors")}
                        requestsLabel={t("usage.requestsLegend")}
                        errorsLabel={t("usage.errorsLegend")}
                      />
                    </div>
                  </div>

                  {projects.length > 0 && (
                    <div className="d-chart">
                      <div className="d-chart-head">
                        <i data-ico="folder-tree" data-size="15" aria-hidden="true" />
                        <span className="d-grow">{t("usage.byProject")}</span>
                      </div>
                      <div className="d-card-body">
                        <table className="d-table">
                          <thead>
                            <tr>
                              <th>{t("usage.byProject")}</th>
                              <th>{t("usage.sessions")}</th>
                              <th>{t("usage.tokens")}</th>
                              <th>{t("usage.cost")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {projects.slice(0, 10).map((project) => (
                              <tr key={project.project || "unbound"}>
                                <td className="d-mono">{project.project ? projectName(project.project) : t("usage.unboundProject")}</td>
                                <td className="d-mono">{formatCount(project.sessions, locale)}</td>
                                <td className="d-mono">{formatCompact(project.tokens, locale)}</td>
                                <td className="d-mono">{formatCost(project.cost, locale)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {projects.length > 10 && (
                          <div className="d-t-xs d-t-faint">{t("usage.moreProjects", { count: projects.length - 10 })}</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {derived.unbound && (
                  <div className="d-banner warn">
                    <i data-ico="triangle-alert" data-size="14" aria-hidden="true" />
                    <span>{t("usage.unboundNote")}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </SettingsPage>
  );
}
