// A provider's quota, as `POST /api/provider-usage/query { providerId }`
// answers it (`src/api/misc.ts`, route
// `app/api/provider-usage/query/route.ts:9-29`).
//
// The route returns either `status: "ready"` with a report of quota windows
// and balance lines, or `auth-unavailable` / `query-failed` with a message
// (`lib/provider-usage.ts:41-44`). The component shows both, so a provider
// with no credential says why instead of looking like a broken refresh.
//
// It queries when it is enabled and mounted, and again on Refresh. pi-next
// kept the last good answer in localStorage (`ProviderUsageSummary.tsx:23-70`);
// this app has none of that here, so a remount simply asks again.
//
// The look is the gallery kit (`../../ui/kit`) with the settings words
// (`./parts`): compact rows under the provider it belongs to, no Tailwind of
// our own.

import { resource, Text, View } from "nsh";
import { Button, colors, mono, Spinner } from "../../ui/kit";
import {
  isProviderUsageId,
  queryProviderUsage,
  type UsageBucket,
  type UsageMetric,
  type ProviderUsageId,
  type UsageReport,
} from "../../api/misc";
import { errorText } from "../../ui/errors";
import { t } from "../../ui/i18n";
import { SettingsError, SettingsNote } from "./parts";

function formatAmount(value: number | undefined): string {
  return value === undefined ? "-" : Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatReset(seconds: number): string {
  return new Date(seconds * 1_000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** When the provider answered, in the reader's clock, next to the quotas. */
function formatUpdated(milliseconds: number): string {
  return new Date(milliseconds).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function bucketValue(bucket: UsageBucket): string {
  if (bucket.unit === "percent" && bucket.remaining !== undefined) {
    const reset = bucket.resetsAt ? ` / ${formatReset(bucket.resetsAt)}` : "";
    return `${Math.round(bucket.remaining)}%${reset}`;
  }
  if (bucket.unit === "currency") {
    const amount = bucket.remaining ?? bucket.limit;
    return `${bucket.currency === "CNY" ? "CNY " : "$"}${formatAmount(amount)}`;
  }
  if (bucket.remaining !== undefined && bucket.limit !== undefined) {
    return `${formatAmount(bucket.remaining)} / ${formatAmount(bucket.limit)}`;
  }
  return bucket.period ?? t("common.available");
}

function bucketLabel(bucket: UsageBucket): string {
  return bucket.groupLabel ? `${bucket.groupLabel} / ${bucket.label}` : bucket.label;
}

function metricValue(metric: UsageMetric): string {
  if (metric.unit === "currency") {
    return `${metric.currency === "CNY" ? "CNY " : "$"}${metric.value}`;
  }
  return String(metric.value);
}

function UsageRow(props: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", gap: 12, minWidth: 0 }}>
      <Text style={{ flex: 1, minWidth: 0, fontSize: 11.5, fontFamily: mono, color: colors.muted, numberOfLines: 1 }}>
        {props.label}
      </Text>
      <Text style={{ fontSize: 11.5, fontFamily: mono, color: colors.text, numberOfLines: 1 }}>
        {props.value}
      </Text>
    </View>
  );
}

export function ProviderUsageSummary(props: {
  providerId: string;
  /** An accessor, so a provider turning configured starts the query without a remount. */
  enabled: boolean | (() => boolean);
}) {
  if (!isProviderUsageId(props.providerId)) return null;
  const providerId: ProviderUsageId = props.providerId;
  const enabled = (): boolean => (typeof props.enabled === "function" ? props.enabled() : props.enabled);

  const usage = resource(
    (): ProviderUsageId | null => (enabled() ? providerId : null),
    async (id: ProviderUsageId, info) => await queryProviderUsage(id, { signal: info.signal }),
  );

  const report = (): UsageReport | undefined => {
    const value = usage();
    return value?.status === "ready" ? value.report : undefined;
  };
  const failure = (): string | null => {
    const value = usage();
    return value && value.status !== "ready" ? value.message : null;
  };
  const loading = () => usage.loading();

  return (
    <View style={{ paddingTop: 8, gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: "600", color: colors.text }}>
          {t("settings.usage")}
        </Text>
        <If when={loading()}>
          <Spinner size={11} tint={colors.accent} />
        </If>
        <Button
          label={t("i18n.refresh")}
          icon="undo"
          variant="ghost"
          size="small"
          disabled={!enabled() || loading()}
          onPress={() => usage.refetch()}
        />
      </View>

      <If when={report() !== undefined}>
        <Text style={{ fontSize: 10.5, color: colors.faint }}>
          {t("providerUsage.updated", {
            time: report() === undefined ? "" : formatUpdated(report()!.capturedAt),
          })}
        </Text>
      </If>
      <If when={!enabled()}>
        <SettingsNote>{t("settings.usageConnect")}</SettingsNote>
      </If>
      <If when={enabled() && usage.error()}>
        <SettingsError>{errorText(usage.error())}</SettingsError>
      </If>
      <If when={enabled() && failure()}>
        <SettingsError>{failure() ?? ""}</SettingsError>
      </If>
      <If when={enabled() && !loading() && usage() === undefined && !usage.error()}>
        <SettingsNote>{t("settings.usageNotQueried")}</SettingsNote>
      </If>
      <If when={report() !== undefined}>
        <View style={{ gap: 4 }}>
          <Each of={report()?.buckets ?? []} key={(bucket) => bucket.id}>
            {(bucket) => <UsageRow label={bucketLabel(bucket())} value={bucketValue(bucket())} />}
          </Each>
          <Each of={report()?.metrics ?? []} key={(metric) => metric.id}>
            {(metric) => <UsageRow label={metric().label} value={metricValue(metric())} />}
          </Each>
          <Each of={report()?.notes ?? []} key={(note) => note}>
            {(note) => <SettingsNote>{note()}</SettingsNote>}
          </Each>
        </View>
      </If>
    </View>
  );
}
