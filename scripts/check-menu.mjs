// 验 25-menu：右键一条会话，截 .menu 的几何。
import { chromium } from "playwright";

const id = process.argv[2];
const out = process.argv[3] ?? ".shots/menu.png";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto("http://127.0.0.1:30141/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await page.goto(`http://127.0.0.1:30141/?session=${id}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);

const row = page.locator(".srow.is-sub").first();
await row.click({ button: "right" }).catch(() => {});
await page.waitForTimeout(700);
await page.screenshot({ path: out });

const info = await page.evaluate(() => {
  const m = document.querySelector(".menu");
  const item = document.querySelector(".menu-item");
  const kbd = document.querySelector(".menu-item__kbd");
  const r = (e) => (e ? { w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height) } : null);
  return {
    menu: r(m),
    items: document.querySelectorAll(".menu-item").length,
    firstItem: r(item),
    itemFont: item ? getComputedStyle(item).fontSize : null,
    itemRadius: item ? getComputedStyle(item).borderRadius : null,
    kbd: !!kbd,
    seps: document.querySelectorAll(".menu-sep").length,
  };
});
console.log(JSON.stringify(info));
await browser.close();
