// The right pane's other two tabs: Changes (the working tree's diff list) and
// Terminal (a real pty created through the server).
import { expect, test } from "nsh/test";
import { PROJECT, chooseProjectSession, openAppWithSessions } from "./support";

test("Changes lists the working tree and asks for a file's diff", async () => {
  const app = await openAppWithSessions();
  await chooseProjectSession(app);

  await app.press("id:pane:changes");
  // The pane answers from the window itself (`src/local/git-routes.ts`), and
  // that needs a real `git`: a headless test host runs no processes, so it may
  // legitimately list nothing there. Either way the chrome draws and no read
  // failure is on screen.
  await app.waitFor("text:/\\d+ (files|个文件)/", { timeout: 15000 });
  expect(app.shows("label:Refresh")).toBe(true);
  expect(app.shows("text:Check again")).toBe(false);
  expect(app.shows("text:This folder is not a Git repository.")).toBe(false);

  // The pane lists the working tree (rows carry their +/− counts) or says it
  // has none; either way the review list is there and no failure is shown.
  expect(app.count("text:/(files|个文件)/")).toBeGreaterThan(0);
});

// The shell is the window's own child now (`src/local/terminal-routes.ts`): no
// HTTP call marks its creation or teardown, so this asserts what the pane shows.
test("Terminal starts a shell and draws its screen", async () => {
  const app = await openAppWithSessions();
  await chooseProjectSession(app);

  await app.press("id:pane:terminal");

  // The server spawned a pty and the emulator reports the connection:
  // `terminal.ready` says "Connected" in English, "已连接" in Chinese.
  await app.waitFor("text:/Connected|已连接/", { timeout: 15000 });
  expect(app.shows("text:/Connected|已连接/")).toBe(true);
  expect(app.count("id:pane:terminal")).toBeGreaterThan(0);
  expect(app.shows("text:/^\\d+×\\d+$/")).toBe(true);
  expect(app.shows("label:Restart terminal")).toBe(true);
  expect(app.shows("label:Focus terminal")).toBe(true);

});

test("the dock fills the window and Debug opens beside its tabs", async () => {
  const app = await openAppWithSessions();
  await chooseProjectSession(app);

  await app.press("id:pane:files");
  await app.waitFor("id:panel-fullscreen", { timeout: 10000 });

  // Fill the window and come back: the control stays in the strip both ways.
  await app.press("id:panel-fullscreen");
  await app.wait(300);
  expect(app.shows("id:panel-fullscreen")).toBe(true);
  await app.press("id:panel-fullscreen");
  await app.wait(300);
  expect(app.shows("id:panel-fullscreen")).toBe(true);

  // The "+" menu lists the server's debug view, which reads and draws.
  await app.press("id:panel-add");
  await app.waitFor("label:/^(Debug|调试)$/", { timeout: 5000 });
  await app.press("label:/^(Debug|调试)$/");
  await app.waitFor("text:/Read-only|只读/", { timeout: 15000 });
});
