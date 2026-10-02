// PR-36 · `Agent` 工具 thinkingLevel 的归一化：不支持的档位夹到最近可用档，而不是报错。
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  THINKING_LEVELS,
  normalizeSubagentThinkingLevel,
} = await jiti.import("./subagent-thinking.ts");

test("the level list is the repo-wide thinking level set", () => {
  assert.deepEqual(
    [...THINKING_LEVELS],
    ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
  );
});

test("a supported level is left untouched", () => {
  const model = { reasoning: true };
  for (const level of ["off", "minimal", "low", "medium", "high"]) {
    assert.equal(normalizeSubagentThinkingLevel(level, model, {}), level);
  }
});

test("xhigh/max are normalized to the strongest available level when unmapped", () => {
  const model = { reasoning: true };
  // 空 map 下 xhigh/max 不在支持表里（pi-ai 规则），夹到 high。
  assert.equal(normalizeSubagentThinkingLevel("xhigh", model, {}), "high");
  assert.equal(normalizeSubagentThinkingLevel("max", model, {}), "high");
  // 显式映射 xhigh 后，max 夹到最近的 xhigh。
  assert.equal(normalizeSubagentThinkingLevel("max", model, { xhigh: "xhigh" }), "xhigh");
});

test("a non-reasoning model collapses every level to off", () => {
  const model = { reasoning: false };
  assert.equal(normalizeSubagentThinkingLevel("high", model, {}), "off");
  assert.equal(normalizeSubagentThinkingLevel("max", model, {}), "off");
});

test("an unsupported off walks up to the weakest available level", () => {
  const model = { reasoning: true };
  assert.equal(normalizeSubagentThinkingLevel("off", model, { off: null }), "minimal");
});

test("an unknown string falls back to the first supported level", () => {
  const model = { reasoning: true };
  assert.equal(normalizeSubagentThinkingLevel("extreme", model, {}), "off");
  assert.equal(normalizeSubagentThinkingLevel("extreme", model, { off: null }), "minimal");
});
