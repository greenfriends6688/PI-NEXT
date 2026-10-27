// 验 19-filetree：切到侧栏「文件」页签（那条路径直接渲染 FileExplorer），读 .tree-row 的几何。
import { chromium } from "playwright";

const id = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:30141/?session=${id}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);

const tab = page.locator("#session-sidebar-tab-files");
if ((await tab.count()) > 0) await tab.click().catch(() => {});
else {
  const toggle = page.locator(".sidebar-files-section-toggle").first();
  for (let i = 0; i < 3; i += 1) {
    if ((await toggle.getAttribute("aria-expanded")) === "true") break;
    await toggle.click({ force: true }).catch(() => {});
    await page.waitForTimeout(400);
  }
}
await page.waitForTimeout(1500);
for (const input of await page.locator(".app-sidebar input").all()) {
  const v = await input.inputValue().catch(() => "");
  if (v) await input.fill("").catch(() => {});
}
await page.waitForTimeout(1200);
await page.screenshot({ path: process.argv[3] ?? ".shots/filetree.png" });

const info = await page.evaluate(() => {
  const rows = document.querySelectorAll(".tree-row");
  const r = rows[1] ?? rows[0];
  const name = r?.querySelector(".tree-row__name");
  const indent = r?.querySelector(".tree-guides");
  return {
    rows: rows.length,
    dirs: document.querySelectorAll(".tree-row.is-dir").length,
    firstRow: r ? { h: Math.round(r.getBoundingClientRect().height), cls: r.className, pad: getComputedStyle(r).paddingLeft } : null,
    nameSize: name ? getComputedStyle(name).fontSize : null,
    indentW: indent ? Math.round(indent.getBoundingClientRect().width) : null,
  };
});
console.log(JSON.stringify(info));
await browser.close();
