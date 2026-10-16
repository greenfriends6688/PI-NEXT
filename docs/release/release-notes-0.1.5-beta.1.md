# PI NEXT v0.1.5-beta.1

这一版的主题是**接上游**（文件管理、在系统文件管理器里打开工作区、技能市场）与
**修那几个一直说不清的老问题** —— 其中设置「保存不下来」的根因终于找到了。

## 新增

- **文件管理**：文件树右键菜单可以打开、下载、新建文件 / 文件夹、重命名、删除，
  以及 ZIP / tar 的解压与压缩；所有改动都在同一套根目录白名单之内。
- **打开系统文件夹**：文件面板工具条上一个按钮，macOS 开 Finder、Windows 开资源管理器、
  Linux 走系统默认。
- **SkillHub 技能市场**：技能页可切到 SkillHub，按评分列一屏，留空搜索框即是浏览；
  直接下包装好，不依赖任何命令行工具。
- **步骤展开按类别控制**：设置里三个开关（推理 / 命令 / 工具调用），右边显示当前是展开还是关闭。

## 改动

- **链接不再跳出应用**：正文、处理详情、文件预览里的外链都走应用内浏览器面板；
  按住 Cmd / Ctrl / Shift 或中键点仍然是系统浏览器，同一个链接重复点会复用已有标签。
- **过程显示只保留时间线**：去掉「平铺列表 / 标签」两种视图，一轮对话永远是一条时间线。
- **权限档位跟着会话走**：以前切到别的会话会沿用上一个会话的档位，刷新后又全部回到默认。

## 修复

- **设置保存不下来**：桌面版每次启动都随机取一个端口，窗口来源随之变化，
  而浏览器本地存储是按来源分库的 —— 主题、语言、聊天宽度、过程显示等于是全部「失效」。
  现在固定用一组端口，被占用时才退回随机端口并给出警告。
  **这一条需要重装 / 重启桌面版才生效。**
- **文件树与 Git 状态不自动刷新**：新建、重命名、删除之后列表不会更新。

## 移除

- 顶栏的 **MCP 面板**：设置里本来就有完整的 MCP 编辑器（增删改 / 作用域 / 握手测试），两处入口重复。
- 设置里的**「过程显示」下拉框**：时间线已经固定。

## 已知

- 源码包：解压后自行安装依赖构建，或沿用上一版的桌面安装包。
- 上面「设置保存不下来」那条修在桌面版上，需要重装 / 重启后才生效。

---

## English

This version's themes are **catching up with upstream** (file management, opening the workspace in the system file manager, skill marketplace) and **fixing those old problems that were never clearly explained** — among them, the root cause of settings "not saving" has finally been found.

### Added

- **File management**: the file tree's right-click menu can open, download, create file / folder, rename, and delete, as well as extract and compress ZIP / tar; all changes stay within the same root-directory whitelist.
- **Open system folder**: a button on the file panel toolbar; on macOS it opens Finder, on Windows File Explorer, and on Linux it goes through the system default.
- **SkillHub skill marketplace**: the Skills page can switch to SkillHub, listing a screen of skills by rating, and leaving the search box empty browses; packages are downloaded and installed directly, without depending on any command-line tool.
- **Step expansion controlled by category**: three switches in settings (reasoning / commands / tool calls), with the current state (expanded or collapsed) shown on the right.

### Changed

- **Links no longer jump out of the app**: external links in the body text, processing details, and file preview all go through the in-app browser panel; holding Cmd / Ctrl / Shift or middle-clicking still uses the system browser, and clicking the same link repeatedly reuses the existing tab.
- **Process display keeps only the timeline**: the "tiled list / tabs" views are removed, and a conversation is always one timeline.
- **Permission level follows the session**: previously, switching to another session carried over the previous session's level, and after refreshing everything reverted to the default.

### Fixed

- **Settings don't save**: the desktop app picked a random port on every launch, so the window origin changed each time, and browser local storage is partitioned by origin — so themes, language, chat width, process display, and so on all effectively "stopped working". Now a fixed set of ports is used, falling back to a random port with a warning only when they are occupied. **This one requires reinstalling / restarting the desktop app to take effect.**
- **The file tree and Git status do not auto-refresh**: the list does not update after creating, renaming, or deleting.

### Removed

- The **MCP panel** in the top bar: settings already has a complete MCP editor (add / delete / modify / scope / handshake test), and the two entries were redundant.
- The **"process display" dropdown** in settings: the timeline is already fixed.

### Known

- Source package: after extracting, install dependencies and build yourself, or keep using the previous version's desktop installer.
- The "settings don't save" item above is fixed on the desktop app and takes effect only after reinstalling / restarting.
