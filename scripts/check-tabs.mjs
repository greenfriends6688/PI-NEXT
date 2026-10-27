// 验 20-viewer 的页签条：开一个终端 tab（画板的 .ftab），读几何并截图。
import { chromium } from "playwright";

const id = process.argv[2];
const out = process.argv[3] ?? ".shots/tabbar.png";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:30141/?session=${id}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
await page.click('button[aria-controls="file-panel"]').catch(() => {});
await page.waitForTimeout(800);

const candidates = [
  'button[title*="终端"]', 'button[title*="Terminal"]',
  '.sidebar-tool-button[title*="终端"]', '.sidebar-tool-button[title*="Terminal"]',
];
for (const sel of candidates) {
  const el = page.locator(sel).first();
  if ((await el.count()) > 0) { await el.click({ force: true }).catch(() => {}); break; }
}
await page.waitForTimeout(2500);
await page.screenshot({ path: out });

const info = await page.evaluate(() => {
  const bar = document.querySelector(".tabbar");
  const tab = document.querySelector(".ftab");
  const on = document.querySelector(".ftab.is-on");
  const r = (e) => (e ? { w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height) } : null);
  return {
    bar: r(bar),
    tabs: document.querySelectorAll(".ftab").length,
    firstTab: r(tab),
    activeTab: r(on),
    tabFont: tab ? getComputedStyle(tab).fontSize : null,
    tabRadius: tab ? getComputedStyle(tab).borderRadius : null,
  };
});
console.log(JSON.stringify(info));
await browser.close();
