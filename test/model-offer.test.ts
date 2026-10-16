import test from "node:test";
import assert from "node:assert/strict";
import { isOfferedModel } from "../src/main/engine/model-offer.ts";
import type { ProviderModel } from "../src/shared/types.ts";

/**
 * Which stored models are offered, and which are merely *kept*.
 *
 * The distinction matters because `models.json` is the only provider configuration the
 * engine reads: a model filtered out here is not merely hidden from a menu, it does not
 * exist as far as the session is concerned — and the same function decides what the
 * composer's list shows, so the two cannot disagree.
 */

const model = (over: Partial<ProviderModel> = {}): ProviderModel => ({
  id: "claude-sonnet-4-6",
  name: "Sonnet",
  contextWindow: 200_000,
  maxTokens: 8_000,
  reasoning: true,
  input: ["text"],
  ...over,
});

test("an ordinary model is offered", () => {
  assert.equal(isOfferedModel(model(), "anthropic-messages"), true);
  assert.equal(isOfferedModel(model(), undefined), true, "a provider with no pinned protocol");
});

test("hiding keeps the model but stops offering it", () => {
  assert.equal(isOfferedModel(model({ hidden: true }), "openai-responses"), false);
  // The flag is the only thing that changed: everything the user tuned is still there.
  const tuned = model({ hidden: true, name: "My Sonnet", contextWindow: 500_000, edited: true });
  assert.equal(isOfferedModel(tuned, "openai-responses"), false);
  assert.equal(tuned.name, "My Sonnet");
  assert.equal(tuned.contextWindow, 500_000);
});

test("a decision-protocol model is never a chat model, hidden or not", () => {
  assert.equal(isOfferedModel(model({ api: "systemone" }), "openai-responses"), false);
  assert.equal(isOfferedModel(model({ api: "systemone", hidden: true }), undefined), false);
  // A per-model api outranks the provider's, in both directions.
  assert.equal(isOfferedModel(model({ api: "openai-responses" }), "systemone"), true);
  assert.equal(isOfferedModel(model({ api: "systemone" }), "openai-responses"), false);
  assert.equal(isOfferedModel(model({ hidden: false }), "openai-responses"), true);
});
