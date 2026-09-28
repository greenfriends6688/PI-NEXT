import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panel = await readFile(new URL("./ProjectArchivePanel.tsx", import.meta.url), "utf8");
const sidebar = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const navigation = await readFile(new URL("../lib/settings-navigation.ts", import.meta.url), "utf8");

test("the archive page is read-only about the user's data", () => {
  // fork:project-archive — archiving is presentation only. The page must never offer a
  // delete: sessions are the user's, and an invisible one is still theirs.
  assert.doesNotMatch(panel, /method:\s*"DELETE"/);
  assert.doesNotMatch(panel, /method:\s*'DELETE'/);
  assert.doesNotMatch(panel, /archivedDelete|removeSession|projectsDelete/);
  // The only write it performs is the localStorage flag, through the store.
  assert.match(panel, /const \{ flags, archive, restore \} = useProjectFlags\(\)/);
});

test("project identity comes from the server, never from a browser-side path", () => {
  // `SessionInfo.projectKey` is `projectIdentityKey(projectRoot)`, which is case- and
  // separator-insensitive on the server. Assembling a key here is what collided in the
  // reference implementation, so this panel must not do it.
  assert.match(panel, /getRecentProjects\(allSessions\)/);
  assert.match(panel, /withoutChatProject\(getRecentProjects\(allSessions\), chatProjectKey\)/);
  assert.doesNotMatch(panel, /\.toLowerCase\(\)[\s\S]{0,40}(replace|split)\(/);
  assert.doesNotMatch(panel, /path\.(normalize|resolve|sep)/);
});

test("the sidebar hides archived projects but never the selected one", () => {
  assert.match(sidebar, /const \{ flags: projectFlags, archive: archiveProject, restore: restoreProject \} = useProjectFlags\(\)/);
  const filter = sidebar.slice(
    sidebar.indexOf("const visibleProjects = filterArchivedProjects("),
    sidebar.indexOf("const visibleProjects = filterArchivedProjects(") + 400,
  );
  assert.match(filter, /filterHiddenProjects\(/);
  // The keep-key is the selected project: archiving the row you are standing in would
  // otherwise leave you unable to see where you are.
  assert.match(filter, /selectedProject\?\.key \?\? null/);
});

test("the project row menu can archive and restore", () => {
  assert.match(sidebar, /archived=\{projectFlags\.archived\.includes\(project\.key\)\}/);
  assert.match(sidebar, /archived \? t\("sidebar\.restoreProject"\) : t\("sidebar\.archiveProject"\)/);
  assert.match(sidebar, /onArchive\?: \(\) => void;/);
});

test("the project index shares one settings page with the session archive", async () => {
  // fork:project-archive — two nav entries for two granularities of the same idea read
  // as two unrelated features, so they live on one page.
  assert.doesNotMatch(navigation, /"projects",/);
  const settings = await readFile(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
  // 切片到下一个 sectionHost 为止（原先写死 700 字符，页面加一层容器就截断到一半）。
  const archivedHost = settings.slice(
    settings.indexOf('sectionHost("archived"'),
    settings.indexOf('sectionHost("import"'),
  );
  assert.match(archivedHost, /<ProjectArchivePanel/);
  assert.match(archivedHost, /<ArchivedSessionsPanel/);
});
