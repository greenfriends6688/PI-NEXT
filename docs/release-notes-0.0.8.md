# PI NEXT v0.0.8

这是 macOS 桌面包的第二轮修复，三条都来自真实使用反馈：**打包版里左右两个工作区开关点不动**、
**通知冒出来两条**、**过程显示改了设置要等这一轮结束才生效**。
上一轮的文件树、预览和首屏体积修复也一并留在包里。

## 新增

- **桌面版原生能力**：原生通知、Dock 角标、窗口位置与大小记忆，以及防息屏。
- **品牌**：应用名称统一为 PI NEXT，侧栏品牌挪到红绿灯右侧。

## 改动

- **首屏体积**：打包后首屏 JS 从 3128KB 降到 2384KB，语法高亮移出首屏按需加载。
- **文件树出现条件**：面板宽到一定阈值即显示树列，落在中间那一段时树列固定 200px 宽，
  不会再出现「打开了文件、树却没了」。

## 修复

- **打包版开关点不动**：顶栏左右两个工作区开关压在顶栏上，而拖拽区会先做命中判定并只对被显式
  标记的元素挖洞，压在上面的兄弟节点不在挖洞范围内——浏览器里测不出来。现改成结构性修法：
  顶栏本身不再是拖拽区，改为顶栏内一条左右各内缩 28px 的拖拽条，三个边界开关正好各占首末 28px，
  两者几何上零相交，四种面板状态下实测相交数为 0。
- **通知冒出来两条**：桌面版里曾经同时出现一条原生通知和一条浏览器通知（带本机地址、浏览器图标
  和「设置」按钮）。现已在桌面环境下只保留原生通知；浏览器版行为不变。
- **过程显示切换不实时**：流式中的消息一直走平铺渲染，设置改了要等本轮结束才生效；
  现在流式消息也按过程 / 回答切分，过程部分实时走分组渲染，实测流式进行到约 5 秒时已是时间线视图。
- **过程信息太少**：收起态的推理行原本只有「推理」两个字，现在带模型原话的首行预览；
  标签页模式在流式时自动展示最新一步内容，不再空等点击。
- **Markdown 文件默认进预览**：手动切到源码视图后不会再被拽回预览。
- **记忆插件提示反复弹**：同一段提示文在 10 分钟窗口内只弹一次，不再每次切会话都来一遍。

## 已知

- 下载随本页发布的 arm64 安装包，拖进「应用程序」；**仅 Apple Silicon（arm64）**。
- 应用为 ad-hoc 签名、未公证，**首次打开请右键 →「打开」**。
- 源码包随本页 Assets 发布。

---

## English

This is the second round of fixes for the macOS desktop package, all three from real usage feedback: **in the packaged build the left and right workspace toggles can't be clicked**, **two notifications pop up**, and **changing the process display setting only takes effect after the current turn ends**. The file tree, preview, and first-screen size fixes from the previous round are also kept in the package.

### Added

- **Desktop native capabilities**: native notifications, Dock badge, window position and size memory, and screen-sleep prevention.
- **Branding**: the app name is unified as PI NEXT, and the sidebar brand is moved to the right of the traffic lights.

### Changed

- **First-screen size**: after packaging, the first-screen JS dropped from 3128KB to 2384KB, and syntax highlighting is moved out of the first screen and loaded on demand.
- **File tree appearance condition**: once the panel is wider than a certain threshold the tree column shows; while in the middle range the tree column is fixed at 200px wide, so "opened a file but the tree is gone" no longer happens.

### Fixed

- **Toggles unclickable in the packaged build**: the left and right workspace toggles in the top bar were layered on top of the top bar, while the drag region performs hit testing first and only punches holes for explicitly marked elements—sibling nodes layered above it were not within the hole-punching range—so it couldn't be reproduced in the browser. Now fixed structurally: the top bar itself is no longer a drag region; instead there is a drag strip inside the top bar inset 28px on each side, and the three boundary toggles exactly occupy the first and last 28px each, so the two have zero geometric intersection, with a measured intersection count of 0 across all four panel states.
- **Two notifications pop up**: in the desktop build a native notification and a browser notification (with the local address, browser icon, and a "Settings" button) used to appear at the same time. Now only the native notification is kept in the desktop environment; the browser version's behavior is unchanged.
- **Process display toggle not real-time**: streaming messages always used flat rendering, so a settings change only took effect after the current turn ended; now streaming messages are also split into process / answer, and the process part uses grouped rendering in real time, with testing showing that at about 5 seconds into streaming it is already the timeline view.
- **Too little process information**: the collapsed reasoning row used to only say "Reasoning"; now it carries a first-line preview of the model's actual words; in tab mode, during streaming it automatically shows the latest step's content instead of waiting for a click.
- **Markdown files default to preview**: after manually switching to the source view, it is no longer dragged back to preview.
- **Memory plugin prompt repeatedly popping up**: the same prompt text now pops up only once within a 10-minute window, and no longer appears every time you switch sessions.

### Known

- Download the arm64 installer published with this page and drag it into "Applications"; **Apple Silicon (arm64) only**.
- The app is ad-hoc signed and not notarized; **on first open, right-click → "Open"**.
- The source package is published under Assets on this page.
