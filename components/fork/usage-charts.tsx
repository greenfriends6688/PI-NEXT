"use client";

import type { ReactNode } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";

/*
 * fork:usage-dashboard — the usage panel's charts, drawn with the design board's
 * `.d-bars` / `.d-row` / `.d-col` primitives (画板 D-19 §用量统计) rather than
 * hand-written inline SVG.
 *
 * Why no chart library: the plan is zero-new-dependency, and these charts are simple
 * enough to own outright (a cell grid, two bar columns, a share bar). The reference
 * project uses recharts and had to add lazy loading + a local error boundary to work
 * around its Electron/Linux module init crash; a grid of design-system elements has no
 * such failure mode and contributes ~0 KB.
 *
 * The numbers are unchanged: same max-normalised scale, same 5-step `levels()`,
 * same per-bar `title`, same `role="img"` + `aria-label`. Only the drawing changed.
 * All colours come from CSS variables so light/dark/auto keep working.
 */

export interface UsageDayPointLike {
  day: string;
  sessions: number;
  messages: number;
  tokens: number;
  cost: number;
  errors: number;
}

function dayMs(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year, (month ?? 1) - 1, date ?? 1);
}

/** Monday-first weekday index (0 = 一), which is what the grid labels are. */
function mondayIndex(day: string): number {
  return (new Date(dayMs(day)).getUTCDay() + 6) % 7;
}

function monthLabel(day: string): string {
  const [, month] = day.split("-").map(Number);
  return `${month ?? 1}月`;
}

function shortDay(day: string): string {
  return day.slice(5);
}

const CELL = 11;
const GAP = 2;
/** Left gutter for the weekday marks — board 45 puts them outside the cell grid. */
const GUTTER = 16;

/** Shared 5-step scale: level 0 is "nothing happened", 1-4 are quartiles of the max. */
function levels(value: number, max: number): number {
  if (value <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((value / max) * 4)));
}

function cellClass(level: number): string {
  return level === 0 ? "d-heat-grid" : `d-heat-grid l${level}`;
}

/*
 * fork:v5-landing Wave B · M-09 帧 C · PWA 热力图。
 *
 * `.m-heat` 的库规则是 `grid-template-columns: repeat(18, 1fr)` —— **18 列 × 7 行**，
 * 所以顺序必须按「行 = 星期、列 = 周」发：先发 18 个周一，再发 18 个周二……
 * 那块图旁的「周一在上 · 周日在下」说的就是这件事。画板里那串 `<i>` 只是示意。
 *
 * 分级：库只有 `.m-heat-grid.l1 / l2 / l3`（+ 无类 = 空），比桌面的五档少一档。
 * 桌面 `levels()` 的 0-4 映射成 0 / l1 / l2 / l2 / l3（顶部两档合并），
 * **量纲与 max 归一完全不变**，只是颜色再分一档。缺的那一档记在 Wave B 汇报里
 * （`.m-heat-grid.l4` 缺件，不许在产品里自造）。
 */
const MOBILE_HEAT_COLUMNS = 18;
const MOBILE_HEAT_ROWS = 7;
function mobileCellClass(level: number): string {
  if (level <= 0) return "m-heat-grid";
  return `m-heat-grid l${Math.min(3, level)}`;
}

function PwaHeatmap({
  days,
  metric,
  label,
  metricLabel,
  lessLabel,
  moreLabel,
}: {
  days: readonly UsageDayPointLike[];
  metric: "sessions" | "tokens";
  label: string;
  /** 图旁那行口径（“按会话数 / 按 token”），由面板传进来。 */
  metricLabel: string;
  lessLabel: string;
  moreLabel: string;
}): ReactNode {
  const values = days.map((day) => (metric === "sessions" ? day.sessions : day.tokens));
  const max = Math.max(1, ...values);
  // 取最后 18 周（126 天），多出来的旧数据在手机上没有位置 —— 口径写在图旁。
  const lead = mondayIndex(days[0].day);
  const window = days.slice(Math.max(0, days.length - MOBILE_HEAT_COLUMNS * MOBILE_HEAT_ROWS));
  const windowLead = lead + (days.length - window.length);
  const cells: ReactNode[] = [];
  for (let row = 0; row < MOBILE_HEAT_ROWS; row += 1) {
    for (let column = 0; column < MOBILE_HEAT_COLUMNS; column += 1) {
      const index = column * MOBILE_HEAT_ROWS + row - windowLead;
      const day = index >= 0 && index < window.length ? window[index] : null;
      const value = day ? (metric === "sessions" ? day.sessions : day.tokens) : 0;
      cells.push(
        <i
          key={`${row}-${column}`}
          title={day ? `${day.day} · ${value}` : undefined}
          className={day ? mobileCellClass(levels(value, max)) : "m-heat-grid"}
        />,
      );
    }
  }
  return (
    <div className="m-setrow">
      <span className="m-setrow-body">
        <span className="m-setrow-t">{label}</span>
        <span className="m-setrow-s">{metricLabel}</span>
        <span className="m-heat" role="img" aria-label={label}>{cells}</span>
        <span className="m-hist-row">
          <span className="m-badge mute">{lessLabel}</span>
          {[1, 2, 3].map((level) => (
            <i key={level} aria-hidden="true" className={`m-heat-grid l${level}`} />
          ))}
          <span className="m-grow" />
          <span className="m-t-xs m-t-faint">{moreLabel}</span>
        </span>
      </span>
    </div>
  );
}

function EmptyChart({ label }: { label: string }): ReactNode {
  return <p className="d-t-xs d-t-faint">{label}</p>;
}

/* ---------------------------------------------------------------------------
 * 活跃热力图 — GitHub 的年度网格：周一在上、月份横排、右下角「较少 → 较多」。
 * ------------------------------------------------------------------------- */
export function UsageHeatmap({
  days,
  metric,
  label,
  metricLabel,
  lessLabel,
  moreLabel,
}: {
  days: readonly UsageDayPointLike[];
  metric: "sessions" | "tokens";
  label: string;
  /** fork:v5-landing Wave B：手机端图旁那行口径。省略即不渲染该行。 */
  metricLabel?: string;
  lessLabel: string;
  moreLabel: string;
}): ReactNode {
  const mobile = useIsMobile();
  if (days.length === 0) return <EmptyChart label="—" />;
  if (mobile) {
    return (
      <PwaHeatmap
        days={days}
        metric={metric}
        label={label}
        metricLabel={metricLabel ?? lessLabel}
        lessLabel={lessLabel}
        moreLabel={moreLabel}
      />
    );
  }

  const values = days.map((day) => (metric === "sessions" ? day.sessions : day.tokens));
  const max = Math.max(1, ...values);
  const lead = mondayIndex(days[0].day);
  const columns = Math.ceil((days.length + lead) / 7);
  // Same geometry the SVG used, now as a grid: one fixed 11px track per week, one row
  // per weekday (Monday on top), plus a fixed left gutter for the weekday marks.
  // 轨道写死而不是 `1fr`：卡片有整栏宽，弹性列会把 11px 的方格拉成扁条。
  const tracks = `${GUTTER}px repeat(${columns}, ${CELL}px)`;

  // One month label per month, at its first column — but never two labels closer than
  // three columns (each label is ~18px, i.e. wider than one column).
  const monthMarks: { column: number; label: string }[] = [];
  let lastMonth = "";
  let lastMarkColumn = -3;
  for (let column = 0; column < columns; column += 1) {
    const index = Math.max(0, Math.min(days.length - 1, column * 7 - lead));
    const month = days[index].day.slice(0, 7);
    if (month === lastMonth || column - lastMarkColumn < 3) continue;
    monthMarks.push({ column, label: monthLabel(days[index].day) });
    lastMonth = month;
    lastMarkColumn = column;
  }

  const weekdayLabels = [
    { row: 0, text: "一" },
    { row: 2, text: "三" },
    { row: 4, text: "五" },
  ];

  return (
    <>
      <div
        role="img"
        aria-label={label}
        style={{ overflowX: "auto", marginTop: "var(--nx-sp-2)" }}
      >
        {/* 月份横排：与下面那张格子网格共用同一套列轨，所以天然对齐。 */}
        <div style={{ display: "grid", gridTemplateColumns: tracks, gap: `${GAP}px` }}>
          {monthMarks.map((mark) => (
            <span
              key={`${mark.column}-${mark.label}`}
              className="d-mono d-t-faint"
              style={{ gridColumn: mark.column + 2, gridRow: 1, whiteSpace: "nowrap" }}
            >
              {mark.label}
            </span>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: tracks, gap: `${GAP}px`, marginTop: `${GAP}px` }}>
          {/* 星期标签要占满 7 行：只落在第 1 行的话，它那 7 个 11px 会把第 1 行撑到 89px，
              整张网格就散了。 */}
          <div style={{ display: "grid", gridTemplateRows: `repeat(7, ${CELL}px)`, gap: `${GAP}px`, gridRow: "1 / span 7", alignSelf: "start" }}>
            {weekdayLabels.map((item) => (
              <span
                key={item.text}
                className="d-mono d-t-faint"
                style={{ gridRow: item.row + 1, alignSelf: "center" }}
              >
                {item.text}
              </span>
            ))}
          </div>
          {days.map((day, index) => {
            const value = metric === "sessions" ? day.sessions : day.tokens;
            const level = levels(value, max);
            const slot = index + lead;
            return (
              <span
                key={day.day}
                title={`${day.day} · ${value}`}
                className={`${cellClass(level)} d-cell-pop`}
                style={{
                  gridColumn: Math.floor(slot / 7) + 2,
                  gridRow: (slot % 7) + 1,
                  height: `${CELL}px`,
                  animationDelay: `${Math.min(index * 3, 380)}ms`,
                }}
              />
            );
          })}
        </div>
      </div>
      {/* 少 → 多 图例（画板 45 §每日活动 的那一行）。 */}
      <div className="d-row" style={{ marginTop: "var(--nx-sp-2)", justifyContent: "flex-end" }}>
        <span className="d-mono d-t-faint">{lessLabel}</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <span
            key={level}
            aria-hidden="true"
            className={cellClass(level)}
            style={{ width: `${CELL}px`, height: `${CELL}px` }}
          />
        ))}
        <span className="d-mono d-t-faint">{moreLabel}</span>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------------------
 * 按天 Token 趋势 — 柱状（参考图的形态；原先是一条折线）。
 * ------------------------------------------------------------------------- */
/** Bar height as a percentage of the plot, floored at `.d-bars i { min-height: 4px }`. */
function barHeight(value: number, max: number): string {
  if (value <= 0) return "2%";
  return `${Math.max(2, Math.round((value / max) * 100))}%`;
}

/** The sampled x-axis under a bar row: every `xLabelEvery`-th day plus the last one. */
function DayAxis({ days }: { days: readonly UsageDayPointLike[] }): ReactNode {
  const xLabelEvery = Math.max(1, Math.ceil(days.length / 6));
  return (
    <div
      style={{
        // `minmax(0, 1fr)`：默认的 `1fr` 下限是 `auto`，标签一旦 nowrap，
        // 53 个轨道全被撑到标签宽，整条轴就挤在卡片左侧。
        display: "grid",
        gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
        gap: 3,
        justifyItems: "center",
        marginTop: "var(--nx-sp-1)",
      }}
    >
      {days.map((day, index) => (
        <span key={`x-${day.day}`} className="d-mono d-t-faint" style={{ whiteSpace: "nowrap" }}>
          {index % xLabelEvery === 0 || index === days.length - 1 ? shortDay(day.day) : null}
        </span>
      ))}
    </div>
  );
}

export function UsageDailyBars({
  days,
  label,
}: {
  days: readonly UsageDayPointLike[];
  label: string;
}): ReactNode {
  const mobile = useIsMobile();
  if (days.length === 0) return <EmptyChart label="—" />;

  const max = Math.max(1, ...days.map((day) => day.tokens));
  // fork:v5-landing Wave B · M-09 帧 C：`.m-bars` + `.m-hist-row` 的星期标。
  const mobileAxis = (source: readonly UsageDayPointLike[]) => {
    const every = Math.max(1, Math.ceil(source.length / 7));
    return (
      <span className="m-hist-row">
        {source.map((day, index) => (
          <span
            key={`x-${day.day}`}
            className={index === source.length - 1 ? "m-t-xs m-t-b" : "m-t-xs m-t-faint"}
          >
            {index % every === 0 || index === source.length - 1 ? mondayIndex(day.day) + 1 : null}
          </span>
        ))}
      </span>
    );
  };

  if (mobile) {
    return (
      <div className="m-setrow">
        <span className="m-setrow-body">
          <span className="m-setrow-t">{label}</span>
          <span className="m-bars" role="img" aria-label={label}>
            {days.map((day) => (
              <i key={day.day} title={`${day.day} · ${day.tokens.toLocaleString()}`} style={{ height: barHeight(day.tokens, max) }} />
            ))}
          </span>
          {mobileAxis(days)}
        </span>
      </div>
    );
  }

  return (
    <div role="img" aria-label={label} style={{ marginTop: "var(--nx-sp-2)" }}>
      {/* 画板 D-19 帧 C：柱条自基线长起，逐根错峰（.d-bars + .d-bar-rise）。 */}
      <div className="d-bars" style={{ height: 64 }}>
        {days.map((day, index) => (
          <i
            key={day.day}
            className="d-bar-rise"
            title={`${day.day} · ${day.tokens.toLocaleString()}`}
            style={{ height: barHeight(day.tokens, max), animationDelay: `${Math.min(index * 20, 560)}ms` }}
          />
        ))}
      </div>
      <DayAxis days={days} />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * 请求与错误 — 每天两根柱（上排请求、下排失败的工具调用）。
 * ------------------------------------------------------------------------- */
export function UsageRequestsErrors({
  days,
  label,
  requestsLabel,
  errorsLabel,
}: {
  days: readonly UsageDayPointLike[];
  label: string;
  requestsLabel: string;
  errorsLabel: string;
}): ReactNode {
  const mobile = useIsMobile();
  if (days.length === 0) return <EmptyChart label="—" />;

  // 两条序列共用同一个 max（请求与失败都按它归一），所以两行的高度可直接对比。
  const max = Math.max(1, ...days.map((day) => day.messages), ...days.map((day) => day.errors));

  // fork:v5-landing Wave B · M-09 帧 C：手机上仍然是两条 `.m-bars`，
  // 只是改成一列里的上下两行（图例在图上方），口径不变。
  if (mobile) {
    return (
      <div className="m-setrow">
        <span className="m-setrow-body">
          <span className="m-setrow-t">{label}</span>
          <span className="m-row-m">
            <span className="m-dot run" />
            <span>{requestsLabel}</span>
            <span className="m-dot" />
            <span>{errorsLabel}</span>
          </span>
          <span className="m-bars" role="img" aria-label={requestsLabel}>
            {days.map((day) => (
              <i key={`r-${day.day}`} title={`${day.day} · ${requestsLabel} ${day.messages}`} style={{ height: barHeight(day.messages, max) }} />
            ))}
          </span>
          <span className="m-bars" role="img" aria-label={errorsLabel}>
            {days.map((day) => (
              <i
                key={`e-${day.day}`}
                title={day.errors > 0 ? `${day.day} · ${errorsLabel} ${day.errors}` : undefined}
                style={{ height: barHeight(day.errors, max), background: "var(--nx-surface-hi)" }}
              />
            ))}
          </span>
        </span>
      </div>
    );
  }

  return (
    <div role="img" aria-label={label} style={{ marginTop: "var(--nx-sp-2)" }}>
      {/* 画板 D-19 帧 C：图例只两种色 —— accent（主序列）与次要灰。 */}
      <div className="d-row d-t-xs" style={{ gap: "var(--nx-sp-3)" }}>
        <span className="d-row" style={{ gap: "var(--nx-sp-1)" }}>
          <span className="d-dot" style={{ background: "var(--nx-accent)" }} />
          {requestsLabel}
        </span>
        <span className="d-row" style={{ gap: "var(--nx-sp-1)" }}>
          <span className="d-dot" style={{ background: "var(--nx-surface-hi)" }} />
          {errorsLabel}
        </span>
      </div>
      {/* 上排 = 请求，下排 = 失败的工具调用；画布高度照画板 45 §请求与错误。 */}
      <div className="d-bars" style={{ height: "56px", marginTop: "var(--nx-sp-2)" }}>
        {days.map((day, index) => (
          <i
            key={`r-${day.day}`}
            className="d-bar-rise"
            title={`${day.day} · ${requestsLabel} ${day.messages}`}
            style={{ height: barHeight(day.messages, max), animationDelay: `${Math.min(index * 20, 560)}ms` }}
          />
        ))}
      </div>
      <div className="d-bars" style={{ height: "56px" }}>
        {days.map((day, index) => (
          <i
            key={`e-${day.day}`}
            className="d-bar-rise"
            title={day.errors > 0 ? `${day.day} · ${errorsLabel} ${day.errors}` : undefined}
            style={{ height: barHeight(day.errors, max), background: "var(--nx-surface-hi)", animationDelay: `${Math.min(index * 20, 560)}ms` }}
          />
        ))}
      </div>
      <DayAxis days={days} />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * 占比条 — 「按模型」顶部的单条堆叠（参考图的「按智能体」形态）。
 * ------------------------------------------------------------------------- */
export interface UsageShareSlice {
  key: string;
  tokens: number;
  share: number;
}

export function UsageShareBar({ slices, label }: { slices: readonly UsageShareSlice[]; label: string }): ReactNode {
  const mobile = useIsMobile();
  const visible = slices.filter((slice) => slice.share > 0);
  if (visible.length === 0) return null;
  if (mobile) {
    // fork:v5-landing Wave B · M-09 帧 C：占比条在手机上是模型行上方那一根
    // `.m-hist-row` 分段条（同一份数据，同一个 max 归一）。
    return (
      <div
        className="m-hist-row"
        role="img"
        aria-label={label}
        style={{ marginTop: "var(--nx-sp-2)" }}
      >
        {visible.map((slice, index) => (
          <span
            key={slice.key}
            title={`${slice.key} · ${(slice.share * 100).toFixed(1)}%`}
            style={{
              width: `${Math.max(slice.share * 100, 0.5)}%`,
              background: "var(--nx-accent)",
              opacity: Math.max(0.3, 1 - index * 0.18),
            }}
          />
        ))}
      </div>
    );
  }
  return (
    <div
      role="img"
      aria-label={label}
      style={{ display: "flex", gap: 0, width: "100%", height: "var(--nx-sp-2)", marginTop: "var(--nx-sp-2)", borderRadius: "var(--nx-r-xs)", overflow: "hidden", background: "var(--nx-surface-hi)" }}
    >
      {visible.map((slice, index) => (
        <span
          key={slice.key}
          title={`${slice.key} · ${(slice.share * 100).toFixed(1)}%`}
          style={{
            width: `${Math.max(slice.share * 100, 0.5)}%`,
            background: "var(--nx-accent)",
            opacity: Math.max(0.3, 1 - index * 0.18),
          }}
        />
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * 列表行 — 「按模型」「按项目」共用（名字 + 次要行 + 右侧数字）。
 * ------------------------------------------------------------------------- */
export function UsageListRow({
  title,
  meta,
  trailing,
  accent,
}: {
  title: string;
  meta: string;
  trailing: string;
  accent?: boolean;
}): ReactNode {
  const mobile = useIsMobile();
  // fork:v5-landing Wave B · M-09 帧 C：手机上的模型 / 项目行 = `.m-setrow`
  // （图标 + 名字 + 口径副行 + 右侧数字），名字可长可短，不再挤成一行。
  if (mobile) {
    return (
      <div className="m-setrow">
        <i data-ico={accent ? "chart-pie" : "folder"} data-size="16" aria-hidden="true" />
        <span className="m-setrow-body">
          <span className="m-setrow-t m-mono" title={title}>{title}</span>
          <span className="m-setrow-s">{meta}</span>
        </span>
        <span className="m-t-b">{trailing}</span>
      </div>
    );
  }
  return (
    <div className="d-row d-t-xs" style={{ padding: "3px 0" }}>
      {accent && <i data-ico="chart-pie" data-size="14" aria-hidden="true" />}
      <span className="d-grow d-mono" title={title}>{title}</span>
      <span className="d-t-dim">{meta}</span>
      <span className="d-t-faint">{trailing}</span>
    </div>
  );
}
