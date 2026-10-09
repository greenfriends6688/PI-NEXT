import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { getSessionListIndices, sessionListOffsets, SESSION_LIST_ITEM_HEIGHT } = await jiti.import("./SessionSidebar.tsx");

const windowCount = (viewportHeight) => Math.ceil((viewportHeight || 600) / SESSION_LIST_ITEM_HEIGHT) + 16;

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const sessionItemSource = source.slice(source.indexOf("function SessionItem("));

test("scrolling keeps the focused session and the viewport mounted without expanding the whole window", () => {
  for (const [scrollTop, focusedIndex] of [[0, 1999], [10000, 0]]) {
    const indices = getSessionListIndices(2000, scrollTop, 335, focusedIndex);
    const firstVisible = Math.floor(scrollTop / SESSION_LIST_ITEM_HEIGHT);
    const lastVisible = Math.ceil((scrollTop + 335) / SESSION_LIST_ITEM_HEIGHT) - 1;
    for (let index = firstVisible; index <= lastVisible; index++) assert.ok(indices.includes(index));
    assert.ok(indices.includes(focusedIndex));
    assert.equal(indices.length, windowCount(335) + 1);
    assert.equal(new Set(indices).size, indices.length);
    assert.deepEqual(indices, [...indices].sort((a, b) => a - b));
  }
  assert.equal(getSessionListIndices(2000, 0, 335, 3).length, windowCount(335));
  const blurred = getSessionListIndices(2000, 10000, 335);
  assert.equal(blurred.length, windowCount(335));
  assert.ok(!blurred.includes(0));
});

test("session windows stay valid after a project shrinks and before the viewport is measured", () => {
  assert.deepEqual(getSessionListIndices(5, 80000, 335, 1999), [0, 1, 2, 3, 4]);
  assert.deepEqual(getSessionListIndices(0, 80000, 335, 1999), []);
  assert.equal(getSessionListIndices(2000, 0, 0).length, windowCount(0));
});

// fork:session-row-overlap —— 虚拟列表的行高是**量出来的**（`.d-sess` 52.6 /
// `.m-row` 108.7），窗口与偏移必须都吃这个数。这条钉住：传进去的行高真的决定了
// 槽位间距与窗口大小，而不是悄悄退回那个 48 的兜底常量。
test("offsets and the visible window both follow the measured row height", () => {
  const phoneRow = 109;
  assert.deepEqual(sessionListOffsets(3, phoneRow), [0, 109, 218, 327]);
  assert.equal(sessionListOffsets(3).length, 4);
  assert.deepEqual(sessionListOffsets(3), [0, SESSION_LIST_ITEM_HEIGHT, SESSION_LIST_ITEM_HEIGHT * 2, SESSION_LIST_ITEM_HEIGHT * 3]);

  // 一屏 400px：109px 的行放得下 3 行，兜底的 54 放 7 行 —— 窗口跟着行高收窄
  // （两边都留 overscan 8 行，所以首行都是 0，差别在末尾）。
  const phoneWindow = getSessionListIndices(200, 0, 400, -1, phoneRow);
  assert.equal(phoneWindow.length, Math.ceil(400 / phoneRow) + 16);
  assert.ok(phoneWindow.length < getSessionListIndices(200, 0, 400, -1).length);
  // 行距真的换了：第 20 行之外的位置在 109px 行距下还没进窗口。
  assert.ok(phoneWindow.includes(3) && !phoneWindow.includes(20));
});

test("only Shift+click bypasses session deletion confirmation", () => {
  assert.match(
    sessionItemSource,
    /const handleDeleteClick[\s\S]*?if \(e\.shiftKey\) \{\s*void performDelete\(\);\s*\} else \{\s*setConfirmDelete\(true\);/,
  );
});

test("does not register row-level session deletion shortcuts", () => {
  assert.doesNotMatch(sessionItemSource, /const handleKeyDown/);
  assert.doesNotMatch(sessionItemSource, /onKeyDown=\{handleKeyDown\}/);
  assert.doesNotMatch(sessionItemSource, /tabIndex=\{0\}/);
});

test("polls running sessions only while the tab is visible", () => {
  assert.doesNotMatch(source, /new EventSource\("\/api\/agent\/running\/events"\)/);
  assert.match(source, /fetch\("\/api\/agent\/running"/);
  assert.match(source, /document\.visibilityState !== "visible"/);
  assert.match(source, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/);
});

test("exposes the polled running-session set to the shell", () => {
  assert.match(source, /onRunningSessionIdsChange\?: \(ids: Set<string>\) => void/);
  assert.match(source, /onRunningSessionIdsChange\?\.\(runningSessionIds\)/);
});

test("exposes the loaded session catalog to the shell", () => {
  assert.match(source, /onSessionsChange\?: \(sessions: SessionInfo\[\]\) => void/);
  assert.match(source, /onSessionsChange\?\.\(allSessions\)/);
});

test("subagent completion stays silent and never becomes unread", () => {
  assert.match(source, /completionNotificationSuppressedSessionIds\?: string\[\]/);
  assert.match(
    source,
    /completedWithNotifications = completedInBackground\.filter\([\s\S]*?!previousSuppressedCompletionSessionIdsRef\.current\.has\(id\)[\s\S]*?!knownSubagentIds\.has\(id\)/,
  );
  // fork:trace-menu —— 未读标记搬进 lib/session-unread.ts 之后，完成时是
  // `markSessionUnread(id)`（子代理的过滤仍在 completedWithNotifications 那一步）。
  assert.match(source, /completedWithNotifications\.forEach\(markSessionUnread\)/);
  assert.match(source, /if \(completedWithNotifications\.length > 0\) \{\s*onBackgroundTaskDone\?\.\(\)/);
  assert.match(
    source,
    /filter\(\(session\) => session\.relation\?\.kind !== "subagent"\)[\s\S]*?pruneSessionUnread\(unreadEligibleIds\)/,
  );
});

test("keeps the unread count in an accessible label and no running badge on the project row", () => {
  // fork:no-running-badge-on-project-row-2026-10-02 —— 运行态归会话行的底边扫掠线
  // （画板 02 三者互斥表：运行中 → 右侧标记 = 无）。这条断言钉住那枚「转圈 + 运行中
  // 会话数」不会再长回项目行。
  assert.doesNotMatch(source, /sidebar\.agentRunning/);
  assert.doesNotMatch(source, /activity\.running/);
  assert.match(
    source,
    /aria-label=\{`\$\{t\("sidebar\.newSessionActivity"\)\} \(\$\{activity\.unread\}\)`\}/,
  );
});

test("formats session timestamps with the active locale", () => {
  assert.match(source, /import \{ formatRelativeTime \} from "@\/lib\/i18n\/format"/);
  assert.match(sessionItemSource, /const \{ locale, t \} = useI18n\(\)/);
  assert.match(sessionItemSource, /formatRelativeTime\(session\.modified, locale\)/);
});

test("does not persist an unchanged fallback title ending in whitespace", () => {
  assert.match(
    sessionItemSource,
    /const name = renameValue\.trim\(\);[\s\S]*?if \(renameValue === title \|\| name === \(session\.name \?\? ""\)\) return;/,
  );
});

test("offers the downstream context-menu hook only on a normal session row", () => {
  assert.match(sessionItemSource, /const handleContextMenu[\s\S]*?dispatchSessionRowContextMenu\(\{/);
  assert.match(
    sessionItemSource,
    /onContextMenu=\{confirmDelete \|\| renaming \? undefined : handleContextMenu\}/,
  );
});

test("lifecycle refreshes bypass the cache while cross-window polling reuses it", () => {
  assert.match(source, /function sessionListUrl\(summary: boolean, force: boolean\)/);
  assert.match(source, /if \(summary\) return "\/api\/sessions\?summary=1"/);
  assert.match(source, /if \(force\) return "\/api\/sessions\?force=1"/);
  assert.match(source, /cache: "no-store"/);
  // First paint uses the cheap summary listing, then hydrates after a delay.
  assert.match(source, /loadSessions\(true, false, true\)/);
  assert.match(source, /setTimeout\(\(\) => \{[\s\S]*?void loadSessions\(false, true\)/);
  assert.match(source, /data\.sessionListVersion !== sessionListVersionRef\.current[\s\S]*?await loadSessions\(\)/);
  assert.doesNotMatch(source, /sessionRefreshDone|sessionRefreshTimerRef|title=\{t\("sidebar\.refresh"\)\}/);
  assert.match(source, /loadSessions\(false, true\);[\s\S]*?onBackgroundTaskDone/);
});

test("does not expose disk-backed actions for transient sessions", () => {
  assert.match(sessionItemSource, /if \(session\.transient\) return;/);
  // fork:pwa-sidebar-files —— 手机上那排 hover 动作改成常驻的一枚 ⋯ 菜单，
  // 菜单项里仍带 `!session.transient` 的判据；所以这排 inline 动作在手机上完全不渲染。
  assert.match(sessionItemSource, /\{!isMobile && showHover && !session\.transient \? \(/);
});

test("hides subagent rows and aggregates their state into the main session row", () => {
  // The session list feeds through the client-side pin/archive flags before it is
  // grouped into families, so a pinned row sorts first and an archived row drops out.
  // fix:pin-partition —— 排序在这里给：listSessionFamilies 不再重排（会把置顶洗掉）。
  // fork:pi-1.1 —— 排序仍在这里给（listSessionFamilies 不重排），随后按「显示更多」
  // 截断：`sessionFamilies` 是 `visibleFamilies(...)` 的结果，未截断的在 `allSessionFamilies`。
  assert.match(
    source,
    /const allSessionFamilies = listSessionFamilies\(applySessionFlags\(\s*\[\.\.\.filteredSessions\]\.sort\(\(a, b\) => b\.modified\.localeCompare\(a\.modified\)\),\s*sessionFlags,\s*\)\)/,
  );
  assert.match(source, /const sessionFamilies = selectedFamiliesSplit\.visible;/);
  assert.match(source, /familySessions\.some\(\(session\) => session\.id === selectedSessionId\)/);
  assert.match(source, /familySessions\.some\(\(session\) => runningSessionIds\.has\(session\.id\)\)/);
  assert.doesNotMatch(source, /function SessionTreeItem/);
});

test("keeps configuration out of the sidebar — entry points live in the AppShell footer", () => {
  assert.match(source, /label=\{t\("sidebar\.newTask"\)\}/);
  assert.doesNotMatch(source, /section="(?:models|skills|plugins|settings)"/);
  assert.doesNotMatch(source, /onOpenSettings/);
});

test("renders projects as primary rows with the selected project's tasks nested below", () => {
  assert.match(source, /\{visibleProjects\.map\(\(project\) => \{/);
  assert.match(source, /<ProjectRow/);
  // The fork renders the selected project's tasks through an explicit branch
  // (the upstream inline `isSelectedProject && (` form was restructured).
  assert.match(source, /if \(project\.key === selectedProject\?\.key\) \{[\s\S]*?ref=\{sessionListRef\}/);
  // fork:ui-project-actions — 「添加项目」按钮已按用户要求移除（改用项目行的 ⋯ / 打开文件夹）。
  assert.doesNotMatch(source, /t\("sidebar\.addProject"\)/);
  assert.doesNotMatch(source, /showMoreProjects/);
  assert.doesNotMatch(source, /showFewerProjects/);
  assert.doesNotMatch(source, /PROJECTS_COLLAPSED_LIMIT/);
});

// fork:chat-workspace / fork:zn-13
test("keeps a standalone chat section beside the projects", () => {
  assert.match(source, /<ChatWorkspaceRow/);
  // fork:ui-project-actions — 「新建任务」右侧的项目下拉已移除（用户要求）；项目相关动作
  // 现在挂在每个项目行的「⋯」上，「添加项目」在项目列表底部一行。
  assert.doesNotMatch(source, /<NewTaskPicker/);
  assert.match(source, /filterHiddenProjects\(/);
  assert.match(source, /projectDisplayName\(project\.root, projectPrefs\)/);
  // fork:ui-project-actions — 项目列表再经本地偏好（别名 / 从列表移除）过滤。
  assert.match(source, /filterHiddenProjects\(\s*withoutChatProject\(projectChoices, chatProjectKey\),/);
  assert.match(source, /fetch\("\/api\/chat-workspace"/);
  // 聊天 与 项目 平级（侧栏 tab 分 pane）：项目分区在前，聊天分区排在项目行之后。
  assert.ok(
    source.indexOf("<ChatWorkspaceRow") > source.indexOf('{t("sidebar.projects")}'),
    "the chat section renders after the projects caption",
  );
  assert.ok(
    source.indexOf('{sidebarPane === "chat" && chatProject && (() => {') > source.indexOf("{visibleProjects.map((project) => {"),
    "the chat section renders below the project rows",
  );
  // The default workspace is resolved at click time — never the "" / "/" render value.
  assert.match(source, /const resolveDefaultCwd = useCallback\(async \(\): Promise<string \| null> => \{/);
  assert.match(source, /if \(selectedCwd\) return selectedCwd;/);
  assert.doesNotMatch(source, /selectedCwd \|\| homeDir \|\| "\/"/);
  assert.doesNotMatch(source, /chatWorkspace\?\.cwd \|\| homeDir \|\| "\/"/);
  // fork:zn-13-margin —— 项目段与聊天段自 fork:zn-20 起**互斥渲染**，那句
  // `marginTop: 18` 失去了分隔对象，在聊天 pane 上就是 `.d-seg` 与第一行之间凭空多出
  // 的一截空白（用户 2026-10-05 报「中间空白太多」）。画板 D-02 是直连，不带这个 margin。
  assert.doesNotMatch(source, /style=\{\{ marginTop: 18 \}\}/);
});

// fork:ui-pop-portal-fix —— 侧栏的两个下拉（worktree 切换 / 项目 ⋯）必须用**共享的**
// `components/PortalDropdown.tsx`。9-29 那轮只改了共享版，侧栏里留着一份同源旧副本
// （没有给 portal 容器 z-index），于是浮窗被 `.sidebar-container`(z 200) 整块盖住 ——
// DOM 里有、点不到、看不见。这条守卫防止副本再长回来。
test("reuses the shared PortalDropdown instead of a local copy", () => {
  // fork:pwa-sidebar-files —— 从共享件多引一枚 `useDismissMenu`（触摸下 `pointerdown`
  // 判据 + 捕获阶段 Esc），仍然只有一个实现，没长副本。
  assert.match(source, /import \{ PortalDropdown, useDismissMenu \} from "\.\/PortalDropdown";/);
  assert.doesNotMatch(source, /^(const|function) DROPDOWN_ANIMATION_MS/m);
  assert.doesNotMatch(source, /^function AnimatedDropdown\(/m);
  assert.doesNotMatch(source, /^function PortalDropdown\(\{/m);
  assert.doesNotMatch(source, /from "react-dom"/, "portal 只在共享件里做");
});

// fork:session-tree-collapsed + fork:caret-corner（用户 2026-10-05）—— 两件事：
//   ① 带子代理的会话**默认收起**（此前默认全摊开，一屏被子会话吃掉）；
//   ② 折叠箭头落在**行右上角**，且是绝对定位 —— 行高被量成定数（`.d-sess` 恒 58.89），
//      任何进流的盒子都会把行顶出槽位，就是用户报的「重影」。
const forms = await readFile(new URL("../app/design/v5-forms.css", import.meta.url), "utf8");

test("subagent families start collapsed and the caret sits in the row corner", () => {
  // 状态记的是「展开过」，不是「收起的」—— 后者在会话异步到达时无从初始化。
  assert.match(source, /const \[expandedFamilies, setExpandedFamilies\] = useState<ReadonlySet<string>>\(\(\) => new Set\(\)\)/);
  assert.match(source, /collapsed=\{!expandedFamilies\.has\(family\.root\.id\)\}/);
  const expand = source.slice(source.indexOf("function expandSidebarEntries("), source.indexOf("// ---"));
  assert.match(expand, /if \(!expanded\.has\(entry\.item\.root\.id\)\) continue;/);

  // 箭头不再待在 `.d-sess-m` 里（那行是元信息），而是行内绝对定位的一个角标。
  assert.match(forms, /\.fork-sess-caret \{ position: absolute; top: 3px; right: 4px;/);
  assert.match(forms, /\.d-sess:has\(\.fork-sess-caret\) \.d-sess-t \{ padding-right: 24px; \}/);
  const desktopRow = sessionItemSource.slice(sessionItemSource.indexOf("fork:caret-corner"));
  assert.match(desktopRow, /className="fork-sess-caret"/);
  assert.ok(
    desktopRow.indexOf("fork-sess-caret") < desktopRow.indexOf('className="d-sess-m'),
    "the caret must be rendered before the meta row (i.e. not inside it)",
  );
});
