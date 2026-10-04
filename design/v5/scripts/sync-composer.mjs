// 统一 V5 画板里的输入卡（composer）。
//
// 为什么要有这个脚本：同一个输入框在 9 张板里出现过 27 次，每次都长得不一样 ——
// 有的只有一枚发送钮、有的把「模型/工具/权限」画在卡片下方另一行、有的把它们当
// 引用芯片塞在卡片顶行，图标与文案也各写各的（工具：全部 / 工具：完整 / 仅本项目可写）。
// 产品里的真值只有一套（components/ChatInput.tsx）：
//
//   卡外 .d-ctxbar   = 项目芯片 + 分支芯片（「这轮在哪跑」的事实行，无铬）
//   卡内 .d-composer-top = 草稿文字（textarea）
//   卡内 .d-chips    = 附件 / 引用芯片（只在真有附件时出现）
//   卡内 .d-composer-bar = 附件 · 更多动作 · 模型 · 思考 · 权限 · 工具 ｜ 上下文环 · 声音 · 发送
//
// 本脚本把每张板的 composer 重写成同一套 DOM，只保留与**帧本身有关**的东西：
// 草稿文字、附件芯片、弹层、以及状态（发送/停止/禁用/排队/未选工作区）。
//
// 用法：
//   node design/v5/scripts/sync-composer.mjs           # dry-run，打印每张板的改动
//   node design/v5/scripts/sync-composer.mjs --apply    # 写入
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");

/* ---- 工具：按 div 配平取出一个块 ---- */
function elemAt(html, start) {
  const m = /<([a-z][a-z0-9-]*)\b[^>]*>/.exec(html.slice(start, start + 400));
  if (!m) return null;
  const tag = m[1];
  const re = new RegExp(`<(\\/?)${tag}\\b[^>]*>`, "g");
  re.lastIndex = start;
  let depth = 0;
  let g;
  while ((g = re.exec(html))) {
    depth += g[1] ? -1 : 1;
    if (depth === 0) return { start, end: re.lastIndex, html: html.slice(start, re.lastIndex), tag };
  }
  return null;
}
function findAll(html, className) {
  const out = [];
  const re = new RegExp('class="([^"]*)"', "g");
  let m;
  while ((m = re.exec(html))) {
    if (!m[1].split(/\s+/).includes(className)) continue;
    const el = elemAt(html, html.lastIndexOf("<", m.index));
    if (el) out.push(el);
  }
  return out;
}
function findEl(html, className, from = 0) {
  const re = new RegExp('class="([^"]*)"', "g");
  re.lastIndex = from;
  let m;
  while ((m = re.exec(html))) {
    if (!m[1].split(/\s+/).includes(className)) continue;
    return elemAt(html, html.lastIndexOf("<", m.index));
  }
  return null;
}
function findDiv(html, className, from = 0) {
  // 必须按**类名 token** 匹配：`indexOf('class="d-composer')` 会把 `d-composer-wrap`
  // （外层那个盒子）当成卡片本身，于是卡外的兄弟块（队列面板等）整块被吞掉。
  const re = new RegExp(`<div class="([^"]*)"`, "g");
  re.lastIndex = from;
  let m;
  while ((m = re.exec(html))) {
    if (m[1].split(/\s+/).includes(className)) return elemAt(html, html.lastIndexOf("<", m.index));
  }
  return null;
}
const innerOf = (blockHtml) => {
  const open = blockHtml.indexOf(">");
  return blockHtml.slice(open + 1, blockHtml.lastIndexOf("</div>"));
};

/* ---- 规范件 ---- */
const ICO = (n, s) => `<i data-ico="${n}" data-size="${s}"></i>`;

function ctxbarChips(project) {
  if (!project) {
    return `            <button class="d-chipbtn is-on">${ICO("folder", 12)}<span class="d-ctx-name">选择工作区</span>${ICO("chevron-down", 11)}</button>`;
  }
  return `            <button class="d-chipbtn">${ICO("folder", 12)}<span class="d-ctx-name">${project}</span>${ICO("chevron-down", 11)}</button>
            <button class="d-chipbtn">${ICO("git-branch", 12)}<span class="d-ctx-name">fork/v5-boards</span>${ICO("chevron-down", 11)}</button>`;
}

/** 工具条：与 ChatInput 的桌面顺序一字不差。
 *  `more` = 那枚 `grid-2x2`（更多动作）—— 产品里它是 `{actionPanel && narrowControls && …}`，
 *  **只在 ≤1024 的窄屏出现**；桌面画板画上它，就等于凭空多了一枚点了没反应的钮。
 *  `ringOpen` = 该板上下文环浮层的名字（ctx-pop / m-ctx …）。 */
function barRow({ streaming, disabled, queued, ring = true, sound = true, ringOpen, more = false }) {
  const send = streaming
    ? `<button class="d-send stop" title="停止这一轮">${ICO("square", 14)}</button>`
    : `<button class="d-send"${disabled ? " disabled" : ""} title="发送">${ICO("arrow-up", 16)}</button>`;
  const ringTag = ringOpen
    ? `<span class="d-ring" data-demo-open="${ringOpen}" style="--p:18"></span>`
    : `<span class="d-ring" style="--p:18"></span>`;
  const moreTag = more
    ? `
                <button class="d-iconbtn" title="更多动作">${ICO("grid-2x2", 15)}</button>`
    : "";
  return `              <div class="d-composer-bar">
                <button class="d-iconbtn" title="添加附件">${ICO("plus", 16)}</button>${moreTag}
                <button class="d-select" title="模型">${ICO("cpu", 13)}claude-opus-4-6${ICO("chevron-down", 12)}</button>
                <button class="d-select" title="思考强度">${ICO("brain", 13)}思考强度：中${ICO("chevron-down", 12)}</button>
                <button class="d-select" title="权限">${ICO("shield-check", 13)}权限：每次问${ICO("chevron-down", 12)}</button>
                <button class="d-select" title="工具与上下文">${ICO("wrench", 13)}工具与上下文：默认${ICO("chevron-down", 12)}</button>
                ${queued ? `<span class="d-chipbtn is-on" title="已排队">${ICO("clock", 12)}排队 1 条</span>` : ""}
                <span class="d-grow"></span>
                ${ring ? ringTag : ""}
                ${sound ? `<button class="d-iconbtn" title="完成提示音">${ICO("volume-2", 14)}</button>` : ""}
                ${send}
              </div>`;
}

/** 卡内顶行：草稿文字。附件芯片另有一行 .d-chips（只在原帧就有附件时保留）。 */
function topRow(draft) {
  return `              <div class="d-composer-top"><span class="${draft.placeholder ? "d-t-dim" : ""}">${draft.text}</span></div>`;
}

/* ---- 单块改写 ---- */
function rewriteWrap(wrap, file) {
  const card = findDiv(wrap, "d-composer");
  if (!card) return { wrap, note: "无 .d-composer，跳过" };

  /* 先把外层标签、卡、以及卡以外的兄弟块（弹层）分开 —— 全程用**原串的下标**，
     不做多次字符串替换（上一版就是在那一步把 wrap 复制成了两层）。 */
  const openTagEnd = wrap.indexOf(">") + 1;
  const closeTagStart = wrap.lastIndexOf("</div>");
  const ctx = findDiv(wrap, "d-ctxbar");
  const restParts = [];
  if (ctx) restParts.push([ctx.start, ctx.end]);
  restParts.push([card.start, card.end]);
  let cursor = openTagEnd;
  const before = [];
  const after = [];
  for (const [s, e] of restParts.sort((a, b) => a[0] - b[0])) {
    if (s > cursor) before.push(wrap.slice(cursor, s));
    cursor = e;
  }
  if (cursor < closeTagStart) after.push(wrap.slice(cursor, closeTagStart));
  const siblings = [...before, ...after].join("").trim();

  /* 卡：草稿 + 附件芯片 + 工具条。
     卡自身的修饰类必须留下（`d-composer d-loader` = 运行中环绕光带；丢掉它，
     整张板就只剩一根普通输入框，「正在跑」这件事在画板上不存在了）。 */
  let cardHtml = card.html;
  const cardCls = (card.html.match(/^<div class="([^"]*)"/) ?? [, "d-composer"])[1];
  const loaderBits = [];
  const glow = findDiv(cardHtml, "d-loader-glow");
  if (glow) loaderBits.push(glow.html.trim());
  const svg = cardHtml.match(/<svg class="d-loader-svg"[\s\S]*?<\/svg>/);
  if (svg) loaderBits.push(svg[0]);
  const draft = { text: "描述任务…", placeholder: true };
  const inputMatch = cardHtml.match(/<(?:input|textarea)[^>]*class="[^"]*d-input[^"]*"[^>]*>/);
  if (inputMatch) {
    const value = inputMatch[0].match(/value="([^"]*)"/);
    const placeholder = inputMatch[0].match(/placeholder="([^"]*)"/);
    if (value && value[1]) { draft.text = value[1]; draft.placeholder = false; }
    else if (placeholder && placeholder[1]) draft.text = placeholder[1];
  } else {
    const top = findDiv(cardHtml, "d-composer-top");
    if (top) {
      const txt = innerOf(top.html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      if (txt) { draft.text = txt; draft.placeholder = false; }
    }
  }

  const streaming = /d-send stop|>停止<|title="停止/.test(wrap);
  const queued = /排队|队列中/.test(wrap);
  const disabled = /d-send[^>]*disabled/.test(wrap) && !streaming;
  /* 上下文环的浮层名字跟着板走：板上原来哪个 data-demo-open 指向了存在的浮层，
     就把它挂回环上（不凭空造触发属性 —— 那是 check-v5 的硬错）。 */
  const ringOpen = (wrap.match(/data-demo-open="([^"]+)"/g) ?? [])
    .map((s) => s.match(/"([^"]+)"/)[1])
    .find((name) => wrap.includes(`data-demo-pop="${name}"`));

  let project = "~/Desktop/PI NEXT";
  /* 旧版把「卡内第一枚引用芯片」当项目名，于是某帧的 ctxbar 变成
     `user-ui.css:642` —— 那是文件引用，不是工作区。项目芯片只收**看起来像路径或
     项目名**的那一枚；带扩展名 / 行号的一律当引用，不搬到卡外。 */
  const cite = wrap.match(/<span class="d-cite[^"]*"[^>]*>[\s\S]*?<\/span>/g) ?? [];
  const looksLikeFile = /\.[a-z0-9]{2,5}\b|:\d+/i;
  const firstCite = cite.map((s) => s.replace(/<[^>]*>/g, "").trim()).find((t) => t && !looksLikeFile.test(t));
  if (firstCite && firstCite !== "PI NEXT") project = firstCite;
  if (/选择工作区/.test(wrap)) project = null;

  /* 附件芯片：卡内原 .d-chips 里除了「模型/思考/权限/工具」四枚以外的全部内容 */
  let attachmentChips = "";
  const chips = findDiv(cardHtml, "d-chips");
  if (chips) {
    attachmentChips = innerOf(chips.html)
      .replace(/<button class="d-chipbtn"[^>]*>(?:(?!<\/button>)[\s\S])*?<\/button>/g, (btn) =>
        /data-ico="(cpu|brain|shield|shield-check|wrench|book-marked)"/.test(btn) || />\s*(模型|思考|权限|工具)/.test(btn) ? "" : btn)
      .trim();
  }

  const chipsRow = attachmentChips
    ? `              <div class="d-chips">\n                ${attachmentChips}\n              </div>\n`
    : "";

  const cardOut = `          <div class="${cardCls}">\n` +
    (loaderBits.length ? loaderBits.map((b) => `            ${b}`).join("\n") + "\n" : "") +
    `${topRow(draft)}\n${chipsRow}${barRow({ streaming, disabled, queued, ringOpen })}\n          </div>`;
  const out = `${wrap.slice(0, openTagEnd)}\n          <div class="d-ctxbar">\n${ctxbarChips(project)}\n          </div>\n${cardOut}\n` +
    (siblings ? `          ${siblings}\n` : "") + `        </div>`;

  return { wrap: out, note: [streaming && "停止", queued && "排队", disabled && "禁用", !project && "未选工作区"].filter(Boolean).join("/") || "空闲" };
}

/* ---- PWA：手机输入卡——四个能力芯片收成**一枚 icon**，点开是自下而上的浮层 ----
 * 用户 2026-10-04 裁定：模型 / 思考强度 / 权限 / 工具与上下文 不再在输入卡里平铺四枚
 * chip（手机上那行本来就挤，四项平铺会把输入框顶成两行），改成一枚「能力」钮 +
 * 一张底部浮层（`.m-sheet`）逐项设置 —— 浮层从下往上，拇指不用离开卡片。
 */
function rewriteMobile(wrap, openSheet = false) {
  const card = findDiv(wrap, "m-composer");
  if (!card) return { wrap, note: "无 .m-composer，跳过" };
  const streaming = /m-send stop|data-ico="square"/.test(wrap);
  const draftMatch = wrap.match(/placeholder="([^"]+)"/);
  const draft = draftMatch ? draftMatch[1] : "描述任务…";
  const bar = `      <div class="m-composer-row">
        <button class="m-composer-plus">${ICO("plus", 19)}</button>
        <input class="m-input" placeholder="${draft}">
        <button class="m-cap-btn" data-demo-open="cap-sheet" title="能力 · 模型 / 思考强度 / 权限 / 工具与上下文" aria-label="能力设置">${ICO("sliders-horizontal", 17)}</button>
        <button class="m-iconbtn" title="完成提示音">${ICO("volume-2", 17)}</button>
        <button class="m-send${streaming ? " stop" : ""}" title="${streaming ? "停止这一轮" : "发送"}">${ICO(streaming ? "square" : "arrow-up", streaming ? 16 : 18)}</button>
      </div>`;
  const sheet = `
    <div class="m-sheet${openSheet ? " is-open" : ""}" data-demo-pop="cap-sheet" id="cap-sheet">
      <div class="m-sheet-grab"></div>
      <div class="m-sheet-title">能力</div>
      <div class="m-sheet-body">
        <div class="m-group-title">这一轮怎么跑</div>
        <button class="m-sheet-row">${ICO("cpu", 16)}<span class="m-setrow-body"><span class="m-setrow-t">模型</span><span class="m-setrow-s">claude-opus-4-6 · 200k 上下文</span></span>${ICO("chevron-right", 14)}</button>
        <button class="m-sheet-row">${ICO("brain", 16)}<span class="m-setrow-body"><span class="m-setrow-t">思考强度</span><span class="m-setrow-s">中 · 4,096 token 预算</span></span>${ICO("chevron-right", 14)}</button>
        <button class="m-sheet-row">${ICO("shield-check", 16)}<span class="m-setrow-body"><span class="m-setrow-t">权限</span><span class="m-setrow-s">需审批 · 非只读调用先弹审批卡</span></span>${ICO("chevron-right", 14)}</button>
        <button class="m-sheet-row">${ICO("wrench", 16)}<span class="m-setrow-body"><span class="m-setrow-t">工具与上下文</span><span class="m-setrow-s">默认集 · 已引用 2 个文件</span></span>${ICO("chevron-right", 14)}</button>
        <button class="m-sheet-row"><span class="m-ring" style="--p:18"></span><span class="m-setrow-body"><span class="m-setrow-t">上下文占用</span><span class="m-setrow-s">18.4k / 200k · 缓存命中 71%</span></span>${ICO("chevron-right", 14)}</button>
        <div class="m-sheet-foot">四项都只影响**这一轮**：会话级的默认值在设置里，这里改完不写盘。</div>
      </div>
    </div>`;
  const out = card.html.slice(0, card.html.indexOf(">") + 1) + "\n" + bar + "\n    " + card.html.slice(card.html.lastIndexOf("</div>"));
  /* 浮窗**单独返回**，由主循环放在 wrap 之后：.m-sheet 是 absolute + max-height:78%，
     留在容器里就按容器高度算，四项设置会被压成一条（实测 95px）。 */
  return { wrap: wrap.slice(0, card.start) + out + wrap.slice(card.end), sheet, note: streaming ? "停止" : "空闲" };
}

/* ---- 补一道：不在 .d-composer-wrap 里的孤卡 ----
 * 拖放落区（D-26b）把 `.d-composer` 直接摆在 section 里当落点，于是它没被上面那轮conver；
 * 同一张板里就会出现两种工具条。这里只把**工具条那一行**换成规范件，其余（虚线边框、
 * 拖入提示芯片）都是帧自己的内容，不动。
 */
function normalizeStrayCards(html) {
  // 必须按**类名 token** 取卡片：`/<div class="d-composer[^"]*"/` 会把
  // `d-composer-top` / `d-composer-bar` 也当成卡片（它们是卡片的子件）。
  const re = new RegExp('class="([^"]*)"', "g");
  let m;
  let n = 0;
  while ((m = re.exec(html))) {
    if (!m[1].split(/\s+/).includes("d-composer")) continue;
    const card = elemAt(html, html.lastIndexOf("<", m.index));
    if (!card) break;
    const bar = findEl(card.html, "d-composer-bar");
    if (!bar) continue;
    const hasSelects = bar.html.includes("d-select");
    const hasMore = bar.html.includes("grid-2x2");
    // 已经是对的（有规范件、也没有 ⊞）就跳过；否则：有规范件时只摘掉 ⊞，
    // 没有时整行换成规范件。
    /* 「已规范」不只看有没有 d-select，还要看**文案是不是新四项** ——
       旧文案（思考：中 / 工具：默认）留着 d-select，只判 select 就会漏掉它们。 */
    const canonical = bar.html.includes("思考强度") && bar.html.includes("工具与上下文");
    if (hasSelects && !hasMore && canonical) continue;
    /* 有 d-select 但**文案是旧的**时不能只摘 ⊞ —— 那种情况下整行要换成规范件。 */
    const newBar = (hasSelects && canonical)
      ? bar.html.replace(/\s*<button class="d-iconbtn" title="更多动作">[\s\S]*?<\/button>/, "")
      : `              <div class="d-composer-bar">
                <button class="d-iconbtn" title="添加附件">${ICO("plus", 16)}</button>
                <button class="d-select" title="模型">${ICO("cpu", 13)}claude-opus-4-6${ICO("chevron-down", 12)}</button>
                <button class="d-select" title="思考强度">${ICO("brain", 13)}思考强度：中${ICO("chevron-down", 12)}</button>
                <button class="d-select" title="权限">${ICO("shield-check", 13)}权限：每次问${ICO("chevron-down", 12)}</button>
                <button class="d-select" title="工具与上下文">${ICO("wrench", 13)}工具与上下文：默认${ICO("chevron-down", 12)}</button>
                <span class="d-grow"></span>
                <span class="d-ring" style="--p:18"></span>
                <button class="d-iconbtn" title="完成提示音">${ICO("volume-2", 14)}</button>
                <button class="d-send"${/d-send[^>]*disabled/.test(bar.html) ? " disabled" : ""} title="发送">${ICO("arrow-up", 16)}</button>
              </div>`;
    /* 运行中（有环绕光带 / 已经是停止钮）不能补成发送钮：那是两件相反的事。 */
    const running = /d-loader/.test(card.html) || /d-send stop|data-ico="square"/.test(bar.html);
    const newBar2 = running
      ? newBar.replace(/<button class="d-send[^"]*"[^>]*>(?:<i data-ico="arrow-up"[^>]*><\/i>)?<\/button>/, `<button class="d-send stop" title="停止这一轮">${ICO("square", 14)}</button>`)
      : newBar;
    const body = card.html.slice(0, bar.start) + newBar2 + card.html.slice(bar.end);
    html = html.slice(0, card.start) + body + html.slice(card.end);
    n++;
    re.lastIndex = card.start + body.length;
  }
  return { html, n };
}


/* ---- PWA 按**卡片**重写（不只处理容器内的）------------------------------------
 * 原来只扫 `.m-composer-wrap`，于是板里手写的独立卡片（M-03 有 5 张、M-01/M-10 各 1 张）
 * 一直停在旧形态（卡面带上下文环 + 能力行带文字），看着像「没统一」。
 */
function rewriteMobileCards(html, openFirst) {
  const cards = [];
  const re = new RegExp('class="([^"]*)"', "g");
  let m;
  while ((m = re.exec(html))) {
    if (!m[1].split(/\s+/).includes("m-composer")) continue;
    const el = elemAt(html, html.lastIndexOf("<", m.index));
    if (el) cards.push(el);
  }
  let n = 0;
  for (const card of cards.reverse()) {
    const draft = (card.html.match(/placeholder="([^"]+)"/) ?? [, "描述任务…"])[1];
    const running = /m-send stop|data-ico="square"/.test(card.html);
    const inner = `\n      <div class="m-composer-row">
        <button class="m-composer-plus">${ICO("plus", 19)}</button>
        <input class="m-input" placeholder="${draft}">
        <button class="m-cap-btn" data-demo-open="cap-sheet" title="能力 · 模型 / 思考强度 / 权限 / 工具与上下文" aria-label="能力设置">${ICO("sliders-horizontal", 17)}</button>
        <button class="m-iconbtn" title="完成提示音">${ICO("volume-2", 17)}</button>
        <button class="m-send${running ? " stop" : ""}" title="${running ? "停止这一轮" : "发送"}">${ICO(running ? "square" : "arrow-up", running ? 16 : 18)}</button>
      </div>
    `;
    const head = card.html.indexOf(">") + 1;
    const tail = card.html.lastIndexOf("</div>");
    const body = card.html.slice(0, head) + inner + card.html.slice(tail);
    html = html.slice(0, card.start) + body + html.slice(card.end);
    n++;
  }
  void openFirst;
  return { html, n };
}

/** 清掉所有能力浮层（它们在卡片/容器之外，容器内的清理看不见）。 */
function stripCapSheets(html) {
  for (;;) {
    const sheets = [];
    const re = new RegExp('class="([^"]*)"', "g");
    let m;
    while ((m = re.exec(html))) {
      if (!m[1].split(/\s+/).includes("m-sheet")) continue;
      const el = elemAt(html, html.lastIndexOf("<", m.index));
      if (el && /data-demo-pop="cap-sheet"/.test(el.html)) sheets.push(el);
    }
    if (!sheets.length) return html;
    const el = sheets[0];
    let start = el.start;
    while (start > 0 && (html[start - 1] === " " || html[start - 1] === "\t")) start--;
    if (start > 0 && html[start - 1] === "\n") start--;
    html = html.slice(0, start) + html.slice(el.end);
  }
}

/** 每张板只留**一份**能力浮层：挂在第一张卡片所在容器（或卡片本身）之后。 */
function attachCapSheet(html, label) {
  const sheet = `
    <div class="m-sheet is-open" data-demo-pop="cap-sheet" id="cap-sheet">
      <div class="m-sheet-grab"></div>
      <div class="m-sheet-title">能力</div>
      <div class="m-sheet-body">
        <div class="m-group-title">这一轮怎么跑</div>
        <button class="m-sheet-row">${ICO("cpu", 16)}<span class="m-setrow-body"><span class="m-setrow-t">模型</span><span class="m-setrow-s">claude-opus-4-6 · 200k 上下文</span></span>${ICO("chevron-right", 14)}</button>
        <button class="m-sheet-row">${ICO("brain", 16)}<span class="m-setrow-body"><span class="m-setrow-t">思考强度</span><span class="m-setrow-s">中 · 4,096 token 预算</span></span>${ICO("chevron-right", 14)}</button>
        <button class="m-sheet-row">${ICO("shield-check", 16)}<span class="m-setrow-body"><span class="m-setrow-t">权限</span><span class="m-setrow-s">需审批 · 非只读调用先弹审批卡</span></span>${ICO("chevron-right", 14)}</button>
        <button class="m-sheet-row">${ICO("wrench", 16)}<span class="m-setrow-body"><span class="m-setrow-t">工具与上下文</span><span class="m-setrow-s">默认集 · 已引用 2 个文件</span></span>${ICO("chevron-right", 14)}</button>
        <button class="m-sheet-row"><span class="m-ring" style="--p:18"></span><span class="m-setrow-body"><span class="m-setrow-t">上下文占用</span><span class="m-setrow-s">18.4k / 200k · 缓存命中 71%</span></span>${ICO("chevron-right", 14)}</button>
        <div class="m-sheet-foot">五项都只影响**这一轮**：会话级的默认值在设置里，这里改完不写盘。</div>
      </div>
    </div>`;
  // 挂在第一张卡片所在容器之后（容器外，浮层才不会被 max-height 压扁）
  const card = findAll(html, "m-composer")[0];
  if (!card) return html;
  const wrap = findAll(html, "m-composer-wrap").find((w) => w.start < card.start && w.end >= card.end);
  const at = wrap ? wrap.end : card.end;
  let indent = " ".repeat(html.slice(0, at).split("\n").pop().search(/\S/) + 1);
  void label;
  return html.slice(0, at) + sheet.replace(/^\n {4}/g, "\n" + indent) + html.slice(at);
}

/* ---- 主循环 ---- */
const report = [];
let changed = 0;
for (const dir of ["web/boards", "pwa/boards"]) {
  for (const f of readdirSync(join(ROOT, dir)).filter((n) => n.endsWith(".html")).sort()) {
    const path = join(ROOT, dir, f);
    let html = readFileSync(path, "utf8");
    /* 整文件先清掉所有能力浮窗（它们挂在输入卡容器**之外**，容器内的清理看不见它们，
       不清就会每跑一次多一份）。 */
    for (;;) {
      const sheets = [];
      const sre = new RegExp('class="([^"]*)"', "g");
      let sm;
      while ((sm = sre.exec(html))) {
        if (!sm[1].split(/\s+/).includes("m-sheet")) continue;
        const el = elemAt(html, html.lastIndexOf("<", sm.index));
        if (el && /data-demo-pop="cap-sheet"/.test(el.html)) sheets.push(el);
      }
      if (!sheets.length) break;
      const el = sheets[0];
      let start = el.start;
      while (start > 0 && (html[start - 1] === " " || html[start - 1] === "\t")) start--;
      if (start > 0 && html[start - 1] === "\n") start--;
      html = html.slice(0, start) + html.slice(el.end);
    }
    if (!dir.startsWith("web")) {
      /* PWA：先清浮层 → 按卡片重写 → 只补回一份浮层 */
      html = stripCapSheets(html);
      const { html: rewritten, n: cardCount } = rewriteMobileCards(html, false);
      html = rewritten;
      if (cardCount > 0) html = attachCapSheet(html, f);
      if (cardCount) {
        report.push(`  ${dir}/${f}: ${cardCount} 个输入卡`);
        changed += cardCount;
        if (APPLY) writeFileSync(path, html);
      }
      continue;
    }
    const marker = '<div class="d-composer-wrap">';
    let i = 0;
    let count = 0;
    while (true) {
      i = html.indexOf(marker, i);
      if (i < 0) break;
      const start = dir.startsWith("web") ? i : html.lastIndexOf("<div", i);
      const blk = elemAt(html, start);
      if (!blk) break;
      const r = dir.startsWith("web") ? rewriteWrap(blk.html, f) : rewriteMobile(blk.html, count === 0);
      html = html.slice(0, blk.start) + r.wrap + (r.sheet ?? "") + html.slice(blk.end);
      i = blk.start + r.wrap.length;
      count++;
      if (r.note !== "无 .d-composer，跳过" && r.note !== "无 .m-composer，跳过") changed++;
    }
    if (count) {
      report.push(`  ${dir}/${f}: ${count} 个输入卡`);
    }
    // 孤卡（不在 .d-composer-wrap 里，例如拖放落区的虚线卡）**总是**补一道：
    // 之前只在「本文件没有任何 wrap」时才跑，于是同一张板里只要有一处 wrap，
    // 孤卡就漏掉，两种工具条并存。
    const { html: fixed, n } = normalizeStrayCards(html);
    if (n) {
      report.push(`  ${dir}/${f}: ${n} 个孤立输入卡补工具条`);
      changed += n;
      html = fixed;
    }
    if (count || n) {
      if (APPLY) writeFileSync(path, html);
    }
  }
}
console.log(report.join("\n"));
console.log(`共 ${changed} 个输入卡${APPLY ? "（已写入）" : "（dry-run）"}`);
