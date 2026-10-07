# PI NEXT v0.1.3

上一轮只改了行高、圆角这类度量，用户实测判定「没做到位」——复盘结论是：真正决定「一眼不同」的是材质，
不是度量。这一版直接换材质本体：**6 套色板全部重打成中性灰 + 平面材质**，圆角、阴影、字号、
侧栏与输入区一并重做。

## 改动

- **六套色板重打**：暖褐黑换成中性石墨，正文前景换成近纯白，次要文字改实色灰。
  交互层从半透明叠层改成实色——同一个「6% 悬停」过去在画布、侧栏、浮层三种底上各算出一种灰，
  看着像三种颜色，现在一种意图一个灰值；另外三套色板（mist / rose / pine）保留各自色相，同样改成实色面。
- **代码块后退**：代码底色从「比画布更亮」改成「比画布更暗」，代码不再浮在正文上面。
- **圆角收缩**：七档圆角收成 6 / 10 / 12 三档，输入框从「胶囊」变成「面板」。
- **阴影变薄**：四级暖黑堆叠压成单层，只剩一道发丝线，输入卡完全无阴影，焦点改用一圈光环。
- **正文放大**：全局界面与聊天正文默认从 13px 提到 14px，仍可在设置里调整。
- **侧栏变密**：行高收到 32px 通栏（去掉内缩胶囊与行间隙），品牌字放大到 18px，默认宽度从 244px 加到 272px；
  分区标题加重，动作组悬停才显，过长的标题末端渐隐。
- **空态不再有顶栏**：没有消息时不渲染顶栏，主视觉标从 40px 放大到 48px，标题也放大加粗。
- **输入区两段式**：项目条与输入卡焊成一体，项目标签去掉描边，发送键缩小，并去掉右侧那块不对称的内边距。
- **消息行收敛**：用户气泡改实色无边框；操作行默认隐藏，悬停或聚焦才出现（触屏上常显）；助手行距放宽到 26px。
- **顶栏瘦身**：桌面的「回滚历史 / 生成标题」收进 ⋯ 菜单，只剩标题、分支、⋯ 与会话信息。
- **设置分节卡片化**：分区改成带发丝描边的卡片，搜索框从 28px 方框换成 36px 胶囊。
- **运行中的工具行有扫光**：正在跑的那一行会有一道光扫过；系统开启「减少动态效果」时改为静态实色。

## 修复

- **样式令牌审计一直报红**：审计脚本漏读了一个样式文件，而新令牌都放在那里，导致任何新加的自造令牌
  都被误报「未定义」。
- **主题校验口径不对**：过去按字面文本比对颜色，而构建链会把一种颜色写法重写成另一种，于是「期望值」和
  「实际值」永远不相等；现在改成在画布上取实际像素比对，与写法无关。

## 已知

- 本版是**源码发布，没有桌面安装包**；要装桌面版需自行打包。
- 有意保留的差异：侧栏的「三入口 + 徽标」结构、设置的整页路由、项目的整页管理都按本产品原样保留，未照搬别家。
- 仍不引入第三方组件库与现成 UI 套件，界面元素全部自绘。

---

## English

The previous round only changed metrics such as line height and corner radius, and user testing judged it "not good enough" — the retrospective conclusion: what truly determines "looking different at a glance" is the material, not the metrics. This version swaps out the material itself: **all 6 palettes are recast into neutral gray + flat material**, and the corner radius, shadows, font sizes, sidebar and input area are all redone along with it.

### Changed

- **All six palettes recast**: warm brown-black is replaced with neutral graphite, the body foreground with near-pure white, and secondary text with solid gray. The interactive layer moves from translucent overlays to solid color — the same "6% hover" used to compute a different gray on each of the canvas, sidebar, and popover backgrounds, looking like three different colors; now one intent maps to one gray value. The other three palettes (mist / rose / pine) keep their own hues and are likewise changed to solid surfaces.
- **Code blocks step back**: the code background changes from "brighter than the canvas" to "darker than the canvas", so code no longer floats above the body text.
- **Corner radius tightened**: seven radius steps are reduced to three: 6 / 10 / 12, and the input box goes from a "capsule" to a "panel".
- **Shadows thinned**: the four-level warm-black stack is compressed into a single layer, leaving only a hairline; the input card has no shadow at all, and focus uses a ring of light instead.
- **Body text enlarged**: the global UI and chat body text default from 13px to 14px, still adjustable in settings.
- **Sidebar densified**: the row height tightens to a full-width 32px (removing the inset capsule and row gaps), the brand text is enlarged to 18px, and the default width increases from 244px to 272px; section titles are heavier, action groups appear only on hover, and overlong titles fade out at the end.
- **No top bar in the empty state**: the top bar is not rendered when there are no messages, the main visual mark is enlarged from 40px to 48px, and the title is enlarged and bolded too.
- **Input area as two segments**: the project bar and the input card are welded into one, the project tag loses its outline, the send key is made smaller, and the asymmetric padding on the right side is removed.
- **Message rows tightened**: user bubbles become solid with no border; the action row is hidden by default and appears only on hover or focus (always visible on touch); assistant line spacing widens to 26px.
- **Top bar slimmed down**: the desktop "rollback history / generate title" items move into the ⋯ menu, leaving only the title, branch, ⋯ and session info.
- **Settings sectioned into cards**: sections become cards with hairline outlines, and the search box changes from a 28px box to a 36px capsule.
- **Running tool rows have a sheen**: the row that is running gets a light swept across it; when the system enables "reduce motion" it becomes a static solid color.

### Fixed

- **The style token audit was always red**: the audit script missed reading one style file, and the new tokens all lived there, so any newly added custom token was falsely reported as "undefined".
- **Theme validation used the wrong measure**: it used to compare colors by literal text, while the build chain rewrites one color notation into another, so the "expected value" and "actual value" never matched; now it samples the actual pixels on the canvas to compare, independent of notation.

### Known

- This version is a **source release with no desktop installer package**; to install the desktop version you need to package it yourself.
- Intentionally retained differences: the sidebar's "three entries + badge" structure, the full-page routing for settings, and the full-page project management are kept as they are in this product, not copied from others.
- Third-party component libraries and ready-made UI kits are still not introduced; all interface elements are custom-drawn.
