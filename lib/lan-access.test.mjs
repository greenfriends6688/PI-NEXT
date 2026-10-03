import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

/**
 * fork:lan-access —— 令牌现在住在 `~/.pi/agent/lan-access.json` 里，所以**每个测试都必须
 * 指向临时 agent 目录**：否则「没有令牌」这条前提会被开发者自己机器上的真实配置满足掉
 * （这条就是被真实配置坑出来的：配置一存在，默认行为的断言全红）。
 */
const REAL_AGENT_DIR = process.env.PI_CODING_AGENT_DIR;
const TEMP_AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-web-lan-test-"));
process.env.PI_CODING_AGENT_DIR = TEMP_AGENT_DIR;
after(() => {
  if (REAL_AGENT_DIR === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = REAL_AGENT_DIR;
});


// fork:lan-access —— 这份测试断言的「没有令牌」必须真的是没有：`readLanToken()` 会回落到
// `~/.pi/agent/lan-access.json`（应用第一次打开面板就会生成它），所以整份测试指向一个空的
// 临时 agent 目录，否则用户开过一次面板之后这里就全红了。
process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-web-lan-test-"));

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
  LAN_COOKIE_NAME,
  checkLanAccess,
  deriveReadOnlyToken,
  presentedLanToken,
  readLanToken,
} = await jiti.import("./lan-access.ts");

const TOKEN = "s3cret-lan-token";
const ENV = { PI_WEB_LAN_TOKEN: TOKEN };
const LAN = "http://172.20.10.12:30141";

function request(url, { method = "GET", headers = {} } = {}) {
  // `host` 在 fetch 规范里是 forbidden header，`new Request()` 不会自动带上，
  // 而闸门读的就是它（下一跳可能重写 Host）。repo 里其它 request-security 测试同样手写。
  const host = new URL(url).host;
  return new Request(url, { method, headers: { host, ...headers } });
}

test("fork:lan-access —— 默认行为不变：没有令牌就一个字都不拦", () => {
  assert.equal(readLanToken({}), undefined);
  assert.equal(readLanToken({ PI_WEB_LAN_TOKEN: "   " }), undefined);
  // 局域网 + 写方法，今天就是放行的（2026-10-03 之前）。
  assert.deepEqual(checkLanAccess(request(`${LAN}/api/files`, { method: "POST" }), {}), {
    ok: true,
    readOnly: false,
  });
});

test("本机请求永远放行，桌面 App 与 npm run prod 不受影响", () => {
  for (const host of ["127.0.0.1:30141", "localhost:30141", "[::1]:30141", "127.5.5.5:30141"]) {
    assert.deepEqual(
      checkLanAccess(request(`http://${host}/api/agent/x`, { method: "POST" }), ENV),
      { ok: true, readOnly: false },
      host,
    );
  }
});

test("0.0.0.0 是通配地址，从别的机器也能连，不能当本机", () => {
  const decision = checkLanAccess(request("http://0.0.0.0:30141/api/x"), ENV);
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 401);
});

test("局域网请求缺令牌或令牌不对都是 401", () => {
  assert.equal(checkLanAccess(request(`${LAN}/api/x`), ENV).status, 401);
  const wrong = checkLanAccess(
    request(`${LAN}/api/x`, { headers: { cookie: `${LAN_COOKIE_NAME}=nope` } }),
    ENV,
  );
  assert.equal(wrong.ok, false);
  assert.equal(wrong.status, 401);
});

test("令牌三处都能出示，Authorization 优先于 cookie", () => {
  assert.deepEqual(
    checkLanAccess(
      request(`${LAN}/api/x`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } }),
      ENV,
    ),
    { ok: true, readOnly: false },
  );
  assert.deepEqual(
    checkLanAccess(request(`${LAN}/api/x`, { headers: { cookie: `${LAN_COOKIE_NAME}=${TOKEN}` } }), ENV),
    { ok: true, readOnly: false },
  );
  const bearerWins = presentedLanToken(
    request(`${LAN}/api/x`, {
      headers: { authorization: `Bearer ${TOKEN}`, cookie: `${LAN_COOKIE_NAME}=wrong` },
    }),
  );
  assert.equal(bearerWins.value, TOKEN);
});

test("?t= 是手机配对链接的入口，响应要顺手种 cookie", () => {
  const decision = checkLanAccess(request(`${LAN}/?t=${TOKEN}`), ENV);
  assert.deepEqual(decision, { ok: true, readOnly: false, plantCookie: TOKEN });
});

test("cookie 表里的其它 cookie 不影响取值", () => {
  const presented = presentedLanToken(
    request(`${LAN}/api/x`, {
      headers: { cookie: `theme=dark; ${LAN_COOKIE_NAME}=${TOKEN}; other=1` },
    }),
  );
  assert.equal(presented.value, TOKEN);
});

test("fork:lan-access 3 —— 只读令牌由完整令牌确定性派生，且只放行 GET/HEAD", () => {
  const readOnly = deriveReadOnlyToken(TOKEN);
  assert.equal(readOnly, deriveReadOnlyToken(TOKEN));
  assert.notEqual(readOnly, TOKEN);
  assert.notEqual(readOnly, deriveReadOnlyToken("other-token"));

  assert.deepEqual(
    checkLanAccess(request(`${LAN}/api/sessions`, { headers: { cookie: `${LAN_COOKIE_NAME}=${readOnly}` } }), ENV),
    { ok: true, readOnly: true },
  );
  assert.deepEqual(
    checkLanAccess(
      request(`${LAN}/api/sessions`, { method: "HEAD", headers: { cookie: `${LAN_COOKIE_NAME}=${readOnly}` } }),
      ENV,
    ),
    { ok: true, readOnly: true },
  );
  const write = checkLanAccess(
    request(`${LAN}/api/files`, { method: "POST", headers: { cookie: `${LAN_COOKIE_NAME}=${readOnly}` } }),
    ENV,
  );
  assert.equal(write.ok, false);
  assert.equal(write.status, 403);
});

test("换完整令牌等于同时轮换只读令牌（HMAC 标签是同一个）", () => {
  assert.notEqual(deriveReadOnlyToken(TOKEN), deriveReadOnlyToken(`${TOKEN}-rotated`));
});

test("换令牌时唯一免登录的路径是兑码", () => {
  assert.deepEqual(
    checkLanAccess(
      request("http://172.20.10.12:30141/api/lan/pair/redeem", { method: "POST" }),
      ENV,
    ),
    { ok: true, readOnly: false },
  );
  // 同前缀的别的路由不免。
  assert.equal(
    checkLanAccess(request("http://172.20.10.12:30141/api/lan/pair/generate", { method: "POST" }), ENV).status,
    401,
  );
});
