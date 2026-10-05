import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sessionsPanel = await readFile(new URL("./ArchivedSessionsPanel.tsx", import.meta.url), "utf8");
const projectPanel = await readFile(new URL("./ProjectArchivePanel.tsx", import.meta.url), "utf8");

/* fork:v5-landing-frame · D-21（2026-10-06）—— 桌面归档页整页换成画板 D-21 帧 A，
   详情列随之退场，所以这个文件现在只服务**窄屏** + 一份纯函数行推导。
   会话删除在两端各有一处形状：桌面是 D-21 的批量条 + 二次确认浮层（宿主文件），
   窄屏是详情面板里的确认态（下面这个组件）。 */

test("session destruction stays confirmed on both shapes", () => {
  // fork:ui-archive-history —「彻底删除」动的是会话文件，风险动作必须与它的行住在
  // 一起：窄屏在详情面板里（这个文件），桌面在画板 D-21 的批量条 + 浮层（宿主文件）。
  assert.match(sessionsPanel, /method:\s*"DELETE"/);
  assert.match(sessionsPanel, /settings\.archivedDeleteConfirm/);
  // 二次确认：垃圾桶先进入 pending 态，真正的 DELETE 只在确认之后。
  assert.match(sessionsPanel, /pendingDelete/);
  const desktop = projectPanel.slice(projectPanel.indexOf("<PortalDropdown"));
  assert.match(desktop, /settings\.archiveDeleteConfirm/);
});

test("what stays here is the phone shape plus the shared row helper", () => {
  // 两个组件都只发 m-* 类：桌面那一支在 D-21 之后没有调用方，留着就是第二套骨架。
  assert.doesNotMatch(sessionsPanel, /className="d-set-inner"/);
  assert.doesNotMatch(sessionsPanel, /ConfigSplitView|ConfigSidebar\b/);
  // 窄屏的组标题带「显示文件已消失」开关 + 计数徽章，缺文件的行用 triangle-alert。
  assert.match(sessionsPanel, /className="m-cardgroup"/);
  assert.match(sessionsPanel, /settings\.archivedShowMissing/);
  assert.match(sessionsPanel, /triangle-alert/);
});

test("the group's empty states each have a landing, and neither says 'nothing archived' for hidden rows", () => {
  // 两种「列不出来」要分开：
  //   一条都没归档过 → 「还没有归档任何会话」+ 本机存储说明
  //   归档过但文件都没了 → 「文件已不存在」（组标题的开关就是出口）
  const group = sessionsPanel.slice(
    sessionsPanel.indexOf("export function ArchivedSessionsGroup"),
    sessionsPanel.indexOf("export function ArchivedSessionDetail"),
  );
  assert.match(group, /rows\.length > 0 \? t\("settings\.archivedMissingProject"\) : t\("settings\.archivedEmpty"\)/);
  // fix:archive-local-only —— 归档只在本机 localStorage，代价写在空态里（不是飘到别处）。
  assert.match(group, /settings\.archiveStoredLocally/);
  // 加载态归宿主（列表列一行 loading），这里不再需要「sessions 为 null」的空分支。
  assert.doesNotMatch(group, /sessions === null/);
});

test("the legacy two-section entry point is gone", () => {
  // fix:archive-legacy-shell —— 那个叫 `ArchivedSessionsPanel` 的**入口组件**恒渲染 null、
  // SettingsPanel 里的调用方早已摘除；留着它等于留一套没人渲染的骨架。这是门禁，不许长回来。
  //
  // fork:archive-layout（2026-10-01）：组件本体保留 —— 它导出的是两个**真组件**
  // （`ArchivedSessionsGroup` / `ArchivedSessionDetail`），现在只服务窄屏。
  assert.doesNotMatch(sessionsPanel, /export (?:default )?function ArchivedSessionsPanel\b/);
  assert.doesNotMatch(sessionsPanel, /export \{[^}]*\bArchivedSessionsPanel\b/);
  assert.match(sessionsPanel, /export function ArchivedSessionsGroup\b/);
  assert.match(sessionsPanel, /export function ArchivedSessionDetail\b/);
});

test("deriveArchivedRows is a pure helper shared by the host and the phone card", () => {
  assert.match(sessionsPanel, /export function deriveArchivedRows/);
  // 新的在前：无时间戳的老条目保持在尾部。
  assert.match(sessionsPanel, /localeCompare\(a\.archivedAt \?\? ""\)/);
  // 会话索引由宿主喂进来（宿主已经加载完 /api/sessions），所以这里只收数组。
  assert.match(sessionsPanel, /sessions: readonly SessionInfo\[\],/);
  // 宿主消费这个纯函数，不重新实现行推导。
  assert.match(projectPanel, /deriveArchivedRows\(/);
});