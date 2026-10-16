# PI NEXT v0.1.1

这一版把**探索分支**接进来：从主线任意一条消息岔出去、在右栏并排看、结论带回主线，
不用离开主线就能试一条「如果当时这么问会怎样」；另补上子会话「已中断」的真实状态，
以及开发环境的掉线自愈。纯源码发布。

## 新增

- **探索分支**：从主线任意一条消息岔出一条独立的分支，分叉点之前的历史原样复制过去。
  分支顶部自动写明「从哪条消息探索来的」，来源不用手工标注、也不会指错消息——
  它是从父会话与分叉点本身算出来的，不另存一份容易漂移的状态。
- **带回结论**：把分叉点之后的助手文字写进父会话草稿（自动带上会话引用），**但不会自动发送**——
  改不改、发不发由你决定。
- **并排查看分支**：右栏里只读渲染整条分支的转录，与主线共用同一个抬头条，不离开主线就能比对两边的说法，
  也不会把分支上的进展误当成主线的最新状态。
- **子会话「已中断」**：上次写着在跑、进程其实早已不在（重启、崩溃、内存不足），现在如实显示「已中断」，
  不再让一条早就没人跑的任务一直挂着「运行中」。
- **补丁台账补齐**：工具审批与权限档位、会话回退、探索分支、子会话状态等每一批改动，都留下可单独重放的补丁，
  逐批可查、可单独回退。

## 改动

- **三组改动只补说明**：过程显示时间线、待办实时化、定时任务模型下拉这三组由另一条工作线完成、
  没有编辑记录可反演，只出了说明与重放步骤，不猜基线。
- **文档加警示**：新增一份权威的状态说明；两份旧规划文档加了「清单已过时、动手前先查代码」的横幅，
  免得照着过时清单动手。

## 修复

- **开发服务掉线不自愈**：原本的巡检是一次性、前台阻塞的，跑过一次就再没人管，服务掉了也没人拉起；
  改成每 5 分钟巡检一次，掉线自动拉起（实测整棵进程树被杀后 5 秒内恢复，服务恢复正常响应）。
- **测试假失败**：命令环境测试构造 Linux 用例时用了宿主系统的分隔符，在 macOS 上恰好相同所以一直绿，
  此前被误当成产品 bug，实现本身没问题。

## 已知

- 探索分支与子会话状态两条主路径已在浏览器里逐项走通；本版是**源码发布，没有桌面安装包**，
  要装桌面版需自行打包。

---

## English

This release wires in **exploration branches**: branch off from any message on the mainline, view side by side in the right column, and bring the conclusion back to the mainline—try out "what if I had asked this back then" without leaving the mainline; it also adds the child session's real "Interrupted" status, and disconnect self-healing for the dev environment. Source-only release.

### Added

- **Exploration branches**: branch off an independent branch from any message on the mainline, with the history before the fork point copied over verbatim. The top of the branch automatically states "which message this was explored from"; the source needs no manual annotation and won't point at the wrong message—it is computed from the parent session and the fork point itself, without storing a separate state that easily drifts.
- **Bring back the conclusion**: writes the assistant text after the fork point into the parent session's draft (automatically with a session reference), **but does not auto-send**—whether to edit or send is up to you.
- **View branches side by side**: the right column renders the entire branch transcript read-only, sharing the same header bar as the mainline, so you can compare the two accounts without leaving the mainline and won't mistake progress on the branch for the mainline's latest state.
- **Child session "Interrupted"**: when it was last recorded as running but the process is actually long gone (restart, crash, out of memory), it now truthfully shows "Interrupted", so a task nobody has been running for a while no longer stays stuck on "Running".
- **Patch ledger completed**: every batch of changes—tool approval and permission levels, session rollback, exploration branches, child session status, etc.—leaves a separately replayable patch, reviewable batch by batch and individually revertible.

### Changed

- **Three groups of changes get documentation only**: the process display timeline, real-time todos, and the scheduled task model dropdown were completed by another work line with no edit records to reconstruct from, so only an explanation and replay steps are provided, without guessing the baseline.
- **Warning added to docs**: a new authoritative status document is added; the two old planning documents get a banner saying "the checklist is outdated, check the code before starting", to avoid acting on an outdated checklist.

### Fixed

- **Dev service disconnect without self-healing**: the original check was one-off and blocking in the foreground, so after running once nobody looked after it and no one brought the service back up when it dropped; changed to a check every 5 minutes with automatic restart on disconnect (measured recovery within 5 seconds after the entire process tree is killed, with the service responding normally again).
- **False test failure**: the command environment test used the host system's separator when constructing the Linux case, which happened to be identical on macOS so it stayed green; this was previously mistaken for a product bug, but the implementation itself was fine.

### Known

- Both main paths—exploration branches and child session status—have been walked through item by item in the browser; this release is a **source release with no desktop installer**, and to install the desktop version you need to package it yourself.
