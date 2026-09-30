# pi-web 真机反馈 9 条的收口报告（2026-09-30）

> 承接会话「运行 pi-codex 项目测试」。用户带 9 张截图逐项反馈（编号 #1–#9），
> 本轮在**仓库构建**（`127.0.0.1:30141`，重新构建后的 `BUILD_ID=ks6PWcEq-DTv6AZh7wx3Y`）
> 上逐条复现 + 修复 + 实测验证。
> 设计裁定与「登记不改」的条目见 `design/pi-web-design/DIVERGENCE.md` 的 **J 节（97–106 条）**。

---

## 0 · 先看这一条：你看到的可能不是最新构建

用户当时看的是 **`/Applications/Pi Web.app`**（Electron 打包版，自带一份 repo 拷贝 +
自己的 `.next`，构建于 **11:53**）。仓库里 12:50 与 13:45 两轮改动都**不在那个包里**。

9 条里有 **4 条在仓库构建里本来就是好的**：

| # | 用户反馈 | 仓库构建实测 |
| --- | --- | --- |
| 3 | 供应商弹窗 icon 没了 / 显示慢 | `public/provider-icons.svg` 38 个 symbol 齐全，14 行图标全部渲染；选中模板后右列是完整表单 |
| 5 | 顶栏 `main` 芯片点不了 | 顶栏那枚是 `<button class="pw-chipbtn">`，点击打开 Worktrees 浮窗 |
| 7 | 最近会话浮窗被裁、时间被切 | 320 宽 / `overflow-x: hidden` / 时间格 `scrollWidth === clientWidth`，1440 与 1080 两档 0 处裁切 |
| 9 | 项目行 ⋯ 点了没反应 | 菜单正常弹出 4 项（见下，本轮修完才**可见**）|

**所以：需要重新出包。** 命令：`npm run prod`（仓库）/ 重新打包 Electron 应用。

---

## 1 · 本轮真正修掉的三处

### #5 + #9 · 侧栏两个下拉「点不动」——一份没人管的旧副本

**根因**：9-29 的 `fork:ui-pop-portal-fix` 只改到了抽出来的**共享版**
`components/PortalDropdown.tsx`（给 portal 容器加 `position:relative; z-index: var(--z-popover)`），
而 `SessionSidebar.tsx` 里还留着一份**同源旧副本**（`DROPDOWN_ANIMATION_MS` /
`AnimatedDropdown` / `PortalDropdown`），侧栏的 worktree 切换下拉与项目 ⋯ 菜单
用的正是这份旧副本 —— 它 portal 到 body 之后**没给容器任何 z-index**，
在根层叠上下文里是第 0 层，被 `.sidebar-container`（`z-index: 200`）整块盖住。

**实测证据**（修复前，30141）：

```
浮窗：visibility: visible / opacity: 1 / box [8,212,264,98]   ← DOM 里一切正常
document.elementFromPoint(浮窗中心) → SPAN.pw-t               ← 命中的是侧栏的会话行
topIsInsidePop: false                                          ← 浮窗不在最上层
```

**修复**：删掉侧栏里的旧副本，改 import 共享版（一处定义，两处受益）。

**验证**（修复后）：

| 项 | 结果 |
| --- | --- |
| worktree 下拉 | `onTop: true`，浮窗内命中 `SPAN`，文案 `main / 主分支 / upstream / 新建 worktree…` |
| 项目 ⋯ 菜单 | `onTop: true`，浮窗内命中 `BUTTON.pw-prow`，文案 `打开文件夹 / 重命名 / 归档项目 / 从列表中移除` |

> 教训（已写进项目备忘）：`fork:ui-pop-portal-fix` 的备注写的是「改 PortalDropdown 一处全治」，
> 实际漏了这份副本。**任何「改一处全治」的判断都要先 `grep` 同名函数。**

### #8 · 文件查看器两件（`components/FileViewer.tsx`）

1. **选区浮窗两个按钮各占一行** —— 容器是 `flexWrap: wrap` 且宽度交给 shrink-to-fit，
   两个按钮一超宽就折行，浮窗变两行高还带竖向滚动条。
   改为 `flexWrap: nowrap` + `width: max-content` + 按钮 `whiteSpace: nowrap`。
   **验证**：`distinctButtonRows: 1`，浮窗 207×43，两个按钮同一行。
2. **编辑区下方一大片留白** —— `CodeFileEditor` 的根 `.pw-viewer`
   （flex 列 + `height: 100%`）挂在一个 **auto 高度**的
   `div[data-file-stage="source"]` 上，百分比高度落回 auto：编辑器只剩内容高，
   底栏（`Ln · Col` / `EOL · UTF-8`）浮在面板中间，下面全空。
   只给 **source** 层 `height: 100%`。
   **验证**：`stageStyle="height: 100%; min-height: 0px;"`，
   `.pw-viewer` 73→900（827），底栏 873→900，`gapBelowFoot: 0`。
   > preview 层**故意不加**高度：里面的 markdown 是随内容长的，锁死就再也滚不动了。

---

## 2 · 上一轮已改、本轮复核通过的

| # | 改动 | 复核结果 |
| --- | --- | --- |
| 1 | 上下文环浮窗：撤掉「显示详情/隐藏详情」折叠、删掉与明细重复的自造行、宽度恒取 620、`.composer-ring-pop` 补 `width:100%` + `overflow-y:auto` | 620×280、`hasToggle:false`、`hasQuestionRow:false`、明细三节并排（190px×3）、整块落在视口内、不需要滚动 |
| 2 | `.process-file-chip` 补 `nowrap + ellipsis`（长文件名原来折成两行 → 24px 步骤行「错行」）| 23 枚芯片全部 `nowrap/hidden/ellipsis`，芯片高 19、行高 24，无折行 |
| 4 | 皮肤工作室实时预览挪到左列（**用户裁定，与画板 47 相反**）| 已按用户改判；实测预览列 `x=287 / w=340`、设置列 `x=635 / w=518`，**预览在左 ✓**；登记在台账第 100 条 |
| 6 | 新建任务页文件夹芯片右侧补「选目录」图标钮 | 实测 `.pw-ctxbar` 里是「工作区芯片 + `aria-label="打开文件夹"` 的按钮」两件，已接线到系统目录选择器 |

---

## 3 · 验证方式

```
tsc --noEmit                     → 0 错
npm test                         → 2382 / 2382 全绿（0 失败）
npm run check:design             → 样式字面量 184 文件 0 违规 / 动效 0 /
                                   图标 371 处全命中 / 30 张画板 0 错误 + 对齐 0 处偏差
eslint（改动文件）                → 0 error（3 条 warning 为既有未使用变量）
npm run prod（清缓存重建）        → 构建成功，30141 起来后逐条真机复现
```

新增 3 条守卫测试：
- `SessionSidebar.test.mjs` — 侧栏必须 import 共享的 `PortalDropdown`，不得再长出副本；
- `FileViewer.test.mjs` — source 层必须有确定高度、preview 层必须保持内容驱动；
- `FileViewer.test.mjs` — 选区浮窗必须单行。

截图（before / after）在 `test-results/ui-fix-2026-09-30/`。

---

## 4 · 仍然保留的两条（登记不改）

1. **供应商图标「显示慢」**：外链 sprite 的 `<use>` 首屏空白（要等一次 fetch）。
   仓库构建实测图标齐全。若新包里仍觉得慢，正解是把 sprite 内联进文档
   （服务端读 `public/provider-icons.svg` → 隐藏 `<svg>`，`<use href="#id">` 同文档引用）。
   本轮不改：需要重新构建才能验证，收益（首屏快 ~200ms）不值这个风险。
2. **供应商「点添加之后啥都没了」**：选中模板后弹窗关闭、右列落到
   「Provider name / 图标 / 接口地址 / API Key / API 协议 / Headers」表单，
   不是空面板 —— 判断为旧包的观感差异。若在新包里仍有具体不满意，请指出是
   左列列表变短还是右列字段缺失。
