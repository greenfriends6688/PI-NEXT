import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 调用表的完整性：Web / 无头入口不能悄悄少一项能力。
 *
 * 桌面端与 Agent 各自把自己的方法注册进同一张调用表，而表是各自进程里的一份——
 * 少注册一个通道，渲染层能调它，dispatcher 却只回 `unknown method: <channel>`，
 * 一句既不说是哪个功能、也不说为什么不支持的话，看起来像客户端坏了。`workspace:git-log`
 * 就是这样丢的。这个测试从源码里把三样东西抽出来逐个对账，而不是靠人去记得：
 *
 *   - `src/shared/api.ts` 里所有 `t.invoke(Ipc.x)` / `t.send(Ipc.x)`：渲染层能调的全集；
 *   - `src/main/**` 里所有 `handle(Ipc.x, ...)`：桌面端实际注册的集合；
 *   - `src/agent/handlers.ts` 里的 `AGENT_UNSUPPORTED` / `DESKTOP_ONLY`：Agent 明确拒绝的、
 *     和只属于桌面的通道。
 *
 * 纯源码正则解析：`node --test` 跑得了，不引 Electron、不引 TypeScript 编译器 API。
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function source(relative: string): string {
  return readFileSync(join(root, relative), "utf8");
}

/** `handle(Ipc.foo, ...)` 里的通道名。带变量的注册（`handle(channel, ...)`）抓不到。 */
function handleChannels(text: string): string[] {
  return [...text.matchAll(/handle\(\s*Ipc\.([A-Za-z0-9]+)/g)].map((match) => match[1]);
}

/** 渲染层能调用的通道全集，取自 `createPinextApi` 的每个 `t.invoke` / `t.send`。 */
function apiChannels(text: string): string[] {
  return [...text.matchAll(/t\.(?:invoke|send)\(Ipc\.([A-Za-z0-9]+)/g)].map((match) => match[1]);
}

/** 读 `src/agent/handlers.ts` 里一个导出的 `Ipc.*` 数组。 */
function declaredChannels(text: string, name: string): string[] {
  const match = text.match(new RegExp(`export const ${name}[^=]*=\\s*\\[([\\s\\S]*?)\\];`));
  assert.ok(match, `src/agent/handlers.ts 里找不到 ${name}`);
  return [...match[1].matchAll(/Ipc\.([A-Za-z0-9]+)/g)].map((entry) => entry[1]);
}

/** Every `.ts` file under a directory, recursively. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") walk(path, out);
    } else if (entry.name.endsWith(".ts")) {
      out.push(path);
    }
  }
  return out;
}

const agentSource = source("src/agent/handlers.ts");

/** What the Agent actually registers with a real implementation. */
const agentChannels = new Set([
  ...handleChannels(agentSource),
  // `registerAgentIpc` delegates these two to their own modules.
  ...handleChannels(source("src/main/ipc/dag-handlers.ts")),
  ...handleChannels(source("src/main/ipc/schedule-handlers.ts")),
]);

/** What the desktop entry registers, across every module it wires up. */
const desktopChannels = new Set<string>();
for (const file of walk(join(root, "src/main"))) {
  for (const channel of handleChannels(readFileSync(file, "utf8"))) desktopChannels.add(channel);
}
// The git pull / push pair is registered through a `handle(channel, ...)` loop, so the
// literal scan above cannot see it. It is the only such registration on the desktop.
for (const channel of ["workspaceGitPull", "workspaceGitPush"]) desktopChannels.add(channel);

const api = apiChannels(source("src/shared/api.ts"));
const unsupported = declaredChannels(agentSource, "AGENT_UNSUPPORTED");
const desktopOnly = declaredChannels(agentSource, "DESKTOP_ONLY");

test("every channel the renderer can call is served, refused, or explicitly desktop-only", () => {
  const covered = new Set([...agentChannels, ...unsupported, ...desktopOnly]);
  const missing = [...api].filter((channel) => !covered.has(channel)).sort();
  assert.deepEqual(
    missing,
    [],
    `调用表里有既没被 Agent 注册、也没被分类的通道（界面点到才会以 unknown method 暴露）: ${missing.join(", ")}`,
  );
});

test("the two lists are exactly the desktop channels the agent does not serve", () => {
  const unserved = [...desktopChannels].filter((channel) => !agentChannels.has(channel)).sort();
  const declared = [...new Set([...unsupported, ...desktopOnly])].sort();
  assert.deepEqual(
    declared,
    unserved,
    "AGENT_UNSUPPORTED ∪ DESKTOP_ONLY 必须恰好等于桌面端注册、Agent 未注册的通道，不能多也不能少",
  );
});

test("neither list names a method the desktop does not register", () => {
  const notDesktop = [...new Set([...unsupported, ...desktopOnly])]
    .filter((channel) => !desktopChannels.has(channel))
    .sort();
  assert.deepEqual(notDesktop, [], `清单里出现了桌面端并不注册的通道: ${notDesktop.join(", ")}`);
});

test("the refusal list and the desktop-only list do not overlap or repeat", () => {
  assert.equal(new Set(unsupported).size, unsupported.length, "AGENT_UNSUPPORTED 有重复项");
  assert.equal(new Set(desktopOnly).size, desktopOnly.length, "DESKTOP_ONLY 有重复项");
  const both = unsupported.filter((channel) => desktopOnly.includes(channel)).sort();
  assert.deepEqual(both, [], `同一个通道同时出现在两份清单里: ${both.join(", ")}`);
});
