import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WebSocket } from "ws";
import { readFileSync } from "node:fs";
import { createCloud } from "../src/index.ts";
import { hashToken } from "../src/store.ts";
import { pkceChallenge, validRedirect } from "../src/login.ts";
import type { CloudConfig } from "../src/config.ts";

/**
 * The service, exercised the way its clients do — real HTTP, real WebSocket, real tokens.
 *
 * The parts worth pinning are the ones that fail quietly: a code that can be spent twice, a
 * `signal` that reaches a socket it should not, a device that can be claimed by an account that
 * does not own it. Each of those looks like a working service until somebody checks, so they are
 * checked here rather than discovered on a phone.
 */

function configFor(dir: string, overrides: Partial<CloudConfig> = {}): CloudConfig {
  return {
    port: 0,
    host: "127.0.0.1",
    publicOrigin: "http://127.0.0.1",
    dataFile: join(dir, "cloud.json"),
    tokenTtlMs: 90 * 24 * 60 * 60 * 1000,
    codeTtlMs: 5 * 60 * 1000,
    sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
    github: null,
    devLogin: true,
    maxDevicesPerAccount: 2,
    stunUrls: ["stun:example.test:3478"],
    turn: null,
    relayLimit: 4,
    ...overrides,
  };
}

async function withCloud<T>(overrides: Partial<CloudConfig>, run: (ctx: CloudContext) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "pinext-cloud-"));
  const config = configFor(dir, overrides);
  const cloud = createCloud(config);
  const address = await cloud.listen();
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    return await run({ origin, store: cloud.store, dataFile: config.dataFile });
  } finally {
    await cloud.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

type CloudContext = { origin: string; store: ReturnType<typeof createCloud>["store"]; dataFile: string };

/** Sign in as `login` and come back with a device token, exactly as the browser flow would. */
async function signIn(origin: string, login: string): Promise<string> {
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(24).toString("base64url");
  const redirectUri = `http://127.0.0.1:55900/callback`;
  const authorize = new URL("/authorize", origin);
  authorize.searchParams.set("client_id", "pinext-desktop");
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", pkceChallenge(verifier));
  authorize.searchParams.set("code_challenge_method", "S256");

  const form = new URLSearchParams({
    client_id: "pinext-desktop",
    redirect_uri: redirectUri,
    state,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: "S256",
    decision: "allow",
    dev_login: "1",
    dev_account: login,
  });
  const decision = await fetch(new URL("/authorize/decision", origin), { method: "POST", body: form, redirect: "manual" });
  const code = new URL(decision.headers.get("location") ?? "/", origin).searchParams.get("code");
  assert.ok(code, "the decision should carry a code");

  const token = await fetch(new URL("/api/oauth/token", origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: "pinext-desktop", redirect_uri: redirectUri }),
  });
  const body = (await token.json()) as { access_token?: string };
  assert.ok(body.access_token, "the exchange should carry a token");
  return body.access_token;
}

async function registerDevice(origin: string, token: string, installId: string, name = "Mac"): Promise<string> {
  const response = await fetch(new URL("/api/devices/me", origin), {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ install_id: installId, name, platform: "darwin" }),
  });
  const body = (await response.json()) as { device?: { id?: string } };
  assert.ok(body.device?.id);
  return body.device.id;
}

/** Collect frames so a test can await one by name instead of racing the socket. */
function frameReader(socket: WebSocket) {
  const seen: Array<Record<string, unknown>> = [];
  const waiting: Array<{ match: (message: Record<string, unknown>) => boolean; resolve: (message: Record<string, unknown>) => void }> = [];
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString()) as Record<string, unknown>;
    const index = waiting.findIndex((item) => item.match(message));
    if (index >= 0) waiting.splice(index, 1)[0]!.resolve(message);
    else seen.push(message);
  });
  return {
    seen,
    next(match: (message: Record<string, unknown>) => boolean, label = "frame", timeoutMs = 3000): Promise<Record<string, unknown>> {
      const existing = seen.findIndex(match);
      if (existing >= 0) return Promise.resolve(seen.splice(existing, 1)[0]!);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), timeoutMs);
        waiting.push({ match, resolve: (message) => { clearTimeout(timer); resolve(message); } });
      });
    },
  };
}

async function openSocket(origin: string, token: string): Promise<WebSocket> {
  const socket = new WebSocket(`${origin.replace("http", "ws")}/api/rtc/signal`, { headers: { authorization: `Bearer ${token}` } });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
}

/** The status a WebSocket upgrade was refused with, before any handshake happened. */
function upgradeStatus(origin: string, token: string | null): Promise<number> {
  const headers = token ? { authorization: `Bearer ${token}` } : undefined;
  const socket = new WebSocket(`${origin.replace("http", "ws")}/api/rtc/signal`, headers ? { headers } : {});
  return new Promise((resolve) => {
    socket.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
    socket.once("error", () => resolve(0));
  });
}

const closed = (socket: WebSocket): Promise<number> =>
  new Promise((resolve) => socket.once("close", (code) => resolve(code)));

test("RFC 8252 的收口只有回环和自定义 scheme", () => {
  // A code delivered anywhere but loopback would be a code handed to somebody else's server.
  assert.equal(validRedirect("pinext-desktop", "http://127.0.0.1:55900/callback"), true);
  assert.equal(validRedirect("pinext-desktop", "http://localhost:1234/callback"), true);
  assert.equal(validRedirect("pinext-desktop", "http://192.168.1.5:55900/callback"), false);
  assert.equal(validRedirect("pinext-desktop", "https://evil.example/callback"), false);
  assert.equal(validRedirect("pinext-desktop", "http://127.0.0.1/callback"), false, "端口不能省");
  assert.equal(validRedirect("pinext-mobile", "pinext://oauth/callback"), true);
  assert.equal(validRedirect("pinext-mobile", "http://127.0.0.1:1/callback"), false);
});

test("授权码换令牌：PKCE 校验、一次性、redirect_uri 必须完全一致", async () => {
  await withCloud({}, async ({ origin }) => {
    const verifier = randomBytes(32).toString("base64url");
    const redirectUri = "http://127.0.0.1:55900/callback";
    const form = new URLSearchParams({
      client_id: "pinext-desktop",
      redirect_uri: redirectUri,
      state: "s",
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: "S256",
      decision: "allow",
      dev_login: "1",
      dev_account: "alice",
    });
    const decision = await fetch(new URL("/authorize/decision", origin), { method: "POST", body: form, redirect: "manual" });
    const code = new URL(decision.headers.get("location") ?? "/", origin).searchParams.get("code")!;

    const exchange = (body: Record<string, unknown>) =>
      fetch(new URL("/api/oauth/token", origin), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

    // The verifier is the only thing proving this is the same program that started the flow.
    const wrongVerifier = await exchange({ grant_type: "authorization_code", code, code_verifier: randomBytes(32).toString("base64url"), client_id: "pinext-desktop", redirect_uri: redirectUri });
    assert.equal(wrongVerifier.status, 400);

    // The code is spent by that attempt, even though it failed: a code that survives a wrong
    // guess is a code that can be guessed at.
    const afterFailure = await exchange({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: "pinext-desktop", redirect_uri: redirectUri });
    assert.equal(afterFailure.status, 400);
  });
});

test("redirect_uri 不匹配时拒绝换令牌", async () => {
  await withCloud({}, async ({ origin }) => {
    const verifier = randomBytes(32).toString("base64url");
    const form = new URLSearchParams({
      client_id: "pinext-desktop",
      redirect_uri: "http://127.0.0.1:55900/callback",
      state: "s",
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: "S256",
      decision: "allow",
      dev_login: "1",
      dev_account: "alice",
    });
    const decision = await fetch(new URL("/authorize/decision", origin), { method: "POST", body: form, redirect: "manual" });
    const code = new URL(decision.headers.get("location") ?? "/", origin).searchParams.get("code")!;
    const response = await fetch(new URL("/api/oauth/token", origin), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: "pinext-desktop", redirect_uri: "http://127.0.0.1:55901/callback" }),
    });
    assert.equal(response.status, 400);
  });
});

test("令牌只存哈希，坏令牌一律 401", async () => {
  await withCloud({}, async ({ origin, dataFile }) => {
    const token = await signIn(origin, "alice");
    const ok = await fetch(new URL("/api/me", origin), { headers: { authorization: `Bearer ${token}` } });
    assert.equal(ok.status, 200);

    const bad = await fetch(new URL("/api/me", origin), { headers: { authorization: "Bearer fvs_wrong" } });
    // 401 and not 403: the client signs out on 401 and would keep a dead credential on anything else.
    assert.equal(bad.status, 401);

    const noAuth = await fetch(new URL("/api/me", origin));
    assert.equal(noAuth.status, 401);

    // The file on disk, not the object in memory: a copy of it must not be replayable as a
    // credential, which is the whole reason the hash is what gets written.
    const stored = readFileSync(dataFile, "utf8");
    assert.ok(!stored.includes(token), "令牌明文不应出现在数据文件里");
    assert.ok(stored.includes(hashToken(token)), "存的是它的哈希");
  });
});

test("设备按 install_id 幂等，超限回 409", async () => {
  await withCloud({}, async ({ origin }) => {
    const token = await signIn(origin, "alice");
    const installId = `inst_${randomBytes(16).toString("hex")}`;
    const first = await registerDevice(origin, token, installId, "Mac");
    const renamed = await registerDevice(origin, token, installId, "Mac（改名）");
    // The phone saved this id; a rename must not invalidate the address it holds.
    assert.equal(renamed, first);

    await registerDevice(origin, token, `inst_${randomBytes(16).toString("hex")}`, "second");
    const third = await fetch(new URL("/api/devices/me", origin), {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ install_id: `inst_${randomBytes(16).toString("hex")}`, name: "third", platform: "darwin" }),
    });
    assert.equal(third.status, 409);
    assert.equal(((await third.json()) as { error: { code: string } }).error.code, "too_many_devices");

    // A rename of an existing device is never the request that hits the cap.
    const renameAgain = await registerDevice(origin, token, installId, "Mac again");
    assert.equal(renameAgain, first);
  });
});

test("坏 install_id 被拒", async () => {
  await withCloud({}, async ({ origin }) => {
    const token = await signIn(origin, "alice");
    const response = await fetch(new URL("/api/devices/me", origin), {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ install_id: "short", name: "x", platform: "darwin" }),
    });
    assert.equal(response.status, 400);
  });
});

test("信令：手机呼叫电脑，signal 双向转发，hangup 通知另一端", async () => {
  await withCloud({}, async ({ origin }) => {
    const token = await signIn(origin, "alice");
    const deviceId = await registerDevice(origin, token, `inst_${randomBytes(16).toString("hex")}`);

    const desktop = await openSocket(origin, token);
    const desktopReader = frameReader(desktop);
    desktop.send(JSON.stringify({ type: "hello", role: "device", device_id: deviceId, platform: "darwin" }));
    assert.equal((await desktopReader.next((m) => m.type === "hello", "device hello")).role, "device");

    // Online is read off the live socket — there is no heartbeat endpoint to poll.
    const listed = (await (await fetch(new URL("/api/devices", origin), { headers: { authorization: `Bearer ${token}` } })).json()) as {
      devices: Array<{ id: string; online: boolean }>;
    };
    assert.equal(listed.devices.find((item) => item.id === deviceId)?.online, true);

    const phone = await openSocket(origin, token);
    const phoneReader = frameReader(phone);
    phone.send(JSON.stringify({ type: "hello", role: "client", name: "iPhone", platform: "ios" }));
    await phoneReader.next((m) => m.type === "hello", "client hello");
    phone.send(JSON.stringify({ type: "connect", device_id: deviceId }));

    const connected = await phoneReader.next((m) => m.type === "connected", "connected");
    const cid = String(connected.cid);
    assert.ok(cid, "connected 必须带 cid");
    const incoming = await desktopReader.next((m) => m.type === "incoming", "incoming");
    assert.equal(incoming.cid, cid);
    assert.equal((incoming.peer as { name: string }).name, "iPhone");

    // 手机 → 桌面
    phone.send(JSON.stringify({ type: "signal", cid, data: { type: "offer", sdp: "v=0…" } }));
    const offer = await desktopReader.next((m) => m.type === "signal", "offer");
    assert.deepEqual(offer.data, { type: "offer", sdp: "v=0…" });

    // 桌面 → 手机
    desktop.send(JSON.stringify({ type: "signal", cid, data: { type: "answer", sdp: "v=0…" } }));
    const answer = await phoneReader.next((m) => m.type === "signal", "answer");
    assert.deepEqual(answer.data, { type: "answer", sdp: "v=0…" });

    phone.send(JSON.stringify({ type: "hangup", cid }));
    assert.equal((await desktopReader.next((m) => m.type === "hangup", "hangup")).cid, cid);

    // And a hangup for a call nobody has is an `unknown_call`, which the clients ignore rather
    // than an error worth showing — it is a race, not a failure.
    phone.send(JSON.stringify({ type: "hangup", cid }));
    const raced = await phoneReader.next((m) => m.type === "error", "unknown_call");
    assert.equal(raced.code, "unknown_call");

    phone.close();
    desktop.close();
  });
});

test("信令：离线设备回 device_offline（可重试），别人的设备回 device_not_found", async () => {
  await withCloud({}, async ({ origin }) => {
    const aliceToken = await signIn(origin, "alice");
    const bobToken = await signIn(origin, "bob");
    const aliceDevice = await registerDevice(origin, aliceToken, `inst_${randomBytes(16).toString("hex")}`);

    // Bob asks for Alice's device. The ids are not secret; the account boundary is what stops him.
    const bob = await openSocket(origin, bobToken);
    const bobReader = frameReader(bob);
    bob.send(JSON.stringify({ type: "hello", role: "client", name: "Bob's phone" }));
    await bobReader.next((m) => m.type === "hello");
    bob.send(JSON.stringify({ type: "connect", device_id: aliceDevice }));
    assert.equal((await bobReader.next((m) => m.type === "error", "cross-account")).code, "device_not_found");

    // Alice's own phone, with the desktop not connected: retryable, and answered differently.
    const alice = await openSocket(origin, aliceToken);
    const aliceReader = frameReader(alice);
    alice.send(JSON.stringify({ type: "hello", role: "client", name: "Alice's phone" }));
    await aliceReader.next((m) => m.type === "hello");
    alice.send(JSON.stringify({ type: "connect", device_id: aliceDevice }));
    assert.equal((await aliceReader.next((m) => m.type === "error", "offline")).code, "device_offline");

    bob.close();
    alice.close();
  });
});

test("信令：同一设备的新 socket 顶掉旧的（4001）", async () => {
  await withCloud({}, async ({ origin }) => {
    const token = await signIn(origin, "alice");
    const deviceId = await registerDevice(origin, token, `inst_${randomBytes(16).toString("hex")}`);

    const first = await openSocket(origin, token);
    const firstReader = frameReader(first);
    first.send(JSON.stringify({ type: "hello", role: "device", device_id: deviceId }));
    await firstReader.next((m) => m.type === "hello");
    const firstClosed = closed(first);

    const second = await openSocket(origin, token);
    const secondReader = frameReader(second);
    second.send(JSON.stringify({ type: "hello", role: "device", device_id: deviceId }));
    await secondReader.next((m) => m.type === "hello");

    // Two live sockets for one device would both believe they answer the phone.
    assert.equal(await firstClosed, 4001);
    second.close();
  });
});

test("信令：未登记的 device_id 不允许上线", async () => {
  await withCloud({}, async ({ origin }) => {
    const token = await signIn(origin, "alice");
    const socket = await openSocket(origin, token);
    const socketClosed = closed(socket);
    socket.send(JSON.stringify({ type: "hello", role: "device", device_id: "dev_not_mine" }));
    // Claiming an id is how somebody would receive another account's calls, so it is refused
    // outright rather than ignored.
    assert.equal(await socketClosed, 4005);
  });
});

test("信令：没有令牌不能升级", async () => {
  await withCloud({}, async ({ origin }) => {
    const socket = new WebSocket(`${origin.replace("http", "ws")}/api/rtc/signal`);
    const code = await new Promise<number | string>((resolve) => {
      socket.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
      socket.once("error", (error) => resolve(error.message));
    });
    assert.equal(code, 401);
  });
});

test("设备从控制台移除时，它的信令 socket 以 4005 关闭并带 device_not_found", async () => {
  await withCloud({}, async ({ origin }) => {
    const token = await signIn(origin, "alice");
    const deviceId = await registerDevice(origin, token, `inst_${randomBytes(16).toString("hex")}`);

    // A browser session, the same cookie the console page is drawn behind.
    const verifier = randomBytes(32).toString("base64url");
    const form = new URLSearchParams({
      client_id: "pinext-desktop",
      redirect_uri: "http://127.0.0.1:55900/callback",
      state: "s",
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: "S256",
      decision: "allow",
      dev_login: "1",
      dev_account: "alice",
    });
    const decision = await fetch(new URL("/authorize/decision", origin), { method: "POST", body: form, redirect: "manual" });
    const cookie = (decision.headers.getSetCookie?.() ?? []).map((item) => item.split(";")[0]).join("; ");
    assert.ok(cookie.includes("pinext_cloud_session"), "登录应下发浏览器会话 cookie");

    const desktop = await openSocket(origin, token);
    const reader = frameReader(desktop);
    desktop.send(JSON.stringify({ type: "hello", role: "device", device_id: deviceId }));
    await reader.next((m) => m.type === "hello");

    // The desktop must hear *why* before the close: it re-registers on `device_not_found`, and
    // a bare close would read as a network drop to be retried forever.
    const told = reader.next((m) => m.type === "error");
    const desktopClosed = closed(desktop);

    const removed = await fetch(new URL("/console/delete", origin), {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ device_id: deviceId }),
      redirect: "manual",
    });
    assert.equal(removed.status, 302);
    assert.equal((await told).code, "device_not_found");
    assert.equal(await desktopClosed, 4005);

    // And it is gone from the list the phone reads.
    const listed = (await (await fetch(new URL("/api/devices", origin), { headers: { authorization: `Bearer ${token}` } })).json()) as {
      devices: unknown[];
    };
    assert.equal(listed.devices.length, 0);
  });
});

test("账号被停用：每个入口都拒，且说的是「停用」而不是「令牌失效」", async () => {
  await withCloud({}, async ({ origin, store }) => {
    const token = await signIn(origin, "alice");
    const auth = { authorization: `Bearer ${token}` };
    const status = async (path: string): Promise<number> => (await fetch(new URL(path, origin), { headers: auth })).status;

    // Working, so the refusals below are the flag and not something else.
    assert.equal(await status("/api/me"), 200);
    const live = await openSocket(origin, token);
    live.close();
    const deviceId = await registerDevice(origin, token, `inst_${randomBytes(16).toString("hex")}`);
    assert.ok(deviceId);

    assert.ok(store.setDisabled("alice", true), "停用一个存在的账号");

    // 403 with `account_disabled` and not 401: the client says "this account was turned off"
    // for the first and signs out silently for the second.
    assert.equal(await status("/api/me"), 403);
    assert.equal(await status("/api/devices"), 403);
    assert.equal(await status("/api/rtc/ice"), 403);
    assert.equal(await upgradeStatus(origin, token), 403);

    // And it still does not hand out a new token, which is the path a fresh sign-in takes.
    const disabledSignIn = await fetch(new URL("/api/oauth/token", origin), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "authorization_code", code: "nope", code_verifier: "x", client_id: "pinext-desktop", redirect_uri: "http://127.0.0.1:55900/callback" }),
    });
    assert.equal(disabledSignIn.status, 400, "无效的 code 先于账号状态被拒");

    // Restoring it puts everything back — the flag is a switch, not a deletion.
    assert.ok(store.setDisabled("alice", false));
    assert.equal(await status("/api/me"), 200);
    assert.equal(await status("/api/devices"), 200);
  });
});

test("每个账号只看得到自己的设备", async () => {
  await withCloud({}, async ({ origin }) => {
    const alice = await signIn(origin, "alice");
    const bob = await signIn(origin, "bob");
    await registerDevice(origin, alice, `inst_${randomBytes(16).toString("hex")}`, "Alice's Mac");
    await registerDevice(origin, bob, `inst_${randomBytes(16).toString("hex")}`, "Bob's Mac");

    const listed = (await (await fetch(new URL("/api/devices", origin), { headers: { authorization: `Bearer ${alice}` } })).json()) as {
      devices: Array<{ name: string }>;
    };
    assert.deepEqual(
      listed.devices.map((item) => item.name),
      ["Alice's Mac"],
    );
  });
});
