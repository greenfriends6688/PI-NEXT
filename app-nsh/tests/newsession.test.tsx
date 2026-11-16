// A fresh session: the bar that starts one, its folder controls, and the
// directory browser behind "Change…".
import { expect, test } from "nsh/test";
import { openAppWithSessions } from "./support";

test("the new-session bar offers a folder and a first message", async () => {
  const app = await openAppWithSessions();

  // No session chosen: the middle pane is pi-next's welcome, with the real
  // composer at the bottom (not a form of its own).
  await app.press("id:new-session-now");
  await app.waitFor("id:composer-input", { timeout: 10000 });
  expect(app.shows("id:composer-input")).toBe(true);
  expect(app.shows("text:/PI NEXT|welcome/")).toBe(true);
  // The project pill (a press changes it) and its worktrees, as pi-next's
  // context bar; the folder extras live behind the row's "…" menu.
  expect(app.shows("label:Change…")).toBe(true);
  expect(app.shows("text:/Worktrees|工作树/")).toBe(true);
  expect(app.shows("text:/pi-cwd|PI NEXT/")).toBe(true);
});

test("the project pill is the way to change the folder", async () => {
  const app = await openAppWithSessions();
  await app.press("id:new-session-now");
  await app.waitFor("id:composer-input", { timeout: 10000 });

  // The pill is a press target named "Change…": it opens the system's folder
  // chooser (Finder on macOS), which no headless test can drive. The in-app
  // directory browser stays as the fallback where no system chooser exists.
  expect(app.enabled("label:Change…")).toBe(true);
  expect(app.shows("label:Change…")).toBe(true);
  expect(app.shows("text:/Worktrees|工作树/")).toBe(true);
});

test("Models carries the provider sign-in", async () => {
  const app = await openAppWithSessions();
  await app.press("id:open-settings");
  await app.waitFor("text:Models", { timeout: 10000 });
  await app.press("text:Models");
  // Sign-in lives inside Models now (the section pi-next calls Providers was
  // folded into it), so the card that holds it is what proves it loaded.
  await app.waitFor("text:/Sign in|API key|Provider sign-in|提供方|登录/", { timeout: 15000 });
  expect(app.shows("text:/Sign in|API key|Provider sign-in|提供方|登录/")).toBe(true);
});
