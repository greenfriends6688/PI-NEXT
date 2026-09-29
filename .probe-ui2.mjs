import { chromium } from "playwright";
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
await p.goto("http://127.0.0.1:30141/?session=01a0e6e6-6ef8-745c-bd85-b6a890f2d739", { waitUntil: "networkidle" });
await p.waitForTimeout(3000);
const out = {};
// 浮窗被哪些祖先裁（整条链）
out.chain = await p.evaluate(() => {
  const ring = document.querySelector(".composer-ring .pw-ring");
  ring.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
  ring.focus();
  const pop = document.querySelector(".composer-ring-pop");
  const pb = pop.getBoundingClientRect();
  const res = [];
  let el = pop.parentElement;
  while (el) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    res.push({
      cls: (el.className || el.tagName).toString().slice(0, 60),
      ox: cs.overflowX, oy: cs.overflowY,
      left: Math.round(r.left), right: Math.round(r.right),
      popOutside: pb.left < r.left - 0.5 || pb.right > r.right + 0.5,
      pos: cs.position,
    });
    el = el.parentElement;
  }
  return { popLeft: Math.round(pb.left), popRight: Math.round(pb.right), chain: res };
});
// systemBtnRef 是否已被使用
out.sysRef = await p.evaluate(() => !!document.querySelector('button[title="系统提示词"]'));
console.log(JSON.stringify(out, null, 2));
await b.close();
