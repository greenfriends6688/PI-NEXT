// fork:lan-access —— proxy.ts 这条接线本身（cookie 种植 + 状态码 + 形态）。
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


// 见 lib/lan-access.test.mjs 同处注释：闸门会回落到用户真实的 lan-access.json，
// 这里必须指向空目录，「没设令牌」才是真的没设。
process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-web-proxy-lan-test-"));

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  // proxy.ts 用的是 Next 的 `@/` 路径别名，jiti 不会自己认。
  alias: { "@": new URL("..", import.meta.url).pathname },
});
const { proxy } = await jiti.import("../proxy.ts");

function makeRequest(path, { url, method = "GET", headers = {} } = {}) {
  const target = new URL(url);
  return {
    // proxy.ts 读到的就这三样：`nextUrl.pathname` / `headers` / `url`(+`method` 给 LAN 闸门)。
    nextUrl: { pathname: path },
    url: target.href,
    method,
    headers: new Headers({ host: target.host, ...headers }),
  };
}

test("没设 PI_WEB_LAN_TOKEN 时，proxy 一行都不多拦", () => {
  const before = process.env.PI_WEB_LAN_TOKEN;
  delete process.env.PI_WEB_LAN_TOKEN;
  try {
    const response = proxy(makeRequest("/api/sessions", {
      url: "http://172.20.10.12:30141/api/sessions",
      headers: { origin: "http://172.20.10.12:30141", "sec-fetch-site": "same-origin" },
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("set-cookie"), null);
  } finally {
    if (before === undefined) delete process.env.PI_WEB_LAN_TOKEN;
    else process.env.PI_WEB_LAN_TOKEN = before;
  }
});

test("设了令牌：局域网未出示 → 401（API 是 JSON，页面是纯文本）", () => {
  const before = process.env.PI_WEB_LAN_TOKEN;
  process.env.PI_WEB_LAN_TOKEN = "tok";
  try {
    const api = proxy(makeRequest("/api/sessions", {
      url: "http://172.20.10.12:30141/api/sessions",
      headers: { origin: "http://172.20.10.12:30141", "sec-fetch-site": "same-origin" },
    }));
    assert.equal(api.status, 401);
    assert.match(api.headers.get("content-type") ?? "", /application\/json/);

    const page = proxy(makeRequest("/", {
      url: "http://172.20.10.12:30141/",
      headers: { origin: "http://172.20.10.12:30141", "sec-fetch-site": "same-origin" },
    }));
    assert.equal(page.status, 401);
    assert.match(page.headers.get("content-type") ?? "", /text\/plain/);
  } finally {
    if (before === undefined) delete process.env.PI_WEB_LAN_TOKEN;
    else process.env.PI_WEB_LAN_TOKEN = before;
  }
});

test("设了令牌：?t= 进来 → 种 httpOnly cookie 后放行", () => {
  const before = process.env.PI_WEB_LAN_TOKEN;
  process.env.PI_WEB_LAN_TOKEN = "tok";
  try {
    const response = proxy(makeRequest("/", {
      url: "http://172.20.10.12:30141/?t=tok",
      headers: { origin: "http://172.20.10.12:30141", "sec-fetch-site": "same-origin" },
    }));
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie") ?? "";
    assert.match(cookie, /pi-web-lan=tok/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=lax/i);
    assert.doesNotMatch(cookie, /Secure/i);
  } finally {
    if (before === undefined) delete process.env.PI_WEB_LAN_TOKEN;
    else process.env.PI_WEB_LAN_TOKEN = before;
  }
});

test("本机请求在设了令牌时也不受影响", () => {
  const before = process.env.PI_WEB_LAN_TOKEN;
  process.env.PI_WEB_LAN_TOKEN = "tok";
  try {
    const response = proxy(makeRequest("/api/sessions", {
      url: "http://127.0.0.1:30141/api/sessions",
      headers: { origin: "http://127.0.0.1:30141", "sec-fetch-site": "same-origin" },
    }));
    assert.equal(response.status, 200);
  } finally {
    if (before === undefined) delete process.env.PI_WEB_LAN_TOKEN;
    else process.env.PI_WEB_LAN_TOKEN = before;
  }
});
