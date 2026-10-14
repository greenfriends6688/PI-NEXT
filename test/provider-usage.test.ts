import { test } from "node:test";
import assert from "node:assert/strict";
import { isOfficialProviderUsageOrigin, normalizeProviderUsagePayload } from "../src/main/engine/provider-usage.ts";

/**
 * The normalizers, without a network.
 *
 * Every one of these turns a provider's own JSON into the same bucket shape, and the
 * provider is the only place that knows what its numbers mean — so a wrong reading here is
 * a wrong balance on screen with nothing to contradict it. The fixtures are the payload
 * shapes the endpoints actually return.
 */

test("opencode-go reports its three windows as used percentages", () => {
  const report = normalizeProviderUsagePayload(
    "opencode-go",
    {
      usage: {
        rolling: { percent: 42, resets_at: 1_700_000_000 },
        weekly: { usage_percent: 7.5 },
        monthly: { percent: 0 },
      },
    },
    1_700_000_000_000,
  );

  assert.equal(report.providerId, "opencode-go");
  assert.deepEqual(report.buckets.map((bucket) => bucket.id), ["rolling", "weekly", "monthly"]);
  const [rolling, weekly, monthly] = report.buckets;
  assert.equal(rolling.unit, "percent");
  assert.equal(rolling.used, 42);
  assert.equal(rolling.remaining, 58);
  // `resets_at` is epoch **seconds**, so it has to come back as one.
  assert.equal(rolling.resetsAt, 1_700_000_000);
  // All three spellings of the same field are accepted, because the endpoint has used all
  // three across versions.
  assert.equal(weekly.used, 7.5);
  assert.equal(monthly.used, 0);
  assert.equal(report.capturedAt, 1_700_000_000_000);
});

test("a percentage is clamped, and a window without one is dropped rather than shown as zero", () => {
  const report = normalizeProviderUsagePayload("opencode-go", {
    usage: {
      rolling: { percent: 180 },
      weekly: { resets_at: 1_700_000_000 },
      monthly: {},
    },
  });
  assert.deepEqual(report.buckets.map((bucket) => bucket.id), ["rolling"]);
  assert.equal(report.buckets[0].used, 100);
  assert.equal(report.buckets[0].remaining, 0);
});

test("deepseek reports a currency balance as metrics, not windows", () => {
  // Its endpoint returns a balance list rather than usage windows, so there is no bucket
  // to draw a bar from — the numbers are the report, each with its own currency code.
  const report = normalizeProviderUsagePayload("deepseek", {
    is_available: true,
    balance_infos: [{ currency: "CNY", total_balance: "42.50", granted_balance: "2.50", topped_up_balance: "40.00" }],
  });
  assert.deepEqual(report.buckets, []);
  const total = report.metrics.find((metric) => metric.id === "cny-total");
  assert.ok(total, "the total balance must be reported");
  assert.equal(total.value, "42.50");
  assert.equal(total.unit, "currency");
  assert.equal(total.currency, "CNY");
  assert.equal(report.metrics.find((metric) => metric.id === "availability")?.value, "Available");
});

test("a provider that answers with nothing usable is an error, not an empty report", () => {
  // An empty report would render as 「no balance」 — which is a claim about the account,
  // not about the answer.
  assert.throws(() => normalizeProviderUsagePayload("deepseek", { is_available: true }));
  assert.throws(() => normalizeProviderUsagePayload("openrouter", { data: {} }));
});

test("a key is only ever sent to the provider's own published origin", () => {
  // The endpoint comes from a fixed table, so this is not what keeps the key off a
  // stranger's host — that is the table. It is what refuses to call a *relay* the real
  // provider, and it is the check `queryProviderUsage` makes before any request.
  assert.equal(isOfficialProviderUsageOrigin("opencode-go", "https://opencode.ai/zen/go/v1"), true);
  assert.equal(isOfficialProviderUsageOrigin("opencode-go", "https://opencode.ai/zen/go/v1/usage"), true);
  assert.equal(isOfficialProviderUsageOrigin("opencode-go", "https://my-relay.example/v1"), false);
  assert.equal(isOfficialProviderUsageOrigin("deepseek", "https://api.deepseek.com"), true);
  assert.equal(isOfficialProviderUsageOrigin("deepseek", "https://api.deepseek.com.evil.example"), false);
});
