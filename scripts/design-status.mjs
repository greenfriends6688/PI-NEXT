// 设计体系状态报告 —— 「一句话启动改版」的机器可读入口。
//
// 为什么需要它：落地契约（design/pi-web-design/LANDING.md）要求「先拿清单，不凭记忆」。
// 之前画板与产品的对应关系只存在于人脑和一份 2026-09-29 的日期文档里，
// 于是「哪些画板还没落进产品」每次都靠重新盘点 —— 这就是漂移的来源。
//
// 本脚本把四件事变成可机读：
//   1. 画板清单与分组（web 00–69 / pwa 70–89 / core 90–99）
//   2. 每张画板有没有 live 几何对位 spec（scripts/board-specs/*.mjs）
//   3. `pw-*` 类双向可查（判据⑦）：画板用到的必须都在 board.css；board.css 定义的必须有画板在用
//   4. 每张画板的 `pw-*` 类落在哪些产品文件里（宿主映射，自动推导，不手写）
//
// 用法：
//   node scripts/design-status.mjs              人类可读报告
//   node scripts/design-status.mjs --json       机器可读（给 AI / CI）
//   node scripts/design-status.mjs --strict     有 error 即退出码 1（默认就是）
//
// 判定：error（画板用了 board.css 没定义的类、画板文件缺失）必须为 0；
//       warn（board.css 定义但没画板在用、有画板无 spec、有类无宿主）是待办队列，不阻塞。

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DESIGN = join(ROOT, "design/pi-web-design");
const ASSETS = join(DESIGN, "assets");
const SPEC_DIR = join(ROOT, "scripts/board-specs");

const asJson = process.argv.includes("--json");

/* ── 工具 ───────────────────────────────────────────────────────────── */

/** 从 HTML 的 class="..." 属性里取 pw-* 类名。
 *  只认 class 属性 —— 正文里提到类名（如「旧的三帧 .pw-stats 已删除」）不算使用，
 *  否则报告里全是假阳性，工具就没人信了（这正是它要防的那类问题）。 */
function pwClassesFromHtml(src) {
  const out = new Set();
  for (const m of src.matchAll(/class="([^"]*)"/g)) {
    for (const c of m[1].matchAll(/\bpw-[a-z0-9-]+/g)) out.add(c[0]);
  }
  return out;
}

/** 从 CSS 里取 `.pw-*` **类选择器**。
 *  不取 `@keyframes pw-sweep` 与 `animation: pw-sweep` —— 那些是动画名不是类名。 */
function pwClassesFromCss(src) {
  return new Set([...src.matchAll(/\.(pw-[a-z0-9-]+)/g)].map((m) => m[1]));
}

/** 从 TS/TSX 里取 pw-* 类名：先剥注释，再取词。 */
function pwClassesFromTs(src) {
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  return new Set([...stripped.matchAll(/\bpw-[a-z0-9-]+/g)].map((m) => m[0]));
}

/** 递归收集匹配后缀的文件。 */
function walk(dir, exts, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

/** 按编号前缀判断画板属于哪一组。 */
function setOf(id) {
  const n = Number(id.slice(0, 2));
  if (!Number.isFinite(n)) return "core";
  if (n <= 69) return "web";
  if (n <= 89) return "pwa";
  return "core";
}

/* ── 1. 画板清单 ────────────────────────────────────────────────────── */

const boardFiles = readdirSync(DESIGN)
  .filter((f) => f.endsWith(".html") && f !== "index.html")
  .sort();

const boards = boardFiles.map((file) => {
  const id = file.replace(/\.html$/, "");
  return { id, file, set: setOf(id), classes: pwClassesFromHtml(readFileSync(join(DESIGN, file), "utf8")) };
});

/* ── 2. board.css 定义的 pw-* ───────────────────────────────────────── */

const boardCss = readFileSync(join(ASSETS, "board.css"), "utf8");
const definedInBoardCss = pwClassesFromCss(boardCss);

/* ── 3. 产品里用到的 pw-*（以及宿主文件）─────────────────────────────── */

const productFiles = [
  ...walk(join(ROOT, "components"), [".tsx", ".ts"]),
  ...walk(join(ROOT, "app"), [".tsx", ".ts"]),
];

/** class -> 用了它的产品文件（相对路径） */
const productHosts = new Map();
for (const p of productFiles) {
  const src = readFileSync(p, "utf8");
  const rel = relative(ROOT, p);
  for (const cls of pwClassesFromTs(src)) {
    if (!productHosts.has(cls)) productHosts.set(cls, new Set());
    productHosts.get(cls).add(rel);
  }
}

/* ── 4. live 对位 spec 覆盖 ─────────────────────────────────────────── */

const specFiles = existsSync(SPEC_DIR)
  ? readdirSync(SPEC_DIR).filter((f) => f.endsWith(".mjs"))
  : [];
/** board 文件名 -> 有没有 spec。spec 用 import 取 board 字段成本高，这里用「文件名前缀包含画板号」近似，
 *  再用 spec 源码里的 `board: "<file>"` 精确确认。 */
const specBoards = new Set();
for (const s of specFiles) {
  const src = readFileSync(join(SPEC_DIR, s), "utf8");
  for (const m of src.matchAll(/board:\s*"([^"]+)"/g)) specBoards.add(m[1]);
}

/* ── 分类白名单 ─────────────────────────────────────────────────────
 *
 * 「未落地」这个指标只有在排掉下面两类之后才可信：
 *
 * 1. 画板家具（BOARD_FURNITURE）—— 画板自己搭的展示框与演示格，**永远不会进产品**：
 *    `pw-frame*` 是画板外框、`pw-anim-*` 是动效演示格、`pw-phone*` 是设备外框…
 *    不排掉的话 30 张画板全报「未落地」，指标就没用了。
 *
 * 2. 登记不改（EXEMPT）—— DIVERGENCE.md 已经裁定「形态等价、登记不改」的：
 *    子代理卡（以工具卡徽标呈现）、Git 泳道（自绘 SVG）。
 *
 * 两者都是**有意识的例外**，不是欠账；真正的欠账是剩下的那一堆。 */
const BOARD_FURNITURE = [
  "pw-frame", "pw-frame-body", "pw-frame-label", "pw-head", "pw-notes", "pw-pad",
  "pw-tag", "pw-tags", "pw-grid3", "pw-col", "pw-stage", "pw-stage-cell", "pw-stage-wide",
  "pw-icons", "pw-live-states", "pw-swatch-cell", "pw-swatches-row",
  "pw-phone", "pw-phone-inner", "pw-notch", "pw-homebar", "pw-statusbar",
  "pw-cell", "pw-dim", "pw-inline", "pw-dur", "pw-grow",
];
const BOARD_FURNITURE_PREFIX = ["pw-anim-"];

const EXEMPT = ["pw-sub", "pw-sub-head", "pw-sub-line", "pw-git", "pw-commit"];

const isFurniture = (c) =>
  BOARD_FURNITURE.includes(c) || BOARD_FURNITURE_PREFIX.some((p) => c.startsWith(p));
const isExempt = (c) => EXEMPT.includes(c);

/* ── 汇总 ───────────────────────────────────────────────────────────── */

const errors = [];
const warnings = [];

// 判据⑦ 方向一：画板用到的每个 pw- 类都必须在 board.css 有定义
for (const b of boards) {
  const missing = [...b.classes].filter((c) => !definedInBoardCss.has(c));
  if (missing.length) {
    errors.push(`${b.file} 用了 board.css 没定义的类：${missing.join(", ")}`);
  }
}

// 判据⑦ 方向二：board.css 定义的类必须有画板在用
const usedByAnyBoard = new Set(boards.flatMap((b) => [...b.classes]));
const orphanClasses = [...definedInBoardCss].filter((c) => !usedByAnyBoard.has(c)).sort();
if (orphanClasses.length) {
  warnings.push(
    `board.css 定义了但没有任何画板在用（${orphanClasses.length} 个）：${orphanClasses.join(", ")}`,
  );
}

// spec 覆盖
const noSpec = boards.filter((b) => !specBoards.has(b.file)).map((b) => b.file);
if (noSpec.length) {
  warnings.push(`有画板但无 live 对位 spec（${noSpec.length}/${boards.length}）：${noSpec.join(", ")}`);
}
const orphanSpecs = [...specBoards].filter((f) => !boardFiles.includes(f));
if (orphanSpecs.length) {
  errors.push(`spec 指向不存在的画板：${orphanSpecs.join(", ")}`);
}

// 宿主映射：每张画板的类落在哪些产品文件；以及**没落在任何产品文件里的类**（= 落地工作队列）
const hostIndex = {};
const unlanded = {};
for (const b of boards) {
  const hosts = new Set();
  const missing = [];
  for (const cls of b.classes) {
    const h = productHosts.get(cls);
    if (h) for (const f of h) hosts.add(f);
    else missing.push(cls);
  }
  hostIndex[b.id] = [...hosts].sort();
  // 未落地 = 排掉画板家具与登记不改之后，真正还没进产品的类
  unlanded[b.id] = missing.filter((c) => !isFurniture(c) && !isExempt(c)).sort();
  if (hosts.size === 0) {
    warnings.push(`${b.file} 的 pw- 类在产品里没有任何宿主（= 整张未落地）`);
  } else if (unlanded[b.id].length) {
    const m = unlanded[b.id];
    warnings.push(`${b.file} 有 ${m.length} 个类未落地：${m.slice(0, 8).join(", ")}${m.length > 8 ? " …" : ""}`);
  }
}

// 产品用了但 board.css 没定义的 pw- 类（历史拷贝 / 拼写漂移）
const productOnly = [...productHosts.keys()]
  .filter((c) => !definedInBoardCss.has(c))
  .sort();
if (productOnly.length) {
  warnings.push(
    `产品用了 board.css 没定义的 pw- 类（${productOnly.length} 个，历史拷贝或漂移）：${productOnly.join(", ")}`,
  );
}

/* ── 输出 ───────────────────────────────────────────────────────────── */

const bySet = { web: [], pwa: [], core: [] };
for (const b of boards) bySet[b.set].push(b);

if (asJson) {
  console.log(
    JSON.stringify(
      {
        counts: {
          boards: boards.length,
          web: bySet.web.length,
          pwa: bySet.pwa.length,
          core: bySet.core.length,
          specs: specBoards.size,
          boardCssClasses: definedInBoardCss.size,
          unlandedClasses: [...new Set(Object.values(unlanded).flat())].length,
          boardsWithGaps: Object.values(unlanded).filter((v) => v.length).length,
          errors: errors.length,
          warnings: warnings.length,
        },
        boards: boards.map((b) => ({
          id: b.id,
          file: b.file,
          set: b.set,
          classes: [...b.classes].sort(),
          hasSpec: specBoards.has(b.file),
          hosts: hostIndex[b.id],
          landed: hostIndex[b.id].length > 0,
          unlandedClasses: unlanded[b.id],
        })),
        orphanClasses,
        productOnly,
        errors,
        warnings,
      },
      null,
      2,
    ),
  );
  process.exit(errors.length ? 1 : 0);
}

console.log("设计体系状态\n");
console.log(`画板 ${boards.length} 张  ·  web ${bySet.web.length}  ·  pwa ${bySet.pwa.length}  ·  core ${bySet.core.length}`);
console.log(`live 对位 spec ${specBoards.size}/${boards.length}`);
console.log(`board.css 定义 pw- 类 ${definedInBoardCss.size} 个\n`);

for (const [setName, list] of Object.entries(bySet)) {
  if (!list.length) continue;
  console.log(`── ${setName} ──`);
  for (const b of list) {
    const spec = specBoards.has(b.file) ? "spec" : "  · ";
    const left = unlanded[b.id].length;
    const flag = left === 0 ? "  " : left > 8 ? " !!" : "  !";
    console.log(
      `  ${b.id.padEnd(30)} ${spec}  未落地 ${String(left).padStart(2)} 类${flag}`,
    );
  }
  console.log("");
}

if (warnings.length) {
  console.log(`⚠ 待办 ${warnings.length} 项`);
  for (const w of warnings) console.log(`  · ${w}`);
  console.log("");
}
if (errors.length) {
  console.log(`✗ 错误 ${errors.length} 项`);
  for (const e of errors) console.log(`  · ${e}`);
  console.log("");
}

console.log(errors.length ? "结论：有错误，落地契约未满足。" : "结论：无错误。");
process.exit(errors.length ? 1 : 0);
