
//
// 跑法：APP_URL=http://127.0.0.1:32141 node scripts/board-diff.mjs scripts/board-specs/62-frame3.mjs
export default {
  "name": "设置新框架 · 空态三态（画板 62 · 帧 3）",
  "board": "62-settings-layout.html",
  "boardFrame": 3,
  "app": {
    // 原驱动是 `settings:prompts`（自定义命令一节已下线），换成一个同样会出
    // 空态的全局页：归档历史。比对的选择器全是通用空态基件（.pw-empty*），与分节无关。
    "open": "settings:archived"
  },
  "tolerance": {
    "box": 2,
    "fontSize": 0
  },
  "knownDiffs": [
    {
      "sel": ".settings-dialog-surface .pw-hint",
      "reason": "**接线差异**：画板空态下面那两段是**画板说明文字**（解释为什么这么排），不是产品 UI；不参与判定"
    }
  ],
  "pairs": [
    [
      ".pw-empty",
      ".settings-dialog-surface .pw-empty"
    ],
    [
      ".pw-empty-inner",
      ".settings-dialog-surface .pw-empty-inner"
    ],
    [
      ".pw-empty-inner .mark",
      ".settings-dialog-surface .pw-empty-inner .mark"
    ],
    [
      ".pw-empty-inner > p",
      ".settings-dialog-surface .pw-empty-inner > p"
    ],
    [
      ".pw-hint",
      ".settings-dialog-surface .pw-hint"
    ]
  ]
};
