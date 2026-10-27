import { chromium } from "playwright";
const APP = process.env.APP_URL || "http://127.0.0.1:30156";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await p.goto(APP, { waitUntil: "domcontentloaded", timeout: 90000 });
await p.waitForTimeout(5000);
await p.locator(".app-chrome-button--sidebar").first().click({ force: true }).catch(() => {});
await p.waitForTimeout(1200);
await p.locator(".side__foot .srow").first().click({ force: true }).catch(() => {});
await p.waitForTimeout(2500);
await p.locator(".settings-mobile-section-picker").selectOption("general").catch(() => {});
await p.waitForTimeout(1500);
console.log(JSON.stringify(await p.evaluate(() => {
  const row = document.querySelector(".settings-general .crow:has(.settings-font-field)");
  const ctl = row?.querySelector(".crow__control");
  const f = row?.querySelector(".settings-font-field");
  const r = row?.querySelector("input[type=range]");
  const btn = row?.querySelector("button");
  const box = (e) => e ? (() => { const b = e.getBoundingClientRect(); return { w: Math.round(b.width), x: Math.round(b.x), right: Math.round(b.right) }; })() : null;
  return { row: box(row), rowScroll: row ? row.scrollWidth : null, ctl: box(ctl), field: box(f), range: box(r), btn: box(btn),
    card: box(document.querySelector(".settings-general .card")), inner: box(document.querySelector(".settings-general")) };
}), null, 2));
await b.close();
