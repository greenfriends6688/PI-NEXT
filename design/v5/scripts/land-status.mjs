#!/usr/bin/env node
/* ===========================================================================
 * 落地清单生成器 —— design/v5/scripts/land-status.mjs
 *
 * 「我说一句话你就启动所有改版」要成立，缺的不是决心，是一份**不靠人记**的清单。
 * 这份清单全部从源码推导，不手写对应表（手写的会漂，漂了就回到「两套东西」）。
 *
 * 跑法：
 *   node design/v5/scripts/land-status.mjs            # 人读的清单
 *   node design/v5/scripts/land-status.mjs --json     # 给 AI / CI 读
 *   node design/v5/scripts/land-status.mjs --batch    # 按批次分组（落地时的执行顺序）
 *
 * 四路推导：
 *   ① 画板用了哪些类（按画板列）
 *   ② 库里定义了哪些类（双向可查的反向）
 *   ③ 产品（components/ app/）里出现了哪些 d-/m- 类 = 已经落地的
 *   ④ 差集 = 落地队列（这是唯一需要人做的事的清单）
 *
 * 退出码：默认只在**错误**（画板用了库里没有的类、README 清单缺画板）为 1；
 * 「还没落地」不是错误 —— 那正是它要报告的东西。
 * =========================================================================== */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { BOARD_FURNITURE } from "./furniture.mjs";

const V5 = dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, "");
const ROOT = join(V5, "..", "..");
const JSON_OUT = process.argv.includes("--json");
const BATCH = process.argv.includes("--batch");

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const classesIn = (css, prefixes) =>
  new Set([...css.matchAll(/(?<![\d])\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]).filter((c) => prefixes.some((x) => c.startsWith(x))));

/* ── 画板 ─────────────────────────────────────────────────────────────── */
const boards = [];
for (const form of ["web", "pwa"]) {
  const dir = join(V5, form, "boards");
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".html")).sort()) {
    const html = read(join(dir, f));
    const used = new Set();
    for (const m of html.matchAll(/class="([^"]*)"/g)) {
      for (const c of m[1].split(/\s+/).filter(Boolean)) if (/^[dm]-/.test(c)) used.add(c);
    }
    boards.push({ form, file: f, id: f.replace(/\.html$/, ""), used });
  }
}

/* ── 库 ───────────────────────────────────────────────────────────────── */
const libCss = {
  web: read(join(V5, "web", "system.css")) + read(join(V5, "web", "tokens.css")),
  pwa: read(join(V5, "pwa", "system.css")) + read(join(V5, "pwa", "tokens.css")),
};
const libBase = read(join(V5, "base.css"));
const lib = {
  web: classesIn(libCss.web, ["d-"]) ,
  pwa: classesIn(libCss.pwa, ["m-"]) ,
  base: classesIn(libBase, ["d-", "m-", "nx-"]),
};

/* ── 产品里已落地的类 ─────────────────────────────────────────────────── */
/* 只扫源码目录：components/ app/ hooks/。className 里出现的 d-/m- 才算落地。 */
const SCAN_DIRS = ["components", "app", "hooks"].map((d) => join(ROOT, d));
const product = new Map(); // class -> [文件…]
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(tsx|ts|css)$/.test(name)) {
      /* 注释里的类名不算落地：JSX 注释里提到 `.m-row-x`、块注释里提到 `.m-col`
         都只是说明文字，不渲染。不剥掉它们，漂移清单会永远挂着两条假警报。 */
      const src = read(p).replace(/\/\*[\s\S]*?\*\//g, "");
      for (const m of src.matchAll(/className\s*=\s*(?:"([^"]*)"|\{`([^`]*)`\}|\{([^}]*)\})/g)) {
        for (const c of (m[1] || m[2] || m[3] || "").matchAll(/\b([dm]-[a-z0-9-]+)/g)) {
          const cls = m2(c);
          if (!product.has(cls)) product.set(cls, new Set());
          product.get(cls).add(relative(ROOT, p));
        }
      }
      /* CSS 里的类选择器也算（双类覆盖 0-2-0 的那种） */
      for (const m of src.matchAll(/\.([dm]-[a-z0-9-]+)/g)) {
        const cls = m[1];
        if (!product.has(cls)) product.set(cls, new Set());
        product.get(cls).add(relative(ROOT, p));
      }
      /* 引号里的类名也算：有些形态类不走 JSX 的 className，而是走查表 ——
         `cellClass()` 返回 `"d-heat-grid l1"`、`BOARD_TOKEN_CLASS_PWA` 的值是
         `"m-tok-com"`。不认这种写法，它们就永远是「未落地」（帧级检查早已认，
         两处口径不一致本身就是bug）。 */
      for (const m of src.matchAll(/["'`]([dm]-[a-z0-9-]+)["'`]/g)) {
        const cls = m[1];
        if (!product.has(cls)) product.set(cls, new Set());
        product.get(cls).add(relative(ROOT, p));
      }
    }
  }
}
const m2 = (c) => c[1];
for (const d of SCAN_DIRS) if (existsSync(d)) walk(d);

/* ── 差集 ─────────────────────────────────────────────────────────────── */
const errors = [];
const rows = [];
const usedByBoards = new Map(); // class -> [boardId]
for (const b of boards) {
  for (const c of b.used) {
    if (!usedByBoards.has(c)) usedByBoards.set(c, []);
    usedByBoards.get(c).push(b.id);
  }
}
for (const b of boards) {
  const missing = [...b.used].filter((c) => !(lib[b.form].has(c) || lib.base.has(c)));
  if (missing.length) errors.push(`${b.file}: 用了库里没有的类 ${missing.join(" ")}`);
  /* 家具不是产品 DOM：只算它进「画板用了什么」的账（死类判定要用），不进落地率。
     口径与 scripts/v5-frame-regression.mjs 完全一致，名单唯一来源 furniture.mjs。 */
  const productClasses = [...b.used].filter((c) => !BOARD_FURNITURE.has(c));
  const landed = productClasses.filter((c) => product.has(c));
  rows.push({
    id: b.id,
    form: b.form,
    classes: productClasses.length,
    landed: landed.length,
    furniture: [...b.used].filter((c) => BOARD_FURNITURE.has(c)).sort(),
    todo: productClasses.filter((c) => !product.has(c)).sort(),
    landedIn: [...new Set(landed.flatMap((c) => [...product.get(c)]))].sort(),
  });
}

const deadClasses = [];
for (const form of ["web", "pwa"]) {
  for (const c of lib[form]) {
    if (usedByBoards.has(c)) continue;
    if (lib.base.has(c)) continue;
    deadClasses.push(`${form}:${c}`);
  }
}
const driftClasses = [...product.keys()].filter((c) => !lib.web.has(c) && !lib.pwa.has(c) && !lib.base.has(c)).sort();

const readme = read(join(V5, "README.md"));
for (const b of boards) if (readme && !readme.includes(b.file)) errors.push(`README.md 清单缺画板 ${b.file}`);

/* ── 输出 ─────────────────────────────────────────────────────────────── */
if (JSON_OUT) {
  console.log(JSON.stringify({ boards: rows, deadClasses, driftClasses, errors }, null, 2));
  process.exit(errors.length ? 1 : 0);
}

const pct = (n, d) => (d ? Math.round((n / d) * 100) : 100);
const total = rows.reduce((a, r) => a + r.classes, 0);
const done = rows.reduce((a, r) => a + r.landed, 0);

if (BATCH) {
  console.log(`落地队列（${rows.filter((r) => r.todo.length).length} 张画板未完成，共 ${total - done} 个类）\n`);
  for (const r of rows.filter((x) => x.todo.length)) {
    console.log(`▸ ${r.id}  [${r.form}]  ${r.landed}/${r.classes} 类已落地`);
    if (r.landedIn.length) console.log(`  触达产品文件：${r.landedIn.join(", ")}`);
    console.log(`  待落地类：${r.todo.join(" ")}`);
    console.log("");
  }
} else {
  console.log(`落地进度：${done}/${total} 个类（${pct(done, total)}%） · 画板 ${rows.length} 张\n`);
  for (const r of rows) {
    const bar = "█".repeat(Math.round((r.landed / r.classes) * 10)).padEnd(10, "·");
    console.log(`${bar} ${pct(r.landed, r.classes).toString().padStart(3)}%  ${r.id.padEnd(34)} ${r.landed}/${r.classes} 类`);
  }
  console.log(`\n库里定义了但没有画板在用（死类，逐条清或补画板）：${deadClasses.length ? "" : "0"}`);
  for (const c of deadClasses) console.log(`  · ${c}`);
  console.log(`\n产品里出现但库里没有的类（拼写漂移 / 历史拷贝）：${driftClasses.length ? "" : "0"}`);
  for (const c of driftClasses) console.log(`  · ${c}`);
}

if (errors.length) {
  console.log(`\n错误 ${errors.length} 条：`);
  for (const e of errors) console.log("  × " + e);
  process.exit(1);
}
console.log(`\n跑法：node design/v5/scripts/land-status.mjs --batch  → 按批次拿执行顺序`);