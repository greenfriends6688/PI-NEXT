# PI NEXT v0.0.5

这一版把外观定制整条线补齐：**可以读 pi 的命令行主题、可以调描边深度、可以铺壁纸**；
**过程显示支持时间线 / 标签页两种分组**；会话有了置顶与归档；右键菜单、主题切换、
过程分组这些实际用起来会卡手的地方也一并修好。

## 新增

- **pi CLI 主题**：读取 pi 的终端主题，映射到本项目强制要求的 34 个颜色变量，
  以内联变量的方式叠在六套内置色板之上；带首屏脚本，刷新不会闪一下错色。
  项目内的主题目录同样生效，入口在设置 → 外观。
- **描边深度**：一个滑杆联动三级边框粗细，从原始值混合而来，来回拖动不会越拖越粗或漂移。
- **壁纸**：6 张内置画作，也可以换成自定义图；聊天区、输入框、面板各自独立选择
  无 / 半透明 / 模糊，另有遮罩强度。
- **过程分组显示**：一轮的过程可按「时间线」或「标签页」分组渲染，含步骤分类、文件标签与
  推理折叠渐隐；默认仍是平铺，需要时再开。
- **会话置顶与归档**：右键即可置顶或归档，归档后进入侧栏里折叠的「已归档」区，可原样找回。
- **通用右键菜单**：贴到屏幕边缘时自动翻转，支持方向键与 Home/End、子菜单，操作后有反馈文案。
- **独立聊天工作区**：不属于任何项目的对话单独一栏，不再混在项目里。
- **桌面能力**：桌面壳与 DMG 打包配置就位，桌面包可自行构建。

## 改动

- **工程自检更干净**：代码检查与类型检查只扫本项目，不再把参考项目一起扫进来
  （此前会跑到跑不完），类型检查也不再因为把参考项目算进去而爆内存。

## 修复

- **右键菜单整块不可见**：菜单带了结构却没带样式；菜单里 Home / End 无效；
  操作抛错会变成未捕获的 Promise。
- **项目内主题静默不生效**：解析主题时没带当前目录，选了没反应。
- **切换主题重置描边深度**：切回内置色板还会残留上一次的深度混合。
- **用回内置没清自定义图**：换回内置画作时两张图叠着显示。
- **过程分组丢内容**：自定义消息被渲染成不可读的文本、图片块整块丢弃、空推理行。
- **归档后无法取消归档**：取消入口挂在一张永远不显示的「已归档」行上。

## 已知

- 本版为源码发布，未附桌面包；需要桌面版请自行打包。

---

## English

This release completes the entire appearance customization line: **you can read pi's command-line theme, adjust border depth, and set a wallpaper**; **the process display supports two groupings, timeline / tabs**; sessions gain pinning and archiving; and places that actually feel sticky in use—context menus, theme switching and process grouping—are fixed as well.

### Added

- **pi CLI theme**: Reads pi's terminal theme, maps it to the 34 color variables this project requires, and layers it over the six built-in palettes as inline variables; it includes a first-paint script so a refresh does not flash the wrong colors. A theme directory inside the project works too; the entry point is Settings → Appearance.
- **Border depth**: One slider controls three levels of border thickness, blended from the original value; dragging back and forth will not make it thicker or drift.
- **Wallpaper**: 6 built-in artworks, or replace with a custom image; the chat area, input box and panel each independently choose none / semi-transparent / blurred, plus a mask strength.
- **Process grouping display**: A turn's process can be rendered grouped by "Timeline" or "Tabs", including step categories, file tags and reasoning collapse fade-out; the default is still flat, to be enabled when needed.
- **Session pinning and archiving**: Right-click to pin or archive; once archived it goes into a collapsed "Archived" section in the sidebar and can be recovered as-is.
- **General context menu**: Automatically flips when near the screen edge; supports arrow keys and Home/End, submenus, and shows feedback text after an action.
- **Standalone chat workspace**: Conversations that do not belong to any project get their own column and are no longer mixed into projects.
- **Desktop capability**: The desktop shell and DMG packaging configuration are in place; the desktop package can be built yourself.

### Changed

- **Cleaner project self-checks**: Code checks and type checks scan only this project and no longer pull in reference projects too (which previously ran endlessly), and type checking no longer runs out of memory from counting reference projects.

### Fixed

- **Context menu entirely invisible**: The menu shipped with structure but no styles; Home / End did not work inside the menu; errors thrown by actions became unhandled promises.
- **In-project themes silently not working**: Theme resolution did not include the current directory, so selecting one had no effect.
- **Switching themes resets border depth**: Switching back to a built-in palette still left the previous depth blend behind.
- **Returning to built-in did not clear the custom image**: Switching back to a built-in artwork showed the two images stacked.
- **Process grouping losing content**: Custom messages were rendered as unreadable text, image blocks were dropped entirely, and empty reasoning lines.
- **Cannot unarchive after archiving**: The unarchive entry was attached to an "Archived" row that never displays.

### Known

- This release is a source release and does not include a desktop package; build it yourself if you need the desktop version.