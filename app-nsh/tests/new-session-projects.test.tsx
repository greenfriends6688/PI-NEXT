// The fresh composer's project pill: it opens the menu of projects the
// sidebar already lists, today's default directory, and the folder chooser,
// as pi-next's `NewSessionContextBar` does. The test reads the machine's real
// session list, so it finds this checkout's project by its folder name rather
// than by a fixed position in the menu.
import { expect, test } from "nsh/test";
import { PROJECT, openAppWithSessions } from "./support";

const DEFAULT_DIRECTORY = "text:/Use default directory|使用默认目录|使用預設目錄/";
// A project row's accessible name is its display name and its root; the
// checkout's folder name is the part that is stable. (Menu items' test ids are
// not exposed by this host; the label is.)
const REPO_ROW = `label:/^${PROJECT},/ >> nth=0`;
// A folder without trust asks first; this checkout is trusted on the machine,
// so the dialog normally stays away and the row moves the pill directly.
const TRUST_DIALOG = "text:/Trust this project\\?|信任此项目\\?|信任此專案\\?/";
const TRUST_BUTTON = "label:/Trust project|信任项目|信任專案/";

test("the project pill offers the sidebar's projects and the default directory", async () => {
  const app = await openAppWithSessions();

  // "+ New session" opens the fresh composer, whose project bar is what this
  // test drives.
  await app.press("id:new-session-now");
  // The welcome page's project pill: a session's composer would have
  // `composer-input` too, so waiting on that races the shell's remount.
  await app.waitFor("id:new-session-project", { timeout: 15000 });

  // A plain press on the pill opens the menu, not the system folder chooser.
  await app.press("id:new-session-project");
  await app.waitFor("id:new-session-project-menu", { timeout: 10000 });
  expect(app.shows(DEFAULT_DIRECTORY)).toBe(true);
  expect(app.shows("id:project-browse")).toBe(true);

  // At least one project row comes from the machine's real sessions, and this
  // checkout is one of them (the suite's other files already use its folder).
  await app.waitFor(REPO_ROW, { timeout: 15000 });

  // Choosing this checkout moves the pill there, or asks about trust first.
  const pillProject = `id:new-session-project >> text:${PROJECT}`;
  await app.press(REPO_ROW);
  try {
    await app.waitFor(pillProject, { timeout: 15000 });
  } catch (error) {
    // A folder without trust keeps the old pill behind its dialog; answer it
    // and wait for the move it allows. If the dialog never came, the pill's
    // own timeout is the real failure.
    if (!app.shows(TRUST_DIALOG)) throw error;
    expect(app.enabled(TRUST_BUTTON)).toBe(true);
    await app.press(TRUST_BUTTON);
    await app.waitFor(TRUST_DIALOG, { state: "gone", timeout: 20000 });
    await app.waitFor(pillProject, { timeout: 15000 });
  }

  // The pill's name belongs to this checkout now, whether it was already the
  // active folder or the row just moved it.
  expect(app.shows(pillProject)).toBe(true);
});
