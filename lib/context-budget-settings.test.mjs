// fork:pr12-a5-context-budget — settings.compaction / settings.branchSummary 预算的读写与校验
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  CONTEXT_BUDGET_DEFAULTS,
  CONTEXT_BUDGET_MAX_TOKENS,
  ContextBudgetReadError,
  parseContextBudgetUpdate,
  parseModelOverrides,
  readContextBudgetSettings,
  writeContextBudgetSettings,
} = await jiti.import("./context-budget-settings.ts");

async function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-context-budget-"));
  try {
    return await fn(join(dir, "settings.json"));
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
}

const read = (path) => JSON.parse(readFileSync(path, "utf8"));

test("an absent settings.json reads as pi's own built-in defaults", async () => {
  await withTempDir(async (settingsPath) => {
    assert.deepEqual(await readContextBudgetSettings(settingsPath), {
      enabled: true,
      reserveTokens: 16384,
      keepRecentTokens: 20000,
      branchSummaryReserveTokens: 16384,
      modelOverrides: {},
    });
    // 与 SDK 的 DEFAULT_COMPACTION_TOKEN_SETTINGS / `?? 16384` 逐值一致。
    assert.equal(CONTEXT_BUDGET_DEFAULTS.reserveTokens, 16384);
    assert.equal(CONTEXT_BUDGET_DEFAULTS.keepRecentTokens, 20000);
    assert.equal(CONTEXT_BUDGET_DEFAULTS.branchSummaryReserveTokens, 16384);
  });
});

test("reading never creates the settings file — a GET must not write to ~/.pi", async () => {
  await withTempDir(async (settingsPath) => {
    await readContextBudgetSettings(settingsPath);
    assert.equal(existsSync(settingsPath), false, "读一次不该凭空造出 settings.json");
    await writeContextBudgetSettings({ reserveTokens: 8192 }, { settingsPath });
    assert.equal(existsSync(settingsPath), true, "写才建文件");
  });
});

test("partially written sections keep the built-in default for the missing keys", async () => {
  await withTempDir(async (settingsPath) => {
    writeFileSync(settingsPath, JSON.stringify({
      compaction: { reserveTokens: 32768, modelOverrides: { "openai/gpt-5": { keepRecentTokens: 8000 } } },
      branchSummary: { skipPrompt: true },
    }));
    const settings = await readContextBudgetSettings(settingsPath);
    assert.equal(settings.reserveTokens, 32768);
    assert.equal(settings.keepRecentTokens, 20000);
    assert.equal(settings.branchSummaryReserveTokens, 16384);
    // skipPrompt 是 pi 自己的旋钮，我们只读 reserveTokens，不该把它当覆盖条目。
    assert.deepEqual(settings.modelOverrides, { "openai/gpt-5": { keepRecentTokens: 8000 } });
  });
});

test("out-of-range or wrongly typed values fall back instead of throwing", async () => {
  await withTempDir(async (settingsPath) => {
    writeFileSync(settingsPath, JSON.stringify({
      compaction: {
        enabled: "false",
        reserveTokens: -1,
        keepRecentTokens: 1.5,
        modelOverrides: {
          "openai/gpt-5": { reserveTokens: "8000" },
          badKey: { reserveTokens: 8 },
          "openai/o3": "not an object",
          "openai/o4": {},
        },
      },
    }));
    assert.deepEqual(await readContextBudgetSettings(settingsPath), {
      enabled: true,
      reserveTokens: 16384,
      keepRecentTokens: 20000,
      branchSummaryReserveTokens: 16384,
      // 不像模型引用的键 / 值为空对象的条目，一律整条丢掉，不做半条覆盖。
      modelOverrides: {},
    });
  });
});

test("a malformed settings.json is a read error, never a silent default", async () => {
  await withTempDir(async (settingsPath) => {
    writeFileSync(settingsPath, "{ not json");
    await assert.rejects(() => readContextBudgetSettings(settingsPath), ContextBudgetReadError);
    // 关键：读失败不许顺手把文件重写掉（那会抹掉里面的 API key）。
    assert.equal(readFileSync(settingsPath, "utf8"), "{ not json");
  });
});

test("writing the numbers preserves every other key in settings.json", async () => {
  await withTempDir(async (settingsPath) => {
    writeFileSync(settingsPath, JSON.stringify({
      theme: "dark",
      defaultTools: ["read", "bash"],
      compaction: { enabled: true, reserveTokens: 16384, provider_note: "hand-written" },
      branchSummary: { skipPrompt: true },
    }, null, 2));
    const next = await writeContextBudgetSettings(
      { reserveTokens: 32768, keepRecentTokens: 24000, branchSummaryReserveTokens: 4096 },
      { settingsPath },
    );
    assert.equal(next.reserveTokens, 32768);
    assert.equal(next.keepRecentTokens, 24000);
    assert.equal(next.branchSummaryReserveTokens, 4096);
    const stored = read(settingsPath);
    assert.equal(stored.theme, "dark");
    assert.deepEqual(stored.defaultTools, ["read", "bash"]);
    assert.equal(stored.compaction.provider_note, "hand-written");
    assert.equal(stored.branchSummary.skipPrompt, true);
  });
});

test("the settings file is written 0600", async () => {
  await withTempDir(async (settingsPath) => {
    writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));
    chmodSync(settingsPath, 0o644);
    await writeContextBudgetSettings({ keepRecentTokens: 24000 }, { settingsPath });
    assert.equal(statSync(settingsPath).mode & 0o777, 0o600);
  });
});

test("model overrides merge per model and leave every other entry alone", async () => {
  await withTempDir(async (settingsPath) => {
    writeFileSync(settingsPath, JSON.stringify({
      compaction: {
        modelOverrides: {
          "anthropic/claude-sonnet-4": { reserveTokens: 49152, keepRecentTokens: 12000 },
        },
      },
    }));
    const next = await writeContextBudgetSettings(
      { modelOverrides: { "openai/gpt-5": { reserveTokens: 60000 } } },
      { settingsPath },
    );
    assert.deepEqual(next.modelOverrides, {
      "anthropic/claude-sonnet-4": { reserveTokens: 49152, keepRecentTokens: 12000 },
      "openai/gpt-5": { reserveTokens: 60000 },
    });

    // 给了哪几个字段就覆盖哪几个：没给的 keepRecentTokens 不再属于这条覆盖。
    const merged = await writeContextBudgetSettings(
      { modelOverrides: { "openai/gpt-5": { reserveTokens: 65536 } } },
      { settingsPath },
    );
    assert.deepEqual(merged.modelOverrides["openai/gpt-5"], { reserveTokens: 65536 });
    assert.deepEqual(merged.modelOverrides["anthropic/claude-sonnet-4"], {
      reserveTokens: 49152,
      keepRecentTokens: 12000,
    });
  });
});

test("an empty override entry deletes that model, and an empty table leaves no empty shell", async () => {
  await withTempDir(async (settingsPath) => {
    await writeContextBudgetSettings(
      { modelOverrides: { "a/one": { reserveTokens: 1000 }, "a/two": { keepRecentTokens: 2000 } } },
      { settingsPath },
    );
    const afterOne = await writeContextBudgetSettings({ modelOverrides: { "a/one": {} } }, { settingsPath });
    assert.deepEqual(Object.keys(afterOne.modelOverrides), ["a/two"]);

    await writeContextBudgetSettings({ modelOverrides: { "a/two": {} } }, { settingsPath });
    const stored = read(settingsPath);
    assert.equal(stored.compaction, undefined, "表空了就该把 compaction 整段删掉，不留 {}");
    assert.deepEqual(await readContextBudgetSettings(settingsPath), CONTEXT_BUDGET_DEFAULTS);
  });
});

test("editing one override never drops an entry the panel cannot parse", async () => {
  // 手写的越界值面板解析不出来（那一行不显示），但它必须原样留在文件里 ——
  // 改别的模型不能顺手抹掉它。
  await withTempDir(async (settingsPath) => {
    writeFileSync(settingsPath, JSON.stringify({
      compaction: {
        modelOverrides: {
          "hand/written": { reserveTokens: CONTEXT_BUDGET_MAX_TOKENS + 1 },
        },
      },
    }));
    await writeContextBudgetSettings(
      { modelOverrides: { "openai/gpt-5": { reserveTokens: 60000 } } },
      { settingsPath },
    );
    const stored = read(settingsPath);
    assert.equal(stored.compaction.modelOverrides["hand/written"].reserveTokens, CONTEXT_BUDGET_MAX_TOKENS + 1);
    assert.equal(stored.compaction.modelOverrides["openai/gpt-5"].reserveTokens, 60000);
  });
});

test("update bodies are validated: type, range, key shape, unknown keys, emptiness", () => {
  assert.deepEqual(parseContextBudgetUpdate({ enabled: false }), { enabled: false });
  assert.deepEqual(parseContextBudgetUpdate({ reserveTokens: 0 }), { reserveTokens: 0 });
  assert.deepEqual(parseContextBudgetUpdate({ reserveTokens: CONTEXT_BUDGET_MAX_TOKENS }), {
    reserveTokens: CONTEXT_BUDGET_MAX_TOKENS,
  });
  assert.deepEqual(parseContextBudgetUpdate({ modelOverrides: { "a/b": {} } }), {
    modelOverrides: { "a/b": {} },
  });
  assert.deepEqual(parseContextBudgetUpdate({ modelOverrides: {} }), { modelOverrides: {} });
  assert.deepEqual(
    parseContextBudgetUpdate({ keepRecentTokens: 24000, branchSummaryReserveTokens: 4096 }),
    { keepRecentTokens: 24000, branchSummaryReserveTokens: 4096 },
  );

  for (const body of [
    {},
    { enabled: "false" },
    { reserveTokens: 1.5 },
    { reserveTokens: CONTEXT_BUDGET_MAX_TOKENS + 1 },
    { reserveTokens: -1 },
    { keepRecentTokens: "8000" },
    { branchSummaryReserveTokens: null },
    { modelOverrides: { noslash: { reserveTokens: 1 } } },
    { modelOverrides: { "/leading": { reserveTokens: 1 } } },
    { modelOverrides: { "has space/x": { reserveTokens: 1 } } },
    { modelOverrides: { "a/b": 5 } },
    { modelOverrides: { "a/b": { reserveTokens: -1 } } },
    { modelOverrides: [] },
    { maxAgentDelayMs: 10 },
    null,
    [1, 2],
  ]) {
    assert.throws(
      () => parseContextBudgetUpdate(body),
      TypeError,
      `should reject ${JSON.stringify(body)}`,
    );
  }
});

test("model ids may contain slashes — the key is provider/model, the rest is the id", () => {
  assert.deepEqual(parseModelOverrides({ "openrouter/anthropic/claude-3.7": { reserveTokens: 4096 } }), {
    "openrouter/anthropic/claude-3.7": { reserveTokens: 4096 },
  });
});

test("enabled is written through SettingsManager, which keeps the rest of the file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-context-budget-enabled-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    const settingsPath = join(dir, "settings.json");
    writeFileSync(settingsPath, JSON.stringify({
      theme: "dark",
      compaction: { reserveTokens: 24576, keepRecentTokens: 12000, modelOverrides: { "a/b": { reserveTokens: 1 } } },
    }));
    const next = await writeContextBudgetSettings({ enabled: false }, { settingsPath, agentDir: dir });
    assert.equal(next.enabled, false);
    assert.equal(next.reserveTokens, 24576);
    const stored = read(settingsPath);
    assert.equal(stored.theme, "dark");
    assert.equal(stored.compaction.enabled, false);
    assert.equal(stored.compaction.reserveTokens, 24576);
    assert.deepEqual(stored.compaction.modelOverrides, { "a/b": { reserveTokens: 1 } });
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
