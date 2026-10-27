import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:30141/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await page.goto(`http://127.0.0.1:30141/?session=${process.argv[2]}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);
const info = await page.evaluate(() => {
  const scrolls = [...document.querySelectorAll(".sidebar-files-scroll")];
  return scrolls.map((s) => ({
    rows: s.querySelectorAll(".tree-row").length,
    text: s.innerText.replace(/\s+/g, " ").slice(0, 60),
    visible: s.offsetParent !== null,
    h: Math.round(s.getBoundingClientRect().height),
    parent: s.parentElement?.id || s.parentElement?.className,
  }));
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
