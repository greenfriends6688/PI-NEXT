// fork:quota-chip —— 配额芯片的选窗与格式化
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { pickHeadlineBucket, quotaTone, summarizeProviderQuota, QUOTA_CACHE_TTL_MS } =
  await createJiti(import.meta.url).import("./provider-usage-quota.ts");

const percent = (id, remaining, extra = {}) => ({
  id,
  label: id,
  remaining,
  unit: "percent",
  ...extra,
});

test("the headline is the tightest percentage window, not the first one", () => {
  const report = {
    providerId: "openai-codex",
    providerName: "OpenAI Codex",
    capturedAt: 1_700_000_000_000,
    buckets: [percent("codex:primary", 82), percent("codex:secondary", 25)],
    metrics: [],
  };
  const summary = summarizeProviderQuota(report);
  assert.equal(summary.text, "25%");
  assert.equal(summary.tone, "warn");
  assert.equal(summary.detail, "codex:primary · 82%\ncodex:secondary · 25%");
});

test("tone tracks how close to empty the tightest window is", () => {
  assert.equal(quotaTone(90), "ok");
  assert.equal(quotaTone(31), "ok");
  assert.equal(quotaTone(30), "warn");
  assert.equal(quotaTone(11), "warn");
  assert.equal(quotaTone(10), "bad");
  assert.equal(quotaTone(0), "bad");
});

test("percent windows win over currency buckets when both exist", () => {
  const summary = summarizeProviderQuota({
    providerId: "openai-codex",
    providerName: "OpenAI Codex",
    capturedAt: 0,
    buckets: [
      { id: "credit", label: "Credits", remaining: 3.5, unit: "currency", currency: "USD" },
      percent("codex:primary", 12),
    ],
    metrics: [],
  });
  assert.equal(summary.text, "12%");
  assert.equal(summary.tone, "warn");
});

test("a balance-only provider shows the balance", () => {
  const summary = summarizeProviderQuota({
    providerId: "deepseek",
    providerName: "DeepSeek",
    capturedAt: 0,
    buckets: [],
    metrics: [{ id: "usd-total", label: "Total balance", value: 12.5, unit: "currency", currency: "USD" }],
  });
  assert.equal(summary.text, "$12.50");
  assert.equal(summary.tone, "count");
});

test("CNY amounts get their own symbol and large ones are compacted", () => {
  const summary = summarizeProviderQuota({
    providerId: "moonshotai-cn",
    providerName: "Moonshot AI CN",
    capturedAt: 0,
    buckets: [],
    metrics: [{ id: "available", label: "Available balance", value: 25300, unit: "currency", currency: "CNY" }],
  });
  assert.equal(summary.text, "¥25k");
});

test("a metric without a unit is shown verbatim", () => {
  const summary = summarizeProviderQuota({
    providerId: "openai-codex",
    providerName: "OpenAI Codex",
    capturedAt: 0,
    buckets: [],
    metrics: [{ id: "credits", label: "Credits", value: "Unlimited" }],
  });
  assert.equal(summary.text, "Unlimited");
  assert.equal(summary.detail, "Credits · Unlimited");
});

test("a report with nothing displayable yields no chip at all", () => {
  assert.equal(summarizeProviderQuota({
    providerId: "deepseek",
    providerName: "DeepSeek",
    capturedAt: 0,
    buckets: [],
    metrics: [],
  }), null);
});

test("detail lists every window and metric, one per line", () => {
  const summary = summarizeProviderQuota({
    providerId: "minimax",
    providerName: "minimax",
    capturedAt: 0,
    buckets: [
      percent("MiniMax-M2 / Rolling", 30, { groupLabel: "MiniMax-M2", label: "Rolling" }),
      { id: "left", label: "Left", remaining: 40, limit: 100, unit: "count" },
    ],
    metrics: [{ id: "available", label: "Available balance", value: 9, unit: "currency", currency: "USD" }],
  });
  assert.equal(summary.detail, "MiniMax-M2 / Rolling · 30%\nLeft · 40 / 100\nAvailable balance · $9");
});

test("no percentage window means the tone is neutral, never a false 'all good'", () => {
  assert.equal(pickHeadlineBucket([{ id: "a", label: "a", remaining: 0, unit: "count", limit: 10 }]), null);
  const summary = summarizeProviderQuota({
    providerId: "vercel-ai-gateway",
    providerName: "Vercel AI Gateway",
    capturedAt: 0,
    buckets: [],
    metrics: [{ id: "balance", label: "Credit balance", value: 0, unit: "currency", currency: "USD" }],
  });
  assert.equal(summary.tone, "count");
});

test("the cache window is long enough that opening a session does not hammer the provider", () => {
  assert.ok(QUOTA_CACHE_TTL_MS >= 60_000);
});