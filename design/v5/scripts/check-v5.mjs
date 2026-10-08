#!/usr/bin/env node
/* ===========================================================================
 * PI NEXT · 设计体系 v5 · 静态门禁 —— design/v5/scripts/check-v5.mjs
 *
 * 跑法：node design/v5/scripts/check-v5.mjs   （退出码 0 = 全过）
 *
 * 它拦的六类「看起来对、其实已经坏了」：
 *   ① 未定义令牌      var(--x) 没有任何文件定义      → 改一处只对一半
 *   ② 前缀混用        web 画板出现 m-* / pwa 出现 d-*  → 运行时只挂一套形态
 *   ③ 未定义类        写了样式不生效（静默）        → 必须先进 system.css
 *   ④ 未接线          data-demo-* 声明了但没有目标     → 「写了属性没接上」
 *   ⑤ 比例带单位      calc(长度 * 4px) 整条属性失效    → v4 基座就中过这条（字阶全死）
 *   ⑥ 角色令牌缺项    两套形态必须定义同一批角色名   → 形态漂移
 * 外加：图标名必须在 icons.js、零 emoji、内联样式不许写设计值、标签开合、README 清单一致。
 *
 * 判定口径全部是「机器可复算」的，不含任何需要人眼判断的项 ——
 * 人眼判断就是上一轮「两套东西」的入口。
 * =========================================================================== */
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const V5 = dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, "");
const ROOT = join(V5, "..", "..");
const ICONS = join(ROOT, "design", "pi-web-design", "assets", "icons.js"); // 图标只有一份真值，不复制

const errors = [];
const warns = [];
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");

/* ── 1 · 令牌清单 ─────────────────────────────────────────────────────────── */
const baseCss = read(join(V5, "base.css"));
/* fork:apple-sketch（2026-10-08）—— `sketch-*.css` 是**从 Apple 官方 UI Kit 生成**的
   数值层（`--nx-sk-*`）。角色层 tokens.css 现在指向它，所以校验读取时必须把它算进来，
   否则每一条 `var(--nx-sk-…)` 都会被判成「未定义令牌」。
   生成物由 `npm run sketch:tokens` 刷新，不手改。 */
const sketchMac = read(join(V5, "sketch-macos.css"));
const sketchIos = read(join(V5, "sketch-ios.css"));
const webTokens = read(join(V5, "web", "tokens.css"));
const webCss = sketchMac + webTokens + read(join(V5, "web", "system.css"));
const pwaTokens = read(join(V5, "pwa", "tokens.css"));
const pwaCss = sketchIos + pwaTokens + read(join(V5, "pwa", "system.css"));

/* 令牌定义 = 「名字 + 值」。值本身也是判定材料（⑤ 要用），所以留 map。 */
function tokens(css) {
  const map = new Map();
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) map.set(m[1], m[2].trim());
  return map;
}
const T_BASE = tokens(baseCss);
const T_WEB = tokens(webCss);
const T_PWA = tokens(pwaCss);
const T_WEB_ONLY = tokens(webTokens);
const T_PWA_ONLY = tokens(pwaTokens);

/* ── 2 · 类清单 ─────────────────────────────────────────────────────────── */
const classesIn = (css) =>
  new Set([...css.matchAll(/(?<![\d])\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
const C_BASE = classesIn(baseCss);
const C_WEB = classesIn(webCss);
const C_PWA = classesIn(pwaCss);

/* ── 3 · 图标清单 ───────────────────────────────────────────────────────── */
const iconSrc = read(ICONS);
const ICON_NAMES = new Set([...iconSrc.matchAll(/^  "([a-z0-9-]+)":/gm)].map((m) => m[1]));

/* ── 3b · ⑤ 比例令牌必须无单位 ───────────────────────────────────────────────
 * v4 基座的真实事故：`--nx-r-xs` 先被当成字阶比例 0.79 定义，又被当成圆角 4px 定义，
 * 后者赢 → `--nx-fs-xs: calc(14px * 4px)` 无效 → 6 档字阶全部退回继承值，
 * 而 check-v4 只查「有没有定义」，一路绿灯。 */
const LENGTH_UNIT = /^-?[\d.]+(px|rem|em|%|vh|vw|ch|ex|pt|pc)$/;
for (const [map, where] of [[T_BASE, "base.css"], [T_WEB_ONLY, "web/tokens.css"], [T_PWA_ONLY, "pwa/tokens.css"]]) {
  for (const [name, value] of map) {
    if (name.startsWith("--nx-f-") && LENGTH_UNIT.test(value)) {
      errors.push(`${where}: 比例令牌 ${name} 带单位（${value}）—— calc(长度 × 带单位) 整条属性会失效`);
    }
  }
}
/* 每个字阶的 calc 必须真的能算：`*` 与 `/` 右侧的比例操作数必须无单位且有定义。
   （`*` 左侧是 --nx-ui，那是长度，允许带单位 —— 判错方向搞反就会把基准字号也报错。） */
for (const [name, value] of T_BASE) {
  if (!name.startsWith("--nx-fs-") || !value.includes("calc(")) continue;
  for (const m of value.matchAll(/[*\/]\s*var\(\s*(--[a-z0-9-]+)/g)) {
    const ratio = m[1];
    const v = T_BASE.get(ratio) ?? T_WEB.get(ratio) ?? T_PWA.get(ratio);
    if (v === undefined) errors.push(`base.css: ${name} 用到的比例 ${ratio} 没有任何地方定义`);
    else if (LENGTH_UNIT.test(v)) errors.push(`base.css: ${name} 的比例 ${ratio}=${v} 带单位 → 该字阶失效`);
  }
}

/* ── 4 · 逐张画板 ───────────────────────────────────────────────────────── */
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

function boards(form) {
  const dir = join(V5, form, "boards");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".html")).sort().map((f) => join(dir, f));
}

const boardInventory = [];

function checkBoard(file, form) {
  const html = read(file);
  const name = basename(file);
  boardInventory.push({ form, name });
  const allowedTokens = new Set([...T_BASE.keys(), ...(form === "web" ? T_WEB : T_PWA).keys()]);
  const allowedClasses = new Set([...C_BASE, ...(form === "web" ? C_WEB : C_PWA)]);
  const other = form === "web" ? "m-" : "d-";

  /* ① 未定义令牌 */
  for (const m of html.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
    if (!allowedTokens.has(m[1])) errors.push(`${name}: 未定义令牌 var(${m[1]})`);
  }

  /* ② 前缀混用 + ③ 未定义类 */
  const seen = new Set();
  for (const m of html.matchAll(/class="([^"]*)"/g)) {
    for (const cls of m[1].split(/\s+/).filter(Boolean)) {
      if (cls.startsWith(other)) errors.push(`${name}: ${form} 画板里出现 ${other} 类「${cls}」（两套形态不许混用）`);
      if (!allowedClasses.has(cls) && !seen.has(cls)) {
        seen.add(cls);
        errors.push(`${name}: 用了未定义的类「.${cls}」`);
      }
    }
  }

  /* 图标名 */
  for (const m of html.matchAll(/data-ico="([^"]+)"/g)) {
    if (!ICON_NAMES.has(m[1])) errors.push(`${name}: 图标「${m[1]}」不在 icons.js 里`);
  }

  /* 零 emoji */
  if (EMOJI.test(html)) errors.push(`${name}: 出现 emoji「${html.match(EMOJI)[0]}」（图标一律 lucide）`);

  /* 内联样式不许写设计值（取景框尺寸与 1px 发丝边算家具，放行） */
  const BAD_INLINE = /(border-radius|font-size|box-shadow|padding(?:-[a-z]+)?|margin(?:-[a-z]+)?|(?:row-|column-)?gap)\s*:[^;"]*\b\d+(?:\.\d+)?px/;
  for (const m of html.matchAll(/style="([^"]*)"/g)) {
    const s = m[1];
    if (/#[0-9a-fA-F]{3,8}\b/.test(s)) errors.push(`${name}: 内联样式出现颜色字面量 —— ${s.slice(0, 60)}`);
    const bad = s.match(BAD_INLINE);
    if (bad) errors.push(`${name}: 内联样式给设计属性写了字面量「${bad[0]}」（应用 token）`);
  }

  /* ④ data-demo-* 接线 */
  const has = (re) => [...html.matchAll(re)].map((m) => m[1]);
  const pops = new Set(has(/data-demo-pop="([^"]+)"/g));
  for (const t of has(/data-demo-open="([^"]+)"/g)) {
    if (!pops.has(t)) errors.push(`${name}: data-demo-open="${t}" 没有对应的 data-demo-pop`);
  }
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  for (const t of has(/data-demo-drawer-target="#([^"]+)"/g)) {
    if (!ids.has(t)) errors.push(`${name}: data-demo-drawer-target="#${t}" 目标不存在`);
  }
  for (const t of has(/data-demo-append="(#?[^"]+)"/g)) {
    const id = t.replace(/^#/, "");
    if (!ids.has(id) && !t.startsWith(".")) errors.push(`${name}: data-demo-append="${t}" 目标不存在`);
  }
  for (const t of has(/data-demo-append-from="#([^"]+)"/g)) {
    if (!ids.has(t)) errors.push(`${name}: data-demo-append-from="#${t}" 模板不存在`);
  }
  /* data-demo-pop 的目标必须**声明初始状态**：hidden（默认关）或 .is-open（默认开）。
     两者都不写 = 「默认开但没说」，于是点一下反而把它关掉，shoot 判死件。
     这条形态在 V5 里出现过四次（D-02 / M-05 / D-17 / M-06），直接进门禁。 */
  for (const m of html.matchAll(/<div[^>]*class="(?:d|m)-pop(?:[\s"]|-float)[^"]*"[^>]*data-demo-pop="[^"]*"[^>]*>/g)) {
    const tag = m[0];
    if (!/hidden|is-open/.test(tag)) {
      errors.push(`${name}: data-demo-pop 目标没声明初始状态（缺 hidden 或 .is-open）—— ${tag.slice(0, 70)}`);
    }
  }

  /* data-demo-stream 的值可以是 "#id" 也可以是裸 id（demo.js 两种都能选到），
     所以比较前统一去掉 '#' —— 否则写裸 id 的板会被误报成「目标不存在」（2026-10-04 真实踩过）。 */
  for (const t of has(/data-demo-stream="([^"]+)"/g)) {
    if (!ids.has(t.replace(/^#/, ""))) errors.push(`${name}: data-demo-stream="${t}" 目标不存在`);
  }
  const panes = new Set(has(/data-demo-pane="([^"]+)"/g));
  const tabs = has(/data-demo-tab="([^"]+)"/g);
  for (const t of tabs) if (panes.size && !panes.has(t)) errors.push(`${name}: data-demo-tab="${t}" 没有对应的 pane`);
  if (tabs.length && !/data-demo-scope/.test(html)) {
    errors.push(`${name}: 有 data-demo-tabs 但全页没有 data-demo-scope（pane 定位不到）`);
  }
  /* 页签钮必须真的挂在 data-demo-tabs 容器里 —— 漏了属性，demo.js 的处理器不会绑定，
     点了静默无反应，而 check 只看「有没有 pane」看不出来（2026-10-04 真实踩过）。 */
  for (const m of html.matchAll(/<button[^>]*data-demo-tab="[^"]+"[^>]*>/g)) {
    const before = html.slice(0, m.index);
    const opensBefore = (before.match(/data-demo-tabs/g) || []).length;
    const closesBefore = (before.match(/<\/div>/g) || []).length;
    if (opensBefore === 0) {
      errors.push(`${name}: data-demo-tab 出现在任何 data-demo-tabs 容器之外（处理器不会绑定）`);
      break;
    }
  }

  /* 禁止装饰性左侧彩色边线（2026-10-04 用户裁定：不喜欢）。
     层级靠底色 / 徽章 / 圆点 / 图标表达，不靠竖线。
     只在画板页面的 style 块与内联里查 —— 库里 .d-side/.d-panel 的 1px 分隔线是结构边框，合法。 */
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    const css = m[1];
    if (/border-left\s*:\s*(2px|3px|[4-9]px)/.test(css)) {
      errors.push(`${name}: 板内 style 用了装饰性左边线（${css.match(/border-left[^;]*/)[0]}）—— 用底色或徽章表达层级`);
    }
    if (/box-shadow\s*:\s*inset[^;]*-(2px|3px|4px)/.test(css)) {
      errors.push(`${name}: 板内 style 用了 inset 竖线（${css.match(/box-shadow\s*:\s*inset[^;]*/)[0]}）—— 同上`);
    }
  }
  for (const m of html.matchAll(/style="([^"]*)"/g)) {
    if (/border-left|box-shadow\s*:\s*inset/.test(m[1])) {
      errors.push(`${name}: 内联样式带左边线/inset 竖线 —— ${m[1].slice(0, 60)}`);
    }
  }

  /* 画板头：三标签 + 一句话说明（缺了就无法在 index 里当索引用） */
  if (!/data-board-tags/.test(html)) errors.push(`${name}: 头部缺 data-board-tags（三标签：页面/组件/状态）`);
  if (!/<h1>/.test(html)) errors.push(`${name}: 缺 <h1> 标题`);

  /* 标签平衡（粗查） */
  const open = (html.match(/<(div|section|aside|main|header|nav|button|span|ul|li|p|template)\b/g) || []).length;
  const close = (html.match(/<\/(div|section|aside|main|header|nav|button|span|ul|li|p|template)>/g) || []).length;
  if (open !== close) warns.push(`${name}: 标签开合数不等（开 ${open} / 合 ${close}），请人工确认`);
}

for (const f of boards("web")) checkBoard(f, "web");
for (const f of boards("pwa")) checkBoard(f, "pwa");

/* ── 5 · system.css / tokens.css 自身不许引用未定义令牌 ──────────────────── */
for (const [form, css, allowed] of [
  ["web", webCss, new Set([...T_BASE.keys(), ...T_WEB.keys()])],
  ["pwa", pwaCss, new Set([...T_BASE.keys(), ...T_PWA.keys()])],
]) {
  for (const m of css.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
    if (!allowed.has(m[1])) errors.push(`${form}: 未定义令牌 var(${m[1]})`);
  }
}

/* ── 6 · 两套形态必须定义同一批「角色」令牌（防漂移）───────────────────── */
const ROLES = [
  "--nx-ui",
  "--nx-r-xs", "--nx-r-sm", "--nx-r-md", "--nx-r-lg", "--nx-r-xl", "--nx-r-2xl", "--nx-r-pill",
  "--nx-ctl-xs", "--nx-ctl-sm", "--nx-ctl-md", "--nx-ctl-lg", "--nx-touch-min",
  "--nx-canvas", "--nx-panel", "--nx-sidebar", "--nx-surface", "--nx-surface-hi", "--nx-selected",
  "--nx-line", "--nx-line-hi", "--nx-text", "--nx-text-2", "--nx-text-3",
  "--nx-accent", "--nx-accent-fg", "--nx-accent-soft", "--nx-ring",
  "--nx-success", "--nx-warning", "--nx-danger", "--nx-info",
  "--nx-diff-add", "--nx-diff-del", "--nx-sh-1", "--nx-sh-2", "--nx-glass",
  "--nx-code-bg", "--nx-code-line", "--nx-code-key", "--nx-code-str", "--nx-code-num", "--nx-code-com",
];
for (const role of ROLES) {
  if (!T_WEB_ONLY.has(role)) errors.push(`web/tokens.css 缺角色令牌 ${role}`);
  if (!T_PWA_ONLY.has(role)) errors.push(`pwa/tokens.css 缺角色令牌 ${role}`);
}

/* ── 7 · 清单一致性 ──────────────────────────────────────────────────────
   清单**只有一份来源**：第 7b 段从画板抽出 manifest.json，并回写 README 的清单段，
   index.html 也只读 manifest.json。所以这里不再拿「手写的 README 表格」去比对磁盘
   —— 那种比对本身就是「两套来源」的实现方式：清单一漂就红，而红的原因不是真问题。 */
const readme = read(join(V5, "README.md"));
if (readme && !readme.includes("<!-- boards:start -->")) {
  errors.push("README.md 缺 boards:start 标记（清单段由 check-v5 回写，请勿手改表格）");
}

/* ── 7b · 产出机器清单 manifest.json（index.html 直接读它）─────────────────
   为什么不在 index.html 里手写文件名：手写清单迟早和磁盘上的文件对不上，
   那正是「两套东西」的最小复刻。标题、说明、三标签全部从画板自己的
   <h1> / <p> / .d-tag 里取，所以改画板标题，索引自动跟着变。 */
{
  const strip = (x) => x.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const GROUP = (id) => {
    if (id.startsWith("M-")) return "pwa";
    const n = Number(id.slice(2));
    if (n >= 24 && n <= 29) return "new";
    if (n >= 30 && n <= 33) return "sys";
    if (n >= 7 && n <= 23) return "set";
    return "core";
  };
  const manifest = [];
  for (const form of ["web", "pwa"]) {
    const dir = join(V5, form, "boards");
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".html")).sort()) {
      const html = read(join(dir, f));
      const id = f.split("-").slice(0, 2).join("-");
      const tags = [...html.matchAll(/<span class="(?:d|m)-(?:tag|doc-tag)">([^<]*)<\/span>/g)]
        .map((m) => strip(m[1]));
      manifest.push({
        id,
        file: f,
        form,
        group: GROUP(id),
        title: strip((html.match(/<h1>([\s\S]*?)<\/h1>/) || [, ""])[1]),
        desc: strip((html.match(/<h1>[\s\S]*?<\/h1>\s*<p>([\s\S]*?)<\/p>/) || [, ""])[1]).slice(0, 170),
        tags,
      });
    }
  }
  writeFileSync(join(V5, "manifest.json"),
    JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 16), boards: manifest }, null, 2));

  /* 内联进 index.html —— 用户是**双击打开** index.html 的（file:// 协议），
     fetch("manifest.json") 在 file:// 下必被 CORS 拦掉，页面就一片空白。
     所以清单必须同时以 <script type="application/json"> 的形式内联，
     页面优先读内联、拿不到再退回 fetch。 */
  const indexPath = join(V5, "index.html");
  if (existsSync(indexPath)) {
    const html = read(indexPath);
    const begin = "<!-- manifest:start -->", end = "<!-- manifest:end -->";
    const a = html.indexOf(begin), z = html.indexOf(end);
    if (a >= 0 && z > a) {
      const payload = "<script type=\"application/json\" id=\"v5-manifest\">\n"
        + JSON.stringify(manifest) + "\n</" + "script>";
      /* 这份清单的两条路都要能走通：fetch 那条在 file:// 下必被 CORS 拦。
         缩略图统计（stats.json）**同毛病但后果更重** —— 它原来在同一个 promise 链里，
         一失败就往 catch 跑，把已经渲染好的 Web 卡片整块换成「读不到清单」，
         于是双击打开时只看到 11 张 PWA。所以统计也内联一份。 */
      const statsPath = join(V5, "preview", "stats.json");
      const statsScript = existsSync(statsPath)
        ? `\n<script type="application/json" id="v5-stats">\n${read(statsPath).trim()}\n</` + "script>"
        : "";
      writeFileSync(indexPath, html.slice(0, a + begin.length) + "\n" + payload + statsScript + "\n" + html.slice(z));
    }
  }

  /* 回写 README 的清单段 —— 与 manifest 同一个来源，不留第二份手写清单 */
  const cell = (x) => String(x == null ? "" : x).replace(/\|/g, "\\|").replace(/\n/g, " ");
  const rows = [
    ...manifest.filter((b) => b.form === "web").map((b) => `| \`${b.file}\` | ${cell(b.title)} | ${(b.tags[0] || "").replace(/^页面：/, "")} | ${cell(b.file)} |`),
    ...manifest.filter((b) => b.form === "pwa").map((b) => `| \`${b.file}\` | ${cell(b.title)} | ${(b.tags[0] || "").replace(/^页面：/, "")} | ${cell(b.file)} |`),
  ];
  const table = [
    "| 画板 | 这一张在定什么 | 页面 | 文件 |",
    "|---|---|---|---|",
    ...rows,
  ].join("\n");
  const readmePath = join(V5, "README.md");
  if (existsSync(readmePath)) {
    const md = read(readmePath);
    const a = md.indexOf("<!-- boards:start -->"), z = md.indexOf("<!-- boards:end -->");
    if (a >= 0 && z > a) {
      writeFileSync(readmePath,
        md.slice(0, a + "<!-- boards:start -->".length) + "\n" + table + "\n" + md.slice(z));
    }
  }
}

/* ── 8 · 报告 ─────────────────────────────────────────────────────────── */
console.log(`v5 校验：web ${boardInventory.filter((b) => b.form === "web").length} 张 / pwa ${boardInventory.filter((b) => b.form === "pwa").length} 张`);
console.log(`令牌：base ${T_BASE.size} · web ${T_WEB.size} · pwa ${T_PWA.size}`);
console.log(`类：base ${C_BASE.size} · web ${C_WEB.size} · pwa ${C_PWA.size}`);
console.log(`图标库：${ICON_NAMES.size} 个（唯一真值 ${ICONS.replace(ROOT + "/", "")}）`);
if (warns.length) {
  console.log(`\n警告 ${warns.length} 条：`);
  warns.forEach((w) => console.log("  ! " + w));
}
if (errors.length) {
  console.log(`\n错误 ${errors.length} 条：`);
  for (const e of errors.slice(0, 80)) console.log("  × " + e);
  if (errors.length > 80) console.log(`  … 还有 ${errors.length - 80} 条`);
  process.exit(1);
}
console.log("\n0 个错误。");