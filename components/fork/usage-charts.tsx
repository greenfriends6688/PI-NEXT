"use client";

import { Fragment, type ReactNode } from "react";
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

/** 图例里那几颗样例格的边长（`.d-heat-grid` 自带 aspect-ratio，脱离栅格后要显式给宽高）。 */
const CELL = 11;

/*
 * fork:v5-landing Wave N1 · D-19 帧 B —— `.d-heat` 的库规则是
 * `grid-template-columns: repeat(26, 1fr)`：**一行 26 天**，364 天折成 14 行，
 * 最旧的一行在上（画板帧标签原话：「每格 1 天 · 最旧的一行在上」）。
 * 之前这张图是 GitHub 式「一列一周」的自绘网格（轨道写死 11px、内联 gridColumn），
 * 于是 `.d-heat` 与「每格一天」这条口径一直没进产品；现在整张图按画板原样发。
 */
const HEAT_ROWS = 7;

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
 * 分级：库的 `.m-heat-grid` 是 l1 / l2 / l3 / l4 四档（无类 = 空），
 * 与桌面五档（0-4）**一一对应**：level 0 → 无类，1..4 → `l1..l4`。
 * fork:v5-landing-close —— 此前库里只有三档，这里把 4 压到 `l3`（顶部两档同色）；
 * 设计侧补上 `.m-heat-grid.l4` 后改回 `Math.min(4, level)` 即可，量纲不变。
 */
const MOBILE_HEAT_COLUMNS = 18;
const MOBILE_HEAT_ROWS = 7;
function mobileCellClass(level: number): string {
  if (level <= 0) return "m-heat-grid";
  return `m-heat-grid l${Math.min(4, level)}`;
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
          {[1, 2, 3, 4].map((level) => (
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

  // fork:usage-heat-year（2026-10-07 用户实拍「别显示这么大，照 ZCode 那种」）——
  // 此前是 26 列 × 14 行（`index % 26`）：格子宽跟着设置弹窗的宽度 1fr 放大（1440
  // 视口实测 27px，用户宽窗口下 42px，比图例那枚 11px 的色块大四倍），而且月份标签
  // 按 `index % 26` 定位 —— 26 天一行、一个月约 30 天，标签自然落到随机列上（实拍
  // 读到「10月 6月 2月 7月 1月 8月…」）。改成 GitHub / ZCode 那一档的周历：
  // **列 = 周、行 = 星期**（`lead` = 首日是星期几）。同一块宽度下格子小一半，
  // 月份标签也落在真实列上。列数由数据算出来（一年最多 53 周），`.d-heat` 的
  // `repeat(53, …)` 给的是轨道上限。
  const lead = mondayIndex(days[0].day);
  const weekCount = Math.ceil((days.length + lead) / HEAT_ROWS);

  // 月份横排：横跨若干列的一段标签（起点 = 该月第一天所在的**周列**），
  // 与下面那张格子网格共用同一套列轨，所以天然对齐。
  const monthMarks: { start: number; span: number; label: string }[] = [];
  let lastMonth = "";
  for (let index = 0; index < days.length; index += 1) {
    const month = days[index].day.slice(0, 7);
    if (month === lastMonth) continue;
    monthMarks.push({
      start: Math.floor((index + lead) / HEAT_ROWS) + 1,
      span: 1,
      label: monthLabel(days[index].day),
    });
    lastMonth = month;
  }
  // 每一段一直伸到下一段开始（或行尾）。
  monthMarks.forEach((mark, order) => {
    const next = monthMarks[order + 1];
    mark.span = next ? Math.max(1, next.start - mark.start) : Math.max(1, weekCount - mark.start + 1);
  });

  return (
    <>
      {/* 画板 D-19 帧 B：`.d-heat` 网格 → 每格一个 `.d-heat-grid`（五档分级）
          + `.d-cell-pop` 逐格错峰入场；月份标签是这张栅格的第一行。 */}
      <div className="d-heat" role="img" aria-label={label}>
        {monthMarks.map((mark) => (
          <span
            key={`${mark.start}-${mark.label}`}
            className="d-mono d-t-faint"
            style={{ gridColumn: `${mark.start} / span ${mark.span}`, gridRow: 1, whiteSpace: "nowrap" }}
          >
            {mark.label}
          </span>
        ))}
        {days.map((day, index) => {
          const value = metric === "sessions" ? day.sessions : day.tokens;
          const level = levels(value, max);
          return (
            <div
              key={day.day}
              title={`${day.day} · ${value}`}
              className={`${cellClass(level)} d-cell-pop`}
              style={{
                gridColumn: Math.floor((index + lead) / HEAT_ROWS) + 1,
                gridRow: ((index + lead) % HEAT_ROWS) + 2,
                animationDelay: `${Math.min(index * 3, 380)}ms`,
              }}
            />
          );
        })}
      </div>
      {/* 少 → 多 图例（画板帧 B §年度活跃热力图 的那一行）。 */}
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
      {/* 画板帧 B 的图注（`.d-heat-t`）：这一格按哪个口径着色、一共多少天。 */}
      <div className="d-heat-t">{`${metricLabel ?? label} · ${days.length}`}</div>
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
  const marks = days
    .map((day, index) => ({ day, index }))
    .filter(({ index }) => index % xLabelEvery === 0 || index === days.length - 1);
  // 画板 D-19 帧 C：x 轴是图下方那一行 `.d-row`，标记之间靠 `.d-grow` 撑开。
  return (
    <div className="d-row d-t-xs d-t-faint" style={{ marginTop: "var(--nx-sp-1)" }}>
      {marks.map(({ day }, order) => (
        <Fragment key={`x-${day.day}`}>
          {order > 0 && <span className="d-grow" aria-hidden="true" />}
          <span className="d-mono" style={{ whiteSpace: "nowrap" }}>{shortDay(day.day)}</span>
        </Fragment>
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

/** 紧凑 token 计数（1.2M / 3.4K），与面板里那张卡的读数同一种量纲。 */
function compactTokens(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

export function UsageShareBar({ slices, label }: { slices: readonly UsageShareSlice[]; label: string }): ReactNode {
  const mobile = useIsMobile();
  const visible = slices.filter((slice) => slice.share > 0);
  if (visible.length === 0) return null;
  if (mobile) {
    /*
     * fork:v5-landing Wave N1 · M-09 帧 D「各供应商占比」——
     * 手机上的占比不是一个手绘的分段条，而是**一行一个 `.m-setrow-body`**：
     * 名字 → `.m-bar`（条）→ 一行口径（token · 费用 · 百分比）。
     * 之前这里是 `div.m-hist-row` + 内联背景/不透明度堆出来的分段条：那是产品自绘的
     * 第二套条形，既不在画板里，也不随深色模式走。同一份数据、同一个 max 归一。
     */
    return (
      <div role="img" aria-label={label}>
        {visible.map((slice) => (
          <div
            className="m-setrow-body"
            key={slice.key}
            title={`${slice.key} · ${(slice.share * 100).toFixed(1)}%`}
          >
            <span className="m-setrow-t m-mono">{slice.key}</span>
            <span className="m-bar" style={{ margin: "var(--nx-sp-1) 0" }}>
              <i style={{ width: `${Math.max(slice.share * 100, 0.5)}%` }} />
            </span>
            <span className="m-setrow-s">
              {`${compactTokens(slice.tokens)} · ${(slice.share * 100).toFixed(1)}%`}
            </span>
          </div>
        ))}
      </div>
    );
  }
  return (
    /* fork:v5-boards D-27 帧 E / D-28 帧 D —— `.d-chart-reveal`：图表第一次出现时
       自左揭开（clip-path inset 1800ms）。本仓的用量图里柱条走 `.d-bar-rise`、热力
       格走 `.d-cell-pop`，只有这条占比条此前没有任何入场；它是真实数据图（模型/工具
       占比），所以揭开落在它身上 —— 不另画一条折线演示类（DSN-07 禁手写 SVG 图）。 */
    <div
      role="img"
      aria-label={label}
      className="d-chart-reveal"
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
