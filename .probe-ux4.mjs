import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:30141", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const chain = await page.evaluate(() => {
  const out = [];
  let el = document.querySelector(".pw-side-search");
  while (el && out.length < 8) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    out.push({
      tag: el.tagName,
      cls: el.className,
      box: [Math.round(r.x), Math.round(r.width)],
      display: cs.display,
      flexDir: cs.flexDirection,
      align: cs.alignItems,
      width: cs.width,
      boxSizing: cs.boxSizing,
      padding: cs.padding,
      margin: cs.margin,
      gap: cs.gap,
    });
    el = el.parentElement;
  }
  return out;
});
console.log(JSON.stringify(chain, null, 1));
await browser.close();
