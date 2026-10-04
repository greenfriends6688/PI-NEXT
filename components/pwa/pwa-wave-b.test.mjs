// fork:v5-landing Wave B —— PWA 形态（`m-*`）这一波的源码守卫。
//
// 它锁的是三条最容易在并行迁移里破掉的约束：
//   1. **不许新造 `m-*` 类**：组件里出现的每一个 `m-*` 类名都必须真的定义在
//      `design/v5/pwa/system.css` 里（缺件只能进汇报，不能进产品）。
//   2. **窄屏分支与桌面分支不许串味**：`className` 字面量里的 `m-*` 必须在
//      `useIsMobile()` 的守卫之后，`d-*` 必须在守卫之后（即窄屏那一段整体排在
//      桌面那一段前面），两边各自只带自己那一套。
//   3. **QrCanvas 的 vendor 画法一字不改**：它是登记过的第三方实现，
//      换皮只允许动它外面那层容器。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../../", import.meta.url);

/** 这一波名下的文件（按 prompt 的文件清单）。 */
const TOUCHED = [
  "components/fork/McpConfig.tsx",
  "components/fork/McpCatalog.tsx",
  "components/fork/McpPastePanel.tsx",
  "components/fork/McpCodemodeSettings.tsx",
  "components/fork/McpLogModal.tsx",
  "components/fork/AutomationPanel.tsx",
  "components/fork/AutomationEditor.tsx",
  "components/fork/UsageStatsPanel.tsx",
  "components/fork/usage-charts.tsx",
  "components/fork/ProviderUsageCards.tsx",
  "components/fork/PhoneAndPushPanel.tsx",
  "components/fork/LanPairPanel.tsx",
  "components/fork/ImBridgePanel.tsx",
  "components/fork/BotChannelPanel.tsx",
  "components/fork/BotChannelsDialog.tsx",
  "components/ProjectArchivePanel.tsx",
  "components/ArchivedSessionsPanel.tsx",
  "components/ImportPanel.tsx",
  "components/fork/ShortcutGuideDialog.tsx",
  "components/ExtensionWidgets.tsx",
  "components/fork/PlanDocumentCard.tsx",
  "components/fork/PlanReferenceList.tsx",
  "app/pair/page.tsx",
  "components/pwa/PwaPage.tsx",
  "components/pwa/PwaSheet.tsx",
];

const systemCss = await readFile(new URL("design/v5/pwa/system.css", ROOT), "utf8");
const library = new Set([...systemCss.matchAll(/\.(m-[a-z0-9-]+)/g)].map((match) => match[1]));

const sources = new Map();
for (const file of TOUCHED) {
  sources.set(file, await readFile(new URL(file, ROOT), "utf8"));
}
const qrCanvasSource = await readFile(new URL("components/fork/QrCanvas.tsx", ROOT), "utf8");
const channelIconSource = await readFile(new URL("components/fork/ChannelIcon.tsx", ROOT), "utf8");

/** 只看真正落在 `className` 里的类名 —— 注释里提到类名不算。 */
function classLiterals(source) {
  return [...source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/g)]
    .map((match) => ({ index: match.index, value: match[1] ?? match[2] ?? match[3] ?? "" }));
}

function tokensOf(value) {
  return value.split(/[\s'"`]+/).filter((token) => /^[dm]-[a-z0-9-]+$/.test(token));
}

test("组件里用到的每个 m-* 类都真的定义在 design/v5/pwa/system.css 里", () => {
  const missing = new Set();
  for (const [file, source] of sources) {
    for (const literal of classLiterals(source)) {
      for (const token of tokensOf(literal.value)) {
        if (token.startsWith("m-") && !library.has(token)) missing.add(`${file}: ${token}`);
      }
    }
  }
  assert.deepEqual([...missing], [], "新造 m-* 类是越权（缺件写汇报，不写产品）");
});

test("桌面分支不夹带 m-*、窄屏分支不夹带 d-*（逐个组件查，不按文件）", () => {
  const hostFiles = new Set(["components/pwa/PwaPage.tsx", "components/pwa/PwaSheet.tsx"]);
  for (const [file, source] of sources) {
    if (hostFiles.has(file)) continue;
    // 一个文件里有几个组件就有几个窄屏分支，所以按函数切开逐个看。
    const chunks = source.split(/\n(?=(?:export )?(?:async )?function )/);
    for (const chunk of chunks) {
      if (!chunk.includes("useIsMobile()")) continue;
      const guardAt = chunk.indexOf("if (mobile");
      if (guardAt < 0) continue;
      // 桌面那一段 = 守卫之后**缩进比窄屏那一段更浅**的第一个 `return (`：
      // 窄屏分支内部 `.map()` 回调里也有 `return (`，按顺序数会数错，按缩进不会。
      const returns = [...chunk.matchAll(/\n(\s+)return \(\s*\n/g)]
        .filter((match) => match.index > guardAt)
        .map((match) => ({ index: match.index, indent: match[1].length }));
      const mobileReturn = returns[0];
      assert.ok(mobileReturn, `${file}: ${chunk.slice(0, 40)}… 找不到窄屏分支的 return`);
      const split = returns.find((entry) => entry.indent < mobileReturn.indent)?.index;
      assert.ok(split !== undefined, `${file}: ${chunk.slice(0, 40)}… 找不到窄屏之后的桌面 return`);
      const offset = source.indexOf(chunk);
      for (const literal of classLiterals(chunk)) {
        const index = offset + literal.index;
        if (index < offset + guardAt) continue;
        const tokens = tokensOf(literal.value);
        if (literal.index < split) {
          assert.ok(
            !tokens.some((token) => token.startsWith("d-")),
            `${file}: 窄屏分支里混进了 d- 类（${literal.value}）`,
          );
        } else {
          assert.ok(
            !tokens.some((token) => token.startsWith("m-")),
            `${file}: 桌面分支里混进了 m- 类（${literal.value}）`,
          );
        }
      }
    }
  }
});

test("渠道品牌 PNG 是登记例外，QrCanvas 的 vendor 画法一字未改", () => {
  const qr = qrCanvasSource;
  assert.match(qr, /qrImage\(content, \{ scale \}\)/, "画法仍走 lib/qr-image");
  assert.match(qr, /#ffffff/, "QR 必须纯白底");
  assert.match(qr, /#000000/, "深色模块纯黑");
  assert.doesNotMatch(qr, /className="[dm]-/, "画布本身不带形态类，形态由外层容器给");

  const icon = channelIconSource;
  for (const brand of ["/channel-icons/wechat.png", "/channel-icons/feishu.png", "/channel-icons/telegram.png", "/channel-icons/discord.png"]) {
    assert.ok(icon.includes(brand), `渠道品牌图 ${brand} 不能被换成 lucide`);
  }
});

test("三个一级页（商店 / 定时 / 用量）都走同一副骨架，没有新开页面", () => {
  const cron = sources.get("components/fork/AutomationPanel.tsx");
  const usage = sources.get("components/fork/UsageStatsPanel.tsx");
  const catalog = sources.get("components/fork/McpCatalog.tsx");
  for (const [name, source] of [["定时", cron], ["商店", catalog]]) {
    assert.match(source, /PwaSheet/, `${name}：详情与新建必须走底部面板，不新开页面`);
  }
  // 用量页只读，没有「详情 / 新建」可走；它要的是一块一级页 + 三块同源的图。
  assert.doesNotMatch(usage, /PwaSheet/, "用量页是只读的，不该凭空多一张面板");
  for (const [name, source] of [["定时", cron], ["用量", usage], ["商店", catalog]]) {
    assert.match(source, /PwaPage|<div className="m-list"/, `${name}：必须有自己的窄屏页形态`);
  }
  // 定时卡只回答「下次什么时候跑、上次成没成」
  assert.match(cron, /m-croncard-head/);
  assert.match(cron, /m-cronhist/);
  // 用量三块同源，且没有 TTFT / 速度那类会话文件里根本不存在的指标
  assert.match(usage, /UsageDailyBars/);
  assert.match(usage, /UsageHeatmap/);
  const usageCode = usage.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(usageCode, /ttft|firstToken|tokensPerSecond|每秒/i, "不造 TTFT / 速度数据");
});