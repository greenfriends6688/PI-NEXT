"use client";

import type { ReactNode } from "react";
import { TEXT } from "@/lib/typography";

/*
 * fork:usage-dashboard — inline SVG charts for the usage panel.
 *
 * Why no chart library: the plan is zero-new-dependency, and these charts are simple
 * enough to own outright (a rect grid, a bar column, a dot row, a share bar). The
 * reference project uses recharts and had to add lazy loading + a local error
 * boundary to work around its Electron/Linux module init crash; hand-written SVG has
 * no such failure mode and contributes ~0 KB.
 *
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
  return <p style={{ margin: 0, fontSize: TEXT.xs, color: "var(--text-dim)" }}>{label}</p>;
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
  const labelWidth = 22;
  const width = labelWidth + columns * (CELL + GAP);
  const height = 14 + 7 * (CELL + GAP);
  const xFor = (column: number): number => labelWidth + column * (CELL + GAP);
  const yFor = (row: number): number => 14 + row * (CELL + GAP);

  // One month label per month, at its first column — but never two labels closer than
  // three columns (each label is ~18px, i.e. wider than one column).
  const monthMarks: { x: number; label: string }[] = [];
  let lastMonth = "";
  let lastMarkColumn = -3;
  for (let column = 0; column < columns; column += 1) {
    const index = Math.max(0, Math.min(days.length - 1, column * 7 - lead));
    const month = days[index].day.slice(0, 7);
    if (month === lastMonth || column - lastMarkColumn < 3) continue;
    monthMarks.push({ x: xFor(column), label: monthLabel(days[index].day) });
    lastMonth = month;
    lastMarkColumn = column;
  }

  const weekdayLabels = [
    { row: 0, text: "一" },
    { row: 2, text: "三" },
    { row: 4, text: "五" },
  ];

  return (
    <div style={{ overflowX: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
      <svg role="img" aria-label={label} viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={{ display: "block" }}>
        {monthMarks.map((mark) => (
          <text key={`${mark.x}-${mark.label}`} x={mark.x} y={9} fill="var(--text-dim)" fontSize={9}>
            {mark.label}
          </text>
        ))}
        {weekdayLabels.map((item) => (
          <text key={item.text} x={0} y={yFor(item.row) + CELL - 1} fill="var(--text-dim)" fontSize={9}>
            {item.text}
          </text>
        ))}
        {days.map((day, index) => {
          const value = metric === "sessions" ? day.sessions : day.tokens;
          const level = levels(value, max);
          const slot = index + lead;
          return (
            <rect
              key={day.day}
              x={xFor(Math.floor(slot / 7))}
              y={yFor(slot % 7)}
              width={CELL}
              height={CELL}
              rx={2.5}
              fill={cellFill(level)}
              fillOpacity={cellOpacity(level)}
            >
              <title>{`${day.day} · ${value}`}</title>
            </rect>
          );
        })}
      </svg>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, fontSize: TEXT["2xs"], color: "var(--text-dim)" }}>
        <span>{lessLabel}</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <span
            key={level}
            aria-hidden="true"
            style={{ width: CELL, height: CELL, borderRadius: "var(--radius-xs)", background: cellFill(level), opacity: cellOpacity(level) }}
          />
        ))}
        <span>{moreLabel}</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * 按天 Token 趋势 — 柱状（参考图的形态；原先是一条折线）。
 * ------------------------------------------------------------------------- */
export function UsageDailyBars({
  days,
  label,
}: {
  days: readonly UsageDayPointLike[];
  label: string;
}): ReactNode {
  if (days.length === 0) return <EmptyChart label="—" />;

  const width = 720;
  const height = 150;
  const pad = { top: 8, right: 6, bottom: 20, left: 44 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const max = Math.max(1, ...days.map((day) => day.tokens));
  const slot = plotWidth / days.length;
  const barWidth = Math.max(2, Math.min(28, slot * 0.66));
  const yFor = (value: number): number => pad.top + plotHeight - (value / max) * plotHeight;

  const tickCount = 4;
  const xLabelEvery = Math.max(1, Math.ceil(days.length / 6));

  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${width} ${height}`} width="100%" height={height} style={{ display: "block" }}>
      {Array.from({ length: tickCount + 1 }, (_, index) => {
        const ratio = index / tickCount;
        const value = max * (1 - ratio);
        const y = pad.top + plotHeight * ratio;
        return (
          <g key={ratio}>
            <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="var(--border-faint)" strokeWidth={1} />
            <text x={pad.left - 5} y={y + 3} textAnchor="end" fill="var(--text-dim)" fontSize={9}>
              {Math.round(value).toLocaleString()}
            </text>
          </g>
        );
      })}
      {days.map((day, index) => {
        const x = pad.left + slot * index + (slot - barWidth) / 2;
        const top = yFor(day.tokens);
        return (
          <rect
            key={day.day}
            x={x}
            y={day.tokens > 0 ? top : pad.top + plotHeight - 1}
            width={barWidth}
            height={Math.max(day.tokens > 0 ? pad.top + plotHeight - top : 1, 1)}
            rx={2}
            fill="var(--accent)"
            fillOpacity={day.tokens > 0 ? 0.85 : 0.25}
          >
            <title>{`${day.day} · ${day.tokens.toLocaleString()}`}</title>
          </rect>
        );
      })}
      {days.map((day, index) => (index % xLabelEvery === 0 || index === days.length - 1 ? (
        <text
          key={`x-${day.day}`}
          x={pad.left + slot * index + slot / 2}
          y={height - 6}
          textAnchor="middle"
          fill="var(--text-dim)"
          fontSize={9}
        >
          {shortDay(day.day)}
        </text>
      ) : null))}
    </svg>
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

  const width = 720;
  const height = 130;
  const pad = { top: 10, right: 10, bottom: 20, left: 40 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const max = Math.max(1, ...days.map((day) => day.messages), ...days.map((day) => day.errors));
  const xFor = (index: number): number => pad.left + (days.length === 1 ? plotWidth / 2 : (index / (days.length - 1)) * plotWidth);
  const yFor = (value: number): number => pad.top + plotHeight - (value / max) * plotHeight;
  const xLabelEvery = Math.max(1, Math.ceil(days.length / 6));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <svg role="img" aria-label={label} viewBox={`0 0 ${width} ${height}`} width="100%" height={height} style={{ display: "block" }}>
        {[0, 0.5, 1].map((ratio) => (
          <g key={ratio}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={pad.top + plotHeight * ratio}
              y2={pad.top + plotHeight * ratio}
              stroke="var(--border-faint)"
              strokeWidth={1}
            />
            <text x={pad.left - 5} y={pad.top + plotHeight * ratio + 3} textAnchor="end" fill="var(--text-dim)" fontSize={9}>
              {Math.round(max * (1 - ratio)).toLocaleString()}
            </text>
          </g>
        ))}
        {days.map((day, index) => (
          <circle key={`r-${day.day}`} cx={xFor(index)} cy={yFor(day.messages)} r={2.6} fill="var(--accent)">
            <title>{`${day.day} · ${requestsLabel} ${day.messages}`}</title>
          </circle>
        ))}
        {days.map((day, index) => (day.errors > 0 ? (
          <circle key={`e-${day.day}`} cx={xFor(index)} cy={yFor(day.errors)} r={2.6} fill="var(--danger)">
            <title>{`${day.day} · ${errorsLabel} ${day.errors}`}</title>
          </circle>
        ) : null))}
        {days.map((day, index) => (index % xLabelEvery === 0 || index === days.length - 1 ? (
          <text key={`x-${day.day}`} x={xFor(index)} y={height - 6} textAnchor="middle" fill="var(--text-dim)" fontSize={9}>
            {shortDay(day.day)}
          </text>
        ) : null))}
      </svg>
      <div style={{ display: "flex", gap: 14, fontSize: TEXT["2xs"], color: "var(--text-dim)" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "var(--radius-sm)", background: "var(--accent)" }} />
          {requestsLabel}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "var(--radius-sm)", background: "var(--danger)" }} />
          {errorsLabel}
        </span>
      </div>
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
  return (
    <div
      role="img"
      aria-label={label}
      style={{ display: "flex", width: "100%", height: 10, borderRadius: "var(--radius-sm)", overflow: "hidden", background: "var(--bg-hover)" }}
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
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        minWidth: 0,
        padding: "8px 10px",
        border: "1px solid var(--border-faint)",
        borderRadius: "var(--radius-md)",
        background: "var(--bg-panel)",
      }}
    >
      {accent && (
        <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "var(--radius-sm)", background: "var(--accent)", flexShrink: 0 }} />
      )}
      <span style={{ display: "grid", gap: 2, minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: TEXT.sm, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={title}>
          {title}
        </span>
        <span style={{ fontSize: TEXT["2xs"], color: "var(--text-dim)", fontVariantNumeric: "tabular-nums", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {meta}
        </span>
      </span>
      <span style={{ flexShrink: 0, fontSize: TEXT.xs, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{trailing}</span>
    </div>
  );
}
