import { chromium } from "playwright";
const id = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto("http://127.0.0.1:30141/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.goto(`http://127.0.0.1:30141/?session=${id}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);

const shot = async (name, sel) => {
  const el = page.locator(sel).first();
  if ((await el.count()) === 0) { console.log("missing", name, sel); return; }
  await el.screenshot({ path: `.shots/cmp-${name}.png` }).catch((e) => console.log("shot fail", name, e.message.slice(0, 60)));
  const b = await el.boundingBox();
  console.log(name, b ? `${Math.round(b.width)}x${Math.round(b.height)}` : "?");
};
await shot("side", ".app-sidebar");
await shot("chrome", ".app-topbar-row");
await shot("turn", ".turn");
await shot("grphead", ".grp-head");
await shot("steps", ".steps");
await shot("composer-area", ".composer-area");
await browser.close();
