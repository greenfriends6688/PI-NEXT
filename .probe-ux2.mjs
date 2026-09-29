import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = "/tmp/pi-probe2";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 3 });
await page.goto("http://127.0.0.1:30141", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

// 侧栏搜索盒特写
const box = await page.$(".pw-side-search");
if (box) {
  const r = await box.boundingBox();
  await page.screenshot({ path: `${OUT}/search-box.png`, clip: { x: r.x - 6, y: r.y - 6, width: r.width + 12, height: r.height + 12 } });
  const css = await page.evaluate(() => {
    const el = document.querySelector(".pw-side-search");
    const inp = el.querySelector("input");
    const c1 = getComputedStyle(el), c2 = getComputedStyle(inp);
    const r1 = el.getBoundingClientRect(), r2 = inp.getBoundingClientRect();
    return {
      label: { box: [r1.x, r1.y, r1.width, r1.height], border: c1.border, radius: c1.borderRadius, pad: c1.padding, margin: c1.margin, bg: c1.backgroundColor, width: c1.width },
      input: { box: [r2.x, r2.y, r2.width, r2.height], border: c2.border, outline: c2.outline, bg: c2.backgroundColor, appearance: c2.appearance, height: c2.height, font: c2.font },
    };
  });
  console.log("SEARCHBOX", JSON.stringify(css, null, 1));
}

// 项目行的 ⋯ 与 + 按钮
const proj = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".pw-side-scroll .pw-row")];
  const target = rows.find((r) => r.textContent.includes("pi-codex"));
  if (!target) return { found: false, rows: rows.map((r) => r.textContent.trim().slice(0, 30)) };
  const acts = target.querySelector(".pw-acts");
  const kids = [...(acts?.children ?? [])].map((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName,
      box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      opacity: cs.opacity,
      pointer: cs.pointerEvents,
      cursor: cs.cursor,
      aria: el.getAttribute("aria-label"),
      title: el.getAttribute("title"),
      disabled: el.disabled ?? null,
      outer: el.outerHTML.slice(0, 260),
    };
  });
  const rr = target.getBoundingClientRect();
  return { found: true, rowBox: [Math.round(rr.x), Math.round(rr.y), Math.round(rr.width), Math.round(rr.height)], actsOpacity: acts ? getComputedStyle(acts).opacity : null, kids };
});
console.log("PROJECTROW", JSON.stringify(proj, null, 1));

// hover 项目行后再看
const rowEl = await page.evaluateHandle(() => [...document.querySelectorAll(".pw-side-scroll .pw-row")].find((r) => r.textContent.includes("pi-codex")));
if (rowEl) {
  await rowEl.asElement()?.hover().catch(() => {});
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".pw-side-scroll .pw-row")];
    const target = rows.find((r) => r.textContent.includes("pi-codex"));
    const acts = target?.querySelector(".pw-acts");
    return { opacity: acts ? getComputedStyle(acts).opacity : null, kids: [...(acts?.children ?? [])].map((el) => el.tagName + ":" + (el.getAttribute("aria-label") || el.title || "")) };
  });
  console.log("AFTER HOVER", JSON.stringify(after, null, 1));
  const r = await rowEl.asElement()?.boundingBox();
  if (r) await page.screenshot({ path: `${OUT}/projrow.png`, clip: { x: r.x - 4, y: r.y - 4, width: r.width + 8, height: r.height + 8 } });
}

// 点击 ⋯ 看菜单是否出现
if (rowEl) {
  const clicked = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".pw-side-scroll .pw-row")];
    const target = rows.find((r) => r.textContent.includes("pi-codex"));
    const acts = target?.querySelector(".pw-acts");
    const first = acts?.children[0];
    if (!first) return "no child";
    first.click();
    return first.outerHTML.slice(0, 200);
  });
  await page.waitForTimeout(600);
  const menu = await page.evaluate(() => {
    const pops = [...document.querySelectorAll(".pw-pop")].map((el) => ({ cls: el.className, box: (() => { const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })(), text: el.innerText.replace(/\n/g, " / ").slice(0, 120) }));
    return pops;
  });
  console.log("CLICK ELLIPSIS ->", clicked);
  console.log("MENUS", JSON.stringify(menu, null, 1));
}

await browser.close();
console.log("done");
