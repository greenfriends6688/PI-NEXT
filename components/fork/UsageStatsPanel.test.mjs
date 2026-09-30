import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

/*
 * fork:usage-dashboard — 用量面板的源码守卫。
 *
 * 这一批把面板与图表从「自带视觉类 + 内联盒 + 手写 SVG」换成画板 45 §用量统计 的
 * `.pw-stats-grid` / `.pw-stat` / `.pw-cell` / `.pw-bars` / `.pw-legend` / `.pw-list`。
 * 断言分两层：
 *   · 结构层 —— 画板类在位、`<svg>` 与数字字号归零（不许退回旧写法）；
 *   · 口径层 —— 五档分级、max 归一、x 轴采样、每格 / 每柱的 title 全部照旧。
 * 口径层是真的渲染出来量的：换绘制方式最容易悄悄改掉的就是这些数字。
 */

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const {
  UsageDailyBars,
  UsageHeatmap,
  UsageListRow,
  UsageRequestsErrors,
  UsageShareBar,
} = await jiti.import("./usage-charts.tsx");

const panelSource = await readFile(new URL("./UsageStatsPanel.tsx", import.meta.url), "utf8");
const chartsSource = await readFile(new URL("./usage-charts.tsx", import.meta.url), "utf8");

function day(day, sessions, messages, tokens, errors) {
  return { day, sessions, messages, tokens, cost: 0, errors };
}

const render = (node) => renderToStaticMarkup(node);

/* ---------------------------------------------------------------- 结构守卫 */

test("the stat cards and every chart card ride the board 45 primitives", () => {
  assert.match(panelSource, /<div className="pw-stats-grid">/);
  assert.match(panelSource, /<div className="pw-stat">/);
  // 画板的顺序是「标签在上、数值在下」，不是产品原先的「大数在上」。
  assert.match(panelSource, /<div className="pw-stat">\s*<span className="k">\{label\}<\/span>\s*<span className="v">\{value\}<\/span>/);
  assert.match(panelSource, /<span className="s">\{hint\}<\/span>/);
  assert.equal(panelSource.match(/<div className="pw-cell">/g).length, 5);
  assert.match(panelSource, /<div className="pw-list"/);

  for (const cls of ["pw-bars", "pw-legend", "pw-litem", "pw-lname", "pw-lsub", "pw-mono", "pw-ico"]) {
    assert.ok(chartsSource.includes(cls), `usage-charts must use .${cls}`);
  }
});

test("no hand-drawn SVG and no numeric font size survives (DSN-07)", () => {
  for (const [name, source] of [["UsageStatsPanel.tsx", panelSource], ["usage-charts.tsx", chartsSource]]) {
    assert.doesNotMatch(source, /<svg/, `${name} must not hand-draw an SVG chart`);
    assert.doesNotMatch(source, /fontSize:\s*TEXT/, `${name} must size text through board tokens`);
    assert.doesNotMatch(source, /fontSize:\s*[0-9]/, `${name} must not carry a numeric font size`);
  }
  // 内联盒（自绘边框 / 圆角 / 背景）也一并退场：卡片外观由 board.css 提供。
  assert.doesNotMatch(panelSource, /borderRadius: "var\(--radius-/, "stat cards must not hand-draw their frame");
  assert.doesNotMatch(chartsSource, /border: "1px solid var\(--border/, "list rows must not hand-draw their frame");
});

test("the panel keeps its own chrome: range buttons, metric toggle, empty and error states", () => {
  for (const key of [
    "usage.range7d", "usage.range30d", "usage.range1y", "usage.rangeAll",
    "usage.refresh", "usage.scannedHint", "usage.loading", "usage.error", "usage.empty",
    "usage.heatmap", "usage.metricSessions", "usage.metricTokens", "usage.less", "usage.more",
    "usage.byModel", "usage.modelShare", "usage.requestsErrors", "usage.requestsLegend",
    "usage.errorsLegend", "usage.dailyTokens", "usage.byProject", "usage.moreProjects",
  ]) {
    // 区间按钮的 key 走 RANGE_KEYS 映射表（`"7d": "usage.range7d"`），其余直接
    // `t("…")` —— 两种写法都算「key 还在」。
    assert.ok(panelSource.includes(`"${key}"`), `missing i18n key ${key}`);
  }
  assert.match(panelSource, /aria-pressed=\{range === option\}/);
  assert.match(panelSource, /aria-pressed=\{metric === "tokens"\}/);
  assert.match(panelSource, /fetch\(`\/api\/usage-stats\?\$\{query\.toString\(\)\}`, \{ cache: "no-store" \}\)/);
});

/* ---------------------------------------------------------------- 口径守卫 */

test("the heatmap keeps its 5-step level scale and the per-cell title", () => {
  const html = render(
    React.createElement(UsageHeatmap, {
      days: [0, 1, 2, 3, 4].map((value, index) => day(`2026-01-0${index + 1}`, value, value, value * 10, 0)),
      metric: "tokens",
      label: "活跃热力图",
      lessLabel: "少",
      moreLabel: "多",
    }),
  );

  assert.match(html, /role="img"/);
  assert.match(html, /aria-label="活跃热力图"/);
  // levels(): 0 → 1 档底色，五档透明度阶梯 1 / .38 / .58 / .78 / .98 一个都不能少。
  assert.match(html, /opacity:1/);
  assert.match(html, /opacity:0\.38/);
  assert.match(html, /opacity:0\.58/);
  assert.match(html, /opacity:0\.78/);
  assert.match(html, /opacity:0\.98/);
  // 0 档是 --bg-hover，其余是 --accent。
  assert.match(html, /background:var\(--bg-hover\)/);
  assert.match(html, /background:var\(--accent\)/);
  // 每格都带 title。
  assert.match(html, /title="2026-01-01 · 0"/);
  assert.match(html, /title="2026-01-05 · 40"/);
  // 月份标记与「少 → 多」图例仍在（月份行按周列对齐）。
  assert.match(html, />1月</);
  assert.match(html, />少</);
  assert.match(html, />多</);
});

test("an empty range still renders the placeholder, not a broken grid", () => {
  const html = render(
    React.createElement(UsageHeatmap, {
      days: [], metric: "sessions", label: "活跃热力图", lessLabel: "少", moreLabel: "多",
    }),
  );
  assert.equal(html, "<p class=\"pw-muted\">—</p>");
  assert.doesNotMatch(html, /<svg/);
});

test("daily bars are max-normalised, mark the peak, and sample the x axis", () => {
  const html = render(
    React.createElement(UsageDailyBars, {
      days: [day("2026-03-01", 1, 2, 0, 0), day("2026-03-02", 1, 2, 50, 0), day("2026-03-03", 1, 2, 100, 0)],
      label: "每日 Token 趋势",
    }),
  );

  assert.match(html, /role="img"/);
  assert.match(html, /aria-label="每日 Token 趋势"/);
  assert.match(html, /<div class="pw-bars">/);
  assert.match(html, /title="2026-03-01 · 0"[^>]*style="height:2%"/);
  assert.match(html, /title="2026-03-02 · 50"[^>]*style="height:50%"/);
  // xLabelEvery = ceil(3 / 6) = 1 → 三天全标。
  assert.match(html, />03-01</);
  assert.match(html, />03-02</);
  assert.match(html, />03-03</);
});

test("a long range samples the x axis every nth day plus the last one", () => {
  const days = Array.from({ length: 12 }, (_, index) =>
    day(`2026-04-${String(index + 1).padStart(2, "0")}`, 1, 1, 1, 0));
  const html = render(React.createElement(UsageDailyBars, { days, label: "每日 Token 趋势" }));

  // xLabelEvery = ceil(12 / 6) = 2 → 第 0/2/4/6/8/10 天，外加最后一天。
  const labels = [...html.matchAll(/>(04-\d\d)</g)].map((match) => match[1]);
  assert.deepEqual(labels, ["04-01", "04-03", "04-05", "04-07", "04-09", "04-11", "04-12"]);
});

test("requests and errors share one max, keep both series' titles and the legend", () => {
  const html = render(
    React.createElement(UsageRequestsErrors, {
      days: [day("2026-05-01", 1, 0, 0, 0), day("2026-05-02", 1, 10, 0, 0), day("2026-05-03", 1, 20, 0, 5)],
      label: "请求与错误",
      requestsLabel: "请求",
      errorsLabel: "错误",
    }),
  );

  assert.match(html, /role="img"/);
  assert.match(html, /aria-label="请求与错误"/);
  assert.equal(html.match(/class="pw-bars"/g).length, 2);
  assert.equal(html.match(/class="pw-legend"/g).length, 1);
  // 两条序列共用 max=20：请求 0/10/20 → 2%/50%/100%，错误 0/0/5 → 2%/2%/25%。
  assert.match(html, /title="2026-05-01 · 请求 0"[^>]*style="height:2%"/);
  assert.match(html, /title="2026-05-02 · 请求 10"[^>]*style="height:50%"/);
  assert.match(html, /class="hot"[^>]*title="2026-05-03 · 请求 20"[^>]*style="height:100%"/);
  assert.match(html, /title="2026-05-03 · 错误 5"[^>]*style="height:25%;background:var\(--error\)"/);
  // 零错误的格子不挂 title（与旧实现一致：只有真的有失败才提示）。
  assert.doesNotMatch(html, /title="2026-05-01 · 错误/);
  // 图例仍然可读，且在 role="img" 之外。
  assert.match(html, /<div class="pw-legend">[\s\S]*?请求[\s\S]*?错误/);
});

test("the model share bar keeps its per-slice widths, titles and accessible name", () => {
  const html = render(
    React.createElement(UsageShareBar, {
      slices: [{ key: "V4.1 Flash", tokens: 620, share: 0.62 }, { key: "其它", tokens: 180, share: 0.18 }],
      label: "按模型占比",
    }),
  );

  assert.match(html, /role="img"/);
  assert.match(html, /aria-label="按模型占比"/);
  assert.match(html, /title="V4\.1 Flash · 62\.0%"/);
  assert.match(html, /width:62%/);
  assert.match(html, /title="其它 · 18\.0%"/);
  // 全部为 0 的切片不渲染这一条（与旧实现一致）。
  assert.equal(render(React.createElement(UsageShareBar, { slices: [{ key: "x", tokens: 0, share: 0 }], label: "l" })), "");
});

test("a list row is name + sub + trailing, with the accent icon only when asked", () => {
  const html = render(
    React.createElement(UsageListRow, { accent: true, title: "V4.1 Flash", meta: "请求 12 · 3.7M tok · $1.20", trailing: "62.0%" }),
  );

  assert.match(html, /<div class="pw-litem">/);
  assert.match(html, /<i data-ico="chart-pie" data-size="14"><\/i>/);
  assert.match(html, /<span class="pw-lname" title="V4\.1 Flash">V4\.1 Flash<\/span>/);
  assert.match(html, /<span class="pw-lsub pw-mono">请求 12 · 3\.7M tok · \$1\.20<\/span>/);
  assert.match(html, /<span class="pw-mono">62\.0%<\/span>/);
  assert.doesNotMatch(
    render(React.createElement(UsageListRow, { title: "pi-codex", meta: "4 会话", trailing: "1.2M tok" })),
    /data-ico/,
  );
});
