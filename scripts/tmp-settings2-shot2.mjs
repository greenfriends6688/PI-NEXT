// 临时验收脚本 2：只截「字体与排版」卡片与四个内页的详情区。
import { chromium } from "playwright";

const APP = process.env.APP_URL || "http://127.0.0.1:30142";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(`page: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

await page.goto(APP, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForTimeout(4000);
await page.locator(".side__foot .srow").first().click({ force: true }).catch(() => {});
await page.waitForTimeout(2500);

const modal = page.locator(".settings-modal").first();
const out = [];

// 字体卡：滚到「字体与排版」小节再截整张弹窗
await page.locator(".set-content__inner").first().evaluate((el) => { el.scrollTop = el.scrollHeight; });
await page.waitForTimeout(600);
await modal.screenshot({ path: ".shots/settings2-font-rows.png" });
out.push(".shots/settings2-font-rows.png");

for (const [name, label] of [["skills", "技能"], ["agents", "子代理"], ["plugins", "插件"], ["mcp", "MCP"]]) {
  await page.locator(".set-nav .set-row", { hasText: label }).first().click({ force: true });
  await page.waitForTimeout(1800);
  const path = `.shots/settings2-detail-${name}.png`;
  await modal.screenshot({ path });
  out.push(path);
}

// 手机 390
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await mobile.goto(APP, { waitUntil: "domcontentloaded" });
await mobile.waitForTimeout(4500);
await mobile.locator(".side__foot .srow").first().click({ force: true }).catch(() => {});
await mobile.waitForTimeout(2000);
await mobile.locator(".settings-mobile-section-picker").selectOption("general").catch(() => {});
await mobile.waitForTimeout(1500);
await mobile.evaluate(() => {
  const el = document.querySelector(".set-content__inner");
  if (el) el.scrollTop = el.scrollHeight;
});
await mobile.waitForTimeout(800);
await mobile.screenshot({ path: ".shots/settings2-mobile-font.png", fullPage: false });
out.push(".shots/settings2-mobile-font.png");

console.log(JSON.stringify({ out, errors }, null, 2));
await browser.close();
