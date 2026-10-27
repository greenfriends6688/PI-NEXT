import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const seen = [];
page.on("response", async (res) => {
  if (!res.url().includes("/api/files")) return;
  let body = "";
  try { body = (await res.text()).slice(0, 300); } catch {}
  seen.push(`${res.status()} ${decodeURIComponent(res.url().slice(res.url().indexOf("/api")))} -> ${body}`);
});
await page.goto("http://127.0.0.1:30141/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.goto(`http://127.0.0.1:30141/?session=${process.argv[2]}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);
console.log(seen.slice(0, 3).join("\n---\n"));
const info = await page.evaluate(() => ({
  msg: [...document.querySelectorAll(".sidebar-files-body *")].map((e) => (e.textContent || "").trim()).filter(Boolean).slice(0, 6),
  cls: [...document.querySelectorAll(".sidebar-files-body *")].map((e) => e.className).filter(Boolean).slice(0, 8),
}));
console.log(JSON.stringify(info));
await browser.close();
