
//
// 跑法：APP_URL=http://127.0.0.1:32141 node scripts/board-diff.mjs scripts/board-specs/4x-47-frame1.mjs
export default {
  "name": "皮肤工作室（画板 47 · 帧 1）",
  "board": "47-skin-studio.html",
  "boardFrame": 1,
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
      "reason": "**用户裁定偏离（fix:skin-preview-left）**：画板 47 帧 1 是「左设置 1fr · 右预览 340px」；产品把预览挪到左列（`gridTemplateColumns:\"340px 1fr\"` + 两块各写 `order`）。见报告"
    },
    {
      "sel": ".fork-skin-scrim .pw-btn.danger",
      "reason": "**状态依赖**：这一帧量的是**新建态**（走「新建皮肤」卡打开，因为「打开皮肤工作室」在没有非默认皮肤时是 disabled —— ThemeSkinStrip.tsx:160），而画板帧 1 画的是编辑态；新建态按画板 47 帧 2 的约定「左下没有删除」。"
    },
    {
      "sel": ".fork-skin-scrim .pw-radio",
      "reason": "**取景差异**：画板帧 1 的第一枚 `.pw-radio` 在 `.pw-modal-head` 里（继承 head 的 13px / 500），产品第一枚在 `.pw-field` 里（12px / 400）。芯片本身两边都是 `.pw-radio > span` vs `.pw-radio > button`、24 高 / 11px。"
    }
  ],
  "pairs": [
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
      ".pw-modal-body",
      ".fork-skin-scrim .pw-modal-body"
    ],
    [
      ".pw-modal-foot",
      ".fork-skin-scrim .pw-modal-foot"
    ],
    [
      ".pw-iconbtn.sm",
      ".fork-skin-scrim .pw-iconbtn.sm"
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
      ".pw-input",
      ".fork-skin-scrim .pw-input"
    ],
    [
      ".pw-radio",
      ".fork-skin-scrim .pw-radio"
    ],
    [
      ".pw-switch",
      ".fork-skin-scrim .pw-switch"
    ],
    [
      ".pw-selectbox",
      ".fork-skin-scrim .pw-selectbox"
    ],
    [
      ".pw-mono",
      ".fork-skin-scrim .pw-mono"
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
    ]
  ]
};
