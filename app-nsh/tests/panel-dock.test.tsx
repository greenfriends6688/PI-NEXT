// The right pane's frame: from 1024 up it is a docked column like the sidebar,
// and only the windows below that get pi-next's floating panel and its scrim.
import { expect, open, test } from "nsh/test";
import { DESKTOP } from "./support";

test("the files pane is a docked column at 1280", async () => {
  const app = await open("../App.tsx", { ...DESKTOP, width: 1280 });

  // The top bar's files button is the shell's own, present before a session
  // is chosen; pressing it opens the dock on the files tab.
  await app.waitFor("id:pane:files", { timeout: 15000 });
  await app.press("id:pane:files");
  await app.waitFor("id:right-pane", { timeout: 5000 });

  // A column shares the row, so there is no backdrop dimming the chat.
  expect(app.shows("id:right-pane")).toBe(true);
  expect(app.shows("id:panel-scrim")).toBe(false);
});

test("below 1024 the files pane floats over a scrim", async () => {
  const app = await open("../App.tsx", { ...DESKTOP, width: 900 });

  await app.waitFor("id:pane:files", { timeout: 15000 });
  await app.press("id:pane:files");
  await app.waitFor("id:right-pane", { timeout: 5000 });

  // At 900 the row has no room for a third column: the pane floats and its
  // scrim closes it on a press.
  expect(app.shows("id:right-pane")).toBe(true);
  expect(app.shows("id:panel-scrim")).toBe(true);
});
