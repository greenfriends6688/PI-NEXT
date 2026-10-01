// fork:quota-chip —— 供应商配额芯片的**纯逻辑**（渲染在 components/ProviderQuotaChip.tsx）。
/**
 * `app/api/provider-usage/query` 已经能问出各家供应商的额度（与上游逐字一致），
 * 但那份数据只出现在设置页的模型详情里 —— 写代码的时候看不到。
 * 本模块把一份 `UsageReport` 压成输入框工具条上一枚芯片能显示的两件事：
 *
 *   1. **一行数字**：最紧的那个窗口的「还剩多少」（百分比优先，没有百分比就取余额）；
 *   2. **一串明细**（进 `title` / `aria-label`）：所有窗口与指标，一行一条。
 *
 * 选「最紧的窗口」而不是第一个窗口：Codex 同时报 5 小时窗与周窗，
 * 用户关心的是哪一个快见底。百分比口径下 `remaining` 越小越危险。
 *
 * 这一层不碰网络也不碰 React，所以芯片的判断可以单测（见 provider-usage-quota.test.mjs）。
 */
import type { UsageBucket, UsageMetric, UsageReport } from "./provider-usage";

/** 缓存与刷新节奏：芯片常驻输入框，不能每次会话打开都打一次供应商的额度接口。 */
export const QUOTA_CACHE_TTL_MS = 5 * 60_000;

export interface QuotaChipSummary {
  /** 芯片上那一行数字（`82%` / `$12.34`）。 */
  text: string;
  /** `.pw-badge` 的语气档：`ok` 宽裕 / `warn` 偏紧 / `bad` 快见底 / `count` 中性读数。 */
  tone: "ok" | "warn" | "bad" | "count";
  /** title / aria-label：所有窗口与指标，一行一条。 */
  detail: string;
  capturedAt: number;
}

/** 余额的显示上限：芯片只有一枚徽章的宽度，四位以上的数字会被截断成看不懂的东西。 */
function formatAmount(value: number | undefined): string {
  if (value === undefined) return "-";
  if (!Number.isInteger(value)) return value.toFixed(2);
  return value >= 10_000 ? `${Math.round(value / 1000)}k` : String(value);
}

function formatCurrency(value: number, currency: string | undefined): string {
  return `${currency === "CNY" ? "¥" : "$"}${formatAmount(value)}`;
}

function bucketDetailLabel(bucket: UsageBucket): string {
  return bucket.groupLabel ? `${bucket.groupLabel} / ${bucket.label}` : bucket.label;
}

function bucketValueText(bucket: UsageBucket): string | null {
  if (bucket.unit === "percent" && bucket.remaining !== undefined) {
    return `${Math.round(bucket.remaining)}%`;
  }
  if (bucket.unit === "currency" && bucket.remaining !== undefined) {
    return formatCurrency(bucket.remaining, bucket.currency);
  }
  if (bucket.remaining !== undefined && bucket.limit !== undefined) {
    return `${formatAmount(bucket.remaining)} / ${formatAmount(bucket.limit)}`;
  }
  return null;
}

function metricValueText(metric: UsageMetric): string {
  return metric.unit === "currency"
    ? formatCurrency(Number(metric.value), metric.currency)
    : String(metric.value);
}

/** 余量百分比 → 语气档。与上下文环（>70 warn / >90 bad）是**反向**的一档：这里越低越危险。 */
export function quotaTone(remainingPercent: number): "ok" | "warn" | "bad" {
  if (remainingPercent <= 10) return "bad";
  if (remainingPercent <= 30) return "warn";
  return "ok";
}

/**
 * 芯片显示哪一个窗口：百分比窗口里 `remaining` 最小的那个。
 * 同值时保留报告里的原顺序（先来先占位），排序稳定。
 */
export function pickHeadlineBucket(buckets: readonly UsageBucket[]): UsageBucket | null {
  const percent = buckets.filter(
    (bucket) => bucket.unit === "percent" && bucket.remaining !== undefined,
  );
  if (percent.length === 0) return null;
  return percent.reduce((tightest, bucket) => (
    (bucket.remaining ?? 100) < (tightest.remaining ?? 100) ? bucket : tightest
  ));
}

/** 报告 → 芯片。报告里一个可显示的数都没有时返回 null（芯片整个不渲染）。 */
export function summarizeProviderQuota(report: UsageReport): QuotaChipSummary | null {
  const headline = pickHeadlineBucket(report.buckets);
  const currencyBucket = headline
    ? null
    : report.buckets.find((bucket) => bucket.remaining !== undefined && bucket.unit !== "percent")
      ?? null;
  const headlineText = headline
    ? bucketValueText(headline)
    : currencyBucket
      ? bucketValueText(currencyBucket)
      : null;
  const metric = headline || currencyBucket
    ? null
    : report.metrics.find((entry) => entry.value !== "" && entry.value !== undefined);

  const text = headlineText
    ?? (metric ? metricValueText(metric) : null)
    ?? report.buckets[0]?.period
    ?? null;
  if (text === null) return null;

  const lines: string[] = [];
  for (const bucket of report.buckets) {
    const value = bucketValueText(bucket);
    lines.push(value === null ? bucketDetailLabel(bucket) : `${bucketDetailLabel(bucket)} · ${value}`);
  }
  for (const entry of report.metrics) lines.push(`${entry.label} · ${metricValueText(entry)}`);
  if (lines.length === 0) lines.push(report.providerName);

  return {
    text,
    tone: headline ? quotaTone(headline.remaining ?? 0) : "count",
    // title 是属性：一行一条要真的换行，纯空格分隔在浏览器里读不出来。
    detail: lines.join("\n"),
    capturedAt: report.capturedAt,
  };
}