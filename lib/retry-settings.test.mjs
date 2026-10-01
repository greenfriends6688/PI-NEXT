// fork:upstream-0.9.3-retry-settings — settings.retry 的读写与校验
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  parseRetrySettingsUpdate,
  readRetrySettings,
  RETRY_DEFAULTS,
  RETRY_MAX_BASE_DELAY_MS,
  RETRY_MAX_RETRIES,
  RetrySettingsReadError,
  writeRetrySettings,
} = await jiti.import("./retry-settings.ts");

async function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-retry-"));
  try {
    return await fn(join(dir, "settings.json"));
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
}

const read = (path) => JSON.parse(readFileSync(path, "utf8"));

test("an absent settings.json reads as the SDK's own defaults", async () => {
  await withTempDir(async (settingsPath) => {
    assert.deepEqual(await readRetrySettings(settingsPath), {
      enabled: true,
      maxRetries: 3,
      baseDelayMs: 2000,
    });
    assert.deepEqual(RETRY_DEFAULTS, { enabled: true, maxRetries: 3, baseDelayMs: 2000 });
  });
});

test("reading never creates the settings file — a GET must not write to ~/.pi", async () => {
  await withTempDir(async (settingsPath) => {
    await readRetrySettings(settingsPath);
    assert.equal(existsSync(settingsPath), false, "读一次不该凭空造出 settings.json");
    await writeRetrySettings({ maxRetries: 5 }, { settingsPath });
    assert.equal(existsSync(settingsPath), true, "写才建文件");
  });
});

test("a partially written retry section keeps the SDK default for the missing keys", async () => {
  await withTempDir(async (settingsPath) => {
    writeFileSync(settingsPath, JSON.stringify({ retry: { maxRetries: 7 } }));
    assert.deepEqual(await readRetrySettings(settingsPath), {
      enabled: true,
      maxRetries: 7,
      baseDelayMs: 2000,
    });
  });
});

test("out-of-range or wrongly typed values in the file fall back instead of throwing", async () => {
  await withTempDir(async (settingsPath) => {
    writeFileSync(settingsPath, JSON.stringify({
      retry: { enabled: "false", maxRetries: 999, baseDelayMs: -1, provider: { maxRetries: 9 } },
    }));
    assert.deepEqual(await readRetrySettings(settingsPath), {
      enabled: true,
      maxRetries: 3,
      baseDelayMs: 2000,
    });
  });
});

test("a malformed settings.json is a read error, never a silent default", async () => {
  await withTempDir(async (settingsPath) => {
    writeFileSync(settingsPath, "{ not json");
    await assert.rejects(() => readRetrySettings(settingsPath), RetrySettingsReadError);
    // 关键：读失败不许顺手把文件重写掉（那会抹掉里面的 API key）。
    assert.equal(readFileSync(settingsPath, "utf8"), "{ not json");
  });
});

test("writing the numbers preserves every other key in settings.json", async () => {
  await withTempDir(async (settingsPath) => {
    writeFileSync(settingsPath, JSON.stringify({
      theme: "dark",
      defaultTools: ["read", "bash"],
      retry: { enabled: true, provider: { maxRetries: 4 } },
    }, null, 2));
    const next = await writeRetrySettings({ maxRetries: 6, baseDelayMs: 500 }, { settingsPath });
    assert.deepEqual(next, { enabled: true, maxRetries: 6, baseDelayMs: 500 });
    const stored = read(settingsPath);
    assert.equal(stored.theme, "dark");
    assert.deepEqual(stored.defaultTools, ["read", "bash"]);
    // provider 段是 pi 自己的旋钮，我们没碰也不能丢。
    assert.deepEqual(stored.retry, { enabled: true, provider: { maxRetries: 4 }, maxRetries: 6, baseDelayMs: 500 });
  });
});

test("the settings file is written 0600", async () => {
  await withTempDir(async (settingsPath) => {
    writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));
    chmodSync(settingsPath, 0o644);
    await writeRetrySettings({ baseDelayMs: 250 }, { settingsPath });
    assert.equal(statSync(settingsPath).mode & 0o777, 0o600);
  });
});

test("update bodies are validated: type, range, unknown keys, emptiness", () => {
  assert.deepEqual(parseRetrySettingsUpdate({ enabled: false }), { enabled: false });
  assert.deepEqual(parseRetrySettingsUpdate({ maxRetries: 0 }), { maxRetries: 0 });
  assert.deepEqual(parseRetrySettingsUpdate({ baseDelayMs: RETRY_MAX_BASE_DELAY_MS }), {
    baseDelayMs: RETRY_MAX_BASE_DELAY_MS,
  });
  assert.deepEqual(
    parseRetrySettingsUpdate({ enabled: true, maxRetries: 2, baseDelayMs: 100 }),
    { enabled: true, maxRetries: 2, baseDelayMs: 100 },
  );

  for (const body of [
    {},
    { enabled: "false" },
    { maxRetries: 1.5 },
    { maxRetries: RETRY_MAX_RETRIES + 1 },
    { maxRetries: -1 },
    { baseDelayMs: RETRY_MAX_BASE_DELAY_MS + 1 },
    { maxAgentDelayMs: 10 },
    null,
    [1, 2],
  ]) {
    assert.throws(() => parseRetrySettingsUpdate(body), TypeError, `should reject ${JSON.stringify(body)}`);
  }
});

test("enabled is written through SettingsManager, which keeps the rest of the file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-retry-enabled-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    const settingsPath = join(dir, "settings.json");
    writeFileSync(settingsPath, JSON.stringify({ theme: "dark", retry: { maxRetries: 5, baseDelayMs: 800 } }));
    const next = await writeRetrySettings({ enabled: false }, { settingsPath, agentDir: dir });
    assert.deepEqual(next, { enabled: false, maxRetries: 5, baseDelayMs: 800 });
    const stored = read(settingsPath);
    assert.equal(stored.theme, "dark");
    assert.equal(stored.retry.enabled, false);
    assert.equal(stored.retry.maxRetries, 5);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
