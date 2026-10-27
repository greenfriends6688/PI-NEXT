import { chromium } from "playwright";
const id = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:30141/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await page.goto(`http://127.0.0.1:30141/?session=${id}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
const info = await page.evaluate(() => {
  const row = document.querySelector(".srow.is-sub");
  const badge = row?.querySelector(".srow__badge");
  const svg = badge?.querySelector("svg");
  return {
    rowHTML: row ? row.outerHTML.slice(0, 420) : null,
    badgeText: badge?.textContent ?? null,
    svgUse: svg?.querySelector("use")?.getAttribute("href") ?? null,
    symbolExists: !!document.querySelector("#i-pi"),
    symbolCount: document.querySelectorAll("symbol").length,
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
