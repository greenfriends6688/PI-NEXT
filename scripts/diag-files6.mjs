import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:30141/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await page.goto(`http://127.0.0.1:30141/?session=${process.argv[2]}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
const before = await page.evaluate(() => ({ rows: document.querySelectorAll(".tree-row").length, rootsText: document.querySelector(".sidebar-files-panel")?.innerText.replace(/\s+/g," ").slice(0,80) }));
await page.click("#session-sidebar-tab-files").catch(() => {});
await page.waitForTimeout(2500);
const after = await page.evaluate(() => {
  const scroll = document.querySelector(".sidebar-files-scroll");
  return {
    rows: document.querySelectorAll(".tree-row").length,
    scrollH: scroll ? Math.round(scroll.getBoundingClientRect().height) : null,
    text: document.querySelector(".sidebar-files-body")?.innerText.replace(/\s+/g," ").slice(0, 120),
  };
});
console.log(JSON.stringify({ before, after }));
await browser.close();
