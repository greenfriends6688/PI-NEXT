// The ⌘K command palette: it opens, lists the app's commands, runs one, and
// closes on Escape.
import { expect, test } from "nsh/test";
import { FIRST_SESSION, chooseSession, openAppWithSessions } from "./support";

test("opens with mod+k, lists commands, and closes with Escape", async () => {
  const app = await openAppWithSessions();
  await chooseSession(app);

  await app.keyboard.press("mod+k");
  await app.waitFor("text:Open settings", { timeout: 5000 });

  // Rows from every group, including the session-only ones.
  expect(app.shows("text:New session")).toBe(true);
  expect(app.shows("text:Show files")).toBe(true);
  expect(app.shows("text:Show changes")).toBe(true);
  expect(app.shows("text:Show terminal")).toBe(true);
  expect(app.shows("text:Compact conversation")).toBe(true);
  expect(app.shows("text:Open settings")).toBe(true);
  expect(app.shows("text:/Type a command/")).toBe(true);

  await app.keyboard.press("escape");
  await app.wait(500);
  expect(app.shows("text:Open settings")).toBe(false);
});

test("runs Show files from the palette", async () => {
  const app = await openAppWithSessions();
  await chooseSession(app);

  await app.keyboard.press("mod+k");
  await app.waitFor("text:Show files", { timeout: 5000 });
  await app.press("text:Show files");

  // The palette closes and the files pane takes the right column: its tree is
  // what shows (a file opens in a tab of its own, `screens/files/tabs.ts`).
  await app.waitFor("label:Refresh file list", { timeout: 10000 });
  expect(app.shows("text:Open settings")).toBe(false);
  expect(app.shows("id:pane:changes")).toBe(true);
  expect(app.shows("id:pane:terminal")).toBe(true);
  expect(app.shows("label:Close file panel")).toBe(true);
});
