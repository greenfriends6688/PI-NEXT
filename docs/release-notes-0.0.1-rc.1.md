# PI NEXT v0.0.1-rc.1

首个可安装版本。这一版把上游一批改进收进主线，同时按使用反馈把**动效层与玻璃层整体回滚**——
界面从「半透明 + 一堆动画」回到利落的不透明面板，滚动和悬停也更跟手。

## 新增

- **文件选区引用**：在文件里选中一段文本会弹出工具栏，可把选区引用进当前输入框，或带去新会话提问
  （选区会展开成文件提及）；文本查看器与文档预览里都能用。
- **自动压缩命令**：新增「/auto-compact」斜杠命令。
- **顶栏消息数**：顶栏显示当前会话的消息条数。
- **提及变更文件**：变更文件行新增「提及」按钮，长路径在中间省略。
- **发送前看图**：输入区可以预览待发送的图片。
- **模型来源图标**：模型来源在界面里各配一个图标；扩展自己注册的来源也会出现在设置与鉴权里。
- **补丁分栏差异**：补丁类工具的改动渲染成左右分栏的差异视图。
- **折叠也能看图**：工具卡折叠时仍显示结果图片；流式更新时工具块保持展开。

## 改动

- **动效整体回滚**：移除入场动画、闪烁光标、阶段点与全局按压过渡；焦点环、键盘可达性与
  「减少动态效果」兜底保留。
- **玻璃层整体回滚**：去掉全部背景模糊与玻璃浮层，浮层恢复不透明底色。
- **悬停才出按钮**：列表回到逐行悬停才显示重命名与删除；代价是删掉一行后，
  光标下的下一行不再自动浮出这两个按钮。
- **插件卡片顺序**：扩展 widget 更新时保持原有顺序。
- **扩展弹窗**：弹窗标题支持代码围栏，扩展对话框可以停靠到底部。

## 修复

- **首段重复**：流式的第一个字符块曾被渲染两次。
- **关机残留**：关闭时收掉事件流，不再留下僵尸进程与 502。
- **工具密集会话**：长上下文窗口改为只按可见消息计数，工具调用多的会话不再把用户消息饿死。
- **大文件上传**：加大请求体缓冲，超过 10MB 的上传不再报 500。
- **断网仍可用**：断网时改用缓存下来的应用外壳。
- **跨进程读会话**：能读到其他 pi 进程写入的会话。
- **大仓库不再超时**：新建工作树时先取远端，并放宽大仓库的 git 超时。
- **Windows 兼容**：插件路径分隔符归一，插件更新检查绕开 Windows 启动器。
- **RISC-V 启动**：关闭 Wasm 懒编译。
- **握手与登录态**：握手令牌改用系统随机数，会话 cookie 收严为同站。
- **删除按钮不出现**：列表位置变化后删除按钮会消失。

## 已知

- 端到端套件这一版第一次真正跑起来：此前自带的浏览器内核在本机系统上没有对应构建，
  现在可以走系统已装的浏览器。
- 单测有 4 条既有环境性插件用例失败，与本版无关。
- 源码包见本页下方 Assets，只含受版本控制的源码；装完先装依赖再起生产模式，默认端口 30141。

---

## English

First installable version. This release merges a batch of upstream improvements into the mainline, and per user feedback **rolls the motion layer and glass layer back wholesale**—the interface goes from "semi-transparent + a pile of animations" back to crisp opaque panels, with scrolling and hover also feeling more responsive.

### Added

- **File selection reference**: Selecting a piece of text in a file pops up a toolbar; the selection can be referenced into the current input box, or carried into a new session to ask a question (the selection expands into a file mention). It works in both the text viewer and the document preview.
- **Auto-compact command**: Added the "/auto-compact" slash command.
- **Top bar message count**: The top bar shows the number of messages in the current session.
- **Mention changed files**: A "Mention" button is added to the changed-file row; long paths are elided in the middle.
- **Preview images before sending**: The input area can preview images to be sent.
- **Model source icons**: Each model source gets its own icon in the interface; sources registered by extensions themselves also appear in settings and authentication.
- **Side-by-side patch diffs**: Changes from patch-type tools render as a side-by-side diff view.
- **Images visible when collapsed**: Tool cards still show result images when collapsed; tool blocks stay expanded during streaming updates.

### Changed

- **Motion rolled back wholesale**: Removed entrance animations, blinking cursors, stage dots and global press transitions; focus rings, keyboard accessibility and the "reduce motion" fallback are retained.
- **Glass layer rolled back wholesale**: Removed all background blur and glass overlays; overlays return to an opaque background color.
- **Buttons only on hover**: Lists go back to showing rename and delete only on per-row hover; the trade-off is that after deleting a row, the next row under the cursor no longer automatically reveals these two buttons.
- **Plugin card order**: Extension widgets keep their original order when updating.
- **Extension dialogs**: Dialog titles support code fences, and extension dialogs can dock to the bottom.

### Fixed

- **Duplicated first chunk**: The first character chunk of streaming was rendered twice.
- **Shutdown leftovers**: The event stream is closed on shutdown, no longer leaving zombie processes and 502s.
- **Tool-heavy sessions**: The long-context window now counts only visible messages, so sessions with many tool calls no longer starve user messages.
- **Large file uploads**: Increased the request body buffer, so uploads over 10MB no longer return 500.
- **Usable when offline**: Falls back to the cached app shell when offline.
- **Cross-process session reads**: Sessions written by other pi processes can be read.
- **Large repos no longer time out**: Fetch from the remote first when creating a worktree, and relaxed the git timeout for large repos.
- **Windows compatibility**: Plugin path separators are normalized, and plugin update checks bypass the Windows launcher.
- **RISC-V startup**: Disabled Wasm lazy compilation.
- **Handshake and login state**: The handshake token now uses system randomness, and the session cookie is tightened to same-site.
- **Delete button not appearing**: The delete button would disappear after the list position changed.

### Known

- The end-to-end suite actually ran for the first time in this release: the previously bundled browser engine had no matching build for the local system, but now it can use the browser already installed on the system.
- Unit tests have 4 pre-existing environment-related plugin test failures, unrelated to this release.
- See Assets at the bottom of this page for the source package, which contains only version-controlled source; after installing, install dependencies first and then start production mode, default port 30141.
