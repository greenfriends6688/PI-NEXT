#!/usr/bin/env node
/**
 * 设计走查用的截图工具：在 1440×900 的真实 Chromium 里打开本地服务，
 * 跑一段交互脚本，把每一步截图落到 /tmp/pi-ui/。
 *
 * 为什么不用 `xd://browser`：桌面内置浏览器面板的视口是 248px 宽的窄条，
 * 布局与截图都在手机尺寸下，量不到画板规格。
 *
 * 用法：
 *   node scripts/ui-shot.mjs <name> '<json steps>'
 * steps: [{goto}|{click:sel}|{wait:ms}|{text:sel}|{shot:name}|{eval:js}|{fill:[sel,val]}|{press:keys}|{scroll:[sel,dy]}]
 */

import { chromium } from "playwright";
import { mkdirSync, rmSync } from "node:fs";

const BASE = process.env.PI_BASE ?? "http://127.0.0.1:30141";
const OUT = process.env.PI_SHOT_DIR ?? "/tmp/pi-ui";
const [, , name, stepsJson] = process.argv;
if (!name || !stepsJson) {
  console.error("usage: node scripts/ui-shot.mjs <name> '<json steps>'");
  process.exit(1);
}

const steps = JSON.parse(stepsJson);
rmSync(`${OUT}/${name}`, { recursive: true, force: true });
mkdirSync(`${OUT}/${name}`, { recursive: true });

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: "light",
  locale: "zh-CN",
});
const page = await context.newPage(); await context.grantPermissions([]);
const logs = [];
page.on("console", (m) => { if (m.type() === "error") logs.push(`[console] ${m.text()}`); });
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

let shotIndex = 0;
const results = [];
for (const step of steps) {
  try {
    if (step.goto !== undefined) await page.goto(/^[a-z]+:\/\//i.test(step.goto) ? step.goto : BASE + step.goto, { waitUntil: "domcontentloaded" });
    if (step.waitFor) await page.waitForSelector(step.waitFor, { timeout: step.timeout ?? 15000 });
    if (step.click !== undefined) await page.click(step.click, { timeout: step.timeout ?? 10000 });
    if (step.openSettings) {
      // The rail's settings button needs a couple of attempts while the shell is
      // still settling; keep clicking until the section nav is actually there.
      for (let i = 0; i < 8; i += 1) {
        if (await page.locator(".settings-section-tabs .pw-row").count()) break;
        const foot = page.locator("button.pw-side-foot");
        if (await foot.count()) await foot.first().click({ force: true, timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(1200);
      }
    }
    if (step.clickNav) {
      await page.locator(".settings-section-tabs .pw-row", { hasText: step.clickNav }).first().click({ timeout: step.timeout ?? 15000 });
      await page.waitForTimeout(step.settle ?? 3500);
    }
    if (step.clickText !== undefined) await page.getByText(step.clickText, { exact: step.exact ?? false }).first().click({ timeout: step.timeout ?? 10000 });
    if (step.clickRole !== undefined) await page.getByRole("button", { name: step.clickRole }).first().click({ timeout: step.timeout ?? 10000 });
    if (step.fill) await page.fill(step.fill[0], step.fill[1]);
    if (step.press !== undefined) await page.keyboard.press(step.press);
    if (step.scroll) await page.evaluate(([sel, dy]) => { const el = sel ? document.querySelector(sel) : null; (el ?? document.scrollingElement).scrollBy(0, dy); }, step.scroll);
    if (step.eval !== undefined) results.push({ eval: step.label ?? "", value: await page.evaluate(step.eval) });
    if (step.shot) {
      const file = `${OUT}/${name}/${String(shotIndex++).padStart(2, "0")}-${step.shot}.png`;
      await page.screenshot({ path: file, fullPage: !!step.fullPage });
      results.push({ shot: file });
    }
  } catch (error) {
    results.push({ error: String(error).split("\n")[0], step });
  }
}

await browser.close();
console.log(JSON.stringify({ results, logs }, null, 1));
