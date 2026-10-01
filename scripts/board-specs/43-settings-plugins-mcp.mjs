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
  knownDiffs: [
    {
      sel: ".pw-kv",
      reason:
        "**数据依赖**：种子环境（临时 agent 目录）里没装任何插件，详情欄的属性表没有行；"
        + "本机装了插件时会列出来并逐项对位。",
    },
  ],
};
