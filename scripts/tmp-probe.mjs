import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await p.goto("http://127.0.0.1:30141/", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(5000);
const list = await p.evaluate(() => [...document.querySelectorAll("button")].map((b) => ({ t: (b.textContent || "").trim().slice(0, 18), c: b.className, a: b.getAttribute("aria-label") })).slice(0, 40));
console.log(JSON.stringify(list, null, 1));
await b.close();
