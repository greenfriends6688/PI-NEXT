import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = "/tmp/pi-verify";
mkdirSync(OUT, { recursive: true });
const APP = process.env.APP_URL || "http://127.0.0.1:30141";
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text().slice(0, 200)}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${String(e).slice(0, 200)}`));
await page.goto(APP, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);

const report = {};

// ---- 1 · 侧栏滚动 ----
report.sidebar = await page.evaluate(() => {
  const wrap = document.querySelector(".pw-side-scroll");
  const list = wrap?.firstElementChild;
  const groupTitles = [...document.querySelectorAll(".pw-side-scroll .pw-group-title")].map((el) => el.textContent.trim());
  const before = list?.scrollTop ?? 0;
  if (list) list.scrollTop = 400;
  const after = list?.scrollTop ?? 0;
  if (list) list.scrollTop = before;
  const search = document.querySelector(".pw-side-search");
  const sr = search?.getBoundingClientRect();
  const side = document.querySelector(".pw-side")?.getBoundingClientRect();
  return {
    wrapOverflowY: wrap ? getComputedStyle(wrap).overflowY : null,
    wrapDisplay: wrap ? getComputedStyle(wrap).display : null,
    listScrollable: (list?.scrollHeight ?? 0) > (list?.clientHeight ?? 0),
    scrolledTo: after,
    groupTitles,
    searchBox: sr ? [Math.round(sr.x), Math.round(sr.width)] : null,
    sideBox: side ? [Math.round(side.x), Math.round(side.width)] : null,
  };
});

// ---- 2 · 搜索 ----
const input = await page.$("#session-search-input");
await input.click();
await input.fill("设计");
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/search.png` });
report.search = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".pw-side-scroll .pw-session")];
  const boxes = rows.map((el) => { const r = el.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)]; });
  let overlap = 0;
  for (let i = 1; i < boxes.length; i++) if (boxes[i][0] < boxes[i - 1][1] - 1) overlap++;
  return {
    count: rows.length,
    firstRowHeight: rows[0] ? Math.round(rows[0].getBoundingClientRect().height) : null,
    overlappingPairs: overlap,
    groupTitle: document.querySelector(".pw-side-scroll .pw-group-title")?.textContent.trim(),
    firstText: rows[0]?.innerText.replace(/\n/g, " | ").slice(0, 120),
  };
});
await input.fill("");
await page.waitForTimeout(600);

// ---- 3 · 项目行 ⋯ ----
const row = page.locator(".pw-side-scroll .pw-row", { hasText: "pi-codex" }).first();
await row.hover();
await page.waitForTimeout(300);
await row.locator('button[aria-label="项目选项"]').first().click();
await page.waitForTimeout(600);
report.projectMenu = await page.evaluate(() => {
  const pops = [...document.querySelectorAll(".pw-pop")].filter((el) => el.textContent.trim());
  return pops.map((el) => ({ text: el.innerText.replace(/\n/g, " / ").slice(0, 80), box: (() => { const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })() }));
});
await page.screenshot({ path: `${OUT}/project-menu.png` });
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

// ---- 4 · 顶栏 ----
const tb = await page.$(".pw-topbar");
if (tb) await tb.screenshot({ path: `${OUT}/topbar.png` });
report.topbar = await page.evaluate(() => {
  const bar = document.querySelector(".pw-topbar");
  return {
    chips: [...bar.querySelectorAll("button.pw-chipbtn, span.pw-chipbtn")].map((el) => ({ tag: el.tagName, text: el.textContent.trim() })),
    iconButtons: [...bar.querySelectorAll("button.pw-iconbtn")].map((el) => el.getAttribute("aria-label")),
  };
});

// 分支芯片
const branchBtn = page.locator(".pw-topbar button.pw-chipbtn").first();
if (await branchBtn.count()) {
  await branchBtn.click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/branch-pop.png` });
  report.branchPopover = await page.evaluate(() => {
    const pops = [...document.querySelectorAll(".pw-pop")].filter((el) => el.textContent.trim());
    return pops.map((el) => el.innerText.replace(/\n/g, " / ").slice(0, 140));
  });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
}

// MCP 图标
const mcpBtn = page.locator('.pw-topbar button[aria-label="MCP"]').first();
if (await mcpBtn.count()) {
  await mcpBtn.hover();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/mcp-pop.png` });
  report.mcpPopover = await page.evaluate(() => [...document.querySelectorAll(".pw-pop")].filter((el) => el.textContent.trim()).map((el) => el.innerText.replace(/\n/g, " / ").slice(0, 220)));
  await page.mouse.move(700, 700);
  await page.waitForTimeout(400);
} else {
  report.mcpPopover = "MCP button not found";
}

// 插件图标
const pluginBtn = page.locator('.pw-topbar button[aria-label="插件"]').first();
if (await pluginBtn.count()) {
  await pluginBtn.hover();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/plugin-pop.png` });
  report.pluginPopover = await page.evaluate(() => [...document.querySelectorAll(".pw-pop")].filter((el) => el.textContent.trim()).map((el) => el.innerText.replace(/\n/g, " / ").slice(0, 300)));
  await page.mouse.move(700, 700);
  await page.waitForTimeout(400);
} else {
  report.pluginPopover = "plugin button not found";
}

// ---- 5 · 打开一个真实会话 ----
const session = page.locator(".pw-side-scroll .pw-session").first();
if (await session.count()) {
  await session.click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/session.png` });
}

// 过程卡
report.process = await page.evaluate(() => {
  const proc = document.querySelector(".pw-proc");
  if (!proc) return "no .pw-proc";
  const head = proc.querySelector(".pw-proc-head");
  const r = head.getBoundingClientRect();
  const badge = head.querySelector(".pw-badge");
  const failedSpan = [...head.querySelectorAll("span")].find((el) => el.style.color && el.style.color.includes("error"));
  return {
    tag: head.tagName,
    box: [Math.round(r.width), Math.round(r.height)],
    badgeClass: badge?.className,
    badgeText: badge?.innerText.trim(),
    trailing: head.lastElementChild?.textContent?.trim(),
    failedText: failedSpan?.textContent ?? null,
    failedColor: failedSpan ? getComputedStyle(failedSpan).color : null,
    text: head.innerText.replace(/\n/g, " | ").slice(0, 160),
  };
});
if (report.process !== "no .pw-proc") {
  const proc = await page.$(".pw-proc");
  await proc.screenshot({ path: `${OUT}/proc-collapsed.png` }).catch(() => {});
  // 点头行中部（不是 chevron）看能不能展开
  const box = await page.evaluate(() => { const h = document.querySelector(".pw-proc-head").getBoundingClientRect(); return { x: h.x + h.width / 2, y: h.y + h.height / 2 }; });
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(600);
  report.processToggleByHeadClick = await page.evaluate(() => document.querySelector(".pw-proc-head")?.getAttribute("aria-expanded"));
  await page.screenshot({ path: `${OUT}/proc-expanded.png` });
}

// ---- 6 · 统计浮窗 ----
const ring = await page.$(".composer-ring");
if (ring) {
  await ring.hover();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/ring-pop.png` });
  report.statsPopover = await page.evaluate(() => {
    const pop = document.querySelector(".composer-ring-pop");
    if (!pop) return "no popover";
    const wrap = pop.querySelector(".composer-ring-sections");
    const sections = wrap ? [...wrap.children].map((el) => { const r = el.getBoundingClientRect(); return { title: el.firstElementChild?.textContent, top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width) }; }) : null;
    return { sections, hasStopReason: pop.innerText.includes("结束原因"), text: pop.innerText.replace(/\n/g, " / ").slice(0, 260) };
  });
}

report.console = errors.slice(0, 20);
console.log(JSON.stringify(report, null, 1));
await browser.close();
