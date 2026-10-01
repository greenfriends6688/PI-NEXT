# 0052 · 会话 / 项目归档

| 项 | 值 |
| --- | --- |
| 意图 | 会话与项目能从侧栏收起而不丢数据，并能随时从归档页找回来（含归档历史与「为什么不见了」的排查） |
| 参照实现 | Zeno 壳子的「置顶 / 归档」；归档历史页照 zeno 做 |
| fork 标记 | `fork:project-archive`、`fork:ui-archive-history` |
| 新增文件 | `components/ArchivedSessionsPanel.tsx`（+ `.test.mjs`）、`components/ProjectArchivePanel.tsx`（+ `.test.mjs`）、`lib/project-flags.ts`（+ `.test.mjs`） |
| 共享文件 | `lib/archive-names.ts`（**首次落盘在 `495e859`**，服务于 0056 的压缩包命名，本条复用） |
| 上游文件接触面 | `components/SettingsPanel.tsx`（归档分节）、`components/SessionSidebar.tsx` |
| `.patch` | 无（引入 commit 在换肤大快照里，无 staged-baseline 可反演） |

## 核实（不是照抄审计报告）

```
$ git log --diff-filter=A --format="%h %ad %s" --date=short -- components/ArchivedSessionsPanel.tsx
a917ffd 2026-09-23  fix(sidebar): 归档后会话失踪 + 新增归档历史页（照 zeno）
$ git log --diff-filter=A --format="%h %ad %s" --date=short -- \
    components/ProjectArchivePanel.tsx lib/project-flags.ts
ac4ec72 2026-09-28  feat: 导入 / 文件预览重做 / 用量仪表盘 + 六处界面修正   （两者同为 ac4ec72）
$ git log --diff-filter=A --format="%h %ad" --date=short -- lib/archive-names.ts
495e859 2026-09-21  feat(files): 移植上游 PR #899 —— 文件管理…                ← 不是本条
```

审计把本条归到 `a917ffd` 单一 commit，**不准确**：那是**会话**归档（`ArchivedSessionsPanel` +
归档历史页）的引入点；**项目**归档（`ProjectArchivePanel` + `lib/project-flags.ts`）是三天后
`ac4ec72` 才落盘的，与 0049 跨 agent 导入同一个 commit。两条能力同源（都是「置顶/归档」这条
产品线），所以合记一条，但时间线必须分开记 —— 否则 revert 时会以为 `ac4ec72` 只跟导入有关。

`lib/archive-names.ts` 也不是本条引入的：它在 `495e859`（0056 文件压缩包）里落盘，
本条只是复用它的后缀判定。

## 与上游的关系

上游 `agegr/main` 的 `ArchivedSessionsPanel.tsx`、`ProjectArchivePanel.tsx`、
`lib/project-flags.ts`、`lib/archive-names.ts` 全部 absent。**纯新增。**

## 三条硬约束

1. **归档只是「展示」**（`lib/project-flags.ts` 文件头原文：presentation only）。
   归档一个项目 = 侧栏里收起那一行；**绝不**重命名、移动、删除任何 `.jsonl`，
   也**绝不**碰磁盘上的目录。会话级归档遵守 `lib/session-flags.ts` 的同一条硬规则。
2. **项目键用服务端算出来的身份，不用浏览器拼路径。** 键是 `SessionInfo.projectKey`
   —— `projectIdentityKey(projectRoot)`（见 `/api/worktrees`）。两个理由：
   - 与侧栏已经在用的分组身份一致，所以「一个被归档的项目」在侧栏里**恰好是一行**（含 worktree）；
   - Windows 上路径的大小写与分隔符归一在服务端做，这个 store 因此**不需要重新实现路径归一化**。
     参考实现按客户端归一化路径做归档键，**真的撞过一次 element-id** ——
     同一路径的两种拼法 slug 后变成同一个 id。
3. **归档历史页存在的理由是排查。** `a917ffd` 的 commit 标题就是「归档后会话失踪」——
   用户把会话归档后侧栏里找不到，就需要一个能看见「归档了什么、什么时候、能不能恢复」的地方。

## 一处 UI 合并（后来才发生的）

`components/SettingsPanel.tsx:1119-1126` 的注释记着：会话归档的分组与详情卡**并进了同一个**
`ConfigSplitView` 面板，**旧的两段式入口 `ArchivedSessionsPanel` 恒渲染 `null`，已删**。
所以 `ArchivedSessionsPanel.tsx` 现在只剩 `ProjectArchivePanel` 里的一段内部渲染，
revert 时不要把两个面板拆回两段式。

## 能否独立 revert

**能。**

- 删 `components/ArchivedSessionsPanel.tsx` + `components/ProjectArchivePanel.tsx` +
  `lib/project-flags.ts` 及三份测试。
- `SettingsPanel.tsx` / `SessionSidebar.tsx` 上按 `fork:project-archive` /
  `fork:ui-archive-history` 标记整段删。
- **`lib/archive-names.ts` 不能顺手删** —— 0056 的 zip / 解包要用它的 `archiveStem` /
  `buildZipArgs` / `buildExtractArgs` / `isArchivePath`。这是 README 里
  「0027 删 Git 变更面板时 `lib/git-changes.ts` 不能整删」的同一条教训的第二次出现。
- 存储只在 localStorage（`pi-project-flags`），revert 后用户已归档的条目会重新出现在侧栏
  —— **数据本身从未被删过**，所以 revert 是无损的。

## 验证手段

- 单测 20 例：`ProjectArchivePanel` 8、`ArchivedSessionsPanel` 6、`project-flags` 6。
- 浏览器验收：侧栏右键归档一个项目 → 该行消失 → 设置 → 归档页能看到它 →
  点开能看到该项目下的会话 → 恢复后侧栏原样回来 →
  **磁盘上 `.jsonl` 与目录逐字节没动**。

## 合并上游后怎么重打

```bash
git grep -n "fork:project-archive\|fork:ui-archive-history" -- lib components
# 三条不变式：
#   1) 归档只是展示：绝不重命名/移动/删除 .jsonl，绝不碰磁盘目录；
#   2) 项目键必须用服务端 projectIdentityKey 的结果，不在浏览器拼路径、不自行归一化；
#   3) revert 时保留 lib/archive-names.ts（0056 在用）。
node_modules/.bin/tsc --noEmit && npm run lint && npm test
```
