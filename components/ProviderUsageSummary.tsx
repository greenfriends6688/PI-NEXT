// fork:usage-relative-time — upstream-port marker
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { formatUpdatedTime } from "@/lib/i18n/format";
import { isProviderUsageId } from "@/lib/provider-usage-ids";

type UsageBucket = {
  id: string;
  label: string;
  groupLabel?: string;
  used?: number;
  remaining?: number;
  limit?: number;
  unit: "percent" | "currency" | "count";
  currency?: string;
  windowMinutes?: number;
  resetsAt?: number;
  period?: string;
};

type UsageMetric = { id: string; label: string; value: number | string; unit?: string; currency?: string };
type UsageReport = { capturedAt: number; buckets: UsageBucket[]; metrics: UsageMetric[]; notes?: string[] };
type UsageResponse = { providerId: string; status: "ready" | "auth-unavailable" | "query-failed"; report?: UsageReport; message?: string };

const STORAGE_PREFIX = "pi-web:provider-usage:";

export function ProviderUsageSummary({ providerId, enabled }: { providerId: string; enabled: boolean }) {
  if (!isProviderUsageId(providerId)) return null;
  return <ProviderUsageContent providerId={providerId} enabled={enabled} />;
}

function ProviderUsageContent({ providerId, enabled }: { providerId: string; enabled: boolean }) {
  const [snapshot, setSnapshot] = useState<UsageResponse | null>(null);
  const [querying, setQuerying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshDone, setRefreshDone] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { locale, t } = useI18n();
  const mobile = useIsMobile();

  useEffect(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    setRefreshDone(false);
    setSnapshot(null);
    try {
      const cached = localStorage.getItem(`${STORAGE_PREFIX}${providerId}`);
      if (cached) {
        const parsed = JSON.parse(cached) as UsageResponse;
        if (parsed?.status === "ready" && parsed.report && Array.isArray(parsed.report.buckets) && Array.isArray(parsed.report.metrics)) {
          setSnapshot(parsed);
        }
      }
    } catch {
      try { localStorage.removeItem(`${STORAGE_PREFIX}${providerId}`); } catch {}
    }
    setError(null);
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [providerId]);

  const query = useCallback(async () => {
    setQuerying(true);
    setError(null);
    try {
      const response = await fetch("/api/provider-usage/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId }),
      });
      const result = await response.json() as UsageResponse & { error?: string };
      if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
      if (result.status === "ready") {
        setSnapshot(result);
        try { localStorage.setItem(`${STORAGE_PREFIX}${providerId}`, JSON.stringify(result)); } catch {}
        setRefreshDone(true);
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = setTimeout(() => setRefreshDone(false), 2000);
      } else {
        setError(result.message ?? t("providerUsage.queryFailed"));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("providerUsage.queryFailed"));
    } finally {
      setQuerying(false);
    }
  }, [providerId, t]);

  const report = snapshot?.status === "ready" ? snapshot.report : undefined;

  /*
   * fork:v5-landing Wave N1 · M-09 帧 D ——
   * 上一轮登记的缺件（“pwa/system.css 里没有 m-bar / m-statgrid 的等价物”）**不成立**：
   * `.m-card` / `.m-card-head` / `.m-card-body` / `.m-statgrid` / `.m-stat` / `.m-bar`
   * 六件都在库里（`design/v5/pwa/system.css` §统计格 + §通用卡体），且画板帧 D 给了
   * 它们的用法：配额行 = `.m-setrow-body`（名字 → `.m-bar` → 一行口径），
   * 指标格 = `.m-statgrid` › `.m-stat`。请求 / localStorage 缓存 / 百分比口径一律不动。
   */
  if (mobile) {
    return (
      <div className="m-card">
        <div className="m-card-head">
          <i data-ico="sigma" data-size="15" aria-hidden="true" />
          {t("providerUsage.usage")}
          <span className="m-grow" aria-hidden="true" />
          {report && (
            <span className="m-t-xs m-t-faint">
              {t("providerUsage.updated", { time: formatUpdatedTime(report.capturedAt, locale) })}
            </span>
          )}
          <button
            type="button"
            className="m-btn sm"
            onClick={query}
            disabled={!enabled || querying}
            title={t(querying ? "providerUsage.refreshing" : "providerUsage.refresh")}
            aria-label={t(querying ? "providerUsage.refreshing" : "providerUsage.refresh")}
            aria-busy={querying || undefined}
          >
            {querying ? (
              <span className="m-run" aria-hidden="true">
                <i data-ico="refresh-cw" data-size="13"></i>
              </span>
            ) : (
              <i data-ico={refreshDone ? "check" : "refresh-cw"} data-size="13" aria-hidden="true"></i>
            )}
            {t("i18n.refresh")}
          </button>
        </div>
        <div className="m-card-body">
          {!report && !error && <span className="m-t-xs m-t-faint">{t("providerUsage.notQueried")}</span>}
          {error && (
            <div className="m-banner">
              <i data-ico="triangle-alert" data-size="14" aria-hidden="true"></i>
              <span>{error}</span>
            </div>
          )}
          {report && (
            <>
              {report.buckets.map((bucket) => {
                const percent = bucketPercent(bucket);
                const label = bucket.groupLabel ? `${bucket.groupLabel} / ${bucket.label}` : bucket.label;
                return (
                  <div className="m-setrow-body" key={bucket.id}>
                    <span className="m-setrow-t">{label}</span>
                    {percent !== null && (
                      <span className="m-bar">
                        <i style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
                      </span>
                    )}
                    <span className="m-setrow-s">
                      {[
                        formatBucket(bucket, t("providerUsage.available")),
                        percent !== null ? `${Math.round(percent)}%` : null,
                      ].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                );
              })}
              {report.metrics.length > 0 && (
                <div className="m-statgrid">
                  {report.metrics.map((metric) => (
                    <div key={metric.id} className="m-stat">
                      <span className="m-t-xs m-t-faint">{metric.label}</span>
                      <div className="m-t-lg m-t-b">{formatMetric(metric)}</div>
                      <span className="m-t-xs m-t-faint">{metric.unit ?? "—"}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  /* fork:v5-landing —— 画板 D-08 帧 A「配额」：`d-set-sec` 分节 + 逐条 `.d-bar` 进度行，
     指标走 `.d-statgrid > .d-stat`，数值淡入用 `d-num`（命中时重挂载触发一次）。
     数据 / 请求 / localStorage 缓存逻辑一概不动。
     fork:v5-landing Wave N1 —— 窄屏那一支已按 M-09 帧 D 落地成 `m-*`（见上）。 */
  return (
    <section className="d-set-sec">
      <div className="d-row">
        <div className="d-set-sec-t">{t("providerUsage.usage")}</div>
        <span className="d-grow" aria-hidden="true" />
        {report && (
          <span
            title={new Date(report.capturedAt).toLocaleString(locale)}
            className="d-mono d-t-faint"
          >
            {t("providerUsage.updated", { time: formatUpdatedTime(report.capturedAt, locale) })}
          </span>
        )}
        <button
          type="button"
          className="d-btn sm"
          onClick={query}
          disabled={!enabled || querying}
          title={t(querying ? "providerUsage.refreshing" : "providerUsage.refresh")}
          aria-label={t(querying ? "providerUsage.refreshing" : "providerUsage.refresh")}
          aria-busy={querying || undefined}
        >
          {querying ? (
            <span className="d-run" aria-hidden="true">
              <i data-ico="refresh-cw" data-size="13"></i>
            </span>
          ) : (
            <i data-ico={refreshDone ? "check" : "refresh-cw"} data-size="13" aria-hidden="true"></i>
          )}
          {t("i18n.refresh")}
        </button>
      </div>

      {!report && !error && <span className="d-t-xs d-t-faint">{t("providerUsage.notQueried")}</span>}
      {error && (
        <div className="d-banner err">
          <i data-ico="triangle-alert" data-size="14" aria-hidden="true"></i>
          <span className="d-grow">{error}</span>
        </div>
      )}
      {report && (
        <>
          {report.buckets.length > 0 && (
            <div className="d-col">
              {report.buckets.map((bucket) => {
                const percent = bucketPercent(bucket);
                const label = bucket.groupLabel ? `${bucket.groupLabel} / ${bucket.label}` : bucket.label;
                return (
                  <div key={bucket.id} className="d-col">
                    <div className="d-row d-t-xs">
                      <span className="d-grow">{label}</span>
                      <span className={bucketTone(percent)}>{formatBucket(bucket, t("providerUsage.available"))}</span>
                      {percent !== null && <span className="d-t-xs d-t-faint">{Math.round(percent)}%</span>}
                    </div>
                    {percent !== null && (
                      <div className="d-bar">
                        <i style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {report.metrics.length > 0 && (
            <div className="d-statgrid">
              {report.metrics.map((metric) => (
                <div key={metric.id} className="d-stat">
                  <span className="d-t-xs d-t-faint">{metric.label}</span>
                  {/* `d-num` 的一次淡入靠重挂载触发，所以 key 跟着值走。 */}
                  <span key={String(metric.value)} className="d-num d-t-lg d-t-b">{formatMetric(metric)}</span>
                  <span className="d-t-xs d-t-faint">{metric.unit ?? "—"}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** 进度条宽度：percent 档直接用 remaining，其余有 used/limit 或 remaining/limit 才算。 */
function bucketPercent(bucket: UsageBucket): number | null {
  if (bucket.unit === "percent" && bucket.remaining !== undefined) return bucket.remaining;
  if (bucket.used !== undefined && bucket.limit) return (bucket.used / bucket.limit) * 100;
  if (bucket.remaining !== undefined && bucket.limit) return (bucket.remaining / bucket.limit) * 100;
  return null;
}

/** 画板 D-08 配额芯片的语气档：≥90% warn，否则 ok；算不出比例的走 mute。 */
function bucketTone(percent: number | null): string {
  if (percent === null) return "d-badge mute";
  return percent >= 90 ? "d-badge warn" : "d-badge ok";
}

function formatBucket(bucket: UsageBucket, availableLabel: string): string {
  if (bucket.unit === "percent" && bucket.remaining !== undefined) {
    const reset = bucket.resetsAt ? ` / ${formatReset(bucket.resetsAt)}` : "";
    return `${Math.round(bucket.remaining)}%${reset}`;
  }
  if (bucket.unit === "currency") return `${bucket.currency === "CNY" ? "CNY " : "$"}${formatAmount(bucket.remaining ?? bucket.limit)}`;
  if (bucket.remaining !== undefined && bucket.limit !== undefined) return `${formatAmount(bucket.remaining)} / ${formatAmount(bucket.limit)}`;
  return bucket.period ?? availableLabel;
}

function formatMetric(metric: UsageMetric): string {
  if (metric.unit === "currency") return `${metric.currency === "CNY" ? "CNY " : "$"}${metric.value}`;
  return String(metric.value);
}

function formatAmount(value: number | undefined): string {
  return value === undefined ? "-" : Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatReset(seconds: number): string {
  return new Date(seconds * 1_000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
