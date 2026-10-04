// 统一 V5 画板里的**左栏骨架**（侧栏头 / 新建任务 / 项目·聊天分段）。
//
// 为什么：22 个侧栏实例里有 14 种不同的头行 —— 有的只剩一个 wordmark、有的多出
// 两枚来路不明的图标（message-square / smartphone / layout-template）、有的完全没有
// 「新建任务」行与分段落，于是同一个侧栏在不同帧里读起来像两个产品。
// 产品里只有一套（components/SessionSidebar.tsx）：
//
//   .d-side-head  品牌（logo + 字标）····· 搜索 · 收起
//   .d-side-nav   新建任务（square-pen + 名字 + ⌘N）
//   .d-seg        项目 / 聊天（role=tablist）
//   [.d-side-search]  仅在「搜索态」的帧渲染（产品里默认收起）
//   .d-side-scroll    列表（帧自己的内容，不动）
//   .d-side-foot      底栏（帧自己的内容，不动）
//
// 用法：node design/v5/scripts/sync-sidebar.mjs [--apply]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");
const ICO = (n, s) => `<i data-ico="${n}" data-size="${s}"></i>`;

/** 按标签配平取块。元素名从开标签里读 —— 画板里同一块样式有时写 <div>、
 *  有时写 <nav>，写死 div 会让 `d-side-nav` 这类块被重复一份（已经发生过）。 */
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
function findEl(html, className, from = 0) {
  const re = new RegExp('class="([^"]*)"', "g");
  re.lastIndex = from;
  let m;
  while ((m = re.exec(html))) {
    if (!m[1].split(/\s+/).includes(className)) continue;
    const tagStart = html.lastIndexOf("<", m.index);
    return elemAt(html, tagStart);
  }
  return null;
}

const HEAD = (rail) => `          <div class="d-side-head">
            <div class="d-logo"><img src="../../assets/brand/logo.png" alt=""></div>
            ${rail ? "" : `<img class="d-wordmark" src="../../assets/brand/wordmark.png" alt="PI NEXT">`}<span class="d-grow"></span>
            <button class="d-iconbtn" title="搜索会话">${ICO("search", 15)}</button>
            <button class="d-iconbtn" title="收起侧栏">${ICO("panel-left", 15)}</button>
          </div>`;

/* 新建任务行：产品里就是 .pw-side-nav > .pw-row（图标 + 名字 + 快捷键） */
const NAV = `          <div class="d-side-nav">
            <button class="d-row">${ICO("square-pen", 14)}<span class="d-grow">新建任务</span><span class="d-kbd">⌘N</span></button>
          </div>`;

/* 项目 / 聊天：产品是 .pw-seg role=tablist */
const SEG = (pane) => `          <div class="d-seg" role="tablist" aria-label="项目 / 聊天">
            <button role="tab" aria-selected="${pane !== "chat"}"${pane !== "chat" ? ' class="is-on"' : ""}>项目</button>
            <button role="tab" aria-selected="${pane === "chat"}"${pane === "chat" ? ' class="is-on"' : ""}>聊天</button>
          </div>`;

const report = [];
let touched = 0;
for (const dir of ["web/boards", "pwa/boards"]) {
  for (const f of readdirSync(join(ROOT, dir)).filter((n) => n.endsWith(".html")).sort()) {
    const path = join(ROOT, dir, f);
    let html = readFileSync(path, "utf8");
    let n = 0;
    let from = 0;
    while (true) {
      const re = /<aside class="d-side[^"]*">/g;
      re.lastIndex = from;
      const m = re.exec(html);
      if (!m) break;
      const aside = elemAt(html, m.index);
      if (!aside) break;
      let body = aside.html;

      /* 只处理「展开态」的侧栏：折叠导轨（d-rail）不是同一个东西，跳过 */
      const isRail = /d-rail/.test(m[0]);
      if (!isRail) {
        /* 每一步都**重新查一次下标**：上一步换完字符串长度就变了，拿旧下标切片
           会从属性中间剪一刀（上一版因此把 `<div class="d-seg" data-` 截成了两半）。 */
        const head = findEl(body, "d-side-head");
        if (head) body = body.slice(0, head.start) + HEAD(false) + body.slice(head.end);

        const chatPane = /chat-workspace|聊天工作区|新会话：聊天/.test(body);

        let nav = findEl(body, "d-side-nav");
        if (nav) body = body.slice(0, nav.start) + NAV + body.slice(nav.end);

        const head2 = findEl(body, "d-side-head");
        if (!nav && head2) body = body.slice(0, head2.end) + "\n" + NAV + body.slice(head2.end);

        let seg = findEl(body, "d-seg");
        if (seg) body = body.slice(0, seg.start) + SEG(chatPane ? "chat" : "projects") + body.slice(seg.end);
        else {
          const nav2 = findEl(body, "d-side-nav") ?? findEl(body, "d-side-head");
          const at = nav2 ? nav2.end : body.indexOf(">") + 1;
          body = body.slice(0, at) + "\n" + SEG(chatPane ? "chat" : "projects") + body.slice(at);
        }
      }

      if (body !== aside.html) {
        html = html.slice(0, aside.start) + body + html.slice(aside.end);
        n++;
      }
      from = aside.start + body.length;
    }
    if (n) {
      report.push(`  ${dir}/${f}: ${n} 个侧栏`);
      touched += n;
      if (APPLY) writeFileSync(path, html);
    }
  }
}
console.log(report.join("\n"));
console.log(`共 ${touched} 个侧栏${APPLY ? "（已写入）" : "（dry-run）"}`);
