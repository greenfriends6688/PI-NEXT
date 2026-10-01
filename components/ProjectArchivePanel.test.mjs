import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panel = await readFile(new URL("./ProjectArchivePanel.tsx", import.meta.url), "utf8");
const sessionsPanel = await readFile(new URL("./ArchivedSessionsPanel.tsx", import.meta.url), "utf8");
const sidebar = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const navigation = await readFile(new URL("../lib/settings-navigation.ts", import.meta.url), "utf8");
const settingsPanel = await readFile(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");

test("the archive page is read-only about the user's data", () => {
  // fork:project-archive — archiving is presentation only. The page must never offer a
  // delete: sessions are the user's, and an invisible one is still theirs.
  assert.doesNotMatch(panel, /method:\s*"DELETE"/);
  assert.doesNotMatch(panel, /method:\s*'DELETE'/);
  assert.doesNotMatch(panel, /archivedDelete|removeSession|projectsDelete/);
  // The only write it performs is the localStorage flag, through the store.
  // fix:archive-selection-scope:项目表与会话表分开订阅（projectFlags / sessionFlags）。
  // fork:archive-layout（2026-10-01）：实现里还多解构了一个 sessionFlags（会话级标志），
  // 断言跟上真实写法。
  assert.match(panel, /const \{ flags: projectFlags, archive, restore \} = useProjectFlags\(\)/);
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
  // fix:archive-legacy-shell — 旧的两段式入口恒渲染 null，且 SettingsPanel 里已无调用方。
  // 留着它就是第二套骨架的残骸：删干净，并且不许长回来（注释里提到它不算）。
  assert.doesNotMatch(sessionsPanel, /export function ArchivedSessionsPanel/);
  assert.doesNotMatch(settingsPanel, /import \{ ArchivedSessionsPanel \}/);
  assert.doesNotMatch(settingsPanel, /<ArchivedSessionsPanel/);
});

test("the merged page follows board 62 frame D for its empty states", () => {
  // 整页空（两个分组都空）: 标题 + 说明 + 一个出口动作，居中在内容区。
  const pageEmpty = panel.slice(panel.indexOf("pageEmpty ? ("), panel.indexOf("</ConfigEmptyState>"));
  assert.match(pageEmpty, /settings\.archivedEmptyTitle/);
  assert.match(pageEmpty, /settings\.projectsNoneArchived/);
  assert.match(pageEmpty, /onCloseRequest/);
  // 详情未选：40px 方框 mark + 一句引导，居中在详情列。
  const detailEmpty = panel.slice(panel.indexOf("<ConfigDetail>"), panel.indexOf("</ConfigDetail>"));
  assert.match(detailEmpty, /square-mouse-pointer/);
  assert.match(detailEmpty, /settings\.archivedDescription/);
});

test("session archives are read from the session table, not the project table", () => {
  // fix:archive-selection-scope（探针实测）—— 两种归档是两张 localStorage 表：
  // projectKey 进 `pi-project-flags`，session id 进 `pi-session-flags`。
  // 拿项目表去判「整页空 / 选中会话」时，只归档过会话的用户会看到整页空态、
  // 会话行点开也没有详情卡（恢复 / 彻底删除全都够不着）。
  assert.match(panel, /const \{ flags: sessionFlags \} = useSessionFlags\(\)/);
  assert.match(panel, /sessionFlags\.archived\.includes\(selected\.id\)/);
  assert.match(panel, /archivedProjects\.length === 0 && sessionFlags\.archived\.length === 0/);
  // 两组各查各的表：项目行来自 partitionProjects(projectFlags)。
  assert.match(panel, /partitionProjects\(projects, projectFlags\)\.archived/);
  // 会话分组自己已经 useSessionFlags，不需要宿主再喂一份标志。
  assert.doesNotMatch(panel, /sessionFlags\.archivedAt/);
});

test("the project count is stated once: in the list row, not again in the detail", () => {
  // 用户实测「项目卡片自己又画了一遍 1 个对话」。骨架 B 里左列行已经带会话数，
  // 详情列只补行里没有的：归档时间 + 恢复动作 + 会话子列表。
  const detail = panel.slice(panel.indexOf("function ProjectArchiveDetail"));
  assert.doesNotMatch(detail, /projectsSessionCount/);
  assert.match(detail, /settings\.projectsRestore/);
  // 行副标题仍带计数（唯一一处）。
  const rows = panel.slice(panel.indexOf("<ConfigSidebarList>"), panel.indexOf("</ConfigSidebarList>"));
  assert.match(rows, /projectsSessionCount/);
});
