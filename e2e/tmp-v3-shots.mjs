import { chromium } from "playwright";

const out = "C:/Users/Administrator/Desktop/PI-NEXT/preview-shots";
const sessionId = process.argv[2] || "01a15eaf-aca3-76a6-ad5f-e8cac1e587e8";
const browser = await chromium.launch();
const errors = [];

async function shot(name, width, height, theme) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${name}: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`${name}: pageerror ${e.message}`));
  await page.addInitScript((t) => { try { localStorage.setItem("pi-theme", t); } catch {} }, theme);
  await page.goto(`http://127.0.0.1:30141/?session=${sessionId}`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(6000);
  const metrics = await page.evaluate(() => {
    const el = document.querySelector(".chat-content");
    return {
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      chatOverflow: el ? el.scrollHeight - el.clientHeight : null,
    };
  });
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(name, JSON.stringify(metrics));
  await context.close();
}

await shot("v3-session-light", 1440, 900, "light");
await shot("v3-session-dark", 1440, 900, "dark");
await shot("v3-session-mobile", 390, 844, "light");
console.log("ERRORS:", errors.length ? [...new Set(errors)].slice(0, 10).join("\n") : "none");
await browser.close();
