// fork:quota-chip —— 配额芯片的取数降级、缓存复用与画板契约
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { ProviderQuotaChip, loadProviderQuota, readQuotaCache } =
  await jiti.import("./ProviderQuotaChip.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

const source = await readFile(new URL("./ProviderQuotaChip.tsx", import.meta.url), "utf8");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
    read: (key) => map.get(key) ?? null,
  };
}

const report = (remaining) => ({
  status: "ready",
  report: {
    providerId: "openai-codex",
    providerName: "OpenAI Codex",
    capturedAt: 1_700_000_000_000,
    buckets: [{ id: "codex:primary", label: "5h", remaining, unit: "percent" }],
    metrics: [],
  },
});

const jsonResponse = (body, ok = true) => ({
  ok,
  json: async () => body,
});

test("an unsupported provider renders nothing at all", async () => {
  assert.equal(await loadProviderQuota("my-own-proxy", { storage: memoryStorage() }), null);
  assert.equal(await loadProviderQuota(null, { storage: memoryStorage() }), null);
  assert.equal(await loadProviderQuota("", { storage: memoryStorage() }), null);
});

test("a fresh cache is reused without touching the network", async () => {
  let called = 0;
  const storage = memoryStorage({ "pi-web:provider-usage:openai-codex": JSON.stringify(report(64)) });
  const summary = await loadProviderQuota("openai-codex", {
    storage,
    now: 1_700_000_000_000 + 30_000,
    fetchImpl: async () => { called += 1; return jsonResponse(report(1)); },
  });
  assert.equal(called, 0);
  assert.equal(summary.text, "64%");
  assert.equal(summary.tone, "ok");
});

test("a stale cache triggers one background refresh and writes the cache back", async () => {
  let called = 0;
  const storage = memoryStorage({ "pi-web:provider-usage:openai-codex": JSON.stringify(report(64)) });
  const summary = await loadProviderQuota("openai-codex", {
    storage,
    now: 1_700_000_000_000 + 10 * 60_000,
    fetchImpl: async () => { called += 1; return jsonResponse(report(8)); },
  });
  assert.equal(called, 1);
  assert.equal(summary.text, "8%");
  assert.equal(summary.tone, "bad");
  assert.deepEqual(JSON.parse(storage.read("pi-web:provider-usage:openai-codex")).report.buckets[0].remaining, 8);
});

test("a failed refresh silently keeps the last known value", async () => {
  const storage = memoryStorage({ "pi-web:provider-usage:openai-codex": JSON.stringify(report(64)) });
  const summary = await loadProviderQuota("openai-codex", {
    storage,
    now: 1_700_000_000_000 + 10 * 60_000,
    fetchImpl: async () => { throw new Error("network down"); },
  });
  assert.equal(summary.text, "64%");
});

test("auth-unavailable / query-failed / HTTP errors all degrade to the cached value", async () => {
  const storage = memoryStorage({ "pi-web:provider-usage:openai-codex": JSON.stringify(report(64)) });
  for (const body of [
    { status: "auth-unavailable", message: "Connect this provider first." },
    { status: "query-failed", message: "boom" },
  ]) {
    const summary = await loadProviderQuota("openai-codex", {
      storage,
      now: 1_700_000_000_000 + 10 * 60_000,
      fetchImpl: async () => jsonResponse(body),
    });
    assert.equal(summary.text, "64%", `${body.status} should keep the cached number`);
  }
  const forbidden = await loadProviderQuota("openai-codex", {
    storage,
    now: 1_700_000_000_000 + 10 * 60_000,
    fetchImpl: async () => jsonResponse({ error: "Untrusted API request" }, false),
  });
  assert.equal(forbidden.text, "64%");
});

test("with no cache and a failing query there is simply no chip", async () => {
  assert.equal(await loadProviderQuota("openai-codex", {
    storage: memoryStorage(),
    fetchImpl: async () => { throw new Error("network down"); },
  }), null);
  assert.equal(await loadProviderQuota("openai-codex", {
    storage: memoryStorage(),
    fetchImpl: async () => jsonResponse({ status: "query-failed" }),
  }), null);
});

test("a corrupt cache entry is dropped instead of thrown", () => {
  const storage = memoryStorage({ "pi-web:provider-usage:openai-codex": "{ broken" });
  assert.equal(readQuotaCache(storage, "openai-codex"), null);
  assert.equal(storage.read("pi-web:provider-usage:openai-codex"), null);
});

test("first frame renders no badge at all — nothing appears in the composer before data lands", () => {
  const html = renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(ProviderQuotaChip, { providerId: "openai-codex" })),
  );
  assert.equal(html, "");
});

test("the chip is board 20's badge atom, with no new class and no inline geometry", () => {
  assert.match(code, /className=\{`pw-badge \$\{summary\.tone\}`\}/, "芯片就是画板 20 帧 B 那一枚 .pw-badge");
  assert.match(code, /<i data-ico="gauge" data-size="11"/, "前置图标走画板 sprite 的 gauge");
  assert.match(code, /\{!narrow && summary\.text\}/, "窄屏只留图标，不占输入框宽度");
  assert.doesNotMatch(code, /<svg/, "图标一律走 <i data-ico>");
  assert.doesNotMatch(code, /style=\{\{/, "零内联几何（宽度/颜色归 board.css）");
  assert.doesNotMatch(code, /fork-.*(badge|chip)-/, "不许另起一套自带视觉的类");
});