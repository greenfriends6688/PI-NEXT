# 0048 · Git 图谱 / 分支 / 提交历史

| 项 | 值 |
| --- | --- |
| 意图 | 在右栏开一个「看一眼」的提交图：分支泳道、ref chip（本地/远端/HEAD）、点开看某提交改了哪些文件，并支持切换/新建分支 |
| 参照实现 | ZCode 借鉴项（`docs/zcode-pr-plan-2026-09-21.md`）同批落地的「内置 git 图」 |
| fork 标记 | `fork:git-graph`、`fork:git-graph-tab` |
| 新增文件 | `lib/git-graph.ts`、`lib/git-graph-geometry.ts`、`lib/git-graph-lanes.ts`、`lib/git-graph-palette.ts`、`lib/git-graph-parser.ts`、`lib/git-graph-refs.ts`、`app/api/git/branch/route.ts`、`app/api/git/log/route.ts`、`components/GitGraphTab.tsx`、`components/GitRefChips.tsx` |
| 上游文件接触面 | 1 个：`components/AppShell.tsx`（右栏 tab 体系：`GIT_GRAPH_TAB_ID`、state、`panelTabs` memo、`openGitGraphTab`，共 6 处） |
| `.patch` | 无（引入 commit 在换肤大快照里，无 staged-baseline 可反演） |

## 核实（不是照抄审计报告）

```
$ git log --diff-filter=A --format="%h %ad %s" --date=short -- lib/git-graph*.ts
（lanes / palette / parser / refs  → 8885206 2026-09-17）
（git-graph.ts / -geometry.ts      → 22fa16a 2026-09-20）
$ git log --diff-filter=A --format="%h" -- app/api/git/log/route.ts    → 22fa16a
$ git log --diff-filter=A --format="%h" -- app/api/git/branch/route.ts → 35769ca 2026-09-29
$ git diff --stat agegr/main -- lib/git-status.ts | wc -l   → 0
```

**两处与审计报告不一致，按代码为准：**

1. **审计说「首次提交 `22fa16a`」不准确。** `lib/git-graph-{lanes,palette,parser,refs}.ts`
   最早在 `8885206`（2026-09-17 那批「导入家里电脑」里）就落过盘，随后 `a7fd145` 按
   「不并入未接线的库」删掉（delta.md:812 明确列了 `lib/git-graph-*.ts`），
   再由 `22fa16a`（2026-09-20）连同 `GitGraphTab.tsx` 一起**带接线重新引入**。
   真正可 revert 的形态是 `22fa16a`。
2. **审计把 `lib/git-status.ts` 算成 fork 文件是错的。**
   `git diff --stat agegr/main -- lib/git-status.ts` 输出为空 —— 与上游**逐字节相同**，
   首次落盘在上游 `68e746c Release v0.9.0`。本条不碰它。

## 与上游的关系

上游 `agegr/main`（`e17d2cc`）的 `app/api/git/` 只有 `diff` 与 `status` 两条路由，
没有 `branch`、没有 `log`、没有任何图谱渲染；`lib/git-graph*.ts`、`GitGraphTab.tsx`、
`GitRefChips.tsx` 全部 absent。**这是纯粹的新增能力，不是对上游的改写。**

冲突面只有一处：`components/AppShell.tsx` 的右栏 tab 体系。那套 tab 现在有六条分支
（git-graph / 会话分支 / 浏览器 / 终端 / 文件 / translate），上游若继续加 tab 就会和
`GIT_GRAPH_TAB_ID` 的命名空间、以及 `panelTabs` memo 的插入顺序互相顶。

## 六个 lib 各干什么

| 文件 | 职责 |
| --- | --- |
| `lib/git-graph-parser.ts` | 解析 `git log` 的自定义格式（`formatGitLogCommand` + `parseGitLog`），把父子链接抽成 `GitLogCommit[]` |
| `lib/git-graph-lanes.ts` | 泳道分配状态机：由父链接推导每个 commit 落在哪条道 |
| `lib/git-graph-geometry.ts` | 节点坐标与曲线 |
| `lib/git-graph-palette.ts` | 分支/合并/tag/远端的配色 |
| `lib/git-graph-refs.ts` | ref 归类（本地 / 远端 / `HEAD`）与排序 |
| `lib/git-graph.ts` | 服务端数据层（`fork:git-graph`）：一条**有上限**的 `git log` + 详情卡的「某提交改了哪些文件」 |

一个刻意的实现判断写在 `lib/git-graph.ts` 的文件头注释里：**不要 `--graph`，也不维护第二套
execFile 封装**。车道几何由客户端状态机从父链接推导，`git()` / `findRepositoryRoot()` 直接复用
`lib/git-changes.ts`（超时 / maxBuffer / `LC_ALL` 只有一处配置）。
这条与 README 里「0027 剔除 Git 变更面板时**必须保留 `lib/git-changes.ts`**」的提醒是同一件事的两面。

## 能否独立 revert

**能，而且比 0047 干净得多。**

- 删 10 个新增文件 → 图谱消失。
- `AppShell.tsx` 上的 6 处全是带 `fork:git-graph-tab` 标记的**加法**（一个常量、一份 state、
  memo 里的一段 spread、一个 `openGitGraphTab` 回调、渲染分支），按标记整段删即可。
- 无 `package.json` / `.gitignore` 改动，无依赖增删。

唯一要注意的：**revert 时不要顺手删 `lib/git-changes.ts`** —— 文件树的 git 状态色和查看器 diff
还依赖它（README 0027 行已记过一次同样的教训）。

## 验证手段

- 单测 24 例：`git-graph-lanes` 5、`git-graph-parser` 4、`git-graph-refs` 4、
  `git-graph-palette` 4、`git-graph-geometry` 5、`git-status` 2（后两个文件与上游共有，
  列出仅为完整性）。
- 浏览器验收：右栏出现 Git 图谱 tab → 图谱按提交时间倒序画出泳道 → 当前分支与 `HEAD` 有 chip →
  点提交出详情卡（改了哪些文件）→ 切分支后图谱重取。
- 端到端数据面：`GET /api/git/log`、`GET /api/git/branch` 两条路由可直接 curl。

## 合并上游后怎么重打

```bash
git grep -n "fork:git-graph" -- lib components app
# 三条不变式：
#   1) git log 不加 --graph，车道由 lib/git-graph-lanes.ts 从父链接推导；
#   2) 不新建第二套 execFile 封装，继续用 lib/git-changes.ts 的 git() / findRepositoryRoot()；
#   3) lib/git-changes.ts 不许随 0027 一起被删。
node_modules/.bin/tsc --noEmit && npm run lint && npm test
```
