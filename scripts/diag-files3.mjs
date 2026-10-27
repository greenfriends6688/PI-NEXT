import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const reqs = [];
page.on("request", (r) => { if (r.url().includes("/api/files")) reqs.push(decodeURIComponent(r.url().slice(r.url().indexOf("/api")))); });
await page.goto("http://127.0.0.1:30141/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.goto(`http://127.0.0.1:30141/?session=${process.argv[2]}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);
const info = await page.evaluate(() => {
  const body = document.querySelector(".sidebar-files-body");
  const panel = document.querySelector(".sidebar-files-panel");
  return {
    body: body ? { hidden: body.hidden, children: body.children.length, text: body.innerText.replace(/\s+/g, " ").slice(0, 120) } : null,
    panelHidden: panel?.hidden ?? null,
    picker: [...document.querySelectorAll(".sidebar-files-head button")].map((b) => (b.textContent || "").trim().slice(0, 30)).slice(0, 4),
  };
});
console.log(JSON.stringify(info));
console.log("files requests:", reqs.slice(0, 4));
await browser.close();
