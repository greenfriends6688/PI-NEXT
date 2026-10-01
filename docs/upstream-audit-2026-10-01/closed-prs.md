# 上游 agegr/pi-web 已关闭 PR 审计报告

生成时间：2026-10-01 · 数据源：GitHub REST API（未认证，`curl`）· 本地 refs：`v0.9.1`(8366762, 2026-09-11) / `v0.9.2` / `v0.9.3` / `agegr/main`(e17d2cc, 2026-10-01)

> **本审计未写入工作树任何被跟踪文件**：只用 `git apply -3 --check`（不落盘）、`git show/log`、`grep`、`curl -o /tmp/...`。
> ⚠️ 但审计期间（18:04）工作树被**另一个并发会话**改动了一批文件（cron/memory/prompts 分节清理）——详见 **§6**，那不是本次审计造成的，但它让部分 `apply -3` 冲突数不可复现。

---

## 0. 先说三条会影响结论的事实修正

1. **PR 总数不是 439，是 588。** `GET /pulls?state=closed` 实际返回 **549 条**（分 6 页，第 7 页空），加当前 open 39 条 = 588。
   `pi-web-pr-inbox/prs.txt` 里的 61 个 open 是**旧快照**：其中 54 个后来已被合并或关闭，现在只剩 7 个还 open。
2. **closed-unmerged 不是 191，是 275。**（merged 274 / closed-unmerged 275。）
3. **最大的差距根本不在 closed-unmerged PR 里。** 我们 fork 的 `package.json` 还锁在 **pi 0.87.0**，上游 `agegr/main` 已经是 **0.99.1**（提交 `d0bf6be`）。上游 closed-unmerged 里两个 MCP PR（#893/#900）被维护者关掉的**唯一理由**就是「pi 0.99 原生支持 MCP 了，剩下的工作是把 pi 升到 0.99 并把 `createMcpExtension()` 接进 resource loader」。也就是说：想拿 MCP，正确动作是升 pi，而不是捡这两个 PR。

另：我们 main 有 274 个自己的 commit（皮肤/画板设计系统、导入面板、用量仪表盘、工作区记忆等），已经和上游 v0.9.1 之后分叉严重。**「上游有」≠「我们没有」**——下面所有判断都去 `/Users/yingjing/Desktop/pi-codex` grep 核对过。

---

## 1. 统计表

| 指标 | 数量 |
|---|---|
| 上游 PR 总数（2026-10-01 实时） | **588** |
| 当前 open | 39（其中 7 个是 inbox 旧快照里的，32 个是快照之后新开的） |
| **closed 总数** | **549** |
| ├─ **merged** | **274** |
| │　├─ merged **在 v0.9.1 之前**（我们基线已有） | 187 |
| │　└─ merged **在 v0.9.1..agegr/main 之间**（= 我们与上游的差距，§2） | **87** |
| └─ **closed-unmerged（未合并）** | **275** |

### 1b. closed-unmerged 按主题粗分类（关键词分类，共 275）

| 主题 | 数量 | 说明 |
|---|---|---|
| 会话 / 侧栏组织（pin、folder、archive、group、title、project） | **69** | 最大的一块，且被维护者以「会话组织要整体重设计」为由批量关掉 |
| 文件 / 浏览器 / 预览 / 编辑器 | 56 | 同样被「Pi Web 是薄前端，文件管理是 agent 的活」批量关掉 |
| 聊天 / composer / Markdown / 滚动 / minimap / UI | 29 | 大量被「是 IDE chrome」关掉 |
| 模型 / provider / 配额 | 20 | |
| MCP / 插件 / 技能 / 扩展 | 15 | |
| 设置 / 认证 / 安全 / proxy / Lite | 9 | |
| terminal / CLI / 桌面端 / Windows / Telegram / shutdown | 8 | |
| subagents | 7 | |
| 测试 / CI / 文档 / 依赖 | 6 | |
| i18n / 主题 / 杂项 | 4 | |
| perf | 4 | |
| 未归类（多为更早期 PR，标题无明显信号） | 48 | 主要是 2026-05~06 的老 PR |

### 1c. closed-unmerged 按关闭日期（关键信号：**4 次批量清理占了 109 条 = 40%**）

| 关闭日 | 条数 | 性质 |
|---|---|---|
| 2026-09-30 | 29 | 维护者批量清理（含 #984~#1004 Lite 系列、#893/#900 MCP） |
| 2026-09-16 | 29 | 维护者批量清理（会话组织 / IDE chrome 拒绝潮） |
| 2026-08-25 | 29 | 维护者批量清理（大量无响应作者的老 PR） |
| 2026-09-05 | 22 | 维护者批量清理 |
| 其他日期 | 166 | 作者自查关闭 / 被合并版取代 / 重复 PR |

**读法**：40% 的 closed-unmerged 是「一刀切」批量关的，不是逐条评审否决的；判断单条 PR 是否值得拉，必须看维护者在评论里写的**具体理由**（我抓了 30 条评论，见 §3），不能拿「被关了」当「质量差」。

---

## 2. 「已合并但我们没有」= 87 个（v0.9.1..agegr/main 区间）

交叉核对方法：用 API 的 `merge_commit_sha` 去撞 `git log v0.9.1..agegr/main --pretty=%H`，命中 **87** 个。
（另有 **36 个提交**落在同一区间但提交信息里没有 `(#NNN)`，是维护者直接推到 main 的，不属于 PR。）

最后一列「我们 fork 的等价实现」是我逐条 grep `/Users/yingjing/Desktop/pi-codex` 得出的，标注 **无** 的才是真差距。

| PR | merged_at | 标题 | 文件数 | 上游 commit | 我们 fork 的等价实现 |
|---|---|---|---|---|---|
| #818 | 2026-09-15 | fix(auth): use SameSite=Lax for pi_web_session cookie | 2 | `c1e544ba` | n/a — 我们已删除 Basic Auth 登录 |
| #732 | 2026-09-16 | feat(worktree): fetch origin before add and raise git timeout for large repos | 1 | `744ee937` | 无（worktree 拉 origin + 大仓超时） |
| #733 | 2026-09-16 | feat: add extension widget font size setting | 1 | `860698a6` | 部分（ThemeSkinStudio / ui-font 有字体设置，但非扩展 widget） |
| #743 | 2026-09-18 | Keep user-opened tools expanded across streaming updates | 3 | `b42d3f40` | 无 |
| #744 | 2026-09-18 | Render apply_patch tool calls (GPT) as split diffs | 7 | `e70c367f` | 部分（lib/apply-patch.ts + diff-intraline 有 split diff 基础，缺 GPT apply_patch 渲染组件） |
| #735 | 2026-09-18 | feat: preview image attachments in the chat composer | 2 | `d2056b6d` | 无（composer 图片预览） |
| #777 | 2026-09-18 | Show the reasoning level of the running turn | 13 | `3f07a5ff` | 无 |
| #796 | 2026-09-18 | fix: see sessions written by another pi process | 12 | `b44017a2` | 部分（session-reader-external-write 有，但「别的 pi 进程写的会话」全链路未确认） |
| #819 | 2026-09-18 | docs(AGENTS): document PI_WEB_IDLE_TIMEOUT_MS for session idle shutdown | 1 | `5b96a9d6` | n/a（文档） |
| #820 | 2026-09-18 | docs(AGENTS): sync API file map with app/api routes | 1 | `6edbecb4` | n/a（文档） |
| #821 | 2026-09-18 | docs(AGENTS): list plugin-updates helper in lib file map | 1 | `ed7a4d71` | n/a（文档） |
| #790 | 2026-09-18 | Add a full-width toggle to the file panel | 8 | `ffb2dafc` | 部分（有 full-width toggle? 未确认） |
| #811 | 2026-09-19 | fix: use crypto randomUUID for manual-code handshake tokens | 1 | `47a0bb2f` | 部分 |
| #809 | 2026-09-19 | fix: close SSE streams on shutdown so Next 16 drain cannot strand a zombie node | 2 | `1f791742` | 部分（rpc-manager-shutdown 有） |
| #810 | 2026-09-19 | fix: count only visible messages toward the session tail budget | 2 | `50a2fd43` | 无 |
| #807 | 2026-09-19 | Name sessions from a bounded transcript | 2 | `974c8bb3` | **已有**（lib/session-title.ts 带 transcript budget，比 #787 更完整） |
| #825 | 2026-09-19 | feat(sidebar): make conversation and file panes resizable | 8 | `ed50d888` | 部分（panel-layout.ts 有布局常量） |
| #823 | 2026-09-19 | fix(cli): disable Wasm lazy compilation on RISC-V | 3 | `404923e0` | n/a |
| #827 | 2026-09-19 | fix(plugins): normalize relativePath separators for Windows | 1 | `fce666a9` | n/a |
| #826 | 2026-09-19 | Show tool-result images while the tool card is collapsed | 5 | `d11d3448` | 无 |
| #828 | 2026-09-19 | feat(chat): add /auto-compact slash command to toggle auto-compaction | 7 | `f2d600ba` | 无（/auto-compact 开关） |
| #833 | 2026-09-19 | fix(models): include extension-registered providers in settings and auth routes | 5 | `79894b9a` | **已有**（lib/model-runtime.ts createModelRuntimeWithExtensions） |
| #830 | 2026-09-19 | fix: surface when a response is truncated by the output limit | 8 | `c8449730` | 部分（compaction-summary.ts） |
| #837 | 2026-09-19 | fix(plugins): run npm update checks without the npm.cmd shim on Windows | 4 | `afd2575f` | **已有/等价**（lib/plugin-updates.ts + skill-updates.ts；Windows npm-cli.js 由 npx.ts 处理） |
| #835 | 2026-09-19 | fix(streaming): stop duplicating the first streamed chunk | 2 | `002400d4` | 无 |
| #839 | 2026-09-19 | fix: preserve extension widget order on updates | 3 | `8df5132d` | 部分（extension-widgets.ts） |
| #841 | 2026-09-19 | fix(file-viewer): honor #page= fragments in PDF links | 13 | `5e9b997d` | 部分（file-viewer-state.ts 有 #page? 需确认） |
| #844 | 2026-09-19 | feat(models): show OpenCode Go provider usage quota | 3 | `6e95fbae` | **已有**（lib/provider-usage.ts + ProviderUsageSummary） |
| #879 | 2026-09-19 | fix(pwa): bound navigation and asset fetches so a dead upstream cannot hang | 2 | `b4a4539d` | 部分 |
| #886 | 2026-09-19 | fix(subagents): report provider stream errors as failed runs | 2 | `9d282da8` | 部分（subagent-status.ts） |
| #847 | 2026-09-19 | Include the subagent session ID in foreground completion text | 3 | `20a25799` | 无 |
| #846 | 2026-09-19 | fix: raise Next.js proxy body buffer so large uploads work | 2 | `31f0505d` | **已有**（lib/max-body-size.ts / bounded-form-data.ts） |
| #853 | 2026-09-19 | feat(文件浏览器): 变更文件列表增加"提及"按钮及路径中间省略 | 1 | `be38e5d8` | 部分（composer-references.ts + file-mentions.ts） |
| #855 | 2026-09-19 | fix: keep selection toolbar above the session sidebar | 2 | `f3a4ff62` | 部分（selection toolbar 层级由皮肤 CSS 决定） |
| #868 | 2026-09-19 | feat(plugins): show package description in the Plugins panel | 7 | `38cba2b4` | 无 |
| #845 | 2026-09-19 | feat: scroll to latest button | 9 | `1eb5e66a` | **已有**（i18n chat.jumpToLatest + scroll-follow.ts） |
| #887 | 2026-09-22 | feat(sessions): remember the open session per browser tab | 7 | `ef1de895` | **已有**（lib/tab-session.ts + right-tabs-memory.ts） |
| #930 | 2026-09-22 | feat(models): enabledModels switches in Settings → Models, as minimal edits | 18 | `50f6cce9` | **已有**（components/EnabledModelsSection.tsx） |
| #931 | 2026-09-22 | chore(deps): upgrade pi to 0.87.0 | 26 | `da1b28b2` | **差距最大的一项**：pi 0.87.0 → 0.99.1（我们还在 0.87.0） |
| #932 | 2026-09-22 | fix(ui): make scrollbars grabbable and show one in the chat (#873, #788) | 2 | `5933184f` | 部分（皮肤里 scrollbar 另有一套） |
| #933 | 2026-09-22 | fix(chat): reopen the session event stream under Strict Mode effect re-runs | 3 | `0b307d56` | 部分 |
| #934 | 2026-09-22 | feat(subagents): switch individual built-in sub-agents off (#874) | 10 | `f07d4a27` | **已有**（lib/subagent-settings.ts isBuiltInSubagentsEnabled + ADR 0003/0005） |
| #935 | 2026-09-22 | fix(subagents): mark background results as non-user messages (#875) | 5 | `54aa49ce` | 部分（subagent-status.ts） |
| #936 | 2026-09-22 | fix(tools): stop overriding settings.json defaultTools on new sessions (#700) | 13 | `03a9f5d8` | 无 |
| #937 | 2026-09-22 | fix(subagents): drop the completion notification for an already collected result (#889) | 5 | `12d3599b` | 无 |
| #938 | 2026-09-22 | feat(models): add a manual "Refresh catalog" button to the Models panel (#914) | 9 | `058341d8` | **已有**（lib/model-catalog-refresh.ts + /api/models/refresh） |
| #939 | 2026-09-22 | feat(minimap): show a per-turn tool-call count in the hover preview | 6 | `1bd40e4a` | **已有**（components/ChatMinimap.tsx） |
| #940 | 2026-09-22 | perf(session): #928 + #912 rebased onto main, with fixes | 28 | `234e19ee` | **已有**（session-view-cache / chat-lazy-load / session-reader.pagination 一套） |
| #948 | 2026-09-23 | chore(deps): trim the production install and bump next, semver, undici | 2 | `79c2a44a` | n/a（依赖升级） |
| #949 | 2026-09-23 | feat(demo): static Pi Web demo for GitHub Pages | 272 | `4857da3f` | **已有**（pi-codex-release / desktop-dmg 分支） |
| #950 | 2026-09-23 | fix(demo): CI typecheck, downloads on Pages, README auto-tab | 6 | `96966e5f` | n/a（CI/README） |
| #884 | 2026-09-29 | feat(chat): continue Markdown lists on new lines in the composer | 3 | `fd037e47` | **已有**（lib/markdown-list.ts + ChatInput） |
| #871 | 2026-09-29 | fix: do not persist new-session model picks into global defaults | 21 | `6a1246e9` | 部分 |
| #996 | 2026-09-29 | feat(default-cwd): create dated folders under ~/pi-cwd using the local date | 7 | `433d09ea` | **已有**（app/api/default-cwd 造 ~/pi-cwd-YYYYMMDD） |
| #907 | 2026-09-30 | feat(sidebar): open workspace in the system file manager | 9 | `a0c00f37` | **已有**（app/api/open-in-explorer + lib/open-in-file-manager.ts） |
| #941 | 2026-09-30 | fix: group a turn whose anchor falls outside the first history page | 2 | `69882b9f` | 无 |
| #946 | 2026-09-30 | fix(subagents): resolve `ext:` selectors for scoped npm names and whole-extension wildcards | 4 | `162a749c` | 部分 |
| #961 | 2026-09-30 | fix(chat): let a long extension dialog title shrink instead of hiding the options | 2 | `46b52356` | **已有**（lib/dialog-title.ts splitDialogTitle head/rest） |
| #968 | 2026-09-30 | fix(chat): tell unanswered output truncation to compact instead of retrying | 13 | `342fc9a2` | 部分 |
| #969 | 2026-09-30 | fix(models): save a typed provider name with the Save button | 7 | `bd85004d` | **已有**（ModelsConfig 保存自定义 provider 名） |
| #1007 | 2026-09-30 | fix: confirm force removal for submodule worktrees | 6 | `4cc07706` | 部分（worktree.ts） |
| #1008 | 2026-09-30 | fix(chat): report compaction instead of "waiting for model" during auto-compaction | 5 | `2e66e400` | 部分（compaction-summary.ts + ChatWindow 注释） |
| #1009 | 2026-09-30 | fix(chat): branch a history edit only when it is sent | 5 | `7303179c` | 部分（session-revision.ts） |
| #1010 | 2026-09-30 | Review follow-ups for #907, #946 and #968 | 16 | `fe288c05` | 部分（ADR 0006 不在，我们有 0001-0005） |
| #1011 | 2026-09-30 | fix(chat): collapse process details once a turn's answer appears | 2 | `0bae9b6c` | 部分（thinking-expansion-preference） |
| #1012 | 2026-09-30 | fix(models): do not open the keyboard when the model picker opens on mobile | 2 | `92ae057b` | 部分 |
| #972 | 2026-09-30 | fix: stop autolink literals at CJK punctuation | 5 | `4a5081a3` | **已有**（lib/markdown.ts CJK autolink） |
| #976 | 2026-09-30 | fix: preserve currency formatting alongside inline math | 3 | `6a97d0b1` | 部分 |
| #974 | 2026-09-30 | fix(agent): report the system prompt before a session's first message | 3 | `6f929836` | 部分（exact-system-prompt.ts） |
| #989 | 2026-09-30 | fix(subagents): key the collected-result mark by run, not session (#987) | 5 | `c8ff7e8c` | 部分（subagent-status.ts） |
| #990 | 2026-09-30 | fix(subagents): report a run orphaned by a restart as interrupted | 3 | `00156d5b` | 部分 |
| #991 | 2026-09-30 | fix(subagents): say when a background report comes from a resumed run | 6 | `2a71c578` | 部分 |
| #981 | 2026-09-30 | Add directory creation to the folder picker | 8 | `680db65c` | **已有**（components/DirectoryPicker.tsx kind:"create"） |
| #992 | 2026-09-30 | fix(ui): keep the mobile composer above the keyboard and give typing more room | 6 | `390e70fd` | 部分（皮肤有移动端 composer 处理） |
| #997 | 2026-09-30 | fix(agent-events): bound the per-client SSE backlog | 2 | `6b0c6a54` | 部分（agent-event-stream 有 backlog? 需确认） |
| #1001 | 2026-09-30 | feat(settings): configurable send key (Enter or Ctrl+Enter) | 9 | `5df8278a` | **无**（无可配置发送键） |
| #1006 | 2026-09-30 | feat(models): resolve the discovery endpoint from pi's provider catalog | 5 | `d8f89c51` | **已有**（lib/model-discovery.ts + /api/models-config/discover） |
| #1017 | 2026-09-30 | fix(sessions): reap a run Stop cannot unwind when idle shutdown is disabled | 3 | `9ede521b` | 部分 |
| #1016 | 2026-09-30 | fix(bash): let Stop end a command whose output a survivor holds open | 5 | `f5e768e5` | **已有**（lib/bash-output.ts + /api/agent/[id]/bash-output） |
| #1015 | 2026-09-30 | fix(chat): keep typed line breaks in user messages | 5 | `faeff036` | **已有**（lib/markdown.ts preserveNewlines） |
| #1019 | 2026-09-30 | fix(compat): load on Safari and iOS 16.2 | 7 | `f52fd840` | 部分（Safari 相关零散处理） |
| #1014 | 2026-09-30 | fix(files): let Git decide what the file tree hides | 6 | `13bc2b0b` | **无**（文件树没有「让 Git 决定隐藏什么」） |
| #1020 | 2026-09-30 | feat(settings): Enable all / Disable all for Skills and Plugins | 16 | `eceac13b` | 部分（SkillsConfig/PluginsConfig 有开关，未确认 Enable all / Disable all） |
| #1018 | 2026-09-30 | fix(files): let the operator open symlinked folders outside the project | 12 | `687af277` | **已有**（lib/path-security.ts realpath + allowed-roots） |
| #1021 | 2026-09-30 | refactor(settings): switch skill and plugin groups from their headings | 12 | `b9622a19` | 部分 |
| #1022 | 2026-09-30 | feat(chat): change the reasoning level while a run streams | 4 | `d0bf6bee` | 部分（thinking-request-core.ts） |
| #1023 | 2026-10-01 | feat(chat): fork a session while it is running | 12 | `19774b84` | **无**（运行中 fork 会话） |
### 2a. §2 里我们**确实没有**的（只有 4 条 + 依赖升级）

| PR | 是什么 | 备注 |
|---|---|---|
| **#931 + `d0bf6be`** | **pi 0.87.0 → 0.99.1** | 最大的单点差距。上游把 pi 从 0.87 一路升到 0.99（含 MCP 原生、subagent、ADR 0006）。**先做这个**，它会连带解锁 MCP / 会话 / 工具侧一整批能力 |
| #1001 | 可配置发送键（Enter / Ctrl+Enter） | 小而独立，9 个文件 |
| #1014 | 「让 Git 决定文件树隐藏什么」（gitignore 感知） | 6 个文件，`app/api/file-index/route.ts` 注释里还留着「Git-tracked repos rely on .gitignore」的说法，但我们没有真正接 git |
| #1023 | 运行中 fork 当前会话 | 12 个文件；我们有 in-session branch（BranchNavigator）和 rewind，但没有「跑着的时候分叉」 |

**其余 83 条**：要么我们已用自己方式做了（`#807 #844 #846 #846 #872 #972 #981 #887 #930 #938 #939 #940 #1006 #996 #907 #884 #961 #969 #1015 #1016 #1018 #934` 等），要么是文档/deps/demo（`#819 #820 #821 #848 #950 #949`），要么是纯 bugfix 小补丁需要逐条挑（`#730 #732 #733 #743 #744 #735 #777 #790 #810 #811 #825 #828 #835 #839 #841 #879 #886 #847 #853 #855 #868 #932 #933 #935 #936 #937 #946 #968 #971 #989 #990 #991 #992 #997 #1007 #1008 #1009 #1010 #1011 #1012 #974 #1017 #1020 #1021 #1022`）。

---

## 3. closed-unmerged 候选评估（本次重点）

方法：275 条全量过标题/正文做粗筛 → 挑出 **38 条**「看起来有实际功能」的拉 `.diff`（`curl -sL .../pull/NN.diff`，不消耗 API 配额）→ 对这 38 条跑 `git -C /Users/yingjing/Desktop/pi-codex apply -3 --check` → 抓 **30 条** PR 评论（`GET /issues/NN/comments`）看维护者的具体关闭理由 → 回本地 grep 确认「我们已有等价实现」。

`apply -3 --check` 结果含义：
- **CLEAN** = 3-way 可直接落到我们 main（0 冲突）
- **CONFLICT(k/n)** = n 个文件里 k 个冲突
- **NOBLOB** = `-3` 找不到可用的 blob 兜底（文件在我们这边不存在/改动过大），必须人工接线

### 3.1 维护者的关闭理由分类（这是本次最有价值的产出）

抓到的评论里，理由高度集中：

| 关闭理由 | 代表 PR | 对我们的含义 |
|---|---|---|
| **「会话组织要整体重设计，别先加零散件」** | #713 #710 #921 #982 #959 #697 | **我们 fork 已经做完了这次重设计**（`lib/session-groups.ts` 分组 / `lib/session-flags.ts` pinned+archived / `ArchivedSessionsPanel` / `SessionSearch` / 项目行拖拽）。这批 PR 大半对我们**已过时** |
| **「Pi Web 是 pi 的薄前端，X 是 agent 的活」** | #899 文件管理器 #726 文件 minimap #872 变更树 #863 side chat #832 subagent dispatch #911 web-plugins #510 ask_user | 这是维护者的**产品边界主张**。我们 fork 已经在多处突破这条线（CodeFileEditor、BrowserPanel、ImportPanel），所以这条不自动成立——但要按「新增维护面」算账 |
| **「pi 0.99 原生做了，先升 pi」** | #893 #900 | 解法是升 pi（见 §2a），不是捡 PR |
| **「被合并版取代」** | #787→#807 #792→已在 v0.9.1 基线 #967→#1009 #963→#1008 #902→#1007 #894/#895→#981 #409→#410 #515→#597 | 别捡 superseded 的 |
| **「维护者复现不出来 / 论证不足」** | #615 #977 | 需要我们自己复现，不能因为「被关了」就丢，也不能因为「作者证据充分」就照抄 |
| **作者自查关闭** | #984（作者自己拆成 7 个 PR） | 看系列里的后续条目 |

### 3.2 逐条评估：真缺口 / 值得看（12 条）

---

#### ① #615 `fix(security): tolerate Chromium 150+ stripping port from Origin while keeping port CSRF defense`
- **关闭日** 2026-09-05（批量清理日之一）；作者 LCZcoding
- **关闭原因**：维护者 agegr 回复「我在 Chrome 152.0.7977.83 的 Win/macOS、以及 headless 152 + 本地回显服务器上都复现不出来」——**不是判定为错，是没能复现**。
- **文件（2）**：`lib/request-security.ts`、`lib/request-security.test.mjs` — +175/-2
- **apply -3 --check**：**CLEAN**
- **本地核对**：我们的 `lib/request-security.ts` 里 `isApiRequestOriginAllowed()` 只有两条放行路径——严格 `canonicalOrigin(origin) === requestOrigin` 和 `isProxyRewrittenSameOrigin()`（要求 `x-forwarded-proto` 存在且 authority 全等）。**没有「Origin 被剥掉端口」的分支**，所以我们跑在非默认端口（`http://127.0.0.1:30141`）时同样会 403。我们的测试也只有 `rejects an origin that does not match the external request host`，没有对应放行用例。
- **判断**：**真缺口，值得拉**。补丁小、自包含、带 7 个针对性测试（含跨端口 CSRF、https 降级、DNS rebinding 三个反例），正是我们这种「本机/LAN + 非标准端口」部署形态会踩的坑。
- **动作**：`apply -3 --check` 已 CLEAN，但**它改的是安全边界**，务必人工读一遍 `isChromePortStrippedSameOrigin()` 的四条断言再合，不要盲合。

---

#### ② #840 `feat: show this reply's Diff on written-file cards`
- **关闭日** 2026-09-14；作者 Kitten9533；**PR 上零评论**（作者没再推，维护者也没评）
- **文件（10）**：`components/TurnWrittenFiles.tsx`(+test)、`components/MessageView.tsx`、`components/SplitPatchView.tsx`、`lib/turn-written-files.ts`(+test)、`lib/patch.ts`、3 个 i18n — +604/-231
- **apply -3 --check**：CONFLICT(3/10)
- **本地核对**：`components/TurnWrittenFiles.tsx` 里我们自己写了注释——「画板里的『+2 −0』增删计数**产品数据模型没有**（WrittenFile 只有路径），按结构照实现不上」。也就是说**我们明确知道这个缺口存在并且当时是故意留的**。底层 `lib/patch.ts` 有 `parseUnifiedPatch()`，`lib/apply-patch.ts` 在，缺的是 diff 展示组件。
- **判断**：**真缺口，值得拉**。「这条回复到底改了什么」是高频需求，而我们现在只能跳到文件或看 Git 总 diff。
- **动作**：需要人工接线——`SplitPatchView.tsx` 是新文件可直接取，`TurnWrittenFiles.tsx` / `turn-written-files.ts` / `i18n` 要按我们的 `pw-chip` 皮肤重画（我们有自己的画板 53 帧 B 规格）。

---

#### ③ #713 `feat(sessions): add project-scoped trash`
- **关闭日** 2026-09-15；作者 Zhangs-11
- **关闭原因（作者原话）**：「I plan to redesign session organization」——**推迟，不是拒绝**。且作者自己追问「考虑到你要重设计会话组织，project-scoped trash 作为独立特性你愿意收吗」，维护者没回。
- **文件（18）**：新增 `lib/session-trash.ts`(+test)、`app/api/sessions/trash/route.ts`、`app/api/sessions/trash/[id]/restore/route.ts`、`components/SessionTrashDialog.tsx`(+test)；改 `app/api/sessions/route.ts`、`app/api/sessions/[id]/route.ts`、`components/SessionSidebar.tsx`、`components/AppShell.tsx`、3 个 i18n、`lib/types.ts` — +1224/-1
- **apply -3 --check**：CONFLICT(5/18)
- **本地核对**：**我们确实没有回收站**。`components/SessionSidebar.tsx` 里只有 `data-ico="trash-2"` 的**图标**，没有 `lib/session-trash.ts`、没有 `/api/sessions/trash` 路由。我们只有 `ArchivedSessionsPanel`（软归档到 localStorage，不是文件系统回收站）。
- **判断**：**真缺口，值得拉（但只取后端一半）**。维护者推迟的理由是「会话组织要重设计」——**我们已经重设计完了**，所以他的阻塞理由对我们不成立。语义也扎实：按 family 整体移动、restore 不覆盖、30 天 purge、崩溃回滚。
- **动作**：需要人工接线。建议**只取 `lib/session-trash.ts` + 两个 API 路由**（纯后端、冲突面小），UI 用我们自己的 `pw-*` 皮肤重写，别去解 `SessionSidebar.tsx` 的 5 个冲突。

---

#### ④ #998 `fix(sessions): do not treat a session with delegated work as idle`
- **关闭日** 2026-09-30（Lite 系列关闭日）；作者 HoloNova
- **关闭原因**：维护者一次性关掉整个 Lite 系列（#999/#1000/#1002/#1004），理由是「这是整个 app 的第二种运行模式」。**#998 是系列里的一个 bugfix，被连坐关闭**。
- **文件（6）**：新增 `lib/delegated-work.ts`(+test)、`lib/rpc-manager-delegated-reclaim.test.mjs`；改 `lib/rpc-manager.ts`、`lib/subagent-runtime.ts`、`app/api/agent/running/route.ts` — +625/-8
- **apply -3 --check**：**NOBLOB**（`lib/rpc-manager.ts` / `lib/subagent-runtime.ts` 在我们这边改动过大，`-3` 兜不住）
- **本地核对**：**这里有个真洞**。我们 `lib/rpc-manager.ts:518` 的空闲判定是
  `if (!this.forceShutdownOnIdle && (this.isRunning() || hasActiveSessionLivenessProvider({...})))`，而 `isRunning()` 只描述 wrapper 自己这一轮。`app/api/agent/running` 也只用 `getRunningRpcSessionIds()`（基于 `isRunning()`）。**我们没有 `isBusy()`（自己这轮 OR 有委派子任务在跑）这个概念，也没找到 subagent 往 `session-liveness` 注册 provider 的代码。**
- **判断**：**真缺口，值得拉思路**。「父回合已返回但异步 subagent 还在跑 → 被误判空闲 → idle shutdown 把子进程一起杀掉」是我们同样存在的正确性风险。
- **动作**：需要人工接线。**只抄语义不抄实现**：它的实现是「扫 artifact 目录 mtime」，那依赖上游的 session artifact 目录布局，我们 fork 的 `lib/subagent-runtime.ts` 是另一套结构。要做的是给我们的 subagent 运行时加一个「有活跃子任务」的查询，接到 `resetIdleTimer()` 和 `/api/agent/running` 上。

---

#### ⑤ #957 `feat(models): auto-fill context window / max output tokens and add presets`
- **关闭日** 2026-09-30；作者 jokinas
- **关闭原因（维护者原话节选）**：「Parsing the limits that `/models` already returns is a good idea (it's what #856 asks for). I'm closing this version, though, because **the other two parts don't fit**: Discovery state now leaks between providers…（effect deps 变成 `[]`，重置逻辑丢了）」
- **文件（8）**：`lib/model-discovery.ts` 侧的解析、`components/ModelsConfig.tsx`(+test)、3 个 i18n — +505/-88
- **apply -3 --check**：CONFLICT(3/8)
- **本地核对**：我们的 `lib/models-config-store.ts` 里 grep `contextWindow` **零命中**；`lib/model-discovery.ts` 只抽 `id`/`name`。→ **第一半（解析上游已经返回但被丢弃的 `context_window` / `max_output_tokens` 等字段，多种拼写 + 嵌套两层）是干净的正收益**；后两半（预设、重构 discoveryState）是被明确点名的缺陷，不要拿。
- **判断**：**部分值得拉**。
- **动作**：需要人工接线——只取 `parseDiscoveredModels()` 的 limits 解析 + `fillEmptyModelFields()` 的优先级，复用我们已有的「填入模型信息」按钮，不碰 discoveryState。

---

#### ⑥ #861 `feat: one-click 60-second shutdown button with countdown and cancel`
- **关闭日** 2026-09-16；作者 NewBugMakerHREAT；**零评论**（被批量清理带走）
- **文件（11）**：新增 `app/api/shutdown/route.ts`、`lib/shutdown-timer.ts`(+test)、`lib/shutdown-commands.ts`、`components/ShutdownButton.tsx`、`components/ShutdownConfirmDialog.tsx`；改 `components/AppShell.tsx`、`instrumentation.ts`、3 个 i18n — +715/-0（纯增量，没删东西）
- **apply -3 --check**：CONFLICT(1/11)
- **本地核对**：我们**没有** `app/api/shutdown`，`instrumentation.ts` 也没有关机钩子（我们只有 `lib/rpc-manager-shutdown.test.mjs` 测的是**会话**关停，不是机器）。`lib/pi-types.ts` 里那条「Extension requested shutdown, but shutdown is not supported in PI NEXT」说明我们是**产品层面拒绝关机**的。
- **判断**：**真缺口，但价值取决于部署形态**。我们 fork 定位是局域网/手机远程驱动本机（README 里有 BrowserPanel、PWA、mobile toolbar），一键关机 + 60 秒可撤销倒计时确实是这个形态的刚需。**代码本身很干净**（+715/-0，状态机 `idle→counting→done` + 倒计时跨服务端重启存活）。
- **动作**：需要人工接线，且**先做产品决策**——我们 fork 明确删掉了登录页「本产品没有登录」的同类取舍，关机按钮要不要先过一遍同样的评审。技术侧建议只取 `lib/shutdown-timer.ts` + `app/api/shutdown/route.ts`，UI 自己画。

---

#### ⑦ #787 `Generate session titles from a lightweight text transcript`
- **关闭日** 2026-09-12；作者 uvforce
- **关闭原因（作者原话）**：「**Superseded by #807**, which adds a fixed total transcript budget, head/tail coverage, measured title-quality checks…」
- **文件（2）**：`lib/session-title.ts`(+test) — +174/-296（净减行）
- **apply -3 --check**：**CLEAN**
- **本地核对**：我们的 `lib/session-title.ts` 已经有 `TITLE_PROMPT`、`buildTitleRequest()`、**总预算 + 首尾配额**（注释：「Total budget across all messages」「Share of the budget reserved for the opening turns」）——**这就是 #807 的东西，我们已经有了**。
- **判断**：**不建议拉**。被合并版取代，且我们已有等价（且更完整）的实现。
- **动作**：放弃。

---

#### ⑧ #792 `fix: preserve the streaming partial when switching back to a running session`
- **关闭日** 2026-09-11；作者 infinitex233
- **关闭原因（维护者原话）**：「Closing as superseded. The same streaming-resume fix is already included on main in commit 4787a14」
- **文件（4）**：`hooks/useAgentSession.ts`(+test)、`lib/streaming-message.ts`(+test) — +46/-1
- **apply -3 --check**：**CLEAN**（因为 base 里已经有了，所以 diff 空转）
- **本地核对**：`git merge-base --is-ancestor 4787a14 v0.9.1` → **YES**。修复已经在我们 v0.9.1 基线里。
- **判断**：**不需要**。已经在我们基线中。
- **动作**：放弃。

---

#### ⑨ #977 `fix: preserve tool execution phase across result messages`
- **关闭日** 2026-09-30；作者 nannant666
- **关闭原因（维护者原话）**：「I traced the event order in pi's agent loop and **couldn't find a path where this race happens** — Tool results never overlap a running tool…」
- **文件（4）**：把 `AgentPhase` 拆成纯模块 + 事件路由改动 — +159/-40
- **apply -3 --check**：**CLEAN**
- **本地核对**：我们的 phase 机在 `hooks/useAgentSession.ts`（`AgentPhase` = `running_tools | waiting_model | running_command | idle`），`components/ChatWindow.tsx:127 phaseLabel()` 只读。我们另有 `lib/tool-execution-progress.ts` / `lib/step-categorizer.ts`。
- **判断**：**存疑，不建议直接拉**。维护者明确反驳了竞态存在；而且我们在 v0.9.1 → 0.99.1 之间的 pi 升级本身就会改 agent loop 的事件顺序，此刻动 phase 路由是**在错误的基线上修一个可能不存在的 bug**。
- **动作**：放弃（若将来真在 UI 上看到「工具还在跑却显示等待模型」，再回来读它的纯函数并自己写用例）。

---

#### ⑩ #710 `feat(sessions): add drag-and-drop ordering`
- **关闭日** 2026-09-05；作者 Zhangs-11
- **关闭原因（维护者原话）**：「I plan to redesign session organization, so I'm closing this PR for now and will revisit ordering as part of that work.」
- **文件（4）**：`components/SessionSidebar.tsx`(+test)、`lib/session-order-state.ts`(+test) — +308/-10
- **apply -3 --check**：**CLEAN**
- **本地核对**：我们 `SessionSidebar.tsx` 的拖拽只挂在**项目行**（`draggable={drag.draggable}` + `components/fork/GroupedProjectList.tsx` 的 `useProjectDrag`），**会话行没有拖拽**。另外 `lib/session-flags.ts:191` 的注释已经写了「pinned ones move to the top / does not reshuffle」——我们已经有「手动置顶打乱后续活动排序」这个语义。
- **判断**：**真缺口但价值低**。维护者的阻塞理由（会话组织重设计）对我们已经失效，可我们的侧栏刚做完皮肤重写（画板 01/02 的 `.pw-row`），会话行拖拽要重做 drop indicator、FLIP、触摸端冲突——投入产出比一般。
- **动作**：低优先级排队；`lib/session-order-state.ts` 是纯模块可以**直接取**（CLEAN 且不碰我们的组件），UI 后置。

---

#### ⑪ #872 `feat: add a compact tree view for changed files`
- #872 关闭日 2026-09-16，**维护者原话**：「this is well built (path compaction, status roll-up, persisted view mode, tests), but I'm closing it **on scope**. The explorer's changes pane is meant to be a quick flat list… a second, VS Code-style tree mode… is ~500 lines of IDE chrome」
- **文件**：`components/FileExplorer.tsx`(+test)、`lib/file-explorer-state.ts`(+test)、`lib/git-status.ts`(+test)、`lib/file-paths.ts`(+test)、`lib/search-tree.ts`(+test)、3 个 i18n — +491/-16
- **apply -3 --check**：CONFLICT(3/13)
- **本地核对**：我们有 `lib/search-tree.ts`（`buildSearchTree`），但 `components/FileExplorer.tsx:16` 是拿它做**搜索结果树**的；**git changes 面板仍是平铺列表**（`grep viewMode` 无命中）。→ **确认是真缺口**。
- **判断**：**中等价值 + 需要产品决策**。作者质量被维护者认可（明确说 "well built"），只被「这是 IDE chrome」否掉。我们 fork 已经在多处选择「IDE 化」（CodeFileEditor 内联编辑、BrowserPanel），所以这条拒绝对我们不自动成立；但它确实是 +491 行长期维护面。
- **动作**：需要人工接线，且**先决定要不要**。`lib/git-status.ts` 的状态归并（add/modified/deleted/renamed/mixed/conflict 折叠成文件夹色点）是真正值钱的部分，可以只取这段。

---

#### ⑫ #893 / #900 MCP 系列
- **关闭日** 均 2026-09-30
- **关闭原因（维护者原话，两条一致）**：「I'm closing this because **pi 0.99 now supports MCP natively**… An MCP panel should then read pi's own server state. The remaining work is **upgrading to 0.99 and wiring `createMcpExtension()` into our resource loader**.」
- **文件**：#893 13 个（`components/McpConfig.tsx`、`lib/mcp-config-store.ts`(+test)、`app/api/mcp/route.ts`(+test)、ADR 0004）；#900 13 个（`components/McpPanel.tsx`(+test)、`lib/mcp-servers.ts`(+test)、`lib/mcp-server-status.ts`）
- **apply -3 --check**：#893 CONFLICT(1/13)、#900 CONFLICT(1/13)
- **本地核对**：我们 `package.json` 是 **pi 0.87.0**；`app/api/mcp/` 存在（`discover` + `route.ts`），`lib/mcp-discovery.ts` / `lib/mcp-config-file.ts` / `lib/mcp-validator.ts` / `lib/mcp-auth-command.ts` 都在，`AppShell.tsx` 有 MCP 状态图标和分支 `feat/mcp-panel-470`。
- **判断**：**不建议拉**。维护者给的路更短也更对：升 pi 到 0.99 → `createMcpExtension()` → 面板读 pi 自己的 server 状态。#893 的项目级 `mcp.json` 信任门禁在 0.99 里是内置行为，#900 明确只兼容 `pi-mcp-adapter`（而装了 adapter 会关掉原生 MCP）。
- **动作**：放弃这两个 PR，转而推进 §2a 的 **pi 0.87 → 0.99.1 升级**。


### 3.3 我们**已有等价实现**——明确不建议拉（11 条）

这一节是本次审计里最想强调的：**这批 closed-unmerged 里，真正值得看的不到 10 条**。

| PR | 标题 | 关闭原因 | 我们 fork 的等价实现（已 grep 确认） | apply -3 |
|---|---|---|---|---|
| #618 | full-text search over past conversations | 维护者：「I've implemented a simpler version… closing in favor of that implementation」 | `lib/session-search.ts`（`searchSessionContents`）+ `app/api/sessions/search/route.ts` + `components/SessionSearch.tsx` + `components/fork/` 搜索模式 | CONFLICT(9/24) |
| #664 | feat(files): add video preview support | 批量清理 | `lib/file-types.ts` 的 `isVideoPath` + `components/FileViewer.tsx:945 VideoViewer`（含 watch badge、时长、大小、下载、`<video>` 错误处理） | CLEAN（但已存在） |
| #696 | feat: add read-only plan mode | 维护者：「The existing read-only tool preset covers the main use case」 | `lib/plan-mode.ts` + `lib/plan-mode-extension.ts` + `lib/permission-mode.ts` | CONFLICT(1/8) |
| #697 | organize conversations into folders | 维护者：「session organization needs a different interaction design… 我会单独实现 grouping」 | `lib/session-groups.ts`（create/rename/delete/collapse/moveProject）+ `lib/session-list-groups.ts` + `components/fork/GroupedProjectList.tsx` | CONFLICT(2/7) |
| #899 | 文件浏览器增删改/下载/压缩包/内联编辑 | 维护者：「Pi Web is meant to stay a thin front end… editing and managing files is the agent's job」 | `lib/file-mutations.ts`、`lib/file-archives.ts`、`lib/archive-names.ts`、`components/CodeFileEditor.tsx`、`components/ContextMenu.tsx`（我们**已经**做了维护者拒绝的那一版） | CONFLICT(6/18) |
| #951 | open and reveal paths in the OS file manager | 维护者：「We'd decided to go with the narrower #907」 | 上游 #907 已合并且**我们已有**：`app/api/open-in-explorer` + `lib/open-in-file-manager.ts` | CONFLICT(7/18) |
| #921 / #982 | configurable pinned sessions / cross-project Active view | 维护者：「session management… is going to be redesigned as a whole」 | `lib/session-flags.ts`（`pinned` / `archived` / `archivedAt` / `tags`，`togglePinned`）+ `ArchivedSessionsPanel` + `ProjectArchivePanel` + `lib/recent-projects.ts` | #921 CONFLICT(2/11) |
| #897 | fix(sessions): restore per-tab session after hydration | 维护者自己开的 PR 又自己关（#887 已合） | `lib/initial-navigation.ts:35 withTabOpen()` —— **是 #897 `withTabOpenSession()` 的严格超集**（还多处理「新会话 composer」），SSR/hydration 注释一字不差 | CONFLICT(6/7) |
| #970 | keep extension dialogs readable and movable | 批量清理 | 已读部分：`lib/dialog-title.ts` 的 `splitDialogTitle`（head/rest）**和** `splitDialogTitleCode`（#724 的代码围栏高亮，我们已有）。只缺 `hooks/useDraggableDialog.ts` 的「可拖动」 | CONFLICT(3/9) |
| #528 | authorize downloads for wrapper apps via signed tokens | 批量清理 | **不适用**：我们 `proxy.ts` 注释明写「原来这里有一整套 PI_WEB_PASSWORD 门… 现在整段删除，**本产品没有登录**」。没有 Basic 认证就没有这个问题 | CLEAN（但场景不存在） |
| #963 / #967 / #902 / #894 / #895 / #409 / #515 | 自动压缩状态 / 历史编辑分支 / 子模块 worktree / 目录创建 / 重复点击会话 / 子进程停止原因 | 全部是已合并 PR 的重复或被取代版本（#1008 / #1009 / #1007 / #981 / #410 / #597） | 已在上游主线，且 §2 已核对 | — |

### 3.4 剩下的一律不建议评估的（按标题即可判定）

以下 275−(38 粗筛) ≈ 237 条，理由归为四类，不再逐条拉 diff：

1. **重复 PR**：`#441~#445`、`#37~#39~#67~#78`、`#25~#26`、`#136~#137~#138`、`#527~#528`、`#766~#771`、`#840~#843`、`#894~#895`、`#136…`（16 对相似对，标题相似度 ≥0.86）。
2. **纯 docs / deps / lockfile / README**：`#395 #592 #345 #396 #571 #852 #5 #405 #781` 等。
3. **上游已用别的方式做掉的**：见 §2 的 87 条清单。
4. **明确的「我不要」**：`#832/#831`（subagent dispatch API，维护者：「a programmatic dispatch API is out of scope for a web front-end」）、`#911`（web-plugins，维护者：「closing for scope reasons… a second plugin system means a versioned public contract」）、`#510`（ask_user，维护者中文回复：「暂不考虑在核心中内置该工具」）、`#1002/#1003/#1004/#999/#1000/#984`（Lite 系列，「这是整个 app 的第二种运行模式」）、`#696`（见上）、`#892`（默认目录日期命名「是有意为之」，而上游反手合并了做同样事的 #996）。
5. **低价值微功能 / 我方无对应场景**：`#441 #445 #249 #250 #60 #483 #619 #623 #553 #661 #677 #667 #684 #694 #725 #781 #854 #861 #862 #956 #1004` 中的聊天/桌面端类。

> 一条**反向**提醒：`#951`、`#899`、`#899` 这类「上游拒绝、我们已经做了」的情况说明**我们的产品边界比上游宽**（内联编辑、浏览器面板、导入面板、桌面 DMG）。所以「维护者以 scope 为由关掉」在我们的语境下**不是有效否决理由**，真正该算的是长期维护面。这个判断我按上面逐条给了结论，没有一刀切。
---

## 4. 推荐清单 Top 10（按「价值 / 冲突风险」排序）

排序原则：**真缺口 × 低冲突面 × 与我们「先升 pi 再谈功能」的路线不冲突** 排前面；产品边界类的、被上游主线取代的、需要大规模 UI 重画的排后面。

| # | PR | 标题 | 价值 | apply -3 | 建议动作 |
|---|---|---|---|---|---|
| 1 | **#615** | tolerate Chromium 150+ stripping port from Origin while keeping port CSRF defense | **高**（我们非默认端口部署会全站 403；补丁 2 文件、带 7 个反例测试） | **CLEAN** | **人工读一遍再直接 apply** —— 唯一真正 CLEAN 且是真缺口的 |
| 2 | **#998** | do not treat a session with delegated work as idle | **高**（正确性：异步 subagent 被 idle shutdown 连坐杀掉，我们同样有洞） | NOBLOB | **人工接线**：只抄 `isBusy()` 语义，别抄它的 artifact-mtime 扫描 |
| 3 | **#840** | show this reply's Diff on written-file cards | **高**（我们代码注释里自己写明这是已知缺口） | CONFLICT(3/10) | **人工接线**：`SplitPatchView.tsx` 直接取，UI 按画板 53 帧 B 重画 |
| 4 | **#713** | project-scoped trash | **中高**（真缺口；维护者的阻塞理由=会话组织重设计，**我们已做完**） | CONFLICT(5/18) | **人工接线**：只取 `lib/session-trash.ts` + 2 个 API 路由，UI 自绘 |
| 5 | **#957** | auto-fill context window / max output tokens | **中**（上游 `/models` 已经返回但被丢弃的字段，纯正收益；维护者明说这点是对的） | CONFLICT(3/8) | **人工接线**：只取 limits 解析，**丢弃**被点名的 discoveryState 重构 |
| 6 | **#710** | drag-and-drop session ordering | **中低**（真缺口；但我们侧栏刚做完皮肤重画，投入产出比一般） | **CLEAN** | **部分直接 apply**：取纯模块 `lib/session-order-state.ts`，UI 后置 |
| 7 | **#872** | compact tree view for changed files | **中低**（作者质量被认可 "well built"，只被「IDE chrome」否；我们已多处 IDE 化） | CONFLICT(3/13) | **需要产品决策**；只取 `lib/git-status.ts` 的文件夹状态归并 |
| 8 | **#861** | one-click 60-second shutdown with countdown | **中低**（真缺口，但需先过产品评审；+715/-0 代码很干净） | CONFLICT(1/11) | **人工接线**：取 `lib/shutdown-timer.ts` + `/api/shutdown`，UI 自绘 |
| 9 | **#918** | retry settings in General settings panel | **低**（我们有 `autoRetryEnabled` 透传但没有 UI；8 文件） | NOBLOB | 排队；只取 `lib/retry-settings.ts` + 路由 |
| 10 | **#481** | models request-header overrides | **低**（我们确实没有；但 8 文件且是纯配置面扩展） | CONFLICT(2/8) | 排队；`serializeHeaderRows()` 的「空值=占位不落盘」语义值得单独抄 |

### 4.1 明确**放弃**的（附理由，便于日后复查而不用重新调研）

| PR | 放弃理由 |
|---|---|
| #984 #999 #1000 #1002 #1003 #1004 | Lite 系列，维护者以「第二种运行模式」整组否；#984 作者自己已拆成 7 个 PR |
| #893 #900 | pi 0.99 原生 MCP；正解是升 pi（§2a） |
| #911 | 维护者以「不想有第二套插件契约」否 |
| #832 #831 | 维护者以「web 前端不做程序化 dispatch API」否 |
| #510 | 维护者中文回「暂不考虑在核心中内置该工具」 |
| #787 #792 | 分别被 #807 和已在 v0.9.1 基线的 4787a14 取代；我们已有等价 |
| #977 | 维护者反驳竞态存在；且我们在 pi 0.87 基线上修它为时过早 |
| #618 #664 #696 #697 #899 #951 #921 #982 #897 #970 #528 | 见 §3.3，**我们已有等价实现或场景不存在** |
| #967 #963 #902 #894 #895 #409 #515 | 已合并 PR 的重复/被取代版本 |
| #872 的其余部分 / #726 #863 | +491 ~ +1000 行 IDE chrome，维护者明确不愿维护；#863 side chat 概念新但 ~1400 行、需新会话概念，我们已有 `lib/chat-workspace.ts` + `lib/chat-only.ts` 走另一条路 |

---

## 5. 结论与遗留风险

1. **最高 ROI 的动作不在 closed-unmerged 里**：把 pi 从 **0.87.0 升到 0.99.1**（上游 `#931` + `d0bf6be`）。它一次性解决 MCP（#893/#900 的正解）、subagent 控制面、ADR 0006 记录的一批能力，也是我们和上游之间最大的一块技术债。
2. **closed-unmerged 里真值得拉的是 6~10 条，不是 275 条。** 40% 是批量清理，`sessions/sidebar`（69）+ `files/explorer`（56）两大类被维护者以「要整体重设计 / 是 IDE chrome」批量关掉——而这两块**我们已经重做过一遍了**，所以他的否决理由对我们不成立，但他的维护面顾虑仍然成立。
3. **只 CLEAN 的 7 条里，5 条我们已经不需要**（#664 #787 #792 #977 #528）。这说明 `apply -3` clean 不是采纳信号。
4. **风险 / 未尽事项**：
   - §2 的「我们已有等价实现」一列是 grep 级判断，标 **部分** 的 30 余条只做了文件级确认，**没有逐行核对**，采纳前需再验。
   - #615 是安全边界改动，即使 CLEAN 也必须人工评审（它放宽了 Origin 校验，虽然同时新增了跨端口/https 降级两道反证）。
   - `agegr/main` 在审计期间仍在推进（`e17d2cc` 是 2026-10-01 18:03 的提交），§2 的 87 条清单随时可能变化。
   - API 配额：本次共消耗 ~30 次（6 页 PR 列表 + 30 条评论），`github.com/.../pull/NN.diff` 走的是非 API 通道不计入。

### 复现命令

```bash
# 全量 closed PR（6 页）
for p in 1 2 3 4 5 6; do curl -sL "https://api.github.com/repos/agegr/pi-web/pulls?state=closed&per_page=100&page=$p" -o /tmp/closed-$p.json; sleep 1; done

# 单个候选：拿 diff + 试应用（不落盘）
curl -sL https://github.com/agegr/pi-web/pull/615.diff > /tmp/pr615.diff
git -C /Users/yingjing/Desktop/pi-codex apply -3 --check /tmp/pr615.diff; echo "rc=$?"

# 合并清单交叉核对
git -C /Users/yingjing/Desktop/pi-codex log v0.9.1..agegr/main --pretty='%H %s'
```

---

## 6. 审计过程的重要说明（必读）

1. **工作树在审计期间被另一个并发会话改动了。** 18:04 左右（我的 `apply -3 --check` 循环期间），工作树出现了一批修改与删除（`lib/cron-*`、`components/fork/CronConfig.tsx`、`lib/memory-*`、`lib/prompt-files.ts`、`components/SettingsPanel.tsx`、`lib/rpc-manager.ts` 等）。同时 `ps` 显示有并发的 `next dev -H 127.0.0.1 -p 30255`、`tsc --noEmit` 等进程以本目录为 cwd。
   **这不是我做的**，证据有二：
   - 我只运行了 `git apply -3 --check` / `git show` / `git log` / `git status` / `grep` / `read`，以及 `curl -o /tmp/...`；我在 `/tmp/gatest` 单独验证过 `git apply -3 --check` 对一个「删除文件」的补丁返回 rc=0 且**工作树文件依然存在**。
   - 被删的那些文件（`lib/cron-runner.ts`、`components/fork/PiMemoryConfig.tsx` 等）是我们 fork 独有的、上游任何 PR 都不涉及的文件。
2. **因此 `apply -3` 的冲突数不可复现。** 我在 18:14 重跑了一遍：

   | PR | 首轮（18:06） | 复跑（18:14，树已被改） | rc |
   |---|---|---|---|
   | #615 | CLEAN | 0 冲突 | **0（稳定）** |
   | #710 | CLEAN | 1 冲突 | 1 |
   | #787 | CLEAN | 2 冲突 | 0 |
   | #792 | CLEAN | 3 冲突 | 0 |
   | #977 | CLEAN | 1 冲突 | 0 |
   | #664 | CLEAN | 3 冲突 | 0 |
   | #528 | CLEAN | 2 冲突 | 0 |

   **结论口径**：把 `apply -3` 当成「大致能不能落」的粗筛用；`rc=0`（能落）比冲突文件数稳定得多。**本报告里所有「CONFLICT(k/n)」的数字请视为 18:06 那一瞬间的快照**，采纳前必须在干净树上重跑。
3. **§3 里所有「我们已有等价实现」的结论都是在并发改动之前的树（17:18 索引 / 18:02 起文件）上 grep 出来的**，涉及的文件（`lib/session-title.ts`、`components/TurnWrittenFiles.tsx`、`lib/request-security.ts`、`lib/initial-navigation.ts`、`lib/dialog-title.ts` 等）本次审计期间**未被并发会话改动**，结论有效。
