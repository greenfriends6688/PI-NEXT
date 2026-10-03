// fork:im-bridge —— 路由：掩码视图、整表替换、空 URL 沿用、测试发送。
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { "@/": `${new URL("../../..", import.meta.url).pathname}` },
});
const { GET, POST, PUT } = await jiti.import("./route.ts");
const { readImBridgeConfig } = await jiti.import("@/lib/im-bridge.ts");

const FLESHU_URL = "https://open.feishu.cn/open-apis/bot/v2/hook/secret-token-value";

function request(body, { method = "PUT", url = "http://127.0.0.1:30141/api/im-bridge" } = {}) {
  return new Request(url, {
    method,
    headers: { host: "127.0.0.1:30141", "content-type": "application/json", origin: "http://127.0.0.1:30141", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

async function withAgentDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-im-route-"));
  const before = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = before;
  }
}

test("PUT 存下来，GET 只回 host 与掩码 secret（webhook 是凭证，不能回浏览器）", async () => {
  await withAgentDir(async () => {
    const saved = await PUT(request({
      targets: [{ id: "a", label: "飞书群", provider: "feishu", url: FLESHU_URL, secret: "SEC-secret", enabled: true }],
    }));
    assert.equal(saved.status, 200);
    const payload = await saved.json();
    assert.equal(payload.targets[0].host, "open.feishu.cn");
    assert.equal(payload.targets[0].url, undefined);
    assert.equal(payload.targets[0].secret, "••••••••");
    assert.doesNotMatch(JSON.stringify(payload), /secret-token-value|SEC-secret/);

    const listed = await (await GET()).json();
    assert.deepEqual(listed.targets, payload.targets);
  });
});

test("平台没写就按 URL 认；认不出落 custom（不猜，custom 也能发）", async () => {
  await withAgentDir(async () => {
    const response = await PUT(request({ targets: [{ id: "a", url: "https://oapi.dingtalk.com/robot/send?access_token=t" }] }));
    const payload = await response.json();
    assert.equal(payload.targets[0].provider, "dingtalk");
    assert.equal(payload.targets[0].label, "dingtalk");
  });
});

test("新建一行必须给 URL，否则 400 而不是静默丢掉", async () => {
  await withAgentDir(async () => {
    const response = await PUT(request({ targets: [{ id: "new", label: "空的" }] }));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /http\(s\) url/);
  });
});

test("编辑已保存的一行时 URL 留空 = 沿用已存的那条（设置页不回显它）", async () => {
  await withAgentDir(async () => {
    await PUT(request({ targets: [{ id: "a", label: "飞书群", provider: "feishu", url: FLESHU_URL, secret: "SEC-secret" }] }));
    // 只改名字与开关，URL 与 secret 都不给
    const response = await PUT(request({ targets: [{ id: "a", label: "改了名", provider: "feishu", enabled: false }] }));
    assert.equal(response.status, 200);
    const [stored] = readImBridgeConfig().targets;
    assert.equal(stored.label, "改了名");
    assert.equal(stored.enabled, false);
    assert.equal(stored.url, FLESHU_URL);
    assert.equal(stored.secret, "SEC-secret");
  });
});

test("内容类型与跨站请求都被挡住", async () => {
  await withAgentDir(async () => {
    const noType = await PUT(new Request("http://127.0.0.1:30141/api/im-bridge", {
      method: "PUT",
      headers: { host: "127.0.0.1:30141" },
      body: "{}",
    }));
    assert.equal(noType.status, 415);

    // 出站发送是副作用，不能被任意网页顺手触发：cross-site 一律 403。
    const blocked = await PUT(new Request("http://172.20.10.12:30141/api/im-bridge", {
      method: "PUT",
      headers: { host: "172.20.10.12:30141", "content-type": "application/json", origin: "http://evil.example", "sec-fetch-site": "cross-site" },
      body: JSON.stringify({ targets: [{ url: "https://x.example/h" }] }),
    }));
    assert.equal(blocked.status, 403);
    // 同 host 不同 origin（DNS rebinding 那条路）同样 403。
    const rebound = await PUT(new Request("http://172.20.10.12:30141/api/im-bridge", {
      method: "PUT",
      headers: { host: "172.20.10.12:30141", "content-type": "application/json", origin: "http://evil.example", "sec-fetch-site": "same-origin" },
      body: JSON.stringify({ targets: [{ url: "https://x.example/h" }] }),
    }));
    assert.equal(rebound.status, 403);
  });
});

test("测试发送：id 不存在 404；平台报错 502 并把原因带回去", async () => {
  await withAgentDir(async () => {
    const missing = await POST(request({ id: "nope" }, { method: "POST" }));
    assert.equal(missing.status, 404);

    await PUT(request({ targets: [{ id: "a", provider: "feishu", url: FLESHU_URL }] }));
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 19024, msg: "keyword not matched" }), { status: 200 });
    try {
      const response = await POST(request({ id: "a", text: "hi" }, { method: "POST" }));
      assert.equal(response.status, 502);
      const outcome = await response.json();
      assert.equal(outcome.ok, false);
      assert.match(outcome.detail, /19024/);
    } finally {
      globalThis.fetch = original;
    }
  });
});
