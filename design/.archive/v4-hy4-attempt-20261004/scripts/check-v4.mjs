#!/usr/bin/env node
/* ===========================================================================
 * PI NEXT · 设计体系 v4 · 静态校验 —— scripts/check-v4.mjs
 *
 * 跑法：node design/v4/scripts/check-v4.mjs
 * 退出码：0 全过 / 1 有错。
 *
 * 它拦的是「上次翻车」的四类形态：
 *   ① 未定义令牌 —— 画板/组件用了某个 var(--x) 但没有任何文件定义它（改一处只对一半）。
 *   ② 类前缀混用 —— Web 画板里出现 m-* 类 / PWA 画板里出现 d-* 类
 *      （两套形态只挂一套，混用等于两个来源）。
 *   ③ 用了 system.css / base.css 里没定义的类（写了样式但不生效 = 静默失效）。
 *   ④ data-demo-* 声明了但没有对应目标（「写了属性但没接上」）。
 *   另查：图标名必须在 icons.js 里、零 emoji、标签平衡、内联样式里不许出现设计值。
 * =========================================================================== */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const V4 = dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, "");
const ROOT = join(V4, "..", "..");
const ICONS = join(ROOT, "design", "pi-web-design", "assets", "icons.js");

const errors = [];
const warns = [];
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");

/* ── 1 · 令牌清单 ─────────────────────────────────────────────────────── */
const baseCss = read(join(V4, "base.css"));
const webCss = read(join(V4, "web", "tokens.css")) + read(join(V4, "web", "system.css"));
const pwaCss = read(join(V4, "pwa", "tokens.css")) + read(join(V4, "pwa", "system.css"));

const tokensIn = (css) => new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
const T_BASE = tokensIn(baseCss);
const T_WEB = tokensIn(webCss);
const T_PWA = tokensIn(pwaCss);

/* ── 2 · 类清单 ───────────────────────────────────────────────────────── */
/* 复合选择器（.w-row.is-on）里的每个类都要收进来；小数（1.5px）靠「点前是数字」排除。 */
const classesIn = (css) =>
  new Set([...css.matchAll(/(?<![\d])\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
const C_BASE = classesIn(baseCss);
const C_WEB = classesIn(webCss);
const C_PWA = classesIn(pwaCss);

/* ── 3 · 图标清单 ─────────────────────────────────────────────────────── */
const iconSrc = read(ICONS);
const ICON_NAMES = new Set([...iconSrc.matchAll(/^  "([a-z0-9-]+)":/gm)].map((m) => m[1]));

/* ── 4 · 逐张画板 ─────────────────────────────────────────────────────── */
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

function boards(form) {
  const dir = join(V4, form, "boards");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".html")).map((f) => join(dir, f));
}

function checkBoard(file, form) {
  const html = read(file);
  const name = basename(file);
  const allowedTokens = new Set([...T_BASE, ...(form === "web" ? T_WEB : T_PWA)]);
  const allowedClasses = new Set([...C_BASE, ...(form === "web" ? C_WEB : C_PWA)]);
  const prefix = form === "web" ? "d-" : "m-";
  const other = form === "web" ? "m-" : "d-";

  /* ① 未定义令牌 */
  for (const m of html.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
    if (!allowedTokens.has(m[1])) errors.push(`${name}: 未定义令牌 var(${m[1]})`);
  }

  /* ② 类前缀混用 + ③ 未定义类 */
  const seen = new Set();
  for (const m of html.matchAll(/class="([^"]*)"/g)) {
    for (const cls of m[1].split(/\s+/).filter(Boolean)) {
      if (cls.startsWith(other)) {
        errors.push(`${name}: ${form} 画板里出现 ${other} 类「${cls}」（两套形态不许混用）`);
      }
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
  if (EMOJI.test(html)) {
    const hit = html.match(EMOJI)[0];
    errors.push(`${name}: 出现 emoji「${hit}」（全系统零 emoji，图标一律 lucide）`);
  }

  /* 内联样式里不许出现设计值。只在「设计属性被赋了字面量」时判错：
     画板取景框的视口尺寸（height/width）、1px 发丝边都算家具，放行。 */
  const BAD_INLINE = /(border-radius|font-size|padding(?:-[a-z]+)?|margin(?:-[a-z]+)?|gap|row-gap|column-gap)\s*:[^;"]*\b\d+(?:\.\d+)?px/;
  for (const m of html.matchAll(/style="([^"]*)"/g)) {
    const s = m[1];
    if (/#[0-9a-fA-F]{3,8}\b/.test(s)) {
      errors.push(`${name}: 内联样式出现颜色字面量 —— ${s.slice(0, 60)}`);
    }
    const bad = s.match(BAD_INLINE);
    if (bad) {
      errors.push(`${name}: 内联样式给设计属性写了字面量「${bad[0]}」（应用 token）`);
    }
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
  const appendFrom = has(/data-demo-append-from="#([^"]+)"/g);
  for (const t of appendFrom) {
    if (!ids.has(t)) errors.push(`${name}: data-demo-append-from="#${t}" 模板不存在`);
  }
  const panes = new Set(has(/data-demo-pane="([^"]+)"/g));
  const tabs = has(/data-demo-tab="([^"]+)"/g);
  for (const t of tabs) {
    if (panes.size && !panes.has(t)) errors.push(`${name}: data-demo-tab="${t}" 没有对应的 pane`);
  }
  /* 有页签就必须有 scope —— 否则 pane 找不到（2026-10-04 真实踩过：scope 挂在了页签条自己身上，
     而 pane 是它的兄弟节点，切换静默失效）。浏览器侧 .scratch/v3-all.mjs 会再真点一次确认。 */
  if (tabs.length && !/data-demo-scope/.test(html)) {
    errors.push(`${name}: 有 data-demo-tabs 但全页没有 data-demo-scope（pane 定位不到）`);
  }

  /* 标签平衡（粗查）*/
  const open = (html.match(/<(div|section|aside|main|header|nav|button|span|ul|li|p|template)\b/g) || []).length;
  const close = (html.match(/<\/(div|section|aside|main|header|nav|button|span|ul|li|p|template)>/g) || []).length;
  if (open !== close) warns.push(`${name}: 标签开合数不等（开 ${open} / 合 ${close}），请人工确认`);
}

/* ── 5 · 跑 ───────────────────────────────────────────────────────────── */
if (!existsSync(ICONS)) warns.push("找不到 icons.js，图标校验跳过");
const webBoards = boards("web");
const pwaBoards = boards("pwa");
webBoards.forEach((f) => checkBoard(f, "web"));
pwaBoards.forEach((f) => checkBoard(f, "pwa"));

/* ⑤ system.css 自身不许引用未定义令牌 */
for (const [form, css] of [["web", webCss], ["pwa", pwaCss]]) {
  const allowed = new Set([...T_BASE, ...(form === "web" ? T_WEB : T_PWA)]);
  for (const m of css.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
    if (!allowed.has(m[1])) errors.push(`${form}/system.css: 未定义令牌 var(${m[1]})`);
  }
}

/* ⑥ 两套形态必须定义同一批「角色」令牌（防漂移）*/
const ROLES = ["--nx-ui", "--nx-r-xs", "--nx-r-sm", "--nx-r-md", "--nx-r-lg", "--nx-r-xl", "--nx-r-2xl",
  "--nx-ctl-xs", "--nx-ctl-sm", "--nx-ctl-md", "--nx-ctl-lg", "--nx-touch-min",
  "--nx-canvas", "--nx-panel", "--nx-sidebar", "--nx-surface", "--nx-surface-hi", "--nx-selected",
  "--nx-line", "--nx-line-hi", "--nx-text", "--nx-text-2", "--nx-text-3",
  "--nx-accent", "--nx-accent-fg", "--nx-accent-soft", "--nx-ring",
  "--nx-success", "--nx-warning", "--nx-danger", "--nx-info",
  "--nx-diff-add", "--nx-diff-del", "--nx-sh-1", "--nx-sh-2", "--nx-glass",
  "--nx-code-bg", "--nx-code-line", "--nx-code-key", "--nx-code-str", "--nx-code-num", "--nx-code-com"];
for (const role of ROLES) {
  if (!T_WEB.has(role)) errors.push(`web/tokens.css 缺角色令牌 ${role}`);
  if (!T_PWA.has(role)) errors.push(`pwa/tokens.css 缺角色令牌 ${role}`);
}

/* ── 6 · 报告 ─────────────────────────────────────────────────────────── */
console.log(`v4 校验：web ${webBoards.length} 张画板 / pwa ${pwaBoards.length} 张画板`);
console.log(`令牌：base ${T_BASE.size} · web ${T_WEB.size} · pwa ${T_PWA.size}`);
console.log(`类：base ${C_BASE.size} · web ${C_WEB.size} · pwa ${C_PWA.size}`);
console.log(`图标库：${ICON_NAMES.size} 个`);
if (warns.length) {
  console.log(`\n警告 ${warns.length} 条：`);
  warns.forEach((w) => console.log("  ! " + w));
}
if (errors.length) {
  console.log(`\n错误 ${errors.length} 条：`);
  errors.forEach((e) => console.log("  × " + e));
  process.exit(1);
}
console.log("\n0 个错误。");
