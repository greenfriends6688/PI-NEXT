import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:30141", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

const rowBox = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".pw-side-scroll .pw-row")];
  const t = rows.find((r) => r.textContent.includes("pi-codex"));
  const el = t.querySelector('span[aria-label="项目选项"]');
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, rowDraggable: t.getAttribute("draggable") };
});
console.log("target", rowBox);

const menuOpen = () => page.evaluate(() => document.querySelectorAll(".pw-pop").length > 1);

// A) 直接点（带 3px 抖动，模拟真人）
await page.mouse.move(rowBox.x - 40, rowBox.y);
await page.mouse.move(rowBox.x, rowBox.y, { steps: 6 });
await page.mouse.down();
await page.mouse.move(rowBox.x + 2, rowBox.y + 1);
await page.mouse.up();
await page.waitForTimeout(500);
console.log("A jitter click -> menu:", await menuOpen());

// B) 无抖动
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
await page.mouse.move(rowBox.x - 40, rowBox.y);
await page.mouse.move(rowBox.x, rowBox.y, { steps: 6 });
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(500);
console.log("B clean click -> menu:", await menuOpen());

// C) 键盘可达性：Tab 到它并按 Enter
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
const kb = await page.evaluate(() => {
  const el = document.querySelector('span[aria-label="项目选项"]');
  el.focus();
  const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
  el.dispatchEvent(ev);
  return document.activeElement === el;
});
await page.waitForTimeout(400);
console.log("C keyboard enter focused:", kb, "menu:", await menuOpen());

// D) 点击「+」
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
const plusBox = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".pw-side-scroll .pw-row")];
  const t = rows.find((r) => r.textContent.includes("pi-codex"));
  const el = t.querySelector('span[aria-label="在此项目中新建会话"]');
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, opacity: cs.opacity, pe: cs.pointerEvents };
});
console.log("plus", plusBox);
await browser.close();
