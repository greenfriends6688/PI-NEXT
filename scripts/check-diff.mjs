// 验证 diff 行：点开一个 edit/write 步骤，把那一步截图下来对照 parts/18-diff。
import { chromium } from "playwright";

const id = process.argv[2];
const out = process.argv[3] ?? ".shots/diff-part.png";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:30141/?session=${id}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);

const target = page.locator(".steps .step").filter({ has: page.locator(".step__verb") }).last();
// 找一个 edit / write 的步骤（只有它们带 diff）
const handles = await page.locator(".steps .step").all();
let picked = null;
for (const h of handles.reverse()) {
  const verb = (await h.locator(".step__verb").first().textContent().catch(() => "")) ?? "";
  if (/edit|write|Edit|Write/i.test(verb)) { picked = h; break; }
}
if (picked) {
  await picked.locator(".step__btn").first().click().catch(() => {});
  await page.waitForTimeout(600);
  await picked.screenshot({ path: out }).catch(async () => { await page.screenshot({ path: out }); });
} else {
  await page.screenshot({ path: out });
}
const info = await page.evaluate(() => {
  const lines = document.querySelectorAll(".dline");
  const first = lines[0];
  return {
    dlineCount: lines.length,
    add: document.querySelectorAll(".dline.add").length,
    del: document.querySelectorAll(".dline.del").length,
    hunk: document.querySelectorAll(".dline.hunk").length,
    firstLine: first ? { cls: first.className, h: Math.round(first.getBoundingClientRect().height) } : null,
  };
});
console.log(JSON.stringify(info));
await browser.close();
