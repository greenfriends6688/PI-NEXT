import { chromium } from "playwright";

const id = process.argv[2];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:30141/?session=${id}`, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1500);

await page.evaluate(() => {
  document.querySelectorAll(".grp-head").forEach((b) => {
    if (b.classList.contains("is-closed")) b.click();
  });
});
await page.waitForTimeout(700);
await page.evaluate(() => {
  const el = document.querySelector(".steps");
  if (el) el.scrollIntoView({ block: "center" });
});
await page.waitForTimeout(700);
await page.screenshot({ path: "C:\\Users\\Administrator\\Desktop\\PI-NEXT\\.shots\\steps.png" });

const info = await page.evaluate(() => {
  const steps = [...document.querySelectorAll(".step")];
  const sample = steps[0];
  const r = sample?.getBoundingClientRect();
  return {
    count: steps.length,
    first: sample ? { w: Math.round(r.width), h: Math.round(r.height), text: sample.textContent?.slice(0, 60) } : null,
    errors: steps.filter((s) => s.classList.contains("is-error")).length,
    branchVisible: sample ? getComputedStyle(sample.querySelector(".step__branch")).display : null,
    lineW: sample ? Math.round(sample.querySelector(".step__line").getBoundingClientRect().width) : null,
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
