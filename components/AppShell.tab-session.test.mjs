// fork:tab-session — upstream-port marker
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("first paint does not read tab sessionStorage", () => {
  assert.match(
    source,
    /const \[initialNavigation, setInitialNavigation\] = useState\(\(\) => getInitialNavigation\(searchParams\)\);/,
  );
  assert.doesNotMatch(
    source,
    /useState\(\(\) => getInitialNavigation\(searchParams,\s*getTabOpen/,
  );
});

test("applies tab session memory after mount instead of suppressing hydration", () => {
  assert.match(
    source,
    /useLayoutEffect\(\(\) => {\s+const next = withTabOpen\(initialNavigation, getTabOpen\(\)\);[\s\S]*?setInitialNavigation\(next\);[\s\S]*?if \(next\.sessionId\) setInitialSessionRestored\(false\);[\s\S]*?\}, \[initialNavigation\]\);/,
  );
  assert.doesNotMatch(source, /suppressHydrationWarning/);
});

test("writes the session URL when tab memory restores onto an empty address bar", () => {
  assert.match(
    source,
    /if \(!isRestore \|\| new URLSearchParams\(window\.location\.search\)\.get\("session"\) !== session\.id\) \{\s+router\.replace\(`\?session=\$\{encodeURIComponent\(session\.id\)\}`/,
  );
});

test("New session is remembered as this tab's selection", () => {
  const start = source.indexOf("  const handleNewSession = useCallback");
  const end = source.indexOf("  // Global keyboard shortcuts", start);
  const body = source.slice(start, end);
  assert.match(body, /router\.replace\(`\?cwd=\$\{encodeURIComponent\(cwd\)\}`/);
});

test("deleting the current session forgets its tab memory", () => {
  const start = source.indexOf("  const handleSessionDeleted = useCallback");
  const end = source.indexOf("  const handleOpenFile = useCallback", start);
  const body = source.slice(start, end);
  assert.match(body, /clearTabOpenSession\(sessionId\);/);
  assert.ok(body.indexOf("clearTabOpenSession(sessionId)") < body.indexOf("setSelectedSession(null)"));
});

test("panelTabs 重算依赖表里有 traceOpen（2026-10-06 用户反馈：调用轨迹的 × 关不掉）", () => {
  /* 单例 tab 的「开 / 关」全靠 `traceOpen`。它漏在 useMemo 的依赖表里时：
     打开后标签要等别的 state 变化才出现；关闭后标签还挂着 —— 看起来就是 × 没反应。
     这是**只有运行时才看得见**的一类错（tsc 与其余单测全绿），所以按源码钉住。 */
  const start = source.indexOf("const panelTabs: Tab[] = useMemo(");
  assert.ok(start > 0, "找不到 panelTabs 的 useMemo");
  const end = source.indexOf("], tabOrder)", start);
  assert.ok(end > start, "找不到 panelTabs 的依赖表");
  const block = source.slice(start, end);
  const deps = source.slice(end, source.indexOf("]);", end));
  assert.match(block, /traceOpen \? \[\{/, "panelTabs 里仍在读 traceOpen");
  assert.match(deps, /traceOpen/, "依赖表必须含 traceOpen，否则 setTraceOpen 不会重算");
});
