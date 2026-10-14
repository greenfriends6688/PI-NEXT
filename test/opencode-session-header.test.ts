import { test } from "node:test";
import assert from "node:assert/strict";
import { opencodeGoProvider } from "@earendil-works/pi-ai/providers/opencode-go";

/**
 * Does the native opencode-go provider actually send `x-opencode-session`?
 *
 * The header is what makes an OpenCode request routable, and `pi-ai` adds it in
 * `withOpenCodeSessionHeader` **only when `options.sessionId` is set**. So the question is
 * never whether the provider can do it — it is whether anything upstream ever passes a
 * session id. Without one the upstream answers 400 with the model id echoed back, which
 * reads like "unknown model" and sends you looking at model ids instead of headers.
 *
 * That question is answerable with no network and no key, because `buildBaseOptions` copies
 * `options.fetch` straight through: a stub sees exactly what would have gone out.
 *
 * This pins the SDK's half of the contract. If it ever fails, the SDK changed and the fix
 * belongs in `pi-ai`, not in this app.
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
