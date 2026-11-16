// Files: the tree fills the pane, a folder expands, and a file opens in its
// own tab (`screens/files/tabs.ts`), as pi-next's explorer does.
import { expect, test } from "nsh/test";
import type { App } from "nsh/test";
import { PROJECT, chooseProjectSession, openAppWithSessions } from "./support";

/** Opens the files pane on the session of this project. */
async function openFiles(): Promise<App> {
  const app = await openAppWithSessions();
  await chooseProjectSession(app);
  await app.press("id:pane:files");
  // The pane opens on the tree; the tree's toolbar says it is there, and the
  // root's entries come from a request of their own — give it the frame it
  // needs now that the shell draws at once (it used to be hidden by a slow
  // start).
  await app.waitFor("label:/Refresh file list|刷新文件列表/", { timeout: 10000 });
  await app.wait(600);
  return app;
}

test("opens the pane with the tree filling it", async () => {
  const app = await openFiles();

  // The right pane's tabs and the tree's toolbar.
  expect(app.shows("id:pane:files")).toBe(true);
  expect(app.shows("id:pane:changes")).toBe(true);
  expect(app.shows("id:pane:terminal")).toBe(true);
  expect(app.shows("label:/Refresh file list|刷新文件列表/")).toBe(true);
  expect(app.shows("label:Show ignored files")).toBe(true);

  // The root is the session's folder, with its entries.
  expect(app.shows(`text:${PROJECT}`)).toBe(true);
  expect(app.shows("text:app-nsh")).toBe(true);
  expect(app.shows("text:.gitignore")).toBe(true);

  // A folder expands on one press and its children are read.
  await app.press("text:app-nsh");
  await app.waitFor("text:nsh.json", { timeout: 10000 });
  expect(app.shows("text:App.tsx")).toBe(true);
  expect(app.shows("text:src")).toBe(true);
});

test("a single press on a file opens it in a tab", async () => {
  const app = await openFiles();
  await app.press("text:app-nsh");
  await app.waitFor("text:README.md", { timeout: 10000 });

  // One press: the file becomes a tab of its own beside the tree's tab. The
  // tab's label is the file's whole path, its title the file's name.
  // The first match: a session row or the chat behind the pane can carry the
  // same words, and the explorer's own row comes first.
  await app.press("text:README.md >> nth=0");
  await app.waitFor("label:/README\\.md/", { timeout: 10000 });
  // The viewer drew the file: its Markdown is a `TextView`, so the document's
  // own text is on screen.
  await app.waitFor("text:/NSH|app-nsh|Pi Web/", { timeout: 10000 });
  expect(app.shows("label:/README\\.md/")).toBe(true);
});

test("a source file opens in the code viewer", async () => {
  const app = await openFiles();
  await app.press("text:app-nsh");
  await app.waitFor("text:App.tsx", { timeout: 10000 });

  await app.press("text:App.tsx");
  // `App.tsx` is plain source: its code is what the viewer shows, and the
  // wrap toggle belongs to a code tab. (The file's first lines, not its last:
  // a longer file scrolls, and `mount(App)` may be below the fold.)
  await app.waitFor("text:/import .* from \"nsh\"/", { timeout: 10000 });
  expect(app.shows("text:/import .* from \"nsh\"/")).toBe(true);
  expect(app.shows("label:Enable word wrap")).toBe(true);
});

test("a closed file tab goes back to the tree", async () => {
  const app = await openFiles();
  await app.press("text:app-nsh");
  await app.waitFor("text:App.tsx", { timeout: 10000 });
  await app.press("text:App.tsx");
  await app.waitFor("text:/import .* from \"nsh\"/", { timeout: 10000 });

  // Closing the file's tab puts the tree back: its toolbar is what shows.
  await app.press("label:/Close App\\.tsx/");
  await app.waitFor("label:/Refresh file list|刷新文件列表/", { timeout: 10000 });
  // The tree comes back one frame after its toolbar.
  await app.wait(400);
  expect(app.shows("text:app-nsh")).toBe(true);
});

test("a tree row offers an @mention into the composer", async () => {
  const app = await openFiles();
  await app.waitFor("label:/Mention in the composer|在输入框 @ 提及/", { timeout: 10000 });
  await app.press("label:/Mention in the composer|在输入框 @ 提及/ >> nth=0");

  // The mention lands in the draft (the composer is under the chat beside it).
  await app.wait(300);
  expect(app.value("id:composer-input")).toContain("@");
});
