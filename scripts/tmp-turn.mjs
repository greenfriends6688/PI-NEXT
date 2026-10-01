// 核验回合结束行：耗时 / 输入输出 / 费用三格。
import { launchChrome } from "./launch-chrome.mjs";

const browser = await launchChrome();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto("http://127.0.0.1:30141", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.evaluate(() => {
  const hit = [...document.querySelectorAll(".pw-session")].find((r) => /删除会话下拉/.test(r.textContent ?? ""));
  hit?.click();
});
await page.waitForTimeout(3500);

const rows = await page.evaluate(() => {
  const ends = [...document.querySelectorAll(".pw-turn-end")];
  return {
    count: ends.length,
    last: ends.slice(-4).map((el) => ({
      text: el.textContent?.replace(/\s+/g, " ").trim(),
      titles: [...el.querySelectorAll("[title]")].map((s) => `${s.textContent?.trim()}=${s.getAttribute("title")}`),
    })),
  };
});
console.log(JSON.stringify(rows, null, 1));

// 工具卡耗时：找一条工具结果行。
const tool = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll(".pw-dim")) {
    const t = el.textContent?.trim() ?? "";
    if (/^(\d+(\.\d+)?(ms|s|m\d+s)?)$/.test(t) && el.parentElement) {
      out.push({ dur: t, row: el.parentElement.textContent?.replace(/\s+/g, " ").trim().slice(0, 80), cls: el.parentElement.className });
    }
  }
  return out.slice(0, 10);
});
console.log("durations in transcript:", JSON.stringify(tool, null, 1));

const el = await page.$(".pw-turn-end");
if (el) {
  const box = await el.boundingBox();
  await page.screenshot({ path: "/tmp/turn-end.png", clip: { x: box.x - 10, y: box.y - 10, width: Math.min(760, box.width + 20), height: box.height + 20 } });
}
await browser.close();
