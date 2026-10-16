# PI NEXT v0.0.2

这一版收了六个上游改进：**运行时能看到推理级别**、**输入区上方多一个「滚动到最新」**、
**输出被截断时明确告诉你**。另外按使用反馈把**浅色主题改回纯白**。

## 新增

- **运行中推理级别**：agent 跑起来时，输入框上方出现只读的推理级别；运行中不可改，所以没做成按钮。
- **滚动到最新**：向上翻阅历史时，输入框上方出现一个圆形向下箭头，一点回到最新。
- **加载更早**：鼠标移到右侧会话缩略图上，预览框顶部多出「加载更早」。
- **输出截断提示**：模型输出被上限截断时，消息下方会出现一条提示，不用再猜为什么话没说完。
- **扩展字号设置**：设置里新增扩展 widget 字号一档。

## 改动

- **浅色主题纯白**：上一版的暖沙底实际观感是脏底而不是温暖，本版改为无彩度：底色纯白，
  面板约为浅灰，文字、悬停与描边一律中性灰。mist 与 rose 仍保留极淡色偏——
  它们是主动选择的调色板，不是默认底。

## 修复

- **选区工具栏被挡**：在文件里选中文字弹出的浮动工具栏原来会被会话侧栏盖住，现在不再遮挡。

## 已知

- 两个上游改动本版暂缓：文件面板的全宽开关与 PDF 页码锚点，分别与已改造的布局结构、查看器标签状态重叠，
  硬合会破坏已验证的部分，已转入手工嫁接队列。
- 源码包见本页下方 Assets，只含受版本控制的源码；装完先装依赖再起生产模式，默认端口 30141。
- 单测有 4 条既有环境性插件用例失败，与本版无关；桌面与手机两轮端到端用例全通过，
  覆盖分页、分支、markdown、代码与工具卡、会话压缩导航，以及扩展弹窗的键盘与超时、聊天外观的持久化；
  类型检查干净，五套主题做了真实浏览器渲染核对。

---

## English

This release takes in six upstream improvements: **you can see the reasoning level at runtime**, **the input area gains a "Scroll to latest" above it**, and **explicit notice when output is truncated**. Also, per user feedback, the **light theme is changed back to pure white**.

### Added

- **Reasoning level while running**: When the agent is running, a read-only reasoning level appears above the input box; it cannot be changed while running, so it was not made into a button.
- **Scroll to latest**: When scrolling up through history, a circular down arrow appears above the input box; one click returns to the latest.
- **Load earlier**: Hovering over the session thumbnail on the right adds "Load earlier" at the top of the preview box.
- **Output truncation notice**: When model output is truncated by the limit, a note appears below the message, so you no longer have to guess why the sentence was cut off.
- **Extension font size setting**: A new extension widget font-size tier is added in settings.

### Changed

- **Light theme pure white**: The warm-sand background of the previous release actually looked dirty rather than warm; this release changes it to achromatic: the background is pure white, panels are roughly light gray, and text, hover and borders are all neutral gray. mist and rose still keep a very faint color cast—they are deliberately chosen palettes, not the default background.

### Fixed

- **Selection toolbar obscured**: The floating toolbar that pops up when selecting text in a file used to be covered by the session sidebar; it is no longer obscured.

### Known

- Two upstream changes are deferred in this release: the full-width toggle for the file panel and the PDF page-number anchors, which overlap with the reworked layout structure and the viewer tab state respectively; forcing them in would break already-verified parts, so they have moved to the manual grafting queue.
- See Assets at the bottom of this page for the source package, which contains only version-controlled source; after installing, install dependencies first and then start production mode, default port 30141.
- Unit tests have 4 pre-existing environment-related plugin test failures, unrelated to this release; both rounds of end-to-end tests on desktop and mobile pass fully, covering pagination, branching, markdown, code and tool cards, session compaction navigation, as well as keyboard and timeout for extension dialogs and persistence of chat appearance; type checking is clean, and five themes were verified with real browser rendering.
