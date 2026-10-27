// v3-buttons-audit —— 画板每帧的按钮/控件清单 vs 产品实际渲染。
//
// 目的：把「按钮和功能对不上」变成可核对的清单。
//   node scripts/v3-buttons-audit.mjs boards        # 只列画板侧（全部帧）
//   node scripts/v3-buttons-audit.mjs app           # 只列产品侧（当前空态）
//   node scripts/v3-buttons-audit.mjs compare       # 并排 + 差集（画板并集 vs 产品集）
import { chromium } from "playwright";
import { readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = process.cwd();
const mode = process.argv[2] ?? "boards";
const filter = process.argv[3] ?? "";

const collectScript = () => {
  const label = (el) => {
    const t = el.getAttribute("title") || "";
    const a = el.getAttribute("aria-label") || "";
    const txt = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 24);
    return { title: t, aria: a, text: txt };
  };
  const icon = (el) => {
    const use = el.querySelector("use");
    if (use) return (use.getAttribute("href") || "").replace("#i-", "");
    const img = el.querySelector("img");
    return img ? `img:${img.getAttribute("src") || ""}` : "";
  };
  const cls = (el) => (typeof el.className === "string" ? el.className.trim() : "");
  const nodes = [...document.querySelectorAll("button, [role=button], input, textarea, select")];
  return nodes
    .filter((el) => el.offsetParent !== null || el.getClientRects().length > 0)
    .map((el) => ({ tag: el.tagName.toLowerCase(), cls: cls(el), icon: icon(el), ...label(el) }));
};

const browser = await chromium.launch();

if (mode === "boards" || mode === "compare") {
  const boardDir = path.join(root, "design/v3/boards");
  const files = readdirSync(boardDir).filter((f) => f.endsWith(".html") && f.includes(filter));
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  const out = {};
  for (const file of files) {
    await page.goto(pathToFileURL(path.join(boardDir, file)).href, { waitUntil: "load" });
    await page.waitForTimeout(250);
    const frames = await page.evaluate(() => {
      const res = [];
      const nodes = document.querySelectorAll(".frame");
      nodes.forEach((frame, i) => {
        const lab = frame.querySelector(".frame__label b");
        const name = lab ? lab.textContent.trim() : `frame${i}`;
        const buttons = [...frame.querySelectorAll("button, [role=button], input, textarea, select")]
          .filter((el) => el.getClientRects().length > 0)
          .map((el) => {
            const t = el.getAttribute("title") || "";
            const a = el.getAttribute("aria-label") || "";
            const txt = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 24);
            const use = el.querySelector("use");
            const ic = use ? (use.getAttribute("href") || "").replace("#i-", "") : "";
            const c = typeof el.className === "string" ? el.className.trim() : "";
            return { tag: el.tagName.toLowerCase(), cls: c, icon: ic, title: t, aria: a, text: txt };
          });
        res.push({ frame: name, count: buttons.length, buttons });
      });
      return res;
    });
    out[file] = frames;
  }
  console.log(JSON.stringify(out, null, 1));
}

if (mode === "app" || mode === "compare") {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(process.env.APP_URL || "http://127.0.0.1:30141/", { waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(2500);
  const buttons = await page.evaluate(collectScript);
  console.error("### APP BUTTONS ###");
  console.log(JSON.stringify(buttons, null, 1));
}

await browser.close();
