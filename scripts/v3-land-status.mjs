#!/usr/bin/env node
/* ===========================================================================
 * V3 落地清单 —— scripts/v3-land-status.mjs
 *
 * 抄 design/v5/scripts/land-status.mjs 的规矩：清单从源码推导，不手写。
 * 四路来源：
 *   ① 部件表      scripts/v3-split-parts.mjs 的 PARTS（部件 → 画板 + 根选择器）
 *   ② 状态表      design/v3/BOARDS.md 的「部件 → 模块 → 状态」
 *   ③ 帧清单      design/v3/frames/manifest.json（画板 → 帧）
 *   ④ 产品源码    components/ app/ hooks/ 里实际出现的类名
 *
 * 跑法：
 *   node scripts/v3-land-status.mjs          # 人读
 *   node scripts/v3-land-status.mjs --json   # 给 CI / 下一轮执行者
 *   node scripts/v3-land-status.mjs --todo   # 只列还要做的
 *
 * 退出码：有「部件声明的状态与源码对不上」时为 1；「还没落地」不是错误。
 * =========================================================================== */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const V3 = join(ROOT, "design/v3");
const JSON_OUT = process.argv.includes("--json");
const TODO = process.argv.includes("--todo");

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");

/* ── ① 部件表：从切图脚本里读，保证与 parts/ 同源 ───────────────────── */
const partsSrc = read(join(ROOT, "scripts/v3-split-parts.mjs"));
const PARTS = [...partsSrc.matchAll(/\[\s*"([0-9a-z-]+)",\s*"([0-9a-z-]+)",\s*"([^"]+)"/g)].map((m) => ({
  id: m[1], board: m[2], selector: m[3],
}));

/* ── ② 状态表：BOARDS.md 的表格行 ──────────────────────────────────── */
const boardsMd = read(join(V3, "BOARDS.md"));
const STATUS = new Map();
for (const line of boardsMd.split("\n")) {
  const m = /^\|\s*`([^`]+)`[^|]*\|([^|]*)\|([^|]*)\|/.exec(line);
  if (!m) continue;
  /* 第一格可能把几个部件写在一行：`08/09-group-head`、`23-search` / `24-palette`、
     `29/30/31-approval/question/attachments`。按两位编号挂，别按全名拼。 */
  const nums = [...m[1].matchAll(/([0-9]{2})(?=[a-z/\-])/g)].map((x) => x[1]);
  const module = m[2].replace(/`/g, "").trim();
  const status = m[3].trim();
  const mark = status.startsWith("✅") ? "done" : status.startsWith("🟡") ? "partial" : status.startsWith("❌") ? "todo" : status.startsWith("⛔") ? "skip" : "?";
  for (const n of nums) STATUS.set(n, { module, status, mark, note: status.replace(/^[^\s]+\s*/, "") });
}

/* ── ③ 帧清单 ──────────────────────────────────────────────────────── */
const manifest = JSON.parse(read(join(V3, "frames/manifest.json")));
const framesByBoard = new Map(manifest.boards.map((b) => [b.target, b]));

/* ── ④ 产品源码里的类 ─────────────────────────────────────────────── */
const SCAN = ["components", "app", "hooks"].map((d) => join(ROOT, d));
const product = new Map();
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!/\.(tsx|ts|css)$/.test(name)) continue;
    const src = read(p).replace(/\/\*[\s\S]*?\*\//g, "");
    const add = (c) => {
      if (!product.has(c)) product.set(c, new Set());
      product.get(c).add(relative(ROOT, p));
    };
    for (const m of src.matchAll(/className\s*=\s*(?:"([^"]*)"|\{`([^`]*)`\}|\{([^}]*)\})/g))
      for (const c of (m[1] || m[2] || m[3] || "").split(/[^A-Za-z0-9_-]+/)) if (c) add(c);
    for (const m of src.matchAll(/\.([a-z][a-z0-9-]*(?:__[a-z0-9-]+)?)/g)) add(m[1]);
  }
}
for (const d of SCAN) if (existsSync(d)) walk(d);

/* ── 画板里某个选择器用到的类（从 boards/*.html 现场读，不猜） ──────── */
const boardCache = new Map();
const boardHtml = (t) => {
  if (!boardCache.has(t)) boardCache.set(t, read(join(V3, "boards", `${t}.html`)));
  return boardCache.get(t);
};
const classesOfSelector = (html, selector) => {
  /* 只要根类：`.side__list` / `.grp-head.is-closed` → 第一个类 */
  const root = selector.split(/\s+/)[0].split(".").filter(Boolean)[0];
  if (!root) return [];
  const used = new Set();
  const re = new RegExp(`class="[^"]*\\b${root}\\b[^"]*"`, "g");
  let m;
  while ((m = re.exec(html))) {
    for (const c of m[0].slice(7, -1).split(/\s+/)) if (c) used.add(c);
  }
  return [...used];
};

/* ── 汇总 ─────────────────────────────────────────────────────────── */
const rows = [];
const errors = [];
for (const part of PARTS) {
  const html = boardHtml(part.board);
  const cls = classesOfSelector(html, part.selector);
  const st = STATUS.get(part.id.slice(0, 2)) ?? { module: "—", status: "（BOARDS.md 没写）", mark: "?" };
  const missing = cls.filter((c) => !product.has(c));
  const frames = framesByBoard.get(part.board);
  rows.push({ ...part, classes: cls, missing, ...st, frames: frames?.frames.length ?? 0, frameSet: frames });
  /* 声明 ✅ 但类在源码里找不到 = 状态表漂了 */
  if (st.mark === "done" && missing.length > 0) {
    errors.push(`${part.id}: BOARDS.md 记 ✅，但 ${missing.join(" ")} 在产品源码里没有`);
  }
}

const bucket = (m) => rows.filter((r) => r.mark === m);
const summary = {
  parts: rows.length,
  done: bucket("done").length,
  partial: bucket("partial").length,
  todo: bucket("todo").length,
  skip: bucket("skip").length,
  frames: manifest.boards.reduce((n, b) => n + b.frames.length, 0),
  framesDesigned: manifest.boards.reduce((n, b) => {
    const t = boardHtml(b.target);
    return n + b.frames.filter((f) => !t.includes(`data-fill="${b.v5}/${f.letter}"`)).length;
  }, 0),
};

if (JSON_OUT) {
  console.log(JSON.stringify({ summary, rows: rows.map(({ frameSet, ...r }) => r), errors }, null, 2));
  process.exitCode = errors.length ? 1 : 0;
} else {
  const pad = (s, n) => (s + " ".repeat(n)).slice(0, n);
  const mark = { done: "✅", partial: "🟡", todo: "❌", skip: "⛔", "?": "？" };
  const show = TODO ? rows.filter((r) => r.mark === "partial" || r.mark === "todo") : rows;
  console.log(`${pad("部件", 22)}${pad("画板", 22)}${pad("模块", 34)}状态  缺的类`);
  for (const r of show) {
    console.log(
      pad(r.id, 22) + pad(r.board, 22) + pad(r.module || "—", 34) +
      mark[r.mark] + "  " + (r.missing.length ? r.missing.slice(0, 4).join(" ") : ""),
    );
  }
  console.log(
    `\n部件 ${summary.parts}：✅${summary.done} 🟡${summary.partial} ❌${summary.todo} ⛔${summary.skip}` +
    ` · 帧 ${summary.framesDesigned}/${summary.frames} 已设计`,
  );
  if (errors.length) {
    console.log("\n状态表与源码对不上：");
    for (const e of errors) console.log("  ✗ " + e);
  }
  process.exitCode = errors.length ? 1 : 0;
}
