"use client";

/**
 * fork:quota-chip —— 输入框工具条上的供应商配额芯片（上游 closed PR #867）。
 *
 * `POST /api/provider-usage/query` 已经能问出各家供应商的额度，数据一直都在，
 * 但只出现在设置页的模型详情里（`components/ProviderUsageSummary.tsx`）——
 * 写代码的时候看不到额度，于是每次都开设置页去翻。这里把它挂在模型选择器右边。
 *
 * ## 设计：不新造控件
 * 复用画板 20 帧 B 的 `.pw-badge count`（那一帧的「2 条排队」就是工具条里一枚带前置
 * 图标的徽章），只换图标与数字：`.pw-composer-bar` 里的徽章这一族已经在画板上，
 * 不需要新的 `.pw-*` 类，也不进 `board.css`（判据⑦ 只对**新类**生效）。
 * 位置按上游 #867 的说法放在模型选择器右侧；落位与窄屏取舍记在 DIVERGENCE W 节。
 *
 * ## 行为
 * - **静默降级**：没有 provider、不支持的 provider、没缓存过、查询失败 —— 一律**不渲染**，
 *   输入区不留任何报错痕迹（这里是写代码的地方，不是设置页）。
 * - **不打扰**：默认读 `localStorage` 里设置页写下的那份缓存，缓存超过 5 分钟才在后台
 *   悄悄刷一次；输入区常驻，所以不能每次会话打开都打一次供应商接口。
 * - **窄屏不挤输入框**：`narrow` 时只留图标（和工具条里其它控件的处理一致，见
 *   `ChatInput.tsx` 的 `(!narrowControls || controlsMenuOpen) && …`）。
 */
import { useEffect, useState } from "react";
import { isProviderUsageId } from "@/lib/provider-usage-ids";
import type { UsageReport } from "@/lib/provider-usage";
import {
  QUOTA_CACHE_TTL_MS,
  summarizeProviderQuota,
  type QuotaChipSummary,
} from "@/lib/provider-usage-quota";

/** 与 `components/ProviderUsageSummary.tsx` 共用同一个 key：设置页刷过的数据这里直接用。 */
const STORAGE_PREFIX = "pi-web:provider-usage:";

interface CachedUsage {
  status: string;
  report?: UsageReport;
  message?: string;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** 读设置页（或上一次查询）留下的缓存。坏掉的条目当场丢掉，不当错误抛。 */
export function readQuotaCache(storage: StorageLike | undefined, providerId: string): QuotaChipSummary | null {
  try {
    const raw = storage?.getItem(`${STORAGE_PREFIX}${providerId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedUsage;
    if (parsed?.status !== "ready" || !parsed.report) return null;
    if (!Array.isArray(parsed.report.buckets) || !Array.isArray(parsed.report.metrics)) return null;
    return summarizeProviderQuota(parsed.report);
  } catch {
    try { storage?.removeItem?.(`${STORAGE_PREFIX}${providerId}`); } catch { /* 忽略 */ }
    return null;
  }
}

/**
 * 取一次配额：先用缓存，缓存比 5 分钟新就直接返回（不打供应商接口），
 * 否则在后台查一次并回填缓存。**任何一步失败都只返回缓存值或 null**，不抛 ——
 * 芯片是信息，不是必须成功的功能。
 */
export async function loadProviderQuota(
  providerId: string | null,
  deps: { fetchImpl?: typeof fetch; storage?: StorageLike; now?: number } = {},
): Promise<QuotaChipSummary | null> {
  if (!providerId || !isProviderUsageId(providerId)) return null;
  const storage = deps.storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
  const cached = readQuotaCache(storage, providerId);
  const now = deps.now ?? Date.now();
  if (cached && now - cached.capturedAt <= QUOTA_CACHE_TTL_MS) return cached;

  const fetchImpl = deps.fetchImpl ?? (typeof fetch === "undefined" ? undefined : fetch);
  if (!fetchImpl) return cached;
  try {
    const response = await fetchImpl("/api/provider-usage/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId }),
    });
    const data = await response.json() as CachedUsage;
    // auth-unavailable / query-failed / 403 全部走同一条路：保留旧值，没有就什么都不显示。
    if (!response.ok || data.status !== "ready" || !data.report) return cached;
    try { storage?.setItem(`${STORAGE_PREFIX}${providerId}`, JSON.stringify(data)); } catch { /* 隐私模式，不缓存 */ }
    return summarizeProviderQuota(data.report);
  } catch {
    return cached;
  }
}

export function ProviderQuotaChip({ providerId, narrow = false }: { providerId: string | null; narrow?: boolean }) {
  const [summary, setSummary] = useState<QuotaChipSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadProviderQuota(providerId).then((next) => {
      if (!cancelled) setSummary(next);
    });
    return () => { cancelled = true; };
  }, [providerId]);

  if (!summary) return null;
  return (
    <span className={`pw-badge ${summary.tone}`} title={summary.detail} aria-label={summary.detail}>
      <span className="pw-ico"><i data-ico="gauge" data-size="11" aria-hidden="true"></i></span>
      {!narrow && summary.text}
    </span>
  );
}