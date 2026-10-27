import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const log = [];
page.on("response", (res) => {
  if (!res.url().includes("type=list")) return;
  const p = res.json().then((d) => log.push(`${res.status()} n=${d?.entries?.length} ${decodeURIComponent(res.url().slice(res.url().indexOf("/api")))}`)).catch(() => log.push(`${res.status()} unparsed`));
  void p;
});
await page.goto("http://127.0.0.1:30141/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await page.goto(`http://127.0.0.1:30141/?session=${process.argv[2]}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
console.log(log.join("\n"));
console.log(JSON.stringify(await page.evaluate(() => ({ rows: document.querySelectorAll(".tree-row").length, txt: document.querySelector(".sidebar-files-body")?.innerText.replace(/\s+/g," ").slice(0,60) }))));
await browser.close();
