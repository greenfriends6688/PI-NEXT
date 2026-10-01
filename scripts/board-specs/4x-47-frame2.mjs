
//
// 跑法：APP_URL=http://127.0.0.1:32141 node scripts/board-diff.mjs scripts/board-specs/4x-47-frame2.mjs
export default {
  "name": "工作室对话框外壳（画板 47 · 帧 2：头 / 页签 / 内容 / 提示 / 动作 五行）",
  "board": "47-skin-studio.html",
  "boardFrame": 2,
  "app": {
    "settle": 1800,
    "script": "\n      const opener = document.querySelector(\"button.pw-side-foot\");\n      if (opener) opener.click();\n      await new Promise((r) => setTimeout(r, 1500));\n      const row = document.querySelector('button.pw-row[data-section=\"general\"]');\n      if (!row) throw new Error(\"general 分节没找到\");\n      row.click();\n      await new Promise((r) => setTimeout(r, 1800));\n      // 「打开皮肤工作室」在没有非默认皮肤时是 disabled（ThemeSkinStrip.tsx:160），\n      // 所以走「新建皮肤」卡 —— 它一定会打开工作室（isNew 态），几何与编辑态一致。\n      const card = document.querySelector(\"button.pw-skin.is-new\");\n      if (!card) throw new Error(\"皮肤条上的「新建皮肤」卡没找到\");\n      card.click();\n      await new Promise((r) => setTimeout(r, 1400));"
  },
  "tolerance": {
    "box": 2,
    "fontSize": 0
  },
  "knownDiffs": [
    {
      "sel": ".fork-skin-scrim .pw-modal-body",
      "reason": "**取景差异**：画板帧 2 的 `.pw-modal-body` 是 `grid-template-columns:1fr 200px` 的 520px 演示格；产品工作室的内容行是 900×720 里的 `340px 1fr`。宽度按文本判定后跳过，样式仍逐项比"
    },
    {
      "sel": ".fork-skin-scrim .pw-alert.info",
      "reason": "**状态依赖**：提示行按约定「没有消息时整行不存在」，新建态刚打开没有提示 —— 量不到是正确行为"
    },
    {
      "sel": ".fork-skin-scrim .pw-btn.danger",
      "reason": "**状态依赖**：同 `.pw-alert.info`，新建态的动作行按画板约定没有「删除」"
    },
    {
      "sel": ".fork-skin-scrim .pw-btn.outline",
      "reason": "**状态依赖**：产品工作室的「恢复默认」只在编辑态出现"
    },
    {
      "sel": ".fork-skin-scrim .pw-inline",
      "reason": "**取景差异**：画板帧 2 的 `.pw-inline` 是那两个演示格的并排容器（gap s4 / align-items flex-start / 13px）；产品第一个 `.pw-inline` 是模态头内部那一行（gap s2 / align-items center / 12px）"
    },
    {
      "sel": ".fork-skin-scrim",
      "reason": "**画板自身不一致（B 类）**：board.css:640 的 `.pw-scrim` 是 `padding: var(--s5)`（24px），但画板帧 2 的两个演示格**行内**写了 `padding: var(--s3)`（12px）；产品照 board.css 的 24px。"
    },
    {
      "sel": ".fork-skin-scrim > .pw-modal",
      "reason": "**画板自身不一致（B 类）**：画板帧 2 的演示模态是 `display:block`，而画板帧 1 的真身写了 `display:flex; flex-direction:column`（board.css 本身不写 display）；产品的 `ThemeSkinStudio.tsx:209` 照的是帧 1。"
    },
    {
      "sel": ".fork-skin-scrim .pw-input",
      "reason": "**取景差异 + 画板样张**：画板帧 2 演示格里那枚是行内 `width:150px; height:24px; font-size:var(--text-meta)`（11px，压过 board.css:738 的 12px）；产品量的是工作室的「皮肤名称」输入（`.pw-input` + inline `width:220`，28 高 / 12px）。字号那 1px 是画板样张自带的覆盖。"
    },
    {
      "sel": ".fork-skin-scrim .pw-ctl",
      "reason": "**取景差异**：画板帧 2 演示格里那枚 `.pw-ctl` 装的是 150px 的名称输入（整体 150）；产品第一枚装的是四色那一行的色块 + 十六进制（整体 61）。"
    },
    {
      "sel": ".fork-skin-scrim .pw-btn",
      "reason": "**取景差异**：画板帧 2 的第一枚 `.pw-btn` 是动作行里的默认档（28 高 / 0 12px / 12px）；产品工作室里第一枚 `.pw-btn` 是内容区的 `.pw-btn.sm`（24 高 / 0 8px / 11px）。"
    }
  ],
  "pairs": [
    [
      ".pw-inline",
      ".fork-skin-scrim .pw-inline"
    ],
    [
      ".pw-scrim",
      ".fork-skin-scrim"
    ],
    [
      ".pw-modal",
      ".fork-skin-scrim > .pw-modal"
    ],
    [
      ".pw-modal-head",
      ".fork-skin-scrim .pw-modal-head"
    ],
    [
      ".pw-iconbtn.sm",
      ".fork-skin-scrim .pw-iconbtn.sm"
    ],
    [
      ".pw-tabs",
      ".fork-skin-scrim .pw-tabs"
    ],
    [
      ".pw-tab",
      ".fork-skin-scrim .pw-tab"
    ],
    [
      ".pw-tab.is-on",
      ".fork-skin-scrim .pw-tab.is-on"
    ],
    [
      ".pw-modal-body",
      ".fork-skin-scrim .pw-modal-body"
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
      ".pw-input",
      ".fork-skin-scrim .pw-input"
    ],
    [
      ".pw-mono",
      ".fork-skin-scrim .pw-mono"
    ],
    [
      ".pw-alert.info",
      ".fork-skin-scrim .pw-alert.info"
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
      ".pw-btn.outline",
      ".fork-skin-scrim .pw-btn.outline"
    ]
  ]
};
