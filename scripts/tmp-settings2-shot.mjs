// 临时验收脚本：打开设置，字体区 + 技能 / 子代理 / 插件 / MCP 四个内页各截一张。
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
const shots = [];
async function shot(name, extra) {
  const path = `.shots/settings2-${name}.png`;
  if (extra) await extra();
  await page.waitForTimeout(1200);
  await (await modal.count() ? modal : page).screenshot({ path }).catch(async () => page.screenshot({ path }));
  shots.push(path);
}

// 常规页：滚到字体区
await shot("general-font", async () => {
  const heading = page.getByText("界面字体").first();
  if (await heading.count()) await heading.scrollIntoViewIfNeeded().catch(() => {});
  else await page.locator(".set-content__inner").first().evaluate((el) => { el.scrollTop = 420; }).catch(() => {});
});

for (const [name, label] of [["skills", "技能"], ["agents", "子代理"], ["plugins", "插件"], ["mcp", "MCP"]]) {
  await shot(name, async () => {
    const row = page.locator(".set-nav .set-row", { hasText: label }).first();
    await row.click({ force: true });
  });
}

console.log(JSON.stringify({ shots, errors }, null, 2));
await browser.close();
