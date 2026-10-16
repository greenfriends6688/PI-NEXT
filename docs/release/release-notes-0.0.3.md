# PI NEXT v0.0.3

这一版重做了工作区：**文件树从「面板里的退路」变成与文档并排的右侧树列**，**内置浏览器面板正式上线**，
**浅色主题从暖沙回退到纯白**。

## 新增

- **内置浏览器面板**：顶栏地球图标新建浏览器标签，面板内有地址栏（裸域名自动补 https、
  本机地址补 http）、前进 / 后退、刷新与「在新窗口打开」；与终端标签同构，切换标签不重载。
- **查看器两个按钮**：一个是真全屏，一个是在栏内展开（把文件树的空间让给文档），两者互不干扰。
- **树头显示目录名**：文件树头部显示当前列出的目录名，鼠标悬停给出完整路径。

## 改动

- **浅色回到纯白**：上一版的暖沙底实际观感是脏底，现已回退为纯白，配中性灰交互层；
  mist 与 rose 仍保留极淡色偏，但只在主动选择该调色板时生效。
- **文件树可与文档并存**：布局变成会话侧栏、聊天、文档、文件树四栏，聊天不再被挪走；
  面板窄于 760px 时树列自动隐藏。
- **侧栏行距**：行高与胶囊内缩重新调整，相邻行不再贴在一起，项目标题与第一条会话也分开了。
- **打开文件不再撑开副区**：面板过窄时才一次性加宽到视口 58% 与 1020px 中的较小者。
- **文本编辑放开**：可编辑判断从白名单改成黑名单——归档、二进制、图片、音视频与 office 文档不可编辑，
  其余（含未知扩展名）都能按文本编辑。

## 修复

- **预览一片空白**：Markdown 预览依赖的编辑器是懒加载的，加载失败会永久白屏且不报错
  （典型场景是服务重建后旧页面去请求已被替换的文件）；现补了加载骨架与错误边界，
  失败时回退到静态预览并给出「重新加载」。
- **失败伪装成空目录**：文件树原来把「响应里没有文件列表」也当成空目录，误报「未找到文件」；
  现在会直接报出真实原因。
- **编辑器静默变只读**：回退视图现在会明说并给一键重载。
- **空态下开关点不到**：工作区边界的开关在空态时被聊天区元素盖住，已提到不重叠的层级。

## 已知

- 内置浏览器的能力边界：纯 Web 只能用 iframe，声明 X-Frame-Options 或 frame-ancestors 的站点
  会白屏无法内嵌，面板内已提示并给出口；本地服务（开发服务器与本机地址）可靠。
- 源码包见本页下方 Assets，只含受版本控制的源码；装完先装依赖再起生产模式，默认端口 30141。
- 单测有 4 条既有环境性插件用例失败，与本版无关；桌面与手机两轮端到端用例全通过，
  另做了一轮覆盖式人工巡检，控制台无报错。

---

## English

This release reworks the workspace: **the file tree goes from "a fallback inside the panel" to a right-side tree column alongside the document**, **the built-in browser panel officially launches**, and **the light theme reverts from warm sand to pure white**.

### Added

- **Built-in browser panel**: The globe icon in the top bar creates a new browser tab; the panel has an address bar (bare domains automatically get https, local addresses get http), forward/back, refresh and "Open in new window"; it is built the same way as terminal tabs, and switching tabs does not reload.
- **Two viewer buttons**: One is true fullscreen, and one expands within the column (giving the file tree's space to the document); the two do not interfere with each other.
- **Tree header shows the directory name**: The file tree header shows the name of the currently listed directory, with the full path on hover.

### Changed

- **Light theme back to pure white**: The warm-sand background of the previous release actually looked dirty; it has now reverted to pure white with neutral gray interaction layers; mist and rose still keep a very faint color cast, but only when that palette is actively selected.
- **File tree can coexist with documents**: The layout becomes four columns—session sidebar, chat, document, file tree—and chat is no longer moved away; when the panel is narrower than 760px the tree column automatically hides.
- **Sidebar line spacing**: Row height and pill inset are readjusted, adjacent rows no longer stick together, and the project title is separated from the first session.
- **Opening a file no longer expands the secondary area**: Only when the panel is too narrow does it widen once to the smaller of 58% of the viewport and 1020px.
- **Text editing opened up**: The editability check changes from a whitelist to a blacklist—archived, binary, image, audio/video and office documents are not editable, and everything else (including unknown extensions) can be edited as text.

### Fixed

- **Preview completely blank**: The editor that the Markdown preview depends on is lazy-loaded, and a load failure left a permanent white screen with no error (the typical scenario is an old page requesting files that have been replaced after a service rebuild); a loading skeleton and error boundary are now added, falling back to a static preview with "Reload" on failure.
- **Failure disguised as an empty directory**: The file tree used to treat "no file list in the response" as an empty directory too, falsely reporting "No files found"; now it reports the real reason directly.
- **Editor silently becomes read-only**: The fallback view now states it explicitly and offers one-click reload.
- **Toggle unclickable in the empty state**: The workspace boundary toggle was covered by chat area elements in the empty state; it has been raised to a non-overlapping layer.

### Known

- The capability boundary of the built-in browser: pure web can only use an iframe, and sites that declare X-Frame-Options or frame-ancestors will white-screen and cannot be embedded; the panel already shows a notice and gives a way out; local services (dev servers and local addresses) are reliable.
- See Assets at the bottom of this page for the source package, which contains only version-controlled source; after installing, install dependencies first and then start production mode, default port 30141.
- Unit tests have 4 pre-existing environment-related plugin test failures, unrelated to this release; both rounds of end-to-end tests on desktop and mobile pass fully, and an additional exhaustive round of manual inspection found no console errors.
