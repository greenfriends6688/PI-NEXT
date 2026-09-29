import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:30141", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const info = await page.evaluate(() => {
  const el = document.querySelector(".pw-side-search");
  const hits = [];
  for (const sheet of document.styleSheets) {
    let list;
    try { list = sheet.cssRules; } catch { continue; }
    const walk = (rules) => {
      for (const rule of rules) {
        if (rule.cssRules) { walk(rule.cssRules); continue; }
        if (!rule.selectorText) continue;
        let m = false;
        try { m = el.matches(rule.selectorText); } catch { m = false; }
        if (!m) continue;
        if (/min-width|width/.test(rule.style.cssText)) hits.push({ sel: rule.selectorText, css: rule.cssText.slice(0, 200) });
      }
    };
    walk(list);
  }
  return hits;
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
