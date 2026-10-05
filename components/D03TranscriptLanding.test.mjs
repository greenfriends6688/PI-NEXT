// 画板 D-03（转录）三帧的落地守卫 —— fork:d03-frame-b / fork:d03-frame-c
//
// 背景：`design/v5/scripts/land-status.mjs` 只查「这个类名在产品里出现过没有」，
// D-03 早就 96/98（缺的兩個是已登记分叉）。类名齐全**不等于**这一帧落地了 ——
// 帧 B 的失败卡诊断行、帧 C 的未读分割线，都是「类都在、内容没有」。所以这张
// 单测钉的是**内容**：每条断言后面都写着它对应画板的哪一行。
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const board = await readFile(new URL("../design/v5/web/boards/D-03-transcript.html", import.meta.url), "utf8");
const processBoard = await readFile(new URL("../design/v5/web/boards/D-03d-transcript-process.html", import.meta.url), "utf8");
const messageView = await readFile(new URL("./MessageView.tsx", import.meta.url), "utf8");
const chatWindow = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const appShell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const processGroup = await readFile(new URL("./ProcessGroup.tsx", import.meta.url), "utf8");
const unreadStore = await readFile(new URL("../lib/session-unread.ts", import.meta.url), "utf8");

test("帧 B · diff 卡的统计徽章（板面 `d-badge info`「+7 −7」）", () => {
  assert.match(board, /<span class="d-badge info">\+7 −7<\/span>/);
  assert.match(messageView, /resultDiff && !isError/);
  assert.match(messageView, /\+{stat\.added} −\{stat\.removed\}/);
});

test("帧 B · 失败卡把 .d-err 提到 d-tool-body 的直接子位，并给一行诊断", () => {
  // 板面：`.d-tool-body.d-col` › `.d-err` › 诊断行（exit 1 · 1.9s · 第 31 行）
  assert.match(board, /<div class="d-tool-body d-col" style="gap:var\(--nx-sp-2\)">\s*<div class="d-err">/);
  assert.match(board, /第 31 行/);
  assert.match(messageView, /<div className="d-tool-body d-col"[^>]*>\s*<div className="d-err"/);
  // 诊断行：耗时 + 「第 N 行」定位（定位找得到才画，找不到不编）
  assert.match(messageView, /findErrorLine\(text\)/);
  assert.match(messageView, /process\.errorLine/);
});

test("帧 C · 计划卡的进度徽章与 d-plan-foot（第 N 步进行中）", () => {
  assert.match(board, /<span class="d-badge ok">3 \/ 6<\/span>/);
  assert.match(board, /<div class="d-plan-foot">\s*<span>第 4 步进行中<\/span>/);
  assert.match(messageView, /<span className="d-badge ok">\s*\{todoSteps\.filter/);
  assert.match(messageView, /<div className="d-plan-foot">/);
  assert.match(messageView, /chat\.todoStepRunning/);
});

test("帧 A · 收起的思考行带可见的「思考」标签（D-03d 帧 A 的 summary）", () => {
  assert.match(processBoard, /<summary><i data-ico="brain" data-size="12"><\/i>思考 · 结束折叠/);
  assert.match(messageView, /\{t\("i18n\.thinking"\)\}\{preview \? " · " : ""\}/);
});

test("帧 A · 正在跑的那一行有 .d-run 转圈（D-03d 帧 A 的进行中行）", () => {
  assert.match(processBoard, /<span class="d-run"><i data-ico="loader-circle" data-size="11"><\/i><\/span>/);
  // 已由 fork:v5-landing 落地（桌面一支；窄屏走 `.m-step-dot`）。只许一枚。
  assert.match(processGroup, /<span className="d-run"><i data-ico="loader-circle" data-size="11"/);
  assert.equal((processGroup.match(/className="d-run"/g) ?? []).length, 1);
});

test("帧 C · 转录里的未读分割：两条 d-sep + 一行说明", () => {
  // 板面：`d-sep` / 居中一行「↓ 以下是你离开后发生的」/ `d-sep`
  assert.match(board, /<div class="d-sep"><\/div>\s*<div class="d-t-xs d-t-faint" style="align-self:center">↓ 以下是你离开后发生的<\/div>\s*<div class="d-sep"><\/div>/);
  assert.match(chatWindow, /unreadDividerIdx === idx/);
  assert.match(chatWindow, /className="d-sep"/);
  assert.match(chatWindow, /chat\.unreadDivider/);
  // 读数的写入口在 ChatWindow（离开时写窗口末尾），prune 挂在侧栏刷新上。
  assert.match(chatWindow, /setReadCursor\(sid, count\)/);
  assert.match(unreadStore, /export function setReadCursor/);
  assert.match(unreadStore, /export function pruneReadCursors/);
});

test("帧 C · 顶栏那枚「N 条新消息」徽标挂在 d-tb-spacer 之后", () => {
  assert.match(board, /<div class="d-tb-spacer"><\/div>\s*<span class="d-badge info">3 条新消息<\/span>/);
  assert.match(appShell, /<div className="d-tb-spacer" \/>\}\s*\{[\s\S]{0,400}?d-badge info/);
  assert.match(appShell, /chat\.newMessages/);
});

test("未登记的帧 B 缺口：失败卡的三个动作还没有真命令可接", () => {
  // 板面给了「重试这一步 / 改参数再试 / 跳过」。SDK 没有重跑单个工具调用的命令，
  // 在拿到真命令前画三枚点不动的钮就是画死控件 —— 这条断言守着「别偷偷画上去」。
  // 注释里提到这三个词不算（那是登记本身），所以先剥掉块注释。
  assert.match(board, /重试这一步/);
  const code = messageView.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /rotate-cw/);
  assert.doesNotMatch(code, /改参数再试/);
});
