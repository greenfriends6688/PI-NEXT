import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  BROWSER_RISK_NOTICE_VERSION,
  BrowserRiskGate,
  createBrowserRiskRecord,
  readBrowserRiskRecord,
  serializeBrowserRiskRecord,
} = await jiti.import("./browser-risk-gate.ts");

test("新门是「没确认过」，evaluate 要求先弹确认", () => {
  const gate = new BrowserRiskGate();
  assert.equal(gate.state(), "unacknowledged");
  assert.equal(gate.evaluate(), "prompt");
});

test("确认一次之后放行", () => {
  const gate = new BrowserRiskGate();
  gate.acknowledge();
  assert.equal(gate.isAcknowledged(), true);
  assert.equal(gate.evaluate(), "allow");
  assert.equal(gate.snapshot().acknowledgedVersion, BROWSER_RISK_NOTICE_VERSION);
});

test("拒绝之后直接拒绝，不再反复弹窗打扰用户", () => {
  const gate = new BrowserRiskGate();
  gate.deny();
  assert.equal(gate.isDenied(), true);
  assert.equal(gate.evaluate(), "denied");
  // 用户明确拒绝之后，一次旧的确认记录不能把它翻回「允许」。
  gate.acknowledge();
  assert.equal(gate.isDenied(), true);
  assert.equal(gate.evaluate(), "denied");
});

test("文案版本升级后重新降回未确认", () => {
  const old = serializeBrowserRiskRecord({ state: "acknowledged", acknowledgedVersion: 1 });
  const gate = new BrowserRiskGate(readBrowserRiskRecord(old), 2);
  assert.equal(gate.evaluate(), "prompt");
  const same = new BrowserRiskGate(readBrowserRiskRecord(old), 1);
  assert.equal(same.evaluate(), "allow");
});

test("读不出记录 = 没确认过（绝不因为「没找到」就放行）", () => {
  for (const value of [undefined, null, 42, "ack", [], { state: "acknowledged" }, { state: "acknowledged", acknowledgedVersion: "1" }]) {
    assert.deepEqual(readBrowserRiskRecord(value), createBrowserRiskRecord());
  }
});

test("restore 不会用一条旧确认覆盖拒绝", () => {
  const gate = new BrowserRiskGate();
  gate.deny();
  gate.restore(serializeBrowserRiskRecord({ state: "acknowledged", acknowledgedVersion: BROWSER_RISK_NOTICE_VERSION }));
  assert.equal(gate.evaluate(), "denied");
});

test("restore 能把确认带回来（会话重建 / 刷新之后不必再问）", () => {
  const gate = new BrowserRiskGate();
  gate.restore(serializeBrowserRiskRecord({ state: "acknowledged", acknowledgedVersion: BROWSER_RISK_NOTICE_VERSION }));
  assert.equal(gate.evaluate(), "allow");
});

test("序列化一定带版本号，方便将来升版", () => {
  const serialized = serializeBrowserRiskRecord(createBrowserRiskRecord());
  assert.deepEqual(serialized, { version: 1, state: "unacknowledged", acknowledgedVersion: 0 });
});