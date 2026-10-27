#!/usr/bin/env node
/* 按 manifest 重新铺一张多帧画板的空壳（外壳 + 帧标签 + 空槽）。
 *   node scripts/v3-frames-scaffold.mjs --board web-transcript
 *   node scripts/v3-frames-scaffold.mjs --fresh      # 只重铺 HEAD 里没有的新板
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const V3 = join(ROOT, "design/v3");
const manifest = JSON.parse(readFileSync(join(V3, "frames/manifest.json"), "utf8"));

const head = (entry) => `<!doctype html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${entry.title} · Pi Web V3</title>
<link rel="stylesheet" href="../assets/running.css">
<script src="../assets/running.js" defer></script>
<script src="../assets/icons-extra.js" defer></script>
</head>
<body class="board">

<header class="bd-head">
  <span class="bd-num">${entry.form === "pwa" ? "M" : "D"}</span>
  <div>
    <div class="bd-title">${entry.title}</div>
    <div class="bd-note">${entry.note}</div>
  </div>
  <div class="bd-meta">
    <span>${entry.form === "pwa" ? "390 × 844" : "1440 × 900"}</span>
    <button class="bd-btn" data-replay><svg class="ic ic-xs"><use href="#i-play"></use></svg>重播动效</button>
    <div class="theme-pick">
      <button class="bd-btn" data-theme-pick title="主题">
        <span class="swatch" data-swatch></span>
        <span data-palette-name>System</span>
        <svg class="ic ic-xs"><use href="#i-chevron-down"></use></svg>
      </button>
      <div class="tpicker" hidden></div>
    </div>
    <button class="bd-btn" data-theme-toggle><svg class="ic ic-xs"><use href="#i-moon"></use></svg><span data-theme-label>深色</span></button>
  </div>
</header>
`;

const stage = (entry, f) => {
  const key = `${entry.v5}/${f.letter}`;
  if (entry.form === "pwa") {
    return `  <div class="stage-fit stage-fit--pwa">
    <div class="stage stage--pwa">
      <div class="phone" data-fill="${key}"><!-- FILL ${key} --></div>
    </div>
  </div>`;
  }
  return `  <div class="stage-fit">
    <div class="stage stage--web">
      <div class="desk"></div>
      <div class="win" data-fill="${key}"><!-- FILL ${key} --></div>
    </div>
  </div>`;
};

const frame = (entry, f) => `  <!-- ${entry.v5} · 帧 ${f.letter} -->
<section class="frame" data-v5="${entry.v5}/${f.letter}">
  <div class="frame__label"><b>帧 ${f.letter}</b> · ${f.label.replace(/^帧 [A-Z] · /, "")}<span class="frame__meta">${entry.form === "pwa" ? "390 × 844" : "1440 × 900"}</span></div>
${stage(entry, f)}
</section>`;

const build = (entry) =>
  head(entry) + "\n" + entry.frames.map((f) => frame(entry, f)).join("\n\n") + "\n\n</body>\n</html>\n";

const args = process.argv.slice(2);
const fresh = args.includes("--fresh");
const boardArg = args[args.indexOf("--board") + 1];

let targets = manifest.boards;
if (fresh) {
  const tracked = new Set(
    execSync("git ls-tree --name-only HEAD design/v3/boards/", { cwd: ROOT, encoding: "utf8" })
      .trim().split("\n").map((s) => s.split("/").pop()),
  );
  targets = targets.filter((b) => !tracked.has(`${b.target}.html`));
} else if (boardArg) {
  targets = targets.filter((b) => b.target === boardArg || `${b.target}.html` === boardArg);
}

for (const entry of targets) {
  const path = join(V3, "boards", `${entry.target}.html`);
  writeFileSync(path, build(entry));
  console.log(`${entry.target}: ${entry.frames.length} 帧空壳`);
}
