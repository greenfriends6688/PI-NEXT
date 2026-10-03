// fork:proma-43-automation —— 调度器生命周期的单测。
//
// 时钟 / 定时器 / 存储 / agent 运行口全部是假实现，所以「跨自然日」「连续失败到顶」
// 「忙时跳过」这些在真实世界里要等几小时的现象，这里几毫秒就跑完。
//
// 用 jiti 而不是 `--experimental-strip-types` 的直接导入：调度器对 `automation-types` /
// `automation-schedule` 是**值**导入，node 的 ESM 解析器不给无扩展名的相对路径兜底
// （源码里的相对导入也不能写成 `./x.ts`，tsconfig 没开 allowImportingTsExtensions，
// Next 的打包器同样按无扩展名解析）。
import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  applyRunOutcome,
  buildAutomationContext,
  buildRunPrompt,
  createAutomationScheduler,
  decideSessionTarget,
  resumeAutomation,
  withRunTimeout,
  AutomationTimeoutError,
} = await jiti.import("./automation-scheduler.ts");
const { AUTOMATION_RUN_MARKER, AUTOMATION_TICK_INTERVAL_MS } = await jiti.import("./automation-types.ts");

const THU_0900 = new Date(2026, 2, 12, 9, 0, 0).getTime();
const THU_0930 = new Date(2026, 2, 12, 9, 30, 0).getTime();
const FRI_0900 = new Date(2026, 2, 13, 9, 0, 0).getTime();
const OVERNIGHT = new Date(2026, 2, 12, 3, 0, 0).getTime();

function makeAutomation(overrides = {}) {
  return {
    id: "a1",
    name: "triage",
    prompt: "summarise yesterday",
    active: true,
    scheduleType: "daily",
    intervalMinutes: 60,
    cwd: "/repo",
    createdAt: 0,
    updatedAt: 0,
    nextRunAt: THU_0900,
    runHistory: [],
    ...overrides,
  };
}

/** 内存 store（每次 save 都把 latest 存回去，模拟「读到的是最新值」）。 */
function makeStore(initial) {
  let records = new Map(initial.map((a) => [a.id, a]));
  const saves = [];
  return {
    saves,
    records: () => records,
    store: {
      list: () => [...records.values()].map((a) => ({ ...a })),
      get: (id) => records.get(id),
      save: (automation) => {
        records.set(automation.id, { ...automation });
        saves.push(automation.id);
        return automation;
      },
    },
  };
}

function translate() {
  return () => "TXT";
}

/** 可手动推进的假定时器。 */
function makeTimer() {
  const entries = new Map();
  const delays = [];
  let nextHandle = 1;
  return {
    get registered() {
      return entries.size;
    },
    setInterval(callback, ms) {
      const handle = nextHandle++;
      entries.set(handle, callback);
      delays.push(ms);
      return handle;
    },
    clearInterval(handle) {
      entries.delete(handle);
    },
    fire: () => {
      for (const callback of [...entries.values()]) callback();
    },
    delays,
  };
}

// ---------------------------------------------------------------------------
// 规则三 · 子会话复用
// ---------------------------------------------------------------------------
test("decideSessionTarget：没有会话 / 没跑过 → 新建", () => {
  assert.deepEqual(decideSessionTarget({ automation: makeAutomation(), now: THU_0900 }),
    { reuse: false, reason: "no-session" });
  assert.deepEqual(
    decideSessionTarget({ automation: makeAutomation({ lastSessionId: "s1" }), now: THU_0900 }),
    { reuse: false, reason: "never-run" },
  );
});

test("规则三 · daily 档同一本地自然日复用", () => {
  const a = makeAutomation({ lastSessionId: "s1", lastRunAt: THU_0930, sessionMode: "daily" });
  assert.deepEqual(decideSessionTarget({ automation: a, now: THU_0900 }), { reuse: true, sessionId: "s1" });
  // 同一天 23:59 → 次日 00:01 是**跨自然日**（不是「跨 24 小时」），所以要新建
  const lateInDay = makeAutomation({ lastSessionId: "s1", lastRunAt: new Date(2026, 2, 12, 23, 59, 0).getTime() });
  assert.deepEqual(
    decideSessionTarget({ automation: lateInDay, now: new Date(2026, 2, 13, 0, 1, 0).getTime() }),
    { reuse: false, reason: "cross-day" },
  );
});

test("规则三 · daily 档跨自然日新建", () => {
  const a = makeAutomation({ lastSessionId: "s1", lastRunAt: THU_0930, sessionMode: "daily" });
  assert.deepEqual(decideSessionTarget({ automation: a, now: FRI_0900 }),
    { reuse: false, reason: "cross-day" });
});

test("规则三 · 同日但上下文占用 ≥70% 主动新建（避开 SDK 约 77.5% 的压缩阈值）", () => {
  const a = makeAutomation({ lastSessionId: "s1", lastRunAt: THU_0930 });
  assert.deepEqual(decideSessionTarget({ automation: a, now: THU_0900, lastContextUsage: 0.7 }),
    { reuse: false, reason: "context-pressure" });
  assert.deepEqual(decideSessionTarget({ automation: a, now: THU_0900, lastContextUsage: 0.92 }),
    { reuse: false, reason: "context-pressure" });
  // 69.9% 还复用
  assert.equal(decideSessionTarget({ automation: a, now: THU_0900, lastContextUsage: 0.699 }).reuse, true);
  // 读不到占用率时保守复用：不因为一次探测失败就切断连续上下文
  assert.equal(decideSessionTarget({ automation: a, now: THU_0900 }).reuse, true);
});

test("规则三 · reuse 档始终复用，跨日也不新建", () => {
  const a = makeAutomation({ lastSessionId: "s1", lastRunAt: THU_0930, sessionMode: "reuse" });
  assert.deepEqual(decideSessionTarget({ automation: a, now: FRI_0900 }), { reuse: true, sessionId: "s1" });
});

test("规则三 · 用户接管过的会话不再复用", () => {
  const a = makeAutomation({ lastSessionId: "s1", lastRunAt: THU_0930, sessionMode: "reuse" });
  assert.deepEqual(decideSessionTarget({ automation: a, now: THU_0900, takenOver: true }),
    { reuse: false, reason: "taken-over" });
});

// ---------------------------------------------------------------------------
// 规则四 · 失败退避 + 自动暂停
// ---------------------------------------------------------------------------
test("规则四 · 连续失败到上限自动暂停并记原因", () => {
  let a = makeAutomation({ consecutiveFailures: 4, nextRunAt: THU_0900 });
  const outcome = applyRunOutcome({
    automation: a,
    run: { runAt: THU_0900, sessionId: "s1", status: "error", error: "boom" },
    now: THU_0930,
  });
  assert.equal(outcome.pausedByBackoff, true);
  assert.equal(outcome.automation.active, false);
  assert.equal(outcome.automation.pausedReason, "consecutive-failures");
  assert.equal(outcome.automation.consecutiveFailures, 5);
  a = outcome.automation;
});

test("规则四 · 成功一次就把连续失败清零；未达上限不暂停", () => {
  const a = makeAutomation({ consecutiveFailures: 3 });
  const ok = applyRunOutcome({
    automation: a,
    run: { runAt: THU_0900, sessionId: "s1", status: "success", durationMs: 1200 },
    now: THU_0930,
    contextUsage: 0.42,
  });
  assert.equal(ok.pausedByBackoff, false);
  assert.equal(ok.automation.active, true);
  assert.equal(ok.automation.consecutiveFailures, 0);
  assert.equal(ok.automation.lastContextUsage, 0.42);
  assert.equal(ok.automation.runCount, 1);
  // 下一档按 daily 09:00 推进到明天
  assert.equal(ok.automation.nextRunAt, FRI_0900);
});

test("规则四 · 失败没到上限时照常推进 nextRunAt（不是无限重试同一时刻）", () => {
  const a = makeAutomation({ consecutiveFailures: 0, scheduleType: "interval", intervalMinutes: 30, nextRunAt: THU_0900 });
  const outcome = applyRunOutcome({
    automation: a,
    run: { runAt: THU_0900, sessionId: "s1", status: "error", error: "boom" },
    now: THU_0900,
  });
  assert.equal(outcome.automation.active, true);
  assert.equal(outcome.automation.consecutiveFailures, 1);
  assert.equal(outcome.automation.nextRunAt, THU_0900 + 30 * 60_000);
});

test("skipped 不进失败账也不占配额（否则一次撞车就把任务暂停了）", () => {
  const a = makeAutomation({ consecutiveFailures: 2, runCount: 3, maxRuns: 5 });
  const outcome = applyRunOutcome({
    automation: a,
    run: { runAt: THU_0900, sessionId: "", status: "skipped", skipReason: "previous-run-active" },
    now: THU_0900,
  });
  assert.equal(outcome.automation.consecutiveFailures, 2);
  assert.equal(outcome.automation.runCount, 3);
  assert.equal(outcome.automation.active, true);
  assert.equal(outcome.automation.runHistory.length, 1);
});

test("once / maxRuns 跑满标记为「已完成」而不是「失败暂停」", () => {
  const once = applyRunOutcome({
    automation: makeAutomation({ scheduleType: "once", scheduledAt: THU_0900 }),
    run: { runAt: THU_0900, sessionId: "s1", status: "success" },
    now: THU_0900,
  });
  assert.equal(once.completed, true);
  assert.equal(once.automation.active, false);
  assert.equal(once.automation.pausedReason, "completed");
  assert.ok(once.automation.completedAt > 0);

  const capped = applyRunOutcome({
    automation: makeAutomation({ maxRuns: 2, runCount: 1 }),
    run: { runAt: THU_0900, sessionId: "s1", status: "success" },
    now: THU_0900,
  });
  assert.equal(capped.completed, true);
  assert.equal(capped.automation.pausedReason, "max-runs");
});

test("resumeAutomation 重算 nextRunAt，重开已完成的任务要显式重置配额", () => {
  const a = makeAutomation({ active: false, runCount: 2, completedAt: THU_0900, pausedReason: "max-runs", nextRunAt: OVERNIGHT });
  const resumed = resumeAutomation(a, THU_0900, true);
  assert.equal(resumed.active, true);
  assert.equal(resumed.runCount, 0);
  assert.equal(resumed.completedAt, undefined);
  assert.equal(resumed.pausedReason, undefined);
  assert.ok(resumed.nextRunAt > THU_0900);
});

test("withRunTimeout 超时会 abort 底层信号并抛 AutomationTimeoutError", async () => {
  await assert.rejects(
    withRunTimeout((signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }), 5),
    (error) => error instanceof Error,
  );
  // 直接超时（底层无视 abort）也必须 reject
  await assert.rejects(
    withRunTimeout(() => new Promise(() => {}), 5),
    AutomationTimeoutError,
  );
  // 正常完成不受影响
  assert.equal(await withRunTimeout(async () => "done", 1000), "done");
});

// ---------------------------------------------------------------------------
// 注入给 agent 的两段文本
// ---------------------------------------------------------------------------
test("注入标记 + 「别建议我再建一个」两段都在", () => {
  const a = makeAutomation();
  const prompt = buildRunPrompt(a);
  assert.match(prompt, /^summarise yesterday/);
  assert.ok(prompt.includes(AUTOMATION_RUN_MARKER), "调度标记必须出现在本轮发送的文本里");
  const context = buildAutomationContext(a, translate());
  assert.equal(context, "TXT");
});

// ---------------------------------------------------------------------------
// 规则一 · 30 秒短 tick
// ---------------------------------------------------------------------------
test("规则一 · start() 只起一个 30s 短轮询，不是按任务间隔的长定时器", () => {
  const timer = makeTimer();
  const { store } = makeStore([makeAutomation()]);
  const scheduler = createAutomationScheduler({
    now: () => THU_0900,
    store,
    runner: { run: async () => ({ sessionId: "s1" }) },
    translate,
    timer,
  });
  scheduler.start();
  scheduler.start(); // 幂等
  assert.equal(scheduler.isStarted(), true);
  assert.equal(timer.registered, 1, "只允许一个定时器");
  assert.deepEqual(timer.delays, [30_000], "而且周期必须是 30s 的短轮询");
  scheduler.stop();
  assert.equal(scheduler.isStarted(), false);
  assert.equal(timer.registered, 0);
  assert.equal(AUTOMATION_TICK_INTERVAL_MS, 30_000);
});

test("规则二 · 启动时过期任务被顺延到「现在 + 一个完整间隔」，不立刻触发", async () => {
  const timer = makeTimer();
  const { store, records } = makeStore([
    makeAutomation({ scheduleType: "interval", intervalMinutes: 30, nextRunAt: OVERNIGHT }),
  ]);
  let ran = 0;
  const scheduler = createAutomationScheduler({
    now: () => THU_0900,
    store,
    runner: { run: async () => { ran += 1; return { sessionId: "s1" }; } },
    translate,
    timer,
  });
  scheduler.start();
  const saved = records().get("a1");
  assert.equal(saved.nextRunAt, THU_0900 + 30 * 60_000, "顺延后必须落在未来，否则第一个 tick 就雪崩");
  assert.equal(ran, 0, "start() 本身不执行任何一轮");

  // 第一个 tick 也不该触发（还没到点）
  await scheduler.tick();
  assert.equal(ran, 0);

  // 拨到点之后才跑
  scheduler.stop();
});

// ---------------------------------------------------------------------------
// tick 与忙时跳过
// ---------------------------------------------------------------------------
function makeScheduler(initial, runner, now = () => THU_0900) {
  const timer = makeTimer();
  const harness = makeStore(initial);
  const scheduler = createAutomationScheduler({
    now,
    store: harness.store,
    runner,
    translate,
    timer,
  });
  return { scheduler, timer, ...harness };
}

test("tick 只触发 nextRunAt <= now 的任务", async () => {
  const ran = [];
  let clock = THU_0900 - 60_000;
  const { scheduler, records } = makeScheduler(
    [makeAutomation({ id: "due", nextRunAt: THU_0900 }), makeAutomation({ id: "later", nextRunAt: THU_0900 + 3_600_000 })],
    { run: async (request) => { ran.push(request.automation.id); return { sessionId: "s1" }; } },
    () => clock,
  );
  await scheduler.tick();
  assert.deepEqual(ran, []);
  clock = THU_0900;
  await scheduler.tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(ran, ["due"]);
  assert.equal(records().get("due").lastRunAt, THU_0900);
});

test("忙时跳过：上一轮未结束 → 记 skipped 并推到下一档，不排队", async () => {
  const clock = { now: THU_0900 };
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { scheduler, records } = makeScheduler(
    [makeAutomation({ scheduleType: "interval", intervalMinutes: 30 })],
    { run: async () => { await gate; return { sessionId: "s1" }; } },
    () => clock.now,
  );

  const first = scheduler.tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scheduler.activeRunIds().length, 1);

  // 第二轮又到期：上一轮还没结束
  clock.now = THU_0900 + 30 * 60_000;
  await scheduler.tick();
  const after = records().get("a1");
  const skipped = after.runHistory.filter((r) => r.status === "skipped");
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].skipReason, "previous-run-active");
  // 不排队：nextRunAt 推到再下一档，而不是留在原地反复判定
  assert.equal(after.nextRunAt, THU_0900 + 60 * 60_000);
  assert.equal(after.consecutiveFailures, undefined, "skipped 不进失败账");

  release();
  await first;
});

test("忙时跳过：用户正占着那个子会话 → 记 skipped", async () => {
  const { scheduler, records } = makeScheduler(
    [makeAutomation({ scheduleType: "interval", intervalMinutes: 30, lastSessionId: "s1", lastRunAt: THU_0930 })],
    { run: async () => ({ sessionId: "s1" }), isSessionBusy: () => true },
  );
  await scheduler.tick();
  const history = records().get("a1").runHistory;
  assert.equal(history.length, 1);
  assert.equal(history[0].status, "skipped");
  assert.equal(history[0].skipReason, "source-busy");
});

// ---------------------------------------------------------------------------
// 一轮完整执行
// ---------------------------------------------------------------------------
test("一轮执行：强制 bypass + 携带注入说明，成功后推进 nextRunAt", async () => {
  let seen = null;
  const { scheduler, records } = makeScheduler(
    [makeAutomation()],
    { run: async (request) => { seen = request; return { sessionId: "s-new", contextUsage: 0.31 }; } },
  );
  await scheduler.tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(seen, "运行口必须被调用");
  assert.equal(seen.permissionMode, "bypass", "无人值守必须强制 bypass");
  assert.equal(seen.reuseSessionId, undefined, "第一次运行没有可复用的会话");
  assert.ok(seen.prompt.includes(AUTOMATION_RUN_MARKER));
  assert.ok(seen.signal instanceof AbortSignal);
  const saved = records().get("a1");
  assert.equal(saved.lastSessionId, "s-new");
  assert.equal(saved.lastContextUsage, 0.31);
  assert.equal(saved.nextRunAt, FRI_0900);
});

test("一轮执行失败：记 error 并推进失败计数", async () => {
  const { scheduler, records } = makeScheduler(
    [makeAutomation()],
    { run: async () => { throw new Error("provider exploded"); } },
  );
  await scheduler.tick();
  await new Promise((resolve) => setImmediate(resolve));
  const saved = records().get("a1");
  assert.equal(saved.consecutiveFailures, 1);
  assert.equal(saved.active, true);
  assert.equal(saved.runHistory.at(-1).error, "provider exploded");
});

test("缺 cwd 的任务被静默跳过（而不是每 30s 失败一次直到被暂停）", async () => {
  let ran = 0;
  const { scheduler, records } = makeScheduler(
    [makeAutomation({ cwd: undefined, nextRunAt: THU_0900 - 1 })],
    { run: async () => { ran += 1; return { sessionId: "s1" }; } },
  );
  await scheduler.tick();
  await scheduler.tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ran, 0);
  assert.equal(records().get("a1").runHistory.length, 0);
  assert.equal(records().get("a1").consecutiveFailures, undefined);
});

test("run-now 复用同一天已存在的子会话", async () => {
  const seen = [];
  const { scheduler } = makeScheduler(
    [makeAutomation({ lastSessionId: "s1", lastRunAt: THU_0930, nextRunAt: FRI_0900 })],
    { run: async (request) => { seen.push(request.reuseSessionId); return { sessionId: "s1" }; } },
  );
  await scheduler.runNow("a1");
  assert.deepEqual(seen, ["s1"]);
});

test("运行时探测到用户发过消息 → 本轮另开会话", async () => {
  const seen = [];
  const { scheduler } = makeScheduler(
    [makeAutomation({ lastSessionId: "s1", lastRunAt: THU_0930, nextRunAt: FRI_0900 })],
    {
      run: async (request) => { seen.push(request.reuseSessionId); return { sessionId: "s2" }; },
      hasUserPromptSince: async () => true,
    },
  );
  await scheduler.runNow("a1");
  assert.deepEqual(seen, [undefined], "被接管后必须另开会话");
});

test("连续失败 5 轮后自动停用，且 tick 不再触发它", async () => {
  let clock = THU_0900;
  const { scheduler, records } = makeScheduler(
    [makeAutomation({ scheduleType: "interval", intervalMinutes: 30 })],
    { run: async () => { throw new Error("nope"); } },
    () => clock,
  );
  for (let i = 0; i < 6; i++) {
    await scheduler.tick();
    await new Promise((resolve) => setImmediate(resolve));
    clock += 30 * 60_000;
  }
  const saved = records().get("a1");
  assert.equal(saved.consecutiveFailures, 5);
  assert.equal(saved.active, false);
  assert.equal(saved.pausedReason, "consecutive-failures");
  assert.equal(saved.runCount, 5, "第 6 轮不应该再跑");
});
// 2026-10-03 接线时实测踩到：生产构建里 `instrumentation.ts` 与
// `app/api/automation/route.ts` 是两份独立模块实例。所以单例必须挂在 globalThis 上 ——
// 用**两个 jiti 实例**（各自一份模块注册表）复现这个形状，比在同一个实例里断言
// 有意义得多：模块级 `let singleton` 在这里会立刻露馅。
test("the scheduler singleton is visible from every module instance", async () => {
  const other = createJiti(import.meta.url);
  const a = await jiti.import("./automation-scheduler.ts");
  const b = await other.import("./automation-scheduler.ts");
  assert.notEqual(a, b, "两个 jiti 实例应当是两份模块");

  const fake = { start() {}, stop() {}, isStarted: () => true, tick: async () => {}, runNow: async () => {}, activeRunIds: () => [] };
  a.registerAutomationScheduler(fake);
  assert.equal(b.getAutomationScheduler(), fake, "另一份模块实例必须看到同一个单例");
  b.registerAutomationScheduler(null);
  assert.equal(a.getAutomationScheduler(), null, "置空也要跨实例生效");
});
