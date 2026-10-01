# 0051 · 工作区 Markdown / 代码编辑器（CodeMirror）

| 项 | 值 |
| --- | --- |
| 意图 | 文件查看器里能直接改：Markdown 与源码两类文件用 CodeMirror 真编辑器（语法高亮 / 撤销 / 括号匹配 / 折叠 / 搜索），保存走 diff3 三方合并，外部改动不丢本地草稿 |
| 参照实现 | 自研（无上游对应物）；保存冲突的合并模型参考 `node-diff3` |
| fork 标记 | `fork:markdown-incremental`、`fork:perf-viewer-two-modes`、`fork:perf-viewer-keepalive`、`fork:fix-md-preview`、`fork:board-diff-2026-10-01` |
| 新增文件 | `components/CodeFileEditor.tsx`、`components/MarkdownFilePreview.tsx`、`lib/markdown-file.ts`、`lib/markdown-sync.ts`、`lib/markdown-incremental.ts`、`lib/code-highlight-schedule.ts`、`hooks/useMarkdownFile.ts`（+ 4 份 `.test.mjs`） |
| 上游文件接触面 | `components/FileViewer.tsx`（编辑/预览双模式 + 挂载编辑器）、`lib/file-editor-types.ts` |
| 依赖增量 | `@codemirror/{commands,lang-css,lang-html,lang-javascript,lang-json,language,search,state,view}` 共 9 个 —— **fork 独有** |
| `.patch` | 无（引入 commit 在换肤大快照里，无 staged-baseline 可反演） |

## 核实（不是照抄审计报告）

```
$ git log --diff-filter=A --format="%h %ad %s" --date=short -- \
    components/MarkdownFilePreview.tsx hooks/useMarkdownFile.ts
1f4d45a 2026-09-14  feat(workspace): add workspace Markdown editor and switchable layout
$ git log --oneline -S "CodeFileEditor" | tail -5
1f4d45a → bcccae0 → ac4ec72 → a126f23 → 29b34a6   （后四个是 docs/后续改动）
$ git log --diff-filter=A --format="%h %ad" --date=short -- lib/code-highlight-schedule.ts
f4eb72d 2026-09-18  perf(chat): 流式 markdown 节流、高亮错峰与预览轻插件组
$ git show agegr/main:package.json | grep -c codemirror   → 0
$ grep -c codemirror package.json                        → 9
```

审计记的 `1f4d45a` 正确。它漏了 `lib/code-highlight-schedule.ts`（`f4eb72d`）与
`hooks/useLazyHighlighter.ts` —— 后者**在当前树上不存在**（`ls` 报 No such file），
审计文件清单这一项是错的；被高亮调度替代掉的东西不能照抄进台账。

## 与上游的关系

上游 `agegr/main` 的 `package.json` 里 **0 个 `@codemirror/*` 依赖**，
`CodeFileEditor.tsx` / `MarkdownFilePreview.tsx` / `lib/markdown-{file,sync,incremental}.ts` /
`hooks/useMarkdownFile.ts` 全部 absent。**这 9 个依赖和整套编辑器都是 fork 独有的，
合并上游时上游不会带进来，也不会冲突 —— 除非上游自己也开始做编辑器。**

## 三层结构

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 编辑器 | `components/CodeFileEditor.tsx` | CodeMirror 实例：`defaultKeymap`/`historyKeymap`/`indentWithTab`/`undo`、css/html/javascript/json 四种语言、`bracketMatching`、`foldGutter`、`indentOnInput`、`syntaxHighlighting`、`searchKeymap` |
| 预览 | `components/MarkdownFilePreview.tsx` | 编辑/预览双模式里的 Markdown 渲染面 |
| 存取 | `lib/markdown-file.ts` | 服务端读写。上限 `MAX_TEXT_EDIT_BYTES = 5MB`；写入走「同一 fd 上比较后写」，**永不新建文件** |
| 同步 | `lib/markdown-sync.ts` + `hooks/useMarkdownFile.ts` | 外部改动检测 + `node-diff3` 三方合并 + 草稿保存在内存 Map |
| 流式 | `lib/markdown-incremental.ts` | 见下 |

### `markdown-incremental` 的切分规则（钉在测试里）

流式回答的文本**只在尾部增长**，所以 UI 只需对变化的 tail 重跑 remark/rehype，
已完成的块跳过 React 协调与分词。切分规则与 react-markdown 实际使用的 CommonMark + GFM 对齐：

- **未闭合的代码围栏**把从起始行起的所有内容拉进 tail —— 闭合前围栏内容是否属于代码不确定，不能提前 parse；
- 其余情况 tail 从**最后一个空行**之后开始 —— 空行是硬块边界，空行前的内容不会因 tail 增长而改变语义；
  连续块（列表 / 引用 / 表格 / setext 标题 / 缩进代码）内部没有空行，因此永远不会被从中间切开；
- 生成分块时收敛连续空行。

### `markdown-sync` 为什么自己切行

文件头注释写明：用 `node-diff3` 的默认字符串切分不适合 Markdown（**缩进与硬换行带语义**），
所以本模块用 `/[^\n]*\n|[^\n]+$/g` 自己切，**保留空白与行尾**。

## 能否独立 revert

**能。**

- 删 7 个新增文件 + 9 个 `@codemirror/*` 依赖。
- `FileViewer.tsx` 上的改动按 `fork:perf-viewer-two-modes` / `fork:perf-viewer-keepalive` /
  `fork:fix-md-preview` 标记整段删，退回「只读查看器」。
- `lib/file-editor-types.ts` 的编辑相关类型删掉。
- 无 `.gitignore` 改动、无路由新增。

**注意一个耦合**：`lib/markdown-incremental.ts` 服务的**不只是文件编辑器**，
它也给流式聊天回答分块用（`fork:markdown-incremental` 在 chat 侧也有引用）。
revert 文件编辑器时**不要连带删掉 incremental 模块**，否则聊天区的流式渲染会退化。

## 验证手段

- 单测 24 例：`markdown-incremental` 12、`markdown-sync` 8、`markdown-file` 4
  （另有 `lib/markdown-list.test.mjs` 属上游共有，列出仅为完整性）。
- e2e：`npm run test:fileviewer` → `e2e/file-viewer-modes.mjs`（编辑/预览双模式往返）。
- 浏览器验收：查看器里改一个源码文件 → 高亮/折叠/搜索可用 → Ctrl+Z 撤销 →
  保存 → 外部（agent）改了同一文件 → 重新打开出现三方合并冲突而不是静默覆盖。
- 体积红线：编辑上限 5MB，超出报 `MarkdownFileError` 而不是截断保存。

## 合并上游后怎么重打

```bash
git grep -n "fork:markdown-incremental\|fork:perf-viewer-two-modes" -- lib components hooks
# 三条不变式：
#   1) markdown-sync 自己按 \n 切行，不用 node-diff3 的默认切分；
#   2) lib/markdown-file.ts 的写入是「同 fd 比较后写」，不新建文件；
#   3) 撤销编辑器时保留 lib/markdown-incremental.ts（聊天流式也在用）。
node_modules/.bin/tsc --noEmit && npm run lint && npm test
```
