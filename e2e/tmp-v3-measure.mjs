import { chromium } from "playwright";
import { pathToFileURL } from "node:url";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const file = "C:/Users/Administrator/Desktop/PI-NEXT/design/v3/boards/web-running.html";
await page.goto(pathToFileURL(file).href, { waitUntil: "networkidle" });

for (const theme of ["light", "dark"]) {
  await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
  await page.waitForTimeout(300);
  const colors = await page.evaluate(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, color: cs.color, radius: cs.borderRadius, width: cs.width };
    };
    return {
      body: pick("body"),
      win: pick(".win"),
      side: pick(".side"),
      detail: pick(".detail"),
      chromeBtn: pick(".cbtn"),
      composer: pick(".composer"),
      tab: pick(".tab"),
      bubble: pick(".bubble"),
      srow: pick(".srow"),
      title: pick(".chrome__title"),
      status: pick(".status"),
      threadInner: pick(".thread__inner"),
      step: pick(".step"),
    };
  });
  console.log(theme, JSON.stringify(colors, null, 1));
}
await browser.close();
