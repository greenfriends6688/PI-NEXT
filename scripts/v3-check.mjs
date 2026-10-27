import { chromium } from "playwright";
import fs from "node:fs";

const out = process.argv[2] || "C:\\Users\\Administrator\\Desktop\\PI-NEXT\\.shots";
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

await page.goto("http://127.0.0.1:30141/", { waitUntil: "networkidle", timeout: 60000 }).catch((e) => errors.push("goto: " + e.message));
await page.waitForTimeout(1500);
await page.screenshot({ path: out + "\\app-1440.png" });

const metrics = await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const shell = q(".app-shell");
  const side = q(".app-sidebar");
  const main = q(".app-main");
  const card = q(".chat-input-card");
  return {
    url: location.href,
    title: document.title,
    shellClass: shell?.className,
    shellRect: shell?.getBoundingClientRect().toJSON(),
    sideW: side?.getBoundingClientRect().width,
    mainW: main?.getBoundingClientRect().width,
    cardW: card?.getBoundingClientRect().width,
    hasHero: !!q(".new-session-hero"),
    heroClass: q(".new-session-hero")?.className,
    bodyBg: cs(document.body)?.backgroundColor,
    accent: cs(document.documentElement)?.getPropertyValue("--accent"),
    surface: cs(document.documentElement)?.getPropertyValue("--surface"),
    ink: cs(document.documentElement)?.getPropertyValue("--ink"),
  };
});

const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const mpage = await mctx.newPage();
await mpage.goto("http://127.0.0.1:30141/", { waitUntil: "networkidle", timeout: 60000 }).catch((e) => errors.push("mobile goto: " + e.message));
await mpage.waitForTimeout(1200);
await mpage.screenshot({ path: out + "\\app-390.png" });

console.log(JSON.stringify({ metrics, errors: errors.slice(0, 12) }, null, 2));
await browser.close();
