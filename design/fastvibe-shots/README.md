# 与 FastVibe 对照的截图

`npm run fastvibe:shots` 的产物。**这是 H6 起的新验收依据** ——
旧的「产品 vs 本仓画板」对位（`verify:boards`）已按用户 2026-10-13 的裁定停用，
真值换成 `fastvibe-main` 的源实现。

## 怎么用

```bash
npm run build          # 需要生产构建（脚本会检查 .next/BUILD_ID）
npm run fastvibe:shots # 全部视图
npm run fastvibe:shots -- --only chat    # 只截某一个
```

脚本会自己起一个 `next start`（端口 32741），用一份**临时 agent 目录**
（`PI_CODING_AGENT_DIR`，不碰你的真实数据）种出一条有思考 / 工具调用 / 富文本
正文的会话，然后按固定视口截图到本目录。

## 对照怎么做

截完之后，打开 FastVibe 对应源文件逐项对：

| 截图 | FastVibe 参考 |
| --- | --- |
| `chat-*.png` | `src/renderer/src/components/chat/message-list.tsx`、`message-row.tsx`、`composer.tsx` |
| `sidebar-*.png` | `src/renderer/src/components/layout/sidebar.tsx`、`sidebar-rows.tsx` |
| `settings-*.png` | `src/renderer/src/components/settings/settings-dialog.tsx` |
| `composer-*.png` | `src/renderer/src/components/chat/composer.tsx` |
| `right-panels-*.png` | `src/renderer/src/components/layout/side-pane*.tsx` |

脚本跑完也会把这张对照表打印出来，不用回来翻。

## 为什么不自动判「像不像」

两个项目技术栈不同（Electron + Vite + Tailwind vs Next.js + 自研 CSS 层），
像素 diff 必然满屏差异，做成门禁只会变成噪音 —— 一个永远红着、人人点忽略的
检查比没有检查更糟。所以这里只保证**截图本身稳定可复现**（固定视口、
固定种子数据、等 hydration 完成再截），比对动作由人做。

## 尺寸

- `1440x900` —— 桌面，与 FastVibe 的开发窗口同档
- `390x844` —— 窄屏，iPhone 14 逻辑尺寸，与它 Flutter 端的目标机型同档

`deviceScaleFactor: 2`，所以文件是 2 倍图，放大看细节不用重新截。
