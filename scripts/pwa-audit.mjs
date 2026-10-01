// fork:pwa-audit — 逐个打开界面并在手机宽度下量问题，产出截图 + 缺陷清单。
//
//   node scripts/pwa-audit.mjs                 # 390x844 全量
//   node scripts/pwa-audit.mjs 768 1024         # 平板档
//   node scripts/pwa-audit.mjs 390 844 chat settings
//
// 每个界面：截图存 /tmp/pwa-audit/<w>-<name>.png，并打印该界面的量测（见 measure）。
// 量测只报「真问题」：横向溢出页面、溢出但父级不可横向滚（= 被裁掉）、触摸靶 < 32px。
import { chromium, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const W = Number(process.argv[2] || 390);
const H = Number(process.argv[3] || 844);
const ONLY = process.argv.slice(4);
const URL = process.env.PROBE_URL || "http://127.0.0.1:30141/";
const OUT = process.env.PROBE_OUT || `/tmp/pwa-audit/${W}`;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: W <= 640 ? devices["iPhone 13"].userAgent : devices["iPad Mini"].userAgent,
});
const page = await ctx.newPage();
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e.message)));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

const aria = (label) => `button[aria-label="${label}"]`;
/** 正常点不动、需要 force 的选择器（= 命中区被盖或永远不稳定）。 */
const hardClicks = [];
/** 依次尝试若干选择器，点第一个真正可见的。 */
const tap = async (selectors, ms = 700) => {
  const list = Array.isArray(selectors) ? selectors : [selectors];
  for (const s of list) {
    const loc = page.locator(s).first();
    if (await loc.isVisible().catch(() => false)) {
      try {
        await loc.click({ timeout: 4000 });
      } catch {
        // 点不动（被盖 / 一直不稳定）本身就是要报的信号，记下来再 force
        hardClicks.push(s);
        await loc.click({ timeout: 8000, force: true });
      }
      await page.waitForTimeout(ms);
      return true;
    }
  }
  throw new Error(`no visible selector: ${list.join(" | ")}`);
};
const tapText = (text, ms) => tap([`text=${text}`], ms);
/** 幂等地打开抽屉：上一步可能已经开着，再点「隐藏」反而会把它关掉。 */
const openSidebar = async () => {
  const open = await page.locator(".sidebar-container.sidebar-open").isVisible().catch(() => false);
  if (open) return;
  await tap([aria("显示侧边栏"), ".pw-touch[data-ico=menu]"], 1000);
};
const openSettings = async () => {
  await openSidebar();
  await tap(["button.pw-side-foot"], 1100);
};
/** 切设置分节：桌面点左栏导航，手机走页头下拉（窄屏侧栏导航是 display:none）。 */
const section = async (id) => {
  const picker = page.locator(".settings-mobile-section-picker");
  if (await picker.isVisible().catch(() => false)) {
    await picker.selectOption(id);
  } else {
    await page.locator(`.settings-section-tabs >> text=${id}`).first().click({ timeout: 8000 });
  }
  await page.waitForTimeout(1100);
};
const esc = async () => {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
};

// 页面常驻 SSE（running 轮询 / agent events），networkidle 永远等不到；等 app shell 出现即可。
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector('[class*="shell"]', { timeout: 30000 });
await page.waitForTimeout(1500);

/** 量测当前界面。返回结构化缺陷。 */
const measure = (label) =>
  page.evaluate((label) => {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const short = (el) =>
      el.tagName.toLowerCase() +
      (el.className && typeof el.className === "string"
        ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".")
        : "");

    const clipped = [];
    const smallTargets = [];
    const seen = new Set();
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") continue;
      // 被裁切：自身右/左超出视口，且向上没有可横向滚动的祖先
      const outR = Math.round(r.right - vw);
      const outL = Math.round(-r.left);
      // 整块在视口外（关闭的抽屉靠 translate 移走）不算缺陷
      const fullyOutside = r.right <= 1 || r.left >= vw - 1;
      if (!fullyOutside && (outR > 2 || outL > 2)) {
        let p = el.parentElement;
        let scrollable = false;
        while (p && p !== document.body) {
          const pcs = getComputedStyle(p);
          if (/auto|scroll/.test(pcs.overflowX) && p.scrollWidth > p.clientWidth + 2) {
            scrollable = true;
            break;
          }
          // `overflow:hidden` 不停：很多条带是「外层 hidden、内层 auto」两层滚动容器，
          // 在 hidden 处 break 会把条带里的卡片误报成「被裁掉」（假阳性）。
          p = p.parentElement;
        }
        const key = short(el);
        if (!scrollable && !seen.has(key)) {
          seen.add(key);
          clipped.push({ el: key, outRight: outR, outLeft: outL, w: Math.round(r.width), txt: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 34) });
        }
      }
      // 触摸靶过小（只查可交互元素）
      if (el.matches("button, a, [role=tab], input, select") && !el.closest("[hidden]")) {
        const box = el.getBoundingClientRect();
        if (box.width >= 1 && box.height >= 1 && (box.width < 28 || box.height < 28)) {
          const k = "T" + short(el);
          if (!seen.has(k)) {
            seen.add(k);
            smallTargets.push({ el: short(el), w: Math.round(box.width), h: Math.round(box.height), txt: (el.textContent || "").trim().slice(0, 20) });
          }
        }
      }
    }
    return {
      label,
      vw,
      docScrollW: document.documentElement.scrollWidth,
      pageOverflowX: document.documentElement.scrollWidth - vw,
      clipped: clipped.sort((a, b) => b.outRight - a.outRight).slice(0, 12),
      smallTargets: smallTargets.slice(0, 8),
    };
  }, label);

/** 逐界面走查。每个 step：打开 → 量测 → 截图。 */
const steps = [
  {
    name: "chat",
    async run() {},
  },
  {
    name: "sidebar",
    async run() {
      await openSidebar();
    },
  },
  {
    name: "sidebar-files",
    async run() {
      await tap([".pw-seg >> text=文件", "text=文件"]);
    },
  },
  {
    name: "settings",
    async run() {
      await esc();
      await openSettings();
    },
  },
  {
    name: "settings-models",
    async run() {
      await esc();
      await openSettings();
      await section("models");
    },
  },
  {
    name: "settings-skills",
    async run() {
      await esc();
      await openSettings();
      await section("skills");
    },
  },
  {
    name: "settings-plugins",
    async run() {
      await esc();
      await openSettings();
      await section("plugins");
    },
  },
  {
    name: "settings-agents",
    async run() {
      await esc();
      await openSettings();
      await section("agents");
    },
  },
  {
    name: "settings-appearance",
    async run() {
      await esc();
      await openSettings();
      await section("general");
    },
  },
  {
    name: "topbar-more",
    async run() {
      await esc();
      await tap([`header ${aria("更多控件")}`, `.top-bar ${aria("更多控件")}`, aria("更多控件")]);
    },
  },
  {
    name: "model-picker",
    async run() {
      await esc();
      await tap([".model-selector .pw-select", ".pw-select"]);
    },
  },
  {
    name: "file-panel",
    async run() {
      await esc();
      await tap([aria("显示文件面板"), aria("隐藏文件面板"), "[data-ico=panel-right]"]);
    },
  },
  {
    name: "composer-more",
    async run() {
      await esc();
      await tap([".chat-input-shell " + aria("更多控件"), aria("更多控件")]);
    },
  },
  /* ---- shell 层（无专属 owner，由上层处理） ---- */
  {
    name: "shell-session-menu",
    async run() {
      await esc();
      await openSidebar();
      await page.locator(".pw-side-scroll .pw-row").nth(3).click({ button: "right", timeout: 8000 });
      await page.waitForTimeout(700);
    },
  },
  {
    name: "shell-folder-picker",
    async run() {
      await esc();
      await page.locator(".pw-composer textarea, .chat-input-shell textarea").first().focus();
      await page.waitForTimeout(300);
    },
  },
  {
    name: "shell-terminal",
    async run() {
      await esc();
      await tap([".file-browser-toolbar [data-ico=terminal]", aria("打开工作区终端")], 1500);
    },
  },
  {
    name: "shell-file-viewer",
    async run() {
      await esc();
      await tap([aria("显示文件面板"), aria("隐藏文件面板")], 1200);
      await tap(['text=build.py', '.file-row:has-text("build.py")'], 1500);
    },
  },
];

const results = [];
for (const step of steps) {
  if (ONLY.length && !ONLY.includes(step.name)) continue;
  try {
    await step.run();
    const m = await measure(step.name);
    await page.screenshot({ path: `${OUT}/${step.name}.png` });
    results.push(m);
    const bad = m.pageOverflowX > 2 || m.clipped.length || m.smallTargets.length;
    console.log(`\n### ${step.name} ${bad ? "❌" : "✅"} overflowX=${m.pageOverflowX} clipped=${m.clipped.length} smallTargets=${m.smallTargets.length}`);
    if (m.clipped.length) console.log("  clipped: " + JSON.stringify(m.clipped.slice(0, 8)));
    if (m.smallTargets.length) console.log("  small: " + JSON.stringify(m.smallTargets.slice(0, 5)));
  } catch (err) {
    console.log(`\n### ${step.name} ⚠️  ${String(err).split("\n")[0]}`);
    results.push({ label: step.name, error: String(err).split("\n")[0] });
  }
}
writeFileSync(`${OUT}/report.json`, JSON.stringify({ width: W, results, consoleErrors: [...new Set(consoleErrors)].slice(0, 20) }, null, 2));
if (consoleErrors.length) console.log("\nCONSOLE ERRORS:\n" + [...new Set(consoleErrors)].slice(0, 10).join("\n"));
console.log(`\nscreenshots -> ${OUT}`);
await browser.close();