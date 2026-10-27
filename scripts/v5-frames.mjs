#!/usr/bin/env node
/* 把 V5 画板拆成「帧清单」：板 → 帧标题 → 节点数 → 用到的 d-/m- 类。
 *   node scripts/v5-frames.mjs [--json] [--board D-02]
 * V5_ROOT 默认指向 下载 里的 0.1.9 包。 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const V5 = process.env.V5_ROOT
  || "C:/Users/Administrator/Downloads/PI-NEXT-0.1.9/PI-NEXT-0.1.9/design/v5";
if (!existsSync(V5)) { console.error(`找不到 V5：${V5}`); process.exit(2); }

const only = process.argv.includes("--board") ? process.argv[process.argv.indexOf("--board") + 1] : null;
const asJson = process.argv.includes("--json");

/* 找 <tag class="…d-frame…"> 的配对边界 */
function endOfElement(html, start, tag) {
  const open = new RegExp(`<${tag}\\b[^>]*>`, "g");
  const close = new RegExp(`</${tag}>`, "g");
  let depth = 0, i = start;
  while (i < html.length) {
    open.lastIndex = close.lastIndex = i;
    const o = open.exec(html), c = close.exec(html);
    if (!c) return html.length;
    if (o && o.index < c.index) { depth++; i = o.index + o[0].length; }
    else { depth--; i = c.index + c[0].length; if (!depth) return i; }
  }
  return html.length;
}

function frames(html, frameCls, labelCls) {
  const out = [];
  const re = /<(div|section|figure)\b[^>]*>/g;
  for (const m of html.matchAll(re)) {
    const tokens = (m[0].match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/);
    if (!tokens.includes(frameCls)) continue;
    const tag = m[1];
    const chunk = html.slice(m.index, endOfElement(html, m.index, tag));
    const label = chunk.match(new RegExp(`class="[^"]*\\b${labelCls}\\b[^"]*"[^>]*>([\\s\\S]*?)<`))?.[1] ?? "";
    const classes = [...chunk.matchAll(/class="([^"]+)"/g)]
      .flatMap((x) => x[1].split(/\s+/)).filter((c) => /^[dm]-/.test(c));
    out.push({
      index: out.length,
      label: label.replace(/<[^>]+>/g, "").trim().slice(0, 34) || `frame ${out.length}`,
      nodes: (chunk.match(/<[a-zA-Z]/g) ?? []).length,
      classes: [...new Set(classes)],
    });
  }
  return out;
}

const forms = [
  { form: "web", dir: join(V5, "web/boards"), frame: "d-frame", label: "d-frame-label" },
  { form: "pwa", dir: join(V5, "pwa/boards"), frame: "m-frame", label: "m-frame-label" },
];
const boards = [];
for (const { form, dir, frame, label } of forms) {
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".html")).sort()) {
    if (only && !file.startsWith(only)) continue;
    boards.push({ form, file, frames: frames(readFileSync(join(dir, file), "utf8"), frame, label) });
  }
}

const total = boards.reduce((n, b) => n + b.frames.length, 0);
if (asJson) {
  console.log(JSON.stringify({ boards, total }, null, 1));
} else {
  console.log(`\nV5：${boards.length} 张板 · ${total} 帧\n`);
  for (const b of boards) {
    console.log(`${b.file.replace(/\.html$/, "")}  ·  ${b.frames.length} 帧`);
    for (const f of b.frames) console.log(`    [${f.index}] ${f.label.padEnd(22)} ${String(f.nodes).padStart(4)} 节点`);
  }
}
