// fork:mobile-drawer-2026-10-03 —— 侧栏列表「下拉刷新」的接线锁定。
//
// 与同目录其它侧栏测试同口径：对源码做结构断言（组件是 client-only、依赖大量
// 运行时上下文，起一个真 DOM 反而测不到接线本身）。锁的是**两件容易悄悄坏掉的事**：
// 1) 判定必须要求「已在顶部且方向朝下」，否则松手就变成滚动
// 2) 不抢 preventDefault（抢了会与抽屉左滑关闭打架）

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const HERE = dirname(fileURLToPath(import.meta.url));
const code = readFileSync(join(HERE, "SessionSidebar.tsx"), "utf8");

test("pull-to-refresh is armed only at the top and never steals the gesture", () => {
  assert.match(code, /onTouchStart=\{handleListTouchStart\}/);
  assert.match(code, /onTouchMove=\{handleListTouchMove\}/);
  assert.match(code, /armed: \(el\?\.scrollTop \?\? 1\) <= 0/);
  // 抢 preventDefault 会让抽屉左滑关闭失效，所以这一行不许出现。
  assert.doesNotMatch(code, /touchmove[\s\S]{0,200}preventDefault/);
  assert.match(code, /void loadSessions\(false, true\)\.finally\(\(\) => setPullRefreshing\(false\)\)/);
});
