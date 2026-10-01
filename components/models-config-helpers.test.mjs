// fork:upstream-0.9.2-thinking-profile — D2-PR-21 展示层的单测
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { formatThinkingRequestParams, serializeHeaderRows } = await createJiti(import.meta.url)
  .import("./models-config-helpers.ts");

test("A1 — header rows with a blank value never reach models.json", () => {
  assert.deepEqual(
    serializeHeaderRows([
      { id: 0, name: "X-Api-Key", value: "sk-live" },
      { id: 1, name: "X-Trace", value: "" },
      { id: 2, name: "X-Spaced", value: "   " },
      { id: 3, name: "", value: "orphan" },
    ]),
    { "X-Api-Key": "sk-live" },
  );
});

test("A1 — a model left with no usable rows clears its header overrides", () => {
  assert.equal(serializeHeaderRows([{ id: 0, name: "X-Trace", value: "" }]), undefined);
  assert.equal(serializeHeaderRows([]), undefined);
});

test("A1 — non-blank rows keep their value verbatim and the last duplicate wins", () => {
  assert.deepEqual(
    serializeHeaderRows([
      { id: 0, name: " X-Key ", value: " first " },
      { id: 1, name: "X-Key", value: "second" },
    ]),
    { "X-Key": "second" },
  );
});

test("flattens nested request params into one line", () => {
  assert.equal(
    formatThinkingRequestParams({ reasoning_effort: "high" }),
    "reasoning_effort=high",
  );
  assert.equal(
    formatThinkingRequestParams({ thinking: { type: "enabled", budget_tokens: 8192, display: "summarized" } }),
    "thinking.type=enabled, thinking.budget_tokens=8192, thinking.display=summarized",
  );
  assert.equal(
    formatThinkingRequestParams({ thinkingConfig: { includeThoughts: true, thinkingLevel: "HIGH" } }),
    "thinkingConfig.includeThoughts=true, thinkingConfig.thinkingLevel=HIGH",
  );
  assert.equal(
    formatThinkingRequestParams({ reasoning: { effort: "none" }, include: ["reasoning.encrypted_content"] }),
    "reasoning.effort=none, include=reasoning.encrypted_content",
  );
});

test("returns null when a level sends no reasoning params", () => {
  assert.equal(formatThinkingRequestParams({}), null);
});
