import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto("http://127.0.0.1:30142/", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(4000);
await p.locator(".side__foot .srow").first().click({ force: true }).catch(() => {});
await p.waitForTimeout(2000);
await p.locator(".set-nav .set-row", { hasText: "子代理" }).first().click({ force: true });
await p.waitForTimeout(1500);
console.log(JSON.stringify(await p.evaluate(() => {
  const f = document.querySelector(".agents-max-concurrent");
  const ff = document.querySelector(".settings-font-field");
  const r = (e) => e ? { w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height), css: getComputedStyle(e).cssText ? getComputedStyle(e).width : null } : null;
  return { maxConcurrent: r(f), fontField: r(ff), cardBg: f ? getComputedStyle(f).backgroundColor : null };
}), null, 2));
await b.close();
