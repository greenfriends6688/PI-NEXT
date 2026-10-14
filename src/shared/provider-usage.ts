/**
 * The providers whose usage/balance can be queried, and the shape of the answer.
 *
 * Shared because all three sides need it: the engine fills it in, the bridge types it,
 * and the renderer draws it. The query formats follow `@narumitw/pi-usage` (MIT,
 * Copyright (c) 2026 narumiruna), with no runtime dependency on that extension.
 */

export const PROVIDER_USAGE_IDS = [
  "openai-codex",
  "deepseek",
  "openrouter",
  "moonshotai",
  "moonshotai-cn",
  "minimax",
  "minimax-cn",
  "vercel-ai-gateway",
  "opencode-go",
  "kimi-coding",
] as const;

export type ProviderUsageId = (typeof PROVIDER_USAGE_IDS)[number];

export function isProviderUsageId(value: string): value is ProviderUsageId {
  return (PROVIDER_USAGE_IDS as readonly string[]).includes(value);
}

export type UsageUnit = "percent" | "currency" | "count";

export interface UsageBucket {
  id: string;
  label: string;
  groupLabel?: string;
  used?: number;
  remaining?: number;
  limit?: number;
  unit: UsageUnit;
  currency?: string;
  windowMinutes?: number;
  resetsAt?: number;
  period?: string;
}

export interface UsageMetric {
  id: string;
  label: string;
  value: number | string;
  unit?: UsageUnit;
  currency?: string;
}

export interface UsageReport {
  providerId: ProviderUsageId;
  providerName: string;
  capturedAt: number;
  buckets: UsageBucket[];
  metrics: UsageMetric[];
  notes?: string[];
}

export type ProviderUsageResult =
  | { providerId: ProviderUsageId; status: "ready"; report: UsageReport }
  | { providerId: ProviderUsageId; status: "auth-unavailable" | "query-failed"; message: string };
