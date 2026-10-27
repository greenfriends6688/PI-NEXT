import { chromium } from "playwright";
const id = process.argv[2];
const browser = await chromium.launch();

// 1) 桌面
const d = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await d.goto("http://127.0.0.1:30141/", { waitUntil: "domcontentloaded" });
await d.waitForTimeout(2500);
await d.goto(`http://127.0.0.1:30141/?session=${id}`, { waitUntil: "domcontentloaded" });
await d.waitForTimeout(9000);
await d.screenshot({ path: ".shots/show-1-desktop.png" });

// 2) 桌面设置
await d.locator(".side__foot .srow").first().click({ force: true }).catch(() => {});
await d.waitForTimeout(1200);
await d.screenshot({ path: ".shots/show-2-settings.png" });
await d.keyboard.press("Escape").catch(() => {});
await d.waitForTimeout(500);

// 3) 手机
const m = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await m.goto("http://127.0.0.1:30141/", { waitUntil: "domcontentloaded" });
await m.waitForTimeout(2500);
await m.goto(`http://127.0.0.1:30141/?session=${id}`, { waitUntil: "domcontentloaded" });
await m.waitForTimeout(9000);
await m.screenshot({ path: ".shots/show-3-mobile.png" });

// 4) 手机抽屉
await m.locator(".app-mobile-toolbar").first().locator("xpath=preceding-sibling::button[1]").click({ force: true }).catch(() => {});
await m.waitForTimeout(900);
await m.screenshot({ path: ".shots/show-4-drawer.png" });
await m.locator(".sidebar-mobile-close").first().click({ force: true }).catch(() => {});
await m.waitForTimeout(800);

// 5) 手机右栏 sheet
await m.locator('button[aria-controls="file-panel"]').first().click({ force: true }).catch(() => {});
await m.waitForTimeout(1200);
await m.screenshot({ path: ".shots/show-5-sheet.png" });

console.log("ok");
await browser.close();

