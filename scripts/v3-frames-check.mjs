#!/usr/bin/env node
/* V3 多帧画板自检：帧数 / 空槽 / V5 类名 / 图标 / 节点量。
 *   node scripts/v3-frames-check.mjs --all
 *   node scripts/v3-frames-check.mjs web-running
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const V3 = join(ROOT, "design/v3");
const V5 = process.env.V5_ROOT || "C:/Users/Administrator/Downloads/PI-NEXT-0.1.9/PI-NEXT-0.1.9/design/v5";
const manifest = JSON.parse(readFileSync(join(V3, "frames/manifest.json"), "utf8"));

const css = readFileSync(join(V3, "assets/running.css"), "utf8");
const designClasses = new Set([...css.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((m) => m[1]));
const icons = new Set();
for (const f of ["running.js", "icons-extra.js"]) {
  const js = readFileSync(join(V3, "assets", f), "utf8");
  for (const m of js.matchAll(/^\s+"?([a-z0-9-]+)"?:\s*'/gm)) icons.add(m[1]);
  for (const m of js.matchAll(/^\s*"([a-z0-9-]+)":\s*"/gm)) icons.add(m[1]);
}

/* V5 用过、V3 没有的类 = 复制痕迹 */
const v5Class = new Set();
for (const form of ["web", "pwa"]) {
  const dir = join(V5, form, "boards");
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".html"))) {
    const t = readFileSync(join(dir, f), "utf8");
    for (const m of t.matchAll(/class="([^"]+)"/g)) for (const c of m[1].split(/\s+/)) v5Class.add(c);
  }
}
const deny = new Set([...v5Class].filter((c) => !designClasses.has(c) && !c.startsWith("is-") && !c.startsWith("has-")));

const target = process.argv[2];
if (!target || target === "--all") {
  checkAll();
} else {
  const entry = manifest.boards.find((b) => b.target === target || `${b.target}.html` === target);
  if (!entry) { console.error(`manifest 里没有 ${target}`); process.exit(2); }
  process.exitCode = check(entry) ? 0 : 1;
}

function checkAll() {
  let bad = 0, frames = 0, nodes = 0;
  for (const b of manifest.boards) {
    const ok = check(b, true);
    if (!ok) bad++;
    frames += b.frames.length;
  }
  console.log(`\n${manifest.boards.length} 张板 / ${frames} 帧 · ${bad ? bad + " 张未过" : "全过"}`);
  process.exitCode = bad ? 1 : 0;
}

function splitFrames(html) {
  const out = [];
  const re = /<section class="frame"/g;
  let m;
  while ((m = re.exec(html))) {
    const end = endOfSection(html, m.index);
    out.push(html.slice(m.index, end));
    re.lastIndex = end;
  }
  return out;
}

function endOfSection(html, start) {
  const re = /<section\b|<\/section>/g;
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    if (m[0].includes("/")) depth--; else depth++;
    if (!depth) return re.lastIndex;
  }
  return html.length;
}

function check(entry, quiet = false) {
  const path = join(V3, "boards", `${entry.target}.html`);
  if (!existsSync(path)) { console.log(`✗ ${entry.target}: 文件不存在`); return false; }
  const html = readFileSync(path, "utf8");
  const errors = [];

  const sections = splitFrames(html);
  if (sections.length !== entry.frames.length) errors.push(`帧数 ${sections.length} ≠ ${entry.frames.length}`);

  const fills = (html.match(/data-fill=/g) || []).length;
  if (fills) errors.push(`还有 ${fills} 个空槽 data-fill`);
  if (/FILL\s+[DM]-/.test(html)) errors.push("还有 FILL 注释");

  sections.forEach((sec, i) => {
    const f = entry.frames[i];
    if (!f) return;
    const n = (sec.match(/<[a-zA-Z]/g) || []).length;
    const min = Math.max(8, Math.floor(f.v5nodes * 0.35));
    if (n < min) errors.push(`帧 ${f.letter} 只有 ${n} 节点（V5 ${f.v5nodes}，至少 ${min}）`);
    if (!/class="(win|phone|stage stage--doc)"/.test(sec)) errors.push(`帧 ${f.letter} 缺 .win/.phone/.stage--doc`);
  });

  const classes = new Set();
  for (const m of html.matchAll(/class="([^"]+)"/g)) for (const c of m[1].split(/\s+/)) classes.add(c);
  const unknown = [...classes].filter((c) => c && !designClasses.has(c) && !c.startsWith("is-") && !c.startsWith("has-"));
  if (unknown.length) errors.push(`running.css 没有：${unknown.slice(0, 8).join(", ")}${unknown.length > 8 ? " …" : ""}`);
  const copied = [...classes].filter((c) => deny.has(c) && /^d-|^m-/.test(c));
  if (copied.length) errors.push(`V5 类名残留：${copied.slice(0, 8).join(", ")}`);

  const usedIcons = [...html.matchAll(/<use[^>]+href="#i-([a-z0-9-]+)"/g)].map((m) => m[1]);
  const badIcons = [...new Set(usedIcons.filter((n) => !icons.has(n)))];
  if (badIcons.length) errors.push(`图标不在 sprite：${badIcons.join(", ")}`);
  if (/data-ico=|data-demo-|data-side-search/.test(html)) errors.push("有 V5 的 data-ico / data-demo-* / data-side-search");
  if (/<i\b[^>]*data-ico/.test(html)) errors.push("有 <i data-ico>");

  if (quiet) {
    if (errors.length) console.log(`✗ ${entry.target}: ${errors.join("；")}`);
    return !errors.length;
  }
  console.log(`\n${entry.target} · ${sections.length}/${entry.frames.length} 帧 · ${errors.length ? errors.length + " 错" : "0 错"}`);
  for (const e of errors) console.log(`  ✗ ${e}`);
  return !errors.length;
}
