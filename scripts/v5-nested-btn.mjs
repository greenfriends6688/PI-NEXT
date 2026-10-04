#!/usr/bin/env node
/* fork:v5-landing —— 找一个非法嵌套的 <button>：打印它的祖先链（一次性的诊断脚本）。 */
import { launchChrome } from "./launch-chrome.mjs";

const APP = process.argv[2] ?? "http://127.0.0.1:30141/";
const browser = await launchChrome();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(APP, { waitUntil: "load" });
await page.waitForTimeout(2500);
await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const row = document.querySelector(".d-sess");
  if (row) { row.click(); await wait(2600); }
});

const chains = await page.evaluate(() => {
  const out = [];
  for (const btn of document.querySelectorAll("button")) {
    if (btn.querySelector("button")) {
      const chain = [];
      let el = btn;
      while (el && el !== document.body) {
        chain.push(`${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ").slice(0, 4).join(".")}`);
        el = el.parentElement;
      }
      out.push(chain.slice(0, 8).join("  <  "));
    }
  }
  return out.slice(0, 6);
});
console.log(chains.join("\n---\n") || "no nested buttons");
await browser.close();