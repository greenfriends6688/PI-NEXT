#!/usr/bin/env node
/**
 * fork:mac-skeuo — 材质层的渲染验证台。
 *
 * 不起服务（prod 实例在跑，别动它）。按 `app/layout.tsx` 的**真实引入顺序**
 * 把产品 CSS 全链上，画板 01-workbench 帧 B 的 DOM 当载荷，四个变体各截一张：
 *
 *   default-light / default-dark  不带 data-theme-skin-id —— 证明材质层没漏出去
 *   mac-light                     Aqua
 *   mac-dark                      SkeuoCord
 *
 * 差异守恒：`--bg` / `--text` 那几行内联变量照抄 `useThemeSkins.writeSkin()` 的
 * 派生结果（color-mix 那几行），否则截图里的底色不是皮肤真正会给的底色。
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = "/Users/yingjing/Desktop/pi-codex";
const here = dirname(fileURLToPath(import.meta.url));
const out = "/Users/yingjing/Desktop/pi-codex-skeuo";
mkdirSync(out, { recursive: true });

let frame = readFileSync(join(here, "_frame.html"), "utf8");
frame = frame.replaceAll("../../public/", "../../../public/");
let extra = (frame.match(/<\/div>/g) || []).length - (frame.match(/<div/g) || []).length;
while (extra-- > 0) frame = frame.replace(/<\/div>\s*$/, "");

/** `useThemeSkins.writeSkin()` 在 `<html>` 上会写的内联变量。 */
function skinVars(variant) {
  const mix = (c, p, b) => `color-mix(in srgb, ${c} ${p}%, ${b})`;
  const lines = [
    `--text:${variant.text}`,
    `--bg:${variant.background}`,
    `--bg-elev:${mix(variant.panel, 95, "transparent")}`,
    `--bg-composer:${mix(variant.panel, 95, "transparent")}`,
    `--bg-panel:${mix(variant.panel, 96, "transparent")}`,
    `--bg-subtle:${variant.panel}`,
    `--bg-hover:${mix(variant.text, 10, "transparent")}`,
    `--bg-selected:${mix(variant.text, 16, "transparent")}`,
    `--text-muted:${mix(variant.text, 62, variant.background)}`,
    `--text-dim:${mix(variant.text, 46, variant.background)}`,
    `--border:${mix(variant.text, 42, "transparent")}`,
    `--border-faint:${mix(variant.text, 42, "transparent")}`,
    `--border-strong:${mix(variant.text, 67, "transparent")}`,
    `--accent:${variant.accent}`,
    `--accent-hover:${mix(variant.accent, 82, variant.text)}`,
    `--accent-text:${mix(variant.accent, 82, variant.text)}`,
    `--radius-base:6px`,
    `--skin-blur:0px`,
    `--skin-panel-base:${variant.panel}`,
    `--skin-bg-base:${variant.background}`,
    `--skin-page-alpha:96%`,
    `--skin-panel-alpha:95%`,
    `--skin-sidebar-alpha:96%`,
  ];
  return lines.join(";");
}

const VARIANTS = [
  { name: "mac-light", skin: true, mode: "light", vars: { background: "#eef0f3", panel: "#d9dce0", accent: "#2f7de0", text: "#33383f" } },
  { name: "mac-dark", skin: true, mode: "dark", vars: { background: "#0c0d0e", panel: "#1a1c20", accent: "#4a8fe0", text: "#dcdcdf" } },
];

// 对照组：同样跑一遍，但不带 data-theme-skin-id。
for (const mode of ["light", "dark"]) {
  VARIANTS.push({
    name: `default-${mode}`,
    skin: false,
    mode,
    vars: mode === "light"
      ? { background: "", panel: "", accent: "", text: "" }
      : { background: "", panel: "", accent: "", text: "" },
  });
}

// harness 在 design/pi-web-design/.skeuo/，所以画板资源是 ../，app/ 资源是 ../../../。
const CSS = [
  "../assets/tokens.css",
  "../../../app/design/tokens.css",
  "../../../app/globals.css",
  "../../../app/settings.css",
  "../../../app/wallpaper.css",
  "../assets/board.css",
  "../../../app/fork-ui.css",
  "../../../app/fork-mac-skeuo.css",
];

const browser = await chromium.launch({ channel: "chrome" });
for (const v of VARIANTS) {
  const html = `<!DOCTYPE html>
<html lang="zh-CN" class="${v.mode === "dark" ? "dark" : ""}"
  ${v.skin ? `data-theme-skin="true" data-theme-skin-id="builtin-mac-skeuo" data-theme-skin-mode="${v.mode}"` : ""}
  data-theme="${v.mode}" style="${v.skin ? skinVars(v.vars) : ""}">
<head><meta charset="utf-8"><title>${v.name}</title>
${CSS.map((h) => `<link rel="stylesheet" href="${h}">`).join("\n")}
</head>
<body class="pw skeuo-workbench">
${frame}
<script src="../assets/icons.js"></script>
</body></html>`;
  const file = join(here, `verify-${v.name}.html`);
  writeFileSync(file, html);

  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    locale: "zh-CN",
    colorScheme: v.mode,
  });
  const page = await ctx.newPage();
  await page.goto(`file://${file}`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, `${v.name}.png`) });
  // 关键断言：材质层的门禁属性确实只在带 skin 的两个变体上生效。
  const gated = await page.evaluate(() =>
    getComputedStyle(document.querySelector(".pw-app")).boxShadow.slice(0, 24),
  );
  console.log(v.name.padEnd(14), "gate-attr:", await page.evaluate(() => document.documentElement.dataset.themeSkinId ?? "-"), "| .pw-app shadow:", gated);
  await ctx.close();
}
await browser.close();
