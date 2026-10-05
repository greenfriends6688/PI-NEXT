#!/usr/bin/env node
/* 画板出图：把每张 v5 画板截成 PNG，顺带把「真点一遍」的冒烟做掉。
 *
 * 跑法：
 *   node design/v5/scripts/shoot.mjs                # 全部画板 → .shots/
 *   node design/v5/scripts/shoot.mjs --only D-21    # 只某张（子串匹配）
 *   node design/v5/scripts/shoot.mjs --dark         # 顺带截一张深色
 *
 * 为什么要有这个脚本：画板的价值在于「能看见、能点」。
 * check-v5.mjs 管静态（令牌/类/接线），这个管运行时（渲染出来是什么样、点了会不会变）——
 * 两件事都不能靠人眼记忆，截图是给人和给 AI 复看用的存档。
 */
import { mkdirSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { launchChrome } from "../../../scripts/launch-chrome.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const V5 = HERE.replace(/\/scripts$/, "");
const OUT = join(V5, "preview");  // 不能叫 .shots：http.server 不服务点目录，缩略图会全 404
const BASE = process.env.BOARD_BASE_URL || "http://127.0.0.1:39411/v5";

const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;
const dark = process.argv.includes("--dark");

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const boards = [];
for (const form of ["web", "pwa"]) {
  const dir = join(V5, form, "boards");
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".html")).sort()) {
    if (only && !f.includes(only)) continue;
    boards.push({ form, file: f });
  }
}
if (!boards.length) {
  console.error(only ? `没有匹配 "${only}" 的画板` : "一张画板都没有");
  process.exit(2);
}

const browser = await launchChrome();
const page = await browser.newPage({ viewport: { width: 1560, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];

page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
page.on("console", (m) => {
  const t = m.text();
  if (m.type() !== "error") return;
  const url = m.location()?.url || "";
  if (url.includes("favicon.ico")) return; // 静态服务器没有 favicon，与画板无关
  errors.push(`[console] ${t}`);
});

let smokeFails = 0;
const stats = { boards: 0, icons: 0, iconsOk: 0, demos: 0, demosOk: 0 };

for (const { form, file } of boards) {
  const url = `${BASE}/${form}/boards/${file}`;
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(450); // 等图标 hydrate + 首帧动画落位

  /* 冒烟 1：图标真的被注入了（icons.js 的自跑有没有生效） */
  const icoTotal = await page.locator("[data-ico]").count();
  const icoDone = await page.locator("[data-ico][data-ico-done]").count();
  if (icoTotal && icoDone < icoTotal) {
    errors.push(`${file}: 图标只注入了 ${icoDone}/${icoTotal} —— icons.js 路径或 hydrate 失效`);
  }

  /* 冒烟 1b：库里用到的按钮 / 输入件真的被归零过 UA 样式。
     2026-10-05 实测抓到过一次：`.d-radiorow` 在画板上就是 <button>，库里没写
     `button.d-radiorow`，于是画板自己就在展示 2px outset 灰底 + 居中 Arial ——
     静态门禁（类/令牌/图标）全绿，因为这不是拼写问题，是「浏览器默认长什么样」问题。 */
  const uaStyled = await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll("button, input, select, textarea")) {
      const cs = getComputedStyle(el);
      const uaBg = cs.backgroundColor === "rgb(239, 239, 239)" || cs.backgroundColor === "buttonface";
      const uaBorder = /outset|inset/.test(cs.borderTopStyle);
      if (!uaBg && !uaBorder) continue;
      const own = [...el.classList].filter((c) => /^[dm]-/.test(c)).join(" ");
      bad.push(`${own || el.tagName}（bg=${cs.backgroundColor} border=${cs.borderTopStyle}）`);
    }
    return [...new Set(bad)];
  });
  if (uaStyled.length) {
    errors.push(`${file}: ${uaStyled.length} 个控件还带着浏览器默认样式 —— 库里缺 button.d-* / .m-* 归零规则：${uaStyled.join(" / ")}`);
  }

  /* 截图先于探针 —— index 的缩略图要显示**默认打开的样子**。
     顺序反了的话，存图会停在「所有触发件都被点完之后」的最后一档
     （切到 Galaxy Tab、切到第 6 步、切到最后一个页签…），看着像设计错了。 */
  const png = join(OUT, file.replace(/\.html$/, ".png"));
  await page.screenshot({ path: png, fullPage: true });
  if (dark) {
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await page.waitForTimeout(250);
    await page.screenshot({ path: png.replace(/\.png$/, ".dark.png"), fullPage: true });
    await page.evaluate(() => document.documentElement.removeAttribute("data-theme"));
    await page.waitForTimeout(150);
  }

  /* 冒烟 2：每个声明了 data-demo-* 的触发件真点一次，目标状态必须迁移 */
  const probe = await page.evaluate(async () => {
    /* 探针口径（2026-10-04 改）：**组内默认选中的那一项跳过**。
       真实 UI 里点当前页签 / 当前行本来就是无操作，把它当"死件"是探针太严，
       会逼着板子把默认项挪走 —— 那是骗门禁，不是设计。
       但放宽不等于放水：每个组（tabs / list）**至少要有一次真实状态迁移**，
       全组都点不动才判失败。 */
    const vis = (el) => !!(el && el.getClientRects().length);
    const snap = (el) => (el ? el.className + "|" + (el.hidden ? "h" : "v") : "none");
    const results = [];
    const triggers = [...document.querySelectorAll("[data-demo-open],[data-demo-drawer],[data-demo-switch],[data-demo-tab],[data-demo-select],[data-demo-motion]")];
    for (const t of triggers) {
      const open = t.getAttribute("data-demo-open");
      const drawer = t.getAttribute("data-demo-drawer-target");
      const tab = t.getAttribute("data-demo-tab");
      const motion = t.getAttribute("data-demo-motion");
      const target = open ? document.querySelector(`[data-demo-pop="${open}"]`)
        : drawer ? document.querySelector(drawer)
        : motion ? document.querySelector(motion)
        : tab ? t
        : t;
      /* 被页签折起来的触发件也要真测：点它「没反应」只是因为祖先是 [hidden]。
         所以点之前把祖先的 hidden 临时解开，点完还原 —— 测得更狠，不是更松。 */
      const unfold = [];
      for (let el = t; el && el !== document.body; el = el.parentElement) {
        if (el.hidden) { unfold.push(el); el.hidden = false; }
      }
      /* 目标自身**不能**解开：data-demo-open 的语义就是「切换目标的 hidden」，
         提前解开会把「点开」变成「点关」，探针反而判它没反应。
         只解目标之外的祖先（把藏在折叠页签里的触发件露出来）。 */
      if (target && !open) for (let el = target; el && el !== document.body; el = el.parentElement) {
        if (el.hidden) { unfold.push(el); el.hidden = false; }
      }
      const preSelected = t.classList.contains("is-on");
      if (preSelected) { results.push({ label: "（默认选中项）", changed: true, skipped: true }); continue; }
      const before = snap(target);
      const wasVisible = vis(target);
      /* 「重播」类按钮不改类名也不改可见性 —— 唯一可观测的证据是动画被重启。
         两种动画要分开量：
           有限动画（数字淡入）跑完后不再 relevant，点完「重新出现」就是证据；
           无限动画（流光）一直在，currentTime 回零（变小）才是证据。 */
      const anims = (el) => el.getAnimations({ subtree: true });
      const clockOf = (list) => list.reduce((sum, a) => sum + (a.currentTime || 0), 0);
      const before0 = motion && target ? anims(target) : null;
      const clockBefore = before0 ? clockOf(before0) : null;
      const countBefore = before0 ? before0.length : null;
      t.click();
      /* 让一帧过去再量动画时钟：如果「解开隐藏」与「点击」在同一 tick 里发生，
         动画的 currentTime 前后都是 0，会被误判成「点了没反应」（2026-10-04 在
         data-demo-motion 指向隐藏页签时踩到）。多等一帧不是放水，是量对。 */
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const after = snap(target);
      const nowVisible = vis(target);
      const after0 = motion && target ? anims(target) : null;
      const restarted = !!(after0 && !t.getAttribute("data-demo-motion-class")
        && after0.length > 0
        && (clockOf(after0) < clockBefore || countBefore === 0));
      /* 浮层类触发件必须「真的看得见」才算通过 —— 只看 hidden 属性变化会漏掉
         「属性翻了、画面没动」这类假通过（2026-10-04 在 .d-pop 上真实抓到过）。 */
      const mustSee = !!open;
      const changed = mustSee
        ? (wasVisible !== nowVisible)
        : (before !== after || wasVisible !== nowVisible || !!restarted);
      t.dataset.probeOk = changed ? "1" : "0";
      results.push({ label: (t.getAttribute("title") || t.textContent || open || drawer || motion || tab || "?").trim().slice(0, 18),
        changed });
      unfold.forEach((el) => { el.hidden = true; });
    }
    return results;
  });
  const dead = probe.filter((p) => !p.changed && !p.skipped);
  /* 每组至少一次真实迁移：把 data-demo-tabs / data-demo-list 的组逐个统计 */
  const groupDead = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll("[data-demo-tabs],[data-demo-list]").forEach((g) => {
      const items = [...g.querySelectorAll("[data-demo-tab],[data-demo-select]")];
      if (!items.length) return;
      const movable = items.filter((i) => !i.classList.contains("is-on"));
      if (!movable.length) return;            // 组里只有默认项：静态样例，不算问题
      if (!items.some((i) => i.dataset.probeOk === "1")) {
        bad.push((g.className || "（无类）") + " · " + movable.length + " 个可点项都没产生状态迁移");
      }
    });
    return bad;
  });
  if (groupDead.length) { smokeFails += groupDead.length; errors.push(`${file}: ${groupDead.length} 组交互失效 —— ${groupDead.join(" / ")}`); }
  if (dead.length) {
    smokeFails += dead.length;
    errors.push(`${file}: ${dead.length} 个交互件点了没反应 —— ${dead.map((d) => d.label).join(" / ")}`);
  }

  stats.icons += icoTotal; stats.iconsOk += icoDone;
  stats.demos += probe.length; stats.demosOk += probe.length - dead.length;
  console.log(`✓ ${form}/${file}  图标 ${icoDone}/${icoTotal}  交互件 ${probe.length - dead.length}/${probe.length}  → ${basename(png)}`);
}

await browser.close();

if (errors.length) {
  console.log(`\n问题 ${errors.length} 条：`);
  for (const e of errors) console.log("  × " + e);
  writeFileSync(join(OUT, "report.txt"), errors.join("\n"));
  process.exit(1);
}
console.log("\n全部通过。截图在 design/v5/preview/");

/* index.html 直接读这份统计，免得页面上再手写一份数字 */
writeFileSync(join(OUT, "stats.json"), JSON.stringify(
  { ...stats, boards: boards.length, at: new Date().toISOString().slice(0, 16) }, null, 2));