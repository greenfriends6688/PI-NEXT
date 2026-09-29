import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const OUT = "/tmp/pi-probe3";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto("http://127.0.0.1:30141", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

// 悬停项目行 -> 点 ⋯（span 本身）
const row = page.locator(".pw-side-scroll .pw-row", { hasText: "pi-codex" }).first();
await row.hover();
await page.waitForTimeout(300);
const dot = row.locator('span[aria-label="项目选项"]').first();
console.log("ellipsis count:", await dot.count());
await dot.click({ force: true });
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/after-ellipsis-click.png` });
const pop = await page.evaluate(() => {
  const pops = [...document.querySelectorAll(".pw-pop")].map((el) => {
    const r = el.getBoundingClientRect();
    return { cls: el.className, box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], text: el.innerText.replace(/\n/g, " / ").slice(0, 140) };
  });
  const aria = [...document.querySelectorAll('[aria-label="项目选项"]')].map((el) => el.getAttribute("aria-expanded"));
  return { pops, aria };
});
console.log("ELLIPSIS CLICK", JSON.stringify(pop, null, 1));

// 顶栏 main 芯片
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
const chip = await page.evaluate(() => {
  const bar = document.querySelector(".pw-topbar");
  return bar ? [...bar.querySelectorAll("*")].filter((el) => el.textContent?.trim() === "main").map((el) => ({ tag: el.tagName, cls: el.className, outer: el.outerHTML.slice(0, 300) })) : null;
});
console.log("MAIN CHIP", JSON.stringify(chip, null, 1));

// 切到一个真实项目会话，看顶栏
const firstSession = page.locator(".pw-side-scroll .pw-session").first();
if (await firstSession.count()) {
  await firstSession.click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/session.png` });
  const tb = await page.evaluate(() => {
    const bar = document.querySelector(".pw-topbar");
    if (!bar) return null;
    return {
      html: bar.outerHTML.slice(0, 3000),
    };
  });
  console.log("TOPBAR HTML", JSON.stringify(tb, null, 1).slice(0, 3500));
}
await browser.close();
console.log("done");
