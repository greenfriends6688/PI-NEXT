// 画板可点击性冒烟 —— 「可点」这件事必须可验证，不能靠人点一遍。
//
// 为什么需要它：board-demo.js 是声明式的，画板只加 data-demo-* 属性。
// 属性写了但目标选择器打错一个字，**页面上什么都不会发生，控制台也不报错** ——
// 这正是历史上 `.fork-msg-actions` → `.pw-msg-acts` 那类事故的形态：
// 规则静默失效，编译期、单测、肉眼评审全都看不见。
//
// 本脚本对每个声明了 data-demo-* 的触发件**真点一次**，断言目标状态真的迁移了。
//
// 用法：node design/pi-web-design/scripts/check-demo.mjs [文件...]
// 依赖：本机 Chrome（macOS 12 上 Playwright 自带 chromium 不兼容，必须走 channel: "chrome"）

import { chromium } from "playwright";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(HERE, "..");

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(DIR).filter((f) => f.endsWith(".html") && f !== "index.html").sort();

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });

/** 安全点击：目标不可达时不挂死 30s，而是报出来。
 *  不可达往往不是接线错，而是它藏在另一个关着的抽屉里 —— 这本身是要报出来的事实。 */
async function clickOrReport(file, selector, nth, label) {
  try {
    const el = page.locator(selector).nth(nth);
    await el.click({ timeout: 5000 });
    return true;
  } catch {
    console.log(`✗ ${file} ${label}：不可达（多半藏在关着的抽屉或隐藏的浮层里）`);
    errors++;
    return false;
  }
}

/** 让目标变得可点，并返回是否成功。
 *
 *  同构范式下需要走的情况只有一种：**目标藏在关着的抽屉里**（抽屉里的页签、关闭钮）。
 *  真机上你会先把抽屉拉出来再点 —— 检查器不能假设「目标一开始就在当前屏」。
 *
 *  ⚠️ 不要在开头加「已可见就早退」：关着的抽屉是被 transform 移出屏幕的，
 *  Playwright 的 isVisible() **不把 transform 算进去**，照样返回 true，
 *  早退就会跳过「开抽屉」这一步，点的时候元素被遮罩盖住 → 失败。 */
async function reveal(selector, nth = 0) {
  const loc = () => page.locator(selector).nth(nth);
  await page.evaluate(
    ({ sel, n }) => {
      const el = document.querySelectorAll(sel)[n];
      if (!el) return;
      const drawer = el.closest(".pw-drawer");
      if (drawer && drawer.id && !drawer.classList.contains("is-open")) {
        const t = document.querySelector(`[data-demo-drawer][data-demo-drawer-target="#${drawer.id}"]`);
        if (t) t.click();
      }
      const pop = el.closest("[data-demo-pop]");
      if (pop && pop.hidden) {
        const t = document.querySelector(`[data-demo-open="${pop.getAttribute("data-demo-pop")}"]`);
        if (t) t.click();
      }
    },
    { sel: selector, n: nth },
  );
  await page.waitForTimeout(220);
  return loc().isVisible().catch(() => false);
}

let errors = 0;
let checks = 0;
const noWiring = [];

for (const f of files) {
  await page.goto(pathToFileURL(join(DIR, f)).href, { waitUntil: "load" });
  await page.waitForTimeout(200);

  const plan = await page.evaluate(() => ({
    pops: [...document.querySelectorAll("[data-demo-open]")].map((e) => e.dataset.demoOpen),
    tabs: [...document.querySelectorAll("[data-demo-tab]")].map((e) => e.dataset.demoTab),
    drawers: [...document.querySelectorAll("[data-demo-drawer]")].length,
    appends: [...document.querySelectorAll("[data-demo-append]")].length,
  }));

  const total = plan.pops.length + plan.tabs.length + plan.drawers + plan.appends;
  if (total === 0) {
    noWiring.push(f);
    continue;
  }

  /* 浮层：点开 → 目标必须可见 */
  for (const id of plan.pops) {
    checks++;
    await page.keyboard.press("Escape");
    const sel = `[data-demo-open="${id}"]`;
    if (!(await reveal(sel))) {
      console.log(`✗ ${f} 浮层 ${id}：触发钮不可见`);
      errors++;
      continue;
    }
    if (!(await clickOrReport(f, sel, 0, `浮层 ${id}`))) continue;
    await page.waitForTimeout(80);
    const ok = await page.evaluate(
      (i) => {
        const pop = document.querySelector(`[data-demo-pop="${i}"]`);
        return !!pop && !pop.hidden;
      },
      id,
    );
    if (!ok) {
      console.log(`✗ ${f} 浮层 ${id}：点了 [data-demo-open="${id}"]，[data-demo-pop="${id}"] 仍是 hidden`);
      errors++;
    }
  }

  /* 页签：点一个 → 对应 pane 必须可见，且同组其余 pane 必须隐藏 */
  for (const id of plan.tabs) {
    checks++;
    if (!(await reveal(`[data-demo-tab="${id}"]`))) {
      console.log(`✗ ${f} 页签 ${id}：页签本身不可见`);
      errors++;
      continue;
    }
    if (!(await clickOrReport(f, `[data-demo-tab="${id}"]`, 0, `页签 ${id}`))) continue;
    await page.waitForTimeout(60);
    const res = await page.evaluate((i) => {
      const btn = document.querySelector(`[data-demo-tab="${i}"]`);
      const group = btn.closest("[data-demo-tabs]");
      const scope = group.closest("[data-demo-scope]") || document;
      const panes = [...scope.querySelectorAll("[data-demo-pane]")];
      const target = scope.querySelector(`[data-demo-pane="${i}"]`);
      return {
        exists: !!target,
        visible: !!target && !target.hidden,
        othersHidden: panes.filter((p) => p !== target).every((p) => p.hidden),
      };
    }, id);
    if (!res.exists) {
      console.log(`✗ ${f} 页签 ${id}：没有对应的 [data-demo-pane="${id}"]`);
      errors++;
    } else if (!res.visible || !res.othersHidden) {
      console.log(`✗ ${f} 页签 ${id}：pane 未切换（visible=${res.visible} othersHidden=${res.othersHidden}）`);
      errors++;
    }
  }

  /* 抽屉：点一次 → 目标必须有 .is-open */
  for (let i = 0; i < plan.drawers; i++) {
    checks++;
    if (!(await reveal("[data-demo-drawer]", i))) {
      console.log(`✗ ${f} 抽屉 #${i}：触发钮不可见`);
      errors++;
      continue;
    }
    const before = await page.evaluate((n) => {
      const btn = document.querySelectorAll("[data-demo-drawer]")[n];
      const t = document.querySelector(btn.getAttribute("data-demo-drawer-target") || "#side");
      return t ? t.classList.contains("is-open") : null;
    }, i);
    if (before === null) {
      console.log(`✗ ${f} 抽屉 #${i}：目标元素不存在`);
      errors++;
      continue;
    }
    await page.evaluate((n) => document.querySelectorAll("[data-demo-drawer]")[n].click(), i);
    await page.waitForTimeout(80);
    const after = await page.evaluate((n) => {
      const btn = document.querySelectorAll("[data-demo-drawer]")[n];
      const t = document.querySelector(btn.getAttribute("data-demo-drawer-target") || "#side");
      return t.classList.contains("is-open");
    }, i);
    if (after === before) {
      console.log(`✗ ${f} 抽屉 #${i}：点后 .is-open 没有变化（仍是 ${before}）`);
      errors++;
    }
  }

  /* 模拟发送：点一次 → 目标容器子节点必须变多 */
  for (let i = 0; i < plan.appends; i++) {
    checks++;
    if (!(await reveal("[data-demo-append]", i))) {
      console.log(`✗ ${f} 追加 #${i}：发送钮不可见`);
      errors++;
      continue;
    }
    const before = await page.evaluate((n) => {
      const btn = document.querySelectorAll("[data-demo-append]")[n];
      const to = document.querySelector(btn.getAttribute("data-demo-append"));
      return to ? to.childElementCount : null;
    }, i);
    if (before === null) {
      console.log(`✗ ${f} 追加 #${i}：目标容器不存在`);
      errors++;
      continue;
    }
    await page.evaluate((n) => document.querySelectorAll("[data-demo-append]")[n].click(), i);
    await page.waitForTimeout(120);
    const after = await page.evaluate((n) => {
      const btn = document.querySelectorAll("[data-demo-append]")[n];
      const to = document.querySelector(btn.getAttribute("data-demo-append"));
      return to.childElementCount;
    }, i);
    if (after <= before) {
      console.log(`✗ ${f} 追加 #${i}：子节点数没有增加（${before} → ${after}）`);
      errors++;
    }
  }
}

await browser.close();

console.log(`\n检查 ${files.length} 张画板：${checks} 个交互件，${errors} 处失效`);
if (noWiring.length) {
  console.log(`\n尚无交互接线（${noWiring.length} 张，加 data-demo-* 属性即可）：`);
  console.log("  " + noWiring.join(", "));
}
process.exit(errors ? 1 : 0);
