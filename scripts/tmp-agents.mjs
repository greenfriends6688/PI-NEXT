// 量「内置」组那条设置行：标签列宽 / 控件列宽 / 输入框实际宽度（min-width 是否压过内联 width）。
import { launchChrome } from "./launch-chrome.mjs";

const browser = await launchChrome();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto("http://127.0.0.1:30141", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.evaluate(() => document.querySelector("button.pw-side-foot")?.click());
await page.waitForTimeout(1500);
const sec = await page.evaluate(() => {
  const row = document.querySelector("button.pw-row[data-section=agents]") ?? [...document.querySelectorAll("button.pw-row")].find((b) => /代理|agent/i.test(b.textContent ?? ""));
  row?.click();
  return row?.textContent?.trim().slice(0, 12) ?? null;
});
console.log("section:", sec);
await page.waitForTimeout(1800);

const report = await page.evaluate(() => {
  const field = [...document.querySelectorAll(".pw-field")].find((f) => /内置子代理/.test(f.textContent ?? ""));
  if (!field) return { found: false, fields: [...document.querySelectorAll(".pw-field")].slice(0, 5).map((f) => f.textContent?.trim().slice(0, 20)) };
  const label = field.querySelector(".pw-label");
  const ctl = field.querySelector(".pw-ctl");
  const input = field.querySelector("input.pw-input");
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { x: Math.round(b.x), w: Math.round(b.width), h: Math.round(b.height), minWidth: cs.minWidth, width: cs.width, flex: cs.flex, whiteSpace: cs.whiteSpace }; };
  return {
    found: true,
    field: r(field),
    fieldDisplay: getComputedStyle(field).display,
    label: r(label),
    labelText: label?.textContent?.trim().slice(0, 40),
    ctl: r(ctl),
    input: r(input),
    listCol: r(field.closest(".pw-slist, .pw-list, [class*=slist]")),
  };
});
console.log(JSON.stringify(report, null, 2));
const el = await page.$(".pw-scontent .pw-slist, .pw-slist");
await (el ?? page).screenshot?.({ path: "/tmp/agents-row.png" }).catch(() => {});
await page.screenshot({ path: "/tmp/agents-row.png" });
await browser.close();
