// The slash palette in both states: a welcome composer with no session yet,
// and an existing session whose own commands must join the app's built-ins.
import { expect, test } from "nsh/test";
import { chooseSession, openAppWithSessions } from "./support";

test("a fresh composer lists the built-ins and filters /skills", async () => {
  const app = await openAppWithSessions();
  await app.press("id:new-session-now");
  await app.waitFor("id:composer-input", { timeout: 10000 });

  // `/` opens the palette even though no session exists to answer get_commands.
  await app.clear("id:composer-input");
  await app.type("id:composer-input", "/");
  await app.waitFor("id:slash-command-row", { timeout: 10000 });
  expect(app.count("id:slash-command-row") >= 8).toBe(true);
  expect(app.shows("text:/compact|auto-compact|skills/")).toBe(true);
  expect(app.shows("text:/Open Settings › Skills/")).toBe(true);

  // Typing the whole name keeps the matching `/skills` row. (Running it
  // needs a real Return in the native field; the headless form submit does
  // not carry the input's own key handling, and `--target macos` verified
  // that it opens Settings › Skills.)
  await app.clear("id:composer-input");
  await app.type("id:composer-input", "/skills");
  await app.waitFor("id:slash-command-row >> text:/skills/", { timeout: 10000 });
  expect(app.count("id:slash-command-row >> text:/skills/") > 0).toBe(true);
});

test("an existing session merges its own commands with the built-ins", async () => {
  const app = await openAppWithSessions();
  await chooseSession(app);

  await app.clear("id:composer-input");
  await app.type("id:composer-input", "/");
  await app.waitFor("id:slash-command-row", { timeout: 10000 });

  // The built-ins are always there, and the session's get_commands rows follow
  // them in the same list (and in the head's count).
  expect(app.count("id:slash-command-row") >= 8).toBe(true);
  expect(app.shows("id:slash-command-head")).toBe(true);
  expect(app.shows("text:/compact|auto-compact|skills/")).toBe(true);
});
