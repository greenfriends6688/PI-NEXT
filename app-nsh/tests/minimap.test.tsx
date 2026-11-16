// The turn rail: a tick a turn, every turn the transcript holds. A session
// with one turn has no rail (the rail is for navigating between turns), so the
// test opens one of the machine's older, human-written conversations — the
// sidebar's second row — where turns are the person's prompts.
import { expect, test } from "nsh/test";
import { openAppWithSessions } from "./support";

test("the turn rail draws a tick for every turn of a multi-turn session", async () => {
  const app = await openAppWithSessions();

  // Row 0 is this refactor's own one-turn conversation; row 1 is the previous
  // human conversation, which has several prompts. The rail's absence is a
  // legitimate answer for a one-turn row, so a miss only fails the assertion
  // below, not the press.
  await app.press("id:session-row >> nth=1");
  await app.waitFor("id:chat-minimap", { timeout: 20000 });

  const ticks = app.count("id:chat-minimap-tick");
  // One tick a turn, and a rail needs at least two turns.
  expect(ticks).toBeGreaterThan(1);
  // Not a sampled handful: the rail is the only one, and it holds every tick
  // the transcript's loaded turns give it.
  expect(app.count("id:chat-minimap")).toBe(1);
}, 60000);
