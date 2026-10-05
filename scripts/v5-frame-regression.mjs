#!/usr/bin/env node
/* ===========================================================================
 * fork:v5-landing —— **帧级落地回归检查器**
 *
 * 为什么要有它（用户 2026-10-05 要求「每一帧都落到产品 DOM」「自己测试好」）：
 *   类级门禁（land-status）只数「这个类在产品里出现过没有」，**数不出「这一帧在不在」**。
 *   而历史三次翻车恰恰是「类都在、帧不对」。所以这里按**帧**判定：
 *
 *   口径：对每一帧，取该帧里出现的形态类（d-* / m-*，去掉画板家具），
 *        逐个到产品源码（components/ app/ hooks/ lib/）里找**字面出现**。
 *        一帧里「一个都没落地」= 该帧未落地；「部分落地」= 列出还差哪些。
 *   这是**存在性**判定，不是几何对位（几何对位是 board-diff 的活）——
 *   两者互补：这里管「有没有」，board-diff 管「像不像」。
 *
 * 跑法：
 *   node scripts/v5-frame-regression.mjs            # 人读的汇总
 *   node scripts/v5-frame-regression.mjs --json     # 机读（给 CI / 早上对账）
 *   node scripts/v5-frame-regression.mjs --only D-03 # 只看某张板
 *
 * 退出码：0 = 全部帧至少部分落地；1 = 有整帧零落地（真的漏了）。
 * =========================================================================== */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BOARD_FURNITURE } from "../design/v5/scripts/furniture.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const V5 = join(ROOT, "design", "v5");
const JSON_OUT = process.argv.includes("--json");
const onlyIdx = process.argv.indexOf("--only");
const ONLY = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;

/* 画板家具 / 纯说明性类：不计入「这一帧有没有落地」的判定。
   名单唯一来源 design/v5/scripts/furniture.mjs（land-status 用同一份）。 */
const FURNITURE = BOARD_FURNITURE;

/* ── 产品源码全文（一次读入，后面全是正则）──────────────────────────── */
let product = "";
const SCAN = ["components", "app", "hooks", "lib"];
function walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (!/node_modules|\.next/.test(p)) walk(p); }
    else if (/\.(tsx|ts)$/.test(name) && !/\.test\.(mjs|ts)$/.test(name)) {
      product += readFileSync(p, "utf8") + "\n";
    }
  }
}
for (const d of SCAN) walk(join(ROOT, d));

/* ── 逐帧判定 ───────────────────────────────────────────────────────── */
const rows = [];
for (const form of ["web", "pwa"]) {
  const dir = join(V5, form, "boards");
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".html")).sort()) {
    if (ONLY && !file.includes(ONLY)) continue;
    const html = readFileSync(join(dir, file), "utf8");
    /* 以帧标签切分：每一段就是一个帧的取景（含它后面到下一帧之间的全部 DOM） */
    const parts = html.split(/<div class="[dm]-frame-label">/);
    parts.slice(1).forEach((seg, i) => {
      const classes = [...seg.matchAll(/class="([^"]*)"/g)]
        .flatMap((m) => m[1].split(/\s+/))
        .filter((c) => /^[dm]-[a-z0-9-]+$/.test(c))
        .filter((c) => !FURNITURE.has(c));
      const uniq = [...new Set(classes)];
      /* 产品里字面出现过 = 已接线。
       * 类名在 JSX 里常紧贴模板字面量（如 `chat-slot pw-main d-main${x}`），
       * 所以边界符要把反引号/$/{ 都算进去，否则 d-main 会被误报成「没接」。 */
      const landed = uniq.filter((c) =>
        new RegExp(`(^|[\\s"'\`{}$(])(${c})(?=$|[\\s"'\`}$):;,\\]])`, "m").test(product));
      const missing = uniq.filter((c) => !landed.includes(c));
      /* 帧标签里的中文说明，顺手抓出来当这一帧的标题 */
      const label = (seg.match(/^[^>]*><b>([^<]*)<\/b>([^<]*)/) || []);
      rows.push({
        board: file.replace(/\.html$/, ""),
        form,
        frame: i + 1,
        title: `${label[1] ?? ""}${label[2] ?? ""}`.trim().slice(0, 40),
        total: uniq.length,
        landed: landed.length,
        missing,
        zero: landed.length === 0,
      });
    });
  }
}

const zeroFrames = rows.filter((r) => r.zero);
const partial = rows.filter((r) => !r.zero && r.missing.length > 0);
const full = rows.filter((r) => !r.zero && r.missing.length === 0);
const pct = rows.length ? Math.round(((full.length + partial.length * 0.5) / rows.length) * 100) : 0;

if (JSON_OUT) {
  console.log(JSON.stringify({
    total: rows.length, full: full.length, partial: partial.length, zero: zeroFrames.length,
    score: pct, zeroFrames, partial,
  }, null, 2));
} else {
  console.log(`帧级落地：${rows.length} 帧 · 完全 ${full.length} · 部分 ${partial.length} · 零落地 ${zeroFrames.length}（加权 ${pct}%）\n`);
  if (zeroFrames.length) {
    console.log("── 整帧未落地 ──");
    for (const r of zeroFrames) console.log(`  ✗ ${r.board} 帧${r.frame} ${r.title}`);
    console.log("");
  }
  if (partial.length) {
    console.log("── 部分落地（还差这些类）──");
    for (const r of partial.sort((a, b) => b.missing.length - a.missing.length).slice(0, 25)) {
      console.log(`  · ${r.board} 帧${r.frame}  ${r.landed}/${r.total}  缺: ${r.missing.slice(0, 8).join(" ")}`);
    }
  }
}

process.exit(zeroFrames.length ? 1 : 0);