# PI NEXT v0.1.0

这一版把 Windows 线并进主干：**工具审批与三档权限、计划模式、回退到任意一条消息**一次到位，
外加队列逐条操控、行内引用、附件放宽、多根文件树。纯源码发布，没有桌面安装包。

## 新增

- **三档权限与审批**：工具调用可选全自动 / 需审批 / 计划三档。凡不是只读的工具调用，都会先弹一张审批卡，
  你确认了才真正执行。
- **计划模式**：介于两者之间的第三档，按最严的权限档位运行，只读之外的调用同样要先过审批。
- **回退到此处**：从任意一条消息处把会话截断，回到那一刻的现场。因为是破坏性操作，执行前一定会先确认；
  已经落盘的文件不会被回退。
- **队列逐条操控**：待发送队列支持撤回、删除、拖拽排序，以及「立即发送」——发出去的那条会提升为引导消息，
  也就是排在它前面的内容都还没发出去时，它会抢在前面。
- **行内引用**：输入框里 `&` 引会话、`#` 引 MCP 服务、`~` 引待办，打出来会有候选浮层，
  选中的引用随草稿一起保存，关掉再打开也还在。
- **附件放宽**：任意文件类型都能传，另外设了上传上限，超限自动降级为路径引用而不是直接失败；
  拖拽入口与其他入口的行为也统一了。
- **文件树多根**：文件树支持多根，每根带作用域徽标，一眼分得清每个文件属于哪一层作用域；
  在 worktree 会话下不再多冒出一个「项目」根。空目录显示、重试等细节一并修正。

## 改动

- **字号统一收口**：散落在各处的内联字号全部归到统一的字号档位，不会再出现某处自成一套的怪字号。
- **补丁台账起步**：头几批改动各自留了可单独重放的补丁，附带一份零依赖的重放工具，
  后续版本可以按批回看，也能按批回退。

## 修复

- **会话恢复偶发跳欢迎页**：带会话参数打开时，有工作区的安装会落到欢迎页，而不是原来那个会话。
- **命令静默失败**：开发与构建命令在 Windows 上不报错也不执行，像是什么都没发生，现在能正常跑通。
- **桌面包多打文件**：打包的文件排除规则有误，多余文件被一起打进桌面包。

## 已知

- 本版是**源码发布，没有桌面安装包**；要装桌面版需自行打包，打包流程带构建硬门禁与冒烟检查。
- 与 Windows 线是零冲突合流，远端此前的记忆、定时通知、思考折叠、弹层焦点等改动在本线已存在，未重复引入。

---

## English

This release merges the Windows line into the mainline: **tool approval and three permission levels, plan mode, and rollback to any message** all land at once, plus per-item queue control, inline references, relaxed attachments, and multi-root file trees. Source-only release, no desktop installer.

### Added

- **Three permission levels and approval**: tool calls can be set to fully automatic / needs approval / plan. Any tool call that is not read-only first pops up an approval card, and only executes after you confirm.
- **Plan mode**: the third level between the other two, running at the strictest permission level; calls other than read-only likewise have to pass approval first.
- **Roll back to here**: truncate the session at any message and return to the scene at that moment. Because it is a destructive operation, it always confirms first; files already written to disk are not rolled back.
- **Per-item queue control**: the pending queue supports withdraw, delete, drag-to-reorder, and "Send now"—the one that is sent is promoted to a steering message, meaning it jumps ahead while everything queued before it has not been sent yet.
- **Inline references**: in the input box, `&` references sessions, `#` references MCP services, and `~` references todos; a candidate overlay appears as you type, and the selected reference is saved along with the draft and is still there after closing and reopening.
- **Relaxed attachments**: any file type can be uploaded, and an upload limit is set; going over the limit automatically degrades to a path reference rather than failing outright; the drag-and-drop entry and other entries now behave the same.
- **Multi-root file tree**: the file tree supports multiple roots, each with a scope badge, so you can tell at a glance which scope layer each file belongs to; in a worktree session an extra "Project" root no longer appears. Details such as empty directory display and retry are also fixed.

### Changed

- **Unified font sizes**: inline font sizes scattered throughout are all brought into unified size levels, so an odd one-off font size no longer appears somewhere.
- **Patch ledger started**: the first few batches of changes each leave a separately replayable patch, along with a zero-dependency replay tool; later versions can review by batch and also roll back by batch.

### Fixed

- **Session restore occasionally jumps to the welcome page**: when opening with a session parameter, installations that have a workspace landed on the welcome page instead of the original session.
- **Commands silently fail**: dev and build commands on Windows neither errored nor executed, as if nothing happened; now they run properly.
- **Desktop package included extra files**: the packaging file exclusion rule was wrong, so extra files were packed into the desktop package.

### Known

- This release is a **source release with no desktop installer**; to install the desktop version you need to package it yourself, and the packaging flow includes a hard build gate and smoke checks.
- The merge with the Windows line was zero-conflict; the remote line's earlier changes such as memory, scheduled notifications, thinking collapse, and overlay focus already exist on this line and were not re-introduced.
