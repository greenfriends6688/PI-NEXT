import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:30141/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
const out = await page.evaluate(async () => {
  const enc = (p) => p.split("/").map(encodeURIComponent).join("/");
  const url = `/api/files/${enc("C:/Users/Administrator/Desktop/PI-NEXT")}?type=list`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  return { url, status: res.status, keys: Object.keys(data), entries: data.entries?.length ?? null, first: data.entries?.[0]?.name ?? null };
});
console.log(JSON.stringify(out));
await browser.close();
