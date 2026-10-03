// fork:mobile-drawer-2026-10-03 —— 侧栏「最近」分栏与下拉刷新的接线锁定。
//
// 与同目录其它侧栏测试同口径：对源码做结构断言（组件是 client-only、依赖大量
// 运行时上下文，起一个真 DOM 反而测不到接线本身）。锁的是**三件容易悄悄坏掉的事**：
// 1) 第三格真的渲染出来了，且默认值没被改（那是 lib/sidebar-pane.test.mjs 的活）
// 2) 最近列表的数据是「跨工作区 + 倒序 + 走同一份置顶/归档规则」
// 3) 下拉刷新不抢 preventDefault（抢了会与抽屉左滑关闭打架）

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const HERE = dirname(fileURLToPath(import.meta.url));
const code = readFileSync(join(HERE, "SessionSidebar.tsx"), "utf8");

test("the seg switch has three panes and recent is the one added", () => {
  assert.match(code, /aria-selected=\{sidebarPane === "recent"\}/);
  assert.match(code, /aria-selected=\{sidebarPane === "projects"\}/);
  assert.match(code, /aria-selected=\{sidebarPane === "chat"\}/);
  assert.equal((code.match(/role="tab"/g) ?? []).length, 3);
});

test("recent is a flat cross-workspace list ordered by recency", () => {
  // 倒序 + 同一份规则（applySessionFlags），不是另写一套过滤。
  assert.match(code, /const recentSessions = useMemo\(\(\) => applySessionFlags\(/);
  assert.match(code, /\[\.\.\.allSessions\]\.sort\(\(a, b\) => b\.modified\.localeCompare\(a\.modified\)\)/);
  // 行尾那枚工作区标签：复用既有 .pw-badge，不新造类。
  assert.match(code, /trailing=\{trailing\}/);
  assert.match(code, /className="pw-badge" title=\{session\.projectRoot \?\? session\.cwd\}/);
});

test("pull-to-refresh is armed only at the top and never steals the gesture", () => {
  assert.match(code, /onTouchStart=\{handleListTouchStart\}/);
  assert.match(code, /onTouchMove=\{handleListTouchMove\}/);
  assert.match(code, /armed: \(el\?\.scrollTop \?\? 1\) <= 0/);
  // 抢 preventDefault 会让抽屉左滑关闭失效，所以这一行不许出现。
  assert.doesNotMatch(code, /touchmove[\s\S]{0,200}preventDefault/);
  assert.match(code, /void loadSessions\(false, true\)\.finally\(\(\) => setPullRefreshing\(false\)\)/);
});