// fork:input-limits —— ModelInputLimits / ModelPromptCache 的读写与剪枝
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { parseLimitInput, readInputLimit, writeInputLimit, writePromptCacheSeconds } =
  await jiti.import("./ModelLimitsFields.tsx");

test("parse mirrors pi's own Typebox bounds (model-config.js:121-136)", () => {
  // 整数 ≥ 1（Type.Integer({ minimum: 1 })）
  assert.equal(parseLimitInput("5", { min: 1 }), 5);
  assert.equal(parseLimitInput(" 1 ", { min: 1 }), 1);
  assert.equal(parseLimitInput("2.6", { min: 1 }), 3);
  // 清空 / 非数字 / 越界 → undefined（删键，不是写 0）
  assert.equal(parseLimitInput("", { min: 1 }), undefined);
  assert.equal(parseLimitInput("   ", { min: 1 }), undefined);
  assert.equal(parseLimitInput("0", { min: 1 }), undefined);
  assert.equal(parseLimitInput("-3", { min: 1 }), undefined);
  assert.equal(parseLimitInput("abc", { min: 1 }), undefined);
  // jpegQuality: 整数 1..100
  assert.equal(parseLimitInput("100", { min: 1, max: 100 }), 100);
  assert.equal(parseLimitInput("101", { min: 1, max: 100 }), undefined);
  assert.equal(parseLimitInput("0", { min: 1, max: 100 }), undefined);
});

test("writing a nested leaf keeps its siblings", () => {
  const limits = writeInputLimit({ images: { maxPerMessage: 4 } }, "images.resize.maxWidth", 1568);
  assert.deepEqual(limits, { images: { maxPerMessage: 4, resize: { maxWidth: 1568 } } });
  assert.equal(readInputLimit(limits, "images.resize.maxWidth"), 1568);
  assert.equal(readInputLimit(limits, "images.maxPerMessage"), 4);
});

test("clearing the last leaf prunes images, resize and inputLimits entirely", () => {
  // models.json 里不该攒下一堆 `{ inputLimits: { images: { resize: {} } } }` 空壳。
  let limits = writeInputLimit(undefined, "images.resize.jpegQuality", 80);
  assert.deepEqual(limits, { images: { resize: { jpegQuality: 80 } } });
  limits = writeInputLimit(limits, "images.resize.jpegQuality", undefined);
  assert.equal(limits, undefined);
  assert.equal(readInputLimit(limits, "images.resize.jpegQuality"), undefined);
});

test("pruning stops as soon as a sibling keeps the parent alive", () => {
  const withTwo = writeInputLimit({ maxRequestBytes: 1000 }, "images.maxPerRequest", 9);
  assert.deepEqual(withTwo, { maxRequestBytes: 1000, images: { maxPerRequest: 9 } });
  const trimmed = writeInputLimit(withTwo, "images.maxPerRequest", undefined);
  assert.deepEqual(trimmed, { maxRequestBytes: 1000 });
  const bare = writeInputLimit(trimmed, "maxRequestBytes", undefined);
  assert.equal(bare, undefined);
});

test("writes never mutate the object they were given", () => {
  const original = { images: { resize: { maxWidth: 100 } } };
  const snapshot = structuredClone(original);
  writeInputLimit(original, "images.resize.maxHeight", 200);
  writeInputLimit(original, "images.resize.maxWidth", undefined);
  assert.deepEqual(original, snapshot);
});

test("every documented path reads back what it wrote", () => {
  const paths = [
    ["maxRequestBytes", 10],
    ["images.maxPerMessage", 11],
    ["images.maxPerRequest", 12],
    ["images.resize.maxWidth", 13],
    ["images.resize.maxHeight", 14],
    ["images.resize.maxBytes", 15],
    ["images.resize.jpegQuality", 80],
  ];
  let limits = undefined;
  for (const [path, value] of paths) {
    limits = writeInputLimit(limits, path, value);
    assert.equal(readInputLimit(limits, path), value, `${path} should read back ${value}`);
  }
  assert.deepEqual(limits, {
    maxRequestBytes: 10,
    images: {
      maxPerMessage: 11,
      maxPerRequest: 12,
      resize: { maxWidth: 13, maxHeight: 14, maxBytes: 15, jpegQuality: 80 },
    },
  });
});

test("reading through a missing branch is undefined, never a throw", () => {
  assert.equal(readInputLimit(undefined, "images.resize.maxWidth"), undefined);
  assert.equal(readInputLimit({}, "images.maxPerMessage"), undefined);
  assert.equal(readInputLimit({ images: {} }, "images.resize.maxWidth"), undefined);
});

test("promptCache has exactly the two tiers, in seconds, and prunes when empty", () => {
  let cache = writePromptCacheSeconds(undefined, "short", 300);
  assert.deepEqual(cache, { short: 300 });
  cache = writePromptCacheSeconds(cache, "long", 3600);
  assert.deepEqual(cache, { short: 300, long: 3600 });
  assert.equal(cache.long, 3600);
  cache = writePromptCacheSeconds(cache, "short", undefined);
  assert.deepEqual(cache, { long: 3600 });
  assert.equal(writePromptCacheSeconds(cache, "long", undefined), undefined);
});