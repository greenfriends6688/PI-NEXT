# PI NEXT v0.0.6

这一版是布局与壁纸的一轮大扫：对话区列宽、消息对齐、设置导航、手机上的对话框形态都重新定过，
**壁纸从「设了不生效」变成真的能用**，**两处卡顿被量出来并解决**。

## 新增

- **新会话空态首页**：徽标 + 当前目录标题 + 一行 4 张起始卡（点击只把内容填进输入框），
  输入区改为底部固定。
- **手机对话框改底部抽屉**：键盘弹出时布局相应切换。
- **壁纸面板透出总旋钮**：遮罩滑杆同时控制面板的透出程度，不必逐处调。
- **文件树「变更」按钮**：工具栏并成一排，无改动时常驻显示。

## 改动

- **正文列宽**：860 → 800，消息右对齐并限宽（桌面 70% / 620px，手机 92%），
  消息下方的两行操作区改为常显保留。
- **设置改左列导航**：竖向分栏，分区标签不再被定宽截断。
- **顶栏收纳**：「系统提示词 / 工具定义」收进 ⋯ 菜单，顶部三个边界按钮改为垂直居中；
  侧栏略加宽，页脚图标化，标签栏加高，关闭键改为悬停显现。
- **壁纸三档真正生效**：「透明」是真透明（面板不再自建表面），「毛玻璃」是半透明加模糊；
  聊天、输入框、面板可各自单独选。
- **接口与首屏提速**：一个接口原先要 3.7 秒、返回 3.6MB，现在冷启 0.16 秒、命中缓存 0.007 秒；
  首屏从 3.6 秒降到 0.75–0.95 秒。
- **壁纸省流量**：壁纸关闭时不再去下载内置画作。

## 修复

- **壁纸设了不生效**：外壳与聊天列画着不透明底色，图片被压在下面。
- **补齐四处漏掉的实心面**：顶栏包装层、文件树、缩略图预览、设置弹窗，壁纸下这些地方不再露白。
- **文件树宽度自己回弹**：拖拽加宽时会越过响应式上限再弹回，现已夹在上限内。
- **并排树与放大按钮**：文档区的并排文件树与「放大显示区域」按钮失效，一并恢复。
- **放大不再抢整屏**：去掉会触发全屏的按钮，改为栏内展开。
- **推理块少一层折叠**：去掉多余的「展开全文」第二层。
- **报错里的链接可点**：供应商报错里给出的链接（如 opt-in 地址）现在可以直接点开；
  输入框里那个点不动的上下文圆环也已去掉。

---

## English

This release is a big sweep of layout and wallpaper: the conversation column width, message alignment, settings navigation, and the dialog form on mobile have all been redefined, **wallpaper went from "set but not working" to actually usable**, and **two stutters were measured and fixed**.

### Added

- **New session empty-state home page**: logo + current directory title + a row of 4 starter cards (clicking only fills the content into the input box), and the input area is now fixed at the bottom.
- **Mobile dialog changed to a bottom drawer**: the layout switches accordingly when the keyboard pops up.
- **Wallpaper panel reveal master knob**: the overlay slider also controls how much the panel shows through, so you don't have to adjust it in each place.
- **File tree "Changes" button**: the toolbar merges into one row and is always displayed when there are no changes.

### Changed

- **Body column width**: 860 → 800, messages are right-aligned and width-limited (desktop 70% / 620px, mobile 92%), and the two-row action area below messages is now always visible.
- **Settings changed to left-column navigation**: vertical column layout, and section labels are no longer truncated by a fixed width.
- **Top bar consolidation**: "System prompt / Tool definitions" moved into the ⋯ menu, and the three boundary buttons at the top are now vertically centered; the sidebar is slightly wider, the footer is icon-based, the tab bar is taller, and the close button now appears on hover.
- **Wallpaper's three levels truly work now**: "Transparent" is truly transparent (the panel no longer builds its own surface), and "Frosted glass" is semi-transparent plus blur; chat, input box, and panel can each be selected separately.
- **API and first-screen speedup**: one endpoint used to take 3.7 seconds and return 3.6MB; now it is 0.16 seconds cold and 0.007 seconds on a cache hit; the first screen drops from 3.6 seconds to 0.75–0.95 seconds.
- **Wallpaper saves bandwidth**: when wallpaper is off, the built-in artwork is no longer downloaded.

### Fixed

- **Wallpaper set but not working**: the shell and chat column painted an opaque background color, pressing the image underneath.
- **Filled in four missed solid surfaces**: the top bar wrapper layer, file tree, thumbnail preview, and settings dialog; under wallpaper these places no longer show white.
- **File tree width bouncing back on its own**: dragging to widen it would exceed the responsive upper limit and then bounce back; it is now clamped within the limit.
- **Side-by-side tree and enlarge button**: the side-by-side file tree in the document area and the "Enlarge display area" button had stopped working; both are restored.
- **Enlarging no longer takes over the whole screen**: the button that triggered fullscreen was removed, changed to expanding within the column.
- **Reasoning block has one less fold layer**: the redundant second-level "Expand full text" was removed.
- **Links in errors are clickable**: links given in provider errors (such as the opt-in address) can now be opened directly; the unclickable context ring in the input box has also been removed.
