// fork:thinking-level-prefill —— 预选推理强度的取值与优先级
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { resolvePrefilledThinkingLevel, thinkingLevelScopeKey } =
  await createJiti(import.meta.url).import("./thinking-level-prefill.ts");

const MODEL = { provider: "anthropic", modelId: "claude-sonnet-4" };
const LEVELS = { [`${MODEL.provider}:${MODEL.modelId}`]: ["low", "medium", "high"] };

test("the remembered level is preselected for that exact model", () => {
  const prefill = resolvePrefilledThinkingLevel({
    ...MODEL,
    thinkingLevels: LEVELS,
    thinkingLevelMemory: { "anthropic/claude-sonnet-4": "high" },
  });
  assert.deepEqual(prefill, { level: "high", source: "memory" });
});

test("no memory means nothing to preselect (the caller keeps 'auto')", () => {
  assert.equal(resolvePrefilledThinkingLevel({ ...MODEL, thinkingLevels: LEVELS }), null);
  assert.equal(resolvePrefilledThinkingLevel({
    ...MODEL,
    thinkingLevels: LEVELS,
    thinkingLevelMemory: { "anthropic/other-model": "high" },
  }), null);
});

test("an enabledModels pin wins over the memory", () => {
  const prefill = resolvePrefilledThinkingLevel({
    ...MODEL,
    thinkingLevels: LEVELS,
    thinkingLevelPins: { "anthropic/claude-sonnet-4": "medium" },
    thinkingLevelMemory: { "anthropic/claude-sonnet-4": "high" },
  });
  assert.deepEqual(prefill, { level: "medium", source: "pin" });
});

test("a pin counts even when the model has no recorded memory yet", () => {
  assert.deepEqual(
    resolvePrefilledThinkingLevel({
      ...MODEL,
      thinkingLevelPins: { "anthropic/claude-sonnet-4": "low" },
    }),
    { level: "low", source: "pin" },
  );
});

test("a stale memory (level the model no longer supports) is discarded", () => {
  // 模型升级 / thinkingLevelMap 改过之后，记忆里的 xhigh 可能已经不在支持档位里。
  assert.equal(resolvePrefilledThinkingLevel({
    ...MODEL,
    thinkingLevels: { ...LEVELS, "anthropic:claude-sonnet-4": ["low", "high"] },
    thinkingLevelMemory: { "anthropic/claude-sonnet-4": "xhigh" },
  }), null);
});

test("an unknown support list means we cannot judge staleness, so the memory stands", () => {
  // 与设置页「上次使用」的显示一致：不知道支持什么，就照记忆显示。
  assert.deepEqual(
    resolvePrefilledThinkingLevel({ ...MODEL, thinkingLevelMemory: { "anthropic/claude-sonnet-4": "xhigh" } }),
    { level: "xhigh", source: "memory" },
  );
});

test("junk in the tables never becomes a preselected level", () => {
  for (const value of ["", "turbo", "AUTO", "auto", "null", null, 3, {}]) {
    assert.equal(resolvePrefilledThinkingLevel({
      ...MODEL,
      thinkingLevels: LEVELS,
      thinkingLevelMemory: { "anthropic/claude-sonnet-4": value },
      thinkingLevelPins: { "anthropic/claude-sonnet-4": value },
    }), null, `${JSON.stringify(value)} should not preselect`);
  }
});

test("'off' is a real level and is preselected like any other", () => {
  assert.deepEqual(
    resolvePrefilledThinkingLevel({
      ...MODEL,
      thinkingLevels: { "anthropic:claude-sonnet-4": ["off", "high"] },
      thinkingLevelMemory: { "anthropic/claude-sonnet-4": "off" },
    }),
    { level: "off", source: "memory" },
  );
});

test("missing tables degrade to 'nothing to preselect', never a throw", () => {
  assert.equal(resolvePrefilledThinkingLevel({ ...MODEL }), null);
  assert.equal(resolvePrefilledThinkingLevel({
    ...MODEL,
    thinkingLevels: {},
    thinkingLevelPins: {},
    thinkingLevelMemory: {},
  }), null);
});

test("the support-list key really is colon-separated while pins and memory are slashed", () => {
  // 三个表形状不一样：thinkingLevels 是 `provider:modelId`，另两张是 `provider/modelId`。
  assert.equal(thinkingLevelScopeKey("anthropic", "claude-sonnet-4"), "anthropic:claude-sonnet-4");
  assert.deepEqual(resolvePrefilledThinkingLevel({
    provider: "openai",
    modelId: "gpt-5",
    thinkingLevels: { "openai:gpt-5": ["low", "high"] },
    thinkingLevelMemory: { "openai/gpt-5": "low" },
  }), { level: "low", source: "memory" });
  // 用冒号去查记忆表是查不到的（两种 key 混用是本条最容易犯的错）。
  assert.equal(resolvePrefilledThinkingLevel({
    provider: "openai",
    modelId: "gpt-5",
    thinkingLevels: { "openai:gpt-5": ["low", "high"] },
    thinkingLevelMemory: { "openai:gpt-5": "high" },
  }), null);
});