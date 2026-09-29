import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const OUT = "/tmp/pi-verify3";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto("http://127.0.0.1:30141", { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
const report = {};

const input = await page.$("#session-search-input");
await input.click();
await input.fill("设计");
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/search.png` });
report.search = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".pw-search-results .pw-session")];
  const boxes = rows.map((el) => { const r = el.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)]; });
  let overlap = 0;
  for (let i = 1; i < boxes.length; i++) if (boxes[i][0] < boxes[i - 1][1] - 1) overlap++;
  const box = document.querySelector(".pw-search-results")?.getBoundingClientRect();
  return {
    count: rows.length,
    firstRowHeight: rows[0] ? Math.round(rows[0].getBoundingClientRect().height) : null,
    overlappingPairs: overlap,
    containerBox: box ? [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)] : null,
    scrollable: (() => { const el = document.querySelector(".pw-search-results"); return el ? el.scrollHeight > el.clientHeight : null; })(),
    groupTitle: document.querySelector(".pw-search-results .pw-group-title")?.textContent.trim(),
    lastTitle: [...document.querySelectorAll(".pw-search-results .pw-group-title")].map((e) => e.textContent.trim()),
    firstRow: rows[0]?.innerText.replace(/\n/g, " | ").slice(0, 130),
    hasMark: !!document.querySelector(".pw-search-results .pw-mark"),
    markText: document.querySelector(".pw-search-results .pw-mark")?.textContent,
  };
});
await input.fill("zzzz-no-such-thing");
await page.waitForTimeout(1800);
await page.screenshot({ path: `${OUT}/search-empty.png` });
report.searchEmpty = await page.evaluate(() => document.querySelector(".pw-search-results")?.innerText.replace(/\n/g, " | ").slice(0, 120));
await input.fill("");
await page.waitForTimeout(500);

// 含失败的会话：在侧栏里搜「失败」找一条
await input.fill("失败");
await page.waitForTimeout(2200);
const rows = page.locator(".pw-search-results .pw-session");
const n = await rows.count();
report.failureSearchRows = n;
if (n > 0) {
  await rows.first().click();
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${OUT}/failure-session.png` });
  report.failedProc = await page.evaluate(() => {
    const heads = [...document.querySelectorAll(".pw-proc-head")];
    const withFail = heads.find((h) => /次失败/.test(h.innerText));
    if (!withFail) return { found: false, sample: heads.slice(0, 8).map((h) => h.innerText.replace(/\n/g, " | ").slice(0, 80)) };
    const failedSpan = [...withFail.querySelectorAll("span")].find((el) => el.style.color && el.style.color.includes("error"));
    return {
      found: true,
      badge: withFail.querySelector(".pw-badge")?.className,
      badgeText: withFail.querySelector(".pw-badge")?.innerText.trim(),
      failedText: failedSpan?.textContent,
      failedColor: failedSpan ? getComputedStyle(failedSpan).color : null,
      text: withFail.innerText.replace(/\n/g, " | ").slice(0, 150),
    };
  });
  const proc = page.locator(".pw-proc").first();
  if (await proc.count()) await proc.screenshot({ path: `${OUT}/failed-proc.png` }).catch(() => {});
}
console.log(JSON.stringify(report, null, 1));
await browser.close();
