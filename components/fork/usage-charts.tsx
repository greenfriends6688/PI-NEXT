"use client";

import type { ReactNode } from "react";

/*
 * fork:usage-dashboard — the usage panel's charts, drawn with the design board's
 * `.pw-bars` / `.pw-legend` / `.pw-list` primitives (画板 45 §用量统计) rather than
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

function cellOpacity(level: number): number {
  return level === 0 ? 1 : 0.18 + level * 0.2;
}

function cellFill(level: number): string {
  return level === 0 ? "var(--bg-hover)" : "var(--accent)";
}

function EmptyChart({ label }: { label: string }): ReactNode {
  // `.pw-cell > p` already carries the muted meta styling — no inline type here.
  return <p className="pw-muted">{label}</p>;
}

/* ---------------------------------------------------------------------------
 * 活跃热力图 — GitHub 的年度网格：周一在上、月份横排、右下角「较少 → 较多」。
 * ------------------------------------------------------------------------- */
export function UsageHeatmap({
  days,
  metric,
  label,
  lessLabel,
  moreLabel,
}: {
  days: readonly UsageDayPointLike[];
  metric: "sessions" | "tokens";
  label: string;
  lessLabel: string;
  moreLabel: string;
}): ReactNode {
  if (days.length === 0) return <EmptyChart label="—" />;

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
        style={{ overflowX: "auto", marginTop: "var(--s2)" }}
      >
        {/* 月份横排：与下面那张格子网格共用同一套列轨，所以天然对齐。 */}
        <div style={{ display: "grid", gridTemplateColumns: tracks, gap: `${GAP}px` }}>
          {monthMarks.map((mark) => (
            <span
              key={`${mark.column}-${mark.label}`}
              className="pw-mono pw-dim"
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
                className="pw-mono pw-dim"
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
                style={{
                  gridColumn: Math.floor(slot / 7) + 2,
                  gridRow: (slot % 7) + 1,
                  height: `${CELL}px`,
                  borderRadius: "2px",
                  background: cellFill(level),
                  opacity: cellOpacity(level),
                }}
              />
            );
          })}
        </div>
      </div>
      {/* 少 → 多 图例（画板 45 §每日活动 的那一行）。 */}
      <div className="pw-inline" style={{ marginTop: "var(--s2)", justifyContent: "flex-end" }}>
        <span className="pw-mono pw-dim">{lessLabel}</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <span
            key={level}
            aria-hidden="true"
            style={{ width: `${CELL}px`, height: `${CELL}px`, borderRadius: "2px", background: cellFill(level), opacity: cellOpacity(level) }}
          />
        ))}
        <span className="pw-mono pw-dim">{moreLabel}</span>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------------------
 * 按天 Token 趋势 — 柱状（参考图的形态；原先是一条折线）。
 * ------------------------------------------------------------------------- */
/** Bar height as a percentage of the plot, floored at `.pw-bars i { min-height: 2px }`. */
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
        marginTop: "var(--s1)",
      }}
    >
      {days.map((day, index) => (
        <span key={`x-${day.day}`} className="pw-mono pw-dim" style={{ whiteSpace: "nowrap" }}>
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
  if (days.length === 0) return <EmptyChart label="—" />;

  const max = Math.max(1, ...days.map((day) => day.tokens));

  return (
    <div role="img" aria-label={label} style={{ marginTop: "var(--s2)" }}>
      {/* `.pw-bars` 自带 64px 的画布高度（画板 45 §每日 Token 趋势 就是默认高度）。 */}
      <div className="pw-bars">
        {days.map((day) => (
          <i
            key={day.day}
            className={day.tokens >= max ? "hot" : undefined}
            title={`${day.day} · ${day.tokens.toLocaleString()}`}
            style={{ height: barHeight(day.tokens, max) }}
          />
        ))}
      </div>
      <DayAxis days={days} />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * 请求与错误 — 每天一个蓝点（请求）和一个红点（失败的工具调用）。
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
  if (days.length === 0) return <EmptyChart label="—" />;

  // 两条序列共用同一个 max（请求与失败都按它归一），所以两行的高度可直接对比。
  const max = Math.max(1, ...days.map((day) => day.messages), ...days.map((day) => day.errors));

  return (
    <div role="img" aria-label={label} style={{ marginTop: "var(--s2)" }}>
      <div className="pw-legend">
        <div className="li">
          <span className="sw" style={{ background: "var(--accent)" }} />
          <span className="grow">{requestsLabel}</span>
        </div>
        <div className="li">
          <span className="sw" style={{ background: "var(--error)" }} />
          <span className="grow">{errorsLabel}</span>
        </div>
      </div>
      {/* 上排 = 请求，下排 = 失败的工具调用；画布高度照画板 45 §请求与错误。 */}
      <div className="pw-bars" style={{ height: "56px", marginTop: "var(--s2)" }}>
        {days.map((day) => (
          <i
            key={`r-${day.day}`}
            className={day.messages >= max ? "hot" : undefined}
            title={`${day.day} · ${requestsLabel} ${day.messages}`}
            style={{ height: barHeight(day.messages, max) }}
          />
        ))}
      </div>
      <div className="pw-bars" style={{ height: "56px" }}>
        {days.map((day) => (
          <i
            key={`e-${day.day}`}
            title={day.errors > 0 ? `${day.day} · ${errorsLabel} ${day.errors}` : undefined}
            style={{ height: barHeight(day.errors, max), background: "var(--error)" }}
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
  const visible = slices.filter((slice) => slice.share > 0);
  if (visible.length === 0) return null;
  // 画板 45 §按项目 列表里那根「轨道 + 填充」进度条：轨道 `--n-surface` 起步，
  // 段与段之间不留缝。
  return (
    <div
      role="img"
      aria-label={label}
      style={{ display: "flex", gap: 0, width: "100%", height: "var(--s2)", marginTop: "var(--s2)", borderRadius: "var(--radius-sm)", overflow: "hidden", background: "var(--bg-hover)" }}
    >
      {visible.map((slice, index) => (
        <span
          key={slice.key}
          title={`${slice.key} · ${(slice.share * 100).toFixed(1)}%`}
          style={{
            width: `${Math.max(slice.share * 100, 0.5)}%`,
            background: "var(--accent)",
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
  return (
    <div className="pw-litem">
      {accent && (
        <span className="pw-ico"><i data-ico="chart-pie" data-size="14" /></span>
      )}
      <span className="grow">
        <span className="pw-lname" title={title}>{title}</span>
        <span className="pw-lsub pw-mono">{meta}</span>
      </span>
      <span className="pw-mono">{trailing}</span>
    </div>
  );
}
