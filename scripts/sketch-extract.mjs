#!/usr/bin/env node
/**
 * sketch:extract —— 把 Apple 官方的两份 Sketch UI Kit 抽成机器可读规范。
 *
 * ## 为什么以 Sketch kit 为准
 *
 * `design/Apple macOS 27 UI Kit.sketch` 与 `design/Apple iOS 27 UI Kit.sketch` 是
 * **Apple 官方设计资源**，里面的 `document.json` 带 `layerTextStyles` / `sharedSwatches` /
 * `layerStyles` —— 那是具名字体样式、色板与共享样式的**真值**，不是从渲染结果反推的近似。
 *
 * 两个 kit 对应本仓的两个形态：
 *   macOS kit → Web 形态（`design/v5/web/`）
 *   iOS  kit → PWA 形态（`design/v5/pwa/`）
 *
 * ## 体积与入库策略
 *
 * 两个 `.sketch` 合计 ~270MB，**不入库**（见 `.gitignore`）。本脚本用系统 `unzip`
 * 只读需要的 JSON，把结果写进 `design/apple/sketch/`（几十 KB，可 diff、可对拍）。
 * 所以：kit 文件在你机器上就能重跑本脚本，仓库里只留抽出来的规范。
 *
 * ## 用法
 *
 *   npm run sketch:extract          # 重新抽取
 *   npm run sketch:extract -- --list  # 只列页与画板，不写文件
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'design/apple/sketch');

/** 两个 kit 与它们对应的形态。 */
const KITS = [
  { id: 'macos', form: 'web', file: join(ROOT, 'design/Apple macOS 27 UI Kit.sketch'), label: 'macOS 27（→ Web 形态）' },
  { id: 'ios', form: 'pwa', file: join(ROOT, 'design/Apple iOS 27 UI Kit.sketch'), label: 'iOS 27（→ PWA 形态）' },
];

const LIST_ONLY = process.argv.includes('--list');

// ── 读 Sketch（ZIP）：只解需要的成员，不整包展开 ─────────────────────────────

/** 用系统 unzip 把单个成员读进内存。返回解析后的 JSON。 */
function readMember(file, member) {
  const buf = execFileSync('unzip', ['-p', file, member], { maxBuffer: 512 * 1024 * 1024 });
  return JSON.parse(buf.toString('utf8'));
}

function listMembers(file) {
  return execFileSync('unzip', ['-Z1', file], { maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8').split('\n').filter(Boolean);
}

// ── 解析原语 ─────────────────────────────────────────────────────────────────

/** Sketch 的 color 是 0..1 的 rgba。输出 `#rrggbb` 或 `#rrggbbaa`。 */
function toHex(c) {
  if (!c || typeof c !== 'object') return null;
  const b = (v) => Math.round(Math.max(0, Math.min(1, v ?? 0)) * 255);
  const hex = [b(c.red), b(c.green), b(c.blue)].map((v) => v.toString(16).padStart(2, '0')).join('');
  const a = c.alpha ?? 1;
  if (a >= 0.999) return `#${hex}`;
  return `#${hex}${Math.round(a * 255).toString(16).padStart(2, '0')}`;
}

/**
 * Sketch 的字体名带 weight 后缀（`SFPro-Regular` / `SFPro-Bold` / `SFProText-Semibold`…）。
 * 拆成 family 与 weight —— 直接照抄原始名会让「同族不同重」看起来像两种字体。
 */
function parseFont(name = '') {
  const m = name.match(/^(.*?)-(Ultralight|Thin|Light|Regular|Medium|Semibold|Bold|Heavy|Black)(Italic)?$/i);
  if (!m) return { family: name, weight: null, italic: /italic/i.test(name) };
  const w = { ultralight: 100, thin: 200, light: 300, regular: 400, medium: 500, semibold: 600, bold: 700, heavy: 800, black: 900 };
  return { family: m[1], weight: w[m[2].toLowerCase()] ?? null, italic: Boolean(m[3]) };
}

/** 从共享样式里取出字体规格。 */
function parseTextStyle(style) {
  const attrs = style?.value?.textStyle?.encodedAttributes;
  if (!attrs) return null;
  const font = attrs.MSAttributedStringFontAttribute?.attributes ?? {};
  const para = attrs.paragraphStyle ?? {};
  const { family, weight, italic } = parseFont(font.name);
  const lh = para.maximumLineHeight ?? para.minimumLineHeight ?? null;
  return {
    size: font.size ?? null,
    lineHeight: lh,
    fontFamily: family,
    fontName: font.name ?? null,
    fontWeight: weight,
    italic,
    // Sketch 的 kerning 是「额外字距」，单位与 pt 同
    letterSpacing: attrs.kerning ?? null,
    color: toHex(attrs.MSAttributedStringColorAttribute),
    alignment: para.alignment ?? null,
  };
}

/** 从共享样式里取出填充 / 描边 / 阴影 / 模糊。 */
function parseLayerStyle(style) {
  const v = style?.value;
  if (!v) return null;
  const fills = (v.fills ?? []).filter((f) => f.isEnabled !== false).map((f) => ({
    hex: toHex(f.color),
    blend: f.contextSettings?.blendMode || undefined,
    gradient: f.gradient?.gradientType !== undefined || f.gradient?.stops
      ? f.gradient?.stops?.map((st) => ({ pos: st.position, hex: toHex(st.color) }))
      : undefined,
  }));
  const borders = (v.borders ?? []).filter((b) => b.isEnabled !== false).map((b) => ({
    color: toHex(b.color), thickness: b.thickness ?? null,
  }));

  /*
   * ⚠️ 两个易错点（都踩过）：
   *   1. 模糊半径的键是 **`blurRadius`**，不是 `blur` —— 写错就全读到 null，
   *      看起来像「这些阴影没有模糊」，实际是解析没对上。
   *   2. 外阴影与**内阴影在同一个 `shadows` 数组里**，靠 `isInnerShadow` 区分。
   *      当成一种会把内阴影（也就是设备上「受光边」的来源）全归到外阴影去。
   */
  const allShadows = (v.shadows ?? []).filter((s) => s.isEnabled !== false);
  const mapShadow = (s) => ({
    color: toHex(s.color),
    blur: s.blurRadius ?? null,
    x: s.offsetX ?? 0,
    y: s.offsetY ?? 0,
    spread: s.spread ?? 0,
    blend: s.contextSettings?.blendMode || undefined,
  });
  const shadows = allShadows.filter((s) => !s.isInnerShadow).map(mapShadow);
  const innerShadows = allShadows.filter((s) => s.isInnerShadow).map(mapShadow);

  const blurs = (v.blurs ?? []).filter((b) => b.isEnabled !== false).map((b) => ({
    radius: b.radius ?? null, type: b.type ?? null,
    saturation: b.saturation ?? null,
    ...(b.isCustomGlass ? {
      glass: true, distortion: b.distortion ?? null, depth: b.depth ?? null,
      brightness: b.brightness ?? null, chromaticAberration: b.chromaticAberrationMultiplier ?? null,
    } : {}),
  }));
  if (!fills.length && !borders.length && !shadows.length && !innerShadows.length && !blurs.length) return null;
  return { fills, borders, shadows, innerShadows, blurs };
}

// ── 一层里找「有几何的节点」（组件尺寸的来源）────────────────────────────────

/**
 * 收集 symbolMaster / symbolInstance 的 frame。
 * `symbolMaster` 是组件的**定义**（真值）；`symbolInstance` 是使用处（尺寸可能被拉伸），
 * 所以只取 master，避免把「被拉伸的实例」当成规格。
 */
function collectSymbols(node, out = [], depth = 0) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { for (const n of node) collectSymbols(n, out, depth); return out; }
  const cls = node._class;
  if ((cls === 'symbolMaster' || cls === 'artboard') && node.name && node.frame) {
    out.push({
      name: node.name,
      class: cls,
      width: round(node.frame.width),
      height: round(node.frame.height),
      // 只保留前两层的子节点几何 —— 再深就是实现细节，规格用不到
      children: depth === 0 ? (node.layers ?? []).filter((l) => l.frame).slice(0, 24).map((l) => ({
        name: l.name, width: round(l.frame.width), height: round(l.frame.height),
      })) : undefined,
    });
  }
  for (const v of Object.values(node)) {
    if (v && typeof v === 'object') collectSymbols(v, out, depth + 1);
  }
  return out;
}

const round = (n) => (typeof n === 'number' ? Math.round(n * 100) / 100 : null);

// ── 主流程 ───────────────────────────────────────────────────────────────────

const summary = [];

for (const kit of KITS) {
  if (!existsSync(kit.file)) {
    console.error(`✗ 找不到 kit：${kit.file}\n  两个 .sketch 不入库，请把它们放在 design/ 下（见 design/apple/README.md）`);
    process.exit(1);
  }
  console.log(`\n═══ ${kit.label} ═══`);
  const members = listMembers(kit.file);
  const pageMembers = members.filter((m) => /^pages\/.*\.json$/.test(m));
  console.log(`  成员 ${members.length} 个，其中 page JSON ${pageMembers.length} 个`);

  const doc = readMember(kit.file, 'document.json');
  const meta = readMember(kit.file, 'meta.json');

  // 1 · 字体样式
  const textStyles = (doc.layerTextStyles?.objects ?? []).map((s) => {
    const t = parseTextStyle(s);
    return t ? { name: s.name, ...t } : null;
  }).filter(Boolean);

  // 2 · 色板
  const swatches = (doc.sharedSwatches?.objects ?? []).map((s) => ({
    name: s.name,
    ...(s.value && typeof s.value === 'object' && 'red' in s.value ? { hex: toHex(s.value) } : {}),
    // 有的色板值是 gradient
    ...(s.value?.gradient ? { gradient: s.value.gradient.stops?.map((st) => ({ pos: st.position, hex: toHex(st.color) })) } : {}),
  })).filter((s) => s.hex || s.gradient);

  // 3 · 共享图层样式
  const layerStyles = (doc.layerStyles?.objects ?? []).map((s) => {
    const v = parseLayerStyle(s);
    return v ? { name: s.name, ...v } : null;
  }).filter(Boolean);

  // 4 · 字体引用（kit 自带字体文件，但我们只用系统栈）
  const fonts = (doc.fontReferences ?? []).map((f) => f.fontFamily ?? f.name).filter(Boolean);

  // 5 · 每页的组件几何（只取有 artboard 的页）
  const pages = [];
  const pageIndex = Object.entries(meta.pagesAndArtboards ?? {});
  for (const [pid, info] of pageIndex) {
    const count = Object.keys(info.artboards ?? {}).length;
    if (!count) continue;
    const member = `pages/${pid}.json`;
    if (!pageMembers.includes(member)) { pages.push({ id: pid, name: info.name, artboards: count, symbols: [] }); continue; }
    const pageDoc = readMember(kit.file, member);
    const symbols = collectSymbols(pageDoc);
    pages.push({ id: pid, name: stripGlyph(info.name), glyph: info.name, artboards: count, symbols });
  }

  summary.push({ id: kit.id, form: kit.form, label: kit.label, textStyles, swatches, layerStyles, fonts, pages });

  console.log(`  字体样式 ${textStyles.length} · 色板 ${swatches.length} · 共享样式 ${layerStyles.length} · 字体 ${fonts.length}`);
  console.log(`  有内容的页 ${pages.length} · 组件符号合计 ${pages.reduce((n, p) => n + p.symbols.length, 0)}`);

  if (LIST_ONLY) {
    for (const p of pages) console.log(`    ${String(p.name).padEnd(34)} artboards=${String(p.artboards).padStart(4)} symbols=${p.symbols.length}`);
  }
}

/** Sketch 的页名前面带 SF Symbols 私用区字形，去掉它保留可读名。 */
function stripGlyph(name = '') {
  return name.replace(/^[\uE000-\uF8FF\uF0000-\uFFFFD]+\s*/u, '').trim();
}

if (LIST_ONLY) process.exit(0);

// ── 落盘 ─────────────────────────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true });
for (const kit of summary) {
  const out = join(OUT_DIR, `${kit.id}.json`);
  writeFileSync(out, JSON.stringify({
    source: `design/Apple ${kit.id === 'macos' ? 'macOS' : 'iOS'} 27 UI Kit.sketch`,
    form: kit.form,
    note: 'Apple 官方 UI Kit 抽出的规范。两个 .sketch 不入库（270MB），用 `npm run sketch:extract` 重新生成。',
    fonts: kit.fonts,
    textStyles: kit.textStyles,
    swatches: kit.swatches,
    layerStyles: kit.layerStyles,
    pages: kit.pages,
  }, null, 1) + '\n');
  console.log(`\n写 ${out}`);
}

console.log('\n下一步：`npm run sketch:report` 打印人类可读的规范摘要。');
