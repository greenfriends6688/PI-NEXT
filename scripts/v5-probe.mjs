#!/usr/bin/env node
/* fork:v5-landing —— 换皮集成的定点体检（临时诊断脚本，收尾后可删）。
 *
 * 为什么需要它：MCP 截图在本页会超时（持续动画 + 壁纸层让 CDP captureScreenshot 挂住），
 * 而「看起来不对」的问题（todo 芯片跑出输入卡左缘、上下文环点不出浮窗、步骤行居中）
 * 都是**几何/接线**问题，用 getBoundingClientRect 与 DOM 事实就能判，不必靠眼。
 *
 * 跑法：node scripts/v5-probe.mjs [url]
 */
import { launchChrome } from "./launch-chrome.mjs";

const APP = process.argv[2] ?? "http://127.0.0.1:30141/";

const browser = await launchChrome();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`[console] ${m.text().slice(0, 160)}`);
});

await page.goto(APP, { waitUntil: "load" });
await page.waitForTimeout(2500); // 等图标 hydrate + 首帧动效落位

/* 打开一条会话：先展开项目分组，再点第一行会话（与用户看到的真实状态一致） */
await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const groups = [...document.querySelectorAll(".d-group-title")];
  for (const g of groups) {
    const hasRow = g.parentElement?.querySelector(".d-sess");
    if (!hasRow) g.click();
  }
  await wait(900);
  const row = document.querySelector(".d-sess");
  if (row) row.click();
  await wait(3000);
});

const report = await page.evaluate(() => {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: +r.x.toFixed(1), y: +r.y.toFixed(1),
      w: +r.width.toFixed(1), h: +r.height.toFixed(1),
    };
  };
  const q = (sel) => document.querySelector(sel);
  const out = {};

  /* 1 · 步骤行：是否左对齐 + 图标有没有圆环 */
  const step = q(".d-step");
  if (step) {
    const body = step.querySelector(".d-step-body");
    const ico = step.querySelector(".d-step-ico");
    const cs = getComputedStyle(ico);
    out.step = {
      box: box(step),
      textAlign: getComputedStyle(step).textAlign,
      bodyLeft: body ? +body.getBoundingClientRect().x.toFixed(1) : null,
      icoLeft: ico ? +ico.getBoundingClientRect().x.toFixed(1) : null,
      icoBorder: cs.borderTopWidth,
      icoColor: cs.color,
    };
  }

  /* 2 · todo 芯片 vs 输入卡左缘 */
  const shell = q(".chat-input-shell");
  const todo = q(".chat-input-shell .d-card");
  if (shell && todo) {
    out.todo = { shell: box(shell), chip: box(todo), overflowsLeft: +(todo.getBoundingClientRect().x - shell.getBoundingClientRect().x).toFixed(1) };
  }

  /* 3 · 上下文环：点在不在、浮窗出不出来 */
  const ringBtn = q(".composer-ring .d-ring");
  const pop = q(".composer-ring-pop");
  out.ring = {
    exists: !!ringBtn,
    box: box(q(".composer-ring")),
    popBeforeClick: !!pop,
    popVisibleBefore: pop ? getComputedStyle(pop).display !== "none" && pop.getBoundingClientRect().height > 0 : false,
  };
  return out;
});

/* 点环，再量一次 */
const afterClick = await page.evaluate(async () => {
  const btn = document.querySelector(".composer-ring .d-ring");
  if (!btn) return { clicked: false };
  btn.click();
  await new Promise((r) => setTimeout(r, 600));
  const pop = document.querySelector(".composer-ring-pop");
  const host = document.querySelector(".composer-ring-pop")?.parentElement;
  return {
    clicked: true,
    popExists: !!pop,
    popBox: pop ? (() => { const r = pop.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; })() : null,
    hostTag: host ? host.tagName + "." + host.className : null,
    visible: pop ? pop.getBoundingClientRect().height > 0 : false,
  };
});

console.log(JSON.stringify({ report, afterClick, errors: errors.slice(0, 6) }, null, 2));
await browser.close();