# design/apple —— Apple 官方 UI Kit 的抽取结果

本目录只放**从 Apple 官方 Sketch UI Kit 抽出来的机器可读规范**，是 v5 令牌的数值来源。
两份 `.sketch` 原件（合计 ~270MB）**不入库**，见根目录 `.gitignore`。

```
design/apple/
  README.md          ← 本文件
  sketch/macos.json  ← 来自 `Apple macOS 27 UI Kit.sketch`（→ Web 形态）
  sketch/ios.json    ← 来自 `Apple iOS 27 UI Kit.sketch`（→ PWA 形态）
```

## 怎么重跑

1. 把两份原件放回 `design/`：

   ```
   design/Apple macOS 27 UI Kit.sketch
   design/Apple iOS 27 UI Kit.sketch
   ```

2. 抽取 → 生成令牌：

   ```bash
   npm run sketch:build          # = sketch:extract && sketch:tokens
   npm run sketch:extract -- --list   # 只列页与画板，不写文件
   ```

产物：

| 产物 | 说明 |
|---|---|
| `design/apple/sketch/*.json` | 抽出的色板 / 具名字体样式 / 共享样式（可 diff、可对拍） |
| `design/v5/sketch-macos.css` | `--nx-sk-*` 数值层（Web） |
| `design/v5/sketch-ios.css` | `--nx-sk-*` 数值层（PWA） |

两份 CSS 都**只定义 `--nx-sk-*`**，由 `design/v5/web/tokens.css` 与 `pwa/tokens.css`
的角色层指向它们 —— 生成物重跑不会覆盖手写的角色决策。

## 注意

- 生成物**不要手改**：改了下一次重跑就没了。要改角色绑定，改 `web/tokens.css` / `pwa/tokens.css`。
- `design/v5/scripts/check-v5.mjs` 会把这两份 CSS 算进令牌定义表，所以 `var(--nx-sk-…)`
  不会被判成「未定义令牌」。
- 与 kit 的**有意偏离**登记在 `design/v5/DIVERGENCE.md`（如 §AB 顶栏内阴影）。
