import { test } from "node:test";
import assert from "node:assert/strict";
import { conversationToMarkdown } from "../src/main/engine/export-markdown.ts";
import type { ChatMessage } from "../src/shared/types.ts";

/**
 * The Markdown export.
 *
 * It exists because the HTML export comes from the SDK and is a *page*; this is the thing a
 * person pastes into a document. So the tests are about what a reader of that paste needs:
 * who spoke, what was asked, and that a tool ran — without the parts that would make the
 * paste unusable (fences that break, tool bodies inlined, timestamps as noise).
 */

function message(role: ChatMessage["role"], text: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id: `${role}-${text.slice(0, 6)}`, role, text, tools: [], ...extra };
}

test("the title comes from the first user message, and the speakers are marked", () => {
  const markdown = conversationToMarkdown([
    message("user", "How do I rotate a key?"),
    message("assistant", "Three steps."),
  ]);
  assert.match(markdown, /^# How do I rotate a key\?/);
  assert.match(markdown, /## User/);
  assert.match(markdown, /## Assistant/);
  assert.match(markdown, /Three steps\./);
});

test("a system message is left out", () => {
  // The transcript's system rows carry tool schemas and housekeeping; pasting them makes the
  // document unreadable and leaks nothing a reader wanted.
  const markdown = conversationToMarkdown([
    message("system", "You are a helpful agent. Tools: read, bash, edit…"),
    message("user", "hello"),
  ]);
  assert.doesNotMatch(markdown, /helpful agent/);
  assert.match(markdown, /hello/);
});

test("a tool call is one line naming the tool and what it acted on", () => {
  const markdown = conversationToMarkdown([
    message("assistant", "Let me look.", {
      tools: [{ id: "t1", name: "read", status: "ok", args: { path: "/tmp/a.ts" } }],
    }),
  ]);
  assert.match(markdown, /- `read`/);
  assert.match(markdown, /\/tmp\/a\.ts/);
  // The result body is not inlined — that belongs to the file, not the document.
  assert.doesNotMatch(markdown, /result/);
});

test("thinking is off by default and can be included", () => {
  const withThinking = [message("assistant", "Done.", { thinking: "First I checked the file." })];
  assert.doesNotMatch(conversationToMarkdown(withThinking), /First I checked/);
  const included = conversationToMarkdown(withThinking, { includeThinking: true });
  assert.match(included, /First I checked/);
  assert.match(included, /<summary>Thinking<\/summary>/);
});

test("a body that already contains a fence widens the outer one instead of breaking the document", () => {
  // The failure this prevents is silent and total: a three-backtick body inside a
  // three-backtick fence ends the block early and the rest renders as prose.
  const markdown = conversationToMarkdown([
    message("assistant", "Here is the snippet:\n\n````\ncode\n````\n\nThat is all."),
  ]);
  assert.match(markdown, /That is all\./);
  assert.equal(markdown.includes("````\ncode\n````"), true);
});

test("the header carries the context a pasted export needs, and the body carries no timestamps", () => {
  const markdown = conversationToMarkdown([message("user", "hi")], {
    cwd: "/Users/me/project",
    exportedAt: "2026-10-14T00:00:00.000Z",
  });
  assert.match(markdown, /\/Users\/me\/project/);
  assert.match(markdown, /2026-10-14T00:00:00\.000Z/);
  // Exactly two mentions: both in the header.
  assert.equal((markdown.match(/2026-10-14T00:00:00\.000Z/g) ?? []).length, 1);
});

test("an empty conversation still produces a valid document", () => {
  const markdown = conversationToMarkdown([]);
  assert.match(markdown, /^# Conversation/);
  assert.equal(markdown.endsWith("\n"), true);
});
