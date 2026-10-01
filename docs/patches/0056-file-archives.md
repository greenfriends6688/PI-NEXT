# 0056 · 文件压缩包（zip / 解包）+ 文件增删改

| 项 | 值 |
| --- | --- |
| 意图 | 文件浏览器里能新建 / 重命名 / 删除 / 下载，能把文件或目录压成 zip、能解压，并在查看器里有右键菜单 |
| 参照实现 | **上游 PR #899「文件浏览器增删改/下载/压缩包/内联编辑」——手工移植过来的** |
| fork 标记 | 无独立 `fork:` 标记（走 `lib/file-mutations.ts` / `lib/file-archives.ts` 的模块边界） |
| 新增文件 | `lib/file-archives.ts`（+ `.test.mjs`）、`lib/archive-names.ts`、`lib/file-mutations.ts`（+ `.test.mjs`） |
| 上游文件接触面 | `app/api/files/[...path]/route.ts`（`compress` / `extract` 两个 action 接进 `FILE_MUTATION_TYPES`）、`components/FileExplorer.tsx`、`components/FileViewer.tsx`、`components/ExplorerPanel.tsx`、三个 i18n |
| `.patch` | 无（引入 commit 在换肤大快照里，无 staged-baseline 可反演） |

## 核实（不是照抄审计报告）

```
$ git log --oneline -- lib/file-archives.ts
495e859 feat(files): 移植上游 PR #899 —— 文件管理（新建/重命名/删除/下载/压缩包/右键菜单）
$ git show --stat --oneline 495e859
17 files changed, 1570 insertions(+) —— lib/file-archives.ts 161 行
  + lib/file-archives.test.mjs 118 / lib/file-mutations.ts 283 + .test.mjs 162
  + lib/archive-names.ts 36 + app/api/files/[...path]/route.ts +123
  + components/FileExplorer.tsx +628 / FileViewer +7 / ExplorerPanel +3 / 三个 i18n 各 +19
$ git grep -n "compress\|extract" agegr/main -- app/api/files   → 0 命中
$ git ls-tree -r --name-only agegr/main -- app/api/files
app/api/files/[...path]/route.ts + 4 个 *.test.mjs（无 compress / extract）
```

审计记的 `495e859` 与「源自上游 PR #899」**都对**。commit 标题里就写着「移植上游 PR #899」。

## ⚠️ 与上游的关系：这条最特殊，必须单独立记

**上游 PR #899 被维护者以「scope」为由关闭了，从未合入主线。**
`docs/upstream-audit-2026-10-01/closed-prs.md:338` 记着：

> | #899 | 文件浏览器增删改/下载/压缩包/内联编辑 | 维护者：「Pi Web is meant to stay a thin
> front end… editing and managing files is the agent's job」 | 我们**已经**做了维护者拒绝的那一版
> | CONFLICT(6/18) |

当前 `agegr/main`（`e17d2cc`）的 files 路由确实没有 `compress` / `extract`
（`git grep` 0 命中），审计报告原文「上游主线若已合入会冲突」是**保守说法**，
按今天的实测更准确的是「**上游没有，且维护者明确表态不要**」。

**未来什么时候会撞**：如果上游改变主意、自己合入等价的文件管理能力，
本条的 6/18 个文件会直接冲突（`FileExplorer.tsx` 是最大的一块）。审计把这条算作
「CONFLICT(6/18)」是整份报告里冲突面最高比例的一项。

反向提醒（`closed-prs.md:356` 的原话）：「维护者以 scope 为由关掉」在我们的语境下
**不是有效否决理由** —— 本 fork 已经在多处突破「薄前端」这条线（0051 编辑器、
0049 导入面板、0047 桌面 DMG）。所以本条**保留**，不因上游拒绝而撤。

## 为什么用 `bsdtar` 而不是系统各自的 `zip` / `tar`

`lib/file-archives.ts:12` 一行注释讲清了：**bsdtar (libarchive) reads and writes every format we expose.**
一个二进制覆盖 zip / tar / tar.gz / tar.bz2 / tar.xz / tar.zst，
不必在 macOS / Windows / Linux 三套系统命令之间分叉（Windows 上根本没有 `zip`）。
调用一律 `execFile` 传 argv 数组、**不经 shell**，超时 `ARCHIVE_TIMEOUT_MS = 10 分钟`。

## 命名规则在纯函数里，因为它客户端也要用

`lib/archive-names.ts` 是**纯函数模块**（文件头：safe to import from client components），
服务端 spawner 在 `lib/file-archives.ts`。四条导出：

| 导出 | 作用 |
| --- | --- |
| `isArchivePath(name)` | 双后缀（`tar.gz`/`tgz`/`tar.bz2`/`tbz2`/`tar.xz`/`txz`/`tar.zst`/`tzst`）与单后缀（`zip`/`tar`），**大小写不敏感** |
| `archiveStem(name)` | 默认解压目录名；剥不掉后缀时回落成 `<name>_extracted` |
| `buildExtractArgs(archive, destDir)` | `["-xf", archive, "-C", destDir]` |
| `buildZipArgs(destZip, parentDir, entryName)` | `["--format","zip","-cf",destZip,"-C",parentDir,"--",entryName]` —— **zip 里恰好一个顶层条目** |

**这条模块是 0052（归档）也会用到的共享层**，revert 时两处都要留意（README 里
「0027 删 Git 变更面板时 `lib/git-changes.ts` 不能整删」是同一条教训的两次实例化）。

## 写操作有硬上限

`lib/file-mutations.ts`（同批移植）：`MAX_WRITE_BYTES = 2MB`（对齐查看器的编辑上限），
`BINARY_SNIFF_BYTES = 8`（嗅探二进制头）。所有路径都要过 `isPathWithinRoots`；
`file-archives.ts` 额外用 `resolveRealParent`（解析符号链接后的真实父目录）防穿越。

路由侧：`FILE_MUTATION_TYPES` 加了 `"extract"` 与 `"compress"` 两个 action，
与其他写操作走同一套校验。

## 能否独立 revert

**能。**

- 删 `lib/file-archives.ts` + `lib/file-mutations.ts` + `lib/archive-names.ts` 及两份测试。
- `app/api/files/[...path]/route.ts` 的 `compress` / `extract` 两个分支与
  `FILE_MUTATION_TYPES` 里的两项删掉。
- `FileExplorer.tsx`（628 行那一块的绝大部分）、`FileViewer.tsx`、`ExplorerPanel.tsx`
  的接线与三个 i18n 的 19 个 key 各语言删掉。
- 无 `package.json` 依赖增删（用的是系统 `bsdtar`，不是 npm 包）。

⚠️ **两处牵连**：
1. **`lib/archive-names.ts` 被 0052（归档）复用** —— 删它要一起看 0052 的解包判定。
2. **0051（编辑器）接在 `FileViewer.tsx` 上** —— 删本条时按 `fork:` 标记精确删，
   别把 0051 的编辑/预览双模式一起带走。

## 验证手段

- 单测：`lib/file-archives.test.mjs` 5 例（命名规则与 argv 构造，含双后缀与回落名）、
  `lib/file-mutations.test.mjs`（越界拒绝 / 大小上限 / 二进制嗅探）。
- 路由：`POST /api/files/<path>` `{type:"compress"}` → 返回生成的 zip 路径；
  `{type:"extract"}` → 返回 `extractedTo`。
- 浏览器验收：文件树里右键一个目录 → 压缩 → 得到同级 `<name>.zip` →
  解压 → 目录名等于 `archiveStem` 的结果 → 双后缀（`.tar.gz`）也判对。

## 合并上游后怎么重打

```bash
git grep -n "file-archives\|file-mutations\|archive-names" -- lib app components
# 四条不变式：
#   1) 统一用 bsdtar（libarchive），不要按平台分叉 zip/tar；
#   2) 所有 argv 走 execFile 数组，不经 shell；路径过 isPathWithinRoots + resolveRealParent；
#   3) 保留 lib/archive-names.ts（0052 也在用）；
#   4) MAX_WRITE_BYTES = 2MB 与查看器编辑上限对齐。
node_modules/.bin/tsc --noEmit && npm run lint && npm test
```
