#!/usr/bin/env node
/**
 * fork:mac-skeuo — 组件画廊：把材质层覆盖到的**每一个** pw-* 组件摆出来，
 * 明暗两支各截一张。
 *
 * 为什么需要它：工作台画板只用到其中一半的组件（没有设置弹窗、右键菜单、
 * 提示条、代码块、表格、开关、勾选、单选、滑杆…）。逐组件精修必须逐组件**看**，
 * 否则「改了 1200 行 CSS」和「改对了」是两件事。
 *
 * 用真实产品 CSS 链（与 verify.mjs 同一条），载荷是 board.css 认得的 pw-* DOM。
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = "/Users/yingjing/Desktop/pi-codex";
const here = dirname(fileURLToPath(import.meta.url));
const out = "/Users/yingjing/Desktop/pi-codex-skeuo";
mkdirSync(out, { recursive: true });

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

const skinVars = (v) => {
  const mix = (c, p, b) => `color-mix(in srgb, ${c} ${p}%, ${b})`;
  return [
    `--text:${v.text}`, `--bg:${v.background}`,
    `--bg-elev:${mix(v.panel, 95, "transparent")}`, `--bg-composer:${mix(v.panel, 95, "transparent")}`,
    `--bg-panel:${mix(v.panel, 96, "transparent")}`, `--bg-subtle:${v.panel}`,
    `--bg-hover:${mix(v.text, 10, "transparent")}`, `--bg-selected:${mix(v.text, 16, "transparent")}`,
    `--text-muted:${mix(v.text, 62, v.background)}`, `--text-dim:${mix(v.text, 46, v.background)}`,
    `--border:${mix(v.text, 42, "transparent")}`, `--border-faint:${mix(v.text, 42, "transparent")}`,
    `--border-strong:${mix(v.text, 67, "transparent")}`,
    `--accent:${v.accent}`, `--accent-hover:${mix(v.accent, 82, v.text)}`,
    `--accent-text:${mix(v.accent, 82, v.text)}`,
    `--radius-base:6px`, `--skin-blur:0px`,
    `--skin-panel-base:${v.panel}`, `--skin-bg-base:${v.background}`,
    `--skin-page-alpha:96%`, `--skin-panel-alpha:95%`, `--skin-sidebar-alpha:96%`,
  ].join(";");
};

const V = {
  light: { background: "#eef0f3", panel: "#d9dce0", accent: "#2f7de0", text: "#33383f" },
  dark: { background: "#0c0d0e", panel: "#1a1c20", accent: "#4a8fe0", text: "#dcdcdf" },
};

/** 每一组：标题 + 一块载荷。载荷只用 board.css / 产品真实在用的 pw-* 类。 */
const GROUPS = [
  ["chrome / 外壳", `<div class="pw-app" style="height:120px;border-radius:8px;width:760px;--sidebar-width:230px">
      <aside class="pw-side" style="border-radius:8px 0 0 8px">
        <div class="pw-side-head"><span class="pw-brand">PI NEXT</span></div>
        <div class="pw-side-nav"><div class="pw-row is-on"><span class="pw-name">pi-codex</span><span class="pw-count">178</span></div>
        <div class="pw-row"><span class="pw-name">招标改</span><span class="pw-count">6</span></div></div>
      </aside>
      <main class="pw-main"><div class="pw-topbar"><span class="pw-tb-title">等待命令执行完成</span>
        <span class="pw-chipbtn">main</span>
        <span class="grow"></span>
        <button class="pw-iconbtn"><span class="pw-ico"><i data-ico="history" data-size="14"></i></span></button>
        <button class="pw-iconbtn is-on"><span class="pw-ico"><i data-ico="panel-right" data-size="14"></i></span></button>
      </div></main>
    </div>`],

  ["seg / 分段 · select · search · kbd", `
      <div class="pw-seg" style="width:220px"><span class="is-on">项目</span><span>聊天</span></div>
      <span class="pw-side-search" style="display:flex;align-items:center;width:220px"><span class="pw-ico"><i data-ico="search" data-size="14"></i></span>搜索会话</span>
      <span class="pw-select">默认模型<span class="pw-ico"><i data-ico="chevron-down" data-size="14"></i></span></span>
      <span class="pw-kbd">Esc</span>`],

  ["btn · 四档", `
      <button class="pw-btn primary">允许一次</button>
      <button class="pw-btn">本会话内始终允许</button>
      <button class="pw-btn outline">取消</button>
      <button class="pw-btn danger">拒绝</button>
      <button class="pw-btn" disabled>禁用</button>`],

  ["badge · 四档", `
      <span class="pw-badge">默认</span>
      <span class="pw-badge accent">进行中</span>
      <span class="pw-badge warn">等你处理</span>
      <span class="pw-badge danger">失败</span>`],

  ["input · textarea · ring · send", `
      <input class="pw-input" value="DeepSeek V4.1 Flash" style="width:230px">
      <textarea class="pw-textarea" style="width:230px;height:54px">边跑边补一句也行</textarea>
      <span class="pw-ring" style="--p:26%"></span>
      <span class="pw-send"><span class="pw-ico"><i data-ico="arrow-up" data-size="14"></i></span></span>
      <span class="pw-send stop"><span class="pw-ico"><i data-ico="square" data-size="13"></i></span></span>`],

  // 载荷用**产品真实 DOM**：开关是 button.pw-switch > i（状态类 .on），
  // 勾选是原生 input，单选组是 flex 容器 + span.is-on。
  ["switch · checkbox · radio组 · range", `
      <button type="button" role="switch" aria-checked="true" class="pw-switch on"><i aria-hidden="true"></i></button>
      <button type="button" role="switch" aria-checked="false" class="pw-switch"><i aria-hidden="true"></i></button>
      <input type="checkbox" checked style="width:13px;height:13px;accent-color:var(--accent)">
      <input type="checkbox" style="width:13px;height:13px;accent-color:var(--accent)">
      <div class="pw-radio"><span>全部</span><span class="is-on">已加入</span><span>未加入</span></div>
      <span class="pw-range" style="width:180px;height:8px"><i style="display:block;height:100%;width:62%"></i></span>`],

  ["alert · 三档", `
      <div class="pw-alert" style="width:300px">信息：MCP server 已连接</div>
      <div class="pw-alert warn" style="width:300px">警告：配额已用 80%</div>
      <div class="pw-alert danger" style="width:300px">失败：写入被拒绝</div>`],

  ["pop / 右键菜单 · tooltip · toast", `
      <div style="display:flex;flex-direction:column;gap:10px;align-items:flex-start">
      <div class="pw-pop context-menu context-menu--entered" style="width:210px">
        <div class="pw-litem"><span class="pw-ico"><i data-ico="square-pen" data-size="14"></i></span>重命名</div>
        <div class="pw-litem"><span class="pw-ico"><i data-ico="folder" data-size="14"></i></span>在访达中打开</div>
        <div class="pw-sep"></div>
        <div class="pw-litem danger"><span class="pw-ico"><i data-ico="trash-2" data-size="14"></i></span>删除</div>
      </div>
      <span role="tooltip">提示：按 Esc 取消</span>
      <div class="pw-toast" style="padding:10px 14px;width:200px">已保存<div class="grow"></div><button style="width:16px;height:16px;font-size:0">×</button></div>
      </div>`],

  ["card · modal · cell", `
      <div class="pw-card" style="width:250px">
        <div class="pw-card-head">pi-codex</div>
        <div class="pw-card-body">178 条会话 · 最后更新 2 分钟前</div>
        <div class="pw-card-foot"><button class="pw-btn primary">打开</button></div>
      </div>
      <div class="pw-modal" style="width:260px;padding:18px">
        <div class="pw-modal-head">确认删除</div>
        <div class="pw-modal-body">这一条不可撤销。</div>
        <div class="pw-modal-foot"><button class="pw-btn danger">删除</button><button class="pw-btn">取消</button></div>
      </div>
      <div class="pw-cell" style="width:120px;padding:10px">单元格</div>`],

  ["perm · proc · bubble", `
      <div class="pw-perm" style="width:320px;padding:12px">
        <div class="pw-perm-title">要写入 3 个文件，需要你确认 <span class="pw-badge warn">等你处理</span></div>
        <div class="pw-perm-body" style="padding:8px;margin:8px 0">{"tool":"write","paths":["a.md"]}</div>
        <div class="pw-perm-acts"><button class="pw-btn primary">允许一次</button><button class="pw-btn danger">拒绝</button></div>
      </div>
      <div class="pw-proc" style="width:320px">
        <div class="pw-proc-head" style="padding:6px 10px">2 个文件 · 4 条命令</div>
        <div class="pw-step" style="padding:6px 10px"><span class="pw-verb">运行</span> git log <span class="pw-dur" style="float:right">0.4s</span></div>
        <div class="pw-step" style="padding:6px 10px"><span class="pw-verb">搜索</span> v0.9.4 <span class="pw-dur" style="float:right">0.9s</span></div>
      </div>
      <div class="pw-msg-user" style="padding:10px 14px;max-width:200px">把 release 里那份对一下</div>`],

  ["code · table · quote · avatar", `
      <div class="pw-code" style="width:280px">
        <div class="pw-code-head" style="padding:6px 10px">main.ts</div>
        <div class="pw-code-body" style="padding:12px;font-family:var(--font-mono);font-size:12px">const a = 1<br>export default a</div>
      </div>
      <div class="pw-icon-cell" style="width:34px;height:34px;display:grid;place-items:center;font-weight:700">PS</div>
      <div class="pw-quote" style="padding:8px 12px;width:240px">引文：凝胶的转折在 50%。</div>`],
];

function gallery(mode) {
  const body = GROUPS.map(([title, markup]) => `
    <section style="margin-bottom:18px">
      <h3 style="margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text-dim)">${title}</h3>
      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center">${markup}</div>
    </section>`).join("");
  return `<!DOCTYPE html>
<html lang="zh-CN" class="${mode === "dark" ? "dark" : ""}" data-theme="${mode}"
  data-theme-skin="true" data-theme-skin-id="builtin-mac-skeuo" data-theme-skin-mode="${mode}"
  style="${skinVars(V[mode])}">
<head><meta charset="utf-8"><title>gallery-${mode}</title>
${CSS.map((h) => `<link rel="stylesheet" href="${h}">`).join("\n")}
<style>body{margin:0;padding:28px;background:var(--bg);color:var(--text);font-family:var(--font-ui)}</style>
</head>
<body>${body}<script src="../assets/icons.js"></script></body></html>`;
}

const browser = await chromium.launch({ channel: "chrome" });
for (const mode of ["light", "dark"]) {
  const file = join(here, `gallery-${mode}.html`);
  writeFileSync(file, gallery(mode));
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 1500 },
    deviceScaleFactor: 2,
    locale: "zh-CN",
    colorScheme: mode,
  });
  const page = await ctx.newPage();
  await page.goto(`file://${file}`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(out, `gallery-${mode}.png`), fullPage: true });
  console.log("gallery", mode, "ok");
  await ctx.close();
}
await browser.close();