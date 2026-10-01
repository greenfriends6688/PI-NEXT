
//
// 跑法：APP_URL=http://127.0.0.1:32141 node scripts/board-diff.mjs scripts/board-specs/4x-47-frame3.mjs
export default {
  "name": "自定义 CSS 页签 · 内置壁纸选择器（画板 47 · 帧 3）",
  "board": "47-skin-studio.html",
  "boardFrame": 3,
  "app": {
    "settle": 1800,
    "script": "\n      const opener = document.querySelector(\"button.pw-side-foot\");\n      if (opener) opener.click();\n      await new Promise((r) => setTimeout(r, 1500));\n      const row = document.querySelector('button.pw-row[data-section=\"general\"]');\n      if (!row) throw new Error(\"general 分节没找到\");\n      row.click();\n      await new Promise((r) => setTimeout(r, 1800));\n      // 「打开皮肤工作室」在没有非默认皮肤时是 disabled（ThemeSkinStrip.tsx:160），\n      // 所以走「新建皮肤」卡 —— 它一定会打开工作室（isNew 态），几何与编辑态一致。\n      const card = document.querySelector(\"button.pw-skin.is-new\");\n      if (!card) throw new Error(\"皮肤条上的「新建皮肤」卡没找到\");\n      card.click();\n      await new Promise((r) => setTimeout(r, 1400));\n      const tab = document.querySelectorAll(\".pw-tabs .pw-tab\")[1];\n      if (!tab) throw new Error(\"工作室的「自定义 CSS」页签没找到\");\n      tab.click();\n      await new Promise((r) => setTimeout(r, 1200));"
  },
  "tolerance": {
    "box": 2,
    "fontSize": 0
  },
  "knownDiffs": [
    {
      "sel": ".fork-skin-scrim .pw-grid3",
      "reason": "**未实现**：全仓 `.pw-grid3` 零引用（board.css:1099 有定义），产品既没有壁纸画廊也没有三格网格 —— 见报告"
    },
    {
      "sel": ".fork-skin-scrim .pw-wallpaper-thumb",
      "reason": "**未实现（形态不同）**：产品没有「内置壁纸」模态，画廊被换成 `BuiltinWallpaperPicker` 的 `.pw-field` 行（`components/BuiltinWallpaperPicker.tsx:26`）"
    },
    {
      "sel": ".fork-skin-scrim .pw-badge.bad",
      "reason": "**未实现**：画板帧 3 的「第 6 行：--radius-6 超出规范上限」是 CSS 校验徽章，产品工作室的 CSS 页签**没有 token 校验**，见报告"
    },
    {
      "sel": ".fork-skin-scrim .pw-radio",
      "reason": "**未实现（控件形态不同）**：画板「各面适配」是四排三选一芯片；产品是三个 `.pw-selectbox` 下拉（WallpaperSettings.tsx:106-124）"
    },
    {
      "sel": ".fork-skin-scrim .pw-sec-title",
      "reason": "**状态依赖**：量的是工作室 CSS 页签里的第一枚 `.pw-sec-title`；产品那一页没有「各面适配」小标题"
    },
    {
      "sel": ".fork-skin-scrim .pw-field",
      "reason": "**未实现（形态不同）**：同 `.pw-wallpaper-thumb`"
    },
    {
      "sel": ".fork-skin-scrim .pw-field .pw-label",
      "reason": "同上"
    },
    {
      "sel": ".fork-skin-scrim .pw-ctl",
      "reason": "**状态依赖**：量的是 CSS 页签里的第一枚 `.pw-ctl`，与画板那一枚（遮罩浓度）不同行"
    },
    {
      "sel": ".fork-skin-scrim .pw-mono",
      "reason": "同上"
    },
    {
      "sel": ".fork-skin-scrim > .pw-modal",
      "reason": "**画板自身不一致（B 类）**：画板帧 3 的两个模态没有行内 `display:flex`，而画板帧 1 的写了；产品照帧 1。"
    }
  ],
  "pairs": [
    [
      ".pw-modal",
      ".fork-skin-scrim > .pw-modal"
    ],
    [
      ".pw-modal-head",
      ".fork-skin-scrim .pw-modal-head"
    ],
    [
      ".pw-badge.warn",
      ".fork-skin-scrim .pw-badge.warn"
    ],
    [
      ".pw-badge.bad",
      ".fork-skin-scrim .pw-badge.bad"
    ],
    [
      ".pw-modal-body",
      ".fork-skin-scrim .pw-modal-body"
    ],
    [
      ".pw-alert",
      ".fork-skin-scrim .pw-alert"
    ],
    [
      ".pw-textarea",
      ".fork-skin-scrim .pw-textarea"
    ],
    [
      ".pw-inline",
      ".fork-skin-scrim .pw-inline"
    ],
    [
      ".pw-btn.sm",
      ".fork-skin-scrim .pw-btn.sm"
    ],
    [
      ".pw-modal-foot",
      ".fork-skin-scrim .pw-modal-foot"
    ],
    [
      ".pw-btn",
      ".fork-skin-scrim .pw-btn"
    ],
    [
      ".pw-btn.primary",
      ".fork-skin-scrim .pw-btn.primary"
    ],
    [
      ".pw-btn.danger",
      ".fork-skin-scrim .pw-btn.danger"
    ],
    [
      ".pw-radio",
      ".fork-skin-scrim .pw-radio"
    ],
    [
      ".pw-grid3",
      ".fork-skin-scrim .pw-grid3"
    ],
    [
      ".pw-sec-title",
      ".fork-skin-scrim .pw-sec-title"
    ],
    [
      ".pw-field",
      ".fork-skin-scrim .pw-field"
    ],
    [
      ".pw-field .pw-label",
      ".fork-skin-scrim .pw-field .pw-label"
    ],
    [
      ".pw-ctl",
      ".fork-skin-scrim .pw-ctl"
    ],
    [
      ".pw-mono",
      ".fork-skin-scrim .pw-mono"
    ],
    [
      ".pw-wallpaper-thumb",
      ".fork-skin-scrim .pw-wallpaper-thumb"
    ]
  ]
};
