import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// fork:linked-directory — /api/files 的越权 / 过期 realpath 用例（#748）。
// 模块本身的判定见 lib/linked-directory.test.mjs。
// allowed roots 来自会话目录，所以把它指向一个空的临时 agent 目录，不碰用户真数据。
const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-linked-route-")));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = path.join(base, "agent");
fs.mkdirSync(process.env.PI_CODING_AGENT_DIR);

test.after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  fs.rmSync(base, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, POST } = await jiti.import("./[...path]/route.ts");
const { GET: getFileIndex } = await jiti.import("../file-index/route.ts");
const { allowFileRoot } = await jiti.import("../../../lib/allowed-roots.ts");
const { encodeFilePathForApi } = await jiti.import("../../../lib/file-paths.ts");
const { NextRequest } = await jiti.import("next/server");

function request(method, filePath, type, body, contentType = "application/json") {
  const encoded = encodeFilePathForApi(filePath);
  const url = `http://localhost/api/files/${encoded}?type=${type}`;
  const context = { params: Promise.resolve({ path: encoded.split("/").map(decodeURIComponent) }) };
  const handler = method === "GET" ? GET : POST;
  const init = body === undefined
    ? { method, headers: { host: "localhost" } }
    : { method, headers: { host: "localhost", "content-type": contentType }, body: JSON.stringify(body) };
  return handler(new NextRequest(url, init), context);
}

function allowLink(linkPath, target) {
  return request("POST", linkPath, "allow-link", { target });
}

// 一个用链接把别的目录收进来的项目（#748 的形状）：
// hub/linked、hub/second 通向 roots 之外，hub/alias -> hub/inner。
let hubCount = 0;
function createHub(t) {
  const hub = path.join(base, `hub-${++hubCount}`);
  const elsewhere = `${hub}-elsewhere`;
  const second = `${hub}-second`;
  fs.mkdirSync(path.join(hub, "inner"), { recursive: true });
  fs.mkdirSync(elsewhere);
  fs.mkdirSync(second);
  fs.writeFileSync(path.join(hub, "inner", "inner.txt"), "inner");
  fs.writeFileSync(path.join(elsewhere, "linked.txt"), "linked");
  fs.writeFileSync(path.join(second, "second.txt"), "second");
  const dirType = process.platform === "win32" ? "junction" : "dir";
  try {
    fs.symlinkSync(elsewhere, path.join(hub, "linked"), dirType);
    fs.symlinkSync(second, path.join(hub, "second"), dirType);
    fs.symlinkSync(path.join(hub, "inner"), path.join(hub, "alias"), dirType);
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("Creating symbolic links requires additional privileges on this platform");
      return null;
    }
    throw error;
  }
  allowFileRoot(hub);
  return { hub, elsewhere, second };
}

test("列得出一条通向项目之外的链接，但点进去仍然 403", async (t) => {
  const fixture = createHub(t);
  if (!fixture) return;
  const { hub, elsewhere } = fixture;

  const listing = await request("GET", hub, "list");
  assert.equal(listing.status, 200);
  const { entries } = await listing.json();
  const byName = Object.fromEntries(entries.map((entry) => [entry.name, entry]));
  assert.equal(byName.linked.outsideLinkTarget, elsewhere);
  assert.equal(byName.second.outsideLinkTarget, fixture.second);
  assert.equal(byName.alias.outsideLinkTarget, undefined);
  assert.equal(byName.inner.outsideLinkTarget, undefined);

  assert.equal((await request("GET", path.join(hub, "linked"), "list")).status, 403);
  assert.equal((await request("GET", path.join(hub, "linked", "linked.txt"), "read")).status, 403);
});

test("项目内部的链接不需要任何放行", async (t) => {
  const fixture = createHub(t);
  if (!fixture) return;
  const { hub } = fixture;

  const listing = await request("GET", path.join(hub, "alias"), "list");
  assert.equal(listing.status, 200);
  assert.deepEqual((await listing.json()).entries.map((entry) => entry.name), ["inner.txt"]);
  const read = await request("GET", path.join(hub, "alias", "inner.txt"), "read");
  assert.equal(read.status, 200);
  assert.equal((await read.json()).content, "inner");
});

test("显式放行后这一条链接目标才可浏览", async (t) => {
  const fixture = createHub(t);
  if (!fixture) return;
  const { hub, elsewhere, second } = fixture;

  const allowed = await allowLink(path.join(hub, "linked"), elsewhere);
  assert.equal(allowed.status, 200);
  assert.deepEqual(await allowed.json(), { path: elsewhere });

  const listing = await request("GET", path.join(hub, "linked"), "list");
  assert.equal(listing.status, 200);
  assert.deepEqual((await listing.json()).entries.map((entry) => entry.name), ["linked.txt"]);
  const read = await request("GET", path.join(hub, "linked", "linked.txt"), "read");
  assert.equal(read.status, 200);
  assert.equal((await read.json()).content, "linked");

  // 父目录不再把它报成「通向外面」，但**每一条链接仍是一次单独的选择**。
  const { entries } = await (await request("GET", hub, "list")).json();
  const byName = Object.fromEntries(entries.map((entry) => [entry.name, entry]));
  assert.equal(byName.linked.outsideLinkTarget, undefined);
  assert.equal(byName.second.outsideLinkTarget, second);
  assert.equal((await request("GET", path.join(hub, "second"), "list")).status, 403);
});

test("allow-link 拒绝任何不是 roots 内目录链接的东西", async (t) => {
  const fixture = createHub(t);
  if (!fixture) return;
  const { hub, elsewhere } = fixture;

  assert.equal((await allowLink(path.join(hub, "inner"), path.join(hub, "inner"))).status, 400);
  assert.equal((await allowLink(path.join(elsewhere, "linked.txt"), elsewhere)).status, 403);
  assert.equal((await request("GET", path.join(hub, "linked"), "list")).status, 403);
});

test("allow-link 只放行列表里给操作员看过的那一个目标", async (t) => {
  const fixture = createHub(t);
  if (!fixture) return;
  const { hub, elsewhere, second } = fixture;
  const link = path.join(hub, "linked");

  // 不带目标、或用简单请求跳过 CORS 预检的，都拒。
  assert.equal((await request("POST", link, "allow-link", {})).status, 400);
  assert.equal((await request("POST", link, "allow-link", { target: elsewhere }, "text/plain")).status, 415);

  // 列出之后链接被改指到别处 —— 409，让界面提示刷新，而不是授权一个没人看过的目录。
  const changed = await allowLink(link, second);
  assert.equal(changed.status, 409);
  assert.equal((await request("GET", path.join(hub, "second"), "list")).status, 403);
  assert.equal((await request("GET", link, "list")).status, 403);
});

test("穿过另一条未放行链接再放行，403", async (t) => {
  const fixture = createHub(t);
  if (!fixture) return;
  const { hub, elsewhere } = fixture;
  const secret = `${elsewhere}-secret`;
  fs.mkdirSync(secret);
  fs.writeFileSync(path.join(secret, "token.txt"), "secret");
  fs.symlinkSync(secret, path.join(elsewhere, "secret-link"), process.platform === "win32" ? "junction" : "dir");

  // 链接本身坐在 roots 之外（只能经由 hub/linked 到达），所以点它也换不来授权。
  assert.equal((await allowLink(path.join(elsewhere, "secret-link"), secret)).status, 403);
  assert.equal((await request("GET", path.join(hub, "linked", "secret-link"), "list")).status, 403);
});

test("编码分段里的 `..` 爬不出链接", async (t) => {
  const fixture = createHub(t);
  if (!fixture) return;
  const { hub, elsewhere } = fixture;
  // 文件系统从链接目标旁边解析 hub/linked/../x，会读到 elsewhere 那一侧的文件；
  // 按字典序它却是 hub/x，而 hub/x 同样存在。
  const beside = path.join(path.dirname(elsewhere), "beside.txt");
  fs.writeFileSync(beside, "outside");
  fs.writeFileSync(path.join(hub, "beside.txt"), "inside");
  t.after(() => fs.rmSync(beside, { force: true }));

  // `%2F` 能活过 URL 解析，于是 catch-all 收到的是一个已解码的分段。
  const segments = [...encodeFilePathForApi(hub).split("/").map(decodeURIComponent), "linked/../beside.txt"];
  const response = await GET(
    new NextRequest("http://localhost/api/files/x?type=read", { headers: { host: "localhost" } }),
    { params: Promise.resolve({ path: segments }) },
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Access denied" });
});

test("别的路由拿 `..` cwd 也一样被拒", async (t) => {
  const fixture = createHub(t);
  if (!fixture) return;
  const { hub, elsewhere } = fixture;
  const beside = path.join(path.dirname(elsewhere), "beside-secret.txt");
  fs.writeFileSync(beside, "outside");
  t.after(() => fs.rmSync(beside, { force: true }));

  // 查询串不做 URL 规范化，`..` 会一路走到「已存在路径」检查那里；那里必须拒绝
  // 它，而不是把它读成 `hub`。
  const cwd = `${hub}${path.sep}linked${path.sep}..`;
  const response = await getFileIndex(new NextRequest(
    `http://localhost/api/file-index?cwd=${encodeURIComponent(cwd)}`,
    { headers: { host: "localhost" } },
  ));
  assert.equal(response.status, 403);
});