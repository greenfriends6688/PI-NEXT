// fork:usage-relative-time — upstream-port marker
"use client";

import { ConfigButton, ConfigSectionTitle, ConfigStat, ConfigStatGrid } from "./SettingsUi";
import { useCallback, useEffect, useRef, useState } from "react";
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
  return (
    <section className="pw-rowgap">
      {/* fork:design-system SW-14 —— 画板 41 的「用量摘要」卡：小节标题 + 四列统计卡。
          标题行右侧挂唯一的刷新动作（画板 41 的 `.pw-btn outline sm` + `refresh-cw`）。 */}
      <div className="pw-inline">
        <ConfigSectionTitle>{t("providerUsage.usage")}</ConfigSectionTitle>
        <ConfigButton
          size="small"
          onClick={query}
          disabled={!enabled || querying}
          title={t(querying ? "providerUsage.refreshing" : "providerUsage.refresh")}
          aria-label={t(querying ? "providerUsage.refreshing" : "providerUsage.refresh")}
        >
          <span className="pw-ico">
            {refreshDone
              ? <i data-ico="check" data-size="13"></i>
              : <i data-ico="refresh-cw" data-size="13" className={querying ? "pw-anim-spin" : undefined}></i>}
          </span>
          {t("i18n.refresh")}
        </ConfigButton>
        {report && (
          <span
            title={new Date(report.capturedAt).toLocaleString(locale)}
            className="pw-mono pw-dim"
          >
            {t("providerUsage.updated", { time: formatUpdatedTime(report.capturedAt, locale) })}
          </span>
        )}
      </div>

      {!report && !error && <span className="pw-dim">{t("providerUsage.notQueried")}</span>}
      {error && (
        <div className="pw-alert">
          <span className="pw-ico"><i data-ico="triangle-alert" data-size="14"></i></span>
          <span className="pw-grow">{error}</span>
        </div>
      )}
      {report && (
        <ConfigStatGrid>
          {report.buckets.map((bucket) => (
            <ConfigStat
              key={bucket.id}
              label={bucket.groupLabel ? `${bucket.groupLabel} / ${bucket.label}` : bucket.label}
              value={formatBucket(bucket, t("providerUsage.available"))}
              hint={bucket.period ?? t("providerUsage.available")}
            />
          ))}
          {report.metrics.map((metric) => (
            <ConfigStat
              key={metric.id}
              label={metric.label}
              value={formatMetric(metric)}
              hint={metric.unit ?? "—"}
            />
          ))}
        </ConfigStatGrid>
      )}
    </section>
  );
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
