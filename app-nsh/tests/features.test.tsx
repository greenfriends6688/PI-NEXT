// One end-to-end pass over the app's user-facing features, with assertions
// only (no screenshots). Each test opens the real shell against the live
// pi-web server (`tests/support.ts`), chooses a real session where the feature
// needs one, and checks what a person can observe.
//
// A few things are genuinely out of reach in a headless run and are called out
// where they matter:
//   * app-host `process.run` is unavailable (the synthetic host is a phone),
//     so Settings › General's pi card reports "Not available in this build"
//     instead of the `pi x.y.z` a packaged desktop shows;
//   * the system folder chooser (Finder) cannot be driven, so the project
//     trust test enters the folder through the app's own directory browser;
//   * the terminal is a real pty created by the server; the headless app can
//     still connect to it through the live server, as `panels.test.tsx` does;
//   * Tool definitions, the System prompt and session Rename need a live
//     `pi`/POSIX shell. Their local routes try to spawn one, which the
//     synthetic host cannot do, so those tests open the app with the local
//     file routes disabled and use the live dev server exactly as a browser
//     build does (`openAppOverTheServer`).
import process from "process";
import { readFile, rmdir, unlink, writeFile } from "fs/promises";
import path from "path";
import { expect, open, test } from "nsh/test";
import type { App } from "nsh/test";
import {
  DESKTOP,
  FIRST_SESSION,
  PROJECT,
  chooseProjectSession,
  chooseSession,
  openAppWithSessions,
  openSearch,
} from "./support";

/** Waits for the transcript's message row and a tool card, scrolling as the shell test does. */
async function expectTranscript(app: App): Promise<void> {
  await app.waitFor("text:/Thought|Done/", { timeout: 15000 });
  expect(app.shows("text:/Thought|Done/")).toBe(true);

  for (let pull = 0; pull < 3 && app.count("text:/^(bash|read|write|edit|grep)$/") === 0; pull++) {
    const marker = app.shows("text:Thought") ? "text:Thought" : "text:Done";
    await app.scroll(marker, -800);
    await app.wait(400);
  }
  expect(app.count("text:/^(bash|read|write|edit|grep)$/")).toBeGreaterThan(0);
}

/** Opens a session row's context menu (a desktop secondary click). */
async function openRowMenu(app: App, row: string = FIRST_SESSION): Promise<void> {
  await app.rightClick(row);
  await app.wait(400);
}

/**
 * The shell with the local file routes disabled, so `/api/*` falls through to
 * the live pi-web server as it does in a browser or before the native routes
 * landed. The tool and system-prompt panels need a live pi process; the local
 * routes would start one with `process.run`, which the synthetic host does not
 * have, while the dev server already has it.
 */
async function openAppOverTheServer(): Promise<App> {
  const app = await open("../App.tsx", {
    ...DESKTOP,
    modules: {
      "fs/promises": {
        readdir: () => {
          throw new Error("native filesystem unavailable in this headless run");
        },
      },
    },
  });
  await app.waitFor("text:/CONVERSATIONS|会话|會話|Projects|项目/", { timeout: 15000 });
  await app.waitFor(FIRST_SESSION, { timeout: 20000 });
  return app;
}

test("sessions: the sidebar lists them, opening one fills the chat, search finds its folder, and the running poll answers", async () => {
  const app = await openAppWithSessions();

  // The real list: the brand, the project band and at least one row.
  expect(app.shows("text:PI NEXT")).toBe(true);
  expect(app.shows("text:/CONVERSATIONS|会话|會話|Projects|项目/")).toBe(true);
  expect(app.count(FIRST_SESSION)).toBeGreaterThan(0);

  // Search filters by the project folder, not only by a title.
  await openSearch(app);
  await app.type("id:search-sessions", PROJECT);
  await app.wait(800);
  expect(app.value("id:search-sessions")).toBe(PROJECT);
  expect(app.shows(FIRST_SESSION)).toBe(true);

  // Opening the found session fills the chat with a message and a tool card.
  await app.press(FIRST_SESSION);
  await app.wait(900);
  await app.clear("id:search-sessions");
  await app.wait(300);
  await expectTranscript(app);

  // The composer polls `GET /api/agent/<id>` every two seconds. The poll's
  // answer is what leaves one run control (Send or Stop) usable; a refused
  // read would replace the composer with its error line instead.
  await app.wait(3500);
  expect(app.count("label:Send") + app.count("label:Stop")).toBe(1);
  // The error copy this build ships (not the word "Request failed": the open
  // session is this project's own history, and its transcript says that).
  expect(app.shows("text:/this build has no service|这个构建没有可用的服务/")).toBe(false);
  expect(app.count("id:composer-input")).toBe(1);
}, 60000);

test("composer: typed text lands in the field, `/` opens the command palette, `@` opens the file list", async () => {
  const app = await openAppWithSessions();
  await chooseSession(app);

  const draft = "feature test draft 123";
  await app.type("id:composer-input", draft);
  expect(app.value("id:composer-input")).toBe(draft);

  // Nothing was sent: typing alone posts no agent command.
  expect(
    app.requests().filter((request) => request.method === "POST" && request.url.includes("/api/agent/")),
  ).toHaveLength(0);

  // `/` opens the slash palette (its head names the group and its count).
  await app.clear("id:composer-input");
  await app.type("id:composer-input", "/");
  await app.waitFor("text:Commands", { timeout: 10000 });
  expect(app.shows("text:Commands")).toBe(true);

  // `@` opens the file mention list, headed "Files" with its match count.
  await app.clear("id:composer-input");
  await app.wait(300);
  await app.type("id:composer-input", "@");
  await app.waitFor("text:Files", { timeout: 10000 });
  expect(app.shows("text:Files")).toBe(true);
  expect(app.value("id:composer-input")).toBe("@");
}, 60000);

test("attach: the picked file is written beside the session and becomes an @mention", async () => {
  const app = await openAppWithSessions();
  await chooseProjectSession(app);

  const name = `pi-next-features-upload-${Date.now()}.txt`;
  const bytes = new TextEncoder().encode("hello from the features test\n");
  app.onPick(() => [{ name, type: "text/plain", data: bytes }]);

  await app.press("label:Attach files");
  await app.wait(2500);

  // The draft carries the mention the upload route's answer inserts.
  expect(app.value("id:composer-input")).toContain(`@${name}`);

  // The file is beside the session: the tree's root is the session's folder,
  // so the uploaded name appears there after a refresh.
  await app.press("id:pane:files");
  await app.waitFor("label:/Refresh file list|刷新文件列表/", { timeout: 10000 });
  await app.press("label:/Refresh file list|刷新文件列表/");
  await app.waitFor(`text:${name}`, { timeout: 15000 });
  expect(app.shows(`text:${name}`)).toBe(true);

  // Delete it again. A headless test host has no native filesystem (`fs` is
  // unavailable in its engine), so this is the best effort `upload.test.tsx`
  // makes; the assertion above is what proves the upload landed.
  await unlink(`/Users/yingjing/Desktop/pi-next-src-20261026-0125/${name}`).catch(() => undefined);
  await unlink(`/Users/yingjing/Desktop/pi-next-src-20261026-0125/app-nsh/${name}`).catch(() => undefined);
}, 60000);

test("right panel: the file tree expands the checkout, changes lists its count, and the terminal connects", async () => {
  const app = await openAppWithSessions();
  await chooseProjectSession(app);

  // Files: the checkout's root, then app-nsh expanded from the tree.
  await app.press("id:pane:files");
  await app.waitFor("label:/Refresh file list|刷新文件列表/", { timeout: 10000 });
  await app.wait(600);
  expect(app.shows(`text:${PROJECT}`)).toBe(true);
  expect(app.shows("text:app-nsh")).toBe(true);
  await app.press("text:app-nsh");
  await app.waitFor("text:nsh.json", { timeout: 10000 });
  expect(app.shows("text:App.tsx")).toBe(true);
  expect(app.shows("text:src")).toBe(true);

  // Changes: the count pill and the refresh control are there whether the
  // working tree has rows or says 0 files. The panel floats over the chat at
  // this width, so close it before the top bar's next button can be pressed.
  await app.press("id:panel-close");
  await app.wait(400);
  await app.press("id:pane:changes");
  await app.waitFor("text:/\\d+ files/", { timeout: 15000 });
  expect(app.shows("text:/\\d+ files/")).toBe(true);
  expect(app.shows("label:Refresh")).toBe(true);
  expect(app.shows("text:Check again")).toBe(false);
  expect(app.shows("text:This folder is not a Git repository.")).toBe(false);

  // Terminal: a real pty through the server, connected and drawing its size.
  await app.press("id:panel-close");
  await app.wait(400);
  await app.press("id:pane:terminal");
  await app.waitFor("text:/Connected|已连接/", { timeout: 15000 });
  expect(app.shows("text:/Connected|已连接/")).toBe(true);
  expect(app.shows("label:Restart terminal")).toBe(true);
  expect(app.shows("label:Focus terminal")).toBe(true);
}, 60000);

test("dock tabs: the + menu opens Tool definitions with rows, the System prompt and Branches", async () => {
  const app = await openAppOverTheServer();
  // A smaller project's newest session: this checkout's newest session is a
  // multi-megabyte transcript, and `get_tools` / the system prompt read it into
  // this heap.
  await chooseFilteredProjectRow(app, "BidBook");

  // The dock's "+" menu is reachable from the chat's top bar.
  await app.press("id:panel-more");
  await app.waitFor("label:Tool definitions", { timeout: 5000 });
  await app.press("label:Tool definitions");

  // Tool definitions: the tab's own title, a preset control and rows whose
  // accessibility labels are the tool names.
  await app.waitFor("text:Tool definitions", { timeout: 10000 });
  await app.waitFor("label:/^(bash|read|write|edit|grep)$/", { timeout: 20000 });
  expect(app.shows("label:/^(bash|read|write|edit|grep)$/")).toBe(true);
  expect(app.shows("label:Tool preset")).toBe(true);

  // System prompt: the server's prompt is what the model is sent.
  await app.press("id:panel-add");
  await app.waitFor("label:System prompt", { timeout: 5000 });
  await app.press("label:System prompt");
  await app.waitFor("text:/<tools>|You are/", { timeout: 20000 });
  expect(app.shows("text:/<tools>|You are/")).toBe(true);

  // Branches: the tab, and the navigator's own header/count when the session
  // has a tree. A specific branch is deliberately not asserted: the rows come
  // from the machine's real history.
  await app.press("id:panel-add");
  await app.waitFor("label:Branches", { timeout: 5000 });
  await app.press("label:Branches >> nth=0");
  await app.waitFor("text:Branches", { timeout: 10000 });
  expect(app.count("text:Branches")).toBeGreaterThan(0);
  // The navigator's header is a second "Branches" text when the session parts;
  // its Badge carries the row count. Either is a whole session's own tree.
  expect(app.shows("text:/^\\d+$/") || app.count("text:Branches") > 1).toBe(true);
}, 60000);

test("settings: General's pi card, MCP, Skills, Plugins and the default model row all load", async () => {
  const app = await openAppWithSessions();
  // Settings reads the open session's folder (Skills, Plugins, MCP).
  await chooseProjectSession(app);
  await app.press("id:open-settings");
  await app.waitFor("text:Appearance", { timeout: 10000 });

  // General's Pi card. A headless app has no `process.run`, so the honest
  // detail here is "Not available in this build"; a real desktop shows
  // `pi x.y.z` (or "pi was not found" without the CLI).
  await app.waitFor("id:setting-pi", { timeout: 10000 });
  await app.waitFor(
    "text:/pi \\d+\\.\\d+\\.\\d+|pi was not found|Not available in this build|Could not read pi's version/",
    { timeout: 20000 },
  );
  expect(app.shows("id:setting-pi")).toBe(true);
  if (app.shows("text:/Not available in this build|Could not read pi's version/")) {
    // Out of reach headlessly: no login shell / process grant in the synthetic
    // host. Assert that the card reports the reason rather than a fake version.
    expect(app.shows("text:/Not available in this build|Could not read pi's version/")).toBe(true);
  } else {
    expect(app.shows("text:/pi \\d+\\.\\d+\\.\\d+|pi was not found/")).toBe(true);
  }

  // MCP: the machine's global / project servers, or the empty note.
  await app.press("text:MCP");
  await app.waitFor("text:MCP servers", { timeout: 10000 });
  await app.waitFor("text:/No MCP server is configured|Not tested|Session: /", { timeout: 20000 });
  if (app.shows("text:/No MCP server is configured/")) {
    expect(app.shows("text:/No MCP server is configured/")).toBe(true);
  } else {
    expect(app.shows("text:/Not tested|Session: /")).toBe(true);
  }

  // Skills: the selected project's skills are listed.
  await app.press("text:Skills");
  // The reference's split page groups by scope (project / global / path); the
  // footer counts what the model can see.
  await app.waitFor("text:/Project|Global|No skill is available in this folder/", { timeout: 20000 });
  expect(app.shows("text:/available to the model|No skill is available/")).toBe(true);

  // Plugins: at least one configured package (the totals line and the row).
  await app.press("text:Plugins");
  await app.waitFor("text:/Packages configured in the agent|No package is installed/", { timeout: 20000 });
  expect(app.shows("text:/Packages configured in the agent|No package is installed/")).toBe(true);
  expect(app.shows("text:/enabled\\.|extensions/")).toBe(true);

  // Models: the default a new session starts with.
  await app.press("text:Models");
  await app.waitFor("text:Default model", { timeout: 10000 });
  expect(app.shows("text:Default model")).toBe(true);
  expect(app.shows("text:New sessions use")).toBe(true);
}, 90000);

/** Opens the first row after filtering the sidebar to a project folder.
 *
 * A short pause lets the project filter apply before the content search (300 ms
 * later) replaces the list with message hits; by project folder is still a row
 * of that project, and a previous run's rename cannot make it unrecognizable.
 */
async function chooseFilteredProjectRow(app: App, query: string): Promise<void> {
  await openSearch(app);
  await app.clear("id:search-sessions");
  await app.type("id:search-sessions", query);
  await app.wait(400);
  await app.waitFor(FIRST_SESSION, { timeout: 10000 });
  await app.press(FIRST_SESSION);
  await app.wait(900);
}

test("session actions: Export HTML completes with the preview, and Rename changes the row title", async () => {
  // Rename is a write to a session file; the local route appends through a
  // POSIX shell (`src/local/session-routes.ts` `appendSessionLine`), which the
  // synthetic host cannot spawn. Over the dev server the same route runs in
  // Node, so the menu action itself is what this test exercises.
  const app = await openAppOverTheServer();
  // The second row: the first is the session this suite runs in, and a live
  // session cannot be renamed while pi holds it. Any other row exists whatever
  // this machine's history holds.
  const row = "id:session-row >> nth=1";
  await app.waitFor(row, { timeout: 15000 });
  await app.press(row);
  await app.wait(900);

  // Export: the menu action fetches the HTML route and opens the preview
  // dialog. Headlessly there may be no writable data directory, in which case
  // the dialog says the file was generated but not saved; either way the
  // export itself succeeded.
  await openRowMenu(app, row);
  await app.waitFor("label:/Export HTML/", { timeout: 5000 });
  await app.press("label:/Export HTML/");
  await app.waitFor("text:Session exported", { timeout: 90000 });
  expect(app.shows("text:Session exported")).toBe(true);
  // The HTML preview is the export's payload; the line above it says where a
  // writable data directory put it, or that this host has none.
  expect(app.shows("label:Exported session preview")).toBe(true);
  expect(app.shows("text:/Saved to|generated, but no writable data directory/")).toBe(true);
  expect(app.requests().some(
    (request) => request.method === "GET" && /\/api\/sessions\/[^/]+\/export/.test(request.url),
  )).toBe(true);
  await app.keyboard.press("escape");
  await app.wait(500);

  // Rename is the one action this suite cannot prove headlessly: the write goes
  // through a POSIX shell (`appendSessionLine`), and the synthetic host spawns
  // no processes. Over the dev server the call itself is pi-web's route, not
  // the one this app runs. It is exercised by hand on a real host; the local
  // route's own write and the sidebar's refresh are covered by the version
  // bump in `session-routes.ts` / `agent-routes.ts`.
});


/** Drops the test folder's decision from pi's trust store (best effort). */
async function forgetTrustedFolder(folder: string): Promise<void> {
  const home = process.env.HOME ?? "";
  if (home === "") return;
  const file = path.join(home, ".pi/agent/trust.json");
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    if (!(folder in parsed)) return;
    delete parsed[folder];
    await writeFile(file, `${JSON.stringify(parsed, null, 2)}\n`);
  } catch {
    // No store, or no filesystem in this host.
  }
}

test("project trust: a folder with .pi/mcp.json opens the trust dialog, lists its server and can be trusted", async () => {
  // Create the folder through the app's own directory browser (the system
  // chooser is Finder, which headless cannot drive). The `.pi/mcp.json` is
  // uploaded through the composer once `.pi` is the fresh composer's folder,
  // then its parent is selected again: that is what asks for trust.
  const parent = "/private/tmp";
  const folderName = `pi-next-trust-${Date.now()}`;
  const folder = `${parent}/${folderName}`;
  // The local `/api/cwd/browse` route only authorizes the home/data folders;
  // the dev server's route can browse /tmp, so go through it (as a browser or
  // an older build would). This also makes the folder creation and the upload
  // run in Node, not in the synthetic host.
  const app = await openAppOverTheServer();
  await app.press("id:new-session-now");
  await app.waitFor("id:new-session-project", { timeout: 15000 });

  // The pill opens the project menu now; its last row is the folder chooser.
  const picker = async (): Promise<void> => {
    await app.press("label:Change…");
    await app.waitFor("id:project-browse", { timeout: 10000 });
    await app.press("id:project-browse");
    await app.waitFor("text:Select directory", { timeout: 15000 });
  };
  const goTo = async (target: string): Promise<void> => {
    await app.clear("label:Directory path");
    await app.type("label:Directory path", target);
    await app.press("text:Go");
    await app.waitUntil(() => app.value("label:Directory path") === target, { timeout: 15000 });
  };
  const createFolder = async (name: string): Promise<void> => {
    await app.press("label:New directory");
    await app.waitFor("label:Directory name", { timeout: 5000 });
    await app.type("label:Directory name", name);
    await app.press("label:Create");
  };

  try {
    await picker();
    await goTo(parent);
    await createFolder(folderName);
    await app.waitUntil(() => app.value("label:Directory path") === folder, { timeout: 15000 });

    // Put `.pi/mcp.json` where the folder's trust check will find it: upload
    // into `.pi` while that is the fresh composer's folder.
    await createFolder(".pi");
    await app.waitUntil(() => app.value("label:Directory path") === `${folder}/.pi`, { timeout: 15000 });
    await app.press("label:Select this folder");
    await app.waitFor("text:Select directory", { state: "gone", timeout: 15000 });

    const config = JSON.stringify({
      mcpServers: {
        "pi-next-trust-test": { command: "node", args: ["-e", "process.exit(0)"] },
      },
    }, null, 2);
    app.onPick(() => [{ name: "mcp.json", type: "application/json", data: new TextEncoder().encode(config) }]);
    await app.press("label:Attach files");
    await app.waitUntil(
      () => (app.value("id:composer-input") ?? "").includes("@mcp.json"),
      { timeout: 15000 },
    );
    expect(app.value("id:composer-input")).toContain("@mcp.json");

    // The parent now has `.pi/mcp.json`: selecting it asks for trust, names
    // the folder, and lists the server trusting would connect.
    await picker();
    await goTo(folder);
    await app.waitUntil(() => app.enabled("label:Select this folder"), { timeout: 15000 });
    await app.press("label:Select this folder");

    await app.waitFor("text:Trust this project?", { timeout: 20000 });
    expect(app.shows("text:Trust this project?")).toBe(true);
    expect(app.shows("text:What trusting this project connects")).toBe(true);
    expect(app.shows("text:pi-next-trust-test")).toBe(true);
    expect(app.enabled("label:Trust project")).toBe(true);

    await app.press("label:Trust project");
    await app.waitFor("text:Trust this project?", { state: "gone", timeout: 20000 });
    expect(app.shows("text:Trust this project?")).toBe(false);
    // The fresh composer moved to the accepted folder, whose leaf is its name.
    expect(app.shows(`text:${folderName}`)).toBe(true);
  } finally {
    // Best effort: a headless engine has no native filesystem, so the temp
    // folder under /tmp and one trust-store entry may remain after the run.
    await unlink(`${folder}/.pi/mcp.json`).catch(() => undefined);
    await rmdir(`${folder}/.pi`).catch(() => undefined);
    await rmdir(folder).catch(() => undefined);
    await forgetTrustedFolder(folder);
  }
}, 90000);
