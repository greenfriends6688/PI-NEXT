# PI NEXT v0.0.7

连续三轮落地后的版本，四个能力一次接齐：**待办、定时任务、长期记忆**各自有了正式入口，
**MCP 拆成独立设置菜单**并支持从常用 agent 里一键导入；界面这轮重点是让长会话更好管。

## 新增

- **待办**：模型可在会话里直接登记待办，回退分支时列表跟着回退；
  输入框上方有进度胶囊，另有一个只读任务面板。
- **定时任务**：支持每日 / 每周 / 单次三种节奏，按 5 字段 cron 表达式配置；
  可设闲时窗口（窗口外顺延到窗口开始）、时区、任务级模型与思考级别，并保留运行历史。
- **长期记忆**：记忆以 markdown 落盘，设置里可开关；文件能新建、预览、手改，也能在编辑器里打开。
- **MCP 独立设置菜单**：从插件页拆出，两边不再重复出现同一批服务；
  可从 Claude Code / Codex / Cursor / VS Code / Gemini / OpenCode / Windsurf 只读发现并一键导入。
- **导出 Markdown**：顶栏 ⋯ 菜单里导出，工具调用压成一行、结果折叠截断。
- **标题即会话切换器**：点会话标题弹出最近 10 条，并可直接新建任务。
- **轮次摘要**：一句话交代这一轮动过几个文件、跑过几条命令、用过几个工具。
- **设置搜索**：设置内可搜索并高亮命中项；另有界面密度三档与浏览器视口预设。
- **文件操作菜单**：复制路径、在文件管理器中打开、用默认应用打开。
- **会话状态标记**：5 档可选，可排序切换，也可一键全部展开 / 收起。

## 改动

- **标签溢出折叠**：标签放不下时折叠成一枚按钮，活动标签永不隐藏，折叠按钮自身占宽。
- **新会话首页**：空态收成工作区胶囊，浮层改两段式入场。
- **界面细节**：输入框提示轮播、复制图标的二态形变、数字与中文的排版折行处理。

## 已知

- 本版只发源码包，需自行安装依赖并以生产模式启动。

---

## English

This is the release after three consecutive rounds of landing, with four capabilities wired up at once: **todos, scheduled tasks, and long-term memory** each now have a proper entry point, and **MCP is split into its own settings menu** with one-click import from common agents; the focus of the UI this round is making long sessions easier to manage.

### Added

- **Todos**: the model can register todos directly in a session, and the list rolls back when branching back; there is a progress capsule above the input box, plus a read-only task panel.
- **Scheduled tasks**: supports three cadences—daily / weekly / once—configured with a 5-field cron expression; you can set an idle window (outside the window it is deferred to the window start), time zone, task-level model and thinking level, and run history is retained.
- **Long-term memory**: memory is persisted to disk as markdown, and can be toggled in settings; files can be created, previewed, edited by hand, and opened in the editor.
- **MCP standalone settings menu**: split out from the plugins page, so the same set of services no longer appears in both places; it can read-only discover and one-click import from Claude Code / Codex / Cursor / VS Code / Gemini / OpenCode / Windsurf.
- **Export Markdown**: export from the top bar ⋯ menu; tool calls are compressed into one line and results are collapsed and truncated.
- **Title as session switcher**: clicking the session title pops up the 10 most recent, and you can create a new task directly.
- **Turn summary**: one sentence stating how many files were changed, how many commands were run, and how many tools were used this turn.
- **Settings search**: search within settings with matches highlighted; there are also three interface density levels and browser viewport presets.
- **File action menu**: copy path, open in file manager, open with default app.
- **Session status markers**: 5 selectable levels, sortable and toggleable, and can expand / collapse all with one click.

### Changed

- **Tab overflow collapse**: when tabs don't fit they collapse into a single button, the active tab is never hidden, and the collapse button takes up its own width.
- **New session home page**: the empty state is condensed into a workspace capsule, and the overlay now enters in two stages.
- **UI details**: input box hint carousel, two-state morphing of the copy icon, and typesetting line-break handling for numbers and Chinese.

### Known

- This release only ships a source package; you need to install the dependencies yourself and start it in production mode.
