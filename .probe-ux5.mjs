import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:30141", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const info = await page.evaluate(() => {
  const el = document.querySelector(".pw-side-search");
  const cs = getComputedStyle(el);
  const out = {
    inlineWidth: el.style.width,
    alignSelf: cs.alignSelf,
    alignItems: cs.alignItems,
    minWidth: cs.minWidth,
    maxWidth: cs.maxWidth,
    flexBasis: cs.flexBasis,
    flexGrow: cs.flexGrow,
    position: cs.position,
    // 用 CSSOM 找出所有匹配到该元素且声明了 width 的规则
    rules: [],
  };
  for (const sheet of document.styleSheets) {
    let list;
    try { list = sheet.cssRules; } catch { continue; }
    for (const rule of list) {
      if (!rule.selectorText) continue;
      if (!rule.selectorText.includes("pw-side-search") && !/^\s*(label|\.pw-side\s*>)/.test(rule.selectorText)) continue;
      try { if (!el.matches(rule.selectorText)) continue; } catch { continue; }
      const w = rule.style.width || rule.style.maxWidth || rule.style.minWidth;
      out.rules.push({ sel: rule.selectorText, width: w, css: rule.cssText.slice(0, 160) });
    }
  }
  return out;
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
