import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:30141/?session=" + process.argv[2], { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(2000);
const m = await page.evaluate(() => {
  const side = document.querySelector(".app-sidebar");
  const r = (el) => { const b = el.getBoundingClientRect(); return { c: el.className, h: Math.round(b.height), y: Math.round(b.y), w: Math.round(b.width) }; };
  const kids = [...(side?.children ?? [])].map(r);
  const foot = document.querySelector(".side__foot");
  const composer = document.querySelector(".composer");
  const tools = document.querySelector(".side__tools");
  return {
    side: side && r(side),
    kids,
    foot: foot && r(foot),
    composer: composer && r(composer),
    tools: tools && r(tools),
    toolsKids: tools ? [...tools.children].map(r) : null,
  };
});
console.log(JSON.stringify(m, null, 2));
await browser.close();
