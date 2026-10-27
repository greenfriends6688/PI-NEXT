// 验 27-settings：点侧栏页脚的「设置」，截弹窗。
import { chromium } from "playwright";

const id = process.argv[2];
const out = process.argv[3] ?? ".shots/settings.png";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto("http://127.0.0.1:30141/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await page.goto(`http://127.0.0.1:30141/?session=${id}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);

await page.locator(".side__foot .srow").first().click({ force: true }).catch(() => {});
await page.waitForTimeout(1500);
await page.screenshot({ path: out });

const info = await page.evaluate(() => {
  const s = document.querySelector(".settings-modal");
  const b = document.querySelector(".settings-dialog-backdrop");
  const r = (e) => (e ? { w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height), x: Math.round(e.getBoundingClientRect().x), y: Math.round(e.getBoundingClientRect().y) } : null);
  return { modal: r(s), backdropBg: b ? getComputedStyle(b).backgroundColor : null, radius: s ? getComputedStyle(s).borderRadius : null };
});
console.log(JSON.stringify(info));
await browser.close();
