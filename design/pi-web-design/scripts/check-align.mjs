// 量测：图标与相邻文字的垂直中心偏差。
// 用法：node scripts/check-align.mjs [文件...]   （不带参数则全量）
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { launchChrome } from "../../../scripts/launch-chrome.mjs";

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(DIR).filter((f) => f.endsWith(".html")).sort();

// 容差 1px：单行行（图标 + 文字）实测能到 0–0.25px；
// 折行的提示条在 1500px 视口下会有 1px 的亚像素取整抖动，属于渲染噪声。
const TOL = 1.0;

const browser = await launchChrome();
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });

let total = 0;
for (const f of files) {
  await page.goto(pathToFileURL(join(DIR, f)).href, { waitUntil: "load" });
  await page.waitForTimeout(350);
  const bad = await page.evaluate((tol) => {
    const out = [];
    const seen = new Set();
    for (const ico of document.querySelectorAll(".pw-ico")) {
      const svg = ico.querySelector("svg");
      if (!svg) continue;
      const parent = ico.parentElement;
      if (!parent) continue;
      // 只在「同一个 flex/inline 行里既有图标又有文字」时比较
      const ir = svg.getBoundingClientRect();
      if (!ir.height) continue;

      let textRect = null, blockRect = null, label = "";
      for (const node of parent.childNodes) {
        if (node === ico) continue;
        const t = node.nodeType === 3 ? node.textContent.trim() : (node.textContent || "").trim();
        if (!t) continue;
        if (node.nodeType === 1 && node.querySelector("svg")) continue;
        const r = document.createRange();
        r.selectNodeContents(node);
        const rects = r.getClientRects();
        if (!rects.length || !rects[0].height) continue;
        // 首行盒：图标对齐「首行」是合法目标（提示条这类）
        textRect = rects[0];
        // 整块：图标对齐「整块中心」也是合法目标（标题 + 副标题的列表行）
        blockRect = r.getBoundingClientRect();
        label = t;
        break;
      }
      if (!textRect || !blockRect) continue;

      // 纵向完全不重叠 = 图标在上、文字在下（堆叠布局），不是「图标 + 文字」的同一行。
      // 拖放落区、空态、spinner + 文案都是这种，它们本来就该是上下关系，不该按同排量。
      if (ir.bottom <= textRect.top + 1 || ir.top >= textRect.bottom - 1) continue;

      const icoCenter = ir.top + ir.height / 2;
      const dFirst = icoCenter - (textRect.top + textRect.height / 2);
      const dBlock = icoCenter - (blockRect.top + blockRect.height / 2);
      // 两个目标里命中任意一个就算对齐——否则才是真错位
      const best = Math.abs(dFirst) <= Math.abs(dBlock) ? dFirst : dBlock;
      if (Math.abs(best) > tol) {
        const key = label.slice(0, 20) + "|" + best.toFixed(1);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ label: label.slice(0, 30), delta: +best.toFixed(2), multi: textRect.height !== blockRect.height });
      }
    }
    return out;
  }, TOL);

  if (bad.length) {
    total += bad.length;
    console.log(`\n✗ ${f} —— ${bad.length} 处偏差 > ${TOL}px`);
    for (const b of bad.slice(0, 12)) console.log(`   ${b.delta > 0 ? "图标偏低" : "图标偏高"} ${String(b.delta).padStart(6)}px  「${b.label}」`);
  }
}

console.log(`\n合计 ${total} 处偏差（容差 ${TOL}px）`);
await browser.close();
process.exit(total ? 1 : 0);
