// Shared setup for the functional suite: one desktop viewport and a live
// network, so the app talks to the pi-web server running on 127.0.0.1:30142.
//
// The headless host has no network unless `network: "live"` is given (a bare
// `open` fails every request with "this host has no network stack"); that is
// what `shell.test.tsx`'s offline case checks, and every other file asks for
// the live network so the real session list, transcript and files are read.
import { open, type App } from "nsh/test";

/**
 * The sidebar's first session row, whatever it is.
 *
 * Titles are the machine's own history — a session started in the terminal,
 * a subagent folded under its parent, a project renamed — so a test that
 * names one depends on what happened to be run before it. The rows carry
 * `testID={"session:" + id}` (`SessionsPanel.tsx`), so the first row is a
 * stable target and every test derives its expectations from it.
 */
export const FIRST_SESSION = "id:session-row >> nth=0";

/** This checkout's folder name, which is the project group the file tests need. */
export const PROJECT = "pi-next-src-20261026-0125";

/**
 * Opens the first session *of `project`*: its cwd is what the file tree, the
 * git changes and the terminal read, so those tests must not land on another
 * project's session just because it is newer.
 *
 * Typing the folder into the sidebar's search filters by cwd as well as by
 * title (`state.ts` `matches`), and a filter shows every hit (no "show more"
 * window), so the first row is that project's newest session.
 */
export async function chooseProjectSession(app: App, project = PROJECT): Promise<void> {
  await openSearch(app);
  await app.type("id:search-sessions", project);
  await app.waitFor(FIRST_SESSION, { timeout: 15000 });
  await app.press(FIRST_SESSION);
  await app.wait(900);
  // Clear the filter so the test sees the sidebar it would in use.
  await app.clear("id:search-sessions");
  await app.wait(300);
}

/**
 * The search pill is closed by default (its icon in the header opens it):
 * tests that filter the list press the icon first, and a test that left it
 * open is left alone.
 */
export async function openSearch(app: App): Promise<void> {
  if (!app.shows("id:search-sessions")) {
    await app.press("id:search-toggle");
    await app.waitFor("id:search-sessions", { timeout: 5000 });
  }
}

/** A desktop viewport: the shell's sidebar, chat and right pane all show. */
export const DESKTOP = {
  platform: "macos" as const,
  width: 1280,
  height: 800,
  network: "live" as const,
  // The suite asserts English labels; a machine set to 中文 would fail every
  // `text:…` selector otherwise (`--target macos` runs with the system locale).
  locale: "en-US" as const,
};

/** Opens the app on the desktop viewport with the real pi-web server. */
export function openApp(): Promise<App> {
  return open("../App.tsx", DESKTOP);
}

/** Opens the app and waits until the sidebar has loaded the real session list. */
export async function openAppWithSessions(): Promise<App> {
  const app = await openApp();
  // The sidebar's band label follows the app's language (the machine's
  // preference file): accept either spelling.
  await app.waitFor("text:/CONVERSATIONS|会话|會話|Projects|项目/", { timeout: 15000 });
  // The first row is the readiness signal: the header ("Search sessions")
  // draws before the list arrives, while the rows appear with "Loading
  // sessions" gone. Which rows those are depends on the machine's history.
  await app.waitFor(FIRST_SESSION, { timeout: 20000 });
  return app;
}

/**
 * Filters the sidebar to `title` and presses its row, or presses the first row
 * when no title is given. The search field is the only way to reach a row the
 * list has scrolled past, so a named session starts here.
 */
export async function chooseSession(app: App, title?: string): Promise<void> {
  if (title === undefined) {
    await app.waitFor(FIRST_SESSION, { timeout: 15000 });
    await app.press(FIRST_SESSION);
    await app.wait(800);
    return;
  }
  await openSearch(app);
  await app.type("id:search-sessions", title);
  await app.waitFor(`text:${title}`, { timeout: 15000 });
  await app.press(`text:${title}`);
  // The chat reads the transcript and connects its stream after the press.
  await app.wait(800);
}
