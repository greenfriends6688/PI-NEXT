import { chromium } from "playwright";

const id = process.argv[2];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:30141/?session=${id}`, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const sc = document.querySelector(".chat-scroll, .thread, [data-chat-scroll]");
  if (sc) sc.scrollTop = 0;
  document.querySelectorAll("button.grp-head").forEach((b) => b.click());
});
await page.waitForTimeout(900);
await page.screenshot({ path: "C:\\Users\\Administrator\\Desktop\\PI-NEXT\\.shots\\thread-top.png" });
const info = await page.evaluate(() => {
  const heads = [...document.querySelectorAll(".grp-head")].slice(0, 3).map((el) => {
    const b = el.getBoundingClientRect();
    return { w: Math.round(b.width), h: Math.round(b.height), cls: el.className, text: el.textContent?.slice(0, 40) };
  });
  return { count: document.querySelectorAll(".grp-head").length, heads };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
