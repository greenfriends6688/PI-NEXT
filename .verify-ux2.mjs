import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const OUT = "/tmp/pi-verify2";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto("http://127.0.0.1:30141", { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
const report = {};

// 切到「项目」pane 并展开 pi-codex
await page.evaluate(() => {
  const tabs = [...document.querySelectorAll(".pw-seg button")];
  tabs.find((b) => b.textContent.trim() === "项目")?.click();
});
await page.waitForTimeout(800);
await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".pw-side-scroll .pw-row")];
  const target = rows.find((r) => r.textContent.includes("pi-codex"));
  const toggle = target?.querySelector('button[aria-label]');
  toggle?.click();
});
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/sidebar-expanded.png` });

report.scroll = await page.evaluate(() => {
  const wrap = document.querySelector(".pw-side-scroll");
  const list = wrap?.firstElementChild;
  if (!list) return "no list";
  const before = list.scrollTop;
  list.scrollTop = 600;
  const after = list.scrollTop;
  list.scrollTop = before;
  return {
    wrapDisplay: getComputedStyle(wrap).display,
    listOverflowY: getComputedStyle(list).overflowY,
    scrollHeight: list.scrollHeight,
    clientHeight: list.clientHeight,
    scrollable: list.scrollHeight > list.clientHeight,
    movedTo: after,
    groupTitles: [...document.querySelectorAll(".pw-side-scroll .pw-group-title")].map((e) => e.textContent.trim()),
  };
});

// 顶栏（项目会话）
report.topbar = await page.evaluate(() => {
  const bar = document.querySelector(".pw-topbar");
  return {
    chips: [...bar.querySelectorAll("button.pw-chipbtn, span.pw-chipbtn")].map((el) => ({ tag: el.tagName, text: el.textContent.trim() })),
    title: bar.querySelector(".pw-tb-title")?.textContent.trim(),
  };
});

const branchBtn = page.locator(".pw-topbar button.pw-chipbtn").first();
if (await branchBtn.count()) {
  await branchBtn.click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/branch-pop.png` });
  report.branchPopover = await page.evaluate(() => [...document.querySelectorAll(".pw-pop")].filter((el) => el.textContent.trim()).map((el) => el.innerText.replace(/\n/g, " / ").slice(0, 200)));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
} else {
  report.branchPopover = "no branch chip";
}

// 找一个「含失败」的过程卡
report.failedProc = await page.evaluate(() => {
  const heads = [...document.querySelectorAll(".pw-proc-head")];
  const withFail = heads.find((h) => /次失败/.test(h.innerText));
  if (!withFail) return { found: false, heads: heads.slice(0, 6).map((h) => h.innerText.replace(/\n/g, " | ").slice(0, 90)) };
  const failedSpan = [...withFail.querySelectorAll("span")].find((el) => el.style.color && el.style.color.includes("error"));
  return {
    found: true,
    badge: withFail.querySelector(".pw-badge")?.className,
    badgeText: withFail.querySelector(".pw-badge")?.innerText.trim(),
    failedText: failedSpan?.textContent,
    failedColor: failedSpan ? getComputedStyle(failedSpan).color : null,
    text: withFail.innerText.replace(/\n/g, " | ").slice(0, 150),
  };
});

// 会话列表里点开第一个 pi-codex 会话
const session = page.locator(".pw-side-scroll .pw-session").first();
if (await session.count()) {
  await session.click();
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${OUT}/project-session.png` });
  report.afterSelect = await page.evaluate(() => {
    const bar = document.querySelector(".pw-topbar");
    return {
      title: bar.querySelector(".pw-tb-title")?.textContent.trim(),
      chips: [...bar.querySelectorAll("button.pw-chipbtn, span.pw-chipbtn")].map((el) => ({ tag: el.tagName, text: el.textContent.trim() })),
    };
  });
  const branch2 = page.locator(".pw-topbar button.pw-chipbtn").first();
  if (await branch2.count()) {
    await branch2.click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/branch-pop2.png` });
    report.branchPopover2 = await page.evaluate(() => [...document.querySelectorAll(".pw-pop")].filter((el) => el.textContent.trim()).map((el) => el.innerText.replace(/\n/g, " / ").slice(0, 200)));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }
}

// 过程卡（真实会话）
report.proc = await page.evaluate(() => {
  const heads = [...document.querySelectorAll(".pw-proc-head")];
  return heads.slice(0, 5).map((h) => ({
    tag: h.tagName,
    aria: h.getAttribute("aria-expanded"),
    badge: h.querySelector(".pw-badge")?.className + ":" + (h.querySelector(".pw-badge")?.innerText.trim() ?? ""),
    trailing: h.lastElementChild?.textContent?.trim(),
    text: h.innerText.replace(/\n/g, " | ").slice(0, 110),
  }));
});
// 点头行中部展开
const toggled = await page.evaluate(() => {
  const h = document.querySelector(".pw-proc-head");
  if (!h) return null;
  const r = h.getBoundingClientRect();
  return { x: r.x + r.width * 0.6, y: r.y + r.height / 2, before: h.getAttribute("aria-expanded") };
});
if (toggled) {
  await page.mouse.click(toggled.x, toggled.y);
  await page.waitForTimeout(700);
  report.headClickToggles = await page.evaluate(() => document.querySelector(".pw-proc-head")?.getAttribute("aria-expanded"));
  await page.screenshot({ path: `${OUT}/proc-open.png` });
}

console.log(JSON.stringify(report, null, 1));
await browser.close();
