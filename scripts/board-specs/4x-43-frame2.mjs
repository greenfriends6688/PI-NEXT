// 从其它 agent 导入 MCP（画板 43 · 帧 2）
//
// fork:v5-settings-map（2026-10-04）—— 产品侧选择器从 v1 的 pw-* 迁到 v5 的 d-*。
// **画板侧一行不动**，两边靠 pairs 显式配对。
//
// 与 4x-42-frame2 同款：**弹层壳四个类在 v5 有意保留 v1 名**
// （PluginsConfig.tsx:1217-1226 的 fork:v5-skin-pw-modal-keep 注释：手机 sheet 以
// .fork-pwa-import-scrim .pw-modal/-body/-foot 为选择器，删了会静默打断整片 sheet），
// 只把壳**里面**的 v1 件换成 v5 的。
const OPEN_MCP_IMPORT = `
  const opener = document.querySelector(".d-side-foot button");
  if (!opener) throw new Error("设置入口没找到（.d-side-foot > button）");
  opener.click();
  await new Promise((r) => setTimeout(r, 1600));
  const row = document.querySelector('button.d-set-navitem[data-section="mcp"]');
  if (!row) throw new Error("settings section not found: mcp");
  row.click();
  await new Promise((r) => setTimeout(r, 1800));
  const btn = [...document.querySelectorAll(".settings-section-host:not([hidden]) .d-set-sec .d-row button")]
    .find((b) => /导入|import/i.test(b.textContent ?? ""));
  if (!btn) throw new Error("页头动作区的「从其他工具导入」按钮没找到");
  btn.click();
  // fork:v5-settings-map —— 弹层要等服务端扫完本机其它 agent 的配置才出内容，
  // 不等就会量到一片空壳。等 .fork-pwa-import-scrim 真的挂上再量。
  for (let i = 0; i < 40; i++) {
    if (document.querySelector(".fork-pwa-import-scrim .d-menu-row")) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await new Promise((r) => setTimeout(r, 1000));`;

export default {
  "name": "从其它 agent 导入 MCP（画板 43 · 帧 2）",
  "board": "43-settings-plugins-mcp.html",
  "boardFrame": 2,
  "app": { "script": OPEN_MCP_IMPORT, "settle": 2000 },
  "tolerance": { "box": 2, "fontSize": 0 },
  "knownDiffs": [
    {
      "sel": ".fork-pwa-import-scrim .pw-modal",
      "reason": "**取样差异（宿主选择器）**：画板侧写的是 `.pw-cols > .pw-modal`，而画板帧 2 是两张独立演示帧（`.pw-frame-body.pw-pad.pw-grid2`），**帧里没有 `.pw-cols`** —— 这一对在画板侧不存在（工具报「画板里没有这个选择器」并跳过），产品侧取的是真实弹层 `.fork-pwa-import-scrim > .pw-modal`。"
    },
    {
      "sel": ".fork-pwa-import-scrim .d-chips",
      "reason": "**取样差异（`.pw-wrap` → 芯片行）**：画板把八个来源画成 `.pw-wrap` 里一排 `.pw-chip`；v5 发 `div.d-chips` + `button.d-chipbtn`（`PluginsConfig.tsx:1251`），选中态是 `.is-on`（不再是 `.accent`）。"
    },
    {
      "sel": ".fork-pwa-import-scrim .d-sep-v",
      "reason": "**取样差异（`.pw-sep` → 竖发丝）**：画板那一行是横发丝 `.pw-sep`；v5 在芯片行里发的是**竖**发丝 `span.d-sep-v`（`PluginsConfig.tsx:1259`）。同一件「把两组隔开」的东西，方向按 v5 系统表取值。"
    },
    {
      "sel": ".fork-pwa-import-scrim .d-menu-row",
      "reason": "**取样差异（`.pw-prow` → 菜单行）**：v1 把待导入的服务器画成 `.pw-prow`（浮层行）；v5 用 `button.d-menu-row`（`PluginsConfig.tsx:1276`，`system.css:379`）配 `.d-menu-row.is-on`。行盒档位按 v5 系统表取值。"
    },
    {
      "sel": ".fork-pwa-import-scrim .d-switch",
      "reason": "**形态差异**：画板每一行待导入服务器前面挂一枚 `.pw-switch`（勾选框）；v5 把「导入」做成每行右端的一枚 `button.d-btn.outline.sm`，行首只留图标 —— 没有开关件。行盒档位由 `.d-menu-row` 那一对量。"
    },
    {
      "sel": ".fork-pwa-import-scrim .d-btn.primary",
      "reason": "**未落地**：画板脚行右端是 primary「导入所选」（先勾再导）；v5 的脚行只有一枚 outline「取消」（`PluginsConfig.tsx:1335` 起），导入是**每行一枚** outline「导入」。这一对量到的是弹层里实际存在的那一枚 `.d-btn.primary`（若没有则按取样差异记）。"
    },
    {
      "sel": ".fork-pwa-import-scrim .d-btn.danger",
      "reason": "**未落地**：画板那一格（http 型服务器的授权流程）里有一枚 danger 动作；v5 的导入弹层里没有任何 danger 动作。这一对量到的是弹层里实际存在的那一枚 `.d-btn.danger`（若没有则按取样差异记）。"
    },
    {
      "sel": ".fork-pwa-import-scrim .d-card",
      "reason": "**未落地**：画板帧 2 的第二格是「http 型服务器的 OAuth 授权」独立对话框（`.pw-cell` 那一格）；v5 的导入弹层里没有这一格。这一对量到的是弹层里实际存在的那一枚 `.d-card`（若没有则按取样差异记）。"
    },
    {
      "sel": ".fork-pwa-import-scrim .d-code-body",
      "reason": "**未落地**：画板那一格底部有一段带 token 着色的配置原文；v5 的导入弹层没有代码回显区（只有来源芯片 + 行表 + 脚行）。"
    },
    {
      "sel": ".fork-pwa-import-scrim .d-code-body .tok-c",
      "reason": "**未落地**：同上（导入弹层没有代码回显区）。"
    },
    {
      "sel": ".fork-pwa-import-scrim .d-banner.info",
      "reason": "**取样差异（`.pw-alert` → `.d-banner`）**：对照表里的 `.pw-alert` 在 v5 没有同名类，实际承载它的是 `.d-banner` + `.info` 档（`system.css:456/461`）。"
    },
    {
      "sel": ".fork-pwa-import-scrim .d-inline",
      "reason": "**取样差异（`.pw-inline` → `.d-row`）**：动作行在 v5 发 `div.d-row.fork-pwa-acts`（`PluginsConfig.tsx:1125`）。"
    },
    {
      "sel": ".fork-pwa-import-scrim .d-card",
      "reason": "**取样差异（`.pw-cell` → `.d-card`）**：画板那一格是 `.pw-cell`（描边 + 圆角的一张内容格）；v5 用 `.d-card` / `.d-card-body`（`system.css:624/627`）。格盒档位按 v5 系统表取值。"
    },
    {
      "sel": ".fork-pwa-import-scrim .d-code-body .tok-c",
      "reason": "**取样差异（token 类名）**：v1 是 `.pw-tok-key/-str/-num/-com/-fn`；v5 的着色类收成 `system.css:190-193` 的 `.tok-k / -s / -n / -c`。"
    }
  ],
  "pairs": [
    // 弹层壳：v5 有意保留 v1 类（见文件头注释）
    [".pw-modal", ".fork-pwa-import-scrim > .pw-modal"],
    [".pw-modal-head", ".fork-pwa-import-scrim .pw-modal-head"],
    [".pw-modal-body", ".fork-pwa-import-scrim .pw-modal-body"],
    [".pw-modal-foot", ".fork-pwa-import-scrim .pw-modal-foot"],
    // 壳内的 v1 件 → v5
    [".pw-wrap", ".fork-pwa-import-scrim .d-chips"],
    [".pw-chip", ".fork-pwa-import-scrim .d-chips .d-badge"],
    [".pw-chip.accent", ".fork-pwa-import-scrim .d-chips .d-badge"],
    [".pw-sep", ".fork-pwa-import-scrim .d-sep-v"],
    [".pw-prow", ".fork-pwa-import-scrim .d-menu-row"],
    [".fork-pwa-import-scrim .d-switch", ".fork-pwa-import-scrim .d-switch"],
    [".pw-badge.warn", ".fork-pwa-import-scrim .d-menu-row .d-badge.warn"],
    [".pw-alert.info", ".fork-pwa-import-scrim .d-t-xs.d-t-faint"],
    [".pw-mono", ".fork-pwa-import-scrim .d-menu-row .d-mono.d-t-faint"],
    [".pw-inline", ".fork-pwa-import-scrim .pw-modal-foot .d-t-xs.d-t-faint"],
    [".pw-btn", ".fork-pwa-import-scrim .d-menu-row .d-btn.outline.sm"],
    [".fork-pwa-import-scrim .d-btn.primary", ".fork-pwa-import-scrim .d-btn.primary"],
    [".fork-pwa-import-scrim .d-btn.danger", ".fork-pwa-import-scrim .d-btn.danger"],
    [".pw-btn.outline", ".fork-pwa-import-scrim .d-btn.outline"],
    [".pw-cell", ".fork-pwa-import-scrim .d-card"],
    [".fork-pwa-import-scrim .d-code-body", ".fork-pwa-import-scrim .d-code-body"],
    [".fork-pwa-import-scrim .d-code-body .tok-c", ".fork-pwa-import-scrim .d-code-body .tok-c"]
  ]
};