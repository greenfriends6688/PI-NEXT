// 图标名门禁：产品里每个 <i data-ico="x"> / data-ico={"x"} 的名字都必须存在于设计系统的
// lucide 路径表 design/pi-web-design/assets/icons.js 里。
//
// 为什么需要：图标是 `<i data-ico>` 占位 + 客户端水合（components/PwIcons.tsx），
// 名字写错不会报错、不会崩，只会「渲染出一个空格子」——静态检查抓不到，只有这里能抓。
//
// 用法：node scripts/check-icons.mjs          全量
//      node scripts/check-icons.mjs <文件...> 只查指定文件
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ICONS = join(ROOT, "design/pi-web-design/assets/icons.js");

const known = new Set();
{
  const src = readFileSync(ICONS, "utf8");
  const start = src.indexOf("var PATHS = {");
  const body = src.slice(start);
  for (const m of body.matchAll(/^\s*"([a-z0-9-]+)":/gm)) known.add(m[1]);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(p);
  }
  return out;
}


// 注释里提到画板写法（例如「结构与 20-composer.html 一字不差：<i data-ico="arrow-up|square">」）
// 不是真实用法，先剥掉块注释与行注释再扫，否则门禁会误报。
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => {
      const at = line.indexOf("//");
 return at === -1 ? line : line.slice(0, at);
 })
    .join("\n");
}
const targets = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [join(ROOT, "components"), join(ROOT, "app"), join(ROOT, "hooks"), join(ROOT, "lib")].flatMap((d) =>
      statSync(d, { throwIfNoEntry: false }) ? walk(d) : [],
    );

const bad = [];
let used = 0;
for (const file of targets) {
  const src = stripComments(readFileSync(file, "utf8"));
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/data-ico=(?:"([^"]*)"|\{\s*"([^"]*)"\s*\})/g)) {
      const name = m[1] ?? m[2];
      if (!name) continue;
      used++;
      if (!known.has(name)) bad.push(`${file.slice(ROOT.length + 1)}:${i + 1}  ${name}`);
    }
  });
}

if (bad.length) {
  console.error(`✖ 图标名门禁：${targets.length} 个文件，${used} 处 data-ico，其中 ${bad.length} 个名字不在 icons.js：`);
  for (const line of bad) console.error("   " + line);
  process.exit(1);
}
console.log(`✓ 图标名门禁：${targets.length} 个文件，${used} 处 data-ico，全部命中 icons.js（${known.size} 个可用名）`);
