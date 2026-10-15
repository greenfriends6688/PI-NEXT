import assert from "node:assert/strict";
import test from "node:test";
import { bindBrowserConversation } from "../src/main/pi/conversation-binding.ts";

const globals = globalThis as Record<string, unknown>;
const browserKey = "__pinextBrowserConversationId";

test("concurrent extension reloads capture their own browser conversation", async () => {
  const beforeBrowser = globals[browserKey];
  const seen: string[] = [];
  const results = await Promise.all(["a", "b", "c"].map((id) =>
    bindBrowserConversation(id, async () => {
      assert.equal(globals[browserKey], id);
      await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(globals[browserKey], id);
      seen.push(id);
      return id;
    }),
  ));
  assert.deepEqual(results, ["a", "b", "c"]);
  assert.deepEqual(seen, results);
  assert.equal(globals[browserKey], beforeBrowser);
});

test("failed reload restores existing scope and does not poison the next reload", async () => {
  globals[browserKey] = "previous";
  try {
    await assert.rejects(bindBrowserConversation("failed", async () => {
      assert.equal(globals[browserKey], "failed");
      throw new Error("reload failed");
    }), /reload failed/);
    assert.equal(globals[browserKey], "previous");
    await bindBrowserConversation("next", async () => {
      assert.equal(globals[browserKey], "next");
    });
    assert.equal(globals[browserKey], "previous");
  } finally {
    delete globals[browserKey];
  }
});
