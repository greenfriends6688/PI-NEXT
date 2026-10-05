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
  // fork:v5-landing · D-19 帧 A —— `.d-statgrid` 回到画板原样：**四列**，不再按
  // 「两栏块流里一栏只有 570」退化成两列（那段布局已经整块拆掉了，见下）。
  assert.match(panelSource, /<div className="d-statgrid">/);
  assert.doesNotMatch(panelSource, /<StatGrid /);
  // `.d-stat` 的原文是三段：顶行 `.d-row`（图标 + 标签 + 徽章）/ 大数 / 补充行。
  assert.equal(panelSource.match(/<div className="d-stat">/g).length, 1, "只有 StatCard 一处发 .d-stat");
  assert.match(panelSource, /<div className="d-row">\s*<i data-ico=\{icon\} data-size="13"/);
  assert.match(panelSource, /<span className="d-t-xs d-t-faint d-grow">\{label\}<\/span>/);
  assert.match(panelSource, /<span className=\{`d-badge \$\{tone\}`\}>\{badge\}<\/span>/);
  assert.match(panelSource, /<div className="d-t-title d-num">\{value\}<\/div>/);
  assert.match(panelSource, /<div className="d-t-xs d-t-faint">\{hint\}<\/div>/);
  // 七个图表卡：热力图 / 最费的天 / 每日 token / 输入输出拆分 / 每日费用 /
  // 请求与错误 / 按项目，全是画板 D-19 的 `.d-chart`。
  assert.equal(panelSource.match(/<div className="d-chart"/g).length, 7);
  // 帧 A 的两节：模型占比（.d-card + .d-bar）与口径说明（.d-set-row + 徽章）。
  assert.match(panelSource, /<div className="d-card">/);
  assert.match(panelSource, /<div className="d-bar">/);
  assert.match(panelSource, /<span className="d-grow-last">/);
  assert.match(panelSource, /<div className="d-set-sec-t">\{t\("usage\.caliberTitle"\)\}<\/div>/);
  // 帧 D 的按项目是画板的 `.d-table`，不是自绘的列表行。
  assert.match(panelSource, /<table className="d-table">/);
  // 「重播入场」是真接线（换 key 重挂载），两处帧头各一枚。
  assert.equal(panelSource.match(/\{replayButton\}/g).length, 2);
  // 三件套：页头 + 工具栏（周期芯片）+ 内容区。
  assert.match(panelSource, /<SettingsPage[\s\S]*?sub=\{t\("usage\.subtitle"\)\}/);
  assert.match(panelSource, /className="d-grid2"/);

  for (const cls of ["d-bars", "d-bar-rise", "d-heat-grid", "d-mono", "d-grow", "d-t-faint"]) {
    assert.ok(chartsSource.includes(cls), `usage-charts must use .${cls}`);
  }
});

test("「刷新」是页级动作（页头右端），不再留在工具栏", () => {
  // 画板 62 落位表：用量的页级动作是「刷新」；画板 45 §用量的页头动作就是
  // `pw-btn outline sm` + refresh-cw。工具栏只留周期芯片与扫描计数。
  const actionsAt = panelSource.indexOf("actions={");
  const toolbarAt = panelSource.indexOf("toolbar={");
  const refreshAt = panelSource.indexOf("usage.refresh");
  assert.ok(actionsAt >= 0 && toolbarAt > actionsAt, "页头 actions 必须存在且在 toolbar 之前");
  assert.ok(refreshAt > actionsAt && refreshAt < toolbarAt, "刷新按钮必须挂在页头 actions 里");
  assert.match(panelSource, /data-ico="refresh-cw" data-size="13"/, "动作形态抄画板 45 页头：图标 + sm 按钮");
  // 62 的页头规则：计数进工具栏的等宽读数，不进 sub、也不再用旧 hint 类。
  assert.match(panelSource, /className="d-mono d-t-faint">\s*\{t\("usage\.scannedHint"/);
});

test("用量页不再套产品自绘的旧壳类（DIVERGENCE 145 登记残留清掉）", () => {
  const desktopAt = panelSource.indexOf("<SettingsPage");
  assert.ok(desktopAt > 0, "桌面分支仍以 SettingsPage 三件套开头");
  // `.settings-general-section` 的边框/圆角是产品 token（--border / --radius-lg），
  // 与画板 `.pw-cell` 的边框叠成双框；空态提示行同理换画板的 `.pw-hint`。
  assert.doesNotMatch(panelSource, /className="settings-general-section"/);
  assert.doesNotMatch(panelSource, /className="settings-chat-range-hint"/);
  assert.match(panelSource, /className="d-t-xs d-t-faint">\{t\("usage\.empty"\)\}/);
  // fork:v5-landing · D-19 —— 按项目也换成了画板的 `.d-table`（原来是一串
  // 自绘的 `.d-row` 列表）。
  assert.doesNotMatch(panelSource.slice(desktopAt), /UsageListRow/, "桌面不再自绘项目列表行");
});

/**
 * fix:usage-heatmap（2026-09-30 用户实测「用量页面好像是假的，没有真实数据吗」）——
 *
 * 数据是真的（接口回 158 会话 / 40186 消息 / 4.15B token），假的是**图**：
 * 年度热力图是「26 天 × 一格」的整宽轨道，塞进 570 的一栏时只有前一半可见，
 * 而**最近的活动全在最右端**（今天在最后一列）—— 用户看到的是一整片空白灰格子。
 * 所以它必须**独占整行**：桌面骨架是单列块流，热力图排在**任何** `.d-grid2`
 * 之前（两块两栏都排在它后面），也就是永远不在半宽的栏里。
 * fork:v5-landing · D-19 —— 原先的「两栏 → 整行 → 两栏」骨架随两栏布局一起拆掉了，
 * 约束本身不变：热力图两侧都没有半宽栏。
 */
test("年度热力图占一整行，不塞进 570 的一栏", () => {
  // 面板现在有**两个调用点**（`.m-*` 窄屏页 + `.d-*` 桌面页），而这条约束说的是
  // 桌面骨架。断言必须钉在桌面那一段上，否则会被窄屏的调用点顶掉。
  const desktopAt = panelSource.indexOf("<SettingsPage");
  assert.ok(desktopAt > 0, "桌面分支仍以 SettingsPage 三件套开头");
  const grids = [...panelSource.matchAll(/className="d-grid2"/g)]
    .map((m) => m.index)
    .filter((index) => index > desktopAt);
  assert.equal(grids.length, 2, "桌面骨架只有两处并排块（输入/输出拆分 + 每日费用、请求与错误 + 按项目）");
  const heatAt = panelSource.indexOf("<UsageHeatmap", desktopAt);
  assert.ok(heatAt > 0, "热力图必须在用量页里");
  assert.ok(
    heatAt < grids[0],
    "热力图必须排在所有两栏块之前（独占整行），否则年度网格的右半截（最近的活动）会被裁掉",
  );
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
  // levels(): 0 档不打 level 类（默认灰格），1-4 档分别是 `.l1`~`.l4`。
  assert.match(html, /class="d-heat-grid l1"/);
  assert.match(html, /class="d-heat-grid l2"/);
  assert.match(html, /class="d-heat-grid l3"/);
  assert.match(html, /class="d-heat-grid l4"/);
  assert.match(html, /class="d-heat-grid d-cell-pop"/);
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
  assert.equal(html, "<p class=\"d-t-xs d-t-faint\">—</p>");
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
  assert.match(html, /<div class="d-bars"/);
  assert.match(html, /title="2026-03-01 · 0"[^>]*style="height:2%/);
  assert.match(html, /title="2026-03-02 · 50"[^>]*style="height:50%/);
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
  assert.equal(html.match(/class="d-bars"/g).length, 2);
  assert.match(html, /<div class="d-row d-t-xs"/);
  // 两条序列共用 max=20：请求 0/10/20 → 2%/50%/100%，错误 0/0/5 → 2%/2%/25%。
  assert.match(html, /title="2026-05-01 · 请求 0"[^>]*style="height:2%/);
  assert.match(html, /title="2026-05-02 · 请求 10"[^>]*style="height:50%/);
  assert.match(html, /class="d-bar-rise" title="2026-05-03 · 请求 20"[^>]*style="height:100%/);
  assert.match(html, /title="2026-05-03 · 错误 5"[^>]*style="height:25%;background:var\(--nx-surface-hi\)/);
  // 零错误的格子不挂 title（与旧实现一致：只有真的有失败才提示）。
  assert.doesNotMatch(html, /title="2026-05-01 · 错误/);
  // 图例仍然可读，且在 role="img" 之外。
  assert.match(html, /<div class="d-row d-t-xs"[\s\S]*?请求[\s\S]*?错误/);
});

test("charts only use the board's three colours (画板 45：accent 主 / n-border 次 / n-hover 底)", () => {
  // 画板 D-19 注记：「图表只用三种色……不引入新色相」。失败序列原来是
  // error 红 —— 画板里没有的新色相，换成次要灰（v5 `--nx-surface-hi`）。
  assert.doesNotMatch(chartsSource, /var\(--error\)/, "图表不许引入 error 红这类新色相");
  assert.doesNotMatch(chartsSource, /var\(--warning\)/, "图表不许引入 warning 黄这类新色相");
  assert.match(chartsSource, /background: "var\(--nx-surface-hi\)"/, "失败序列走次要灰");
  // 另外两色：主序列 / 热柱走 accent，空档与轨道走 n-surface-hi。
  assert.match(chartsSource, /var\(--nx-accent\)/);
  assert.match(chartsSource, /var\(--nx-surface-hi\)/);
  // 进度条圆角是 v5 的三档之一。
  assert.match(chartsSource, /borderRadius: "var\(--nx-r-xs\)"/);
  assert.doesNotMatch(chartsSource, /var\(--radius-/);
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

  assert.match(html, /<div class="d-row d-t-xs"/);
  assert.match(html, /<i data-ico="chart-pie" data-size="14" aria-hidden="true"><\/i>/);
  assert.match(html, /<span class="d-grow d-mono" title="V4\.1 Flash">V4\.1 Flash<\/span>/);
  assert.match(html, /<span class="d-t-dim">请求 12 · 3\.7M tok · \$1\.20<\/span>/);
  assert.match(html, /<span class="d-t-faint">62\.0%<\/span>/);
  assert.doesNotMatch(
    render(React.createElement(UsageListRow, { title: "pi-codex", meta: "4 会话", trailing: "1.2M tok" })),
    /data-ico/,
  );
});
