import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";
import ts from "typescript";
import vm from "node:vm";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { SessionSidebar, nearestEnabledKey, handOffDisabledKeyFocus, sameIdsOr } = await jiti.import("./SessionSidebar.tsx");
const { buildSessionTree, getRowOffsets, getVisibleRowIndices } = await jiti.import("@/lib/session-tree.ts");
const { SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MIN_WIDTH } = await jiti.import("@/lib/panel-layout.ts");

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const globalStyles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const sidebarStyles = await readFile(new URL("../app/sidebar.css", import.meta.url), "utf8");
const explorerSource = await readFile(new URL("./FileExplorer.tsx", import.meta.url), "utf8");

const h = React.createElement;
const noop = () => {};
const BASE = Date.parse("2026-10-01T00:00:00.000Z");

function between(startAnchor, endAnchor) {
  const start = source.indexOf(startAnchor);
  const end = source.indexOf(endAnchor, start + startAnchor.length);
  assert.notEqual(start, -1, `${startAnchor} not found`);
  assert.notEqual(end, -1, `${endAnchor} not found after ${startAnchor}`);
  return source.slice(start, end);
}

/** A sidebar callback's body: from its declaration to the next `const` of the component. */
function callbackBody(name) {
  return between(`const ${name} = `, "\n  const ");
}

function session(id, { project = "/work/alpha", modified = BASE, ...rest } = {}) {
  const time = new Date(modified).toISOString();
  return {
    path: `${project}/${id}.jsonl`,
    id,
    cwd: project,
    projectRoot: project,
    projectKey: project,
    created: time,
    modified: time,
    messageCount: 1,
    firstMessage: id,
    ...rest,
  };
}

function treeInput(overrides = {}) {
  return {
    sessions: [],
    uiState: { version: 1, revision: 0, sessions: {}, projects: {} },
    runningIds: new Set(),
    unreadIds: new Set(),
    selectedSessionId: null,
    currentProject: null,
    groupExpansion: {},
    moreShown: {},
    pinnedCollapsed: false,
    ...overrides,
  };
}

function render(props = {}) {
  return renderToStaticMarkup(h(I18nProvider, null, h(SessionSidebar, {
    selectedSessionId: null,
    onSelectSession: noop,
    ...props,
  })));
}

/** The opening tag of the element with this id. */
function openingTag(html, id) {
  const match = html.match(new RegExp(`<[a-z]+ [^>]*id="${id}"[^>]*>`));
  assert.ok(match, `#${id} not rendered`);
  return match[0];
}

test("scrolling keeps the focused session and the viewport mounted without expanding the whole tree", () => {
  const sessions = Array.from({ length: 2000 }, (_, index) => session(`s${index}`, { modified: BASE - index * 60_000 }));
  const { rows } = buildSessionTree(treeInput({ sessions, currentProject: { key: "/work/alpha", root: "/work/alpha" }, moreShown: { "/work/alpha": 5000 } }));
  const offsets = getRowOffsets(rows, "desktop");
  const lastSessionIndex = rows.findLastIndex((row) => row.kind === "session");
  for (const [scrollTop, focusedIndex] of [[0, lastSessionIndex], [30000, 1]]) {
    const indices = getVisibleRowIndices(offsets, scrollTop, 335, 240, [focusedIndex]);
    for (let index = 0; index < rows.length; index++) {
      const intersects = offsets[index + 1] > scrollTop && offsets[index] < scrollTop + 335;
      if (intersects) assert.ok(indices.includes(index), `row ${index} in the viewport is mounted`);
    }
    assert.ok(indices.includes(focusedIndex), "an inline rename survives scrolling");
    assert.ok(indices.length < 60, "only a window of the tree is mounted");
    assert.equal(new Set(indices).size, indices.length);
    assert.deepEqual(indices, [...indices].sort((a, b) => a - b));
  }
});

test("subagents fold into their main session row, which carries their running, unread and selected state", () => {
  const child = session("child", { relation: { kind: "subagent", parentSessionId: "main", profile: "explore", description: "", status: "running" } });
  const { rows } = buildSessionTree(treeInput({
    sessions: [session("main"), child],
    runningIds: new Set(["child"]),
    unreadIds: new Set(["child"]),
    selectedSessionId: "child",
    currentProject: { key: "/work/alpha", root: "/work/alpha" },
  }));
  const sessionRows = rows.filter((row) => row.kind === "session");
  assert.deepEqual(sessionRows.map((row) => row.family.root.id), ["main"]);
  assert.deepEqual(sessionRows[0].status, { running: true, awaiting: false, unread: true, selected: true, transient: false });
});

test("only Shift skips the session deletion confirmation", () => {
  assert.match(
    callbackBody("requestDelete"),
    /if \(shiftKey\) \{\s*void performDelete\(family\);\s*\} else \{[\s\S]*?setConfirmDeleteRootId\(family\.root\.id\);/,
  );
});

test("the archive view's motion in the CSS lasts as long as the hook's phase", async () => {
  const { SIDEBAR_MOTION_MS } = await jiti.import("@/hooks/useSidebarMotion.ts");
  // A phase ends on its element's own end event, else a little after
  // SIDEBAR_MOTION_MS (hooks/useSidebarMotion.ts): every motion it waits for
  // lasts that long.
  for (const [selector, property] of [
    [".sidebar-archive-view.is-entering", "animation"],
    [".sidebar-archive-view.is-leaving", "animation"],
  ]) {
    assert.match(sidebarRule(selector), new RegExp(`(?:^|\\s)${property}: [\\w-]+ ${SIDEBAR_MOTION_MS}ms `), selector);
  }
});

/** A rule's declarations in app/sidebar.css (its first rule for the selector). */
function sidebarRule(selector) {
  const start = sidebarStyles.indexOf(`\n${selector} {`);
  assert.notEqual(start, -1, `${selector} not found`);
  return sidebarStyles.slice(sidebarStyles.indexOf("{", start) + 1, sidebarStyles.indexOf("}", start));
}

function px(rule, property) {
  const match = rule.match(new RegExp(`(?:^|\\s)${property}: ([^;]+);`));
  assert.ok(match, `${property} not set`);
  return match[1].split(/\s+/).map((value) => Number.parseFloat(value));
}

test("a key disabled under the focus hands it to the nearest key still enabled, the next one first", () => {
  const keys = ["terminal", "files", "changes", "search"].map((name) => ({ name, tagName: "BUTTON", disabled: false }));
  keys.forEach((key, index) => {
    key.previousElementSibling = keys[index - 1] ?? null;
    key.nextElementSibling = keys[index + 1] ?? null;
  });
  keys[2].disabled = true;
  assert.equal(nearestEnabledKey(keys[2]).name, "search");
  keys[3].disabled = true;
  assert.equal(nearestEnabledKey(keys[2]).name, "files", "the file search disabled too: the one before");
  keys[1].disabled = true;
  keys[0].disabled = true;
  assert.equal(nearestEnabledKey(keys[2]), null, "none left: the caller falls back to the toolbar row's search");
  // Only buttons count.
  keys[3].disabled = false;
  keys[3].tagName = "DIV";
  assert.equal(nearestEnabledKey(keys[2]), null);
});

test("a key just disabled hands its focus on while the focus is still on it, or fell to the page, and never takes the user's", () => {
  const focused = [];
  const key = (name) => ({ name, tagName: "BUTTON", disabled: false, focus: (options) => focused.push([name, options]) });
  const keys = ["ignored", "changes", "search"].map(key);
  keys.forEach((item, index) => {
    item.previousElementSibling = keys[index - 1] ?? null;
    item.nextElementSibling = keys[index + 1] ?? null;
  });
  const [, changes] = keys;
  const fallback = key("toolbar search");
  const body = { name: "body" };
  changes.disabled = true;

  // Current Chromium: the disabled key keeps the focus until the next
  // rendering update, after the layout effect. That counts as lost.
  assert.equal(handOffDisabledKeyFocus({ activeElement: changes, body }, changes, fallback), true);
  assert.deepEqual(focused.splice(0), [["search", { preventScroll: true }]]);
  // A browser that blurred it at once: the focus fell to the page (or nowhere).
  assert.equal(handOffDisabledKeyFocus({ activeElement: body, body }, changes, fallback), true);
  assert.equal(handOffDisabledKeyFocus({ activeElement: null, body }, changes, fallback), true);
  assert.deepEqual(focused.splice(0).map(([name]) => name), ["search", "search"]);
  // Focus the user put elsewhere stays.
  const elsewhere = { name: "a session row" };
  assert.equal(handOffDisabledKeyFocus({ activeElement: elsewhere, body }, changes, fallback), false);
  assert.deepEqual(focused, []);
  // No key left enabled: the fallback, still on the key or from the page.
  keys.forEach((item) => { item.disabled = true; });
  assert.equal(handOffDisabledKeyFocus({ activeElement: changes, body }, changes, fallback), true);
  assert.equal(handOffDisabledKeyFocus({ activeElement: body, body }, changes, fallback), true);
  assert.deepEqual(focused.splice(0).map(([name]) => name), ["toolbar search", "toolbar search"]);
  // Nothing to hand it to: nothing moves.
  assert.equal(handOffDisabledKeyFocus({ activeElement: changes, body }, changes, null), false);
  assert.deepEqual(focused, []);
});

test("the running poll keeps the same Set while the running ids stay the same", () => {
  const previous = new Set(["a", "b"]);
  assert.equal(sameIdsOr(previous, ["b", "a"]), previous);
  assert.equal(sameIdsOr(previous, ["a", "b", "b"]), previous);
  assert.deepEqual([...sameIdsOr(previous, ["a"])], ["a"]);
  assert.deepEqual([...sameIdsOr(previous, ["a", "c"])], ["a", "c"]);
  const empty = new Set();
  assert.equal(sameIdsOr(empty, []), empty);
});

test("a read or a mark in another tab reaches this one: the storage handler adopts that tab's write", () => {
  const parse = between("function parseUnreadSessionIds(", "\nfunction loadUnreadSessionIds");
  const handler = between("const onStorage = (event: StorageEvent) => {", '\n    window.addEventListener("storage", onStorage);');
  const code = ts.transpileModule(`${parse}\n${handler}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const updaters = [];
  const onStorage = vm.runInNewContext(`${code}\nonStorage`, {
    UNREAD_SESSIONS_STORAGE_KEY: "pi-web:unread-session-ids",
    sameIdsOr,
    setUnreadSessionIds: (updater) => updaters.push(updater),
  });

  // Another key's write never touches the unread markers.
  onStorage({ key: "pi-web:terminal-theme", newValue: '["a"]' });
  assert.equal(updaters.length, 0);

  // The other tab read the session: the key (or all of storage) went away.
  onStorage({ key: "pi-web:unread-session-ids", newValue: null });
  assert.deepEqual([...updaters.pop()(new Set(["a", "b"]))], []);

  // The other tab wrote a newer set; it replaces this tab's, stale markers and all.
  onStorage({ key: "pi-web:unread-session-ids", newValue: '["a","b","b","c"]' });
  assert.deepEqual([...updaters.pop()(new Set(["a", "d"]))].sort(), ["a", "b", "c"]);

  // The same set keeps the same Set: no re-render, so no echo of the write back.
  onStorage({ key: "pi-web:unread-session-ids", newValue: '["a"]' });
  const unchanged = new Set(["a"]);
  assert.equal(updaters.pop()(unchanged), unchanged);

  // A malformed write means no markers, not a crash.
  onStorage({ key: "pi-web:unread-session-ids", newValue: "{not json" });
  assert.deepEqual([...updaters.pop()(new Set(["a"]))], []);

  // The listener is registered for the storage event and taken off again.
  assert.match(source, /window\.addEventListener\("storage", onStorage\);/);
  assert.match(source, /window\.removeEventListener\("storage", onStorage\);/);
});
