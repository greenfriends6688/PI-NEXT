// A session's default title is its first user message, not the JSONL file's
// name. The old fallback showed the timestamped path leaf
// (`2026-11-16T01-47-05..._id.jsonl`), which says nothing about the work.
import { expect, test } from "nsh/test";
import type { SessionInfo } from "../src/api/sessions";
import { sessionTitleOf } from "../src/screens/sidebar/state";
import { FIRST_SESSION, openAppWithSessions } from "./support";

/** A row with the fields the title rules read; the rest of the wire row is beside the point. */
function sessionWith(firstMessage: string | undefined, name?: string): SessionInfo {
  return {
    id: "session-id",
    path: "/tmp/sessions/2026-11-16T01-47-05-123Z_session-id.jsonl",
    cwd: "/tmp/project",
    modified: "2026-11-16T01:47:05.123Z",
    ...(firstMessage === undefined ? {} : { firstMessage }),
    ...(name === undefined ? {} : { name }),
  };
}

test("a title is the name, else the first message on one line, else the path leaf", () => {
  // An explicit rename still wins over the prompt.
  expect(sessionTitleOf(sessionWith("Fix the sidebar", "Renamed"))).toBe("Renamed");

  // A multi-line prompt becomes one row-sized line.
  expect(sessionTitleOf(sessionWith("  Fix\n\nthe\t sidebar  "))).toBe("Fix the sidebar");

  // A long prompt is capped with an ellipsis, and the cut backs off the high
  // half of the emoji at the boundary instead of leaving a broken surrogate.
  const long = sessionTitleOf(sessionWith(`${"a".repeat(58)}😀tail`));
  expect(long).toBe(`${"a".repeat(58)}…`);
  expect(long.length).toBeLessThanOrEqual(60);

  // No prompt (or the wire's empty-session sentinel) keeps the old path-leaf
  // fallback, so an empty session still has something to show.
  expect(sessionTitleOf(sessionWith(""))).toBe("2026-11-16T01-47-05-123Z_session-id.jsonl");
  expect(sessionTitleOf(sessionWith("(no messages)"))).toBe("2026-11-16T01-47-05-123Z_session-id.jsonl");
});

test("the first sidebar row shows a prompt instead of the transcript's file name", async () => {
  const app = await openAppWithSessions();

  // The machine's history differs every run, so this asserts the shape rather
  // than a particular session: the first row carries text, and none of its
  // text is the ISO-timestamped file leaf the old fallback produced.
  expect(app.shows(`${FIRST_SESSION} >> text:/\\S/`)).toBe(true);
  expect(app.shows(`${FIRST_SESSION} >> text:/^\\d{4}-\\d{2}-\\d{2}T/`)).toBe(false);
});
