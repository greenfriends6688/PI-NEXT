// fork:proma-43-automation —— 存储层的单测。
//
// 用临时目录当 agentDir，所以跑完不碰真实的 ~/.pi/agent/automation。
// store 依赖 pi 的 getAgentDir 与 node fs，走 jiti（`registry.test.mjs` 同款做法）。
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const store = await jiti.import("./automation-store.ts");
const { normalizeAutomationDraft } = await jiti.import("./automation-types.ts");

const THU_0900 = new Date(2026, 2, 12, 9, 0, 0).getTime();

function withTempAgentDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "pi-automation-test-"));
  try {
    return fn(dir);
  } finally {
    store.resetAutomationStoreCache();
    rmSync(dir, { recursive: true, force: true });
  }
}

function draft(overrides = {}) {
  return normalizeAutomationDraft({
    name: "Morning triage",
    prompt: "summarise yesterday",
    scheduleType: "daily",
    intervalMinutes: 60,
    timeOfDay: "09:00",
    ...overrides,
  });
}

test("目录落在 ~/.pi/agent/automation/ 下（pi CLI 不扫它，所以不会互相干扰）", () => {
  withTempAgentDir((dir) => {
    assert.equal(store.automationStoreDir(dir), join(dir, "automation"));
    assert.equal(store.automationIndexPath(dir), join(dir, "automation", "automations.json"));
  });
});

test("没有文件时读到空列表，不建目录也不报错", () => {
  withTempAgentDir((dir) => {
    assert.deepEqual(store.listAutomations(dir), []);
  });
});

test("创建后立刻算好 nextRunAt，索引以 0600 原子落盘", () => {
  withTempAgentDir((dir) => {
    const created = store.createAutomation(draft(), THU_0900, dir);
    assert.equal(created.nextRunAt, THU_0900);
    const path = store.automationIndexPath(dir);
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(parsed.version, 1);
    assert.equal(parsed.automations.length, 1);
    // staging 文件不能留下
    assert.deepEqual(readdirSync(join(dir, "automation")), ["automations.json"]);
  });
});

test("改调度规则会重算 nextRunAt；改无关字段不会", () => {
  withTempAgentDir((dir) => {
    const created = store.createAutomation(draft(), THU_0900, dir);
    const renamed = store.updateAutomation(created.id, draft({ name: "Renamed" }), THU_0900 + 60_000, dir);
    assert.equal(renamed.nextRunAt, created.nextRunAt, "改名不该动锚点");
    const retimed = store.updateAutomation(created.id, draft({ timeOfDay: "18:00" }), THU_0900, dir);
    assert.equal(retimed.nextRunAt, new Date(2026, 2, 12, 18, 0, 0).getTime());
  });
});

test("存储坏掉时抛 AutomationStoreReadError，绝不回落成空列表", () => {
  withTempAgentDir((dir) => {
    const path = store.automationIndexPath(dir);
    store.createAutomation(draft(), THU_0900, dir);
    store.resetAutomationStoreCache();
    writeFileSync(path, "{ not json");
    store.resetAutomationStoreCache();
    assert.throws(() => store.listAutomations(dir), (error) => {
      assert.equal(error.name, "AutomationStoreReadError");
      return true;
    });
    // 关键：坏文件必须原样保留，下一次保存才不会被悄悄抹平
    assert.equal(readFileSync(path, "utf8"), "{ not json");
  });
});

test("版本比本仓新时原样加载，不覆盖磁盘", () => {
  withTempAgentDir((dir) => {
    const path = store.automationIndexPath(dir);
    mkdirSync(join(dir, "automation"), { recursive: true });
    writeFileSync(path, JSON.stringify({ version: 99, automations: [] }));
    store.resetAutomationStoreCache();
    assert.deepEqual(store.listAutomations(dir), []);
  });
});

test("appendRun 截断历史到 20 条，markSessionTakenOver 记下接管过的会话", () => {
  withTempAgentDir((dir) => {
    const created = store.createAutomation(draft(), THU_0900, dir);
    for (let i = 0; i < 25; i++) {
      store.appendRun(created.id, { runAt: THU_0900 + i, sessionId: `s${i}`, status: "success" }, dir);
    }
    const afterRuns = store.getAutomation(created.id, dir);
    assert.equal(afterRuns.runHistory.length, 20);
    assert.equal(afterRuns.runHistory.at(-1).sessionId, "s24");

    const marked = store.markSessionTakenOver(created.id, "s1", dir);
    assert.deepEqual(marked.takenOverSessionIds, ["s1"]);
    // 重复标记不产生重复项
    assert.deepEqual(store.markSessionTakenOver(created.id, "s1", dir).takenOverSessionIds, ["s1"]);
  });
});

test("deleteAutomation 命中返回 true、未命中返回 false", () => {
  withTempAgentDir((dir) => {
    const created = store.createAutomation(draft(), THU_0900, dir);
    assert.equal(store.deleteAutomation("nope", dir), false);
    assert.equal(store.deleteAutomation(created.id, dir), true);
    assert.deepEqual(store.listAutomations(dir), []);
  });
});

// ---------------------------------------------------------------------------
test("normalizeAutomationDraft 丢掉与 scheduleType 无关的字段", () => {
  // weekly 上残留的 interval 窗口不该被存下去（改回去时会诈尸）
  const normalized = normalizeAutomationDraft({
    name: "x",
    prompt: "y",
    scheduleType: "weekly",
    intervalMinutes: 30,
    timeOfDay: "07:00",
    dayOfWeek: 1,
    activeWindowStart: "09:00",
    activeWindowEnd: "18:00",
    activeWeekdays: [1, 2, 3],
  });
  assert.equal(normalized.activeWindowStart, undefined);
  assert.equal(normalized.activeWeekdays, undefined);
  assert.equal(normalized.dayOfWeek, 1);
});

test("normalizeAutomationDraft 的边界：dayOfWeek=0 合法，半截时段窗非法", () => {
  const sunday = normalizeAutomationDraft({
    name: "x", prompt: "y", scheduleType: "weekly", intervalMinutes: 60, timeOfDay: "07:00", dayOfWeek: 0,
  });
  assert.equal(sunday.dayOfWeek, 0, "0 = 周日，不能被当成缺省值");

  assert.throws(() => normalizeAutomationDraft({
    name: "x", prompt: "y", scheduleType: "interval", intervalMinutes: 60, activeWindowStart: "09:00",
  }), /provided together/);
  assert.throws(() => normalizeAutomationDraft({
    name: "x", prompt: "y", scheduleType: "interval", intervalMinutes: 60, activeWindowStart: "18:00", activeWindowEnd: "09:00",
  }), /earlier than/);
  assert.throws(() => normalizeAutomationDraft({
    name: "x", prompt: "y", scheduleType: "interval", intervalMinutes: 0,
  }), /at least 1/);
  assert.throws(() => normalizeAutomationDraft({
    name: "", prompt: "y", scheduleType: "daily", intervalMinutes: 60, timeOfDay: "09:00",
  }), /name must not be empty/);
  assert.throws(() => normalizeAutomationDraft({
    name: "x", prompt: "y", scheduleType: "monthly", intervalMinutes: 60,
  }), /scheduleType must be one of/);
  // activeWeekdays 去重 + 排序
  const weekdays = normalizeAutomationDraft({
    name: "x", prompt: "y", scheduleType: "interval", intervalMinutes: 60, activeWeekdays: [3, 1, 3],
  });
  assert.deepEqual(weekdays.activeWeekdays, [1, 3]);
});