// fork:mcp-auto-reload — 配置改动后，已经打开的会话重读资源。
//
// 以前改完 MCP 只有两个生效点：新会话（`session_start` 会重读配置）或用户在插件页
// 手动点重载；MCP 设置页自己不发任何 reload ——「我刚加的 server，模型这轮还是调不到」。
// 参考项目 `requestSessionResourceReload`（pi-agent-desktop-main/lib/rpc-manager.ts:813）
// 是自动的；本仓补了三条约束：跑着的会话不打断（等这轮结束再重载）、global vs project
// 的作用范围、以及把结果报给前端。
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const { AgentSessionWrapper, requestMcpReload } = await jiti.import("./rpc-manager.ts");

/** 一个只会记录 `reload()` 的假 inner —— `case "reload"` 走的那条路径。 */
function makeWrapper({ cwd = "/tmp/project", running = false } = {}) {
  const reloads = [];
  const inner = {
    sessionId: `session-${cwd}`,
    sessionFile: undefined,
    isStreaming: running,
    isCompacting: false,
    isBashRunning: false,
    sessionManager: { getCwd: () => cwd },
    // reload 会走 `syncProjectTrust()` → `setProjectTrusted` / `getProjectTrusted`。
    settingsManager: {
      getDefaultTools: () => undefined,
      setProjectTrusted: () => {},
      getProjectTrusted: () => false,
    },
    agent: { state: {} },
    extensionRunner: {},
    subscribe: () => () => {},
    getActiveToolNames: () => [],
    getAllTools: () => [],
    setActiveToolsByName: () => {},
    getActiveTools: () => [],
    reload: async () => { reloads.push(Date.now()); },
    dispose() {},
  };
  const wrapper = new AgentSessionWrapper(inner);
  if (running) {
    // `isRunning()` 还要看 pendingPromptCount / isCompacting / isBashRunning；
    // isStreaming=true 已经足够让它判成在跑。
  }
  return { wrapper, reloads };
}

/** send() 里有多道 await（waitForExtensionsBound → reload），轮询等它落地。 */
async function waitFor(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(predicate(), "等待超时：reload 没有落地");
}

/** 把假 wrapper 塞进全局注册表，`requestMcpReload` 只认这一份。 */
function withRegistry(wrappers, run) {
  const previous = globalThis.__piSessions;
  globalThis.__piSessions = new Map(wrappers.map((w, i) => [`key-${i}`, w]));
  try {
    return run();
  } finally {
    globalThis.__piSessions = previous;
  }
}

test("a global config change reloads every open session immediately", async (t) => {
  const a = makeWrapper({ cwd: "/tmp/project-a" });
  const b = makeWrapper({ cwd: "/tmp/project-b" });
  t.after(() => { a.wrapper.destroy(); b.wrapper.destroy(); });

  const report = withRegistry([a.wrapper, b.wrapper], () => requestMcpReload(undefined));
  assert.deepEqual(report, { reloaded: 2, deferred: 0 });

  // send() 是 fire-and-forget（`void this.send(...)`），等它落地。
  await waitFor(() => a.reloads.length === 1 && b.reloads.length === 1);
  assert.equal(a.reloads.length, 1);
  assert.equal(b.reloads.length, 1);
});

test("a project-scope change only reloads that project's sessions", async (t) => {
  const same = makeWrapper({ cwd: "/tmp/project-a" });
  const other = makeWrapper({ cwd: "/tmp/project-b" });
  t.after(() => { same.wrapper.destroy(); other.wrapper.destroy(); });

  const report = withRegistry([same.wrapper, other.wrapper], () => requestMcpReload("/tmp/project-a"));
  assert.deepEqual(report, { reloaded: 1, deferred: 0 });

  await waitFor(() => same.reloads.length === 1);
  assert.equal(same.reloads.length, 1);
  assert.equal(other.reloads.length, 0);
});

test("a running session is not interrupted; it reloads after the turn ends", async (t) => {
  const busy = makeWrapper({ cwd: "/tmp/project", running: true });
  t.after(() => busy.wrapper.destroy());

  // 登记时它在跑 → 只排队，不打断。
  const report = withRegistry([busy.wrapper], () => requestMcpReload(undefined));
  assert.deepEqual(report, { reloaded: 0, deferred: 1 });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(busy.reloads.length, 0, "跑着的会话不应该被中途 reload");

  // `flushPendingReload` 挂在 `finishPrompt`（turn 结束那一个时刻）——
  // 源码级钉住这条接线，`send({type:"prompt"})` 的 fake 太多，这里只钉住调用点。
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  assert.match(source, /this\.flushPendingReload\(\);/);
  assert.match(source, /private pendingMcpReload = false;/);
  assert.match(source, /export function requestMcpReload\(cwd\?: string\): \{ reloaded: number; deferred: number \}/);
});