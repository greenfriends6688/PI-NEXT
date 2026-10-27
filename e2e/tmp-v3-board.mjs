import { chromium } from "playwright";
import { pathToFileURL } from "node:url";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(e.message));

const file = "C:/Users/Administrator/Desktop/PI-NEXT/design/v3/boards/web-running.html";
await page.goto(pathToFileURL(file).href, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.screenshot({ path: "C:/Users/Administrator/Desktop/PI-NEXT/preview-shots/v3-board-running.png" });
console.log("errors:", errors.length ? errors : "none");
await browser.close();
