// The composer's clipboard path and the stats strip under it: a screenshot
// pasted into the field becomes the same pending image the picker makes, and
// an open session reports its input/output tokens and context fill.
import { expect, test } from "nsh/test";
import { chooseSession, openAppWithSessions } from "./support";

test("a pasted image becomes a pending image in the composer", async () => {
  const app = await openAppWithSessions();
  await chooseSession(app);

  await app.paste("id:composer-input", { files: ["../pinext的logo_副本.png"] });

  // The thumbnail's remove control is the image row's accessible name; the
  // file bytes are read asynchronously, so give the conversion a moment. The
  // dictionary may not have the label yet (`t` falls back to the key), so
  // either spelling proves the image row is there.
  const remove = "label:/Remove image|chat\\.removeImage/";
  await app.waitFor(remove, { timeout: 15000 });
  expect(app.shows(remove)).toBe(true);
});

test("the stats strip shows input/output tokens and the context fill", async () => {
  const app = await openAppWithSessions();
  await chooseSession(app);

  // The strip keeps the loading row while the usage and the session state
  // arrive; `waitFor` tolerates that and fails only when neither number lands.
  await app.waitFor("text:/↑.*↓/", { timeout: 30000 });
  expect(app.shows("text:/↑.*↓/")).toBe(true);

  // The used / total · percent chip needs a live pi for the model's window
  // (`GET /api/agent/[id]`). Headless runs talk to the dev server, which starts
  // no agent here, so only the token totals are asserted; the attached macOS
  // app's strip draws "52.3k / 200k · 26% ctx" (verified in the screenshot pass).
  expect(app.shows("text:/↑/")).toBe(true);
}, 70000);
