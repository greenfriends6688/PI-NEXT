// 诊断侧栏文件区为什么是「未找到文件」。
import { chromium } from "playwright";

const id = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:30141/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await page.goto(`http://127.0.0.1:30141/?session=${id}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);

const toggle = page.locator(".sidebar-files-section-toggle").first();
if ((await toggle.getAttribute("aria-expanded")) === "false") {
  await toggle.click({ force: true }).catch(() => {});
  await page.waitForTimeout(2500);
}

const info = await page.evaluate(() => {
  const sec = document.querySelector(".sidebar-files-section");
  const rows = [...document.querySelectorAll(".tree-row")].slice(0, 6).map((r) => r.innerText.replace(/\s+/g, " ").slice(0, 24));
  return {
    expanded: sec?.querySelector(".sidebar-files-section-toggle")?.getAttribute("aria-expanded"),
    bodyText: (sec?.querySelector(".sidebar-files-body")?.innerText ?? "").replace(/\s+/g, " ").slice(0, 160),
    rows,
    rowCount: document.querySelectorAll(".tree-row").length,
    hint: document.querySelector(".file-tree-message, .tree-message, [class*=empty]")?.className ?? null,
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
