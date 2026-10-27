#!/usr/bin/env node
/* 把「单帧 V3 画板」变成多帧画板：原来的 stage 原样进 帧 A，其余帧留空槽。
 * 只做外壳搬运，不动 .win / .phone 里的任何节点。
 *   node scripts/v3-frames-wrap.mjs --board web-running
 *   node scripts/v3-frames-wrap.mjs --all
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const V3 = join(ROOT, "design/v3");
const manifest = JSON.parse(readFileSync(join(V3, "frames/manifest.json"), "utf8"));

function balanced(html, startIdx, tag) {
  const re = new RegExp(`<${tag}\\b|</${tag}>`, "g");
  re.lastIndex = startIdx;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    if (m[0][1] === "/") depth--;
    else depth++;
    if (depth === 0) return re.lastIndex;
  }
  return html.length;
}

function takeStage(html) {
  const i = html.indexOf('<div class="stage-fit"');
  if (i >= 0) {
    const end = balanced(html, i, "div");
    return { start: i, end, block: html.slice(i, end) };
  }
  /* PWA 画板没有 .stage-fit，直接是 .stage--pwa */
  const j = html.indexOf('<div class="stage stage--pwa"');
  if (j < 0) return null;
  const end = balanced(html, j, "div");
  return { start: j, end, block: `<div class="stage-fit stage-fit--pwa">\n${html.slice(j, end)}\n</div>` };
}

function framesHtml(entry, stageBlock) {
  return entry.frames
    .map((f, i) => {
      const meta = f.kind === "pwa" ? "390 × 844" : "1440 × 900";
      const body =
        i === 0
          ? stageBlock
          : entry.form === "pwa"
            ? `<div class="stage-fit stage-fit--pwa">\n    <div class="stage stage--pwa">\n      <div class="phone" data-fill="${entry.v5}/${f.letter}"><!-- FILL ${entry.v5}/${f.letter} --></div>\n    </div>\n  </div>`
            : `<div class="stage-fit">\n    <div class="stage stage--web">\n      <div class="desk"></div>\n      <div class="win" data-fill="${entry.v5}/${f.letter}"><!-- FILL ${entry.v5}/${f.letter} --></div>\n    </div>\n  </div>`;
      return `  <!-- ${entry.v5} · 帧 ${f.letter} · ${f.label.replace(/^帧 [A-Z] · /, "")} -->\n<section class="frame" data-v5="${entry.v5}/${f.letter}">\n  <div class="frame__label"><b>帧 ${f.letter}</b> · ${f.label.replace(/^帧 [A-Z] · /, "")}<span class="frame__meta">${meta}</span></div>\n  ${body}\n</section>`;
    })
    .join("\n\n");
}

const args = process.argv.slice(2);
const all = args.includes("--all");
const boardArg = args[args.indexOf("--board") + 1];
const targets = all
  ? manifest.boards
  : manifest.boards.filter((b) => b.target === boardArg || `${b.target}.html` === boardArg);

for (const entry of targets) {
  const path = join(V3, "boards", `${entry.target}.html`);
  if (!existsSync(path)) { console.log(`${entry.target}: 文件不存在`); continue; }
  const html = readFileSync(path, "utf8");
  if (html.includes('<section class="frame"')) { console.log(`${entry.target}: 已是多帧，跳过`); continue; }

  const stage = takeStage(html);
  if (!stage) { console.log(`${entry.target}: 找不到 .stage-fit，跳过`); continue; }

  const before = html.slice(0, stage.start);
  const after = html.slice(stage.end);

  const out = before.replace(/\s*$/, "\n\n") + framesHtml(entry, stage.block) + "\n" + after;
  writeFileSync(path, out);
  console.log(`${entry.target}: 帧 A 收进原设计，另 ${entry.frames.length - 1} 帧留槽`);
}
