// 27 设置左导航：板 web-settings-mcp 帧 A 的 `.set-nav-col` ↔ 产品同名块。
export default {
  name: "27 设置左导航",
  board: "boards/web-settings-mcp.html",
  boardRoot: '[data-v5="D-15-settings-mcp/A"] .set-nav .set-row',
  appUrl: "http://127.0.0.1:30141/",
  appRoot: ".set-nav .set-row",
  appScript: `document.querySelector('.side__foot button[title="设置"]')?.click(); await new Promise(r => setTimeout(r, 1200));`,
  settleMs: 2000,
  viewport: { width: 1440, height: 900 },
  // 板上有 `.set-search`（设置内搜索），产品没有这个能力 → 只比 `.set-nav`，
  // 搜索框登记在 DIVERGENCE（不加产品没有的功能）。
  knownDiffs: [
    { kind: "MISSING", why: "板的 .set-search 产品没有；产品设置里不做内搜索" },
    { kind: "CLASS", why: "板帧 A 的当前项是「MCP」，产品默认落在「常规」—— 状态差异，不是结构差异" },
  ],
};
