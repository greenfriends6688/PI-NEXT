// 画板 ↔ 产品对表（真 Google Chrome）
//
// 做什么：
//   1. 用 Playwright 的 **真 Chrome**（channel: "chrome"）逐张打开 design/pi-web-design/NN-*.html，
//      抽出每一帧的「功能名 / 用到的 pw-* 类 / 按钮签名」作为画板契约；
//   2. 再用同一个浏览器巡检跑起来的 pi-web（桌面 1440×900 + 移动 390×800），
//      每一步记录渲染出的 pw-* 类清单、按钮签名（类名 + 文本 + 图标）与全屏截图；
//   3. 逐帧对表：画板画了但产品巡检里从没出现的类 = 缺口；产品的按钮签名与画板不一致 = 样式/结构偏差。
//
// 用法：
//   node scripts/verify-against-boards.mjs --app http://127.0.0.1:30141
//   node scripts/verify-against-boards.mjs --app http://127.0.0.1:30141 --keep-open
// 产出：
//   docs/screenshots/skin-verify-<日期>/report.md + step-*.png
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DES = join(ROOT, "design/pi-web-design");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const APP = arg("app", "http://127.0.0.1:30141");
const KEEP_OPEN = process.argv.includes("--keep-open");
const STAMP = new Date().toISOString().slice(0, 10);
const OUT = join(ROOT, "docs/screenshots", `skin-verify-${STAMP}`);
mkdirSync(OUT, { recursive: true });

/* ------------------------------------------------------------------ 页面内抽取 */
const EXTRACT = () => {
  const pw = (el) => [...el.classList].filter((c) => c.startsWith("pw-")).sort();
  const label = (el) => (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160);
  const buttonSig = (b) => ({
    cls: pw(b),
    tag: b.tagName.toLowerCase(),
    text: label(b).slice(0, 48),
    ico: b.querySelector("[data-ico]")?.getAttribute("data-ico") ?? null,
  });
  const BUTTONSEL = 'button, [role="button"], .pw-prow, .pw-trow, .pw-litem, .pw-session, .pw-starter, .pw-step, .pw-chip, .pw-skin';
  return {
    classes: [...new Set([...document.querySelectorAll('[class*="pw-"]')].flatMap(pw))].sort(),
    buttons: [...new Set([...document.querySelectorAll(BUTTONSEL)]
      .filter((el) => pw(el).length || el.tagName === "BUTTON")
      .map((b) => JSON.stringify(buttonSig(b))))].map((s) => JSON.parse(s)),
    frames: [...document.querySelectorAll(".pw-frame")].map((f) => ({
      label: label(f.querySelector(".pw-frame-label")) || label(f).slice(0, 60),
      classes: [...new Set([...f.querySelectorAll('[class*="pw-"]')].flatMap(pw))].sort(),
      buttons: [...f.querySelectorAll(BUTTONSEL)]
        .filter((el) => pw(el).length || el.tagName === "BUTTON")
        .map(buttonSig),
    })),
  };
};

/* ------------------------------------------------------------------ 巡检步骤 */
const step = (name, note, run) => ({ name, note, run });

const STEPS = [
  step("01-空态首屏", "画板 01 帧 A：新会话页（上下文条 / 起步卡 / 输入卡）", async () => {}),
  step("02-输入卡弹层", "画板 20/21：五个 pw-select + 上下文环浮窗 + 附件芯片", async (page) => {
    for (const sel of [".pw-composer-bar .pw-select"]) {
      const n = await page.locator(sel).count();
      for (let i = 0; i < n; i++) await page.locator(sel).nth(i).click({ timeout: 2000 }).catch(() => {});
    }
    await page.locator(".composer-ring").first().hover({ timeout: 2000 }).catch(() => {});
  }),
  step("03-引用与命令菜单", "画板 21：@ 四类 + / 命令 + 输入历史", async (page) => {
    const box = page.locator(".pw-composer-top textarea, textarea").first();
    await box.click({ timeout: 3000 }).catch(() => {});
    await box.type("@", { delay: 30 }).catch(() => {});
    await page.waitForTimeout(400);
  }),
  step("04-转录与过程时间轴", "画板 10/11/12：消息卡 + 步骤流 + 结束行 + 迷你地图", async (page) => {
    const rows = page.locator(".pw-session");
    if (await rows.count()) {
      await rows.nth(Math.min(1, (await rows.count()) - 1)).click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(1200);
      const stepBtn = page.locator(".pw-step").first();
      if (await stepBtn.count()) await stepBtn.click({ timeout: 2000 }).catch(() => {});
      await page.locator("[data-minimap-node-index]").first().hover({ timeout: 2000 }).catch(() => {});
    }
  }),
  step("05-右栏各标签", "画板 30/31/52：文件树 / 查看器 / 终端 / 浏览器 / Git", async (page) => {
    const tabs = page.locator('[role="tab"]');
    const n = await tabs.count();
    for (let i = 0; i < n; i++) {
      await tabs.nth(i).click({ timeout: 2500 }).catch(() => {});
      await page.waitForTimeout(700);
      const shot = await EXTRACT();
      void shot; // 每标签单独截图由外层统一做，这里只保证交互到位
    }
  }),
  step("06-设置十三分节", "画板 40~47：左导航 13 节逐个打开", async (page) => {
    await page.locator('.pw-side-foot [data-ico="settings"]').first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(600);
    const rows = page.locator(".pw-snav > button.pw-row:not(.pw-snav-close)");
    const n = await rows.count();
    for (let i = 0; i < n; i++) {
      await rows.nth(i).click({ timeout: 2500 }).catch(() => {});
      await page.waitForTimeout(500);
    }
  }),
  step("07-关闭设置后的工作台", "画板 01 帧 B/C", async (page) => {
    await page.locator(".pw-snav-close").first().click({ timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(400);
  }),
  step("08-移动端同构", "画板 60：390×800 抽屉 / 顶栏 48 / 覆盖式工具条 / 信任横幅", async (page) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.waitForTimeout(500);
    await page.locator('[data-ico="panel-left"]').first().click({ timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(400);
  }),
];

/* ------------------------------------------------------------------ 主流程 */
const browser = await chromium.launch({ channel: "chrome" });
const problems = [];
const appClasses = new Set();
const appButtons = new Map(); // JSON → 次数

function note(kind, msg) {
  problems.push({ kind, msg });
  console.log(`${kind}  ${msg}`);
}

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

/* ---- 1. 画板契约 ---- */
const boards = [];
{
  const { readdirSync } = await import("node:fs");
  const files = readdirSync(DES).filter((f) => /^\d\d-.*\.html$/.test(f)).sort();
  for (const f of files) {
    const p = await ctx.newPage();
    await p.goto(pathToFileURL(join(DES, f)).href, { waitUntil: "load" });
    await p.waitForTimeout(250);
    const data = await p.evaluate(EXTRACT);
    await p.close();
    boards.push({ file: f, ...data });
    console.log(`板 ${f}：${data.frames.length} 帧 / ${data.classes.length} 类 / ${data.buttons.length} 个可点元素`);
  }
}

const tour = [];
{
  try {
    await page.goto(APP, { waitUntil: "domcontentloaded" });
  } catch (e) {
    console.error(`✖ 打不开产品 ${APP}：${String(e?.message ?? e).split("\n")[0]}`);
    console.error("  先启动服务：npm run prod（推荐，接口快 10 倍）或 npm run dev:clean");
    await browser.close();
    process.exit(2);
  }
  await page.waitForTimeout(2500);
  for (const s of STEPS) {
    let err = null;
    try {
      await s.run(page);
    } catch (e) {
      err = String(e?.message ?? e).split("\n")[0];
    }
    await page.waitForTimeout(350);
    const data = await page.evaluate(EXTRACT);
    const shot = `step-${s.name}.png`;
    await page.screenshot({ path: join(OUT, shot), fullPage: false });
    data.classes.forEach((c) => appClasses.add(c));
    for (const b of data.buttons) {
      const k = JSON.stringify(b);
      appButtons.set(k, (appButtons.get(k) ?? 0) + 1);
    }
    tour.push({ ...s, err, classes: data.classes, buttons: data.buttons, shot });
    console.log(`巡检 ${s.name}：${data.classes.length} 类 / ${data.buttons.length} 可点${err ? ` · 出错 ${err}` : ""}`);
  }
}

/* ---- 3. 对表 ---- */
const boardClasses = new Set(boards.flatMap((b) => b.classes));
const missingGlobally = [...boardClasses].filter((c) => !appClasses.has(c)).sort();
const appOnly = [...appClasses].filter((c) => !boardClasses.has(c)).sort();

const rows = [];
for (const b of boards) {
  for (const f of b.frames) {
    const miss = f.classes.filter((c) => !appClasses.has(c));
    rows.push({ board: b.file, feature: f.label, total: f.classes.length, missing: miss });
    if (miss.length) note("缺口", `${b.file} · ${f.label}：${miss.join(" ")}`);
  }
}

// 按钮对表：画板里出现过的按钮签名，产品巡检里没有同名签名的
const appButtonKeys = new Set([...appButtons.keys()].map((k) => {
  const o = JSON.parse(k);
  return `${o.cls.join(".")}|${o.ico ?? ""}|${o.text}`;
}));
const buttonGaps = [];
for (const b of boards) {
  for (const f of b.frames) {
    for (const btn of f.buttons) {
      const key = `${btn.cls.join(".")}|${btn.ico ?? ""}|${btn.text}`;
      if (!appButtonKeys.has(key)) {
        buttonGaps.push({ board: b.file, feature: f.label, cls: btn.cls.join(" "), ico: btn.ico, text: btn.text });
      }
    }
  }
}

/* ---- 4. 报告 ---- */
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const lines = [];
lines.push(`# 画板 ↔ 产品对表（真 Chrome）· ${STAMP}`, "");
lines.push(`- 产品地址：\`${APP}\``);
lines.push(`- 画板：${boards.length} 张，共 ${boards.reduce((n, b) => n + b.classes.length, 0)} 类引用（去重 ${boardClasses.size}）`);
lines.push(`- 产品巡检：${tour.length} 步，实际渲染出 ${appClasses.size} 个画板类`);
lines.push(`- **画板有、产品巡检未出现：${missingGlobally.length} 个类**`);
lines.push(`- 产品用了、任何画板都没有的类：${appOnly.length} 个${appOnly.length ? `（${appOnly.join(" ")}）` : ""}`, "");
lines.push("## 一、逐帧对表", "", "| 画板 | 该帧在定什么 | 用到的类 | 巡检未出现 |", "|---|---|---|---|");
for (const r of rows) {
  lines.push(`| ${r.board} | ${r.feature.replace(/\|/g, "/")} | ${r.total} | ${r.missing.length ? r.missing.join(" ") : "✅ 全出现"} |`);
}
lines.push("", "## 二、全局缺失的画板类", "");
lines.push(missingGlobally.length ? missingGlobally.map((c) => `- \`${c}\``).join("\n") : "（无）");
lines.push("", "## 三、按钮签名差异（画板有、产品巡检未命中）", "");
lines.push(buttonGaps.length ? "| 画板 | 帧 | 类 | 图标 | 文本 |\n|---|---|---|---|---|\n" + buttonGaps.slice(0, 200).map((g) => `| ${g.board} | ${g.feature.replace(/\|/g, "/")} | ${g.cls} | ${g.ico ?? ""} | ${g.text} |`).join("\n") : "（无）");
lines.push("", "## 四、巡检步骤与截图", "");
for (const t of tour) {
  lines.push(`- \`${t.shot}\` — **${t.name}**：${t.note}${t.err ? ` · ⚠️ ${t.err}` : ""}（${t.classes.length} 类 / ${t.buttons.length} 可点）`);
}
lines.push("", `## 五、汇总`, "", `- 画板类落地率：**${appClasses.size} / ${boardClasses.size} = ${pct(appClasses.size, boardClasses.size)}**`, `- 按帧计无缺口：${rows.filter((r) => !r.missing.length).length} / ${rows.length}`, "");
writeFileSync(join(OUT, "report.md"), lines.join("\n"));

console.log(`\n画板类落地率 ${appClasses.size}/${boardClasses.size} = ${pct(appClasses.size, boardClasses.size)}；无缺口帧 ${rows.filter((r) => !r.missing.length).length}/${rows.length}`);
console.log(`报告：${join(OUT, "report.md")}`);
if (!KEEP_OPEN) await browser.close();
