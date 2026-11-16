// The chat's compact density: a tool call is one tight header row that opens
// to its arguments and result, and a reasoning block is a 26-point row on a
// desktop. The headless host has no per-view bounds (`app.bounds()` does not
// exist), so the height itself is left to the screenshot pass: the stable
// `id:tool-card` / `id:thinking-row` ids are what that pass targets. Here we
// check what the host can see — the card is drawn, its title shows, and it
// opens.
import { expect, test } from "nsh/test";
import { FIRST_SESSION, chooseProjectSession, openApp } from "./support";

test("a tool call is a compact card that opens to its body", async () => {
  // Open without `openAppWithSessions`: it waits for the old "Projects" band
  // caption, which the sidebar no longer shows (`sidebar.conversations` is
  // the caption now). The first session row is the readiness signal instead.
  const app = await openApp();
  await app.waitFor(FIRST_SESSION, { timeout: 20000 });
  await chooseProjectSession(app);

  // The newest session of a project can be a prompt with no tool call. The
  // sidebar keeps its rows beside the chat on a desktop, so try the first few
  // before waiting on the selected transcript's own load.
  for (let row = 0; row < 5 && app.count("id:tool-card") === 0; row++) {
    await app.wait(800);
    // A call can sit above the newest message the list opens at: scroll back
    // through the reasoning and answer rows as `features.test.tsx` does.
    for (let pull = 0; pull < 3 && app.count("id:tool-card") === 0; pull++) {
      const marker = app.shows("text:Thought") ? "text:Thought" : app.shows("text:Done") ? "text:Done" : null;
      if (!marker) break;
      await app.scroll(marker, -800);
      await app.wait(300);
    }
    if (app.count("id:tool-card") > 0 || row + 1 >= app.count(FIRST_SESSION)) break;
    await app.press(`id:session-row >> nth=${row + 1}`);
  }
  if (app.count("id:tool-card") === 0) {
    await app.waitFor("id:tool-card", { timeout: 20000 });
  }

  // The card and its header are there, and the header names the tool: its
  // title and one-line detail are text inside the card.
  expect(app.count("id:tool-card")).toBeGreaterThan(0);
  expect(app.shows("id:tool-card-header >> nth=0")).toBe(true);
  expect(app.count("id:tool-card >> text:/./")).toBeGreaterThan(0);

  // Pressing the header (not the card's frame, which does not hear presses)
  // opens the body: the arguments, the result, or the diff.
  await app.press("id:tool-card-header >> nth=0");
  await app.wait(400);
  expect(app.count("id:tool-card-body")).toBeGreaterThan(0);
});
