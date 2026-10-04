// 跑**全部** board-specs 的对位。
//
// 为什么补这个：`board-diff.mjs` 是单 spec 的顶层脚本（要一个参数），
// 而 `package.json` 的 `verify:boards` 一直写成 `... && node scripts/board-diff.mjs`
// —— 不带参数时它只打印「用法」并 `exit 2`。于是**整条 live 几何对位从来没真正跑过**，
// 只有人手动单跑某个 spec 时才生效。画板与实现的漂移就是这么攒下来的。
//
// 用法：node scripts/board-diff-all.mjs [--only <子串>]
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SPEC_DIR = join(HERE, "board-specs");

const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;

const specs = readdirSync(SPEC_DIR)
  .filter((f) => f.endsWith(".mjs"))
  .filter((f) => !only || f.includes(only))
  .sort();

if (specs.length === 0) {
  console.error(only ? `没有匹配 "${only}" 的 spec` : "board-specs 目录是空的");
  process.exit(2);
}

let failed = 0;
const summary = [];

for (const spec of specs) {
  const res = spawnSync(
    process.execPath,
    [join(HERE, "board-diff.mjs"), join(SPEC_DIR, spec)],
    { cwd: ROOT, encoding: "utf8", env: process.env },
  );
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  process.stdout.write(out);
  const line = out.split("\n").find((l) => /项一致/.test(l))?.trim() ?? "（无结果）";
  summary.push([spec, res.status === 0 ? "OK" : "FAIL", line]);
  if (res.status !== 0) failed += 1;
}

console.log("\n════ 汇总 ════");
for (const [spec, status, line] of summary) {
  console.log(`${status === "OK" ? "✓" : "✗"} ${spec.padEnd(38)} ${line}`);
}

/* 覆盖盘点：对位是按画板逐个建的（没有「全量自动」这回事——选择器必须一板一配）。
   这里只把**还没 spec 的画板**列出来，不判失败：改到哪张画板就补哪张的 spec，
   否则又回到「没有任何仲裁者」的老路（详见 board-diff.mjs 头部）。 */
const BOARD_DIR = join(ROOT, "design/pi-web-design");
/* fork:v5-boards（2026-10-04）—— 覆盖盘点要**两代画板一起认**：
 * 原来这里只 `readdirSync(design/pi-web-design)` 再按 `/^\d\d.*\.html$/` 过滤，
 * 于是 v5 板（D-01…D-30 / M-01…M-12）永远不进分母，写了 v5 spec 也看不出覆盖了没有
 * —— 盘点给出的「全覆盖」结论对新体系是假的。
 * spec 的 board 字段带斜杠时按 `design/` 解析（board-diff.mjs 的 boardPath 已是这个口径），
 * 这里用同一个函数，两边必须同源，否则盘点与实际跑的板对不上。 */
const DESIGN_DIR = join(ROOT, "design");
const boardPath = (board) =>
  board.includes("/") ? join(DESIGN_DIR, board) : join(BOARD_DIR, board);
const v1Boards = readdirSync(BOARD_DIR).filter((f) => /^\d\d.*\.html$/.test(f));
const v5Boards = [];
for (const form of ["web", "pwa"]) {
  const dir = join(DESIGN_DIR, "v5", form, "boards");
  let files = [];
  try { files = readdirSync(dir); } catch { continue; }
  for (const f of files.filter((f) => /^[DM]-\d.*\.html$/.test(f))) {
    v5Boards.push(`v5/${form}/boards/${f}`);
  }
}
const specBoards = new Set();
for (const spec of specs) {
  const mod = await import(pathToFileURL(join(SPEC_DIR, spec)).href);
  if (mod.default?.board) specBoards.add(mod.default.board);
}
const allBoards = [...v1Boards, ...v5Boards].sort();
const uncovered = allBoards.filter((f) => !specBoards.has(f));
const coveredV5 = v5Boards.filter((f) => specBoards.has(f)).length;
const coveredV1 = v1Boards.filter((f) => specBoards.has(f)).length;
console.log(`\n对位覆盖：${specBoards.size}/${allBoards.length} 张画板`
  + `（v1 ${coveredV1}/${v1Boards.length} · v5 ${coveredV5}/${v5Boards.length}）`);
if (uncovered.length) console.log(`未覆盖（改到就补）：${uncovered.join(" ")}`);

console.log(`\n${summary.length} 份 spec，${failed} 份不符`);
process.exit(failed ? 1 : 0);
