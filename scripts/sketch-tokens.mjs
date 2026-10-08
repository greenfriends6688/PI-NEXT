#!/usr/bin/env node
/**
 * sketch:tokens —— 从抽取好的 Apple 规范生成 v5 令牌 CSS。
 *
 * ## 为什么是「生成」而不是「手抄」
 *
 * 两个 kit 里有 210 个色板、172 条具名字体样式、327 个共享样式。手抄一遍必然抄错，
 * 而且 Apple 更新 kit 之后没人会去逐条对。生成解决两件事：数值不可能抄错，
 * 重跑 `npm run sketch:extract && npm run sketch:tokens` 就跟上更新。
 *
 * ## 产物与层次
 *
 *   design/v5/sketch-macos.css   来自 macOS kit → Web 形态
 *   design/v5/sketch-ios.css     来自 iOS  kit → PWA 形态
 *
 * 两份都只定义 `--nx-sk-*`（sketch 来源）这一层，**不碰 `--nx-*` 角色层**。
 * 理由：`--nx-*` 是本仓的角色语义（canvas / panel / text-2 / r-lg…），
 * 由 `web/tokens.css` 与 `pwa/tokens.css` 手维护并指向具体值；
 * 让它们指向 `--nx-sk-*` 就把「Apple 的数值」与「我们的角色」分成两层，
 * 重跑生成不会覆盖手写的角色决策，反过来角色层换绑定也不影响生成物。
 *
 * 用法：npm run sketch:tokens
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'design/apple/sketch');
const OUT = join(ROOT, 'design/v5');

const HEADER = (kit, form) => `/* ═══════════════════════════════════════════════════════════════════════════
 * 由 Apple ${kit} UI Kit **生成** —— 请勿手改。
 *
 *   来源：design/Apple ${kit} UI Kit.sketch（Apple 官方设计资源，不入库）
 *   生成：npm run sketch:tokens          （先跑 sketch:extract）
 *   本形态：${form}
 *
 * 本文件只定义 \`--nx-sk-*\`（sketch 来源的数值）。角色层 \`--nx-*\` 在
 * ${form === 'web' ? 'design/v5/web/tokens.css' : 'design/v5/pwa/tokens.css'} 里手维护并指向这里 —— 两层分开是为了让重跑
 * 生成不会覆盖角色决策。
 * ═══════════════════════════════════════════════════════════════════════════ */

`;

/** 把 kit 里的名字转成 CSS 变量片段：`Window Backgrounds/Light Background` → `window-backgrounds-light-background` */
const slug = (s) => s.toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

/**
 * 色板名 → CSS 变量名 + 它属于哪个主题块。
 *
 * **命名必须无损**。早期版本为了让名字短一点，把 `Base` / `Elevated` 这类限定词与
 * `(use plus lighter)` 括注丢掉了 —— 于是
 *   `Backgrounds/Dark - Base/Primary` 与 `Backgrounds/Dark - Elevated/Primary`
 *   `Grays/Dark/Black` 与 `Grays/Dark (use plus lighter)/Black`
 * 各自映射到**同一个变量名**，后写的静默覆盖先写的。产物看起来正常，值却少了一半。
 * 现在只剥掉「主题」那一段里 Light/Dark 两个词本身，其余全部保留。
 */
function colorVarName(name) {
  const parts = name.split('/').map((p) => p.trim());
  const group = slug(parts[0]);
  const rest = parts.slice(1);

  // 主题段：任意一段以 Light / Dark 开头（可能是 `Dark - Base`、`Dark (use plus lighter)`）
  const themeSeg = rest.find((p) => /^(Light|Dark)\b/.test(p)) ?? '';
  const isLight = /^Light/.test(themeSeg);
  const vibrant = /vibrant/i.test(themeSeg);
  const theme = isLight ? (vibrant ? 'light-vibrant' : 'light') : (vibrant ? 'dark-vibrant' : 'dark');

  // 主题段的限定词（`- Base` / `(use plus lighter)`）**保留**，只去掉 Light/Dark 这两个词
  const qualifier = themeSeg
    .replace(/^(Light|Dark)\s*(-\s*)?/, '')
    .replace(/[()]/g, '');
  const key = slug([qualifier, ...rest.filter((p) => p !== themeSeg)].filter(Boolean).join('-'));
  return { theme, name: `--nx-sk-${group}-${theme}-${key || 'value'}` };
}

// ── 读取抽取结果 ─────────────────────────────────────────────────────────────

function load(id) {
  const p = join(SRC, `${id}.json`);
  if (!existsSync(p)) {
    console.error(`✗ 缺少 ${p}\n  先跑 \`npm run sketch:extract\`（它从两个 .sketch 里抽）`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(p, 'utf8'));
}

/**
 * 具名字体样式。
 *
 * kit 里的名字是三层结构：
 *   `01 LargeTitle/1 Default`             ← 默认档（`/1` 是 iOS 的风格轴序号）
 *   `Loose Leading/01 LargeTitle/Default` ← 行高变体（Loose / Tight）
 *   `09 Footnote/4 Bold Italic`           ← 字重与斜体轴
 *
 * 早期版本用一条宽松的正则去猜，结果把 `emphasized`、`secondary-style`、
 * `4-bold-italic` 这类碎片也当成独立样式装了进去。现在改为**硬匹配**：
 * 必须能剥掉可选的 Loose/Tight 前缀后**以 `NN Name/` 开头**，
 * 且剩余部分必须以 `Default` 结尾（所以 Bold/Italic 轴被排除）。
 *
 * Loose / Tight 另收一组：它们是真实的行高变体（各 ±2pt），落到
 * `--nx-sk-t-<样式>-loose-lh` / `-tight-lh`。
 */
function pickTextStyles(kit) {
  const base = new Map();
  const variants = new Map();
  for (const t of kit.textStyles) {
    const lead = /^Loose Leading\//i.test(t.name) ? 'loose' : /^Tight Leading\//i.test(t.name) ? 'tight' : null;
    const stripped = t.name.replace(/^(Loose|Tight) Leading\//i, '');
    const m = stripped.match(/^\d{2}\s+([A-Za-z0-9]+)\s*\//);
    if (!m) continue;
    if (!/\/\s*\d*\s*Default\s*$/i.test(stripped)) continue;   // 排除 Bold / Italic 轴
    const key = slug(m[1]);
    if (!lead) {
      if (!base.has(key)) base.set(key, { ...t, key });
    } else {
      const k = `${key}-${lead}`;
      if (!variants.has(k)) variants.set(k, { ...t, key, lead });
    }
  }
  return {
    base: [...base.values()].sort((a, b) => (b.size ?? 0) - (a.size ?? 0)),
    variants: [...variants.values()],
  };
}

// ── 生成 ─────────────────────────────────────────────────────────────────────

function generate({ id, form, kitLabel }) {
  const kit = load(id);
  const kebab = kitLabel === 'macOS' ? 'macos' : 'ios';
  const L = [];

  L.push(HEADER(kitLabel, form));

  // ── 1 · 色板 ──
  const byTheme = { light: [], dark: [], 'light-vibrant': [], 'dark-vibrant': [] };
  for (const s of kit.swatches) {
    const { theme, name: v } = colorVarName(s.name);
    byTheme[theme].push([v, s.hex]);
  }

  L.push(`/* ── 1 · 色板（${kit.swatches.length} 个，来自 kit 的 sharedSwatches）─────────────\n`
    + ' * 命名保留 kit 的原文（Window Backgrounds/Light Background → --nx-sk-window-backgrounds-light-background），\n'
    + ' * 只在最前面加 --nx-sk-。这样任何一条都能直接对回 kit 里的名字，不需要再查映射表。\n'
    + ` */\n`);

  const emitColors = (label, list, indent = '') => {
    if (!list.length) return;
    L.push(`${indent}/* ${label} */`);
    for (const [v, hex] of list.sort((a, b) => a[0].localeCompare(b[0]))) {
      if (hex) L.push(`${indent}${v}: ${hex};`);
    }
    L.push('');
  };

  L.push(':root {');
  emitColors('浅色', byTheme.light, '  ');
  L.push('}');
  L.push('');
  L.push('[data-theme="dark"] {');
  emitColors('深色', byTheme.dark, '  ');
  L.push('}');

  if (byTheme['light-vibrant'].length || byTheme['dark-vibrant'].length) {
    L.push(`\n/* 在材质（玻璃/半透明面）**上面**用的色 —— kit 里单独一组，\n`
      + `   因为透明面上的不透明色会读成「糊」，vibrant 那组是为此调过的。 */`);
    L.push(':root {');
    emitColors('浅色 vibrant', byTheme['light-vibrant'], '  ');
    L.push('}');
    L.push('[data-theme="dark"] {');
    emitColors('深色 vibrant', byTheme['dark-vibrant'], '  ');
    L.push('}');
  }

  // ── 2 · 字体 ──
  const { base: ts, variants } = pickTextStyles(kit);
  L.push(`\n/* ── 2 · 具名字体样式（${ts.length} 个默认档 + ${variants.length} 个行高变体）─────\n`
    + ' * 每个样式 = size + line-height + weight 三件套。**这就是 Apple 的排版单位** ——\n'
    + ' * 本仓原来只有一条尺寸梯子 + 四个全局行高比值，没有「样式」这个概念。\n'
    + ' * 变量名带 -size / -lh / -w 后缀，方便分别取用（比如只要字号时可单独引）。\n'
    + ' * Loose / Tight 是 kit 自带的行高变体，单独一组后缀。\n'
    + ` */\n`);
  L.push(':root {');
  for (const t of ts) {
    L.push(`  /* ${t.name} */`);
    if (t.size != null) L.push(`  --nx-sk-t-${t.key}-size: ${t.size}px;`);
    if (t.lineHeight != null) L.push(`  --nx-sk-t-${t.key}-lh: ${t.lineHeight}px;`);
    if (t.fontWeight != null) L.push(`  --nx-sk-t-${t.key}-w: ${t.fontWeight};`);
    if (t.letterSpacing != null) L.push(`  --nx-sk-t-${t.key}-ls: ${t.letterSpacing}px;`);
  }
  if (variants.length) {
    L.push('  /* 行高变体（kit 的 Loose / Tight Leading） */');
    for (const v of variants) {
      if (v.lineHeight != null) L.push(`  --nx-sk-t-${v.key}-${v.lead}-lh: ${v.lineHeight}px;`);
    }
  }
  L.push('}');

  // ── 3 · 材质（玻璃）──
  const glassAll = kit.layerStyles.filter((s) => /^Liquid Glass\//.test(s.name));
  /* 按 slug 后的名字去重，保留**后者**（与 CSS「后写的赢」一致），并记下被覆盖的那些名。
     Apple 的 kit 自身有重名样式（`Liquid Glass/Light/Regular - Small - Tinted` 有两条、
     值不同）—— 不去重的话产物里同一变量出现两次，值是谁定的要看顺序，改值时会查不出原因。 */
  const glassMap = new Map();
  const glassDup = [];
  for (const g of glassAll) {
    const key = slug(g.name.replace(/^Liquid Glass\//, ''));
    if (glassMap.has(key)) glassDup.push(key);
    glassMap.set(key, g);
  }
  const glass = [...glassMap.values()];
  if (glass.length) {
    if (glassDup.length) {
      L.push(`/* 注：kit 里有 ${glassDup.length} 条重名玻璃样式（${[...new Set(glassDup)].join(', ')}），\n   已按 CSS 语义取后者。 */\n`);
    }
    L.push(`\n/* ── 3 · 液态玻璃（${glass.length} 个共享样式，来自 kit 的 layerStyles）────────────\n`
      + ' * kit 里每个玻璃样式都带 isCustomGlass 的 blur（radius / saturation / distortion / depth）\n'
      + ' * 与 9–12 层阴影。**这些是 Sketch 自家 glass shader 的参数，不是 CSS 的 blur() 等价物** ——\n'
      + ' * distortion / depth / brightness 三样 CSS 的 backdrop-filter 根本做不到。\n'
      + ' * 所以下面按「能映射的映射、映射不了的记下来」处理：\n'
      + ' *   · radius → 只作为 --nx-sk-glass-*-sketch-radius 保留原始值（**不当 CSS blur 用**）\n'
      + ' *   · saturation → 直接可用\n'
      + ' *   · fills / shadows / innerShadows → 逐层写成 CSS 变量，box-shadow 可以还原多层\n'
      + ` */\n`);
    L.push(':root {');
    for (const g of glass) {
      const name = slug(g.name.replace(/^Liquid Glass\//, ''));

      L.push(`  /* ${g.name} */`);
      for (const b of g.blurs) {
        if (b.radius != null) L.push(`  --nx-sk-glass-${name}-sketch-radius: ${b.radius};`);
        if (b.saturation != null) L.push(`  --nx-sk-glass-${name}-saturate: ${b.saturation};`);
        if (b.distortion != null) L.push(`  --nx-sk-glass-${name}-distortion: ${b.distortion};`);
        if (b.depth != null) L.push(`  --nx-sk-glass-${name}-depth: ${b.depth};`);
      }
      g.fills.forEach((f, i) => {
        if (f.hex) L.push(`  --nx-sk-glass-${name}-fill-${i + 1}: ${f.hex};`);
      });
      if (g.shadows?.length) {
        L.push(`  --nx-sk-glass-${name}-shadow: ${g.shadows.map(
          (s) => `${s.x}px ${s.y}px ${s.blur ?? 0}px ${s.spread}px ${s.color}`).join(', ')};`);
      }
      if (g.innerShadows?.length) {
        L.push(`  --nx-sk-glass-${name}-inner: ${g.innerShadows.map(
          (s) => `inset ${s.x}px ${s.y}px ${s.blur ?? 0}px ${s.spread}px ${s.color}`).join(', ')};`);
      }
    }
    L.push('}');
  }

  // ── 4 · 组件几何 ──
  /*
   * 从符号表抽「组件 × 尺寸档 → 高（与常见宽）」。
   *
   * kit 的符号命名是 `页/主题/区域/尺寸档/状态`，尺寸档形如 `2 Sm` / `3 Rg` / `4 Lg` / `5 XL`。
   * 同尺寸档下同一个组件会有几十个变体（状态 × 是否有图标 × 明暗），它们的高度一致 ——
   * 所以这里对每个 (页, 尺寸档) 取**众数高度**，那才是规格；个别是特例（比如带两行文字的
   * 灵活高度按钮），被众数自然地过滤掉。
   *
   * 只取高度与「最小的出现次数 ≥ 2」的档：孤例多半是拼合件或示例，不是组件规格。
   */
  /* 两个 kit 的尺寸档写法不同：
       macOS：`5 XL` / `4 Lg` / `3 Rg` / `2 Sm`（序号 + 简写）
       iOS  ：`Large` / `Medium` / `Small`（整词，没有序号）
     所以匹配要同时认两种 —— 只写第一种时 iOS 侧一条都抽不到（实测 0 条）。 */
  const SIZE_WORDS = 'Mn|Mini|Sm|Small|Rg|Regular|Md|Medium|Lg|Large|XL|XLarge';
  const SIZE_TOKENS = new RegExp(`^(?:[1-9]\\s+)?(${SIZE_WORDS})$`, 'i');
  const SIZE_KEY = { mn: 'mn', mini: 'mn', sm: 'sm', small: 'sm', rg: 'rg', regular: 'rg', md: 'rg', medium: 'rg', lg: 'lg', large: 'lg', xl: 'xl', xlarge: 'xl' };
  const buckets = new Map();   // `${page}|${size}` → [heights]
  for (const page of kit.pages) {
    for (const sym of page.symbols ?? []) {
      if (!sym.height || sym.class !== 'symbolMaster') continue;
      /* 尺寸档**不一定在第二段**：macOS 是 `Buttons/5 XL/…`，
         iOS 是 `Buttons/Dark/Large/Bordered/Symbol/1 - Idle` —— 它在区域段之后。
         早期版本只取「找到的第一个匹配段」，iOS 因此只抽到 7 条（实测）。
         现在扫全部分段，取**第一个**匹配的（越靠前越像尺寸档）。 */
      const seg = sym.name.split('/').map((x) => x.trim());
      const sizeSeg = seg.find((x) => SIZE_TOKENS.test(x));
      /* 没有尺寸档时**不跳过**，归到 `default` —— iOS 只有 289/1857 个符号在名字里
         带尺寸档（实测），其余组件（Sheets / Tab Bars / Lists / Alerts…）用别的命名。
         早期版本直接 continue，于是 iOS 侧只抽到 7 条，等于把大半个 kit 丢了。 */
      const size = sizeSeg ? SIZE_KEY[sizeSeg.match(SIZE_TOKENS)[1].toLowerCase()] : 'default';
      // 区域段：`Content Area` / `Toolbar` … 只在名字里有的时候用，否则归 content
      const areaSeg = seg.find((x) => /^(Content Area|Toolbar|Over Glass|Menus|Sidebar|Window|Navigation Bar|Status Bar)$/i.test(x));
      const pageKey = slug(page.name).replace(/^\d+-/, '').slice(0, 28);
      const area = areaSeg ? slug(areaSeg) : 'content';
      const key = `${pageKey}|${area}|${size}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(Math.round(sym.height));
    }
  }

  const geometry = [];
  for (const [key, hs] of buckets) {
    const count = new Map();
    for (const h of hs) count.set(h, (count.get(h) ?? 0) + 1);
    const [h, n] = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
    if (n < 2) continue;                    // 孤例不是规格
    const [page, area, size] = key.split('|');
    geometry.push({ page, area, size, height: h, observed: n, total: hs.length });
  }
  geometry.sort((a, b) => a.page.localeCompare(b.page) || a.area.localeCompare(b.area) || a.size.localeCompare(b.size));

  if (geometry.length) {
    L.push(`\n/* ── 4 · 组件几何（${geometry.length} 条，从 kit 符号表抽取）─────────────────\n`
      + ' * 每条 = 「某组件的某个尺寸档有多高」，取的是该档下所有变体的**众数**高度。\n'
      + ' * observed/total 是众数的出现数/该档变体总数 —— 两者接近说明这个高度是规格；\n'
      + ' * 差距大说明该档混了不同形状（例如带两行的灵活高度按钮），引用时要留意。\n'
      + ' * 用法：\`--nx-sk-c-<page>-<area>-<size>-h\`。\n'
      + ' */\n');
    L.push(':root {');
    for (const g of geometry) {
      L.push(`  --nx-sk-c-${g.page}-${g.area}-${g.size}-h: ${g.height}px;   /* ${g.observed}/${g.total} 变体同高 */`);
    }
    L.push('}');
  }

  // ── 4 · 统计脚注 ──
  L.push(`\n/* 生成统计：色板 ${kit.swatches.length} · 字体样式 ${kit.textStyles.length}（默认档 ${ts.length}）`
    + ` · 共享样式 ${kit.layerStyles.length}（玻璃 ${glass.length}）· 组件符号 ${kit.pages.reduce((n, p) => n + p.symbols.length, 0)}\n`
    + '   还有 Loose / Tight Leading 两套行高变体与 Bold / Italic 字重轴没落到变量里 ——\n'
    + `   规格在 design/apple/sketch/${id}.json 里，需要时按同样方式补。 */\n`);

  return { css: L.join('\n'), stats: { swatches: kit.swatches.length, ts: ts.length, variants: variants.length, glass: glass.length, geometry: geometry.length, file: `design/v5/sketch-${kebab}.css` } };
}

mkdirSync(OUT, { recursive: true });
const results = [
  generate({ id: 'macos', form: 'web', kitLabel: 'macOS' }),
  generate({ id: 'ios', form: 'pwa', kitLabel: 'iOS' }),
];

for (const r of results) {
  const p = join(ROOT, r.stats.file);
  writeFileSync(p, r.css);
  console.log(`写 ${r.stats.file}  （色板 ${r.stats.swatches} · 字体样式 ${r.stats.ts}+${r.stats.variants} · 玻璃 ${r.stats.glass} · 组件几何 ${r.stats.geometry}）`);
}
console.log('\n下一步：把这两份接进 `app/design/v5-forms.css`（或让 web/pwa 的 tokens.css 指向 --nx-sk-*）。');
