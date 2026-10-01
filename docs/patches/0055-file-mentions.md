# 0055 · 文件 `@` 提及（拖入绝对路径 → cwd 相对引用）

| 项 | 值 |
| --- | --- |
| 意图 | 把文件拖进输入框时自动变成 `@相对路径` 引用（零拷贝），并在输入框高亮层与消息正文里把**能解析到真实目标**的 `@` / `/` token 渲染成可点的 mention |
| 参照实现 | 本仓 0003 的文档里把 `@` 描述为「本仓此前就有」的机制；本条是把那套机制**重新做了一遍并做深** |
| fork 标记 | `fork:pr13-composer`（`lib/file-mentions.ts`） |
| 新增文件 | `lib/file-mentions.ts`（+ `.test.mjs`）、`lib/mention-tokens.ts`（+ `.test.mjs`） |
| 上游文件接触面 | `components/ChatInput.tsx`（import 2 处：切词 + 拖入转换）、`components/MessageView.tsx`、`components/MarkdownBody.tsx` |
| `.patch` | 无（引入 commit 在换肤大快照里，无 staged-baseline 可反演） |

## 先回答任务里的那个问题：**它不是 0003 的一部分**

必须自己去 grep 才能下结论，结论是**不属于 0003**：

```
$ grep -c "file-mentions\|mention-tokens" docs/patches/0003-composer-references.patch
0
$ grep "^+++" docs/patches/0003-composer-references.patch
+++ b/lib/composer-references.ts
+++ b/lib/composer-references.test.mjs
+++ b/components/ComposerReferenceMenu.tsx
+++ b/components/ChatInput.tsx / ChatWindow.tsx / ChatInput.test.mjs / 三个 i18n
```

0003 的 `.patch` 里 **`file-mentions` 与 `mention-tokens` 零命中**，文件清单里也没有它们。
0003 的说明文档里有一句反向证据：它写「本仓此前**只有** `@` 文件引用
（`lib/file-fuzzy.ts` 的 `extractAtQuery` + `ChatInput.tsx` 里的 `@` 菜单）」——
也就是说 0003 落地时把 `@` 当作**上游既有机制**照着平行再造了 `&`/`#`/`~`，
而本条这两个模块当时**根本不在树里**（见下面的时间线）。

所以：`@文件` 提及**单列为 0055**，不并入 0003。上游那份 `lib/file-fuzzy.ts`
（`extractAtQuery`）今天仍然在树里且**与上游逐字节相同**（`git diff --stat agegr/main --
lib/file-fuzzy.ts` 输出为空），它是 `@` 菜单的老抽取器，本条的两个模块是它的增强版。

## 时间线（三次身份变化，这是本条最容易搞错的地方）

```
$ git log --oneline --name-status -- lib/file-mentions.ts lib/mention-tokens.ts
8885206 2026-09-17  A   ← 随「导入家里电脑那一批」落盘
a7fd145 2026-09-17  D   ← 当天就被按「不并入未接线的库」删掉（delta.md:812 列明这两个文件）
22fa16a 2026-09-20  A   ← 带真实接线重新引入（同时打上 fork:pr13-composer 标记）
db84edb 2026-09-30  M   ← mention-tokens.ts：接 pw-tok-ref 高亮 token
```

`a7fd145` 删它们的理由正是「本轮未接线，没有任何生产 import，连同 `lib/git-graph-*.ts`
一起不并入，等真正接线时再单独提」（delta.md:812 原文）。**接线是在 `22fa16a` 完成的**，
所以可 revert 的形态是 `22fa16a`，不是 `8885206`。

## 与上游的关系

上游 `agegr/main` 的 `lib/file-mentions.ts` / `lib/mention-tokens.ts` absent，**纯新增**。

## 三个必须守住的坑（写死在文件头注释里）

`lib/mention-tokens.ts` 服务**两个面**：输入框高亮层与消息正文。只给**解析到真实目标**的
token 加 accent + 点状下划线，否则保持纯文本。三条：

1. **valid 才高亮。** `fileExists` / `isSkill` 在索引未加载时返回 `undefined`，
   **一律按 invalid 处理** —— 原文：「highlighting must never guess」。
2. **光标所在 token 保持纯文本**（`activeTokenStart`）。用户正在输入的那截 token 不能闪高亮，
   否则每敲一个字符都在「高亮 / 不高亮」之间跳。
3. **代码块内不改。** 消息体侧走 remark 插件且**只替换 `text` 节点**；
   `code` / `inlineCode` 不经过 `transform`，所以围栏和行内代码里的 `@xxx` 永不改样式。

## 为什么绕开了 raw HTML span（一个被 schema 堵死的路）

消息体侧不能用 raw HTML `<span class="mention-token">`：
本仓 `lib/markdown.ts` 的 `rehype-sanitize` schema **没有放行 `span` 的 class/data 属性**
（默认 GitHub schema 会全部剥掉），而这条又**不允许改 `lib/markdown.ts`**。
解法是两段式：remark 阶段先产出**哨兵链接**
`` `#pi-mention-<kind>-<encodeURIComponent(value)>` `` —— `#` 开头的 href 能原样穿过 sanitize；
随后由 `mentionRehypePlugin` 在 sanitize **之后**把哨兵还原成
`<span class="mention-token …">`。高亮表现与 raw-HTML 方案一致。

## `lib/file-mentions.ts`：绝对路径 → cwd 相对，且拒绝越界

纯字符串逻辑（**不依赖 `node:path`**），因此既能在浏览器里跑，也能被单测直接引用。
桌面外壳通过 `webUtils.getPathForFile` 给到磁盘绝对路径（接 0047 的 `lib/desktop-shell.ts`）：

- 落在项目目录内的文件 → **零拷贝引用**；
- 落在 cwd 之外的 → **一律拒绝**，交给调用方走原有的上传 / 引用管线。
- 一条硬规则写在文件头：**`@` token 的语义始终是「项目内文件」，不能靠 `..` 或相似前缀把它掰弯。**
  （Windows 盘符前缀由 `WINDOWS_DRIVE_RE` 单独处理。）

## 能否独立 revert

**能，但 revert 之后 `@` 菜单会退回到上游那套**（`lib/file-fuzzy.ts` 的 `extractAtQuery`
仍在树里、与上游一致，所以不会彻底没有 `@` 菜单）。

- 删 `lib/file-mentions.ts` + `lib/mention-tokens.ts` 及两份测试。
- 三个消费方的接线按 `fork:pr13-composer` 标记删：
  `ChatInput.tsx` 的两处 import、`MessageView.tsx` / `MarkdownBody.tsx` 的渲染插件挂载。
- **`lib/markdown.ts` 一行不用改**（本条从一开始就没碰它）。
- 无 `package.json` 依赖增删。

⚠️ 注意与 0003 的边界：revert 本条**不要动 `lib/composer-references.ts`**。
0003 的 `extractReferenceQuery` 与本条的 `tokenizeMentions` 是**两个平行的抽取器**，
共用 ChatInput 里「一次光标解析」的产物；删掉本条后 0003 的 `&`/`#`/`~` 仍应正常。

## 验证手段

- 单测 30 例：`mention-tokens` 19、`file-mentions` 11
  （覆盖 invalid 不高亮、光标 token 纯文本、代码块不改、Windows 盘符、cwd 外拒绝、相似前缀不得绕过）。
- 浏览器验收：拖一个项目内文件进输入框 → 变成 `@相对路径` 且不高亮（还没解析）→
  索引加载后变高亮 → 发出后正文里可点；
  拖一个项目外文件 → **被拒绝**并走原有上传/引用路径。

## 合并上游后怎么重打

```bash
git grep -n "fork:pr13-composer" -- lib components
# 五个不变式：
#   1) valid 才高亮，索引未加载一律按 invalid；
#   2) 光标所在 token 保持纯文本；
#   3) 代码块 / 行内代码内的 @xxx 不改样式；
#   4) 消息体侧走「哨兵链接 + sanitize 后还原」，不改 lib/markdown.ts 的 schema；
#   5) @ token 只认项目内文件，cwd 外一律拒绝，不靠 .. 或相似前缀绕过。
node_modules/.bin/tsc --noEmit && npm run lint && npm test
```
