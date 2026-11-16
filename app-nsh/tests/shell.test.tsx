// The shell: the app starts, the sidebar lists the real sessions, a chosen
// session fills the chat pane, and the offline path shows its error.
import { expect, open, test } from "nsh/test";
import { FIRST_SESSION, chooseSession, openAppWithSessions } from "./support";

test("starts with the sidebar and a non-empty session list", async () => {
  const app = await openAppWithSessions();

  // The brand row, the bands and two rows of the real session list.
  expect(app.shows("text:PI NEXT")).toBe(true);
  expect(app.shows("text:/CONVERSATIONS|会话|會話|Projects|项目/")).toBe(true);
  expect(app.shows("text:pi-next-src-20261026-0125")).toBe(true);
  expect(app.shows(FIRST_SESSION)).toBe(true);

  // The list is really a list: the project group counts its sessions.
  expect(app.count("text:/^\\d+$/")).toBeGreaterThan(0);

  // No transport failure is on screen while the server answers.
  expect(app.shows("text:/Request failed/")).toBe(false);
  expect(app.shows("text:Retry")).toBe(false);
});

test("a chosen session fills the chat pane with its transcript", async () => {
  const app = await openAppWithSessions();
  await chooseSession(app);

  // The transcript is not empty: whatever the row, a session in this project
  // has turns, tool cards and a model line.
  await app.waitFor("text:/Thought|Done/", { timeout: 15000 });
  expect(app.shows(FIRST_SESSION)).toBe(true);

  // The transcript draws its assistant text, and scrolling up brings the
  // tool cards into the virtualized list (their accessibility label is the
  // tool's name). A real host's scroll is coarser than the headless one's, so
  // it may take a second pull.
  expect(app.shows("text:/Thought|Done/")).toBe(true);
  // A tool card or its output: which tools a session holds is its own story,
  // so this only asks that the transcript carries one.
  for (let pull = 0; pull < 3 && app.count("text:/^(bash|read|write|edit|grep)$/") === 0; pull++) {
    await app.scroll("text:Thought >> nth=0", -800);
    await app.wait(400);
  }
  expect(app.count("text:/^(bash|read|write|edit|grep)$/")).toBeGreaterThan(0);

  // The composer belongs to the chat pane: the file picker's button and the
  // message field (by its test id, which the language cannot change).
  expect(app.shows("label:Attach files")).toBe(true);
  expect(app.count("id:composer-input")).toBe(1);
});

test("without a server the app shows its connection card", async () => {
  // No `network` option: the headless host refuses every request, so the
  // client cannot reach pi-web.
  const app = await open("../App.tsx", { platform: "macos", width: 1280, height: 800 });
  // Attached to the pi this machine has, there is nothing to start and the
  // shell draws straight away — the card is for a machine without one.
  if (app.shows(FIRST_SESSION)) return;
  // The app brings its own agent: with no network it cannot start it, so the
  // card says what it is doing and offers the two ways on.
  await app.waitFor("text:/Starting the built-in agent|正在启动内置 agent/", { timeout: 15000 });

  expect(app.shows("text:/Starting the built-in agent|正在启动内置 agent/")).toBe(true);
  expect(app.shows("text:/Start the agent|重新启动 agent/")).toBe(true);
  expect(app.shows("text:/Check again|重新检查/")).toBe(true);
});

test("the search pill stays closed until its icon opens it", async () => {
  const app = await openAppWithSessions();

  // Closed by default: the header carries an icon, not a field.
  expect(app.shows("id:search-sessions")).toBe(false);
  expect(app.shows("id:search-toggle")).toBe(true);

  await app.press("id:search-toggle");
  await app.waitFor("id:search-sessions", { timeout: 5000 });
  expect(app.shows("id:search-sessions")).toBe(true);
});

test("a project's menu opens it in the browser and deletes its sessions", async () => {
  const app = await openAppWithSessions();
  const openInTab = "text:/Open in new tab|在新标签页打开/";
  const deleteAll = "label:/^Delete all sessions|^删除全部会话/";

  // The group header's menu, as a desktop opens it: the rows on screen are the
  // menu's (the tree rows and the chat are behind it).
  await app.rightClick("text:pi-next-src-20261026-0125 >> nth=0");
  await app.wait(500);
  expect(app.shows(openInTab)).toBe(true);
  expect(app.shows(deleteAll)).toBe(true);
  expect(app.shows("text:/Collapse other projects|折叠其他项目/")).toBe(true);

  // "Delete all sessions" asks first, in a dialog that only appears now.
  await app.press(`${deleteAll} >> nth=0`);
  await app.wait(800);
  // The confirmation names the project and what it removes.
  expect(app.shows("text:/Delete all sessions|删除.*全部会话/")).toBe(true);
  expect(app.shows("text:/running now are kept|运行中的会话会保留/")).toBe(true);
  expect(app.shows("text:/^(Delete|删除)$/")).toBe(true);
});
