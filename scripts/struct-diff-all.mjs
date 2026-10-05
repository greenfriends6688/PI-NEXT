#!/usr/bin/env node
/* fork:v5-landing —— 跑全部 struct-spec，出一张「板 ↔ 产品 逐帧偏差总表」。
 * 跑法：node scripts/struct-diff-all.mjs [--only 前缀]
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC_DIR = join(HERE, "struct-specs");
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : "";

const specs = readdirSync(SPEC_DIR)
  .filter((f) => f.endsWith(".mjs"))
  /* 共享驱动片段 / 转储脚本不是 spec：它们没有 default 导出，跑起来只会得到 -1，
     混在总表里会把「收敛 33/100」这类数字算错（分母虚高）。逐个排除，名单写死。 */
  .filter((f) => !/^_/.test(f))
  .filter((f) => !/(^|-)dump\.mjs$|-lib\.mjs$|^shell-all\.mjs$/.test(f))
  .filter((f) => !only || f.startsWith(only))
  .sort();

const rows = [];
let failed = 0;
for (const s of specs) {
  const res = spawnSync(process.execPath, [join(HERE, "struct-diff.mjs"), join(SPEC_DIR, s)], {
    cwd: resolve(HERE, ".."), encoding: "utf8",
  });
  const out = `${res.stdout ?? ""}`;
  const line = out.split("\n").find((l) => /节点 · 偏差/.test(l)) ?? "";
  const m = line.match(/板 (\d+) 节点 \/ 产品 (\d+) 节点 · 偏差 (\d+)/);
  const ok = res.status === 0;
  if (!ok) failed += 1;
  rows.push({ spec: s, dev: m ? Number(m[3]) : -1, board: m ? Number(m[1]) : -1, app: m ? Number(m[2]) : -1, ok });
  process.stdout.write(ok ? "." : "x");
}

console.log("\n\n══ 逐帧偏差总表（0 = 该帧板面与产品结构一致）══");
for (const r of rows.sort((a, b) => b.dev - a.dev)) {
  const flag = r.ok ? "✓" : "✗";
  console.log(`${flag} ${r.spec.padEnd(30)} 板${String(r.board).padStart(4)} 产品${String(r.app).padStart(4)}  偏差 ${r.dev}`);
}
const zero = rows.filter((r) => r.dev === 0).length;
console.log(`\n收敛 ${zero}/${rows.length} 帧 · 仍有偏差 ${rows.length - zero} 帧`);
