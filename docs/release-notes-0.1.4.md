# PI NEXT v0.1.4

这一版把界面从「能用」推向「耐看」，品牌统一为 **PI NEXT**：
Git 图谱、会话统计条、壁纸与一整套对比度合格的配色。

## 新增

- **Git 图谱**：泳道图、提交详情、变更文件直达 diff、引用标签。
- **模型收藏**：输入框选择器与设置页共用一份收藏，收藏置顶成组。
- **壁纸**：两幅内置画作或自传图片，遮罩、透明度、分区模糊可调。
- **最近项目**：只读 VS Code / Cursor / Zed / Claude / Codex / OpenCode 的本机历史，开新任务时直接选。
- **会话统计条**：消息数、token、成本、缓存命中率与上下文圆环。
- **思考强度按模型记忆**：换模型不用重新调档。
- **应用内更新检查**：有新版会在对话里提示。
- **会话行直接露出置顶 / 归档**，不用进右键菜单。
- **附件显示 @文件名**，发送时自动还原成完整路径。

## 改动

- **品牌与数据迁移**：应用名、安装包名、托盘、登录页与 PWA 名称全部统一为 PI NEXT；
  重装后自动把旧数据目录迁移过来，草稿、窗口位置和布局不会丢。
- **主题收敛为 light / dark / auto 三档**，全套颜色改成语义化的一套，字体换成 Inter + Noto Sans Mono。
- **圆角、间距与动效时长统一成一套刻度**。
- **对比度达标**：明暗两套配色各 8 组组合全部通过无障碍对比度要求。
- **聊天细节**：底部渐隐、用量行常显、消息间距对齐。
- **扩展请求浮窗**折叠后贴在输入框上方，不再飘在消息区顶部；顶栏图标统一尺寸与线宽。

## 移除

- 设置里的**「提示词」页**：它只是模板的只读清单，调用仍然走输入框的 `/` 面板。
- 侧栏的**「按更新时间 / 按创建时间」排序开关**。

---

## English

This version pushes the interface from "usable" toward "pleasant to look at", and unifies the brand as **PI NEXT**: a Git graph, a session stats bar, wallpapers, and a full set of contrast-compliant colors.

### Added

- **Git graph**: swimlane diagram, commit details, direct jump from changed files to diff, and ref labels.
- **Model favorites**: the input-box selector and the settings page share one set of favorites, with favorites pinned to the top as a group.
- **Wallpapers**: two built-in artworks or your own uploaded images, with adjustable overlay, opacity, and per-region blur.
- **Recent projects**: read-only access to the local history of VS Code / Cursor / Zed / Claude / Codex / OpenCode, so you can pick one directly when starting a new task.
- **Session stats bar**: message count, token, cost, cache hit rate, and a context ring.
- **Thinking effort remembered per model**: switching models does not require readjusting the level.
- **In-app update check**: when a new version is available it is indicated in the conversation.
- **Session rows expose pin / archive directly**, without going into the right-click menu.
- **Attachments display @filename**, and are automatically restored to the full path when sending.

### Changed

- **Brand and data migration**: the app name, installer package name, tray, login page, and PWA name are all unified as PI NEXT; after reinstalling, the old data directory is migrated over automatically, so drafts, window position, and layout are not lost.
- **Themes are condensed into the three tiers light / dark / auto**, the full color set is changed to a semantic one, and the font is switched to Inter + Noto Sans Mono.
- **Corner radius, spacing, and animation durations are unified into one scale**.
- **Contrast compliance**: all 8 combinations each for the light and dark color schemes pass the accessibility contrast requirements.
- **Chat details**: bottom fade, usage row always visible, and message spacing aligned.
- **Extension request popover** is docked above the input box when collapsed instead of floating at the top of the message area; top bar icons have unified size and stroke width.

### Removed

- The **"Prompts" page** in settings: it was only a read-only list of templates, and invocation still goes through the input box's `/` panel.
- The sidebar's **"by update time / by creation time" sort toggle**.
