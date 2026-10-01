import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject(path) {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import(path);
  } catch {
    return import(path);
  }
}

const { buildModelsListUrl, parseDiscoveredModels } = await loadSubject("./model-discovery.ts");
const { resolveModelDiscoveryAuth } = await loadSubject("./model-discovery-auth.ts");

test("builds protocol-appropriate model list URLs", () => {
  assert.equal(buildModelsListUrl("https://api.example.com/v1/", "openai-completions").toString(), "https://api.example.com/v1/models");
  assert.equal(buildModelsListUrl("https://api.anthropic.com", "anthropic-messages").toString(), "https://api.anthropic.com/v1/models?limit=1000");
  assert.equal(buildModelsListUrl("https://generativelanguage.googleapis.com", "google-generative-ai").toString(), "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000");
  assert.equal(buildModelsListUrl("https://api.example.com/custom/models", "openai-responses").toString(), "https://api.example.com/custom/models");
});

test("parses OpenAI, Anthropic, Google, and string model lists", () => {
  assert.deepEqual(parseDiscoveredModels({ data: [{ id: "gpt-5" }, { id: "claude", display_name: "Claude" }] }), [
    { id: "claude", name: "Claude" },
    { id: "gpt-5" },
  ]);
  assert.deepEqual(parseDiscoveredModels({ models: [{ name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro" }] }), [
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
  ]);
  assert.deepEqual(parseDiscoveredModels(["zeta", "alpha", "alpha"]), [
    { id: "alpha" },
    { id: "zeta" },
  ]);
});

test("resolves environment-backed headers without an API key", async () => {
  process.env.PI_WEB_DISCOVERY_TEST_TOKEN = "resolved-token";
  try {
    const auth = await resolveModelDiscoveryAuth("pi-web-header-only-test", {
      baseUrl: "https://example.invalid/v1",
      api: "openai-completions",
      headers: { "X-Discovery-Token": "$PI_WEB_DISCOVERY_TEST_TOKEN" },
    });
    assert.equal(auth.apiKey, undefined);
    assert.deepEqual(auth.headers, { "X-Discovery-Token": "resolved-token" });
  } finally {
    delete process.env.PI_WEB_DISCOVERY_TEST_TOKEN;
  }
});

// fork:model-discovery-specs —— 私有网关 / vLLM / 自建端点在 models.dev 上查不到，
// `/models` 报上来的上下文档位是唯一来源（上游 closed PR #957 的取值表 + input 模态）。
test("reads context window and max output tokens from provider model lists", () => {
  assert.deepEqual(parseDiscoveredModels({ data: [{ id: "gpt-5", context_window: 400000, max_tokens: 128000 }] }), [
    { id: "gpt-5", contextWindow: 400000, maxTokens: 128000 },
  ]);
  // vLLM / Together / OpenRouter 风格。
  assert.deepEqual(parseDiscoveredModels({ data: [{ id: "a", context_length: 32768, max_output_tokens: 8192 }] }), [
    { id: "a", contextWindow: 32768, maxTokens: 8192 },
  ]);
  assert.deepEqual(parseDiscoveredModels({ data: [{ id: "b", max_context_tokens: 200000, max_completion_tokens: 32000 }] }), [
    { id: "b", contextWindow: 200000, maxTokens: 32000 },
  ]);
  // camelCase。
  assert.deepEqual(parseDiscoveredModels({ data: [{ id: "c", contextWindow: 128000, maxTokens: 4096 }] }), [
    { id: "c", contextWindow: 128000, maxTokens: 4096 },
  ]);
  // 裹在 metadata / limits / capabilities / top_provider 下面。
  assert.deepEqual(parseDiscoveredModels({ data: [{ id: "d", metadata: { limits: { context_window: 128000, max_tokens: 16384 } } }] }), [
    { id: "d", contextWindow: 128000, maxTokens: 16384 },
  ]);
  assert.deepEqual(parseDiscoveredModels({ data: [{ id: "e", top_provider: { context_length: 1000000 } }] }), [
    { id: "e", contextWindow: 1000000 },
  ]);
  assert.deepEqual(parseDiscoveredModels({ data: [{ id: "f", capabilities: { limits: { max_tokens: 64000 } } }] }), [
    { id: "f", maxTokens: 64000 },
  ]);
  // 某些网关报的是数字字符串。
  assert.deepEqual(parseDiscoveredModels({ data: [{ id: "g", context_window: "262144", max_tokens: "16384" }] }), [
    { id: "g", contextWindow: 262144, maxTokens: 16384 },
  ]);
});

test("ignores unusable upstream spec values instead of writing them", () => {
  for (const bad of [0, -1, 1.5, "", "abc", null, undefined, Number.NaN, {}, [], true, false]) {
    assert.deepEqual(parseDiscoveredModels({ data: [{ id: "x", context_window: bad, max_tokens: bad }] }), [
      { id: "x" },
    ], `should drop context_window/max_tokens = ${JSON.stringify(bad)}`);
  }
  // 一个合法值不被同一行里的脏值带掉。
  assert.deepEqual(parseDiscoveredModels({ data: [{ id: "y", context_window: 128000, max_tokens: "lots" }] }), [
    { id: "y", contextWindow: 128000 },
  ]);
  // 嵌套层的脏值不遮蔽顶层的合法值。
  assert.deepEqual(parseDiscoveredModels({ data: [{ id: "z", context_window: 128000, limits: { context_window: -5 } }] }), [
    { id: "z", contextWindow: 128000 },
  ]);
});

test("reads input modalities, in both the list and the boolean spelling", () => {
  // OpenRouter / 自己写的网关：直接给数组。
  assert.deepEqual(parseDiscoveredModels({ data: [{ id: "a", architecture: { input_modalities: ["text", "image"] } }] }), [
    { id: "a", input: ["text", "image"] },
  ]);
  assert.deepEqual(parseDiscoveredModels({ data: [{ id: "b", input_modalities: ["text"] }] }), [
    { id: "b", input: ["text"] },
  ]);
  // `modalities: {input: [...]}` 与 `modalities: [...]` 两种写法。
  assert.deepEqual(parseDiscoveredModels({ data: [{ id: "c", modalities: { input: ["text", "image"] } }] }), [
    { id: "c", input: ["text", "image"] },
  ]);
  assert.deepEqual(parseDiscoveredModels({ data: [{ id: "d", modalities: ["text"] }] }), [
    { id: "d", input: ["text"] },
  ]);
  // vLLM / Together 的布尔写法。
  assert.deepEqual(parseDiscoveredModels({ data: [{ id: "e", vision: true }] }), [
    { id: "e", input: ["text", "image"] },
  ]);
  assert.deepEqual(parseDiscoveredModels({ data: [{ id: "f", vision: false }] }), [
    { id: "f", input: ["text"] },
  ]);
  // pi 的 input 只有 text / image 两个字面量，其它一律不认。
  assert.deepEqual(parseDiscoveredModels({ data: [{ id: "g", input_modalities: ["text", "audio", "video"] }] }), [
    { id: "g", input: ["text"] },
  ]);
  // 没报模态就不写这个键（绝不猜成 ["text"]）。
  assert.deepEqual(parseDiscoveredModels({ data: [{ id: "h", context_window: 1000 }] }), [
    { id: "h", contextWindow: 1000 },
  ]);
  // 顶层数组写法优先于嵌套的 vision 布尔。
  assert.deepEqual(parseDiscoveredModels({ data: [{ id: "i", input_modalities: ["text"], vision: true }] }), [
    { id: "i", input: ["text"] },
  ]);
});

test("keeps specs alongside ids and names from mixed provider responses", () => {
  assert.deepEqual(parseDiscoveredModels({
    data: [
      { id: "with-both", name: "With Both", context_window: 200000, max_tokens: 32000 },
      { id: "with-name", display_name: "Only Name" },
      { id: "with-ctx", context_length: 8192 },
      "bare-string",
    ],
  }), [
    { id: "bare-string" },
    { id: "with-name", name: "Only Name" },
    { id: "with-both", name: "With Both", contextWindow: 200000, maxTokens: 32000 },
    { id: "with-ctx", contextWindow: 8192 },
  ]);
});
