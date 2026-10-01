import { chromium, devices } from "playwright";
const b = await chromium.launch({ channel: "chrome" });
for (const [W,H,mob] of [[390,844,true],[1440,900,false]]) {
  const c = await b.newContext({ viewport:{width:W,height:H}, isMobile:mob, hasTouch:mob, userAgent: mob?devices["iPhone 13"].userAgent:undefined });
  const p = await c.newPage();
  await p.goto("http://127.0.0.1:30141/", { waitUntil:"domcontentloaded" });
  await p.waitForSelector('[class*="shell"]'); await p.waitForTimeout(1800);
  const r = await p.evaluate(() => {
    const pick = (sel) => { const e=document.querySelector(sel); if(!e) return null; const b=e.getBoundingClientRect(); return [Math.round(b.x),Math.round(b.y),Math.round(b.width),Math.round(b.height)]; };
    const toolbar = document.querySelector('.chat-input-toolbar');
    return {
      shell: pick('.chat-input-shell'),
      send: pick('.pw-send'),
      toolbar: pick('.chat-input-toolbar'),
      model: pick('.model-selector .pw-select'),
      more: pick('[aria-label="更多控件"].pw-iconbtn'),
      textarea: pick('.chat-input-textarea'),
    };
  });
  console.log(W, JSON.stringify(r));
  await c.close();
}
await b.close();
