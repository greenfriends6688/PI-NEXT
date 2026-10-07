import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("shares one guarded older-page loader between the sentinel and the minimap", () => {
  const loader = source.slice(
    source.indexOf("const loadOlderPage = useCallback"),
    source.indexOf("// IntersectionObserver on the sentinel div"),
  );

  assert.match(loader, /if \(loadingOlderRef\.current\) return/);
  assert.match(loader, /if \(!hasEarlierMessages\) return/);
  assert.match(loader, /const oldestId = historyCursor/);
  assert.match(loader, /prevScrollDistanceRef\.current = captureScrollDistance/);
  assert.match(loader, /loadingOlderRef\.current = true/);
  assert.match(loader, /setLoadingEarlier\(true\)/);
  assert.match(loader, /await loadContext\(sid, activeLeafId, oldestId\)/);
  assert.match(
    loader,
    /finally \{[\s\S]*?loadingOlderRef\.current = false;[\s\S]*?setLoadingEarlier\(false\)/,
  );

  // The sentinel keeps its observer but delegates the fetch to the shared loader.
  const observer = source.slice(
    source.indexOf("// IntersectionObserver on the sentinel div"),
    source.indexOf("// Keep the rendered window at least as large"),
  );
  assert.match(observer, /void loadOlderPage\(\)/);
  assert.doesNotMatch(observer, /loadContext\(/);
});

test("the minimap no longer owns the older-history loader (the sentinel does)", () => {
  // fork:v6-landing（2026-10-07 用户实拍第二轮）—— 导轨换成画板 D-32 的细刻度 +
  // `.d-navpop` 小卡，board 53 的 320px 大纲面板（带「加载更早」按钮）整块退场，
  // 所以这三个 props 不再传。翻页只剩顶部 sentinel 一条路（上一条测试锁着它仍走
  // 同一个 `loadOlderPage`）。
  const start = source.indexOf("<ChatMinimap\n");
  const minimap = source.slice(start, source.indexOf("/>\n", start));

  assert.doesNotMatch(minimap, /hasEarlierMessages=|loadingEarlier=|onLoadEarlier=/);
  assert.match(minimap, /onRevealHistory=\{revealHistoryForMinimap\}/);
  assert.match(source, /void loadOlderPage\(\)/);
});
