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
  const s = document.querySelector(".app-sidebar");
  const walk = (el, d) => [ `${"  ".repeat(d)}${el.tagName.toLowerCase()}.${(el.className||"").toString().trim().split(/\s+/).join(".")} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`, ...(d < 2 ? [...el.children].flatMap((c) => walk(c, d + 1)) : []) ];
  return walk(s, 0).slice(0, 14);
});
console.log(info.join("\n"));
await browser.close();
