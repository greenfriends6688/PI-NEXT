import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panel = await readFile(new URL("./ProjectArchivePanel.tsx", import.meta.url), "utf8");
const sessionsPanel = await readFile(new URL("./ArchivedSessionsPanel.tsx", import.meta.url), "utf8");
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
  // The destructive action moved WITH the session rows: it lives in
  // ArchivedSessionsPanel.tsx and nowhere else on this page.
  assert.match(sessionsPanel, /method:\s*"DELETE"/);
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

test("the project index shares one settings page with the session archive", () => {
  // fork:project-archive — two nav entries for two granularities of the same idea read
  // as two unrelated features, so they live on one page.
  assert.doesNotMatch(navigation, /"projects",/);
  // fork:settings-frame（画板 62）—— the merged page is skeleton B: ProjectArchivePanel
  // hosts the list/detail split and renders the session group inside its own list
  // column, so "one page" is now a structural fact instead of two stacked sections.
  assert.match(panel, /<ConfigSplitView>/);
  assert.match(panel, /<ArchivedSessionsGroup/);
  assert.match(panel, /import \{ ArchivedSessionDetail, ArchivedSessionsGroup \} from "\.\/ArchivedSessionsPanel"/);
  // The legacy two-section entry point must not render a second copy of the content.
  assert.match(sessionsPanel, /export function ArchivedSessionsPanel/);
  assert.match(sessionsPanel, /return null;/);
});

test("the merged page follows board 62 frame D for its empty states", () => {
  // 整页空（两个分组都空）: 标题 + 说明 + 一个出口动作，居中在内容区。
  const pageEmpty = panel.slice(panel.indexOf("pageEmpty ? ("), panel.indexOf("</ConfigEmptyState>"));
  assert.match(pageEmpty, /settings\.archivedEmpty/);
  assert.match(pageEmpty, /settings\.projectsNoneArchived/);
  assert.match(pageEmpty, /onCloseRequest/);
  // 详情未选：40px 方框 mark + 一句引导，居中在详情列。
  const detailEmpty = panel.slice(panel.indexOf("<ConfigDetail>"), panel.indexOf("</ConfigDetail>"));
  assert.match(detailEmpty, /square-mouse-pointer/);
  assert.match(detailEmpty, /settings\.archivedDescription/);
});
