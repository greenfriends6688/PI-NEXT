#!/usr/bin/env node
/* 从 V5 的 57 张板抽出全部帧，给每张 V3 目标板铺好「一帧一个空槽」的骨架，并写 manifest。
 *   node scripts/v3-frames-manifest.mjs [--force]
 * V5 的帧标签只有 V5 页面里读才准（.d-scene / .m-scene），所以用 Playwright 解析。 */
import { mkdirSync, readdirSync, readFileSync, existsSync, writeFileSync, copyFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const V5 = process.env.V5_ROOT || "C:/Users/Administrator/Downloads/PI-NEXT-0.1.9/PI-NEXT-0.1.9/design/v5";
const BOARDS = join(ROOT, "design/v3/boards");
const PREV = join(ROOT, "design/v3/.prev/boards");
const FRAMES = join(ROOT, "design/v3/frames");
const force = process.argv.includes("--force");

/* V5 板 → V3 目标板（契约 §6，单一真值） */
const MAP = {
  "D-01-workbench": "web-new-thread",
  "D-02-sidebar-topbar": "web-running",
  "D-02b-topbar-popovers": "web-topbar-popovers",
  "D-02c-menus-atlas": "web-menus-atlas",
  "D-02d-sidebar-detail": "web-sidebar-detail",
  "D-03-transcript": "web-transcript",
  "D-03b-transcript-content": "web-transcript-content",
  "D-03c-transcript-shell": "web-transcript-shell",
  "D-03d-transcript-process": "web-transcript-process",
  "D-03e-transcript-nav": "web-transcript-nav",
  "D-04-composer": "web-composer",
  "D-05-right-panels": "web-right-panels",
  "D-06-file-viewer": "web-files",
  "D-06b-file-viewer-modes": "web-file-viewer-modes",
  "D-07-settings-general": "web-settings-general",
  "D-07b-settings-general-detail": "web-settings-general-detail",
  "D-08-settings-models": "web-settings-models",
  "D-09-settings-model-advanced": "web-settings-models-advanced",
  "D-10-settings-enabled-models": "web-settings-enabled-models",
  "D-11-settings-skills": "web-settings-skills",
  "D-12-settings-agents": "web-settings-agents",
  "D-13-settings-plugins": "web-settings-plugins",
  "D-15-settings-mcp": "web-settings-mcp",
  "D-16-settings-mcp-exposure": "web-settings-mcp-exposure",
  "D-17-settings-automation": "web-settings-automation",
  "D-19-settings-usage": "web-settings-usage",
  "D-20-settings-phone-push": "web-settings-phone-push",
  "D-21-settings-archive-import": "web-settings-archive-import",
  "D-22-command-center": "web-palette",
  "D-23-browser-viewport": "web-browser",
  "D-24-empty-state-guide": "web-welcome",
  "D-25-plan-queue-slots": "web-plan-queue",
  "D-26-dialogs-states": "web-dialogs-states",
  "D-26b-system-states": "web-system-states",
  "D-27-motion": "web-spec-motion",
  "D-28-motion-feedback": "web-motion-feedback",
  "D-29-motion-containers": "web-motion-containers",
  "D-30-keyboard-focus": "web-keyboard-focus",
  "D-31-settings-imagegen": "web-settings-imagegen",
  "D-32-v6-conversation": "web-v6-conversation",
  "D-33-v6-agent-parts": "web-v6-agent-parts",
  "D-34-v6-message-parts": "web-v6-message-parts",
  "D-35-v6-workbench-parts": "web-v6-workbench-parts",
  "D-36-settings-memory": "web-settings-memory",
  "D-37-settings-websearch": "web-settings-websearch",
  "M-01-conversation-drawer": "pwa-running",
  "M-02-transcript": "pwa-transcript",
  "M-03-composer-sheet": "pwa-composer-sheet",
  "M-04-sessions-drawer": "pwa-sessions",
  "M-05-settings": "pwa-settings",
  "M-06-files-terminal": "pwa-files",
  "M-07-browser-cc": "pwa-browser",
  "M-08-search-completion": "pwa-search",
  "M-09-store-cron-usage": "pwa-store-cron-usage",
  "M-10-install-update-trust": "pwa-install-update-trust",
  "M-11-gestures-states": "pwa-gestures-states",
  "M-12-right-panels": "pwa-right-panels",
};

const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const stripSize = (s) => clean(s).replace(/\s*\d{3,4}\s*×\s*\d{3,4}\s*$/, "");

const browser = await chromium.launch();
const pages = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const boards = [];
for (const [v5file, target] of Object.entries(MAP)) {
  const form = v5file.startsWith("M-") ? "pwa" : "web";
  const abs = join(V5, form, "boards", `${v5file}.html`);
  if (!existsSync(abs)) { console.log(`缺 V5 板：${abs}`); continue; }
  await pages.goto(pathToFileURL(abs).href, { waitUntil: "load" });
  await pages.waitForTimeout(80);
  const info = await pages.evaluate((form) => {
    const scenes = [...document.querySelectorAll(form === "pwa" ? ".m-scene" : ".d-scene")];
    const labelOf = (sc) => sc.querySelector(".d-frame-label, .m-frame-label")?.innerText || "";
    const head = document.querySelector(".d-board-head, .m-board-head");
    const title = head?.querySelector("h1")?.innerText || document.querySelector("h1")?.innerText || "";
    const note = head?.querySelector("p")?.innerText || "";
    const tags = head ? [...head.querySelectorAll(".d-tag, .m-tag")].map((t) => t.innerText.trim()) : [];
    const frames = scenes.map((sc, i) => ({
      i,
      rawLabel: labelOf(sc),
      kind: sc.querySelector(".d-shell") ? "web" : sc.querySelector(".m-phone") ? "pwa" : "doc",
      nodes: sc.querySelectorAll("*").length,
    }));
    // 有些板没有 .d-scene 包裹，退回 .d-frame 直找
    if (!frames.length) {
      const bare = [...document.querySelectorAll(form === "pwa" ? ".m-phone" : ".d-frame")];
      for (const [i, el] of bare.entries()) {
        frames.push({ i, rawLabel: "", kind: form === "pwa" ? "pwa" : "web", nodes: el.querySelectorAll("*").length });
      }
    }
    return { title, note, tags, frames };
  }, form);

  const prev = join(PREV, `${target}.html`);
  const out = join(BOARDS, `${target}.html`);
  const existing = existsSync(out) ? readFileSync(out, "utf8") : null;
  const already = existing?.includes("data-fill");
  if (already && !force) { console.log(`跳过（已铺过槽）：${target}`); boards.push({ v5: v5file, target, form, skipped: true }); continue; }

  mkdirSync(PREV, { recursive: true });
  mkdirSync(FRAMES, { recursive: true });
  if (existing && !existsSync(prev)) copyFileSync(out, prev);

  let head = existing?.match(/<header class="bd-head">[\s\S]*?<\/header>/)?.[0];
  if (!head) {
    const num = form === "pwa" ? "PWA" : v5file.split("-")[0];
    head = `<header class="bd-head">
  <span class="bd-num">${esc(num)}</span>
  <div>
    <div class="bd-title">${esc(stripSize(info.title))}</div>
    <div class="bd-note">${esc(clean(info.note).slice(0, 220))}</div>
  </div>
  <div class="bd-meta">
    <span>${form === "pwa" ? "390 × 844" : "1440 × 900"}</span>
    <button class="bd-btn" data-replay><svg class="ic ic-xs"><use href="#i-play"></use></svg>重播动效</button>
    <div class="theme-pick">
      <button class="bd-btn" data-theme-pick title="主题（droppy 的 26 套）">
        <span class="swatch" data-swatch></span>
        <span data-palette-name>System</span>
        <svg class="ic ic-xs"><use href="#i-chevron-down"></use></svg>
      </button>
      <div class="tpicker" hidden></div>
    </div>
    <button class="bd-btn" data-theme-toggle><svg class="ic ic-xs"><use href="#i-moon"></use></svg><span data-theme-label>深色</span></button>
  </div>
</header>`;
  }

  const frames = info.frames.map((f, i) => {
    const letter = String.fromCharCode(65 + (i % 26));
    const label = stripSize(f.rawLabel) || `帧 ${letter}`;
    const kind = f.kind || form;
    const meta = kind === "pwa" ? "390 × 844" : kind === "doc" ? "1440 × auto" : "1440 × 900";
    const slot = kind === "pwa"
      ? `<div class="stage-fit stage-fit--pwa">
    <div class="stage stage--pwa">
      <div class="phone" data-fill="${v5file}/${letter}"><!-- FILL ${v5file}/${letter} --></div>
    </div>
  </div>`
      : kind === "doc"
        ? `<div class="stage stage--doc" data-fill="${v5file}/${letter}"><!-- FILL ${v5file}/${letter} --></div>`
        : `<div class="stage-fit">
    <div class="stage stage--web">
      <div class="desk"></div>
      <div class="win" data-fill="${v5file}/${letter}"><!-- FILL ${v5file}/${letter} --></div>
    </div>
  </div>`;
    return `  <!-- ${v5file} · 帧 ${letter} · V5 约 ${f.nodes} 个节点 -->
<section class="frame" data-v5="${v5file}/${letter}">
  <div class="frame__label"><b>帧 ${letter}</b> · ${esc(label.replace(/^帧\s*[A-Z]\s*·?\s*/, ""))}<span class="frame__meta">${meta}</span></div>
  ${slot}
</section>`;
  }).join("\n\n");

  const html = `<!doctype html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(stripSize(info.title))} · Pi Web V3</title>
<link rel="stylesheet" href="../assets/running.css">
<script src="../assets/running.js" defer></script>
<script src="../assets/icons-extra.js" defer></script>
</head>
<body class="board">

${head}

<!-- 源：design/v5/${form}/boards/${v5file}.html · ${info.frames.length} 帧；只填每个 [data-fill] 的内部，外壳不动。 -->
${frames}

</body>
</html>
`;
  writeFileSync(out, html);
  boards.push({
    v5: v5file, target, form, title: stripSize(info.title), note: clean(info.note), tags: info.tags,
    frames: info.frames.map((f, i) => ({
      i, letter: String.fromCharCode(65 + (i % 26)), label: stripSize(f.rawLabel) || `帧 ${String.fromCharCode(65 + (i % 26))}`,
      kind: f.kind, v5nodes: f.nodes,
    })),
  });
  console.log(`铺槽：${v5file} → ${target}.html · ${info.frames.length} 帧`);
}
await browser.close();

const manifest = { generatedAt: new Date().toISOString(), v5: V5, boards };
mkdirSync(FRAMES, { recursive: true });
writeFileSync(join(FRAMES, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`\nmanifest：${boards.filter((b) => !b.skipped).length} 张板，${boards.filter((b) => !b.skipped).reduce((n, b) => n + (b.frames?.length || 0), 0)} 帧`);
