import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sessionsPanel = await readFile(new URL("./ArchivedSessionsPanel.tsx", import.meta.url), "utf8");
const projectPanel = await readFile(new URL("./ProjectArchivePanel.tsx", import.meta.url), "utf8");

test("session destruction lives with the session rows, not in the project index", () => {
  // fork:ui-archive-history — 「彻底删除」动的是会话文件，风险动作必须和它的行住在
  // 一起；项目索引页（ProjectArchivePanel）对用户数据只读，由那边的测试焊死。
  assert.match(sessionsPanel, /method:\s*"DELETE"/);
  assert.match(sessionsPanel, /settings\.archivedDeleteConfirm/);
  // 二次确认：垃圾桶先进入 pending 态，真正的 DELETE 只在确认之后。
  assert.match(sessionsPanel, /pendingDelete/);
});

test("the session group keeps board 46's labeled form", () => {
  // 画板 62 落位表「无标签眼睛图标 → 带标签形态」：组标题是文字标签 + 计数徽章，
  // 「显示文件已消失」开关挂在组标题行（画板 46 的 sec-title 位置）。
  assert.match(sessionsPanel, /<ConfigSidebarGroupLabel>/);
  assert.match(sessionsPanel, /settings\.archivedSessionsLabel/);
  assert.match(sessionsPanel, /settings\.archivedShowMissing/);
  assert.match(sessionsPanel, /<ConfigBadge tone="count">/);
  // 文件已消失的行：triangle-alert + 0.6 透明度（画板 46 原样），默认隐藏。
  assert.match(sessionsPanel, /triangle-alert/);
  assert.match(sessionsPanel, /opacity: 0\.6/);
});

test("the session detail keeps restore and delete at the detail header", () => {
  // 画板 62 动作层级 ③ 条目级 · 详情头右端。
  const detail = sessionsPanel.slice(sessionsPanel.indexOf("export function ArchivedSessionDetail"));
  assert.match(detail, /settings\.archivedRestore/);
  assert.match(detail, /data-ico="trash-2"/);
  assert.match(detail, /className="pw-kv"/);
});

test("deriveArchivedRows is a pure helper shared by group and detail", () => {
  assert.match(sessionsPanel, /export function deriveArchivedRows/);
  // 新的在前：无时间戳的老条目保持在尾部。
  assert.match(sessionsPanel, /localeCompare\(a\.archivedAt \?\? ""\)/);
  // 项目索引页不重新实现行推导——它消费会话分组组件。
  assert.doesNotMatch(projectPanel, /deriveArchivedRows/);
});
