# PI NEXT v0.1.6

这一版把 9 月下旬积压的一批工作（导入、文件预览重做、模型目录）收进来，并按用户反馈
修了六处界面：侧栏项目行、设置页留白、用量页改成仪表盘、文件树默认宽度、文件预览全屏、
以及「渲染窗口切在回合中间时会退化成流水账」的会话渲染问题。仍然零新依赖。

## 新增

- **导入（设置 → 导入）**：把这台机器上其它 agent 的东西搬过来，四类各一个页签 ——
  对话、模型供应商、技能、MCP 服务器。不点「扫描」不读任何文件，不点「导入」不写任何文件；
  凭据一律不复制（API key 请在目标里重新填）。
- **用量页改成仪表盘**（设置 → 用量）：顶部一排指标卡（Token / 会话 / 消息 / 活跃天数 /
  当前连续天数 / 最常用模型 / 缓存 token / 工具成功率 / 成本），下面是活跃热力图
  （**固定最近 12 个月**，不跟着区间按钮缩）、按模型的占比条与列表、请求与错误散点、
  按天 Token 柱状趋势、按项目列表。新增「1 年」区间。数字全部来自本机会话文件：
  「错误」只统计失败的工具结果，首字延迟 / 输出速度这类会话文件里没有的指标
  **宁可不显示也不编**。
- **按项目统计**：用量页现在按会话所属目录聚合，能看出哪个项目最烧钱。
- **文件预览全屏**：预览头部那个 ⤢ 按钮改成把文档铺满**整个应用窗口**（不是系统全屏），
  Esc 或再点一次退出。

## 改动

- **文件预览重做**：删掉内置的 markdown 编辑器（连带 8 个相关依赖），
  文件面板收敛成「源码 / 预览」两态 + 与 HEAD 对比。
- **侧栏项目行**：折叠箭头挪到项目名右边，`⋯` 与 `⊕` 并成一组贴行尾；
  未悬停时不再在数字和箭头之间留一条空缝。项目行菜单里可以归档/恢复、打开文件夹、
  重命名、从列表移除。
- **文件树面板默认宽度**：从「半个窗口」收到 420px（打开文档时会按需加宽到并排所需的宽度）。
- **设置页留白**：归档历史、导入两页补上各页共用的页面框，不再贴着左侧导航；导航行的
  键盘焦点环改成内缩，不再越过分隔线画到内容区。
- **会话渲染**：渲染窗口按条数切，长回合会被切在中间 —— 那一段以前逐条平铺
  （工具行 + 每条助手消息一行 token 用量），整屏像一本流水账；现在和正常回合同构，
  收成一条时间轴。
- **模型目录**：服务商发布新模型后可以刷新，配置页逐模型启用/停用。

## 已知

- 用量统计里 fork 出来的会话会把父会话的历史**再算一遍**，
  所以总 token/成本比真实支出偏高。
- 「按项目」列表里同名的两个目录（不同路径、同末级名）会显示成同一个名字。

---

## English

This release brings in a backlog of late-September work (import, file preview rework, model catalog), and fixes six interface issues based on user feedback: the sidebar project row, Settings page whitespace, the usage page turned into a dashboard, the default file-tree width, full-screen file preview, and the session-rendering problem where "a render window cut in the middle of a turn degrades into a running log". Still zero new dependencies.

### Added

- **Import (Settings → Import)**: bring over things from other agents on this machine, with one tab for each of four categories — chats, model providers, skills, MCP servers. Nothing is read from disk until you click "Scan", nothing is written until you click "Import"; credentials are never copied (please re-enter the API key in the destination).
- **Usage page turned into a dashboard** (Settings → Usage): a row of metric cards at the top (Token / sessions / messages / active days / current streak / most-used model / cached tokens / tool success rate / cost), and below that an activity heatmap (**fixed to the last 12 months**, not shrinking with the range buttons), per-model share bars and list, request and error scatter plot, daily Token bar trend, and per-project list. Added a "1 year" range. All numbers come from local session files: "errors" counts only failed tool results, and metrics that are not in session files, such as time to first token / output speed, **are hidden rather than fabricated**.
- **Per-project statistics**: the usage page now aggregates by the directory a session belongs to, so you can see which project burns the most money.
- **Full-screen file preview**: the ⤢ button in the preview header now fills the document across the **entire app window** (not OS full screen); press Esc or click it again to exit.

### Changed

- **File preview rework**: removed the built-in markdown editor (along with 8 related dependencies); the file panel is reduced to two states "Source / Preview" + compare with HEAD.
- **Sidebar project row**: the collapse arrow moved to the right of the project name, and `⋯` and `⊕` are merged into one group pinned to the row's end; when not hovering, there is no longer an empty gap between the number and the arrow. In the project row menu you can archive/restore, open the folder, rename, and remove from the list.
- **Default file-tree panel width**: reduced from "half the window" to 420px (it widens on demand to the width needed for side-by-side when a document is open).
- **Settings page whitespace**: the Archive History and Import pages now get the shared page frame used by each page, no longer sitting flush against the left navigation; the keyboard focus ring on navigation rows is now inset, no longer drawn past the divider into the content area.
- **Session rendering**: the render window is cut by item count, so long turns get cut in the middle — that segment used to be tiled item by item (a tool row + a token-usage row for each assistant message), making the whole screen look like a running log; it is now isomorphic to a normal turn, collapsed into a single timeline.
- **Model catalog**: after a provider releases a new model you can refresh, and the configuration page enables/disables each model individually.

### Known

- In usage statistics, forked sessions **recount** the parent session's history, so total token/cost is higher than actual spending.
- In the "By Project" list, two directories with the same name (different paths, same last segment) are displayed as the same name.
