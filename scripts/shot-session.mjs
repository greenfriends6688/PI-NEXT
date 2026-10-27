import { chromium } from "playwright";
import fs from "node:fs";

const out = "C:\\Users\\Administrator\\Desktop\\PI-NEXT\\.shots";
fs.mkdirSync(out, { recursive: true });
const id = process.argv[2];

const browser = await chromium.launch();
const errors = [];

async function shoot(name, viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, ...opts });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(name + ": " + e.message.slice(0, 140)));
  await page.goto(`http://127.0.0.1:30141/?session=${id}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${out}\\${name}.png` });
  const m = await page.evaluate(() => {
    const r = (s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x) };
    };
    return {
      composer: r(".composer"),
      card: r(".chat-input-card"),
      controls: r(".chat-input-controls"),
      bubble: r(".message-user-bubble"),
      side: r(".app-sidebar"),
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
  await ctx.close();
  return m;
}

const desktop = await shoot("session-1440", { width: 1440, height: 900 });
const mobile = await shoot("session-390", { width: 390, height: 844 }, { isMobile: true, hasTouch: true });
console.log(JSON.stringify({ desktop, mobile, errors: errors.slice(0, 6) }, null, 2));
await browser.close();
