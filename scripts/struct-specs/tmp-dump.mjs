// 临时：打印产品 DOM 骨架（调试用）
// 用法：node scripts/struct-specs/tmp-dump.mjs <rootSel> [script] [width] [height]
import { launchChrome } from "../launch-chrome.mjs";
const APP_URL = process.env.APP_URL || "http://127.0.0.1:30141";
const rootSel = process.argv[2] || "body";
const script = process.argv[3] || "";
const width = Number(process.argv[4] || 1440);
const height = Number(process.argv[5] || 900);
const b = await launchChrome();
const p = await b.newPage({ viewport: { width, height } });
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
    if (d > 12) return;
    const cls = (n.className || "").toString().split(/\s+/).filter(Boolean).join(" ");
    lines.push("  ".repeat(d) + n.tagName.toLowerCase() + (cls ? "." + cls.split(" ").join(".") : "") + (n.getAttribute("data-ico") ? ` [ico=${n.getAttribute("data-ico")}]` : ""));
    [...n.children].forEach((c) => walk(c, d + 1));
  };
  walk(el, 0);
  return lines.join("\n");
}, rootSel);
console.log(out);
await b.close();