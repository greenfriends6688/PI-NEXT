import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  LanPairCodes,
  PairAttemptLimiter,
  attemptKey,
} = await jiti.import("./lan-pair.ts");
const {
  checkLanAccess,
  deriveReadOnlyToken,
  isLoopbackRequest,
  lanCookieSecure,
} = await jiti.import("./lan-access.ts");

const TOKEN = "a".repeat(48);

function request(url, init = {}) {
  return new Request(url, init);
}

test("a pair code is spent once and expires", () => {
  const codes = new LanPairCodes();
  const pair = codes.mint("full", 1000);
  assert.equal(pair.code.length, 6);
  assert.equal(codes.spend(pair.code, 2000), "full");
  assert.equal(codes.spend(pair.code, 2000), null, "the second use gets nothing");
  const late = codes.mint("readonly", 1000);
  assert.equal(codes.spend(late.code, 1000 + 10 * 60 * 1000 + 1), null, "expired");
});

test("the attempt limiter refuses after 30 failures and resets", () => {
  const limiter = new PairAttemptLimiter();
  for (let i = 0; i < 30; i++) limiter.record("ip");
  assert.equal(limiter.remaining("ip"), 0);
  limiter.reset("ip");
  assert.equal(limiter.remaining("ip"), 30);
});

test("the first x-forwarded-for hop names the client", () => {
  assert.equal(attemptKey(request("http://lan/", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } })), "1.2.3.4");
  assert.equal(attemptKey(request("http://lan/")), "unknown");
});

test("only a loopback Host counts as this machine", () => {
  assert.equal(isLoopbackRequest(request("http://127.0.0.1:30142/", { headers: { host: "127.0.0.1:30142" } })), true);
  assert.equal(isLoopbackRequest(request("http://localhost:30142/", { headers: { host: "localhost:30142" } })), true);
  assert.equal(isLoopbackRequest(request("http://192.168.1.5:30142/", { headers: { host: "192.168.1.5:30142" } })), false);
});

test("the cookie is Secure only behind an https relay", () => {
  const plain = request("http://lan/");
  assert.equal(lanCookieSecure(plain), false);
  const relayed = request("http://lan/", { headers: { "x-forwarded-proto": "https,http" } });
  assert.equal(lanCookieSecure(relayed), true);
});

test("without a token every request passes, unchanged", () => {
  const decision = checkLanAccess(
    request("http://lan/api/sessions", { headers: { host: "192.168.1.5" } }),
    {},
    () => undefined,
  );
  assert.deepEqual(decision, { ok: true, readOnly: false });
});

test("with a token a LAN request needs it; loopback never does", () => {
  const env = { PI_WEB_LAN_TOKEN: TOKEN };
  const lan = request("http://lan/api/sessions", { headers: { host: "192.168.1.5:30142" } });
  assert.equal(checkLanAccess(lan, env).ok, false);

  const local = request("http://127.0.0.1:30142/api/sessions", { headers: { host: "127.0.0.1:30142" } });
  assert.deepEqual(checkLanAccess(local, env), { ok: true, readOnly: false });

  const withHeader = request("http://lan/api/sessions", {
    headers: { host: "192.168.1.5:30142", authorization: `Bearer ${TOKEN}` },
  });
  assert.deepEqual(checkLanAccess(withHeader, env), { ok: true, readOnly: false });

  const withCookie = request("http://lan/api/sessions", {
    headers: { host: "192.168.1.5:30142", cookie: `pi-web-lan=${TOKEN}` },
  });
  assert.deepEqual(checkLanAccess(withCookie, env), { ok: true, readOnly: false });
});

test("a ?t= token is planted as a cookie; the read-only token may only read", () => {
  const env = { PI_WEB_LAN_TOKEN: TOKEN };
  const viaQuery = request(`http://lan/api/sessions?t=${TOKEN}`, { headers: { host: "192.168.1.5:30142" } });
  assert.deepEqual(checkLanAccess(viaQuery, env), { ok: true, readOnly: false, plantCookie: TOKEN });

  const readOnly = deriveReadOnlyToken(TOKEN);
  const read = request(`http://lan/api/sessions?t=${readOnly}`, { headers: { host: "192.168.1.5:30142" } });
  assert.deepEqual(checkLanAccess(read, env), { ok: true, readOnly: true, plantCookie: readOnly });

  const write = request(`http://lan/api/agent/x?t=${readOnly}`, {
    method: "POST",
    headers: { host: "192.168.1.5:30142" },
  });
  assert.equal(checkLanAccess(write, env).ok, false);
});

test("the pair redeem path is reachable without a token", () => {
  const env = { PI_WEB_LAN_TOKEN: TOKEN };
  const redeem = request("http://lan/api/lan/pair/redeem", {
    method: "POST",
    headers: { host: "192.168.1.5:30142" },
  });
  assert.deepEqual(checkLanAccess(redeem, env), { ok: true, readOnly: false });
});

test("a wrong token is refused", () => {
  const env = { PI_WEB_LAN_TOKEN: TOKEN };
  const wrong = request("http://lan/api/sessions?t=nope", { headers: { host: "192.168.1.5:30142" } });
  const decision = checkLanAccess(wrong, env);
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 401);
});
