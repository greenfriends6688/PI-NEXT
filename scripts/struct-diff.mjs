#!/usr/bin/env node
/* ===========================================================================
 * struct-diff —— 画板 DOM ↔ 产品 DOM 逐节点结构比对（V3 版）
 *
 * 为什么要有它（照搬 V5 的教训）：只验「类名在库里」证明不了「板面那一段在产品里
 * 长这样」。V5 换了 86% 的类，用户打开一看仍与画板不一致 —— 类名对上了，结构没对上。
 * 这个脚本把两边各自归一化成结构签名（标签 + 设计类 + 图标名 + 深度），逐节点 diff：
 *
 *   MISSING  板上有、产品没有      → 照板补 DOM（多半是新增内容）
 *   EXTRA    产品多出来            → 多半根节点选错
 *   CLASS    同一节点 缺[…] 多[…]  → 缺=补类，多=换回板上的类
 *   TAG      板 button ≠ 产品 div  → 换标签，保留类名
 *   ICON     板 chevron-up ≠ 产品 — → 按板抄图标
 *
 * 「设计类」= `app/v3/running.css` 里出现过的类名 + `is-*` / `has-*` 状态类。
 * 产品钩子（app-* / sidebar-* / session-tree-* / 工具类）自然落在集合外，不参与比对。
 * 文本与数据一律不比：板上是样例、产品是真数据。
 *
 * 跑法：
 *   node scripts/struct-diff.mjs scripts/struct-specs/<x>.mjs [--json]
 *
 * spec 形状：
 *   export default {
 *     name: "06 用户气泡",
 *     board: "parts/06-bubble.html",   // design/v3/ 下
 *     boardRoot: ".bubble",
 *     appRoot: ".message-user-bubble",
 *     appScript: `/* 在页面里跑，走到这个面 *\/`,
 *     viewport: { width: 1440, height: 900 },
 *     ignore: ["ic-sm"],               // 无视觉/纯占位
 *   }
 * =========================================================================== */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const APP_URL = process.env.APP_URL || "http://127.0.0.1:30141";

/* 设计词汇：running.css 里出现过的类名 + 状态类 */
const DESIGN_CSS = join(ROOT, "app/v3/running.css");
const designWords = new Set();
/* 注释里出现的 `.foo` 也会被当成设计类（实测：一句解释把 `chat-input-card` 拉进了词表，
   于是产品那层壳被判成「多出来的类」）。先剥注释再扫。 */
const cssSource = readFileSync(DESIGN_CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
for (const m of cssSource.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) designWords.add(m[1]);

const isDesignClass = (c) => designWords.has(c) || c.startsWith("is-") || c.startsWith("has-");

function normalize(root, ignore = []) {
  const ig = new Set(ignore);
  const out = [];
  const walk = (el, depth, path) => {
    const raw = (el.getAttribute("class") || "").split(/\s+/).filter(Boolean);
    const cls = raw.filter((c) => isDesignClass(c) && !ig.has(c)).sort();
    // `.spin` 的内部是 `buildSpinners()` 生成的九宫格 `<i>`；产品侧是 React 组件。
    // 比的是「有一个点阵」，不是它的 9 个格子。
    const isSpin = raw.includes("spin");
    const ico = el.querySelector(":scope > svg use, :scope > i[data-ico], :scope > svg[data-ico]");
    // V3 产品侧图标是 React 组件（内联 <path>），板上是 sprite 的 <use href="#i-x">。
    // 名字只能从板上读；产品侧只认「这个位置有没有图标」。
    const hasSvg = Boolean(el.querySelector(":scope > svg"));
    const icoName = ico
      ? (ico.getAttribute("href") || ico.getAttribute("data-ico") || ico.getAttribute("xlink:href") || "").replace(/^#i-/, "") || null
      : hasSvg ? "@svg" : null;
    out.push({ path, tag: el.tagName.toLowerCase(), cls, ico: icoName, depth });
    if (isSpin) return;
    [...el.children].forEach((k, i) => walk(k, depth + 1, `${path}/${i}`));
  };
  walk(root, 0, "");
  return out;
}

function diff(a, b) {
  const rows = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i], y = b[i];
    if (!y) { rows.push({ kind: "MISSING", at: x.path, depth: x.depth, detail: `${x.tag}.${x.cls.join(".")}` }); continue; }
    if (!x) { rows.push({ kind: "EXTRA", at: y.path, depth: y.depth, detail: `${y.tag}.${y.cls.join(".")}` }); continue; }
    if (x.tag !== y.tag) rows.push({ kind: "TAG", at: x.path, depth: x.depth, detail: `板 ${x.tag} ≠ 产品 ${y.tag}` });
    const missing = x.cls.filter((c) => !y.cls.includes(c));
    const extra = y.cls.filter((c) => !x.cls.includes(c));
    if (missing.length || extra.length) {
      rows.push({ kind: "CLASS", at: x.path, depth: x.depth, detail: `缺 [${missing.join(",")}] 多 [${extra.join(",")}]` });
    }
    const icoDiff = (x.ico === null) !== (y.ico === null)
      || (x.ico && y.ico && x.ico !== "@svg" && y.ico !== "@svg" && x.ico !== y.ico);
    if (icoDiff) rows.push({ kind: "ICON", at: x.path, depth: x.depth, detail: `板 ${x.ico ?? "—"} ≠ 产品 ${y.ico ?? "—"}` });
  }
  return rows;
}

const specPath = process.argv[2];
if (!specPath || !existsSync(resolve(specPath))) {
  console.error("用法：node scripts/struct-diff.mjs scripts/struct-specs/<x>.mjs [--json]");
  process.exit(2);
}
const spec = (await import(pathToFileURL(resolve(specPath)).href)).default;
const asJson = process.argv.includes("--json");

const boardPath = join(ROOT, "design/v3", spec.board);
if (!existsSync(boardPath)) { console.error(`找不到画板：${boardPath}`); process.exit(2); }

const browser = await chromium.launch();
const vp = spec.viewport ?? { width: 1440, height: 900 };

/* ── 板侧 ── */
const bPage = await browser.newPage({ viewport: vp });
await bPage.goto(pathToFileURL(boardPath).href, { waitUntil: "load" });
await bPage.waitForTimeout(300);
if (spec.boardScript) await bPage.evaluate(async (src) => { await new Function(`return (async () => { ${src} })()`)(); }, spec.boardScript);
const boardSig = await bPage.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  return el.outerHTML;
}, spec.boardRoot);

/* ── 产品侧 ── */
const aPage = await browser.newPage({ viewport: vp });
await aPage.goto(spec.appUrl ?? APP_URL, { waitUntil: "load" });
await aPage.waitForTimeout(spec.settleMs ?? 3000);
if (spec.appScript) await aPage.evaluate(async (src) => { await new Function(`return (async () => { ${src} })()`)(); }, spec.appScript);
await aPage.waitForTimeout(spec.settleMs2 ?? 800);
const appHTML = await aPage.evaluate((sel) => {
  const el = document.querySelector(sel);
  return el ? el.outerHTML : null;
}, spec.appRoot);

if (!boardSig) { console.error(`板侧没找到 ${spec.boardRoot}`); process.exit(2); }
if (!appHTML) { console.error(`产品侧没找到 ${spec.appRoot}（先让 spec.appScript 走到这个面）`); process.exit(2); }

const norm = async (html) => {
  const p = await browser.newPage();
  await p.setContent(`<body>${html}</body>`);
  const sig = await p.evaluate(() => {
    const root = document.body.firstElementChild;
    const out = [];
    const walk = (el, depth, path) => {
      const rawCls = el.getAttribute("class") || "";
      out.push({ path, tag: el.tagName.toLowerCase(), clsRaw: rawCls, depth,
        ico: (() => {
          const i = el.querySelector(":scope > svg use, :scope > i[data-ico], :scope > svg[data-ico]");
          if (i) return (i.getAttribute("href") || i.getAttribute("data-ico") || "").replace(/^#i-/, "") || null;
          return el.querySelector(":scope > svg") ? "@svg" : null;
        })() });
      if (rawCls.split(/\s+/).includes("spin")) return;
      [...el.children].forEach((k, i) => walk(k, depth + 1, `${path}/${i}`));
    };
    walk(root, 0, "");
    return out;
  });
  await p.close();
  return sig.map((n) => ({ ...n, cls: n.clsRaw.split(/\s+/).filter(Boolean).filter(isDesignClass).filter((c) => !(spec.ignore ?? []).includes(c)).sort() }));
};

const a = await norm(boardSig);
const b = await norm(appHTML);
const rows = diff(a, b);
await browser.close();

if (asJson) {
  console.log(JSON.stringify({ name: spec.name, board: a.length, app: b.length, dev: rows.length, rows }, null, 1));
} else {
  console.log(`\n${spec.name}`);
  console.log(`板 ${a.length} 节点 / 产品 ${b.length} 节点 · 偏差 ${rows.length}\n`);
  for (const r of rows.slice(0, 60)) console.log(`${r.kind.padEnd(8)} ${"  ".repeat(Math.min(r.depth, 4))}${r.at.padEnd(10)} ${r.detail}`);
  if (rows.length > 60) console.log(`… 还有 ${rows.length - 60} 条`);
}
process.exitCode = rows.length ? 1 : 0;
