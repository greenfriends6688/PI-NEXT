# PI NEXT v0.1.2

这是一个以修复为主的版本，没有新功能：**过程步骤里的文件标签不再刷一屏的报错**，
标签本身长得一模一样，点开文件的行为没变、键盘也能用；同时按要求把上一版
「子会话运行时把消息往父会话冒泡」那批改动整体撤回，没做完的接线一并丢掉。纯源码发布。

## 修复

- **过程步骤里的报错**：文件标签在浏览器控制台里报「按钮不能嵌套在按钮里」，两种说法
  （按钮不能是按钮的后代、按钮不能包含另一个按钮）交替刷屏，每渲染一次报一次，开发者工具里整块过程步骤都是红的——
  报错文案直接点名了这个标签，看起来像界面整个坏了。
- **标签结构改掉**：这个标签在步骤行与紧凑行两种形态下都被渲染成按钮，而这两处调用点本来就在按钮内部，
  属非法结构。改成按它本来的样子渲染，不再冒充按钮。
- **键盘仍然可用**：标签照样能被 Tab 聚焦，回车与空格照样能触发，纯键盘操作没被牺牲；
  点标签也仍然不会连带把整行折叠掉。
- **外观零变化**：修的是结构不是外观，标签的长相、间距、配色与改动前完全一致，看不出任何差别。
- **加了守卫测试**：明确规定三件事——标签不能是按钮、键盘处理必须在、这一块只允许剩下两处真正的按钮。
  以后谁把标签改回按钮结构，测试会立刻红，不会悄悄退回去。
- **合并遗留的样式块**：早先一次合并留下一个没闭合的样式块，现已补上。

## 移除

- **子会话消息冒泡**：子会话运行时不再把消息往父会话冒泡。上一版这批改动连同它的测试与文案一并撤回——
  子会话转发、父会话事件、客户端卡片与对应文案都没有落地，不是暂停而是撤回，
  工作区里不留半成品，仓库里也已经搜不到与冒泡有关的任何文件。子会话照常能跑，只是运行期的动静
  不再往父会话里塞。
- 同一系列的另一半**保留**：子会话「上次在跑、现在没跑」仍如实显示为「已中断」。

## 已知

- 本版是**源码发布，没有桌面安装包**；要装桌面版需自行打包。
- 开发看门狗（计划任务每 5 分钟巡检、掉线自愈）与命令环境测试的 Windows 平台修正沿用上一版，
  本版未再改动。
- 类型检查与代码检查干净，全量测试结果与上一版一致，没有新增失败。

---

## English

This is a mostly fix-focused release with no new features: **the file tag in process steps no longer floods the screen with errors**, the tag itself looks exactly the same, the behavior of opening a file is unchanged, and the keyboard still works; at the same time, as requested, the previous release's batch of changes "bubbling messages from child sessions to the parent session while running" has been fully reverted, and the unfinished wiring has been discarded along with it. Source-only release.

### Fixed

- **Errors in process steps**: the file tag reported "button cannot be nested inside button" in the browser console, with the two phrasings (a button cannot be a descendant of a button, a button cannot contain another button) alternating and flooding the screen, reporting once per render, until the whole process step block was red in the dev tools—the error text named this tag directly, making it look like the whole UI was broken.
- **Tag structure changed**: this tag was rendered as a button in both the step row and compact row forms, while both call sites were already inside buttons, which is an illegal structure. It now renders as what it actually is and no longer masquerades as a button.
- **Keyboard still works**: the tag can still be focused with Tab and triggered with Enter and Space, so pure keyboard operation was not sacrificed; clicking the tag still does not collapse the whole row along with it.
- **Zero visual change**: what was fixed is structure, not appearance; the tag's look, spacing, and colors are exactly the same as before the change, with no visible difference.
- **Guard tests added**: it explicitly specifies three things—the tag cannot be a button, keyboard handling must be present, and only two real buttons are allowed to remain in this block. If anyone changes the tag back to a button structure in the future, the test will immediately go red and it won't quietly regress.
- **Leftover style block from a merge**: an earlier merge left an unclosed style block, which has now been fixed.

### Removed

- **Child session message bubbling**: child sessions no longer bubble messages to the parent session while running. This batch of changes from the previous release, along with its tests and copy, has been reverted—child session forwarding, parent session events, client cards, and the corresponding copy never landed, and this is a revert rather than a pause; no half-finished work is left in the workspace, and no files related to bubbling can be found in the repository anymore. Child sessions still run as usual, except that runtime activity is no longer pushed into the parent session.
- The other half of the same series is **kept**: a child session that "was running last time and is not running now" still truthfully displays as "Interrupted".

### Known

- This release is a **source release with no desktop installer**; to install the desktop version you need to package it yourself.
- The dev watchdog (a scheduled task checking every 5 minutes, with disconnect self-healing) and the Windows platform fix for the command environment test carry over from the previous release and were not changed again in this version.
- Type checking and linting are clean, the full test results match the previous release, and there are no new failures.
