// fork:pr12-a6-thinking-budget — settings.thinkingBudgets 四档预算的读写与校验
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  parseThinkingBudgets,
  parseThinkingBudgetUpdate,
  readThinkingBudgetSettings,
  THINKING_BUDGET_DEFAULTS,
  THINKING_BUDGET_MAX_TOKENS,
  ThinkingBudgetReadError,
  writeThinkingBudgetSettings,
} = await jiti.import("./thinking-budget-settings.ts");

async function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-thinking-budget-"));
  try {
    return await fn(join(dir, "settings.json"));
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
}

const read = (path) => JSON.parse(readFileSync(path, "utf8"));

test("an absent settings.json reads as pi-ai's own built-in defaults", async () => {
  await withTempDir(async (settingsPath) => {
    assert.deepEqual(await readThinkingBudgetSettings(settingsPath), {
      minimal: 1024,
      low: 2048,
      medium: 8192,
      high: 16384,
    });
    // 与 pi-ai 的 DEFAULT_THINKING_BUDGETS（simple-options.js:37-42）逐值一致。
    assert.deepEqual(THINKING_BUDGET_DEFAULTS, {
      minimal: 1024,
      low: 2048,
      medium: 8192,
      high: 16384,
    });
  });
});

test("reading never creates the settings file — a GET must not write to ~/.pi", async () => {
  await withTempDir(async (settingsPath) => {
    await readThinkingBudgetSettings(settingsPath);
    assert.equal(existsSync(settingsPath), false, "读一次不该凭空造出 settings.json");
    await writeThinkingBudgetSettings({ high: 32768 }, { settingsPath });
    assert.equal(existsSync(settingsPath), true, "写才建文件");
  });
});

test("a partially written section keeps the built-in default for the missing levels", async () => {
  await withTempDir(async (settingsPath) => {
    writeFileSync(settingsPath, JSON.stringify({ thinkingBudgets: { medium: 12000 } }));
    assert.deepEqual(await readThinkingBudgetSettings(settingsPath), {
      minimal: 1024,
      low: 2048,
      medium: 12000,
      high: 16384,
    });
  });
});

test("out-of-range or wrongly typed values fall back instead of throwing", async () => {
  await withTempDir(async (settingsPath) => {
    writeFileSync(settingsPath, JSON.stringify({
      thinkingBudgets: {
        minimal: 0,
        low: "2048",
        medium: 1.5,
        high: THINKING_BUDGET_MAX_TOKENS + 1,
        off: 4096,
      },
    }));
    assert.deepEqual(await readThinkingBudgetSettings(settingsPath), THINKING_BUDGET_DEFAULTS);
    assert.deepEqual(parseThinkingBudgets({ thinkingBudgets: [] }), THINKING_BUDGET_DEFAULTS);
  });
});

test("a malformed settings.json is a read error, never a silent default", async () => {
  await withTempDir(async (settingsPath) => {
    writeFileSync(settingsPath, "{ not json");
    await assert.rejects(() => readThinkingBudgetSettings(settingsPath), ThinkingBudgetReadError);
    // 关键：读失败不许顺手把文件重写掉（那会抹掉里面的 API key）。
    assert.equal(readFileSync(settingsPath, "utf8"), "{ not json");
  });
});

test("writing preserves every other key in settings.json and writes 0600", async () => {
  await withTempDir(async (settingsPath) => {
    writeFileSync(settingsPath, JSON.stringify({
      theme: "dark",
      compaction: { reserveTokens: 24576 },
      thinkingBudgets: { low: 4096 },
    }, null, 2));
    chmodSync(settingsPath, 0o644);
    const next = await writeThinkingBudgetSettings({ high: 32768 }, { settingsPath });
    assert.equal(next.high, 32768);
    assert.equal(next.low, 4096, "没改的低档原样保留");
    const stored = read(settingsPath);
    assert.equal(stored.theme, "dark");
    assert.equal(stored.compaction.reserveTokens, 24576);
    assert.deepEqual(stored.thinkingBudgets, { low: 4096, high: 32768 });
    assert.equal(statSync(settingsPath).mode & 0o777, 0o600);
  });
});

test("only values that differ from pi's default reach the file; all-defaults leaves no shell", async () => {
  await withTempDir(async (settingsPath) => {
    await writeThinkingBudgetSettings({ minimal: 1024, high: 40960 }, { settingsPath });
    // minimal 写的就是内建默认 → 不留键；high 与默认不同 → 写进去。
    assert.deepEqual(read(settingsPath).thinkingBudgets, { high: 40960 });

    await writeThinkingBudgetSettings(
      { minimal: 1024, low: 2048, medium: 8192, high: 16384 },
      { settingsPath },
    );
    // 四档全部回到内建默认 → 整段删掉，不留 { thinkingBudgets: {} }。
    assert.equal(read(settingsPath).thinkingBudgets, undefined);
    assert.deepEqual(await readThinkingBudgetSettings(settingsPath), THINKING_BUDGET_DEFAULTS);
  });
});

test("reading the defaults back and writing them again does not touch the file", async () => {
  await withTempDir(async (settingsPath) => {
    await writeThinkingBudgetSettings({ high: 40960 }, { settingsPath });
    const before = readFileSync(settingsPath, "utf8");
    const settings = await readThinkingBudgetSettings(settingsPath);
    const after = await writeThinkingBudgetSettings({ ...settings }, { settingsPath });
    assert.deepEqual(after, settings);
    assert.equal(readFileSync(settingsPath, "utf8"), before, "同值写回必须是幂等的");
  });
});

test("a stored level the panel cannot read is not silently dropped by an unrelated write", async () => {
  await withTempDir(async (settingsPath) => {
    writeFileSync(settingsPath, JSON.stringify({
      thinkingBudgets: { medium: "8192", high: 40960 },
    }));
    const next = await writeThinkingBudgetSettings({ low: 2048 }, { settingsPath });
    assert.deepEqual(next, { minimal: 1024, low: 2048, medium: 8192, high: 40960 });
    // medium 那一档是手写坏的：面板显示内建默认，但写别的档不能顺手把它删掉。
    assert.deepEqual(read(settingsPath).thinkingBudgets, { medium: "8192", high: 40960 });
  });
});

test("update bodies are validated: type, range, unknown levels, emptiness", () => {
  assert.deepEqual(parseThinkingBudgetUpdate({ minimal: 1 }), { minimal: 1 });
  assert.deepEqual(parseThinkingBudgetUpdate({ high: THINKING_BUDGET_MAX_TOKENS }), {
    high: THINKING_BUDGET_MAX_TOKENS,
  });
  assert.deepEqual(
    parseThinkingBudgetUpdate({ low: 4096, medium: 12000 }),
    { low: 4096, medium: 12000 },
  );

  for (const body of [
    {},
    { minimal: 0 },
    { minimal: -1 },
    { low: 1.5 },
    { medium: "8192" },
    { high: null },
    { high: THINKING_BUDGET_MAX_TOKENS + 1 },
    // 思考强度有 7 档，但预算只有 4 个键：off 没有预算，xhigh/max 折回 high。
    { off: 1024 },
    { xhigh: 32768 },
    { max: 32768 },
    null,
    [1, 2],
  ]) {
    assert.throws(
      () => parseThinkingBudgetUpdate(body),
      TypeError,
      `should reject ${JSON.stringify(body)}`,
    );
  }
});
