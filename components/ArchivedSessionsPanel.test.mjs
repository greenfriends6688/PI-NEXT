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

test("the session group keeps board D-21's labeled form", () => {
  // 画板 D-21 帧 A「无标签眼睛图标 → 带标签形态」：组标题是 `.d-group-toggle`
  // （D-21 todo 类）+ 文字标签 + 计数徽章，「显示文件已消失」开关挂在组标题行。
  assert.match(sessionsPanel, /className="d-group-toggle d-group-title"/);
  assert.match(sessionsPanel, /settings\.archivedSessionsLabel/);
  assert.match(sessionsPanel, /settings\.archivedShowMissing/);
  assert.match(sessionsPanel, /className="d-badge count"/);
  // 文件已消失的行：triangle-alert + 0.6 透明度（画板 46 原样），默认隐藏。
  assert.match(sessionsPanel, /triangle-alert/);
  assert.match(sessionsPanel, /opacity: 0\.6/);
});

test("the group's empty states each have a landing, and neither says 'nothing archived' for hidden rows", () => {
  // 画板 62 帧 D「空态必须有落点」。两个「列不出来」要分开：
  //   一条都没归档过 → archive 图标 + 「还没有归档任何会话」+ 本机存储说明
  //   归档过但文件都没了 → triangle-alert + 「文件已不存在」（组标题的开关就是出口）
  const group = sessionsPanel.slice(
    sessionsPanel.indexOf("export function ArchivedSessionsGroup"),
    sessionsPanel.indexOf("export function ArchivedSessionDetail"),
  );
  assert.match(group, /className="d-empty/);
  assert.match(group, /rows\.length > 0 \? t\("settings\.archivedMissingProject"\) : t\("settings\.archivedEmpty"\)/);
  // fix:archive-local-only —— 归档只在本机 localStorage，代价写在空态里（不是飘到别处）。
  assert.match(group, /settings\.archiveStoredLocally/);
  // 加载态归宿主（列表列一行 loading），这里不再需要「sessions 为 null」的空分支。
  assert.doesNotMatch(group, /sessions === null/);
});

test("the session detail keeps restore and delete at the detail header", () => {
  // 画板 D-21 动作层级 ③ 条目级 · 详情头右端；名字用画板的 h3（本地 `Title`，`h3.d-t-title`）。
  const detail = sessionsPanel.slice(sessionsPanel.indexOf("export function ArchivedSessionDetail"));
  assert.match(detail, /className="d-row"/);
  assert.match(detail, /<Title>/);
  assert.match(detail, /settings\.archivedRestore/);
  assert.match(detail, /data-ico="trash-2"/);
  assert.match(detail, /className="d-set-row"/);
});

test("the legacy two-section entry point is gone", () => {
  // fix:archive-legacy-shell —— 那个叫 `ArchivedSessionsPanel` 的**入口组件**恒渲染 null、
  // SettingsPanel 里的调用方早已摘除；留着它等于留一套没人渲染的骨架。这是门禁，不许长回来。
  //
  // fork:archive-layout（2026-10-01）：组件本体保留 —— 它导出的是两个**真组件**
  // （`ArchivedSessionsGroup` 组标题 / `ArchivedSessionDetail` 详情），现在由
  // `ProjectArchivePanel`（骨架 B 宿主）直接消费。所以门禁从「文件里不能出现
  // ArchivedSessionsPanel」改成「**不能有同名入口组件**」，否则把这两个真组件一起禁掉了。
  assert.doesNotMatch(sessionsPanel, /export (?:default )?function ArchivedSessionsPanel\b/);
  assert.doesNotMatch(sessionsPanel, /export \{[^}]*\bArchivedSessionsPanel\b/);
  // 这两个真组件必须在（它们是归档会话的渲染入口）。
  assert.match(sessionsPanel, /export function ArchivedSessionsGroup\b/);
  assert.match(sessionsPanel, /export function ArchivedSessionDetail\b/);
});

test("deriveArchivedRows is a pure helper shared by group and detail", () => {
  assert.match(sessionsPanel, /export function deriveArchivedRows/);
  // 新的在前：无时间戳的老条目保持在尾部。
  assert.match(sessionsPanel, /localeCompare\(a\.archivedAt \?\? ""\)/);
  // 会话索引由宿主喂进来（宿主已经加载完 /api/sessions），所以这里只收数组。
  assert.match(sessionsPanel, /sessions: readonly SessionInfo\[\],/);
  // 项目索引页不重新实现行推导——它消费会话分组组件。
  assert.doesNotMatch(projectPanel, /deriveArchivedRows/);
});
