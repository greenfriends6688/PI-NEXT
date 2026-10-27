import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await page.goto("http://127.0.0.1:30141/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.goto(`http://127.0.0.1:30141/?session=${process.argv[2]}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
await page.locator(".app-mobile-toolbar").first().locator("xpath=preceding-sibling::button[1]").click({ force: true }).catch(() => {});
await page.waitForTimeout(800);
const info = await page.evaluate(() => {
  const out = [];
  let el = document.querySelector(".app-sidebar");
  while (el) {
    const cs = getComputedStyle(el);
    out.push(`${el.tagName.toLowerCase()}.${(el.className||"").toString().trim().split(/\s+/).slice(0,3).join(".")} | filter=${cs.filter} | backdrop=${cs.backdropFilter} | transform=${cs.transform.slice(0,30)} | isolate=${cs.isolation}`);
    el = el.parentElement;
  }
  return out;
});
console.log(info.join("\n"));
await browser.close();
