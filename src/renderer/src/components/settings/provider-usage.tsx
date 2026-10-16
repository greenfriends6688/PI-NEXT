import { useCallback, useEffect, useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading03Icon, RefreshIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { isProviderUsageId, type ProviderUsageResult } from "@shared/provider-usage";
import type { ProviderConfig } from "@shared/types";

/**
 * The account's balance / quota for a provider that publishes one, shown inline in the
 * provider row next to `GatewayBalance`.
 *
 * Two things this deliberately does not do: it does not query on every render (one read
 * per mount, plus whatever the refresh button asks for), and it does not hide a failure —
 * a silent blank reads as 「this provider has no balance」, which is a different thing from
 * 「the endpoint refused」, and the refresh button beside it is the retry.
 */
export function ProviderUsage({ provider }: { provider: ProviderConfig }): JSX.Element | null {
  const { t } = useTranslation("settings");
  const [result, setResult] = useState<ProviderUsageResult | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!isProviderUsageId(provider.id)) return;
    setLoading(true);
    try {
      setResult(await window.pinext.providers.usage(provider.id));
    } catch (error) {
      setResult({
        providerId: provider.id,
        status: "query-failed",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  }, [provider.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!isProviderUsageId(provider.id)) return null;

  return (
    <span className="flex min-w-0 items-center gap-1.5 text-sm tabular-nums">
      {loading ? (
        <HugeiconsIcon strokeWidth={2} icon={Loading03Icon} className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
      ) : null}
      {result?.status === "ready" ? <UsageValue result={result} /> : null}
      {result && result.status !== "ready" ? (
        <span
          className="max-w-40 truncate text-xs text-muted-foreground"
          title={result.status === "auth-unavailable" ? t("providers.usageNeedsConnection") : t("providers.usageFailed")}
        >
          {result.status === "auth-unavailable" ? t("providers.usageNeedsConnection") : t("providers.usageFailed")}
        </span>
      ) : null}
      <Button
        size="icon-xs"
        variant="ghost"
        disabled={loading}
        onClick={() => void refresh()}
        aria-label={t("providers.usageRefresh")}
      >
        <HugeiconsIcon strokeWidth={2} icon={RefreshIcon} />
      </Button>
    </span>
  );
}

/** Percent windows read as "label 42%"; money and counts read as the number itself. */
function UsageValue({ result }: { result: Extract<ProviderUsageResult, { status: "ready" }> }): JSX.Element {
  const { t } = useTranslation("settings");
  // The window labels come from the provider as English (`Rolling` / `Weekly` /
  // `Monthly`); the pane is the only place a person reads them, so they are
  // translated here rather than shipped localised from the engine.
  //
  // `Rolling` is not "滚动窗口". That was a word-for-word rendering of the provider's
  // own field name, and it says nothing to the person reading it — a rolling window is
  // just the recent past, which is what it now says.
  const windowLabel = (label: string): string => {
    const key = label.toLowerCase();
    if (key.includes("rolling")) return t("providers.usageWindowRolling");
    if (key.includes("week")) return t("providers.usageWindowWeekly");
    if (key.includes("month")) return t("providers.usageWindowMonthly");
    if (key.includes("day") || key.includes("today")) return t("providers.usageWindowDaily");
    return label;
  };
  const entries = result.report.buckets.slice(0, 3).map((bucket) => {
    const label = windowLabel(bucket.label);
    if (bucket.unit === "percent") {
      // **What is left**, not what was spent: the number a person wants when they
      // glance at a quota is how much they still have.
      const remaining =
        bucket.remaining ??
        (bucket.limit !== undefined && bucket.used !== undefined
          ? bucket.limit - bucket.used
          : bucket.used !== undefined
            ? 100 - bucket.used
            : undefined);
      return { label, value: remaining === undefined ? null : `${Math.round(remaining)}%` };
    }
    const amount = bucket.remaining ?? bucket.used ?? bucket.limit;
    if (amount === undefined) return { label, value: null };
    return { label, value: bucket.unit === "currency" ? `${bucket.currency ?? ""}${amount}` : String(amount) };
  });
  if (entries.length === 0) {
    const metric = result.report.metrics[0];
    if (!metric) return <span className="text-xs text-muted-foreground">{result.report.providerName}</span>;
    entries.push({ label: metric.label, value: String(metric.value) });
  }

  // The window name is a qualifier and the number is the answer, so they are not the
  // same weight: the label stays quiet and the figure is drawn in the reading colour.
  // The old line was `max-w-52 truncate` over the whole sentence in `text-muted-foreground`
  // and `text-xs`, which cut it to `滚动窗口 剩余 73%·本周 剩余 52%·本…` in grey small print —
  // three ways at once to make the one number a person came for unreadable.
  const title = entries.map((entry) => (entry.value ? `${entry.label} ${t("providers.usageRemaining")} ${entry.value}` : entry.label)).join(" · ");
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-xs" title={title}>
      {entries.map((entry, index) => (
        <span key={`${entry.label}-${index}`} className="flex items-baseline gap-1 whitespace-nowrap">
          <span className="text-muted-foreground">{entry.label}</span>
          {entry.value ? (
            <span className="font-medium text-foreground tabular-nums">
              {t("providers.usageRemaining")} {entry.value}
            </span>
          ) : null}
        </span>
      ))}
    </span>
  );
}
