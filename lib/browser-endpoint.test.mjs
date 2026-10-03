import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  BrowserHostUnavailableError,
  browserHostEndpointPath,
  clearBrowserHostEndpoint,
  createBrowserHostEndpoint,
  isEndpointProcessAlive,
  readBrowserHostEndpoint,
  resolveBrowserHostEndpoint,
  writeBrowserHostEndpoint,
} = await jiti.import("./browser-endpoint.ts");

function tempPath() {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-endpoint-"));
  return { dir, path: join(dir, "browser-host.json"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("端点文件位置固定在 ~/.pi/agent 下（桌面端与服务端共认一个地方）", () => {
  assert.equal(browserHostEndpointPath("/home/x"), "/home/x/.pi/agent/browser-host.json");
});

test("写入后可读回，且端口 / 令牌字段完整", () => {
  const fixture = tempPath();
  try {
    const endpoint = createBrowserHostEndpoint(54321, process.pid);
    writeBrowserHostEndpoint(endpoint, fixture.path);
    assert.deepEqual(readBrowserHostEndpoint(fixture.path), endpoint);
  } finally {
    fixture.cleanup();
  }
});

test("端点文件是 0600 —— 端口 + 令牌是能力凭据", () => {
  const fixture = tempPath();
  try {
    writeBrowserHostEndpoint(createBrowserHostEndpoint(54321, process.pid), fixture.path);
    assert.equal(statSync(fixture.path).mode & 0o777, 0o600);
  } finally {
    fixture.cleanup();
  }
});

test("畸形文件一律当没有端点，且绝不回显内容", () => {
  const fixture = tempPath();
  try {
    for (const raw of ["", "{}", "null", "not json", '{"host":"0.0.0.0","port":1,"token":"x"}', '{"version":1,"host":"127.0.0.1","port":0,"token":"aaaaaaaaaaaaaaaa"}']) {
      writeFileSync(fixture.path, raw, { mode: 0o600 });
      assert.equal(readBrowserHostEndpoint(fixture.path), null, raw);
    }
  } finally {
    fixture.cleanup();
  }
});

test("Web 部署（根本没有端点文件）报的是「桌面端才可用」，不是连接异常", () => {
  const fixture = tempPath();
  try {
    assert.throws(
      () => resolveBrowserHostEndpoint(fixture.path),
      (error) => error instanceof BrowserHostUnavailableError && error.reason === "no-endpoint" && /桌面端/.test(error.message),
    );
  } finally {
    fixture.cleanup();
  }
});

test("端点文件比进程活得久（桌面端已退出）时直接判死", () => {
  const fixture = tempPath();
  try {
    const deadPid = findDeadPid();
    writeBrowserHostEndpoint(createBrowserHostEndpoint(54321, deadPid), fixture.path);
    assert.throws(
      () => resolveBrowserHostEndpoint(fixture.path),
      (error) => error instanceof BrowserHostUnavailableError && error.reason === "stale-endpoint",
    );
  } finally {
    fixture.cleanup();
  }
});

test("清除端点后读端得到 null", () => {
  const fixture = tempPath();
  try {
    writeBrowserHostEndpoint(createBrowserHostEndpoint(54321, process.pid), fixture.path);
    clearBrowserHostEndpoint(fixture.path);
    assert.equal(readBrowserHostEndpoint(fixture.path), null);
    assert.doesNotThrow(() => clearBrowserHostEndpoint(fixture.path));
  } finally {
    fixture.cleanup();
  }
});

test("本进程恒为「活着」", () => {
  assert.equal(isEndpointProcessAlive(process.pid), true);
});

/** 找一个确定已经退出的 pid。 */
function findDeadPid() {
  for (let candidate = 65_000; candidate < 70_000; candidate += 1) {
    if (!isEndpointProcessAlive(candidate)) return candidate;
  }
  throw new Error("no dead pid found");
}
