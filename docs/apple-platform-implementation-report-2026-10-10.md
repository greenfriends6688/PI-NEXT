# PI NEXT Apple 平台化实施报告 · 2026-10-10

## 1. 结果

本轮按 `docs/apple-platform-design-spec-2026-10-10.md` 完成了可落地的平台化基础改造：

- macOS Web、iPad 平板、iPhone PWA 使用同一组平台边界，但保留不同布局语义。
- 运行时组件不再直接读取 `--n-*`、`--ds-*`、`--radius-*` 或 `--nx-r-*`。
- Apple 字体优先级、语义圆角、材质边界和 PWA 触控目标进入自动化门禁。
- Web/PWA 的阴影、玻璃底和控件材质改用 Sketch Kit 生成的
  `--nx-sk-glass-*` / `--nx-sk-c-*` 值，不再保留手写近似值。
- Web 画布使用 macOS `Window Backgrounds`，移动端分组页使用 iOS
  `Backgrounds.Grouped.Primary`。
- 用户消息改成 Apple 系统蓝实心消息气泡，文字、次要信息和代码底走
  材质上的 vibrant/contrast 规则。
- 设置与系统状态使用稳定实底，不再让背后的会话正文穿过弹层。
- MCP 手机列表保留名称、传输方式和启用状态。
- `check:design` 与完整 `npm test` 均通过。

## 2. 平台契约

| Tier | Width | 外壳 | 验证 |
| --- | --- | --- | --- |
| M0 phone | 0-639px | drawer + 单列；复杂控制走 sheet；主要操作 44px | 375 / 390 / 430 |
| M1 tablet | 640-1023px | 可收缩侧栏；右栏 fixed inspector overlay；内容列保持可读 | 768 / 834 |
| M2 desktop | 1024px+ | docked sidebar；主 pane + inspector grid；设置左栏 + 内容列 | 1024 / 1440 |

真实浏览器检查确认所有验收宽度横向溢出为 `0`；字体 computed value 为 Apple-first 栈；
M1 的右栏为 `fixed`，M2 为 `static`。

## 3. Token 迁移

| Legacy | Runtime status | Replacement |
| --- | --- | --- |
| `--n-*` | 0 runtime consumers | `--nx-*` semantic surface/text tokens |
| `--ds-*` | bridge/definition only | transitional legacy alias |
| `--radius-*` | bridge/comment only | `--nx-radius-*` |
| `--nx-r-*` | 0 runtime consumers | `--nx-radius-*` |

Migration table and ownership details live in
`docs/design-system-ownership-audit-2026-10-10.md`.

## 4. Removed or narrowed rules

- Removed the runtime 960/959 split; M1 now ends at 1023 and M2 starts at 1024.
- Removed skin `backdrop-filter` from settings/dialog/popover ancestors.
- Replaced the modal material group's translucent thick fill with opaque
  `var(--nx-panel)`.
- Replaced `.m-top-btn`, `.m-cap-btn`, `.m-send`, `.m-setrow`, `.m-trow` and
  `.m-menu-row` touch geometry with `--nx-touch-min`.
- Replaced runtime radius literals in chat, editor, error and pairing surfaces
  with semantic radius roles or explicit non-theme markers.

## 5. Checks

| Check | Result |
| --- | --- |
| `npm run check:design` | Pass |
| `npm test` | Pass: 3886 tests, 8 skipped, 0 failed |
| `node_modules/.bin/tsc --noEmit` | Pass |
| `npm run prod` | Build and start pass; only existing webpack warning remains |
| Browser matrix 375-1440px | No horizontal overflow |
| PWA touch targets | 44x44 verified for primary icon controls |
| Dark + wallpaper smoke | Content remains readable with stable modal fill |

## 6. Remaining debt

- Historical board copy still mentions the retired `--nx-r-*` names in
  explanatory transcripts. These are documentation, not runtime consumers.
- Some legacy product aliases in `app/globals.css` and
  `app/design/tokens.css` remain as a compatibility bridge.
- Older panels still keep inline non-theme content dimensions where those
  dimensions are data-driven; they are now explicitly registered instead of
  being treated as theme geometry.

No business API, session format, permission model or agent lifecycle was
changed by this design-system batch.
