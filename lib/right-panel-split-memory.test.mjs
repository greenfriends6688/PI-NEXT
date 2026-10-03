import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const {
  DRAFT_SESSION_SLOT,
  loadRightPanelWidthMemory,
  loadSplitRatio,
  saveRightPanelWidthMemory,
  saveSplitRatio,
} = await jiti.import("./right-panel-split-memory.ts");

function memoryStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, value); },
  };
}

test("比例按会话槽存取，互不干扰", () => {
  const storage = memoryStorage();
  assert.equal(loadSplitRatio("s1", storage), 0.5, "没存过 = 中位");
  saveSplitRatio("s1", 0.62, storage);
  saveSplitRatio("s2", 0.38, storage);
  assert.equal(loadSplitRatio("s1", storage), 0.62);
  assert.equal(loadSplitRatio("s2", storage), 0.38);
  // 落盘前就夹紧：手滑存进去的 0.95 回来也是 0.7。
  saveSplitRatio("s3", 0.95, storage);
  assert.equal(loadSplitRatio("s3", storage), 0.7);
});

test("宽度记忆按会话槽存取；非法值退回种子", () => {
  const storage = memoryStorage();
  saveRightPanelWidthMemory("s1", {
    ordinaryWidth: 480,
    wideWidth: 900,
    hasOpenedWideWorkspace: true,
  }, storage);
  assert.deepEqual(loadRightPanelWidthMemory("s1", { ordinaryWidth: 300 }, storage), {
    ordinaryWidth: 480,
    wideWidth: 900,
    hasOpenedWideWorkspace: true,
  });

  const broken = memoryStorage({
    "pi-web:right-panel-widths-by-session": JSON.stringify({
      s1: { ordinaryWidth: "480", wideWidth: -1 },
      s2: [1, 2, 3],
      s3: "nope",
    }),
  });
  // 非数字 / 负数 / 非对象 —— 一律退回种子，绝不把半个对象放进面板。
  for (const slot of ["s1", "s2", "s3", "missing"]) {
    assert.deepEqual(loadRightPanelWidthMemory(slot, { ordinaryWidth: 420 }, broken), {
      ordinaryWidth: 420,
      wideWidth: 420,
      hasOpenedWideWorkspace: false,
    });
  }
  // 只有一档合法时，另一档拿种子补齐。
  const half = memoryStorage({
    "pi-web:right-panel-widths-by-session": JSON.stringify({ s4: { wideWidth: 860 } }),
  });
  assert.deepEqual(loadRightPanelWidthMemory("s4", { ordinaryWidth: 420 }, half), {
    ordinaryWidth: 420,
    wideWidth: 860,
    hasOpenedWideWorkspace: false,
  });
});

test("存储不可用 / 槽位为空时降级为本次运行有效", () => {
  assert.deepEqual(loadSplitRatio("s1", null), 0.5);
  assert.deepEqual(loadSplitRatio("", memoryStorage()), 0.5);
  assert.deepEqual(loadRightPanelWidthMemory("", { ordinaryWidth: 500 }, memoryStorage()), {
    ordinaryWidth: 500,
    wideWidth: 500,
    hasOpenedWideWorkspace: false,
  });
  // 写不进去也不抛：localStorage 被禁用时不该把分屏功能整个带走。
  saveRightPanelWidthMemory("s1", { ordinaryWidth: 1, wideWidth: 2, hasOpenedWideWorkspace: false }, null);
  saveSplitRatio("s1", 0.4, null);
});

test("新会话草稿有自己的固定槽位", () => {
  assert.equal(DRAFT_SESSION_SLOT, "new-draft");
});