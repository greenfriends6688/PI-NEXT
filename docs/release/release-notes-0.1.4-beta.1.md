# PI NEXT v0.1.4-beta.1

这一版把整套设计系统落地：12 个通用组件、聊天页接上思考指示器与忙碌光环、
排版与滚动渐隐统一，并修掉流式追加导致旧内容重排这类真缺陷。零新依赖。

## 新增

- **通用组件一套**：思考指示器（四种形态 + 流光 + 已用时计时器）、输入框忙碌光环
  （三层光带沿边缘绕行）、逐行 / 逐块揭示、应用级 toast（队列、动作按钮、悬停暂停倒计时），
  以及按键标签、分隔线、徽章、芯片、状态点、头像与空态 / 骨架 / 加载三件套。
- **聊天页接上新组件**：阶段行换成思考指示器；输入框在流式输出时外壳背景透明，
  忙碌光环不再被底色盖住；「正在跑命令」显示流光文字；新回答块淡入，已在屏幕上的块不重播。
- **排版与滚动渐隐**：字号 / 行高 / 段流三档可调，并约定流式追加时不重排旧内容；
  渐隐用遮罩 + 滚动驱动动画，不跑脚本，到底还会自动收紧。
- **加载与错误状态**：会话列表加载显示骨架行，出错时给出带「重试」的空态；
  文件查看器加载也有骨架行；导出 Markdown 会弹成功提示。

## 改动

- **动效按需搬运**：只保留流光、暗色阴影、表格与勾选绘制，以及思考指示器和忙碌光环的动画；
  底色、移动端输入框字号与视图过渡复位一概不动，避免与现有外壳冲突。

## 修复

- **流式追加时旧内容重排**：新段落或新行到达时，上一段会突然长出下边距、上一行底边线消失，
  原因是给末元素留的清零规则，现已去掉。
- **暗色跟着系统走而不是跟着应用走**：组件里的暗色写法此前跟随操作系统主题，而不是应用自身的主题切换。
- **设计令牌门禁一直误报**：注释里的变量引用、Tailwind 自带色板、动态拼出的名字都被当成缺失令牌，
  现已逐类排除，门禁恢复为绿。

## 已知

- 本包是**源码包**，桌面安装包（DMG / exe）不在本次发布里。
- 更新检查只认稳定版，所以这个 beta 不会推给 0.1.4 用户。
- 仓库里有 5 个测试失败不是本次改动引入的（3 个在改动前的基线上同样失败，2 个是环境性用例）。

---

## English

This version lands the entire design system: 12 generic components, the chat page wired up to the thinking indicator and busy halo, unified typography and scroll fade, and fixes for real defects such as streaming appends causing old content to reflow. Zero new dependencies.

### Added

- **A set of generic components**: a thinking indicator (four forms + shimmer + elapsed-time timer), an input-box busy halo (three bands of light orbiting along the edge), line-by-line / block-by-block reveal, an app-level toast (queue, action buttons, hover-to-pause countdown), plus key labels, dividers, badges, chips, status dots, avatars, and the empty-state / skeleton / loading trio.
- **Chat page wired up to the new components**: the phase row is replaced with the thinking indicator; during streaming output the input box shell background is transparent, so the busy halo is no longer covered by the base color; "running a command" shows shimmering text; new answer blocks fade in, and blocks already on screen do not replay.
- **Typography and scroll fade**: font size / line height / paragraph flow are adjustable in three tiers, and it is agreed that old content is not reflowed during streaming appends; the fade uses a mask + scroll-driven animation with no script running, and tightens automatically at the end.
- **Loading and error states**: the session list shows skeleton rows while loading, and shows an empty state with a "Retry" button on error; the file viewer also has skeleton rows while loading; exporting Markdown shows a success prompt.

### Changed

- **Animations carried over only as needed**: only the shimmer, dark shadows, table and checkbox drawing, and the thinking indicator and busy halo animations are kept; the base color, mobile input-box font size, and view transition resets are left untouched, avoiding conflicts with the existing shell.

### Fixed

- **Old content reflows during streaming appends**: when a new paragraph or new line arrives, the previous paragraph suddenly grows a bottom margin and the previous line's bottom border disappears; the cause was a reset rule left for the last element, which has now been removed.
- **Dark mode follows the system instead of the app**: the dark-mode styles in components previously followed the operating system theme rather than the app's own theme switch.
- **The design token gate kept giving false positives**: variable references in comments, Tailwind's built-in palette, and dynamically assembled names were all treated as missing tokens; each category has now been excluded, and the gate is green again.

### Known

- This package is a **source package**; the desktop installer package (DMG / exe) is not part of this release.
- The update check only recognizes stable versions, so this beta will not be pushed to 0.1.4 users.
- The 5 failing tests in the repository were not introduced by this change (3 also fail on the pre-change baseline, and 2 are environment-dependent cases).
