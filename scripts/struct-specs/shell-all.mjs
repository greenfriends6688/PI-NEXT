// 核心外壳（D-01 / D-02 / D-02b / D-02c / D-02d）逐帧结构核对 —— 批量跑 struct-diff。
//
// 用法：
//   node scripts/struct-specs/shell-all.mjs            # 全量
//   node scripts/struct-specs/shell-all.mjs --json     # 机器可读汇总
//   node scripts/struct-specs/shell-all.mjs sidehead   # 只跑名字里含该词的 spec
//
// 规格文件按「板子 / 帧 / 那一段」命名：shell-<板>-<帧>-<件>.mjs。
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const asJson = process.argv.includes("--json");
const filter = process.argv.slice(2).filter((a) => !a.startsWith("--"))[0] ?? null;

const specs = readdirSync(HERE)
  .filter((f) => f.startsWith("shell-") && f.endsWith(".mjs") && f !== "shell-all.mjs")
  .filter((f) => (filter ? f.includes(filter) : true))
  .sort();

const rows = [];
for (const file of specs) {
  const out = spawnSync(
    process.execPath,
    [join(ROOT, "scripts/struct-diff.mjs"), join(HERE, file), "--json"],
    { encoding: "utf8", maxBuffer: 1 << 26 },
  );
  let parsed;
  try { parsed = JSON.parse(out.stdout); } catch { parsed = { name: file, error: (out.stdout || out.stderr || "").slice(0, 200) }; }
  rows.push({ file, ...parsed });
}

if (asJson) {
  console.log(JSON.stringify(rows.map((r) => ({
    file: r.file, name: r.name, boardNodes: r.boardNodes ?? null,
    appNodes: r.appNodes ?? null, deviations: r.deviations ?? null, error: r.error ?? null,
  })), null, 2));
} else {
  let total = 0;
  for (const r of rows) {
    const d = r.error ? "ERR" : r.deviations;
    total += typeof d === "number" ? d : 0;
    const mark = r.error ? "✗" : d === 0 ? "✓" : "✗";
    console.log(`${mark} ${String(r.file).padEnd(34)} 板 ${String(r.boardNodes ?? "?").padStart(4)} / 产品 ${String(r.appNodes ?? "?").padStart(4)} · 偏差 ${d}${r.error ? ` (${r.error})` : ""}`);
  }
  console.log(`\n共 ${rows.length} 帧 · 偏差合计 ${total}`);
}
process.exit(0);