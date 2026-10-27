import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await page.goto("http://127.0.0.1:30141/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.goto(`http://127.0.0.1:30141/?session=${process.argv[2]}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
const before = await page.evaluate(() => [...document.querySelectorAll(".app-sidebar")].map((e) => `${e.className} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`));
await page.locator(".app-mobile-toolbar").first().locator("xpath=preceding-sibling::button[1]").click({ force: true }).catch(() => {});
await page.waitForTimeout(900);
const after = await page.evaluate(() => {
  const shell = document.querySelector(".app-shell");
  return {
    sidebars: [...document.querySelectorAll(".app-sidebar")].length,
    kids: [...shell.children].map((c) => `${c.tagName.toLowerCase()}.${(c.className||"").toString().trim().split(/\s+/).slice(0,2).join(".")} ${Math.round(c.getBoundingClientRect().width)}x${Math.round(c.getBoundingClientRect().height)}`),
    animating: getComputedStyle(document.querySelector(".app-sidebar")).transition,
  };
});
console.log("before:", before.join(" | "));
console.log(JSON.stringify(after, null, 1));
await browser.close();
