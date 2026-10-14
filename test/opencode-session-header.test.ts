import { test } from "node:test";
import assert from "node:assert/strict";
import { opencodeGoProvider } from "@earendil-works/pi-ai/providers/opencode-go";

/**
 * What `x-opencode-session` depends on — and what it therefore cannot explain.
 *
 * The header is added by `pi-ai`'s `withOpenCodeSessionHeader`, and only when
 * `options.sessionId` is set. This test pins both halves of that, with no network and no
 * key, because `buildBaseOptions` copies `options.fetch` straight through: a stub sees
 * exactly what would have gone out.
 *
 * The reason it exists is a wrong guess that took three passes to kill. A 400 from
 * OpenCode that echoes the model id reads like a missing routing header, and it is not:
 * the session id does reach the provider. The chain, each link read in the shipped
 * bundles rather than assumed:
 *
 *   Agent.createLoopConfig()      → sessionId: this.sessionId   (pi-agent-core/agent.js)
 *   runAgentLoop → streamFunction → { ...config, apiKey, signal }  (agent-loop.js)
 *   ModelRuntime.prepareRequest   → { ...providerOptions, … }    (model-runtime.js)
 *   buildBaseOptions              → sessionId: options?.sessionId (pi-ai)
 *   withOpenCodeSessionHeader     → sets the header
 *
 * So a 400 naming the model is about the *model* — most likely one this account's plan
 * does not serve — and looking at headers is looking in the wrong place. What this test
 * protects is the other direction: if the SDK ever stops threading the session id, the
 * symptom would look exactly like the thing we were chasing.
 */

type Captured = { url: string; headers: Record<string, string> };

/** A fetch that records the request and answers with an SSE stream that ends at once. */
function capturingFetch(captured: Captured[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? {}).forEach((value, name) => { headers[name.toLowerCase()] = value; });
    captured.push({ url, headers });
    return new Response("data: [DONE]\n\n", {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }) as typeof fetch;
}

const CONTEXT = { messages: [{ role: "user", content: "hi" }] };

test("opencode-go sends x-opencode-session only when the caller supplies a session id", async () => {
  const provider = opencodeGoProvider();
  const model = provider.getModels()[0];
  assert.ok(model, "opencode-go must expose at least one model");

  const withSession: Captured[] = [];
  await provider
    .streamSimple(model, CONTEXT, { apiKey: "test-key", fetch: capturingFetch(withSession), sessionId: "session-abc" })
    .result()
    .catch(() => undefined);
  assert.equal(withSession.length, 1, "the request must reach the injected fetch");
  assert.equal(
    withSession[0].headers["x-opencode-session"],
    "session-abc",
    "a session id must become the routing header",
  );

  // And the other half: no session id, no header. That is the state this app is in if
  // nothing upstream passes one — the whole reason the upstream can answer 400.
  const withoutSession: Captured[] = [];
  await provider
    .streamSimple(model, CONTEXT, { apiKey: "test-key", fetch: capturingFetch(withoutSession) })
    .result()
    .catch(() => undefined);
  assert.equal(withoutSession.length, 1);
  assert.equal(withoutSession[0].headers["x-opencode-session"], undefined);
});
