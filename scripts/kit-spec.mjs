#!/usr/bin/env node
/**
 * kit-spec —— 从 Apple 官方 UI Kit（.sketch）抽取**控件级**的严格规格。
 *
 * 与 `sketch:extract`（scripts/sketch-extract.mjs）的分工：
 *   · sketch:extract  —— 全局层：色板 / 具名字体样式 / 共享样式 / 页面清单（生成 --nx-sk-* 数值层）
 *   · kit-spec（本脚本）—— 控件层：指定页面里指定符号的**完整图层树**（几何/圆角/填充/描边/
 *     阴影/内阴影/文字样式/透明度），输出到 `design/apple/spec/{macos,ios}.json`。
 *
 * 为什么要控件层：角色值绑定（颜色/字体）已经完成，但「按钮到底有没有边框、填充是几成、
 * 圆角多大、行高多少」这类**控件解剖**此前只能靠人肉翻 Sketch。本脚本把它变成可 diff 的
 * JSON —— 「严格按照 kit 设计」的仲裁依据。
 *
 * 用法：
 *   node scripts/kit-spec.mjs            # 两个 kit 都抽
 *   node scripts/kit-spec.mjs macos      # 只抽一个
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "design/apple/spec");

const KITS = [
  { id: "macos", file: join(ROOT, "design/Apple macOS 27 UI Kit.sketch"), page: "C48C0E34-6E52-4BA2-B487-8D743B044801" },
  { id: "ios", file: join(ROOT, "design/Apple iOS 27 UI Kit.sketch") },
];

// ── 页面 id（从 meta.json 查一次，缓存到 /tmp）───────────────────────────────
function pageIds(kit) {
  const meta = JSON.parse(execFileSync("unzip", ["-p", kit.file, "meta.json"], { maxBuffer: 1 << 30 }).toString());
  const map = {};
  for (const [pid, info] of Object.entries(meta.pagesAndArtboards)) map[info.name.replace(/^[\uE000-\uF8FF\u{100000}-\u{10FFFD}]+\s*/u, "").trim()] = pid;
  return map;
}

const readPage = (kit, pid) =>
  JSON.parse(execFileSync("unzip", ["-p", kit.file, `pages/${pid}.json`], { maxBuffer: 1 << 30 }).toString());

// ── 规范化原语 ───────────────────────────────────────────────────────────────

const r2 = (n) => (typeof n === "number" ? Math.round(n * 100) / 100 : null);
const cssColor = (c) => {
  if (!c) return null;
  const v = (x) => Math.round(Math.max(0, Math.min(1, x ?? 0)) * 255);
  const a = c.alpha ?? 1;
  const base = `#${[c.red, c.green, c.blue].map((x) => v(x).toString(16).padStart(2, "0")).join("")}`;
  return a >= 0.999 ? base : `${base}${Math.round(a * 255).toString(16).padStart(2, "0")}`;
};

function radiusOf(layer) {
  const radii = layer?.style?.corners?.radii;
  const clean = (v) => (typeof v === "number" && v > 1000 ? "pill" : v); // 3.4e38 = Sketch 的「全圆」
  if (Array.isArray(radii) && radii.length) return radii.length === 1 ? clean(radii[0]) : radii.map(clean);
  if (typeof layer?.fixedRadius === "number" && layer.fixedRadius > 0) return clean(layer.fixedRadius);
  const pts = layer?.points;
  if (Array.isArray(pts)) {
    const rs = [...new Set(pts.map((p) => r2(p.cornerRadius) || 0))];
    if (rs.length === 1 && rs[0] > 0) return clean(rs[0]);
  }
  return 0;
}

function fillsOf(style) {
  return (style?.fills ?? []).filter((f) => f.isEnabled !== false).map((f) => ({
    type: f.fillType === 1 ? "gradient" : f.fillType === 4 ? "pattern" : "color",
    color: cssColor(f.color),
    gradient: f.gradient?.stops?.map((st) => ({ pos: r2(st.position), color: cssColor(st.color) })),
    from: f.gradient?.from ? `{${r2(f.gradient.from.x)},${r2(f.gradient.from.y)}}` : undefined,
    to: f.gradient?.to ? `{${r2(f.gradient.to.x)},${r2(f.gradient.to.y)}}` : undefined,
  }));
}

function bordersOf(style) {
  return (style?.borders ?? []).filter((b) => b.isEnabled !== false).map((b) => ({
    color: cssColor(b.color), thickness: r2(b.thickness), position: b.position,
  }));
}

function shadowsOf(style, inner) {
  return (style?.shadows ?? [])
    .filter((s) => s.isEnabled !== false && Boolean(s.isInnerShadow) === inner)
    .map((s) => ({ color: cssColor(s.color), blur: r2(s.blurRadius), x: r2(s.offsetX), y: r2(s.offsetY), spread: r2(s.spread) }));
}

function textOf(layer) {
  if (layer._class !== "text") return undefined;
  const attrs = layer.style?.textStyle?.encodedAttributes ?? {};
  const font = attrs.MSAttributedStringFontAttribute?.attributes ?? {};
  const para = attrs.paragraphStyle ?? {};
  const name = font.name ?? "";
  const m = name.match(/^(.*?)-(Ultralight|Thin|Light|Regular|Medium|Semibold|Bold|Heavy|Black)(Italic)?$/i);
  const W = { ultralight: 100, thin: 200, light: 300, regular: 400, medium: 500, semibold: 600, bold: 700, heavy: 800, black: 900 };
  return {
    string: layer.attributedString?.string ?? "",
    fontFamily: m ? m[1] : name,
    weight: m ? W[m[2].toLowerCase()] : null,
    size: r2(font.size),
    lineHeight: r2(para.maximumLineHeight ?? para.minimumLineHeight),
    color: cssColor(attrs.MSAttributedStringColorAttribute),
    kerning: r2(attrs.kerning),
    align: para.alignment,
  };
}

/** 归一化一个图层（默认递归到 depth 层）。 */
function normLayer(layer, depth) {
  const n = {
    cls: layer._class,
    name: layer.name,
    visible: layer.isVisible !== false,
    frame: { x: r2(layer.frame?.x), y: r2(layer.frame?.y), w: r2(layer.frame?.width), h: r2(layer.frame?.height) },
  };
  if (layer._class === "shapeGroup" || layer._class === "rectangle" || layer._class === "oval" || layer._class === "star" || layer._class === "polygon") {
    const r = radiusOf(layer);
    if (r) n.radius = r;
  }
  const st = layer.style;
  if (st) {
    const fills = fillsOf(st); if (fills.length) n.fills = fills;
    const borders = bordersOf(st); if (borders.length) n.borders = borders;
    const shadows = shadowsOf(st, false); if (shadows.length) n.shadows = shadows;
    const innerS = shadowsOf(st, true); if (innerS.length) n.innerShadows = innerS;
    if (st.contextSettings?.opacity !== undefined && st.contextSettings.opacity < 1) n.opacity = r2(st.contextSettings.opacity);
    if (st.contextSettings?.blendMode) n.blend = st.contextSettings.blendMode;
  }
  const t = textOf(layer); if (t) n.text = t;
  if (layer._class === "symbolInstance" || layer._class === "symbolMaster") n.symbolID = layer.symbolID;
  if (depth > 0 && Array.isArray(layer.layers) && layer.layers.length) {
    n.layers = layer.layers.map((c) => normLayer(c, depth - 1)).filter(Boolean);
  }
  return n;
}

// ── 每个 kit 的抽取清单 ──────────────────────────────────────────────────────
// 名称 → 页面（正则匹配页名），patterns：符号名正则，depth：递归深度，max：上限

const JOBS = {
  macos: [
    { page: "Buttons", depth: 2, max: 40, re: [
      /^Buttons\/Light\/Content Area\/(Bordered Default|Bordered Tinted|Toggle)\/3 Rg\//,
      /^Buttons\/Light\/Content Area\/Bordered Default\/(1 Mn|5 XL)\/Active, Off, 1 Idle$/,
      /^Buttons\/Dark\/Content Area\/Neutral\/3 Rg\/(Active|Inactive), Off, (1 Idle|3 Clicked)$/,
      /^Arrow Buttons\/Light\/Content Area\/3 Rg\//,
    ] },
    { page: "Text Fields", depth: 2, max: 16, re: [
      /^Text Fields\/Light\/(3 Rg|5 XL)\//,
      /^Text Fields\/Dark\/3 Rg\/(Empty \+ Typing|Value)$/,
    ] },
    { page: "Search Fields", depth: 2, max: 10, re: [/^Search Fields\/Light\/3 Rg\//, /^Search Fields\/Dark\/3 Rg\/(Empty \+ Typing|Value)$/] },
    { page: "Segmented Controls", depth: 3, max: 14, re: [/^Segmented Controls\/Light\/[^/]*\/Buttons\/Content Area\/(Active|Inactive), 3 Rg\//] },
    { page: "Menus", depth: 3, max: 24, re: [
      /^Menus\/Light\/Regular\/Menu with Selection\//,
      /^Menus\/Light\/Regular\/[^/]*\/(Checkmark|Symbol|Keyboard Shortcut)/,
    ] },
    { page: "Pop-up and Pull-down Buttons", depth: 2, max: 12, re: [/^(Pulldown Buttons|Pop-up Buttons)\/Light\/Content Area\/3 Rg\//] },
    { page: "Toggles - Switches", depth: 3, max: 10, re: [/^Toggles - Switches\/Light\/Content Area\/3 Rg\//] },
    { page: "Toggles - Checkboxes", depth: 2, max: 10, re: [/^Toggles - Checkboxes\/Light\/Content Area\/3 Rg\//] },
    { page: "Toggles - Radio Buttons", depth: 2, max: 10, re: [/^Toggles - Radio Buttons\/Light\/Content Area\/3 Rg\//] },
    { page: "Sidebars", depth: 4, max: 22, re: [
      /^Sidebars\/Light\/[^/]*\/Large\/L1\+\//,
      /^Sidebars\/Light\/Examples\/Active\/Small$/,
    ] },
    { page: "Titlebars and Toolbars", depth: 3, max: 30, re: [
      /^Titlebars and Toolbars\/[^/]*\/Light\/(Segmented Control Buttons|Button Group Buttons)\/Active\/XL\//,
      /Window Controls/,
      /Titlebar/,
    ] },
    { page: "Windows", depth: 5, max: 6, re: [
      /^Windows\/Light\/Window BG \(with Sidebar\)\/Active$/,
      /^Windows\/Light\/Expanded Toolbar \+ Title\/Active$/,
      /^Windows\/Light\/Utility Panel\/Active$/,
    ] },
    { page: "Alerts", depth: 3, max: 8, re: [
      /^Alerts\/Light\/(Stacked|Side by Side)$/,
      /^Alerts\/[^/]*\/Light\/Buttons\//,
    ] },
    { page: "Popovers", depth: 2, max: 3, re: [/^Popovers\/Light\/(North-Center|South-Center|East-Top)$/] },
    { page: "Sliders", depth: 3, max: 6, re: [/\/Light\/.*3 Rg\//] },
    { page: "Progress Indicators", depth: 3, max: 8, re: [/\/Light\/.*\/3 Rg\//] },
    { page: "Steppers", depth: 3, max: 6, re: [/\/Light\/.*3 Rg\//] },
    { page: "Combo Boxes", depth: 3, max: 6, re: [/\/Light\/.*3 Rg\//] },
    { page: "Group Boxes", depth: 2, max: 2, re: [/./] },
    { page: "Tooltips", depth: 2, max: 2, re: [/./] },
  ],
  ios: [
    { page: "Buttons", depth: 3, max: 24, re: [/^Buttons\/Light\/(Medium|Large)\/(Bordered|Filled|Tinted|Gray|Plain)[^/]*\/[^/]+\/(1|3|4) - /] },
    { page: "Text Fields", depth: 3, max: 8, re: [/^Text Fields\/Light\//] },
    { page: "Lists", depth: 4, max: 26, re: [/^Lists\/Light\//, /^Lists\/[^/]*\/Light\/(Rows|Cell|Header|Footer)/] },
    { page: "Segmented Controls", depth: 3, max: 6, re: [/^Segmented Controls\/Light\//] },
    { page: "Toggles", depth: 2, max: 8, re: [/^Toggles\/Light\//] },
    { page: "Sidebars", depth: 4, max: 20, re: [/^Sidebar\/[^/]*\/Light\/(Items|States|Background)/] },
    { page: "Tab Bars", depth: 3, max: 8, re: [/^Tab Bars\/[^/]*\/Light\//] },
    { page: "Toolbars", depth: 3, max: 18, re: [/^Toolbars\/[^/]*\/Light\//] },
    { page: "Alerts", depth: 3, max: 8, re: [/^Alerts\/[^/]*\/Light\//] },
    { page: "Menus", depth: 3, max: 10, re: [/^Edit Menu\/Light\//] },
    { page: "Sheets", depth: 3, max: 8, re: [/^Sheets\/Light\//] },
  ],
};

// ── 主流程 ───────────────────────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true });
const only = process.argv[2];

for (const kit of KITS) {
  if (only && only !== kit.id) continue;
  if (!existsSync(kit.file)) { console.error(`✗ 找不到 kit：${kit.file}`); continue; }
  console.log(`\n═══ ${kit.id} ═══`);
  const pages = pageIds(kit);
  const out = { source: `design/Apple ${kit.id === "macos" ? "macOS" : "iOS"} 27 UI Kit.sketch`, generatedBy: "node scripts/kit-spec.mjs", sections: [] };

  for (const job of JOBS[kit.id]) {
    const pid = pages[job.page];
    if (!pid) { console.log(`  ! 找不到页 ${job.page}`); continue; }
    const page = readPage(kit, pid);
    const picked = [];
    for (const l of page.layers ?? []) {
      if (l._class !== "symbolMaster") continue;
      const name = String(l.name ?? "");
      if (!job.re.some((re) => re.test(name))) continue;
      picked.push(l);
    }
    picked.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const section = {
      page: job.page,
      symbols: picked.slice(0, job.max).map((l) => ({
        name: l.name,
        w: r2(l.frame.width), h: r2(l.frame.height),
        layers: (l.layers ?? []).map((c) => normLayer(c, job.depth - 1)),
      })),
    };
    console.log(`  ${job.page.padEnd(34)} 抽到 ${picked.length}（取前 ${section.symbols.length}）`);
    out.sections.push(section);
  }
  const file = join(OUT_DIR, `${kit.id}.json`);
  writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
  console.log(`  写 ${file}`);
}
