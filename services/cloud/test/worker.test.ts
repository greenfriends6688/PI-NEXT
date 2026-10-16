import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker/index.ts";
import { StoreObject } from "../worker/store-object.ts";
import { SignalObject } from "../worker/signal-object.ts";
import type { CloudEnv } from "../worker/env.ts";

/**
 * The Cloudflare host, driven by stand-ins for the two runtime pieces Node does not have.
 *
 * `wrangler dev` cannot run here: `workerd` requires macOS 13.5 and this machine is on 12.6, so
 * the alternative to a fake is no verification at all until something is deployed. The two
 * fakes below are small on purpose — `DurableObjectState.storage` over a `Map`, and a namespace
 * that keeps one instance per name, which is what a Durable Object *is*. Everything above them
 * is the real code: the real Worker `fetch`, the real objects, the real router, the real store.
 *
 * What this cannot cover is the WebSocket path, because `new Response(null, { status: 101,
 * webSocket })` is a workerd extension and Node's `Response` rejects a 101 outright. That part
 * is exercised through `services/cloud/test/cloud.test.ts` against the Node host, which runs the
 * same `CloudRelay`.
 */

function fakeState(): DurableObjectState {
  const store = new Map<string, unknown>();
  return {
    storage: {
      get: async (key: string) => store.get(key),
      put: async (key: string, value: unknown) => {
        store.set(key, structuredClone(value));
        // A real Durable Object hands back what it stored, not the object the caller still
        // holds — cloning here is what makes a test catch a mutation that was never written.
      },
    },
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>): Promise<T> => await fn(),
  } as unknown as DurableObjectState;
}

/** One instance per name, and a record of who was asked — a Durable Object namespace, in short. */
function namespaceFor<T extends { fetch(request: Request): Promise<Response> }>(
  create: (ctx: DurableObjectState, env: CloudEnv) => T,
  asked: string[],
  env: CloudEnv,
): DurableObjectNamespace {
  const instances = new Map<string, T>();
  const namespace = {
    idFromName: (name: string) => ({ name, toString: () => name }),
    get: (id: { name: string }) => ({
      fetch: (input: Request | string, init?: RequestInit) => {
        asked.push(id.name);
        let instance = instances.get(id.name);
        if (!instance) {
          instance = create(fakeState(), env);
          instances.set(id.name, instance);
        }
        return instance.fetch(typeof input === "string" ? new Request(input, init) : input);
      },
    }),
  };
  return namespace as unknown as DurableObjectNamespace;
}

/** The env, built around itself: the objects are handed the same env the namespaces live in. */
function fakeEnv(vars: Record<string, string> = {}): { env: CloudEnv; asked: string[] } {
  const asked: string[] = [];
  const env = {
    PUBLIC_ORIGIN: "http://127.0.0.1:8787",
    DEV_LOGIN: "1",
    ...vars,
  } as unknown as CloudEnv;
  // The objects are handed the same env the namespaces live in, which is how a Worker's
  // bindings actually work — `env` is one object, and it contains the namespaces.
  env.STORE = namespaceFor((ctx, e) => new StoreObject(ctx, e), asked, env);
  env.SIGNAL = namespaceFor((ctx, e) => new SignalObject(ctx, e), asked, env);
  return { env, asked };
}

const ORIGIN = "http://127.0.0.1:8787";
const REDIRECT = "http://127.0.0.1:55900/callback";

async function signIn(env: CloudEnv, login = "alice"): Promise<{ token: string; accountId: string }> {
  const { createHash, randomBytes } = await import("node:crypto");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const form = new URLSearchParams({
    client_id: "pinext-desktop",
    redirect_uri: REDIRECT,
    state: "s",
    code_challenge: challenge,
    code_challenge_method: "S256",
    decision: "allow",
    dev_login: "1",
    dev_account: login,
  });
  const decision = await worker.fetch(new Request(`${ORIGIN}/authorize/decision`, { method: "POST", body: form }), env);
  assert.equal(decision.status, 302, "approving should redirect back");
  const code = new URL(decision.headers.get("location")!).searchParams.get("code")!;
  const token = await worker.fetch(
    new Request(`${ORIGIN}/api/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: "pinext-desktop", redirect_uri: REDIRECT }),
    }),
    env,
  );
  const body = (await token.json()) as { access_token?: string; user?: { id?: string } };
  assert.ok(body.access_token, "the exchange should carry a token");
  assert.ok(body.user?.id, "the exchange should name the account");
  return { token: body.access_token, accountId: body.user.id };
}

/** The account id behind one token, read the way a client reads it. */
async function accountIdOf(env: CloudEnv, token: string): Promise<string> {
  const me = await worker.fetch(new Request(`${ORIGIN}/api/me`, { headers: { authorization: `Bearer ${token}` } }), env);
  return ((await me.json()) as { user: { id: string } }).user.id;
}

test("Worker：登录、设备与 ICE 都走 Durable Object", async () => {
  const { env, asked } = fakeEnv();

  const hello = await worker.fetch(new Request(`${ORIGIN}/api/hello`), env);
  assert.equal(hello.status, 200);
  assert.deepEqual(await hello.json(), { ok: true, service: "pinext-cloud", version: 1 });

  const page = await worker.fetch(
    new Request(`${ORIGIN}/authorize?client_id=pinext-desktop&redirect_uri=${encodeURIComponent(REDIRECT)}&state=s&code_challenge=${"x".repeat(43)}&code_challenge_method=S256`),
    env,
  );
  assert.equal(page.status, 200);
  assert.match(await page.text(), /authorize\/decision/);

  const { token } = await signIn(env);
  const accountId = await accountIdOf(env, token);
  assert.match(token, /^fvs_/);
  // Everything above reached the one object that holds the document, and nothing else.
  //
  // Written as a set rather than `.every((name) => name === "store")`: TypeScript 5.5 infers a
  // type predicate from that arrow, so `every`'s `this is S[]` overload narrows `asked` to
  // `"store"[]` for the rest of the test — and the later `asked.includes(accountId)` then does
  // not compile, for a reason that has nothing to do with the code under test.
  assert.equal(new Set(asked).size, 1, `unexpected objects: ${asked.join(", ")}`);
  assert.ok(asked.includes("store"), `the document's object should have answered: ${asked.join(", ")}`);

  const registered = await worker.fetch(
    new Request(`${ORIGIN}/api/devices/me`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ install_id: "inst_0123456789abcdef0123456789abcdef", name: "Mac", platform: "darwin" }),
    }),
    env,
  );
  assert.equal(registered.status, 200);
  const deviceId = ((await registered.json()) as { device: { id: string } }).device.id;
  assert.match(deviceId, /^dev_/);

  const listed = (await (
    await worker.fetch(new Request(`${ORIGIN}/api/devices`, { headers: { authorization: `Bearer ${token}` } }), env)
  ).json()) as { devices: Array<{ id: string; online: boolean }> };
  assert.equal(listed.devices.length, 1);
  // Nothing is connected, and the object that would hold the socket says so. This is the check
  // that would have been wrong if `isOnline` had been left synchronous: a Promise is truthy.
  assert.equal(listed.devices[0]?.online, false);
  assert.ok(
    asked.includes(accountId),
    `liveness must be asked of that account's signaling object; asked ${asked.join(", ")}`,
  );

  const ice = (await (
    await worker.fetch(new Request(`${ORIGIN}/api/rtc/ice`, { headers: { authorization: `Bearer ${token}` } }), env)
  ).json()) as { ice_servers: unknown[] };
  assert.ok(Array.isArray(ice.ice_servers) && ice.ice_servers.length > 0);

  const bad = await worker.fetch(new Request(`${ORIGIN}/api/devices`, { headers: { authorization: "Bearer fvs_nope" } }), env);
  assert.equal(bad.status, 401);
});

test("Worker：文档真的落进 storage，第二个实例读得到", async () => {
  const { env } = fakeEnv();
  const { token } = await signIn(env, "bob");

  // A fresh StoreObject over a namespace that keeps its instances would hide a write that never
  // happened, so this one is built by hand over the storage the first one wrote to. That is what
  // an eviction looks like: the object is gone and only what it stored is left.
  const state = fakeState();
  const first = new StoreObject(state, env);
  await first.fetch(new Request(`${ORIGIN}/api/hello`));
  const signedIn = await (async () => {
    const { createHash, randomBytes } = await import("node:crypto");
    const verifier = randomBytes(32).toString("base64url");
    const form = new URLSearchParams({
      client_id: "pinext-desktop",
      redirect_uri: REDIRECT,
      state: "s",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      decision: "allow",
      dev_login: "1",
      dev_account: "bob",
    });
    const decision = await first.fetch(new Request(`${ORIGIN}/authorize/decision`, { method: "POST", body: form }));
    const code = new URL(decision.headers.get("location")!).searchParams.get("code")!;
    return (
      (await (
        await first.fetch(
          new Request(`${ORIGIN}/api/oauth/token`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: "pinext-desktop", redirect_uri: REDIRECT }),
          }),
        )
      ).json()) as { access_token: string }
    ).access_token;
  })();
  assert.match(signedIn, /^fvs_/);

  const second = new StoreObject(state, env);
  const me = await second.fetch(new Request(`${ORIGIN}/api/me`, { headers: { authorization: `Bearer ${token}` } }));
  assert.equal(me.status, 401, "bob's token is not alice's");

  const bob = await second.fetch(new Request(`${ORIGIN}/api/me`, { headers: { authorization: `Bearer ${signedIn}` } }));
  assert.equal(bob.status, 200, "the account survived the object being replaced");
  assert.equal(((await bob.json()) as { user: { login: string } }).user.login, "bob");
});

test("Worker：信令升级被路由到那一个账号的对象，未带令牌则拦在门外", async () => {
  const { env, asked } = fakeEnv();
  const { token, accountId } = await signIn(env, "carol");
  asked.length = 0;

  const refused = await worker.fetch(
    new Request(`${ORIGIN}/api/rtc/signal`, { headers: { Upgrade: "websocket" } }),
    env,
  );
  assert.equal(refused.status, 401);
  // `.length` rather than `assert.deepEqual(asked, [])`: Node's assertion types declare
  // `asserts actual is T`, so comparing against `[]` narrows `asked` to `never[]` for the rest
  // of the test.
  assert.equal(asked.length, 0, "a request with no token should not reach any object");

  // The upgrade itself cannot be *answered* in Node: `WebSocketPair` is a workerd global and
  // `new Response(null, { status: 101 })` is rejected outright by the fetch spec's 200-599 rule.
  // So the object is expected to get as far as building the response and fail there — and the
  // test holds it to that by checking *why* it failed. A throw from anywhere earlier would be a
  // real defect wearing the same shape.
  withWebSocketPairGlobal(() => undefined);
  let failure: unknown = null;
  try {
    await worker.fetch(
      new Request(`${ORIGIN}/api/rtc/signal`, { headers: { Upgrade: "websocket", authorization: `Bearer ${token}` } }),
      env,
    );
  } catch (error) {
    failure = error;
  }
  assert.ok(
    asked.includes(accountId),
    `expected the signaling object for ${accountId}, got ${asked.join(", ") || "none"}`,
  );
  assert.ok(failure instanceof Error, "the upgrade cannot complete in Node and should have thrown");
  assert.match(failure.message, /status|101|Invalid|WebSocket/i, `unexpected failure: ${failure.message}`);
});

/**
 * The one workerd global the objects touch, for the length of one call.
 *
 * `server.accept()` is a no-op here — there is nothing on the other end, and what is under test
 * is which object was handed the request, not the socket it would have built.
 */
function withWebSocketPairGlobal(accept: () => void): void {
  const globals = globalThis as unknown as { WebSocketPair?: unknown };
  globals.WebSocketPair = function WebSocketPair(this: unknown) {
    return [
      { accept: () => undefined, addEventListener: () => undefined, close: () => undefined, send: () => undefined },
      { accept, addEventListener: () => undefined, close: () => undefined, send: () => undefined },
    ];
  };
}
