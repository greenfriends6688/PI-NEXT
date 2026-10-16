import type { CloudEnv } from "./env.ts";
import { StoreObject } from "./store-object.ts";
import { SignalObject } from "./signal-object.ts";

/**
 * PI NEXT's cloud, on Cloudflare.
 *
 * Two Durable Object classes and one `fetch`. The Worker itself holds no state and makes no
 * decisions beyond where a request belongs:
 *
 * - `/api/rtc/signal` is a call, and calls belong to an account — so it goes to that account's
 *   `SignalObject`, which holds both ends of it.
 * - Everything else is a question about the document (who is this token, which devices, what
 *   gateways) and goes to the one `StoreObject`, which holds it and runs the router.
 *
 * The split is not for scale. It is because the two have opposite lifetime needs: the document
 * must be the only writer of itself, so everything touching it has to queue behind everything
 * else touching it; a live call must never wait for a sign-in to finish. One object doing both
 * would put the second behind the first.
 *
 * The core (`services/cloud/src`) is the same code the Node host runs. It is written against
 * `Request`/`Response`, an injected `CloudStorage` and a socket-free relay, precisely so this
 * file could be this short.
 */
export { StoreObject, SignalObject };

export default {
  async fetch(request: Request, env: CloudEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/rtc/signal") {
      // The account is read off the token here so the request can be addressed to that
      // account's object. The object verifies the token again for itself — the Worker's word
      // is convenient, not authoritative, and one hop on connect is nothing.
      const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
      const verified = token ? await askStore<{ account: { id: string } | null }>(env, { op: "verify", token }) : { account: null };
      if (!verified.account) return new Response(null, { status: 401 });
      const stub = env.SIGNAL.get(env.SIGNAL.idFromName(verified.account.id));
      return stub.fetch(request);
    }

    return env.STORE.get(env.STORE.idFromName("store")).fetch(request);
  },
};

async function askStore<T>(env: CloudEnv, body: Record<string, unknown>): Promise<T> {
  const reply = await env.STORE.get(env.STORE.idFromName("store")).fetch("https://store/__store", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await reply.json()) as T;
}
