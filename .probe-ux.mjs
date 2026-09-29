// 临时探针：抓当前产品 UI 的几个面（侧栏 / 顶栏 / 统计浮窗 / 过程卡）
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = "/tmp/pi-probe";
mkdirSync(OUT, { recursive: true });
const APP = process.env.APP_URL || "http://127.0.0.1:30141";

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.on("console", (m) => {
  const t = m.text();
  if (t.includes("Warning") || t.includes("error") || t.includes("Error")) console.log("[console]", t.slice(0, 300));
});
await page.goto(APP, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("shot", name);
};

await shot("01-initial");

// 侧栏整体
const side = await page.$(".pw-side");
if (side) {
  await side.screenshot({ path: `${OUT}/02-sidebar.png` });
  console.log("sidebar shot");
}

// 侧栏滚动容器几何
const geo = await page.evaluate(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      sel,
      box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      overflowY: cs.overflowY,
      display: cs.display,
      scrollH: el.scrollHeight,
      clientH: el.clientHeight,
      flex: cs.flex,
    };
  };
  return [
    pick(".pw-side"),
    pick(".pw-side-scroll"),
    pick(".pw-side-scroll > div"),
    pick(".pw-side-search"),
    pick(".pw-side-search input"),
    pick(".pw-topbar"),
  ];
});
console.log("GEO", JSON.stringify(geo, null, 1));

// 搜索
const input = await page.$("#session-search-input");
if (input) {
  await input.click();
  await input.fill("设计");
  await page.waitForTimeout(1200);
  await shot("03-search");
  const res = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".pw-side-scroll .pw-session")].slice(0, 4);
    return rows.map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { h: Math.round(r.height), cssH: cs.height, overflow: cs.overflow, text: el.innerText.slice(0, 80) };
    });
  });
  console.log("SEARCH ROWS", JSON.stringify(res, null, 1));
  await input.fill("");
  await page.waitForTimeout(500);
}

// 顶栏
const tb = await page.$(".pw-topbar");
if (tb) {
  await tb.screenshot({ path: `${OUT}/04-topbar.png` });
  const items = await page.evaluate(() => {
    const bar = document.querySelector(".pw-topbar");
    if (!bar) return null;
    return [...bar.children].map((el) => ({
      tag: el.tagName,
      cls: el.className,
      text: (el.textContent || "").trim().slice(0, 40),
      box: (() => { const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.width)]; })(),
    }));
  });
  console.log("TOPBAR", JSON.stringify(items, null, 1));
}

// 统计浮窗
const ring = await page.$(".composer-ring");
if (ring) {
  await ring.hover();
  await page.waitForTimeout(700);
  await shot("05-ringpop");
  const pop = await page.evaluate(() => {
    const el = document.querySelector(".composer-ring-pop");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], html: el.innerText.slice(0, 700) };
  });
  console.log("RINGPOP", JSON.stringify(pop, null, 1));
  const sections = await page.evaluate(() => {
    const pop = document.querySelector(".composer-ring-pop");
    if (!pop) return null;
    const wrap = pop.querySelector("div > div[style*='flex-wrap']") || pop.querySelector("div[style*='flex-wrap']");
    if (!wrap) return "no wrap";
    return [...wrap.children].map((el) => {
      const r = el.getBoundingClientRect();
      return { box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], text: el.innerText.split("\n").slice(0, 3).join(" | ") };
    });
  });
  console.log("SECTIONS", JSON.stringify(sections, null, 1));
}

// 过程卡
const proc = await page.$(".pw-proc");
if (proc) {
  await proc.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(400);
  await proc.screenshot({ path: `${OUT}/06-proc.png` }).catch(() => {});
  const info = await page.evaluate(() => {
    const el = document.querySelector(".pw-proc");
    if (!el) return null;
    const head = el.querySelector(".pw-proc-head");
    const r = head.getBoundingClientRect();
    return {
      headBox: [Math.round(r.width), Math.round(r.height)],
      html: head.outerHTML.slice(0, 900),
      buttonsInHead: head.querySelectorAll("button").length,
    };
  });
  console.log("PROC", JSON.stringify(info, null, 1));
}

await browser.close();
console.log("done");
