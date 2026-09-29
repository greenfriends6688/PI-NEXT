// 画板静态校验：图标是否注册 / 是否出现 emoji / 是否引用了未定义的 CSS 变量 / 标签是否平衡
// 用法：node scripts/check-boards.mjs
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(here, "..");
const ASSETS = join(DIR, "assets");

const iconsSrc = readFileSync(join(ASSETS, "icons.js"), "utf8");
const registered = new Set(
  [...iconsSrc.matchAll(/^\s{2}"([^"]+)":/gm)].map((m) => m[1]),
);

const tokensSrc = readFileSync(join(ASSETS, "tokens.css"), "utf8");
const definedVars = new Set([...tokensSrc.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));

const boardSrc = readFileSync(join(ASSETS, "board.css"), "utf8");
for (const m of boardSrc.matchAll(/(--[a-z0-9-]+)\s*:/g)) definedVars.add(m[1]);

// 允许：局部内联的自定义属性（如 --p）
const LOCAL_OK = new Set(["--p"]);

// 允许：出现在**内容**里的产品真实变量名（代码样例 / 终端输出），不是画板自己的样式引用
const CONTENT_OK = new Set(["--color-accent-600", "--color-text-white"]);

// emoji 判定：图形化 emoji 一律禁止；但终端输出与代码样例里合法的印刷符号放行
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
const TYPO_OK = new Set([..."✓✔✗✘✕☑☐←→↑↓·—…⏎×÷≥≤≠√∞∑∫"]);

const files = readdirSync(DIR).filter((f) => f.endsWith(".html")).sort();
let errors = 0;
let warnings = 0;

for (const f of files) {
  const src = readFileSync(join(DIR, f), "utf8");
  const rel = f;

  // 1. 图标
  const used = [...src.matchAll(/data-ico="([^"]+)"/g)].map((m) => m[1]);
  const unknown = [...new Set(used)].filter((n) => !registered.has(n));
  if (unknown.length) {
    console.log(`✗ ${rel} 未注册图标: ${unknown.join(", ")}`);
    errors += unknown.length;
  }

  // 2. emoji（放行终端输出里合法的印刷符号）
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    const m = line.match(EMOJI);
    if (m && !TYPO_OK.has(m[0])) {
      console.log(`✗ ${rel}:${i + 1} 出现 emoji「${m[0]}」`);
      errors++;
    }
  });

  // 3. CSS 变量
  const varsUsed = [...src.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]);
  const badVars = [...new Set(varsUsed)].filter(
    (v) => !definedVars.has(v) && !LOCAL_OK.has(v) && !CONTENT_OK.has(v),
  );
  if (badVars.length) {
    console.log(`✗ ${rel} 未定义变量: ${badVars.join(", ")}`);
    errors += badVars.length;
  }

  // 4. 标签平衡（只看 div/section/span/aside/main/table 这类成对的）
  for (const tag of ["div", "section", "aside", "main", "span", "table", "ul", "ol", "li"]) {
    const open = (src.match(new RegExp(`<${tag}[\\s>]`, "g")) || []).length;
    const close = (src.match(new RegExp(`</${tag}>`, "g")) || []).length;
    if (open !== close) {
      console.log(`! ${rel} <${tag}> 开 ${open} / 闭 ${close}`);
      warnings++;
    }
  }
}

console.log(`\n扫描 ${files.length} 个画板：${errors} 个错误，${warnings} 个标签警告`);
process.exit(errors ? 1 : 0);
