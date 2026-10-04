// fork:models-usage-cards — 画板 41「用量摘要（近 30 天）」的四张小卡。
//
// 数据不是新的聚合：模型设置页要的是**按 provider** 切一刀的近 30 天用量，
// 而 `/api/usage-stats` 的 `models[]` 已经是按 `provider/modelId` 分好组的
// （`lib/usage-stats.ts` 的 `summarizeUsage`）。所以这里只做一次读取 + 过滤，
// 不新增聚合逻辑，也不在设置页里重扫会话文件。
//
// 四张卡沿用画板 `.d-statgrid` / `.d-stat`：标签 / 数值 / 一行补充。
// 画板那行补充写的是「↑ 12%」「缓存命中 62%」——趋势需要上一周期的数据，
// 这里换成本地算得出来的口径（占比、缓存命中率、缓存写入），不编趋势。
"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { PwaSetRow } from "@/components/pwa/PwaPage";
import type { UsageStatsSummary } from "@/lib/usage-stats";

interface Props {
  /** models.json 里的 provider id（`UsageModelPoint.model` 的前缀）。 */
  providerId: string;
}

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; summary: UsageStatsSummary };

function formatCompact(value: number, locale: string): string {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return new Intl.NumberFormat(locale).format(Math.round(value));
}

function formatCost(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
  }).format(value);
}

function percent(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}

export function ProviderUsageCards({ providerId }: Props): ReactNode {
  const { t, locale } = useI18n();
  const mobile = useIsMobile();
  const [state, setState] = useState<LoadState>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ phase: "loading" });
    const params = new URLSearchParams({ range: "30d", tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
    void fetch(`/api/usage-stats?${params}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: UsageStatsSummary | null) => {
        if (cancelled) return;
        if (!data || !Array.isArray(data.models)) {
          setState({ phase: "error", message: t("models.usageUnavailable") });
          return;
        }
        setState({ phase: "ready", summary: data });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
      });
    return () => { cancelled = true; };
  }, [providerId, t]);

  const cards = useMemo(() => {
    if (state.phase !== "ready") return null;
    const { models, totals } = state.summary;
    // `model` is `provider/modelId`; a provider also owns models the runtime
    // inherited from a merged models.json entry, so match the prefix exactly.
    const prefix = `${providerId}/`;
    const own = models.filter((point) => point.model.startsWith(prefix));

    const messages = own.reduce((sum, point) => sum + point.messages, 0);
    const input = own.reduce((sum, point) => sum + point.tokensByKind.input, 0);
    const output = own.reduce((sum, point) => sum + point.tokensByKind.output, 0);
    const cacheRead = own.reduce((sum, point) => sum + point.tokensByKind.cacheRead, 0);
    const cacheWrite = own.reduce((sum, point) => sum + point.tokensByKind.cacheWrite, 0);
    const cost = own.reduce((sum, point) => sum + point.cost, 0);

    return {
      messages,
      input,
      output,
      cost,
      // Cache hit rate counts reads against what actually went to the provider:
      // a hit is a token the provider did not have to re-read.
      cacheHit: percent(cacheRead, input + cacheRead),
      cacheWrite,
      requestShare: percent(messages, totals.messages),
      costShare: percent(cost, totals.cost),
      hasData: own.length > 0,
    };
  }, [providerId, state]);

  if (state.phase === "error") {
    return <div className="d-t-xs d-t-faint" role="status">{state.message}</div>;
  }
  if (state.phase === "loading") {
    return <div className="d-t-xs d-t-faint" role="status">{t("models.usageLoading")}</div>;
  }
  if (!cards?.hasData) {
    return <div className="d-t-xs d-t-faint" role="status">{t("models.usageNoData")}</div>;
  }

  // fork:v5-landing Wave B · M-09 帧 C：四张小卡在手机上一张卡群里四行
  // （`.m-cardgroup` › `.m-setrow`），值与那一行补充**一字未改**，仍是同一份切法。
  if (mobile) {
    return (
      <div className="m-cardgroup">
        <PwaSetRow
          icon="sigma"
          label={t("models.usageRequests")}
          sub={t("models.usageOfTotal", { share: cards.requestShare })}
          trailing={<span className="m-t-lg m-t-b">{formatCompact(cards.messages, locale)}</span>}
        />
        <PwaSetRow
          icon="arrow-down"
          label={t("models.usageInputTokens")}
          sub={t("models.usageCacheHit", { rate: cards.cacheHit })}
          trailing={<span className="m-t-lg m-t-b">{formatCompact(cards.input, locale)}</span>}
        />
        <PwaSetRow
          icon="arrow-up"
          label={t("models.usageOutputTokens")}
          sub={t("models.usageCacheWrite", { count: formatCompact(cards.cacheWrite, locale) })}
          trailing={<span className="m-t-lg m-t-b">{formatCompact(cards.output, locale)}</span>}
        />
        <PwaSetRow
          icon="percent"
          label={t("models.usageCost")}
          sub={t("models.usageOfTotal", { share: cards.costShare })}
          trailing={<span className="m-t-lg m-t-b">{formatCost(cards.cost, locale)}</span>}
        />
      </div>
    );
  }

  return (
    <div className="d-statgrid">
      <div className="d-stat">
        <span className="d-t-xs d-t-faint">{t("models.usageRequests")}</span>
        <span className="d-t-title d-num">{formatCompact(cards.messages, locale)}</span>
        <span className="d-t-xs d-t-faint">{t("models.usageOfTotal", { share: cards.requestShare })}</span>
      </div>
      <div className="d-stat">
        <span className="d-t-xs d-t-faint">{t("models.usageInputTokens")}</span>
        <span className="d-t-title d-num">{formatCompact(cards.input, locale)}</span>
        <span className="d-t-xs d-t-faint">{t("models.usageCacheHit", { rate: cards.cacheHit })}</span>
      </div>
      <div className="d-stat">
        <span className="d-t-xs d-t-faint">{t("models.usageOutputTokens")}</span>
        <span className="d-t-title d-num">{formatCompact(cards.output, locale)}</span>
        <span className="d-t-xs d-t-faint">{t("models.usageCacheWrite", { count: formatCompact(cards.cacheWrite, locale) })}</span>
      </div>
      <div className="d-stat">
        <span className="d-t-xs d-t-faint">{t("models.usageCost")}</span>
        <span className="d-t-title d-num">{formatCost(cards.cost, locale)}</span>
        <span className="d-t-xs d-t-faint">{t("models.usageOfTotal", { share: cards.costShare })}</span>
      </div>
    </div>
  );
}
