import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panel = await readFile(new URL("./ProjectArchivePanel.tsx", import.meta.url), "utf8");
const boardCss = await readFile(new URL("../design/v5/web/system.css", import.meta.url), "utf8");
const sessionsPanel = await readFile(new URL("./ArchivedSessionsPanel.tsx", import.meta.url), "utf8");
const sidebar = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const navigation = await readFile(new URL("../lib/settings-navigation.ts", import.meta.url), "utf8");
const settingsPanel = await readFile(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");

/* fork:v5-landing-frame · D-21（2026-10-06）—— 桌面归档页整页换成画板 D-21 帧 A：
   一列分节（横幅 / 归档历史卡 / 两种空态卡）。下面这些断言锁的是**画板那一页的结构**，
   不是上一版的骨架 B（列表列 + 详情列）。 */

test("the desktop page is board D-21 frame A: one column of sections, no list/detail split", () => {
  // 一根 `.d-set-inner` 装下整页：横幅 → 「归档会话」分节 → 「两种列不出来」分节。
  assert.match(panel, /<div className="d-set-inner">/);
  // 骨架 B 的两栏容器退场（`.d-set` 是 `d-set-nav` + `d-set-main`，画板帧 A 的归档页没有）。
  assert.doesNotMatch(panel, /ConfigSplitView|ConfigSidebar|ConfigDetail/);
  // 画板帧 A 的三块：横幅 / 归档历史卡（卡头带计数 + 「显示已消失」开关 + 全部恢复）/ 空态分节。
  assert.match(panel, /settings\.archiveNotDeleteTitle/);
  assert.match(panel, /className="d-card-head"/);
  assert.match(panel, /settings\.archiveHistoryTitle/);
  assert.match(panel, /className=\{`d-switch\$\{showMissing \? " on" : ""\}`\}/);
  assert.match(panel, /settings\.archiveRestoreAll/);
  assert.match(panel, /className="d-group-toggle"/);
  // 弹窗宿主那一层因此也不需要 `fill`（`fill` 是给列表 + 详情那两节的）。
  assert.doesNotMatch(settingsPanel, /settings\.archivePageDescription"\) fill/);
});

test("the bulk bar appears only when something is selected, and the confirm pop is the only way to delete", () => {
  // D-21：「一条都没选时，这整条批量条不出现（而不是灰着摆在那儿）」。
  assert.match(panel, /const bulkBar = selectedRows\.length > 0;/);
  assert.match(panel, /\{bulkBar && \(/);
  // 「永久删除」先翻确认浮层，DELETE 只在浮层里那枚确认钮后面。
  assert.match(panel, /open=\{confirmDelete\}/);
  assert.match(panel, /settings\.archiveDeleteConfirmTitle/);
  assert.match(panel, /onClick=\{\(\) => void deleteRows\(selectedRows\)\}/);
  assert.match(panel, /settings\.archiveDeleteConfirm"\)\}/);
  // 浮层走 portal + fixed：`.d-set-main` 是 overflow-y:auto，画板那种绝对定位的
  // `.d-pop` 挂在这里会被整个裁掉（LANDING §4 第一条陷阱）。
  assert.match(panel, /<PortalDropdown/);
  assert.match(panel, /className="d-pop-float"/);
  assert.doesNotMatch(panel, /className="d-pop is-open"/);
  // 缺文件的行没有文件可删 —— 只清标志位，不能对不存在的路径发 DELETE。
  assert.match(panel, /if \(!row\.live\) continue;/);
  // 恢复只对文件还在的选中行生效（D-21：缺文件行只有「清理标记」，没有「恢复」）。
  assert.match(panel, /const restorableRows = selectedRows\.filter\(\(row\) => row\.live\)/);
  assert.match(panel, /disabled=\{restorableRows\.length === 0\}/);
});

test("the two 'cannot list this' states each get their own exit", () => {
  // D-21：合成一句「暂无数据」，两边用户都无处可去。
  assert.match(panel, /const showNeverArchived = rows\.length === 0;/);
  assert.match(panel, /const showMissingOnly = rows\.length > 0 && missingCount > 0 && !showMissing;/);
  assert.match(panel, /settings\.archiveNeverTitle/);
  assert.match(panel, /settings\.archiveGoSidebar/);
  assert.match(panel, /settings\.archiveMissingTitle/);
  assert.match(panel, /settings\.archiveShowMissingBtn/);
  // 空态卡是画板的 `.d-card > .d-card-body > .d-empty` 三层，不是裸一堆 `<p>`。
  assert.match(panel, /className="d-empty-ico"/);
  assert.match(panel, /className="d-empty-t"/);
  assert.match(panel, /className="d-empty-s"/);
  assert.doesNotMatch(panel, /className="mark"/);
});

test("session archives and project archives are two tables and stay separate", () => {
  // fix:archive-selection-scope（探针实测）—— 两种归档是两张 localStorage 表：
  // projectKey 进 `pi-project-flags`，session id 进 `pi-session-flags`。
  assert.match(panel, /const \{ flags: projectFlags, archive, restore \} = useProjectFlags\(\)/);
  assert.match(panel, /const \{ flags: sessionFlags, archive: archiveSession \} = useSessionFlags\(\)/);
  // 会话行只从会话表来；项目行只从项目表来。
  assert.match(panel, /deriveArchivedRows\(\s*sessionFlags\.archived,\s*sessionFlags\.archivedAt,/);
  assert.match(panel, /partitionProjects\(projects, projectFlags\)\.archived/);
  // 整页空 = 两张表都空。
  assert.match(panel, /archivedProjects\.length === 0 && rows\.length === 0/);
  // 窄屏的「选中会话」也问会话表。
  assert.match(panel, /sessionFlags\.archived\.includes\(selected\.id\)/);
});

test("project identity comes from the server, never from a browser-side path", () => {
  // `SessionInfo.projectKey` is `projectIdentityKey(projectRoot)`, which is case- and
  // separator-insensitive on the server. Assembling a key here is what collided in the
  // reference implementation, so this panel must not do it.
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
  assert.match(panel, /settings\.archiveSessionSection/);
  assert.match(panel, /settings\.projectsTitle/);
  // 窄屏那一支仍然是「两张卡 + 详情面板」，与桌面那一支各自成形。
  assert.match(panel, /<ArchivedSessionsGroup/);
  assert.match(panel, /import \{\s*ArchivedSessionDetail,\s*ArchivedSessionsGroup,/);
  // fix:archive-legacy-shell — 旧的两段式入口恒渲染 null，且 SettingsPanel 里已无调用方。
  assert.doesNotMatch(sessionsPanel, /export function ArchivedSessionsPanel\b/);
  assert.doesNotMatch(settingsPanel, /import \{ ArchivedSessionsPanel \}/);
  assert.doesNotMatch(settingsPanel, /<ArchivedSessionsPanel/);
});

/* fork:multi-select-row（2026-10-07 用户实拍「这种多选的样式帮我一下，现在有点乱」）——
   归档与导入两页的会话行把 `.d-checkbox` 放在 `.d-sess` 的**第一个子节点**，而 `.d-sess`
   是 `display:block`、`.d-sess-t` 也是 block —— 勾选盒于是独占一行，标题被挤到第二行、
   副行第三行。**画板 D-21 里是逐字相同的结构**，也就是画板与产品一起错；D-21 又恰好没有
   对位 spec，所以这个形态一直没人发现。
   修法在**唯一一份**样式（`design/v5/web/system.css`，画板与产品共用）：
   `.d-sess:has(> .d-checkbox)` 切成两列网格。下面锁两件事：
     ① 那条规则还在，且**只**在真有勾选盒时生效（侧栏那一行没有勾选盒，不能被动到）；
     ② 组件仍把勾选盒放在行首 —— 否则规则匹配不上，等于没修。
   导入页（`ImportPanel.tsx`）用的是同一套行结构，它的测试里也有同一条 ②。 */
test("可多选的会话行是两列网格：勾选盒跨两行在行首，标题与副行在右列", () => {
  // ① 不能把 `.d-sess` 本身改成网格：侧栏那一行没有勾选盒，会被一起改掉。
  assert.doesNotMatch(
    boardCss,
    /^\.d-sess \{[^}]*display: grid/m,
    "`.d-sess` 本身不许是网格 —— 只能由 `:has(> .d-checkbox)` 限定",
  );
  assert.match(boardCss, /\.d-sess:has\(> \.d-checkbox\) \{[\s\S]*?display: grid/);
  assert.match(
    boardCss,
    /\.d-sess:has\(> \.d-checkbox\) \{[\s\S]*?grid-template-columns: auto minmax\(0, 1fr\)/,
  );
  // 三格缺一不可：缺了任何一条，行就回到「勾选盒独占一行」的那个形态。
  assert.match(boardCss, /\.d-sess:has\(> \.d-checkbox\) > \.d-checkbox \{ grid-row: 1 \/ span 2; grid-column: 1; \}/);
  assert.match(boardCss, /\.d-sess:has\(> \.d-checkbox\) > \.d-sess-t \{ grid-row: 1; grid-column: 2; \}/);
  assert.match(boardCss, /\.d-sess:has\(> \.d-checkbox\) > \.d-sess-m \{ grid-row: 2; grid-column: 2; margin-top: 0; \}/);
  // ② 勾选盒必须是行的第一个子节点。
  assertFirstChildIsCheckbox(panel);
});

/**
 * 行的第一个子节点必须是勾选盒 —— 用下标比而不是正则窗口：`className="d-sess"` 与
 * 勾选盒之间隔着 `title` / `onClick` 那一串（长度随实现变），窗口写死就会变成假红。
 */
function assertFirstChildIsCheckbox(source) {
  const at = source.indexOf('className="d-sess"');
  assert.ok(at > 0, "找不到 `.d-sess` 行");
  const chunk = source.slice(at, at + 1200);
  const box = chunk.indexOf('<span role="checkbox"');
  assert.ok(box > 0, "会话行里找不到勾选盒");
  assert.ok(
    box < chunk.indexOf("d-sess-t"),
    "勾选盒必须是会话行的第一个子节点 —— 否则 `.d-sess:has(> .d-checkbox)` 匹配不上，行会回到「勾选盒独占一行」",
  );
}