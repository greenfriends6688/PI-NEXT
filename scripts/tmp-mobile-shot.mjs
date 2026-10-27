import { chromium } from "playwright";
const APP = process.env.APP_URL || "http://127.0.0.1:30141";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
let ok = false;
for (let i = 0; i < 4 && !ok; i++) {
  await p.goto(APP, { waitUntil: "domcontentloaded", timeout: 90000 }).then(() => { ok = true; }).catch(() => {});
  if (!ok) await p.waitForTimeout(4000);
}
await p.waitForTimeout(5000);
await p.locator(".app-chrome-button--sidebar").first().click({ force: true }).catch(() => {});
await p.waitForTimeout(1500);
await p.locator(".side__foot .srow").first().click({ force: true }).catch(() => {});
await p.waitForTimeout(2500);
await p.locator(".settings-mobile-section-picker").selectOption("general").catch(() => {});
await p.waitForTimeout(1800);
await p.locator(".settings-font-field").first().scrollIntoViewIfNeeded().catch(() => {});
await p.evaluate(() => { const el = document.querySelector(".set-content__inner"); if (el) el.scrollTop = el.scrollTop - 120; });
await p.waitForTimeout(900);
await p.screenshot({ path: ".shots/settings2-mobile-font.png" });
console.log(JSON.stringify({ surface: await p.locator(".settings-dialog-surface").count(), row: await p.locator(".settings-font-field").count(), errors }, null, 2));
await b.close();
