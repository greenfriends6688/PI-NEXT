import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  DRAFT_SAVE_DEBOUNCE_MS,
  DRAFT_SAVE_STATUS_MS,
  draftEdited,
  draftFlush,
  draftOpened,
  draftSaveSettled,
  draftSaveStarted,
  draftStatusExpired,
  draftStatusMessageKey,
  initialDraftSaveState,
  isDraftDirty,
  isDraftSaveDue,
  visibleDraftStatus,
} = await jiti.import("./planning-draft-save.ts");

/*
 * fork:proma-44-planning —— Proma v0.16.8「描述草稿式自动保存」的状态机。
 *
 * 时间全部注入：改 `now` 就是「等一会儿」，所以这些用例跑完是 0 毫秒，
 * 而覆盖的是 800ms 去抖 / 2s 状态消失 / 关面板 flush 三条真实路径。
 */

const T0 = 1_760_000_000_000;
const tick = (ms) => T0 + ms;

function open(persisted = "") {
  return draftOpened(initialDraftSaveState(), "todo-1", persisted);
}

test("opening a todo seeds the draft from the stored value and shows no status", () => {
  const state = open("hello");
  assert.equal(state.draft, "hello");
  assert.equal(state.persisted, "hello");
  assert.equal(state.status, "idle");
  assert.equal(visibleDraftStatus(state, "todo-1"), "idle");
  assert.equal(isDraftDirty(state), false);
});

test("editing arms an 800ms debounce, and re-editing pushes it out", () => {
  let state = draftEdited(open(), "h", tick(0));
  assert.equal(state.dueAt, tick(DRAFT_SAVE_DEBOUNCE_MS));
  state = draftEdited(state, "he", tick(200));
  assert.equal(state.dueAt, tick(200 + DRAFT_SAVE_DEBOUNCE_MS), "去抖是滑动的，不是固定 800ms 后必发");
  assert.equal(isDraftSaveDue(state, tick(999)), false);
  assert.equal(isDraftSaveDue(state, tick(1000)), true);
});

test("editing back to the stored value cancels the pending save", () => {
  let state = draftEdited(open("x"), "xy", tick(0));
  state = draftEdited(state, "x", tick(10));
  assert.equal(state.dueAt, null);
  assert.equal(isDraftDirty(state), false);
  assert.equal(draftSaveStarted(state, tick(20)), null, "没有非空改动就不该发请求");
});

test("a due save goes saving → saved, and the badge expires after 2s", () => {
  let state = draftEdited(open(), "note", tick(0));
  state = draftSaveStarted(state, tick(800));
  assert.equal(state.status, "saving");
  assert.equal(state.inFlight, true);
  assert.equal(state.sent, "note");
  assert.equal(visibleDraftStatus(state, "todo-1"), "saving");

  state = draftSaveSettled(state, { ok: true, persisted: "note", now: tick(900) });
  assert.equal(state.status, "saved");
  assert.equal(state.inFlight, false);
  assert.equal(state.dueAt, null);
  assert.equal(draftStatusMessageKey(state.status), "saved");

  assert.equal(draftStatusExpired(state, tick(900 + DRAFT_SAVE_STATUS_MS - 1)).status, "saved");
  assert.equal(draftStatusExpired(state, tick(900 + DRAFT_SAVE_STATUS_MS)).status, "idle");
  assert.equal(draftStatusMessageKey(draftStatusExpired(state, tick(5000)).status), null);
});

test("INVARIANT: an autosave never writes the draft back into the input", () => {
  // 用户在请求在途时又打了字。服务端回包（这里刻意返回一个不同的值，模拟
  // Proma 那边 trim / 归一化过的 notes）绝不能被回填进输入框。
  let state = draftEdited(open("a"), "a b", tick(0));
  state = draftSaveStarted(state, tick(800));
  state = draftEdited(state, "a bc", tick(820));      // 请求期间继续输入
  const draftBefore = state.draft;

  state = draftSaveSettled(state, { ok: true, persisted: "a b", now: tick(900) });
  assert.equal(state.draft, draftBefore, "保存结果不得回写输入框");
  assert.equal(state.draft, "a bc");
  assert.equal(state.persisted, "a b");
  // 而且要把新草稿续上，否则这一段就丢了。
  assert.equal(isDraftSaveDue(state, tick(900)), true, "请求期间的新输入立刻续存");

  // 干净路径同样不回写。
  let clean = draftEdited(open(""), "final", tick(0));
  clean = draftSaveStarted(clean, tick(800));
  clean = draftSaveSettled(clean, { ok: true, persisted: "final", now: tick(900) });
  assert.equal(clean.draft, "final");
  assert.equal(isDraftSaveDue(clean, tick(5000)), false);
});

test("the continuation cannot spin even when the server normalizes the value", () => {
  // 服务端把 "  x  " 存成 "x"。如果续存条件写成 `draft !== persisted`，
  // 这里会每 0ms 重发一次，永远停不下来。续存只看「请求期间用户又打了字」。
  let state = draftEdited(open(""), "  x  ", tick(0));
  state = draftSaveStarted(state, tick(800));
  state = draftSaveSettled(state, { ok: true, persisted: "x", now: tick(900) });
  assert.equal(state.dueAt, null, "没有新输入 → 不续存");
  assert.equal(state.status, "saved");
  assert.equal(isDraftDirty(state), true, "仍然算脏（用户看到的和服务端存的不一样），但不会自旋");
});

test("a failed save stops and waits for the next edit or the close flush", () => {
  let state = draftEdited(open(), "note", tick(0));
  state = draftSaveStarted(state, tick(800));
  state = draftSaveSettled(state, { ok: false, persisted: "", now: tick(900) });
  assert.equal(state.status, "idle", "失败不假装已保存");
  assert.equal(state.dueAt, null, "失败不自动重试");
  assert.equal(state.draft, "note", "失败的草稿留在输入框里，一个字都不丢");
  assert.equal(isDraftDirty(state), true);

  // 下一次输入重新武装。
  state = draftEdited(state, "note!", tick(1000));
  assert.equal(isDraftSaveDue(state, tick(1000 + DRAFT_SAVE_DEBOUNCE_MS)), true);
});

test("a version conflict blocks autosave until the view reloads", () => {
  let state = draftEdited(open(), "note", tick(0));
  state = draftSaveStarted(state, tick(800));
  state = draftSaveSettled(state, { ok: false, persisted: "", now: tick(900), blocked: true });
  assert.equal(state.blocked, true);

  // 冲突之后继续打字不再排自动保存 —— 否则会对着一个旧版本不停重发。
  state = draftEdited(state, "note more", tick(1000));
  assert.equal(state.dueAt, null);
  assert.equal(isDraftSaveDue(state, tick(99_000)), false);
  assert.equal(draftSaveStarted(state, tick(99_000)), null);
  assert.equal(state.draft, "note more", "冲突也不丢草稿");
});

test("typing during an in-flight save does not queue a timer that cannot fire", () => {
  let state = draftEdited(open(), "one", tick(0));
  state = draftSaveStarted(state, tick(800));
  state = draftEdited(state, "one two", tick(810));
  assert.equal(state.dueAt, null, "在途期间排的定时器只会空转到被 draftSaveStarted 拒掉");
  state = draftSaveSettled(state, { ok: true, persisted: "one", now: tick(900) });
  assert.equal(state.dueAt, tick(900), "请求一回来就续上");
});

test("only one request is in flight at a time", () => {
  let state = draftEdited(open(), "note", tick(0));
  state = draftSaveStarted(state, tick(800));
  assert.equal(draftSaveStarted(state, tick(810)), null, "第二次 flush 不能并发发出去");
});

test("blur flushes immediately without waiting out the debounce", () => {
  let state = draftEdited(open(), "note", tick(0));
  const { state: flushed, dirty } = draftFlush(state);
  assert.equal(dirty, true);
  assert.equal(flushed.dueAt, null, "flush 要把去抖定时器撤掉");
  assert.equal(isDraftSaveDue(flushed, tick(1)), false, "flush 之后不能再靠定时器发一次");
  const started = draftSaveStarted(flushed, tick(1));
  assert.equal(started.status, "saving");
  assert.equal(started.sent, "note");

  // 已经干净的字段：flush 是 no-op，不发请求。
  const clean = draftSaveSettled(started, { ok: true, persisted: "note", now: tick(2) });
  assert.equal(draftFlush(clean).dirty, false);
  assert.equal(draftSaveStarted(clean, tick(3)), null);
});

test("switching todos drops the previous one's timer and badge", () => {
  let state = draftEdited(open(""), "first", tick(0));
  state = draftSaveStarted(state, tick(800));
  // 「又点开同一条」且正在途：保留现场，不要被回包盖掉。
  assert.equal(draftOpened(state, "todo-1", "first"), state);

  state = draftSaveSettled(state, { ok: true, persisted: "first", now: tick(900) });
  assert.equal(visibleDraftStatus(state, "todo-1"), "saved");

  const other = draftOpened(state, "todo-2", "second");
  assert.equal(other.draft, "second");
  assert.equal(other.status, "idle");
  assert.equal(other.dueAt, null);
  // 上一条的「已保存」不许挂在另一条 Todo 的描述旁边。
  assert.equal(visibleDraftStatus(state, "todo-2"), "idle");
  assert.equal(visibleDraftStatus(other, "todo-2"), "idle");
  // 关面板（entityId 变 null）同样清干净。
  const closed = draftOpened(other, null, "");
  assert.equal(closed.entityId, null);
  assert.equal(visibleDraftStatus(closed, null), "idle");
});

test("closing the panel keeps the draft until it is flushed", () => {
  let state = draftEdited(open(), "unsaved", tick(0));
  assert.equal(draftFlush(state).dirty, true, "×/Esc/点空白共用的这条路径必须能冲出去");
  const started = draftSaveStarted(draftFlush(state).state, tick(10));
  assert.equal(started.sent, "unsaved");
  state = draftSaveSettled(started, { ok: true, persisted: "unsaved", now: tick(20) });
  assert.equal(state.status, "saved");
  assert.equal(draftFlush(state).dirty, false, "存完了再关就没什么可冲的");
});
