import { chromium } from "playwright";
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
await p.goto("http://127.0.0.1:30141/?session=01a0e6e6-6ef8-745c-bd85-b6a890f2d739", { waitUntil: "networkidle" });
await p.waitForTimeout(3000);
const out = {};

// --- 1. proc head 按钮为什么不满宽
out.proc = await p.evaluate(() => {
  const h = document.querySelector(".pw-proc-head");
  if (!h) return null;
  const cs = getComputedStyle(h);
  const pcs = getComputedStyle(h.parentElement);
  return {
    btn: { display: cs.display, width: cs.width, boxSizing: cs.boxSizing, alignSelf: cs.alignSelf, flex: cs.flex },
    parent: { display: pcs.display, width: pcs.width },
    parentClass: h.parentElement.className,
    offsetW: h.offsetWidth, parentOffsetW: h.parentElement.offsetWidth,
    inlineStyle: h.getAttribute("style"),
  };
});

// --- 2. 上下文环浮窗：是否被 composer 裁掉左边
await p.evaluate(() => {
  const ring = document.querySelector(".composer-ring .pw-ring");
  if (ring) { ring.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true })); ring.focus(); }
});
await p.waitForTimeout(400);
out.ring = await p.evaluate(() => {
  const pop = document.querySelector(".composer-ring-pop");
  const shell = document.querySelector(".chat-input-shell.pw-composer");
  const ring = document.querySelector(".composer-ring");
  if (!pop) return { pop: null };
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { x: Math.round(b.x), right: Math.round(b.right), w: Math.round(b.width), overflowX: cs.overflowX, overflowY: cs.overflowY, visibility: cs.visibility, opacity: cs.opacity }; };
  // 找第一个被祖先裁切的祖先
  let clippedBy = null;
  let el = pop.parentElement;
  while (el && el !== document.body) {
    const cs = getComputedStyle(el);
    if (cs.overflowX === "clip" || cs.overflowX === "hidden" || cs.overflowX === "auto" || cs.overflowX === "scroll") {
      const bb = el.getBoundingClientRect();
      const pb = pop.getBoundingClientRect();
      if (pb.left < bb.left - 0.5 || pb.right > bb.right + 0.5) { clippedBy = { cls: el.className, left: Math.round(bb.left), right: Math.round(bb.right) }; break; }
    }
    el = el.parentElement;
  }
  return { pop: r(pop), shell: r(shell), ring: r(ring), clippedBy, popLeftVsShellLeft: Math.round(pop.getBoundingClientRect().left - (shell?.getBoundingClientRect().left ?? 0)) };
});

// --- 3. 系统提示词面板位置
const sysBtn = p.locator('button[title="系统提示词"]').first();
if (await sysBtn.count()) {
  await sysBtn.click();
  await p.waitForTimeout(800);
  out.system = await p.evaluate(() => {
    const sec = document.querySelector(".system-prompt-panel");
    const wrap = sec?.parentElement;
    const btn = document.querySelector('button[title="系统提示词"]');
    const r = (el) => el ? (() => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), right: Math.round(b.right), y: Math.round(b.y), w: Math.round(b.width) }; })() : null;
    return { panel: r(sec), wrapper: r(wrap), btn: r(btn), wrapStyle: wrap?.getAttribute("style"), secWidth: sec ? getComputedStyle(sec).width : null };
  });
}
console.log(JSON.stringify(out, null, 2));
await b.close();
