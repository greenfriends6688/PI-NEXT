// 画板 ↔ 产品 逐帧对比（几何 + 计算样式）
//
// 为什么有这个脚本：本项目换肤的唯一正确路线是「照画板的 DOM 原样搬」，
// 而历史上所有翻车（错行、竖线断截、模型名压瘪、浮窗被裁）都发生在
// 「截图看着像」的判定上。这个脚本把判定变成数字：同一个选择器在画板页与
// 产品页各取 getBoundingClientRect + computed style，逐项对数。
//
// 用法：
//   node scripts/board-diff.mjs <spec.mjs> [--json]
//
// spec 形状：
//   export default {
//     name: "SW-08 模型分节",
//     board: "41-settings-models.html",     // design/pi-web-design/ 下的文件
//     boardFrame: 1,                        // 取第几个 .pw-frame（0 起；不给则整页）
//     app: { open: "settings:models" },     // 见下面 PRESETS
//     selectors: [".pw-settings", ".pw-snav", ".pw-field"],  // 两个页面同名的选择器
//     pairs: [["boardSel", "appSel"]],      // 两边选择器不同名时用这个
//     tolerance: { box: 2, fontSize: 0 },   // 允许的像素/字号偏差
//   }
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { launchChrome } from "./launch-chrome.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const BOARD_DIR = join(ROOT, "design/pi-web-design");
const APP_URL = process.env.APP_URL || "http://127.0.0.1:30141";

// 产品侧「打开某个面」的动作库。每个 preset 是一段在页面里跑的脚本。
const OPEN_SESSION = `
  const byIco = (root, name) => [...root.querySelectorAll('[data-ico="' + name + '"]')][0];
  // 项目组默认是收起的（没有选中会话时），先点开箭头再点会话行。
  if (!document.querySelector(".pw-session")) {
    const chev = byIco(document.querySelector(".pw-side-scroll") ?? document, "chevron-right");
    const toggle = chev?.closest("[role=button]");
    if (toggle) { toggle.click(); await new Promise((r) => setTimeout(r, 700)); }
  }
  const row = document.querySelector(".pw-session");
  if (!row) throw new Error("侧栏里没有 .pw-session（种子没被列出来？）");
  row.click();
  await new Promise((r) => setTimeout(r, 2200));`;

const PRESETS = {
  "none": "",
  "home": `
    const el = document.querySelector(".desktop-secondary-workspace-toggle");
    if (el) { el.click(); }`,
  "new-session": `
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes("新建任务"));
    if (b) b.click();`,
  "settings:general": `
    const s = [...document.querySelectorAll("button")].find((x) => x.textContent?.trim() === "设置");
    if (s) s.click();`,

  // fork:board-specs（2026-09-30）—— 转录 / 输入框 / 侧栏要对位，就得让产品
  // 「开着一条有消息的会话」。数据来自 scripts/verify-boards-live.mjs 种的临时
  // agent 目录（PI_CODING_AGENT_DIR）；对着真实服务跑时就是本机最近的一条会话。
  // 找不到目标一律 throw（不静默跳过）—— N-3 记录的假阴性就是这么来的。
  "session:first": OPEN_SESSION,
  // 回合结束后过程时间轴是**折起**的（画板 08 的折叠规则），`11-transcript-process`
  // 要量 `.pw-step` 那一排就得先把它展开。
  "session:first-expanded": `${OPEN_SESSION}
    const head = document.querySelector(".pw-proc-head");
    if (head && head.getAttribute("aria-expanded") === "false") {
      head.click();
      await new Promise((r) => setTimeout(r, 900));
    }`,
  // 点**思考档**那枚芯片，不点「第一个 .pw-select」——那是模型选择器，
  // 它是自绘浮层（.anim-popover，不挂 .pw-pop），点它量不到画板 21 的弹层原子。
  // 思考档的下拉才是画板 21 的那族：.pw-pop / .pw-pop-title / .pw-prow。
  "composer:model-menu": `
    const chips = [...document.querySelectorAll(".pw-select")];
    const chip = chips.find((x) => /推理|Reasoning/.test(x.getAttribute("aria-label") ?? ""))
      ?? chips.find((x) => /工具|Tools/.test(x.getAttribute("aria-label") ?? ""));
    if (!chip) throw new Error("输入框工具条里没有思考档/工具档芯片");
    chip.click();
    await new Promise((r) => setTimeout(r, 900));`,
  "sidebar:collapsed": `
    const b = document.querySelector('.pw-side-head button[aria-controls="session-sidebar"]');
    if (!b) throw new Error("侧栏头部找不到折叠按钮");
    b.click();
    await new Promise((r) => setTimeout(r, 700));`,
  // 顶栏的会话切换器（画板 22 帧 0）：点 .pw-tb-title 出 .pw-pop 下拉。
  "topbar:session-switcher": `
    const title = document.querySelector(".pw-tb-title");
    if (!title) throw new Error("顶栏没有 .pw-tb-title");
    title.click();
    await new Promise((r) => setTimeout(r, 900));`,
};

/**
 * 在设置面板里切到某个分节。
 *
 * fix:settings-section-target —— 原来按**分节行的文字**找
 * （`textContent === "skills"`），但界面是中文（「技能」），于是
 * `settings:skills` 一直是空转的：设置面板根本没打开，随后所有 `.pw-*`
 * 选择器都报「产品里没有这个选择器（未换肤）」。**这个假阴性掩盖了真实的差距**。
 * 现在按 `[data-section]` 找 —— 分节 id 是稳定的、与语言无关的。
 *
 * 另外：分节是**懒挂载**的（`mountedSections`），点完要等它挂上再量。
 */
const settingsSection = (target) => `
  const opener = document.querySelector("button.pw-side-foot");
  if (opener) opener.click();
  await new Promise((r) => setTimeout(r, 1500));
  const byId = document.querySelector('button.pw-row[data-section=${JSON.stringify(target)}]');
  const byText = [...document.querySelectorAll("button.pw-row")].find((x) => x.textContent?.trim() === ${JSON.stringify(target)});
  const row = byId ?? byText;
  if (!row) throw new Error("settings section not found: ${target}");
  row.click();
  await new Promise((r) => setTimeout(r, 1600));`;

function presetScript(app) {
  if (!app) return "";
  if (app.open && app.open.startsWith("settings:")) {
    return settingsSection(app.open.slice("settings:".length));
  }
  return PRESETS[app.open] ?? "";
}

async function probe(page, selectors, frameIndex) {
  return page.evaluate(
    ({ sels, frameIndex }) => {
      // 产品侧：设置分节是**懒挂载 + 常驻**的（`mountedSections`，切走只加 `hidden`）。
      // 直接 `document.querySelector(".pw-scontent")` 会命中**上一个分节**的节点
      // —— 实测：技能页被拿去和常规页的 `.pw-scontent` 比（padding 16 vs 0、block vs flex）。
      // 所以这里不缩范围，而是**跳过藏在 `[hidden]` 里的匹配**：
      // 壳级选择器（`.pw-settings` / `.pw-snav`）在分节宿主之外，照样能取到。
      const scope = frameIndex == null
        ? document
        : document.querySelectorAll(".pw-frame")[frameIndex];
      const visibleOnly = frameIndex == null;
      const pick = (sel) => {
        for (const el of scope.querySelectorAll(sel)) {
          if (!visibleOnly) return el;
          if (!el.closest("[hidden]")) return el;
        }
        return null;
      };
      if (!scope) return { __error: "frame not found" };
      const out = {};
      for (const sel of sels) {
        const el = pick(sel);
        if (!el) {
          out[sel] = { missing: true };
          continue;
        }
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const parent = el.parentElement;
        const pcw = parent ? parent.clientWidth - parseFloat(getComputedStyle(parent).paddingLeft) - parseFloat(getComputedStyle(parent).paddingRight) : 0;
        out[sel] = {
          w: +r.width.toFixed(1),
          h: +r.height.toFixed(1),
          // 撑满父容器的块：宽度差只反映「画板预览框有内边距」这个取景差异，
          // 不是组件本身的差，比较时跳过（否则每一层都差同一个 50px 噪音）
          fills: pcw > 0 && Math.abs(r.width - pcw) < 1.5,
          // 元素自身的文本（前 24 字）。两边文本不同的，宽度必然不同（「填满」vs「系统默认」），
          // 那是内容差异不是样式差异 —— 宽度不参与判定，样式仍然逐项比。
          text: (el.textContent || "").trim().slice(0, 24),
          radius: cs.borderRadius,
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
          padding: cs.padding,
          gap: cs.gap,
          display: (() => {
            const pd = parent ? getComputedStyle(parent).display : "";
            return /flex|grid/.test(pd) && cs.display.startsWith("inline-") ? cs.display.slice(7) : cs.display;
          })(),
          tag: el.tagName.toLowerCase(),
          alignItems: cs.alignItems,
          color: cs.color,
          background: cs.backgroundColor,
          borderWidth: cs.borderTopWidth,
          borderColor: cs.borderTopColor,
          lineHeight: cs.lineHeight,
        };
      }
      return out;
    },
    { sels: selectors, frameIndex },
  );
}

// 哪些属性必须逐字相同，哪些允许像素级容差
const EXACT = ["radius", "fontSize", "fontWeight", "padding", "gap", "display", "alignItems", "lineHeight"];
const NUMERIC = ["w", "h"];
const IGNORE = ["color", "background", "borderColor"]; // 主题色受皮肤/壁纸影响，单独由 check-contrast 管

/** 裸 <button> 的 UA 默认值：画板原子带着它们，产品归零，不算漂移（见 compare）。 */
const UA_BUTTON = { padding: "1px 6px", fontSize: "13.3333px", lineHeight: "normal" };

/**
 * 父容器是 flex/grid 时，`inline-X` 的子元素实际按 `X` 排版（CSS blockification）。
 * fork:board-diff-blockify —— 画板样张与产品组件常在两种父容器里，拿原值比等于在比父容器。
 * 注意：probe 的取样式在**页面上下文**里跑，那份实现写在 evaluate 内部（这里保留同一份供阅读）。
 */
function compare(boardVal, appVal, tol) {
  const diffs = [];
  for (const k of EXACT) {
    if (boardVal[k] === appVal[k]) continue;
    // fork:board-diff-ua-button —— 画板的原子是**裸 <button>**，产品按 §4.1 把 UA 盒归零
    // （padding 1px 6px / 字号 13.33 / line-height normal）。这是 UA 层不是设计差异，
    // 且每一份比到 .pw-iconbtn 的 spec 都会撞到，所以在工具里放行：
    // **只在画板侧确实就是 button 的 UA 默认值时**跳过这三项。
    if (boardVal.tag === "button" && UA_BUTTON[k] === boardVal[k]) continue;
    diffs.push(`${k}: 画板 ${boardVal[k]} ≠ 产品 ${appVal[k]}`);
  }
  // 只有「两边都不是撑满父容器的块」且「文本相同」时才比宽度——
  // 撑满的差的是取景框内边距，文本不同的差的是内容长度
  const comparable = !(boardVal.fills && appVal.fills) && boardVal.text === appVal.text;
  if (comparable) {
    for (const k of NUMERIC) {
      const d = Math.abs(boardVal[k] - appVal[k]);
      if (d > (tol.box ?? 2)) diffs.push(`${k}: 画板 ${boardVal[k]} ≠ 产品 ${appVal[k]}（差 ${d.toFixed(1)}px）`);
    }
  }
  return diffs;
}

const specPath = process.argv[2];
const asJson = process.argv.includes("--json");
if (!specPath || !existsSync(specPath)) {
  console.error("用法：node scripts/board-diff.mjs <spec.mjs> [--json]");
  process.exit(2);
}
const spec = (await import(pathToFileURL(resolve(specPath)).href)).default;
const tol = spec.tolerance ?? {};

const selectors = spec.selectors ?? [];
const pairs = spec.pairs ?? selectors.map((s) => [s, s]);
const allBoard = [...new Set(pairs.map((p) => p[0]))];
const allApp = [...new Set(pairs.map((p) => p[1]))];

const browser = await launchChrome();

// 连跑十几份 spec 时偶发 "waiting until load" 超时（Chrome 在忙，30s 默认值不够），
// 一次重试就够 —— 不带重试的版本会让整轮汇总里冒出一份「（无结果）」。
const goto = async (page, url) => {
  try {
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
  } catch {
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
  }
};
const results = [];
let fails = 0;
let skipped = 0;

try {
  // 画板页
  const bp = await browser.newPage({ viewport: spec.viewport ?? { width: 1440, height: 900 } });
  await goto(bp, pathToFileURL(join(BOARD_DIR, spec.board)).href);
  // 画板页有自己的「取景外壳」：body 的 24px 外边距、.pw-frame 的 1px 边框与 1440 上限、
  // .pw-frame-body 的 pw-pad 内边距。它们不是被设计的组件的一部分，却会让每一层容器
  // 比产品窄 50px，逐项对数时整片飘红。剥掉外壳，让两边内容宽一致，剩下的差异才是真的。
  if (spec.frameChrome !== "keep") {
    await bp.addStyleTag({
      content: `
        body.pw { padding: 0 !important; }
        .pw-frame { max-width: none !important; margin: 0 !important; border: 0 !important;
                    border-radius: 0 !important; box-shadow: none !important; overflow: visible !important; }
        .pw-frame-label { display: none !important; }
        .pw-frame-body.pw-pad, .pw-frame-body[class*="pw-pad"] { padding: 0 !important; }
        .pw-head { display: none !important; }
        .pw-notes { display: none !important; }
      `,
    });
  }
  await bp.waitForTimeout(700);
  const boardRes = await probe(bp, allBoard, spec.boardFrame);
  await bp.close();

  // 产品页
  const ap = await browser.newPage({ viewport: spec.viewport ?? { width: 1440, height: 900 } });
  const consoleErrors = [];
  ap.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
  await goto(ap, APP_URL);
  await ap.waitForTimeout(6500);
  const script = presetScript(spec.app);
  if (script) {
    await ap.evaluate(`(async () => { ${script} })()`);
    await ap.waitForTimeout(spec.app?.settle ?? 2200);
  }
  const appRes = await probe(ap, allApp, null);
  await ap.close();

  const known = new Map((spec.knownDiffs ?? []).map((k) => [k.sel, k.reason]));
  for (const [bs, as_] of pairs) {
    const bv = boardRes[bs];
    const av = appRes[as_];
    if (!bv || bv.missing) { skipped++; results.push({ sel: bs, status: "skip", why: "画板里没有这个选择器" }); continue; }
    if (!av || av.missing) {
      // 「产品里没有」不一定是不符：详情卡 / 编辑器那类节点**要有数据或选中态才存在**
      // （模型页没选供应商、自定义命令 0 条）。登记过就按已登记分歧算，不再一律判失败。
      if (known.has(as_)) { results.push({ sel: as_, status: "known", diffs: [], why: known.get(as_) }); continue; }
      fails++; results.push({ sel: as_, status: "FAIL", why: "产品里没有这个选择器（未换肤）" }); continue;
    }
    const diffs = compare(bv, av, tol);
    if (!diffs.length) { results.push({ sel: as_, status: "OK" }); continue; }
    if (known.has(as_)) { results.push({ sel: as_, status: "known", diffs, why: known.get(as_) }); continue; }
    fails++;
    results.push({ sel: as_, status: "FAIL", diffs });
  }

  if (asJson) {
    console.log(JSON.stringify({ name: spec.name, fails, skipped, results, consoleErrors }, null, 2));
  } else {
    console.log(`\n═══ ${spec.name ?? spec.board} ═══`);
    console.log(`画板：design/pi-web-design/${spec.board}${spec.boardFrame != null ? ` （第 ${spec.boardFrame} 帧）` : ""}`);
    console.log(`产品：${APP_URL}  ·  open=${spec.app?.open ?? "none"}\n`);
    for (const r of results) {
      if (r.status === "OK") continue;
      if (r.status === "skip") { console.log(`  ⊘ ${r.sel} —— ${r.why}`); continue; }
      if (r.status === "known") {
        console.log(`  ⊘ ${r.sel} —— 已登记：${r.why}`);
        for (const d of r.diffs ?? []) console.log(`      ${d}`);
        continue;
      }
      console.log(`  ✗ ${r.sel}`);
      if (r.why) console.log(`      ${r.why}`);
      for (const d of r.diffs ?? []) console.log(`      ${d}`);
    }
    const ok = results.filter((r) => r.status === "OK").length;
    const kn = results.filter((r) => r.status === "known").length;
    console.log(`\n  ${ok} 项一致 · ${fails} 项不符 · ${kn} 项已登记分歧 · ${skipped} 项跳过`);
    if (consoleErrors.length) console.log(`\n  控制台错误 ${consoleErrors.length} 条：\n    ${consoleErrors.slice(0, 3).join("\n    ")}`);
  }
} finally {
  await browser.close();
}
process.exit(fails ? 1 : 0);
