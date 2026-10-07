// fork:memory —— 「设置 → 记忆」的服务端那一半：**本应用的开关**（默认关）、
// 加载时把扩展摘掉、以及只读的包状态。
//
// 这一条锁的是三个口径：
//   1. 开关默认关，存在 `pi-web-preferences.json`（**不动 pi 的 packages**）；
//   2. 关着时 `withoutDisabledMemoryExtension()` 只摘那一个扩展，别的扩展 / 错误原样留着；
//   3. 包状态（装没装 / 版本 / 全局启停）是**只读**读数，与开关互不影响。
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const subject = await createJiti(import.meta.url, { moduleCache: false }).import("./memory-package.ts");
const {
  MEMORY_PACKAGE_SOURCE,
  isMemoryExtensionEnabled,
  packageEnabledInList,
  readInstalledMemoryVersion,
  readMemoryState,
  setMemoryExtensionEnabled,
  withoutDisabledMemoryExtension,
} = subject;

function tmpAgentDir() {
  return mkdtempSync(join(tmpdir(), "pi-memory-test-"));
}

/** 造一个「装好了」的包目录（只有 package.json 是判定需要的）。 */
function fakeInstall(agentDir, version = "0.9.10") {
  const dir = join(agentDir, "npm", "node_modules", "pi-hermes-memory");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "pi-hermes-memory", version }));
}

function readPreferences(agentDir) {
  return JSON.parse(readFileSync(join(agentDir, "pi-web-preferences.json"), "utf8"));
}

/** 假加载结果：`withoutDisabledMemoryExtension` 只碰 extensions / errors。 */
function fakeExtensions(entries) {
  return { extensions: entries, errors: [], runtime: {} };
}

function extension(path, source) {
  return { path, sourceInfo: { source }, tools: new Map() };
}

test("开关默认关；打开 / 关上都只写 pi-web-preferences.json（不动 pi 的 packages）", () => {
  const agentDir = tmpAgentDir();
  assert.equal(isMemoryExtensionEnabled(agentDir), false, "默认是关着的");

  setMemoryExtensionEnabled(true, agentDir);
  assert.equal(isMemoryExtensionEnabled(agentDir), true);
  assert.equal(readPreferences(agentDir).memoryExtensionEnabled, true);

  setMemoryExtensionEnabled(false, agentDir);
  assert.equal(isMemoryExtensionEnabled(agentDir), false);
  assert.equal(readPreferences(agentDir).memoryExtensionEnabled, false);
});

test("开关读写不碰别的偏好键（推理强度记忆要活下来）", () => {
  const agentDir = tmpAgentDir();
  writeFileSync(join(agentDir, "pi-web-preferences.json"), JSON.stringify({ thinkingLevelMemory: { "p/m": "high" } }));
  setMemoryExtensionEnabled(true, agentDir);
  const preferences = readPreferences(agentDir);
  assert.deepEqual(preferences.thinkingLevelMemory, { "p/m": "high" });
  assert.equal(preferences.memoryExtensionEnabled, true);
});

test("withoutDisabledMemoryExtension：关着时只摘那一个扩展，别的原样留着", () => {
  const agentDir = tmpAgentDir();
  const hermes = extension(
    join(agentDir, "npm", "node_modules", "pi-hermes-memory", "src", "index.ts"),
    MEMORY_PACKAGE_SOURCE,
  );
  const other = extension(join(agentDir, "extensions", "bid-ask.ts"), "local");
  const base = { ...fakeExtensions([hermes, other]), errors: [{ path: hermes.path, error: "boom" }] };

  const filtered = withoutDisabledMemoryExtension(base, agentDir);
  assert.deepEqual(filtered.extensions.map((entry) => entry.path), [other.path]);
  assert.deepEqual(filtered.errors, [], "被摘掉的扩展的加载错误一起走");

  setMemoryExtensionEnabled(true, agentDir);
  const kept = withoutDisabledMemoryExtension(base, agentDir);
  assert.equal(kept, base, "开着时原样返回（不做无意义的拷贝）");
});

test("withoutDisabledMemoryExtension：按包名或路径段认，别把同名文件也摘了", () => {
  const agentDir = tmpAgentDir();
  const byPath = extension("/somewhere/pi-hermes-memory/src/index.ts", "local");
  const bySource = extension("/elsewhere/index.ts", MEMORY_PACKAGE_SOURCE);
  const lookalike = extension("/elsewhere/pi-hermes-memory-notes.ts", "local");
  const filtered = withoutDisabledMemoryExtension(fakeExtensions([byPath, bySource, lookalike]), agentDir);
  assert.deepEqual(filtered.extensions.map((entry) => entry.path), [lookalike.path]);
});

test("packageEnabledInList：pi 的 packages 那条（只读读数用）", () => {
  assert.equal(packageEnabledInList(undefined), false, "没配 = 关");
  assert.equal(packageEnabledInList([MEMORY_PACKAGE_SOURCE]), true);
  assert.equal(packageEnabledInList([
    { source: MEMORY_PACKAGE_SOURCE, extensions: [], skills: [], prompts: [], themes: [] },
  ]), false, "四个资源列表清空 = 停用");
  assert.equal(packageEnabledInList(["npm:other"]), false);
});

test("readInstalledMemoryVersion：只有真装了才报版本", () => {
  const agentDir = tmpAgentDir();
  assert.equal(readInstalledMemoryVersion(agentDir), null);
  fakeInstall(agentDir, "1.2.3");
  assert.equal(readInstalledMemoryVersion(agentDir), "1.2.3");
});

test("readMemoryState：开关与包状态互不影响，目录里的文件照实列出来", async () => {
  const agentDir = tmpAgentDir();
  fakeInstall(agentDir);
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [MEMORY_PACKAGE_SOURCE] }));
  const dir = join(agentDir, "pi-hermes-memory");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "MEMORY.md"), "1234567");
  writeFileSync(join(dir, "USER.md"), "hi");

  const off = await readMemoryState({ agentDir, cwd: agentDir });
  assert.equal(off.installed, true);
  assert.equal(off.version, "0.9.10");
  assert.equal(off.packageEnabled, true, "终端 / 其它运行时照样加载它");
  assert.equal(off.enabled, false, "本应用默认不加载");
  assert.deepEqual(off.files, [{ name: "MEMORY.md", bytes: 7 }, { name: "USER.md", bytes: 2 }]);

  setMemoryExtensionEnabled(true, agentDir);
  const on = await readMemoryState({ agentDir, cwd: agentDir });
  assert.equal(on.enabled, true);
  assert.equal(on.packageEnabled, true);

  // 全局停用时（用户在终端里关的）：两个读数各自成立，页面据此给提示。
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [{ source: MEMORY_PACKAGE_SOURCE, extensions: [], skills: [], prompts: [], themes: [] }] }));
  const globallyOff = await readMemoryState({ agentDir, cwd: agentDir });
  assert.equal(globallyOff.packageEnabled, false);
  assert.equal(globallyOff.enabled, true);
});
