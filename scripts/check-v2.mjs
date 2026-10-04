// v2 设计体系静态校验：图标 / emoji / 未定义令牌 / 标签平衡
// 用法：node scripts/check-v2.mjs
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const V2 = join(ROOT, "design/v2");
// 图标沿用 v1 的那一份（lucide，256 个）—— 两套体系不各自维护图标集
const ICONS = readFileSync(join(ROOT, "design/pi-web-design/assets/icons.js"), "utf8");
const registered = new Set([...ICONS.matchAll(/^\s{2}"([^"]+)":/gm)].map((m) => m[1]));

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
const TYPO_OK = new Set([..."✓✔✗✘✕☑☐←→↑↓·—…⏎×÷≥≤≠√∞∑∫"]);

let errors = 0;
let warnings = 0;

for (const set of ["web", "pwa"]) {
  const dir = join(V2, set);
  if (!existsSync(dir)) continue;
  const prefix = set === "web" ? "--w-" : "--p-";

  // 该体系的令牌定义（tokens.css + system.css 都算）
  const defined = new Set();
  for (const f of ["tokens.css", "system.css"]) {
    const p = join(dir, f);
    if (!existsSync(p)) continue;
    for (const m of readFileSync(p, "utf8").matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(m[1]);
  }

  const boardsDir = join(dir, "boards");
  const files = existsSync(boardsDir) ? readdirSync(boardsDir).filter((f) => f.endsWith(".html")).sort() : [];
  if (files.length === 0) console.log(`  ${set}: 还没有画板`);

  for (const f of files) {
    const src = readFileSync(join(boardsDir, f), "utf8");

    // 1. 图标
    const used = [...src.matchAll(/data-ico="([^"]+)"/g)].map((m) => m[1]);
    const unknown = [...new Set(used)].filter((n) => !registered.has(n));
    if (unknown.length) {
      console.log(`✗ ${set}/${f} 未注册图标: ${unknown.join(", ")}`);
      errors += unknown.length;
    }

    // 2. emoji
    src.split("\n").forEach((line, i) => {
      const m = line.match(EMOJI);
      if (m && !TYPO_OK.has(m[0])) {
        console.log(`✗ ${set}/${f}:${i + 1} 出现 emoji「${m[0]}」`);
        errors++;
      }
    });

    // 3. 令牌：本体系的 var() 必须在本体系 tokens/system.css 里定义过
    const bad = [...new Set([...src.matchAll(/var\((--(?:w|p)-[a-z0-9-]+)/g)].map((m) => m[1]))]
      .filter((v) => !defined.has(v));
    if (bad.length) {
      console.log(`✗ ${set}/${f} 未定义令牌: ${bad.join(", ")}`);
      errors += bad.length;
    }

    // 4. 类名前缀（w- 类不许出现在 pwa 板里，反之亦然）
    const wrongPrefix = set === "web"
      ? [...new Set([...src.matchAll(/class="[^"]*?\b(p-[a-z0-9-]+)/g)].map((m) => m[1]))]
      : [...new Set([...src.matchAll(/class="[^"]*?\b(w-[a-z0-9-]+)/g)].map((m) => m[1]))];
    if (wrongPrefix.length) {
      console.log(`✗ ${set}/${f} 混用了另一体系的类: ${wrongPrefix.slice(0, 6).join(", ")}`);
      errors += wrongPrefix.length;
    }

    // 5. 标签平衡
    for (const tag of ["div", "section", "aside", "main", "span", "ul", "ol", "li", "button", "template"]) {
      const open = (src.match(new RegExp(`<${tag}[\\s>]`, "g")) || []).length;
      const close = (src.match(new RegExp(`</${tag}>`, "g")) || []).length;
      if (open !== close) {
        console.log(`! ${set}/${f} <${tag}> 开 ${open} / 闭 ${close}`);
        warnings++;
      }
    }
  }
  console.log(`  ${set}: ${files.length} 张画板，${defined.size} 个令牌`);
}

console.log(`\nv2 校验：${errors} 个错误，${warnings} 个标签警告`);
process.exit(errors ? 1 : 0);