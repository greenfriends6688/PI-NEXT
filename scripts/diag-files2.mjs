// 诊断侧栏文件区：展开后抓 /api/files 请求与错误。
import { chromium } from "playwright";

const id = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const reqs = [];
page.on("response", async (res) => {
  const url = res.url();
  if (!url.includes("/api/files") && !url.includes("/api/git")) return;
  let body = "";
  try { body = (await res.text()).slice(0, 160); } catch {}
  reqs.push(`${res.status()} ${decodeURIComponent(url.slice(url.indexOf("/api")))} :: ${body}`);
});
page.on("pageerror", (e) => reqs.push("pageerror: " + e.message.slice(0, 120)));

await page.goto("http://127.0.0.1:30141/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await page.goto(`http://127.0.0.1:30141/?session=${id}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);

const toggle = page.locator(".sidebar-files-section-toggle").first();
for (let i = 0; i < 3; i += 1) {
  if ((await toggle.getAttribute("aria-expanded")) === "true") break;
  await toggle.click({ force: true }).catch(() => {});
  await page.waitForTimeout(600);
}
await page.waitForTimeout(2500);

const info = await page.evaluate(() => {
  const sec = document.querySelector(".sidebar-files-section");
  return {
    expanded: sec?.querySelector(".sidebar-files-section-toggle")?.getAttribute("aria-expanded"),
    childCount: sec?.children.length,
    text: sec?.innerText.replace(/\s+/g, " ").slice(0, 200),
  };
});
console.log(JSON.stringify(info));
console.log(reqs.slice(-10).join("\n"));
await browser.close();
