// fork:lan-access 2 —— 两条配对路由的形状（NextResponse 在裸 node 下可用）。
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

/**
 * fork:lan-access —— 令牌现在住在 `~/.pi/agent/lan-access.json` 里，所以**每个测试都必须
 * 指向临时 agent 目录**：否则「没有令牌」这条前提会被开发者自己机器上的真实配置满足掉
 * （这条就是被真实配置坑出来的：配置一存在，默认行为的断言全红）。
 */
const REAL_AGENT_DIR = process.env.PI_CODING_AGENT_DIR;
const TEMP_AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-web-lan-test-"));
process.env.PI_CODING_AGENT_DIR = TEMP_AGENT_DIR;
/* 同理：`PI_WEB_HOSTNAME` 是**启动器**给子进程传的（bin/lan-supervisor.cjs 在绑了
   网卡时设成 0.0.0.0）。开发者的 shell / agent 进程里它经常是在的，于是
   「本次运行没绑网卡 → boundLan=false」那条断言会读到真进程的绑定状态而红。
   测试要的是「没设就是没绑」，所以这里显式清掉（原本只清 agent 目录，漏了这一项）。 */
const REAL_HOSTNAME = process.env.PI_WEB_HOSTNAME;
delete process.env.PI_WEB_HOSTNAME;
after(() => {
  if (REAL_AGENT_DIR === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = REAL_AGENT_DIR;
  if (REAL_HOSTNAME === undefined) delete process.env.PI_WEB_HOSTNAME;
  else process.env.PI_WEB_HOSTNAME = REAL_HOSTNAME;
});


const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { "@/": `${new URL("../../../..", import.meta.url).pathname}` },
});
const { POST: generate } = await jiti.import("./generate/route.ts");
const { POST: redeem } = await jiti.import("./redeem/route.ts");

function json(url, body, headers = {}) {
  const target = new URL(url);
  return new Request(url, {
    method: "POST",
    headers: {
      host: target.host,
      "content-type": "application/json",
      origin: target.origin,
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function withAgentDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-lan-route-"));
  const before = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    if (before === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = before;
  }
}

async function withToken(value, fn) {
  const before = process.env.PI_WEB_LAN_TOKEN;
  if (value === undefined) delete process.env.PI_WEB_LAN_TOKEN;
  else process.env.PI_WEB_LAN_TOKEN = value;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.PI_WEB_LAN_TOKEN;
    else process.env.PI_WEB_LAN_TOKEN = before;
  }
}

const LAN = "http://172.20.10.12:30141";

test("fork:lan-access —— 关掉局域网接入时 409，并说清是哪个 code", async () => {
  // 用户点了「停止」→ enabled:false → 没有可发的凭证。界面按 code 渲染文案。
  // （这里必须**显式写一份停用的配置**：现在第一次打开面板会自动生成令牌，
  //  「没令牌」不再等于「没开接入」。）
  await withAgentDir(async (dir) => {
    const { writeFileSync } = await import("node:fs");
    // 令牌形状合法、只是「停了」—— 这样 409 才是「关掉了」而不是「没配」。
    writeFileSync(join(dir, "lan-access.json"), JSON.stringify({ version: 1, token: "a".repeat(48), enabled: false }));
    const response = await withToken(undefined, () =>
      generate(json(`${LAN}/api/lan/pair/generate`, {})));
    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.equal(payload.code, "lan-access-off");
  });
});

test("generate：设了令牌就给 6 位码 + 局域网地址", async () => {
  const response = await withToken("tok", () =>
    generate(json(`${LAN}/api/lan/pair/generate`, {})));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.match(payload.code, /^\d{6}$/);
  assert.equal(payload.readOnly, false);
  assert.equal(payload.expiresInSeconds, 600);
  assert.ok(Array.isArray(payload.lanUrls));
});

test("fork:lan-access —— 令牌在但这次运行还没绑网卡：照样给码，并带上 needsRebind", async () => {
  const response = await withToken("tok", () =>
    generate(json(`${LAN}/api/lan/pair/generate`, {})));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.match(payload.code, /^\d{6}$/);
  // PI_WEB_HOSTNAME 没设 → 本次运行没绑网卡 → 界面显示「重启后自动开」。
  assert.equal(payload.boundLan, false);
  assert.equal(typeof payload.needsRebind, "boolean");
});

test("generate：readOnly 走的是另一种类的码", async () => {
  const response = await withToken("tok", () =>
    generate(json(`${LAN}/api/lan/pair/generate`, { readOnly: true })));
  assert.equal((await response.json()).readOnly, true);
});

test("generate：非 JSON / 类型错都是 4xx，不是 500", async () => {
  const badType = await withToken("tok", () =>
    generate(json(`${LAN}/api/lan/pair/generate`, { readOnly: "yes" })));
  assert.equal(badType.status, 400);

  const noType = await withToken("tok", () =>
    generate(new Request(`${LAN}/api/lan/pair/generate`, {
      method: "POST",
      headers: { host: "172.20.10.12:30141" },
    })));
  assert.equal(noType.status, 415);
});

test("generate：跨站请求被同源防护挡住", async () => {
  const response = await withToken("tok", () =>
    generate(json(`${LAN}/api/lan/pair/generate`, {}, { "sec-fetch-site": "cross-site" })));
  assert.equal(response.status, 403);
});

test("redeem：兑码换 cookie，且只放行一次", async () => {
  const minted = await withToken("tok", () =>
    generate(json(`${LAN}/api/lan/pair/generate`, {})));
  const { code } = await minted.json();

  const first = await withToken("tok", () => redeem(json(`${LAN}/api/lan/pair/redeem`, { code })));
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { ok: true, readOnly: false });
  const cookie = first.headers.get("set-cookie") ?? "";
  assert.match(cookie, /pi-web-lan=tok/);
  assert.match(cookie, /HttpOnly/i);

  const second = await withToken("tok", () => redeem(json(`${LAN}/api/lan/pair/redeem`, { code })));
  assert.equal(second.status, 401);
  assert.match((await second.json()).error, /invalid or expired/);
});

test("redeem：只读码换到的是只读令牌", async () => {
  const minted = await withToken("tok", () =>
    generate(json(`${LAN}/api/lan/pair/generate`, { readOnly: true })));
  const { code } = await minted.json();
  const response = await withToken("tok", () => redeem(json(`${LAN}/api/lan/pair/redeem`, { code })));
  assert.deepEqual(await response.json(), { ok: true, readOnly: true });
  // 与 lib/lan-access.ts 的派生一致：cookie 里不是完整令牌。
  assert.doesNotMatch(response.headers.get("set-cookie") ?? "", /pi-web-lan=tok;/);
});

test("redeem：换掉令牌后，在飞的码换出来的就是新令牌", async () => {
  const minted = await withToken("old", () =>
    generate(json(`${LAN}/api/lan/pair/generate`, {})));
  const { code } = await minted.json();
  const response = await withToken("new", () => redeem(json(`${LAN}/api/lan/pair/redeem`, { code })));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie") ?? "", /pi-web-lan=new/);
});

test("redeem：畸形输入不 500", async () => {
  for (const body of [{}, { code: 123 }, { code: null }]) {
    const response = await withToken("tok", () => redeem(json(`${LAN}/api/lan/pair/redeem`, body)));
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  const noType = await withToken("tok", () =>
    redeem(new Request(`${LAN}/api/lan/pair/redeem`, {
      method: "POST",
      headers: { host: "172.20.10.12:30141" },
    })));
  assert.equal(noType.status, 415);
});

test("redeem：失败太多次就 429（6 位数字不能被当成 oracle 慢慢爆破）", async () => {
  const limiter = (await jiti.import("@/lib/lan-pair.ts")).pairAttemptLimiter();
  limiter.reset("10.0.0.7");
  let status = 200;
  await withToken("tok", async () => {
    for (let i = 0; i < 32; i++) {
      const response = await redeem(json(`${LAN}/api/lan/pair/redeem`, { code: "000000" }, {
        "x-forwarded-for": "10.0.0.7",
      }));
      status = response.status;
      if (response.status === 429) {
        assert.equal(response.headers.get("retry-after"), "300");
        break;
      }
      assert.equal(response.status, 401);
    }
  });
  assert.equal(status, 429);
  limiter.reset("10.0.0.7");
});

test("redeem：兑成功会把该来源的失败计数清零", async () => {
  const limiter = (await jiti.import("@/lib/lan-pair.ts")).pairAttemptLimiter();
  const forwarded = { "x-forwarded-for": "10.0.0.8" };
  limiter.reset("10.0.0.8");
  await withToken("tok", async () => {
    await redeem(json(`${LAN}/api/lan/pair/redeem`, { code: "111111" }, forwarded));
    assert.ok(limiter.remaining("10.0.0.8") < 30);
    const minted = await generate(json(`${LAN}/api/lan/pair/generate`, {}, forwarded));
    const { code } = await minted.json();
    assert.equal((await redeem(json(`${LAN}/api/lan/pair/redeem`, { code }, forwarded))).status, 200);
  });
  assert.equal(limiter.remaining("10.0.0.8"), 30);
  limiter.reset("10.0.0.8");
});
