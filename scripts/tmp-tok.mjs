import { launchChrome } from "./launch-chrome.mjs";
const browser = await launchChrome();
const page = await browser.newPage();
await page.goto("http://127.0.0.1:30141", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
console.log(await page.evaluate(() => {
  const cs = getComputedStyle(document.body);
  const keys = ["--bg", "--terminal-surface", "--terminal-text", "--ansi-white", "--ansi-black", "--ansi-blue", "--n-strong", "--n-text"];
  const o = {};
  for (const k of keys) o[k] = cs.getPropertyValue(k).trim();
  o.theme = document.documentElement.getAttribute("data-theme");
  return o;
}));
await browser.close();
