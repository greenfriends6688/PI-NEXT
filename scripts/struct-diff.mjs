#!/usr/bin/env node
/* ===========================================================================
 * fork:v5-landing —— 画板 ↔ 产品 **结构比对**（structdiff）
 *
 * 为什么要有它：V5 换皮翻过三次车，每次都是「类名对上了、结构没对上」——
 * 只加类不换 DOM、照着截图仿写。类名 grep 只能证明「这个类在库里」，
 * 证明不了「板面那一段在产品里长这样」。本脚本把两边各自归一化成
 * **结构签名**（标签 + 形态类 + 图标名，逐节点），再逐节点 diff：
 *
 *   ✓ 板上有、产品没有        → MISSING
 *   ✓ 产品多出来的            → EXTRA
 *   ✓ 同一节点类名不一致      → CLASS
 *   ✓ 同一位置标签不同        → TAG
 *
 * 文本与数据一律忽略（板上是样例、产品是真数据，比文本必假）。
 *
 * 跑法：
 *   node scripts/struct-diff.mjs <spec.mjs> [--json]
 *
 * spec 形状：
 *   export default {
 *     name: "D-02 侧栏与顶栏",
 *     board: "v5/web/boards/D-02-sidebar-topbar.html",  // 带斜杠 = 从 design/ 起算
 *     frame: 0,                    // 第几个 .d-frame / .m-frame（0 起）；不给 = 整页
 *     boardRoot: ".d-shell",       // 板侧要比的那段（家具 d-frame/d-scene 已被排除在外）
 *     app: { script: "…" },        // 产品侧怎么走到这个面（自含脚本，见 board-diff.mjs）
 *     appRoot: ".d-shell",         // 产品侧要比的那段
 *     ignore: ["d-grow"],          // 可选：忽略的类（纯占位、无视觉）
 *   }
 * =========================================================================== */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launchChrome } from "./launch-chrome.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const APP_URL = process.env.APP_URL || "http://127.0.0.1:30141";

/* 板面家具：不参与比对（它们是「摆拍的台子」，不是产品 DOM） */
const FURNITURE = new Set([
  "d-board", "d-board-head", "d-scene", "d-frame", "d-frame-body", "d-frame-label",
  "d-frame.sheet", "d-theme-toggle", "d-tags", "d-tag", "d-notes", "d-grow",
  "m-board", "m-board-head", "m-scene", "m-frame", "m-frame-body", "m-frame-label",
  "m-theme-toggle", "m-notes", "m-mono", "m-homebar", "m-phone", "m-phone-inner",
  "m-statusbar",
]);

/* 归一化：只留「形态类 + 图标名 + 结构语义类」，其余（产品钩子/状态类）忽略。
   目的：比的是**骨架与形态**，不是数据与状态。 */
function normalize(root, ignore = []) {
  const ig = new Set(ignore);
  const out = [];
  const walk = (el, depth, path) => {
    const tag = el.tagName.toLowerCase();
    const raw = (el.className || "").toString().split(/\s+/).filter(Boolean);
    const cls = raw
      .filter((c) => !FURNITURE.has(c))
      .filter((c) => !ig.has(c))
      .filter((c) => /^(d|m)-/.test(c) || c.startsWith("is-") || c.startsWith("has-"))
      .sort();
    const ico = el.getAttribute("data-ico");
    const sig = { tag, cls, ico: ico || null, depth };
    out.push({ path, ...sig });
    const kids = [...el.children].filter((c) => {
      const kc = (c.className || "").toString();
      return !FURNITURE.has(kc.trim());
    });
    kids.forEach((k, i) => walk(k, depth + 1, `${path}/${i}`));
  };
  walk(root, 0, "");
  return out;
}

function diff(a, b) {
  const rows = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    const x = a[i], y = b[i];
    if (!y) { rows.push({ kind: "MISSING", at: x.path, detail: `${x.tag}.${x.cls.join(".")}` }); continue; }
    if (!x) { rows.push({ kind: "EXTRA", at: y.path, detail: `${y.tag}.${y.cls.join(".")}` }); continue; }
    if (x.tag !== y.tag) rows.push({ kind: "TAG", at: x.path, detail: `板 ${x.tag} ≠ 产品 ${y.tag}` });
    const missing = x.cls.filter((c) => !y.cls.includes(c));
    const extra = y.cls.filter((c) => !x.cls.includes(c));
    if (missing.length || extra.length) {
      rows.push({ kind: "CLASS", at: x.path, detail: `缺 [${missing.join(",")}] 多 [${extra.join(",")}]` });
    }
    if (x.ico !== y.ico) rows.push({ kind: "ICON", at: x.path, detail: `板 ${x.ico ?? "—"} ≠ 产品 ${y.ico ?? "—"}` });
  }
  return rows;
}

const specPath = process.argv[2];
if (!specPath || !existsSync(resolve(specPath))) {
  console.error("用法：node scripts/struct-diff.mjs <spec.mjs> [--json]");
  process.exit(2);
}
const spec = (await import(pathToFileURL(resolve(specPath)).href)).default;
const asJson = process.argv.includes("--json");

const boardPath = spec.board.includes("/")
  ? join(ROOT, "design", spec.board)
  : join(ROOT, "design/pi-web-design", spec.board);
if (!existsSync(boardPath)) { console.error(`找不到画板：${boardPath}`); process.exit(2); }

const browser = await launchChrome();

/* ── 产品侧 ── */
/* 视口：spec.viewport = { width, height }（窄屏核对用 390×844）；不给则 1440×900 */
const vp = spec.viewport ?? { width: 1440, height: 900 };
const aPage = await browser.newPage({ viewport: vp });
await aPage.goto(APP_URL, { waitUntil: "load" });
await aPage.waitForTimeout(2500);
if (typeof spec.app?.script === "string" && spec.app.script.trim()) {
  await aPage.evaluate(async (src) => {
    // eslint-disable-next-line no-new-func
    const fn = new Function(`return (async () => { ${src} })()`);
    await fn();
  }, spec.app.script);
  await aPage.waitForTimeout(1200);
}
const appSide = await aPage.evaluate(
  ({ rootSel, appSkip, skipBare }) => {
    const FURN = new Set(["d-board","d-board-head","d-scene","d-frame","d-frame-body","d-frame-label","d-theme-toggle","d-tags","d-tag","d-notes","d-grow","m-board","m-board-head","m-scene","m-frame","m-frame-body","m-frame-label","m-theme-toggle","m-notes","m-mono","m-homebar","m-phone","m-phone-inner","m-statusbar"]);
    const el = rootSel === ":scope" ? document.body : document.querySelector(rootSel);
    if (!el) return { err: `产品里找不到 ${rootSel}` };
    const out = [];
    const walk = (n, depth, path) => {
      const tag = n.tagName.toLowerCase();
      const cls = (n.className||"").toString().split(/\s+/).filter(Boolean)
        // fork:frame-audit —— 与板侧同一份 FURN 清单：FURN 里的类（`d-grow` 等纯占位）
        // 两侧都要剔掉。此前只在板侧剔，于是产品侧任何带 `d-grow` 的节点都被报成
        // 「多 [d-grow]」—— 工具两侧不对称，不是产品的偏差。
        .filter(c=>!FURN.has(c))
        .filter(c=>/^(d|m)-/.test(c)||c.startsWith("is-")||c.startsWith("has-")).sort();
      const ico = n.getAttribute("data-ico");
      // 裸节点（既无形态类也无图标名）只是产品钩子外壳，不参与比对，但子树照走。
      if (!(skipBare && !cls.length && !ico)) out.push({path, tag, cls, ico, depth});
      const kids = [...n.children].filter(c=>!FURN.has((c.className||"").toString().trim()));
      for (const [i, c] of kids.entries()) {
        // spec.appSkip：产品侧独有的人造件（高亮 overlay 之类），连子树一起剔掉再比。
        if (appSkip.some(sel => { try { return c.matches(sel); } catch { return false; } })) continue;
        // 图标内部零件（lucide 灌进 <i data-ico> 的 svg/path…）：两侧对称剔掉，
        // 比的仍然是 <i> 那一层的 data-ico 图标名。
        if (n.getAttribute("data-ico") && /^(svg|path|circle|rect|line|polyline|polygon|ellipse)$/.test(c.tagName.toLowerCase())) continue;
        walk(c, depth + 1, path + "/" + i);
      }
    };
    walk(el, 0, "");
    return { n: out.length, sig: out };
  },
  { rootSel: spec.appRoot ?? ":scope", appSkip: spec.appSkip ?? [], skipBare: spec.skipBare !== false },
);

await browser.close();

if (appSide.err) {
  const msg = `${spec.name}：${appSide.err}`;
  if (asJson) console.log(JSON.stringify({ name: spec.name, error: appSide.err }, null, 2));
  else console.log(`✗ ${msg}`);
  process.exit(1);
}

/* 板侧签名在页面里，重新取一次 */
const boardSig = await (async () => {
  const p = await launchChrome();
  const pg = await p.newPage({ viewport: { width: 1560, height: 1000 } });
  await pg.goto(`file://${boardPath}`, { waitUntil: "load" });
  await pg.waitForTimeout(400);
  const sig = await pg.evaluate(({ rootSel, ignore, skip, skipBare }) => {
    const FURN = new Set(["d-board","d-board-head","d-scene","d-frame","d-frame-body","d-frame-label","d-theme-toggle","d-tags","d-tag","d-notes","d-grow","m-board","m-board-head","m-scene","m-frame","m-frame-body","m-frame-label","m-theme-toggle","m-notes","m-mono","m-homebar","m-phone","m-phone-inner","m-statusbar"]);
    const ig = new Set(ignore);
    const el = document.querySelector(rootSel);
    if (!el) return null;
    const out = [];
    const walk = (n, depth, path) => {
      const tag = n.tagName.toLowerCase();
      const cls = (n.className||"").toString().split(/\s+/).filter(Boolean)
        .filter(c=>!FURN.has(c)).filter(c=>!ig.has(c))
        .filter(c=>/^(d|m)-/.test(c)||c.startsWith("is-")||c.startsWith("has-")).sort();
      const ico = n.getAttribute("data-ico");
      if (!(skipBare && !cls.length && !ico)) out.push({path, tag, cls, ico, depth});
      const kids = [...n.children].filter(c=>!FURN.has((c.className||"").toString().trim()));
      for (const [i, c] of kids.entries()) {
        if (skip.some(sel => { try { return c.matches(sel); } catch { return false; } })) continue;
        if (n.getAttribute("data-ico") && /^(svg|path|circle|rect|line|polyline|polygon|ellipse)$/.test(c.tagName.toLowerCase())) continue;
        walk(c, depth+1, path+"/"+i);
      }
    };
    walk(el, 0, "");
    return out;
  }, { rootSel: spec.boardRoot ?? ".d-frame, .m-phone-inner", ignore: spec.ignore ?? [], skip: spec.boardSkip ?? [], skipBare: spec.skipBare !== false });
  await p.close();
  return sig;
})();

const known = new Set(spec.knownDiffs ?? []);
const allRows = diff(boardSig ?? [], appSide.sig);
/* knownDiffs：已登记的偏差（路径或路径前缀）。登记必须在 spec 里写清为什么。 */
const rows = known.size
  ? allRows.filter((r) => ![...known].some((k) => r.at === k || r.at.startsWith(k)))
  : allRows;
const summary = {
  name: spec.name,
  board: spec.board,
  frame: spec.frame ?? null,
  boardNodes: boardSig?.length ?? 0,
  appNodes: appSide.n,
  deviations: rows.length,
  known: allRows.length - rows.length,
  rows: rows.slice(0, spec.maxRows ?? 60),
};

if (asJson) console.log(JSON.stringify(summary, null, 2));
else {
  const mark = rows.length === 0 ? "✓" : "✗";
  console.log(`${mark} ${spec.name} · ${spec.board}${spec.frame != null ? ` 帧${spec.frame}` : ""}`);
  console.log(`  板 ${summary.boardNodes} 节点 / 产品 ${summary.appNodes} 节点 · 偏差 ${rows.length}`);
  for (const r of summary.rows) console.log(`   [${r.kind}] ${r.at}  ${r.detail}`);
  if (rows.length > summary.rows.length) console.log(`   …还有 ${rows.length - summary.rows.length} 条`);
  if (summary.known) console.log(`   （已登记 knownDiffs ${summary.known} 条）`);
}
process.exit(rows.length === 0 ? 0 : 1);
