// 设置板 → 弹窗宿主（第二版：**按帧切片**处理）。
//
// 上一版在整个文件上做偏移替换，帧边界判断一错就把顶栏内容拼进弹窗里（D-08/D-19/D-20
// 因此全坏）。这一版把文件先按 `<section class="d-scene">` 切成帧，每帧单独处理，
// 帧内下标互不影响 —— 结构上不可能串帧。
//
// 用法：node design/v5/scripts/settings-to-modal.mjs [--apply]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");
const BOARDS = {
  "D-08-settings-models.html": "模型与供应商",
  "D-19-settings-usage.html": "用量",
  "D-20-settings-phone-push.html": "手机与推送",
  "D-21-settings-archive-import.html": "归档与导入",
};

function elemAt(html, start) {
  const m = /<([a-z][a-z0-9-]*)\b[^>]*>/.exec(html.slice(start, start + 400));
  if (!m) return null;
  const re = new RegExp(`<(\\/?)${m[1]}\\b[^>]*>`, "g");
  re.lastIndex = start;
  let depth = 0;
  let g;
  while ((g = re.exec(html))) {
    depth += g[1] ? -1 : 1;
    if (depth === 0) return { start, end: re.lastIndex, html: html.slice(start, re.lastIndex) };
  }
  return null;
}
function findEl(html, cls) {
  const re = new RegExp('class="([^"]*)"', "g");
  let m;
  while ((m = re.exec(html))) {
    if (!m[1].split(/\s+/).includes(cls)) continue;
    return elemAt(html, html.lastIndexOf("<", m.index));
  }
  return null;
}
const indentOf = (html, at) => " ".repeat(html.slice(0, at).split("\n").pop().search(/\S/) + 1);

const SESSION_BAR = (ind) => `${ind}<header class="d-topbar">
${ind}  <div class="d-tb-stack">
${ind}    <span class="d-tb-title">定住令牌与类名</span>
${ind}    <span class="d-tb-sub">~/Desktop/PI NEXT · fork/v5-boards</span>
${ind}  </div>
${ind}  <div class="d-tb-spacer"></div>
${ind}  <button class="d-btn sm ghost"><i data-ico="git-branch" data-size="14"></i>fork/v5-boards<i data-ico="chevron-down" data-size="11"></i></button>
${ind}</header>`;

const CHAT = (ind, label) => `${ind}<div class="d-chat">
${ind}  <div class="d-chat-inner">
${ind}    <div class="d-msg-ai">
${ind}      <div class="d-msg-ai-head">
${ind}        <div class="d-ava brand"><img src="../../assets/brand/logo.png" alt=""></div>
${ind}        <span class="d-t-sm d-t-b">PI NEXT</span>
${ind}        <span class="d-badge mute">${label}</span>
${ind}      </div>
${ind}      <div class="d-md"><p>设置是<b>弹窗</b>：背后的会话不动，关掉就回到原地。整页宿主已废止。</p></div>
${ind}    </div>
${ind}  </div>
${ind}</div>`;

/** 处理一帧：顶栏换会话顶栏 → 背后补会话 → d-set 包进弹窗 */
function convertFrame(frameHtml, label) {
  const set = findEl(frameHtml, "d-set");
  if (!set) return { html: frameHtml, changed: false };
  if (frameHtml.slice(Math.max(0, set.start - 800), set.start).includes("d-modal is-open")) return { html: frameHtml, changed: false };

  let out = frameHtml;
  const ind = indentOf(out, set.start);

  /* ① 顶栏：只动 d-set 之前、同一帧里的那一个 */
  const bar = findEl(out, "d-topbar");
  let headActions = "";
  if (bar && bar.start < set.start) {
    const badge = bar.html.match(/<span class="d-badge[^"]*">[\s\S]*?<\/span>/);
    const primary = bar.html.match(/<button class="d-btn sm primary">[\s\S]*?<\/button>/);
    headActions = [badge?.[0], primary?.[0]].filter(Boolean).join("\n" + ind + "      ");
    out = out.slice(0, bar.start) + SESSION_BAR(ind).trimEnd() + out.slice(bar.end);
  }

  /* ② 背后补会话 */
  if (!out.includes("d-chat-inner")) {
    const main = findEl(out, "d-main");
    if (main) {
      const at = out.indexOf("\n", out.indexOf(">", main.start)) + 1;
      out = out.slice(0, at) + CHAT(ind + "  ", label) + "\n" + out.slice(at);
    }
  }

  /* ③ 包弹窗（重新取下标：上面两步已改长度） */
  const set2 = findEl(out, "d-set");
  const inner = set2.html.slice(set2.html.indexOf(">") + 1, set2.html.lastIndexOf("</div>"));
  const wrapped = `${ind}<div class="d-modal is-open" style="position:absolute;inset:0" aria-label="设置 · ${label}">
${ind}  <div class="d-modal-box wide" style="width:78%">
${ind}    <div class="d-modal-head">
${ind}      <span class="d-grow">设置 · ${label}</span>
${headActions ? "\n" + ind + "      " + headActions + "\n" + ind + "    " : ""}</div>
${ind}    <div class="d-modal-body">
${ind}      <div class="d-set">${inner}</div>
${ind}    </div>
${ind}  </div>
${ind}</div>`;
  out = out.slice(0, set2.start) + wrapped + out.slice(set2.end);
  return { html: out, changed: true };
}

const report = [];
for (const [file, label] of Object.entries(BOARDS)) {
  const path = join(ROOT, "web/boards", file);
  const html = readFileSync(path, "utf8");
  // 按帧切片：保留分隔符
  const parts = html.split(/(?=<section class="d-scene">)/);
  let n = 0;
  const out = parts.map((part) => {
    if (!part.startsWith('<section class="d-scene">')) return part;
    const r = convertFrame(part, label);
    if (r.changed) n++;
    return r.html;
  }).join("");
  if (n) {
    report.push(`  ${file}: ${n} 帧 → 弹窗宿主`);
    if (APPLY) writeFileSync(path, out);
  }
}
console.log(report.join("\n") || "（无改动）");
console.log(`共 ${report.length} 张板${APPLY ? "（已写入）" : "（dry-run）"}`);
