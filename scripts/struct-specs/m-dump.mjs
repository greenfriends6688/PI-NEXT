// 窄屏产品 DOM 骨架 dump（调试用）：node scripts/struct-specs/m-dump.mjs <rootSel> [script]
// 视口固定 390×844（手机档），需要别的档位用 APP_W/APP_H 覆盖。
import { launchChrome } from "../launch-chrome.mjs";
const APP_URL = process.env.APP_URL || "http://127.0.0.1:30141";
const rootSel = process.argv[2] || "body";
const script = process.argv[3] || "";
const w = Number(process.env.APP_W || 390);
const h = Number(process.env.APP_H || 844);
const b = await launchChrome();
const p = await b.newPage({ viewport: { width: w, height: h } });
await p.goto(APP_URL, { waitUntil: "load" });
await p.waitForTimeout(4000);
if (script.trim()) {
  await p.evaluate(async (src) => { const fn = new Function(`return (async () => { ${src} })()`); await fn(); }, script);
  await p.waitForTimeout(1500);
}
const out = await p.evaluate((rootSel) => {
  const el = document.querySelector(rootSel);
  if (!el) return "NOT FOUND " + rootSel;
  const lines = [];
  const walk = (n, d) => {
    const cls = (n.className || "").toString().split(/\s+/).filter(Boolean).join(".");
    lines.push("  ".repeat(d) + n.tagName.toLowerCase() + (cls ? "." + cls : "") + (n.getAttribute("data-ico") ? ` [ico=${n.getAttribute("data-ico")}]` : ""));
    [...n.children].forEach((c) => walk(c, d + 1));
  };
  walk(el, 0);
  return lines.join("\n");
}, rootSel);
console.log(out);
await b.close();