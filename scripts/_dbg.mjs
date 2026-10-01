import { chromium, devices } from "playwright";
const b = await chromium.launch({ channel: "chrome" });
const c = await b.newContext({ viewport:{width:768,height:1024}, isMobile:true, hasTouch:true, userAgent: devices["iPad Mini"].userAgent });
const p = await c.newPage();
await p.goto("http://127.0.0.1:30141/", { waitUntil:"domcontentloaded" });
await p.waitForSelector('[class*="shell"]');
await p.waitForTimeout(1500);
await p.locator('button[aria-label="settings"], .desktop-sidebar-toggle ~ * button[aria-label="设置"], [aria-label="设置"]').first().click().catch(()=>{});
await p.waitForTimeout(1200);
if (!(await p.locator(".settings-dialog-surface").isVisible().catch(()=>false))) {
  // 平板上没有汉堡，走齿轮
  await p.locator('.pw-iconbtn[aria-label="设置"]').first().click().catch(()=>{});
  await p.waitForTimeout(1200);
}
console.log(JSON.stringify(await p.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll(".settings-dialog-surface .pw-ctl, .settings-dialog-surface .pw-radio, .settings-dialog-surface .pw-btn.sm")) {
    const r = el.getBoundingClientRect();
    const pr = el.parentElement.getBoundingClientRect();
    const pcs = getComputedStyle(el.parentElement);
    if (r.right > document.documentElement.clientWidth + 2) {
      const chain = []; let n = el.parentElement;
      while (n && chain.length < 5) { const rr = n.getBoundingClientRect(); chain.push(n.tagName.toLowerCase()+"."+n.className.toString().trim().split(/\s+/).slice(0,2).join(".")+" w="+Math.round(rr.width)); n = n.parentElement; }
      out.push({ el: el.className.toString().slice(0,30), chain, right: Math.round(r.right), w: Math.round(r.width),
                 parentCls: el.parentElement.className.toString().slice(0,40), parentW: Math.round(pr.width),
                 parentDisplay: pcs.display, parentCols: pcs.gridTemplateColumns, parentFlexWrap: pcs.flexWrap,
                 parentJustify: pcs.justifyContent });
    }
  }
  const g2 = [...document.querySelectorAll(".settings-dialog-surface .pw-grid2")].map(e => getComputedStyle(e).gridTemplateColumns);
  return { clipped: out.slice(0,8), grid2: g2.slice(0,6) };
}), null, 1));
await p.screenshot({ path: "/tmp/pwa-audit/768/settings-debug.png" });
await b.close();
