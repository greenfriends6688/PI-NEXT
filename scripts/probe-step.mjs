import { chromium } from "playwright";

const id = process.argv[2];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:30141/?session=${id}`, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1200);
await page.evaluate(() => document.querySelectorAll(".grp-head.is-closed").forEach((b) => b.click()));
await page.waitForTimeout(600);

const data = await page.evaluate(() => {
  const step = document.querySelector(".step");
  const path = step?.querySelector(".step__cont path");
  const branch = step?.querySelector(".step__branch path");
  const cs = path ? getComputedStyle(path) : null;
  const br = branch ? getComputedStyle(branch) : null;
  const svg = step?.querySelector(".step__cont");
  const sb = svg?.getBoundingClientRect();
  return {
    reduce: matchMedia("(prefers-reduced-motion: reduce)").matches,
    cont: cs ? { offset: cs.strokeDashoffset, opacity: cs.strokeOpacity, stroke: cs.stroke, anim: cs.animationName, dur: cs.animationDuration } : null,
    branch: br ? { offset: br.strokeDashoffset, anim: br.animationName } : null,
    svgBox: sb ? { x: Math.round(sb.x), w: Math.round(sb.width), h: Math.round(sb.height) } : null,
    stepBox: step ? (() => { const b = step.getBoundingClientRect(); return { x: Math.round(b.x), w: Math.round(b.width), h: Math.round(b.height) }; })() : null,
  };
});
console.log(JSON.stringify(data, null, 2));
await browser.close();
