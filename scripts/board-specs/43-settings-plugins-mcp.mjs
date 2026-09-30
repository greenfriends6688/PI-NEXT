// SW-10 插件 / MCP —— ConfigSplitView 双栏骨架 + pw-alert 信任提示
export default {
  name: "插件与 MCP（画板 43）",
  board: "43-settings-plugins-mcp.html",
  boardFrame: 0,
  app: { open: "settings:plugins" },
  selectors: [
    ".pw-cols",
    ".pw-list",
    ".pw-litem",
    ".pw-litem-add",
    ".pw-detail",
    ".pw-kv",
    ".pw-badge",
    ".pw-alert",
  ],
};
