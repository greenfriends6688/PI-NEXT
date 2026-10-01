import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

// fork:group-switch（G4 · 上游 `eceac13` #1020 + `b9622a1` #1021 + `4de9f77`）
// —— 分组标题升级成整组开关的**纯函数**与**基件**断言。
// 结构断言只锁「共用画板已有的类」（判据⑦：不新造 pw-*），文案在三语包里。

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { itemsToSwitch } = await jiti.import("./SettingsUi.tsx");

const templateSource = await readFile(new URL("./SettingsUi.tsx", import.meta.url), "utf8");

test("itemsToSwitch only touches rows that are not already in the target state", () => {
  const rows = [
    { id: "a", on: true },
    { id: "b", on: false },
    { id: "c", on: false },
  ];
  assert.deepEqual(itemsToSwitch(rows, false, (row) => row.on).map((row) => row.id), ["a"]);
  assert.deepEqual(itemsToSwitch(rows, true, (row) => row.on).map((row) => row.id), ["b", "c"]);
  // 全处在目标状态时不发任何请求（按钮无行可改）。
  const allOn = [{ id: "a", on: true }];
  assert.deepEqual(itemsToSwitch(allOn, true, (row) => row.on), []);
  assert.deepEqual(itemsToSwitch(allOn, false, (row) => row.on), allOn);
});

test("switching a group off leaves keepOn rows alone (a filtered package would lose its filters)", () => {
  const rows = [
    { id: "plain", on: true, filtered: false },
    { id: "filtered", on: true, filtered: true },
    { id: "off", on: false, filtered: true },
  ];
  const keepOn = (row) => row.filtered;
  // 关：不碰 filtered；开：keepOn 不适用（重新启用没有任何损失）。
  assert.deepEqual(itemsToSwitch(rows, false, (row) => row.on, keepOn).map((row) => row.id), ["plain"]);
  assert.deepEqual(itemsToSwitch(rows, true, (row) => row.on, keepOn).map((row) => row.id), ["off"]);
});

test("a group switch renders the board's own classes and reads as off unless every row is on", () => {
  assert.match(templateSource, /export function ConfigSidebarGroupSwitch/);
  // `n/m` 计数 + 画板开关，没有新类。
  assert.match(templateSource, /export function ConfigSidebarGroupSwitch[\s\S]*?"pw-mono pw-dim"/);
  assert.match(templateSource, /export function ConfigSidebarGroupSwitch[\s\S]*?checked=\{total > 0 && enabled === total\}/);
  // 4de9f77：分组标题里的开关用画板原尺寸，不缩到 .pw-litem 行尾那种 0.8 倍。
  assert.doesNotMatch(templateSource, /ConfigSidebarGroupSwitch[\s\S]{0,600}is-small/);
  // 右对齐的空档由开关自带（pw-grow），标签本体的子节点一个字不动：
  // 归档面板 / 项目归档两处已经在标题里自带给空格，不能被再包一层。
  assert.match(templateSource, /export function ConfigSidebarGroupSwitch[\s\S]*?className="pw-grow"/);
  assert.match(templateSource, /export function ConfigSidebarGroupLabel[\s\S]*?className="pw-group-title"\s*>\s*\{children\}\s*\{aside\}/);
  assert.doesNotMatch(templateSource, /export function ConfigSidebarGroupLabel[\s\S]*?className="pw-group-title"\s*>\s*<span/);
});

test("group status renders the board alert pair and keeps refused rows on separate lines", () => {
  assert.match(templateSource, /export function ConfigSidebarGroupStatus/);
  assert.match(templateSource, /role="status" className="pw-alert info"/);
  assert.match(templateSource, /role="alert" className="pw-alert"/);
  // `.pw-alert` 没有 white-space 规则，多行必须逐行渲染。
  assert.match(templateSource, /errorLines\.map\(/);
  assert.match(templateSource, /index > 0 \? <br \/> : null/);
});